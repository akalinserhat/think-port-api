"""
ThinkPort AI Gateway - PostgreSQL (pgvector) Bulut Belge RAG İndeksleme, Senkronizasyon ve Arama Servisi (rag_document_service.py).

Sorumluluklar:
1. Bulut depolamaya (Google Drive, OneDrive vb.) yüklenen tüm döküman dosyalarını (.pdf, .doc, .docx, .xlsx, .csv, .txt, .md, .pptx, .rtf)
   otomatik olarak metne çözümlemek, sayfa/tablo başlıklarını ve `BAAI/bge-m3` anlamsal geçişlerini (Semantic Chunking)
   koruyarak parçalara ayırmak ve 1024 boyutlu L2-normalize `BAAI/bge-m3` vektörleriyle PostgreSQL
   `rag_cloud_documents` + `rag_document_chunks` tablolarına kaydetmek.
2. Buluttan silinen bir döküman dosyasını (`bulut_dosya_id` veya `cloud_file_id` üzerinden) tüm vektör parçalarıyla
   birlikte PostgreSQL `pgvector` RAG veritabanından anında ve kalıcı olarak kaldırmak.
3. Sohbet ve belge analizi sırasında 1024d `BAAI/bge-m3` pgvector kosinüs benzerliği + pg_trgm hibrit RAG araması sunmak.
"""
from __future__ import annotations
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from app.core.logger import gateway_logger
from app.repositories.postgres_db import postgres_db
from app.services.document_service import DocumentService
from app.services.embedding_service import (
    BGE_M3_DIMENSIONS,
    BGE_M3_MODEL_ID,
    EmbeddingService,
    embedding_service,
)


SUPPORTED_RAG_EXTENSIONS = (
    ".pdf",
    ".doc",
    ".docx",
    ".txt",
    ".md",
    ".csv",
    ".xlsx",
    ".xls",
    ".pptx",
    ".rtf",
    ".json",
)

SUPPORTED_RAG_MIME_PREFIXES = (
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/rtf",
    "text/",
    "application/json",
)


class RagDocumentService:
    """
    Bulut dökümanlarının PostgreSQL (pgvector) RAG veritabanına otomatik aktarılmasını (ingest),
    buluttan kaldırıldığında otomatik silinmesini (purge) ve anlamsal aranmasını yöneten servis.
    """

    def __init__(self) -> None:
        self._doc_service = DocumentService()
        self._null_backfill_checked = False

    @staticmethod
    def is_supported_rag_document(file_name: str, mime_type: str = "") -> bool:
        """Verilen dosya adı veya MIME türünün RAG indekslemesine uygun döküman olup olmadığını döner."""
        lower_name = (file_name or "").strip().lower()
        lower_mime = (mime_type or "").strip().lower()
        if any(lower_name.endswith(ext) for ext in SUPPORTED_RAG_EXTENSIONS):
            return True
        if any(lower_mime.startswith(prefix) for prefix in SUPPORTED_RAG_MIME_PREFIXES):
            return True
        return False

    @staticmethod
    def _detect_section_header(line: str) -> Optional[str]:
        """Satırın bir tablo veya bölüm başlığı olup olmadığını tespit eder."""
        clean = (line or "").strip()
        if not clean or len(clean) > 120:
            return None
        if clean.startswith("--- SAYFA"):
            return None
        if clean.startswith("#"):
            return clean.lstrip("#").strip()
        # Tamamı büyük harf olan anlamlı grup/tablo başlıkları (örn: ANKASTRE SETLER, SOLO ÜRÜNLER)
        alpha_chars = [c for c in clean if c.isalpha()]
        if (
            len(alpha_chars) >= 4
            and all(c.isupper() for c in alpha_chars)
            and ";" not in clean
            and "|" not in clean
            and not re.search(r"\d{2}[./]\d{2}[./]\d{4}", clean)
            and len(clean.split()) <= 8
        ):
            return clean
        return None

    @staticmethod
    def _is_table_row(line: str) -> bool:
        """Satırın bir tablo veya CSV/pipe satırı olup olmadığını döner."""
        clean = (line or "").strip()
        if "|" in clean and clean.count("|") >= 2:
            return True
        if ";" in clean and clean.count(";") >= 2:
            return True
        if "\t" in clean and clean.count("\t") >= 2:
            return True
        return False

    @classmethod
    def _group_page_lines_into_units(
        cls,
        lines: List[str],
        initial_section: str,
        target_unit_chars: int = 380,
    ) -> Tuple[List[Dict[str, Any]], str]:
        """Sayfa satırlarını başlık ve tablo bütünlüğünü koruyarak semantik alt bloklara ayırır."""
        units: List[Dict[str, Any]] = []
        active_sec = initial_section
        buf_lines: List[str] = []
        buf_len = 0
        buf_sec = active_sec
        buf_is_table = False

        for ln in lines:
            hdr = cls._detect_section_header(ln)
            is_tbl = cls._is_table_row(ln)
            if hdr:
                if buf_lines:
                    units.append(
                        {
                            "section": buf_sec,
                            "lines": list(buf_lines),
                            "text": "\n".join(buf_lines),
                            "is_table": buf_is_table,
                        }
                    )
                    buf_lines = []
                    buf_len = 0
                active_sec = hdr
                buf_sec = active_sec
                buf_is_table = False

            ln_len = len(ln) + 1
            if buf_lines and (
                (buf_is_table != is_tbl and buf_len >= 180)
                or (buf_len + ln_len > target_unit_chars and not is_tbl)
                or (buf_len + ln_len > target_unit_chars * 2)
            ):
                units.append(
                    {
                        "section": buf_sec,
                        "lines": list(buf_lines),
                        "text": "\n".join(buf_lines),
                        "is_table": buf_is_table,
                    }
                )
                buf_lines = []
                buf_len = 0
                buf_sec = active_sec
                buf_is_table = is_tbl

            if not buf_lines:
                buf_sec = active_sec
                buf_is_table = is_tbl
            buf_lines.append(ln)
            buf_len += ln_len

        if buf_lines:
            units.append(
                {
                    "section": buf_sec,
                    "lines": list(buf_lines),
                    "text": "\n".join(buf_lines),
                    "is_table": buf_is_table,
                }
            )
        return (units, active_sec)

    @classmethod
    def split_document_into_chunks(
        cls,
        full_text: str,
        file_name: str,
        max_chunk_chars: int = 1800,
        use_semantic_chunking: Optional[bool] = None,
    ) -> Tuple[int, List[Dict[str, Any]]]:
        """
        Belge metnini sayfa (`--- SAYFA N ---`), tablo/bölüm başlıkları ve `BAAI/bge-m3`
        anlamsal geçiş noktalarını (Semantic Chunking) koruyarak anlamlı RAG parçalarına ayırır.
        Asla satır ortasından bölmez.
        Dönüş: `(toplam_sayfa_sayisi, chunk_listesi)`
        """
        cleaned_text = (full_text or "").strip()
        if not cleaned_text:
            return (0, [])

        semantic_enabled = (
            embedding_service.is_semantic_chunking_enabled()
            if use_semantic_chunking is None
            else bool(use_semantic_chunking)
        )

        # Sayfa bloklarını ayır
        page_splits = re.split(r"(?m)^---\s*SAYFA\s+(\d+)\s*---\s*$", cleaned_text)
        pages: List[Tuple[int, str]] = []
        if len(page_splits) > 1:
            leading = page_splits[0].strip()
            if leading:
                pages.append((1, leading))
            idx = 1
            while idx + 1 < len(page_splits):
                try:
                    p_no = int(page_splits[idx])
                except Exception:
                    p_no = len(pages) + 1
                p_body = page_splits[idx + 1].strip()
                if p_body:
                    pages.append((p_no, p_body))
                idx += 2
        else:
            pages.append((1, cleaned_text))

        page_count = max((p[0] for p in pages), default=1)
        chunks: List[Dict[str, Any]] = []
        global_chunk_idx = 0
        active_section = "Genel"

        # 1. Tüm sayfaların mantıksal bloklarını (units) çıkar ve semantik vektör adaylarını tek batch'te topla
        page_entries: List[Tuple[int, List[Dict[str, Any]]]] = []
        semantic_texts: List[str] = []
        semantic_slices: Dict[int, Tuple[int, int]] = {}

        for page_no, page_text in pages:
            lines = [ln.rstrip() for ln in page_text.splitlines() if ln.strip()]
            if not lines:
                continue

            units, active_section = cls._group_page_lines_into_units(lines, active_section)
            if not units:
                continue

            entry_idx = len(page_entries)
            page_entries.append((page_no, units))
            total_page_chars = sum(len(u["text"]) for u in units)
            if semantic_enabled and len(units) >= 3 and total_page_chars > (max_chunk_chars * 0.75):
                start_offset = len(semantic_texts)
                for u in units:
                    semantic_texts.append(f"{u['section']}: {u['text']}")
                semantic_slices[entry_idx] = (start_offset, len(semantic_texts))

        batched_semantic_vectors: Optional[List[List[float]]] = None
        if semantic_texts:
            try:
                vecs, used_prov = embedding_service.embed_texts(
                    semantic_texts,
                    preferred_provider="hf-space",
                    allow_fallback=False,
                )
                if used_prov != "lexical-1024-fallback" and len(vecs) == len(semantic_texts):
                    batched_semantic_vectors = vecs
            except Exception:
                batched_semantic_vectors = None

        for entry_idx, (page_no, units) in enumerate(page_entries):
            unit_vectors: Optional[List[List[float]]] = None
            if batched_semantic_vectors is not None and entry_idx in semantic_slices:
                s_start, s_end = semantic_slices[entry_idx]
                slice_vecs = batched_semantic_vectors[s_start:s_end]
                if len(slice_vecs) == len(units):
                    unit_vectors = slice_vecs

            current_lines: List[str] = []
            current_len = 0
            chunk_section = units[0]["section"]

            for u_idx, unit in enumerate(units):
                u_lines = unit["lines"]
                u_len = len(unit["text"]) + 1
                u_sec = unit["section"]

                semantic_break = False
                if (
                    unit_vectors is not None
                    and u_idx > 0
                    and current_len >= 450
                    and not unit["is_table"]
                ):
                    sim = EmbeddingService.cosine_similarity(
                        unit_vectors[u_idx - 1],
                        unit_vectors[u_idx],
                    )
                    if sim < 0.56:
                        semantic_break = True

                section_break = (u_sec != chunk_section and current_len >= 500)
                size_break = bool(current_lines and (current_len + u_len > max_chunk_chars))

                if current_lines and (size_break or semantic_break or section_break):
                    header_prefix = f"[Belge: {file_name} | Sayfa: {page_no} | Bölüm: {chunk_section}]\n"
                    chunk_body = header_prefix + "\n".join(current_lines)
                    chunks.append(
                        {
                            "chunk_index": global_chunk_idx,
                            "page_number": page_no,
                            "section_title": chunk_section,
                            "content": chunk_body,
                            "token_count": DocumentService.estimate_tokens(chunk_body),
                        }
                    )
                    global_chunk_idx += 1
                    overlap = current_lines[-1:] if len(current_lines[-1]) < 240 and size_break else []
                    current_lines = list(overlap)
                    current_len = sum(len(x) + 1 for x in current_lines)
                    chunk_section = u_sec

                # Tek bir birim tek başına max_chunk_chars'tan büyükse (örn. dev tablo bloğu) satır bazlı böl
                if u_len > max_chunk_chars:
                    for ln in u_lines:
                        ln_len = len(ln) + 1
                        if current_lines and (current_len + ln_len > max_chunk_chars):
                            header_prefix = f"[Belge: {file_name} | Sayfa: {page_no} | Bölüm: {chunk_section}]\n"
                            chunk_body = header_prefix + "\n".join(current_lines)
                            chunks.append(
                                {
                                    "chunk_index": global_chunk_idx,
                                    "page_number": page_no,
                                    "section_title": chunk_section,
                                    "content": chunk_body,
                                    "token_count": DocumentService.estimate_tokens(chunk_body),
                                }
                            )
                            global_chunk_idx += 1
                            overlap = current_lines[-1:] if len(current_lines[-1]) < 240 else []
                            current_lines = list(overlap)
                            current_len = sum(len(x) + 1 for x in current_lines)
                        current_lines.append(ln)
                        current_len += ln_len
                else:
                    if not current_lines:
                        chunk_section = u_sec
                    current_lines.extend(u_lines)
                    current_len += u_len

            if current_lines:
                header_prefix = f"[Belge: {file_name} | Sayfa: {page_no} | Bölüm: {chunk_section}]\n"
                chunk_body = header_prefix + "\n".join(current_lines)
                chunks.append(
                    {
                        "chunk_index": global_chunk_idx,
                        "page_number": page_no,
                        "section_title": chunk_section,
                        "content": chunk_body,
                        "token_count": DocumentService.estimate_tokens(chunk_body),
                    }
                )
                global_chunk_idx += 1

        return (page_count, chunks)

    def ingest_cloud_document(
        self,
        file_name: str,
        base64_data: Optional[str] = None,
        raw_bytes: Optional[bytes] = None,
        extracted_text: Optional[str] = None,
        app_id: str = "WEBAKUS_ERP",
        firma_id: int = 0,
        user_id: str = "",
        bulut_dosya_id: int = 0,
        cloud_file_id: str = "",
        provider: str = "google",
        belge_turu: str = "Genel",
        belge_id: int = 0,
        belge_no: str = "",
        mime_type: str = "",
        file_size: int = 0,
        conversation_id: str = "",
    ) -> Dict[str, Any]:
        """
        Buluta yüklenen dökümanı metne çözümler, sayfa/bölüm bazlı parçalara (chunk) ayırır,
        384 boyutlu vektörlerini hesaplar ve PostgreSQL `rag_cloud_documents` ile
        `rag_document_chunks` tablolarına kaydeder (varsa eski kaydı günceller).
        """
        clean_name = (file_name or "belge.txt").strip()
        norm_app = (app_id or "WEBAKUS_ERP").strip().upper()
        norm_cloud_id = (cloud_file_id or "").strip()
        norm_bulut_id = int(bulut_dosya_id or 0)
        norm_firma_id = int(firma_id or 0)

        if not self.is_supported_rag_document(clean_name, mime_type):
            return {
                "status": "skipped",
                "reason": f"Desteklenmeyen dosya türü: {clean_name} ({mime_type})",
                "file_name": clean_name,
            }

        resolved_bytes: Optional[bytes] = raw_bytes
        if resolved_bytes is None and base64_data:
            clean_b64 = DocumentService._strip_data_url_header(base64_data)
            resolved_bytes = DocumentService._decode_base64_bytes(clean_b64)

        final_text = (extracted_text or "").strip()
        if not final_text and resolved_bytes is not None:
            final_text = self._doc_service.extract_text_from_bytes(clean_name, resolved_bytes).strip()

        if not final_text:
            return {
                "status": "empty",
                "reason": "Belgeden okunabilir metin çıkarılamadı.",
                "file_name": clean_name,
            }

        effective_size = int(file_size or (len(resolved_bytes) if resolved_bytes else len(final_text.encode("utf-8"))))
        content_hash = hashlib.sha256(final_text.encode("utf-8")).hexdigest()
        page_count, chunks = self.split_document_into_chunks(final_text, clean_name)
        total_tokens = DocumentService.estimate_tokens(final_text)
        now_iso = datetime.now(timezone.utc).isoformat()
        doc_id = f"ragdoc_{uuid.uuid4().hex[:18]}"

        # Veritabanı kilidi açmadan önce tüm chunk vektörlerini online BAAI/bge-m3 (1024d) + Proxy Pool üzerinden toplu (batch) hesapla
        chunk_embed_inputs = [
            f"{clean_name} | {chk['section_title']}\n{chk['content']}"
            for chk in chunks
        ]
        chunk_vectors, embedding_provider_used = embedding_service.embed_texts(
            chunk_embed_inputs,
            preferred_provider="hf-space",
            allow_fallback=True,
        )

        with postgres_db.rag_connection() as conn:
            # Aynı bulut dosyasına ait önceki indeks kayıtlarını temizle (Upsert)
            existing_ids: List[str] = []
            if norm_bulut_id > 0:
                rows = conn.execute(
                    """
                    SELECT id FROM rag_cloud_documents
                    WHERE app_id = ? AND firma_id = ? AND bulut_dosya_id = ?
                    """,
                    (norm_app, norm_firma_id, norm_bulut_id),
                ).fetchall()
                existing_ids.extend(r["id"] for r in rows)
            elif norm_cloud_id:
                rows = conn.execute(
                    """
                    SELECT id FROM rag_cloud_documents
                    WHERE app_id = ? AND firma_id = ? AND cloud_file_id = ?
                    """,
                    (norm_app, norm_firma_id, norm_cloud_id),
                ).fetchall()
                for r in rows:
                    if r["id"] not in existing_ids:
                        existing_ids.append(r["id"])

            for old_id in existing_ids:
                conn.execute("DELETE FROM rag_document_chunks WHERE cloud_doc_id = ?", (old_id,))
                conn.execute("DELETE FROM rag_cloud_documents WHERE id = ?", (old_id,))

            if norm_bulut_id > 0:
                conn.execute(
                    "DELETE FROM rag_document_chunks WHERE app_id = ? AND firma_id = ? AND bulut_dosya_id = ?",
                    (norm_app, norm_firma_id, norm_bulut_id),
                )
            elif norm_cloud_id:
                conn.execute(
                    "DELETE FROM rag_document_chunks WHERE app_id = ? AND firma_id = ? AND cloud_file_id = ?",
                    (norm_app, norm_firma_id, norm_cloud_id),
                )

            conn.execute(
                """
                INSERT INTO rag_cloud_documents (
                    id, app_id, firma_id, user_id, bulut_dosya_id, cloud_file_id,
                    provider, belge_turu, belge_id, belge_no, file_name, mime_type,
                    file_size, content_hash, page_count, total_chunks, total_tokens,
                    char_count, embedding_model, embedding_provider, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'indexed', ?, ?)
                """,
                (
                    doc_id,
                    norm_app,
                    norm_firma_id,
                    str(user_id or ""),
                    norm_bulut_id,
                    norm_cloud_id,
                    str(provider or "google").lower(),
                    str(belge_turu or "Genel"),
                    int(belge_id or 0),
                    str(belge_no or "-"),
                    clean_name,
                    str(mime_type or "application/octet-stream"),
                    effective_size,
                    content_hash,
                    page_count,
                    len(chunks),
                    total_tokens,
                    len(final_text),
                    BGE_M3_MODEL_ID,
                    embedding_provider_used,
                    now_iso,
                    now_iso,
                ),
            )

            for idx_chk, chk in enumerate(chunks):
                chk_id = f"ragchk_{uuid.uuid4().hex[:18]}"
                chk_content = chk["content"]
                emb_str = EmbeddingService.to_pgvector_str(chunk_vectors[idx_chk])
                meta_json = json.dumps(
                    {
                        "cloud_doc_id": doc_id,
                        "bulut_dosya_id": norm_bulut_id,
                        "cloud_file_id": norm_cloud_id,
                        "provider": str(provider or "google").lower(),
                        "belge_turu": str(belge_turu or "Genel"),
                        "belge_id": int(belge_id or 0),
                        "page_number": chk["page_number"],
                        "section_title": chk["section_title"],
                        "embedding_model": BGE_M3_MODEL_ID,
                        "embedding_provider": embedding_provider_used,
                        "dimensions": BGE_M3_DIMENSIONS,
                    },
                    ensure_ascii=False,
                )
                conn.execute(
                    """
                    INSERT INTO rag_document_chunks (
                        id, cloud_doc_id, app_id, firma_id, bulut_dosya_id, cloud_file_id,
                        conversation_id, message_id, file_name, section_title,
                        page_number, chunk_index, content, token_count,
                        embedding, metadata_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        chk_id,
                        doc_id,
                        norm_app,
                        norm_firma_id,
                        norm_bulut_id,
                        norm_cloud_id,
                        conversation_id or "",
                        clean_name,
                        chk["section_title"],
                        chk["page_number"],
                        chk["chunk_index"],
                        chk_content,
                        chk["token_count"],
                        emb_str,
                        meta_json,
                        now_iso,
                    ),
                )

        gateway_logger.info(
            f"RAG_DOCUMENT_INGESTED | doc_id={doc_id} | app={norm_app} | firma={norm_firma_id} "
            f"| bulut_dosya_id={norm_bulut_id} | cloud_file_id={norm_cloud_id} "
            f"| file={clean_name} | pages={page_count} | chunks={len(chunks)} | tokens={total_tokens} "
            f"| model={BGE_M3_MODEL_ID} | emb_provider={embedding_provider_used}"
        )
        return {
            "status": "indexed",
            "doc_id": doc_id,
            "app_id": norm_app,
            "firma_id": norm_firma_id,
            "bulut_dosya_id": norm_bulut_id,
            "cloud_file_id": norm_cloud_id,
            "file_name": clean_name,
            "page_count": page_count,
            "total_chunks": len(chunks),
            "total_tokens": total_tokens,
            "char_count": len(final_text),
            "content_hash": content_hash,
            "embedding_model": BGE_M3_MODEL_ID,
            "embedding_provider": embedding_provider_used,
            "dimensions": BGE_M3_DIMENSIONS,
            "proxy_pool_stats": embedding_service.get_proxy_pool_stats(),
        }

    def delete_cloud_document(
        self,
        app_id: str = "WEBAKUS_ERP",
        firma_id: Optional[int] = None,
        bulut_dosya_id: Optional[int] = None,
        cloud_file_id: Optional[str] = None,
        doc_id: Optional[str] = None,
        file_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Buluttan kaldırılan dökümanı ve ona ait tüm `rag_document_chunks` vektör kayıtlarını
        PostgreSQL `thinkport_db` veritabanından kalıcı olarak siler.
        """
        norm_app = (app_id or "WEBAKUS_ERP").strip().upper()
        deleted_docs = 0
        deleted_chunks = 0
        matched_doc_ids: List[str] = []

        with postgres_db.rag_connection() as conn:
            if doc_id and doc_id.strip():
                rows = conn.execute(
                    "SELECT id FROM rag_cloud_documents WHERE id = ?",
                    (doc_id.strip(),),
                ).fetchall()
                matched_doc_ids.extend(r["id"] for r in rows)

            if bulut_dosya_id is not None and int(bulut_dosya_id) > 0:
                if firma_id is not None and int(firma_id) > 0:
                    rows = conn.execute(
                        "SELECT id FROM rag_cloud_documents WHERE app_id = ? AND firma_id = ? AND bulut_dosya_id = ?",
                        (norm_app, int(firma_id), int(bulut_dosya_id)),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT id FROM rag_cloud_documents WHERE bulut_dosya_id = ?",
                        (int(bulut_dosya_id),),
                    ).fetchall()
                for r in rows:
                    if r["id"] not in matched_doc_ids:
                        matched_doc_ids.append(r["id"])

            if cloud_file_id and cloud_file_id.strip():
                rows = conn.execute(
                    "SELECT id FROM rag_cloud_documents WHERE cloud_file_id = ?",
                    (cloud_file_id.strip(),),
                ).fetchall()
                for r in rows:
                    if r["id"] not in matched_doc_ids:
                        matched_doc_ids.append(r["id"])

            if not matched_doc_ids and file_name and file_name.strip():
                if firma_id is not None and int(firma_id) > 0:
                    rows = conn.execute(
                        "SELECT id FROM rag_cloud_documents WHERE app_id = ? AND firma_id = ? AND LOWER(file_name) = LOWER(?)",
                        (norm_app, int(firma_id), file_name.strip()),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT id FROM rag_cloud_documents WHERE app_id = ? AND LOWER(file_name) = LOWER(?)",
                        (norm_app, file_name.strip()),
                    ).fetchall()
                for r in rows:
                    if r["id"] not in matched_doc_ids:
                        matched_doc_ids.append(r["id"])

            for mid in matched_doc_ids:
                res_chk = conn.execute(
                    "DELETE FROM rag_document_chunks WHERE cloud_doc_id = ?",
                    (mid,),
                )
                deleted_chunks += res_chk.rowcount
                res_doc = conn.execute(
                    "DELETE FROM rag_cloud_documents WHERE id = ?",
                    (mid,),
                )
                deleted_docs += res_doc.rowcount

            # Doğrudan bulut_dosya_id veya cloud_file_id ile kalan parça varsa temizle
            if bulut_dosya_id is not None and int(bulut_dosya_id) > 0:
                res_extra = conn.execute(
                    "DELETE FROM rag_document_chunks WHERE bulut_dosya_id = ?",
                    (int(bulut_dosya_id),),
                )
                deleted_chunks += res_extra.rowcount

            if cloud_file_id and cloud_file_id.strip():
                res_extra = conn.execute(
                    "DELETE FROM rag_document_chunks WHERE cloud_file_id = ?",
                    (cloud_file_id.strip(),),
                )
                deleted_chunks += res_extra.rowcount

        gateway_logger.info(
            f"RAG_DOCUMENT_DELETED | app={norm_app} | firma={firma_id} "
            f"| bulut_dosya_id={bulut_dosya_id} | cloud_file_id={cloud_file_id} "
            f"| deleted_docs={deleted_docs} | deleted_chunks={deleted_chunks}"
        )
        return {
            "status": "deleted",
            "deleted_documents": deleted_docs,
            "deleted_chunks": deleted_chunks,
            "matched_doc_ids": matched_doc_ids,
        }

    def rename_cloud_document(
        self,
        new_file_name: str,
        app_id: str = "WEBAKUS_ERP",
        firma_id: Optional[int] = None,
        bulut_dosya_id: Optional[int] = None,
        cloud_file_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Bulutta yeniden adlandırılan bir dosyanın RAG kayıtlarındaki dosya adını günceller."""
        clean_new = (new_file_name or "").strip()
        if not clean_new:
            return {"status": "skipped", "updated": 0}

        now_iso = datetime.now(timezone.utc).isoformat()
        updated = 0
        with postgres_db.rag_connection() as conn:
            if bulut_dosya_id is not None and int(bulut_dosya_id) > 0:
                res = conn.execute(
                    "UPDATE rag_cloud_documents SET file_name = ?, updated_at = ? WHERE bulut_dosya_id = ?",
                    (clean_new, now_iso, int(bulut_dosya_id)),
                )
                updated += res.rowcount
                conn.execute(
                    "UPDATE rag_document_chunks SET file_name = ? WHERE bulut_dosya_id = ?",
                    (clean_new, int(bulut_dosya_id)),
                )
            elif cloud_file_id and cloud_file_id.strip():
                res = conn.execute(
                    "UPDATE rag_cloud_documents SET file_name = ?, updated_at = ? WHERE cloud_file_id = ?",
                    (clean_new, now_iso, cloud_file_id.strip()),
                )
                updated += res.rowcount
                conn.execute(
                    "UPDATE rag_document_chunks SET file_name = ? WHERE cloud_file_id = ?",
                    (clean_new, cloud_file_id.strip()),
                )
        return {
            "status": "renamed",
            "file_name": clean_new,
            "updated_documents": updated,
        }

    def _ensure_null_embeddings_backfilled(self) -> None:
        """
        `vector(384)` -> `vector(1024)` şema yükseltmesi sonrası `embedding IS NULL` kalan
        eski chunk satırları varsa, bunları veritabanındaki `content` metinlerinden otomatik olarak
        1024 boyutlu `BAAI/bge-m3` vektörleriyle doldurur (buluttan dosya indirmeye gerek kalmaz).
        """
        if self._null_backfill_checked:
            return
        try:
            with postgres_db.rag_connection() as conn:
                null_rows = conn.execute(
                    """
                    SELECT id, cloud_doc_id, file_name, section_title, content
                    FROM rag_document_chunks
                    WHERE embedding IS NULL
                    ORDER BY created_at ASC
                    LIMIT 250
                    """
                ).fetchall()
            if not null_rows:
                self._null_backfill_checked = True
                return

            inputs = [
                f"{r['file_name']} | {r['section_title']}\n{r['content']}"
                for r in null_rows
            ]
            vecs, used_provider = embedding_service.embed_texts(inputs, allow_fallback=True)
            doc_ids = {str(r["cloud_doc_id"]) for r in null_rows if r["cloud_doc_id"]}
            now_iso = datetime.now(timezone.utc).isoformat()

            with postgres_db.rag_connection() as conn:
                for idx_r, r in enumerate(null_rows):
                    emb_str = EmbeddingService.to_pgvector_str(vecs[idx_r])
                    conn.execute(
                        "UPDATE rag_document_chunks SET embedding = ? WHERE id = ?",
                        (emb_str, r["id"]),
                    )
                for did in doc_ids:
                    conn.execute(
                        """
                        UPDATE rag_cloud_documents
                        SET embedding_model = ?, embedding_provider = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (BGE_M3_MODEL_ID, used_provider, now_iso, did),
                    )

                rem = conn.execute(
                    "SELECT COUNT(1) AS c FROM rag_document_chunks WHERE embedding IS NULL"
                ).fetchone()["c"]
                if int(rem or 0) == 0:
                    self._null_backfill_checked = True

            gateway_logger.info(
                f"RAG_BGE_M3_BACKFILL | updated_chunks={len(null_rows)} | provider={used_provider}"
            )
        except Exception as exc:
            gateway_logger.warning(f"RAG null embedding backfill uyarısı: {exc}")

    @staticmethod
    def _strip_chunk_header_prefix(raw_chunk_content: str) -> str:
        """Eski veya yeni chunk metninin başındaki `[Belge: ...]` / `[Dosya: ...]` üstbilgi satırını temizler."""
        text = (raw_chunk_content or "").strip()
        while True:
            cleaned = re.sub(r"^\[(?:Belge|Dosya):[^\n]+\]\n?", "", text).strip()
            if cleaned == text:
                break
            text = cleaned
        return text

    @classmethod
    def _reconstruct_clean_page_text(cls, chunk_bodies: List[str]) -> str:
        """
        Aynı sayfaya ait ardışık chunk metinlerini birleştirirken eski overlap (örtüşme)
        satırlarını tekilleştirerek orijinal sayfa metnini temiz şekilde geri üretir.
        """
        merged_lines: List[str] = []
        for raw_body in chunk_bodies:
            clean_body = cls._strip_chunk_header_prefix(raw_body)
            if not clean_body:
                continue
            lines = [ln.rstrip() for ln in clean_body.splitlines() if ln.strip()]
            if not lines:
                continue
            if merged_lines:
                # Önceki chunk'ın son 1-3 satırı ile yeni chunk'ın ilk satırları örtüşüyorsa tekilleştir
                max_check = min(3, len(merged_lines), len(lines))
                overlap_count = 0
                for k in range(max_check, 0, -1):
                    if merged_lines[-k:] == lines[:k]:
                        overlap_count = k
                        break
                lines = lines[overlap_count:]
            merged_lines.extend(lines)
        return "\n".join(merged_lines).strip()

    def reindex_cloud_documents(
        self,
        app_id: str = "WEBAKUS_ERP",
        firma_id: Optional[int] = None,
        only_fallback: bool = False,
    ) -> Dict[str, Any]:
        """
        PostgreSQL `rag_cloud_documents` ve `rag_document_chunks` tablosunda kayıtlı tüm dökümanları
        Google Drive / OneDrive'dan tekrar indirmeye gerek kalmadan aktif `BAAI/bge-m3` (1024d)
        sağlayıcısıyla hem yeniden semantik parçalar (chunking) hem de yeniden vektörleştirir.
        """
        norm_app = (app_id or "WEBAKUS_ERP").strip().upper()
        doc_clauses = ["d.app_id = ?"]
        params: List[Any] = [norm_app]
        if firma_id is not None and int(firma_id) > 0:
            doc_clauses.append("(d.firma_id = ? OR d.firma_id = 0)")
            params.append(int(firma_id))
        if only_fallback:
            doc_clauses.append(
                "(COALESCE(d.embedding_provider, '') IN ('', 'lexical-1024-fallback') "
                "OR EXISTS (SELECT 1 FROM rag_document_chunks c WHERE c.cloud_doc_id = d.id AND c.embedding IS NULL))"
            )

        where_sql = " AND ".join(doc_clauses)
        with postgres_db.rag_connection() as conn:
            docs = conn.execute(
                f"""
                SELECT d.*
                FROM rag_cloud_documents d
                WHERE {where_sql}
                ORDER BY d.updated_at ASC
                """,
                tuple(params),
            ).fetchall()

        if not docs:
            return {
                "ok": True,
                "status": "up_to_date",
                "reindexed_documents": 0,
                "reindexed_chunks": 0,
                "updated_documents": 0,
                "updated_chunks": 0,
                "embedding_model": BGE_M3_MODEL_ID,
            }

        total_reindexed_docs = 0
        total_reindexed_chunks = 0
        last_provider_used = "hf-space"
        now_iso = datetime.now(timezone.utc).isoformat()

        for doc in docs:
            doc_id = str(doc["id"])
            clean_name = str(doc["file_name"] or "belge.txt")
            with postgres_db.rag_connection() as conn:
                old_chunks = conn.execute(
                    """
                    SELECT page_number, chunk_index, content
                    FROM rag_document_chunks
                    WHERE cloud_doc_id = ?
                    ORDER BY page_number ASC, chunk_index ASC
                    """,
                    (doc_id,),
                ).fetchall()

            if not old_chunks:
                continue

            pages_map: Dict[int, List[str]] = {}
            for oc in old_chunks:
                pno = max(1, int(oc["page_number"] or 1))
                body_txt = self._strip_chunk_header_prefix(str(oc["content"] or ""))
                if body_txt:
                    pages_map.setdefault(pno, []).append(body_txt)

            reconstructed_pages = [
                self._reconstruct_clean_page_text(pages_map[p])
                for p in sorted(pages_map.keys())
                if pages_map[p]
            ]
            reconstructed_text = "\f".join(p for p in reconstructed_pages if p).strip()
            if not reconstructed_text:
                continue

            page_count, new_chunks = self.split_document_into_chunks(reconstructed_text, clean_name)
            if not new_chunks:
                continue

            chunk_embed_inputs = [
                f"{clean_name} | {chk['section_title']}\n{chk['content']}"
                for chk in new_chunks
            ]
            chunk_vectors, used_provider = embedding_service.embed_texts(
                chunk_embed_inputs,
                preferred_provider="hf-space",
                allow_fallback=True,
            )
            last_provider_used = used_provider
            total_tokens = sum(int(chk["token_count"]) for chk in new_chunks)

            with postgres_db.rag_connection() as conn:
                conn.execute("DELETE FROM rag_document_chunks WHERE cloud_doc_id = ?", (doc_id,))
                for idx_chk, chk in enumerate(new_chunks):
                    chk_id = f"ragchk_{uuid.uuid4().hex[:18]}"
                    emb_str = EmbeddingService.to_pgvector_str(chunk_vectors[idx_chk])
                    meta_json = json.dumps(
                        {
                            "cloud_doc_id": doc_id,
                            "bulut_dosya_id": int(doc["bulut_dosya_id"] or 0),
                            "cloud_file_id": str(doc["cloud_file_id"] or ""),
                            "provider": str(doc["provider"] or "google").lower(),
                            "belge_turu": str(doc["belge_turu"] or "Genel"),
                            "belge_id": int(doc["belge_id"] or 0),
                            "page_number": chk["page_number"],
                            "section_title": chk["section_title"],
                            "embedding_model": BGE_M3_MODEL_ID,
                            "embedding_provider": used_provider,
                            "dimensions": BGE_M3_DIMENSIONS,
                        },
                        ensure_ascii=False,
                    )
                    conn.execute(
                        """
                        INSERT INTO rag_document_chunks (
                            id, cloud_doc_id, app_id, firma_id, bulut_dosya_id, cloud_file_id,
                            conversation_id, message_id, file_name, section_title,
                            page_number, chunk_index, content, token_count,
                            embedding, metadata_json, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, '', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            chk_id,
                            doc_id,
                            str(doc["app_id"] or norm_app),
                            int(doc["firma_id"] or 0),
                            int(doc["bulut_dosya_id"] or 0),
                            str(doc["cloud_file_id"] or ""),
                            clean_name,
                            chk["section_title"],
                            chk["page_number"],
                            chk["chunk_index"],
                            chk["content"],
                            chk["token_count"],
                            emb_str,
                            meta_json,
                            now_iso,
                        ),
                    )
                conn.execute(
                    """
                    UPDATE rag_cloud_documents
                    SET page_count = ?, total_chunks = ?, total_tokens = ?,
                        embedding_model = ?, embedding_provider = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        page_count,
                        len(new_chunks),
                        total_tokens,
                        BGE_M3_MODEL_ID,
                        used_provider,
                        now_iso,
                        doc_id,
                    ),
                )

            total_reindexed_docs += 1
            total_reindexed_chunks += len(new_chunks)

        # Üst dökümanı olmayan yetim (orphan) eski chunk kayıtları varsa tamamen temizle
        with postgres_db.rag_connection() as conn:
            conn.execute(
                """
                DELETE FROM rag_document_chunks
                WHERE cloud_doc_id NOT IN (SELECT id FROM rag_cloud_documents)
                """
            )

        proxy_stats = embedding_service.get_proxy_pool_stats()
        self._null_backfill_checked = True
        gateway_logger.info(
            f"RAG_DOCUMENTS_REINDEXED | app={norm_app} | docs={total_reindexed_docs} "
            f"| chunks={total_reindexed_chunks} | model={BGE_M3_MODEL_ID} | provider={last_provider_used} "
            f"| proxied_requests={proxy_stats.get('total_proxied_requests', 0)}"
        )
        return {
            "ok": True,
            "status": "reindexed",
            "reindexed_documents": total_reindexed_docs,
            "reindexed_chunks": total_reindexed_chunks,
            "updated_documents": total_reindexed_docs,
            "updated_chunks": total_reindexed_chunks,
            "embedding_model": BGE_M3_MODEL_ID,
            "embedding_provider": last_provider_used,
            "provider": last_provider_used,
            "dimensions": BGE_M3_DIMENSIONS,
            "proxy_pool_stats": proxy_stats,
        }

    def search_cloud_documents(
        self,
        query: str,
        app_id: str = "WEBAKUS_ERP",
        firma_id: Optional[int] = None,
        bulut_dosya_id: Optional[int] = None,
        cloud_file_id: Optional[str] = None,
        file_name: Optional[str] = None,
        belge_turu: Optional[str] = None,
        section_filter: Optional[str] = None,
        strategy: Optional[str] = "HIBRIT_VEKTOR_KELIME",
        min_score: Optional[float] = None,
        preserve_table_order: bool = True,
        top_k: int = 8,
    ) -> Dict[str, Any]:
        """
        PostgreSQL `rag_document_chunks` ve `rag_cloud_documents` üzerinde 1024 boyutlu
        `BAAI/bge-m3` pgvector kosinüs benzerliği + anahtar kelime (ILIKE) + bölüm/tablo odaklı hibrit arama yapar.
        """
        self._ensure_null_embeddings_backfilled()

        clean_query = (query or "").strip()
        effective_k = max(1, min(25, int(top_k or 8)))
        norm_app = (app_id or "WEBAKUS_ERP").strip().upper()
        norm_strategy = (strategy or "HIBRIT_VEKTOR_KELIME").strip().upper()
        clean_section = (section_filter or "").strip()
        query_vec, query_provider = embedding_service.embed_query_pgvector(
            f"{clean_section} {clean_query}".strip() or "belge"
        )

        base_clauses: List[str] = ["c.app_id = ?", "c.embedding IS NOT NULL"]
        base_filter_params: List[Any] = [norm_app]

        if firma_id is not None and int(firma_id) > 0:
            base_clauses.append("(c.firma_id = ? OR c.firma_id = 0)")
            base_filter_params.append(int(firma_id))
        if bulut_dosya_id is not None and int(bulut_dosya_id) > 0:
            base_clauses.append("c.bulut_dosya_id = ?")
            base_filter_params.append(int(bulut_dosya_id))
        if cloud_file_id and cloud_file_id.strip():
            base_clauses.append("c.cloud_file_id = ?")
            base_filter_params.append(cloud_file_id.strip())
        if file_name and file_name.strip():
            base_clauses.append("c.file_name ILIKE ?")
            base_filter_params.append(f"%{file_name.strip()}%")
        if belge_turu and belge_turu.strip():
            base_clauses.append("d.belge_turu ILIKE ?")
            base_filter_params.append(f"%{belge_turu.strip()}%")

        def _fetch_rows(conn: Any, with_section: bool) -> List[Dict[str, Any]]:
            clauses = list(base_clauses)
            filter_params = list(base_filter_params)
            if with_section and clean_section:
                clauses.append("(c.section_title ILIKE ? OR c.content ILIKE ?)")
                like_sec = f"%{clean_section}%"
                filter_params.extend([like_sec, like_sec])

            where_sql = " AND ".join(clauses)
            fetch_limit = effective_k if norm_strategy == "TAM_DOKUMAN_PARCALARI" else min(40, effective_k * 2)

            if norm_strategy == "TAM_DOKUMAN_PARCALARI":
                sql_params = tuple([query_vec] + filter_params + [fetch_limit])
                return conn.execute(
                    f"""
                    SELECT
                        c.id AS chunk_id,
                        c.cloud_doc_id,
                        c.bulut_dosya_id,
                        c.cloud_file_id,
                        c.file_name,
                        c.section_title,
                        c.page_number,
                        c.chunk_index,
                        c.content,
                        c.token_count,
                        COALESCE(d.belge_turu, 'Genel') AS belge_turu,
                        COALESCE(d.provider, 'google') AS provider,
                        (1.0 - (c.embedding <=> ?::vector)) AS vector_score
                    FROM rag_document_chunks c
                    LEFT JOIN rag_cloud_documents d ON d.id = c.cloud_doc_id
                    WHERE {where_sql}
                    ORDER BY c.page_number ASC, c.chunk_index ASC
                    LIMIT ?
                    """,
                    sql_params,
                ).fetchall()

            sql_params = tuple([query_vec] + filter_params + [query_vec, fetch_limit])
            return conn.execute(
                f"""
                SELECT
                    c.id AS chunk_id,
                    c.cloud_doc_id,
                    c.bulut_dosya_id,
                    c.cloud_file_id,
                    c.file_name,
                    c.section_title,
                    c.page_number,
                    c.chunk_index,
                    c.content,
                    c.token_count,
                    COALESCE(d.belge_turu, 'Genel') AS belge_turu,
                    COALESCE(d.provider, 'google') AS provider,
                    (1.0 - (c.embedding <=> ?::vector)) AS vector_score
                FROM rag_document_chunks c
                LEFT JOIN rag_cloud_documents d ON d.id = c.cloud_doc_id
                WHERE {where_sql}
                ORDER BY (c.embedding <=> ?::vector) ASC, c.page_number ASC, c.chunk_index ASC
                LIMIT ?
                """,
                sql_params,
            ).fetchall()

        results: List[Dict[str, Any]] = []
        with postgres_db.rag_connection() as conn:
            rows = _fetch_rows(conn, with_section=bool(clean_section))
            if not rows and clean_section:
                rows = _fetch_rows(conn, with_section=False)

            query_tokens = [tok for tok in clean_query.lower().split() if len(tok) >= 3]
            scored_items: List[Dict[str, Any]] = []
            for r in rows:
                score = float(r.get("vector_score") or 0.0)
                content_txt = str(r.get("content") or "")
                section_txt = str(r.get("section_title") or "")
                lower_content = content_txt.lower()
                lower_section = section_txt.lower()

                if clean_query and clean_query.lower() in lower_content:
                    score = min(1.0, score + 0.25)
                elif query_tokens:
                    matched_toks = sum(1 for tok in query_tokens if tok in lower_content or tok in lower_section)
                    if matched_toks > 0:
                        score = min(1.0, score + min(0.20, matched_toks * 0.06))

                if clean_section and clean_section.lower() in lower_section:
                    score = min(1.0, score + 0.18)

                if norm_strategy == "BOLUM_VE_TABLO_ODAKLI" and (
                    "|---" in content_txt or "| ---" in content_txt or content_txt.count(" | ") >= 3
                ):
                    score = min(1.0, score + 0.15)

                scored_items.append(
                    {
                        "chunk_id": r["chunk_id"],
                        "cloud_doc_id": r["cloud_doc_id"],
                        "bulut_dosya_id": r["bulut_dosya_id"],
                        "cloud_file_id": r["cloud_file_id"],
                        "file_name": r["file_name"],
                        "belge_turu": r["belge_turu"],
                        "provider": r["provider"],
                        "section_title": section_txt,
                        "page_number": r["page_number"],
                        "chunk_index": r["chunk_index"],
                        "token_count": r["token_count"],
                        "similarity_score": round(score, 4),
                        "content": content_txt,
                    }
                )

            if norm_strategy != "TAM_DOKUMAN_PARCALARI":
                scored_items.sort(key=lambda x: x["similarity_score"], reverse=True)
                if min_score is not None and float(min_score) > 0:
                    threshold = float(min_score)
                    filtered = [it for it in scored_items if it["similarity_score"] >= threshold]
                    if filtered:
                        scored_items = filtered
                results = scored_items[:effective_k]
                if preserve_table_order or norm_strategy == "BOLUM_VE_TABLO_ODAKLI":
                    results.sort(
                        key=lambda x: (
                            int(x.get("bulut_dosya_id") or 0),
                            int(x.get("page_number") or 0),
                            int(x.get("chunk_index") or 0),
                        )
                    )
            else:
                results = scored_items[:effective_k]

        return {
            "app_id": norm_app,
            "query": clean_query,
            "strategy": norm_strategy,
            "embedding_model": BGE_M3_MODEL_ID,
            "embedding_provider": query_provider,
            "total_found": len(results),
            "results": results,
        }

    def list_cloud_documents(
        self,
        app_id: str = "WEBAKUS_ERP",
        firma_id: Optional[int] = None,
        provider: Optional[str] = None,
        belge_turu: Optional[str] = None,
        search: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """PostgreSQL RAG veritabanında indekslenmiş tüm bulut dökümanlarını listeler."""
        norm_app = (app_id or "WEBAKUS_ERP").strip().upper()
        clauses = ["app_id = ?"]
        params: List[Any] = [norm_app]

        if firma_id is not None and int(firma_id) > 0:
            clauses.append("(firma_id = ? OR firma_id = 0)")
            params.append(int(firma_id))
        if provider and provider.strip():
            clauses.append("LOWER(provider) = LOWER(?)")
            params.append(provider.strip())
        if belge_turu and belge_turu.strip():
            clauses.append("LOWER(belge_turu) = LOWER(?)")
            params.append(belge_turu.strip())
        if search and search.strip():
            clauses.append("file_name ILIKE ?")
            params.append(f"%{search.strip()}%")

        where_sql = " AND ".join(clauses)
        with postgres_db.rag_connection() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    id, app_id, firma_id, user_id, bulut_dosya_id, cloud_file_id,
                    provider, belge_turu, belge_id, belge_no, file_name, mime_type,
                    file_size, content_hash, page_count, total_chunks, total_tokens,
                    char_count, embedding_model, embedding_provider, status, created_at, updated_at
                FROM rag_cloud_documents
                WHERE {where_sql}
                ORDER BY updated_at DESC
                """,
                tuple(params),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_cloud_document_by_bulut_id(
        self,
        bulut_dosya_id: int,
        firma_id: Optional[int] = None,
        app_id: str = "WEBAKUS_ERP",
        include_chunks: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """`BulutDosya.Id` (veya `firma_id`) üzerinden RAG'daki dökümanı ve chunk'larından birleştirilmiş metnini döner."""
        norm_app = (app_id or "WEBAKUS_ERP").strip().upper()
        with postgres_db.rag_connection() as conn:
            if firma_id is not None and int(firma_id) > 0:
                row = conn.execute(
                    """
                    SELECT * FROM rag_cloud_documents
                    WHERE app_id = ? AND (firma_id = ? OR firma_id = 0) AND bulut_dosya_id = ?
                    ORDER BY updated_at DESC LIMIT 1
                    """,
                    (norm_app, int(firma_id), int(bulut_dosya_id)),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT * FROM rag_cloud_documents
                    WHERE bulut_dosya_id = ?
                    ORDER BY updated_at DESC LIMIT 1
                    """,
                    (int(bulut_dosya_id),),
                ).fetchone()

            if not row:
                return None

            doc_dict = dict(row)
            chk_rows = conn.execute(
                """
                SELECT id, page_number, chunk_index, section_title, content, token_count
                FROM rag_document_chunks
                WHERE cloud_doc_id = ?
                ORDER BY chunk_index ASC
                """,
                (doc_dict["id"],),
            ).fetchall()
            chunk_list = [dict(c) for c in chk_rows]
            doc_dict["full_text"] = "\n\n".join(str(c.get("content") or "") for c in chunk_list).strip()
            if include_chunks:
                doc_dict["chunks"] = chunk_list
            return doc_dict


rag_document_service = RagDocumentService()
