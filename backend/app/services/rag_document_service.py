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
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
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

# Süreç (veya Uvicorn --reload) başlatılma zamanı; bundan eski kalmış 'indexing' DB satırları yetim sayılır.
_SERVER_BOOT_UTC = datetime.now(timezone.utc)


class RagDocumentService:
    """
    Bulut dökümanlarının PostgreSQL (pgvector) RAG veritabanına otomatik aktarılmasını (ingest),
    buluttan kaldırıldığında otomatik silinmesini (purge) ve anlamsal aranmasını yöneten servis.
    """

    def __init__(self) -> None:
        self._doc_service = DocumentService()
        self._null_backfill_checked = False
        self._jobs_lock = threading.RLock()
        self._active_jobs: Dict[str, Dict[str, Any]] = {}
        self._doc_locks: Dict[str, threading.Lock] = {}

    @staticmethod
    def _parse_iso_utc(raw_ts: Any) -> Optional[datetime]:
        """ISO-8601 zaman damgasını UTC datetime nesnesine çevirir."""
        txt = str(raw_ts or "").strip()
        if not txt:
            return None
        try:
            if txt.endswith("Z"):
                txt = txt[:-1] + "+00:00"
            dt = datetime.fromisoformat(txt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            return None

    @staticmethod
    def _build_healed_orphan_state(row: Dict[str, Any], now_iso: str) -> Dict[str, Any]:
        """Önceki sunucu sürecinde yarıda kalmış 'indexing' satırı için güvenli kurtarma durumu üretir."""
        t_chunks = int(row.get("total_chunks") or 0)
        if t_chunks > 0:
            return {
                "status": "indexed",
                "indexing_stage": "indexed",
                "indexing_progress": 100,
                "status_detail": "Mevcut RAG indeksi hazır (önceki güncelleme sunucu yeniden başlatmasıyla kesildi).",
                "updated_at": now_iso,
            }
        return {
            "status": "not_indexed",
            "indexing_stage": "not_indexed",
            "indexing_progress": 0,
            "status_detail": "Önceki indeksleme sunucu yeniden başlatması nedeniyle kesildi; yeniden başlatılmaya hazır.",
            "updated_at": now_iso,
        }

    @staticmethod
    def _persist_healed_orphans(updates: List[Tuple[str, str, int, str, str, str]]) -> None:
        """Yeniden başlatma sonrası yetim kalmış 'indexing' satırlarını PostgreSQL'de iyileştirir."""
        if not updates:
            return
        try:
            with postgres_db.rag_connection() as conn:
                for status_val, stage_val, prog_val, detail_val, ts_val, doc_id in updates:
                    if not doc_id:
                        continue
                    conn.execute(
                        """
                        UPDATE rag_cloud_documents
                        SET status = ?,
                            indexing_stage = ?,
                            indexing_progress = ?,
                            status_detail = ?,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (status_val, stage_val, prog_val, detail_val, ts_val, doc_id),
                    )
                    gateway_logger.info(
                        f"RAG_ORPHAN_INDEXING_HEALED | doc_id={doc_id} | new_status={status_val}"
                    )
        except Exception as exc:
            gateway_logger.warning(f"RAG_ORPHAN_HEAL_WARN | err={exc}")

    @staticmethod
    def _build_job_key(
        app_id: str = "WEBAKUS_ERP",
        firma_id: int = 0,
        bulut_dosya_id: int = 0,
        cloud_file_id: str = "",
        file_name: str = "",
    ) -> str:
        norm_app = (app_id or "WEBAKUS_ERP").strip().upper()
        norm_firma = int(firma_id or 0)
        norm_bulut = int(bulut_dosya_id or 0)
        if norm_bulut > 0:
            return f"{norm_app}:{norm_firma}:{norm_bulut}"
        ident = (cloud_file_id or file_name or "unknown").strip()
        return f"cloud:{norm_app}:{norm_firma}:{ident}"

    def _get_doc_lock(self, job_key: str) -> threading.Lock:
        with self._jobs_lock:
            lock = self._doc_locks.get(job_key)
            if lock is None:
                lock = threading.Lock()
                self._doc_locks[job_key] = lock
            return lock

    def _update_job_progress(
        self,
        job_key: str,
        *,
        app_id: str = "WEBAKUS_ERP",
        firma_id: int = 0,
        user_id: str = "",
        bulut_dosya_id: int = 0,
        cloud_file_id: str = "",
        provider: str = "google",
        belge_turu: str = "Genel",
        belge_id: int = 0,
        belge_no: str = "-",
        file_name: str = "",
        mime_type: str = "",
        file_size: int = 0,
        status: str = "indexing",
        indexing_stage: str = "queued",
        indexing_progress: int = 0,
        status_detail: str = "",
        page_count: Optional[int] = None,
        total_chunks: Optional[int] = None,
        chunking_mode: str = "",
        chunking_agent_kod: str = "",
        chunking_model: str = "",
        persist_to_db: bool = True,
    ) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        with self._jobs_lock:
            prev = self._active_jobs.get(job_key) or {}
            started_at = prev.get("started_at") if status == "indexing" else prev.get("started_at", now_iso)
            if not started_at:
                started_at = now_iso
            entry = {
                "job_key": job_key,
                "app_id": (app_id or "WEBAKUS_ERP").strip().upper(),
                "firma_id": int(firma_id or 0),
                "bulut_dosya_id": int(bulut_dosya_id or 0),
                "cloud_file_id": (cloud_file_id or "").strip(),
                "file_name": file_name or prev.get("file_name") or "",
                "status": status,
                "indexing_stage": indexing_stage,
                "indexing_progress": max(0, min(100, int(indexing_progress))),
                "status_detail": status_detail,
                "page_count": page_count if page_count is not None else prev.get("page_count", 0),
                "total_chunks": total_chunks if total_chunks is not None else prev.get("total_chunks", 0),
                "chunking_mode": chunking_mode or prev.get("chunking_mode", ""),
                "chunking_agent_kod": chunking_agent_kod or prev.get("chunking_agent_kod", ""),
                "chunking_model": chunking_model or prev.get("chunking_model", ""),
                "started_at": started_at,
                "updated_at": now_iso,
            }
            self._active_jobs[job_key] = entry

        if not persist_to_db or int(bulut_dosya_id or 0) <= 0:
            return

        norm_app = entry["app_id"]
        norm_firma = entry["firma_id"]
        norm_bulut = entry["bulut_dosya_id"]
        try:
            with postgres_db.rag_connection() as conn:
                existing = conn.execute(
                    """
                    SELECT id FROM rag_cloud_documents
                    WHERE app_id = ? AND firma_id = ? AND bulut_dosya_id = ?
                    ORDER BY updated_at DESC LIMIT 1
                    """,
                    (norm_app, norm_firma, norm_bulut),
                ).fetchone()
                if existing:
                    conn.execute(
                        """
                        UPDATE rag_cloud_documents
                        SET status = ?,
                            indexing_stage = ?,
                            indexing_progress = ?,
                            status_detail = ?,
                            chunking_mode = CASE WHEN ? <> '' THEN ? ELSE chunking_mode END,
                            chunking_agent_kod = CASE WHEN ? <> '' THEN ? ELSE chunking_agent_kod END,
                            chunking_model = CASE WHEN ? <> '' THEN ? ELSE chunking_model END,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            status,
                            indexing_stage,
                            entry["indexing_progress"],
                            status_detail,
                            entry["chunking_mode"],
                            entry["chunking_mode"],
                            entry["chunking_agent_kod"],
                            entry["chunking_agent_kod"],
                            entry["chunking_model"],
                            entry["chunking_model"],
                            now_iso,
                            existing["id"],
                        ),
                    )
                elif status == "indexing":
                    stub_id = f"ragdoc_{uuid.uuid4().hex[:18]}"
                    conn.execute(
                        """
                        INSERT INTO rag_cloud_documents (
                            id, app_id, firma_id, user_id, bulut_dosya_id, cloud_file_id,
                            provider, belge_turu, belge_id, belge_no, file_name, mime_type,
                            file_size, content_hash, page_count, total_chunks, total_tokens,
                            char_count, embedding_model, embedding_provider,
                            status, indexing_stage, indexing_progress, status_detail,
                            chunking_mode, chunking_agent_kod, chunking_model,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 0, 0, 0, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            stub_id,
                            norm_app,
                            norm_firma,
                            str(user_id or ""),
                            norm_bulut,
                            (cloud_file_id or "").strip(),
                            str(provider or "google").lower(),
                            str(belge_turu or "Genel"),
                            int(belge_id or 0),
                            str(belge_no or "-"),
                            file_name or f"BulutDosya_{norm_bulut}",
                            str(mime_type or "application/octet-stream"),
                            int(file_size or 0),
                            int(page_count or 1),
                            BGE_M3_MODEL_ID,
                            status,
                            indexing_stage,
                            entry["indexing_progress"],
                            status_detail,
                            entry["chunking_mode"],
                            entry["chunking_agent_kod"],
                            entry["chunking_model"],
                            now_iso,
                            now_iso,
                        ),
                    )
        except Exception as exc:
            gateway_logger.warning(f"RAG durum güncelleme uyarısı (bulut_dosya_id={norm_bulut}): {exc}")

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

    # ─── RAG-CHUNK-UZMANI (DB Tabanlı Ajan Güdümlü Yapısal Parçalama) ─────────

    MAX_CHUNK_AGENT_WINDOW_LINES = 75
    MAX_CHUNK_AGENT_WINDOW_CHARS = 9600
    MAX_CHUNK_AGENT_PARALLEL_WORKERS = 1
    MAX_AGENT_SECTION_CHUNK_CHARS = 3800

    @staticmethod
    def _parse_document_pages_and_lines(full_text: str) -> Tuple[int, List[Dict[str, Any]]]:
        """Belge metnini `--- SAYFA N ---` belirteçlerine göre 1-tabanlı `[L{idx}]` satır dizisine çevirir."""
        cleaned_text = (full_text or "").strip()
        if not cleaned_text:
            return (0, [])

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
        all_lines: List[Dict[str, Any]] = []
        line_idx = 1
        for page_no, page_body in pages:
            for raw_line in page_body.splitlines():
                stripped = raw_line.rstrip()
                if not stripped.strip():
                    continue
                all_lines.append({"idx": line_idx, "page": page_no, "text": stripped})
                line_idx += 1
        return (page_count, all_lines)

    @staticmethod
    def _load_chunk_uzmani_agent_config(agent_code: str = "RAG-CHUNK-UZMANI") -> Optional[Dict[str, Any]]:
        """
        PostgreSQL `webakus_db."AiAjanlar"` tablosundan aktif chunk uzmanının derlenmiş `SistemIstemi`,
        birincil model ve alternatif model yapılandırmasını okur (kod içinde statik prompt tutulmaz).
        """
        try:
            with postgres_db.rag_connection() as conn:
                row = conn.execute(
                    """
                    SELECT
                        "Id", "Kod", "Ad", "SistemIstemi", "ModelAdi",
                        "AlternatifModellerJson", "Sicaklik", "MaxTokens"
                    FROM "AiAjanlar"
                    WHERE NOT "SilindiMi"
                      AND "AktifMi"
                      AND UPPER("Kod") = UPPER(?)
                    ORDER BY "Id" ASC
                    LIMIT 1
                    """,
                    (agent_code.strip(),),
                ).fetchone()
            if not row:
                return None

            sistem_istemi = str(row.get("SistemIstemi") or "").strip()
            if not sistem_istemi:
                return None

            alt_models: List[str] = []
            raw_alt = row.get("AlternatifModellerJson")
            if raw_alt:
                try:
                    parsed_alt = json.loads(raw_alt) if isinstance(raw_alt, str) else raw_alt
                    if isinstance(parsed_alt, list):
                        alt_models = [str(m).strip() for m in parsed_alt if str(m).strip()]
                except Exception:
                    alt_models = []

            return {
                "id": int(row.get("Id") or 0),
                "kod": str(row.get("Kod") or agent_code).strip(),
                "ad": str(row.get("Ad") or agent_code).strip(),
                "sistem_istemi": sistem_istemi,
                "model_adi": str(row.get("ModelAdi") or "gpt-4o").strip(),
                "alternatif_modeller": alt_models,
                "sicaklik": float(row.get("Sicaklik") if row.get("Sicaklik") is not None else 0.1),
                "max_tokens": int(row.get("MaxTokens") or 16384),
            }
        except Exception as exc:
            gateway_logger.warning(f"RAG-CHUNK-UZMANI DB okuma uyarısı: {exc}")
            return None

    @staticmethod
    def _extract_json_object_from_llm(raw_text: str) -> Optional[Dict[str, Any]]:
        """LLM yanıtından markdown kod bloklarını temizleyerek JSON nesnesini ayrıştırır."""
        cleaned = (raw_text or "").strip()
        if not cleaned:
            return None
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"\s*```$", "", cleaned)
            cleaned = cleaned.strip()

        for candidate in (cleaned,):
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass

        first_brace = cleaned.find("{")
        last_brace = cleaned.rfind("}")
        if first_brace >= 0 and last_brace > first_brace:
            try:
                parsed = json.loads(cleaned[first_brace : last_brace + 1])
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                return None
        return None

    @staticmethod
    def _parse_line_index_value(val: Any, tag_val: Any = None) -> Optional[int]:
        if isinstance(val, int):
            return val
        if isinstance(val, float):
            return int(val)
        for src in (val, tag_val):
            if src is None:
                continue
            m = re.search(r"(\d+)", str(src))
            if m:
                try:
                    return int(m.group(1))
                except Exception:
                    continue
        return None

    @classmethod
    def _normalize_window_sections(
        cls,
        raw_sections: List[Dict[str, Any]],
        w_start: int,
        w_end: int,
    ) -> List[Dict[str, Any]]:
        """
        Ajan tarafından döndürülen `[baslangicIndeks..bitisIndeks]` aralıklarını doğrular;
        çakışma veya boşluk varsa `[w_start..w_end]` aralığını %100 kayıpsız kapsayacak şekilde onarır.
        """
        candidates: List[Dict[str, Any]] = []
        for idx_item, item in enumerate(raw_sections or []):
            if not isinstance(item, dict):
                continue
            s_val = cls._parse_line_index_value(
                item.get("baslangicIndeks"), item.get("baslangicEtiketi")
            )
            e_val = cls._parse_line_index_value(
                item.get("bitisIndeks"), item.get("bitisEtiketi")
            )
            if s_val is None and e_val is None:
                continue
            if s_val is None:
                s_val = e_val
            if e_val is None:
                e_val = s_val
            assert s_val is not None and e_val is not None
            if e_val < s_val:
                s_val, e_val = e_val, s_val
            if e_val < w_start or s_val > w_end:
                continue
            s_clamped = max(w_start, min(w_end, s_val))
            e_clamped = max(s_clamped, min(w_end, e_val))

            raw_kw = item.get("anahtarKavramlar")
            keywords = (
                [str(k).strip() for k in raw_kw if str(k).strip()]
                if isinstance(raw_kw, list)
                else []
            )
            candidates.append(
                {
                    "sira": int(item.get("sira") or (idx_item + 1)),
                    "bolum_kodu": str(item.get("bolumKodu") or "").strip(),
                    "baslik": str(item.get("baslik") or "").strip() or "Belge Bölümü",
                    "ust_baslik": str(item.get("ustBaslik") or "").strip(),
                    "yapi_turu": str(item.get("yapiTuru") or "DUZ_YAZI").strip().upper(),
                    "sayisal_veri_icerir_mi": bool(item.get("sayisalVeriIcerirMi", False)),
                    "onceki_bolumun_devami_mi": bool(item.get("oncekiBolumunDevamiMi", False)),
                    "anahtar_kavramlar": keywords,
                    "sinir_gerekcesi": str(item.get("sinirGerekcesi") or "").strip(),
                    "start": s_clamped,
                    "end": e_clamped,
                }
            )

        if not candidates:
            return []

        candidates.sort(key=lambda x: (x["start"], x["end"]))
        repaired: List[Dict[str, Any]] = []
        cursor = w_start
        for cand in candidates:
            s = max(cand["start"], cursor)
            e = min(cand["end"], w_end)
            if s > cursor:
                if repaired:
                    repaired[-1]["end"] = s - 1
                else:
                    s = cursor
            if e < s:
                continue
            entry = dict(cand)
            entry["start"] = s
            entry["end"] = e
            repaired.append(entry)
            cursor = e + 1

        if not repaired:
            return []
        if cursor <= w_end:
            repaired[-1]["end"] = w_end
        return repaired

    @classmethod
    def _invoke_chunk_uzmani_llm(
        cls,
        agent_cfg: Dict[str, Any],
        user_payload_text: str,
    ) -> Tuple[Optional[Dict[str, Any]], str, str]:
        """ThinkPort model yönlendiricisi üzerinden `RAG-CHUNK-UZMANI` çağrısını tekrarsız üst akış zinciriyle çalıştırır."""
        from app.core.dependencies import llm_provider_service, model_service

        candidate_models: List[str] = []
        for raw_m in [agent_cfg.get("model_adi")] + list(agent_cfg.get("alternatif_modeller") or []):
            clean_m = str(raw_m or "").strip()
            if clean_m and clean_m not in candidate_models:
                candidate_models.append(clean_m)
        if "gpt-4o" not in candidate_models:
            candidate_models.append("gpt-4o")

        messages = [
            {"role": "system", "content": agent_cfg["sistem_istemi"]},
            {"role": "user", "content": user_payload_text},
        ]
        temp = float(agent_cfg.get("sicaklik") if agent_cfg.get("sicaklik") is not None else 0.1)
        max_tok = int(agent_cfg.get("max_tokens") or 16384)

        tried_upstreams: set[str] = set()
        last_used_model = ""
        last_finish_reason = "stop"

        for candidate in candidate_models:
            normalized = model_service.normalize_model_id(candidate)
            web_def = model_service.find_web_model(normalized)
            if web_def:
                raw_web = str(web_def.web_model or "openai-fast")
                eff_upstream = (
                    "openai-fast"
                    if raw_web in ("openai", "gemini", "claude-hybridspace", "deepseek-r1", "openai-fast")
                    else raw_web
                )
                upstream_key = f"pollinations:{eff_upstream}"
            else:
                upstream_key = f"ollama:{normalized}"

            # Aynı gerçek üst akışa (ör. Pollinations openai-fast) çözümlenen yedek takma adları tekrarlama
            if upstream_key in tried_upstreams:
                continue
            tried_upstreams.add(upstream_key)

            delta_buf: List[str] = []
            finish_reason_holder: List[str] = ["stop"]

            def _on_delta(txt: str) -> None:
                if txt:
                    delta_buf.append(txt)

            def _on_finish(fr: str) -> None:
                if fr:
                    finish_reason_holder[-1] = fr

            ok = False
            used_model_label = normalized
            try:
                if web_def:
                    used_model_label = web_def.id
                    ok = llm_provider_service.stream_from_pollinations_web(
                        web_def.web_model or "openai-fast",
                        messages,
                        _on_delta,
                        requested_model_id=web_def.id,
                        response_format={"type": "json_object"},
                        temperature=temp,
                        max_tokens=max_tok,
                        on_finish_reason=_on_finish,
                    )
                    if not ok and web_def.fallback_local:
                        fb_local = model_service.select_best_local_model(web_def.fallback_local)
                        fb_key = f"ollama:{fb_local}" if fb_local else ""
                        if fb_local and fb_key not in tried_upstreams:
                            tried_upstreams.add(fb_key)
                            delta_buf.clear()
                            used_model_label = fb_local
                            ok = llm_provider_service.stream_from_ollama(
                                fb_local,
                                messages,
                                _on_delta,
                                response_format={"type": "json_object"},
                                temperature=temp,
                                max_tokens=max_tok,
                                on_finish_reason=_on_finish,
                            )
                else:
                    ok = llm_provider_service.stream_from_ollama(
                        normalized,
                        messages,
                        _on_delta,
                        response_format={"type": "json_object"},
                        temperature=temp,
                        max_tokens=max_tok,
                        on_finish_reason=_on_finish,
                    )
            except Exception as exc:
                gateway_logger.warning(
                    f"RAG_CHUNK_UZMANI_MODEL_WARN | model={candidate} | err={exc}"
                )
                ok = False

            if not ok:
                continue

            raw_text = "".join(delta_buf)
            last_used_model = used_model_label
            last_finish_reason = finish_reason_holder[-1]

            parsed = cls._extract_json_object_from_llm(raw_text)
            if parsed and isinstance(parsed.get("bolumler"), list) and len(parsed["bolumler"]) > 0:
                return (parsed, used_model_label, last_finish_reason)

            raw_preview = re.sub(r"\s+", " ", raw_text)[:180]
            gateway_logger.warning(
                f"RAG_CHUNK_UZMANI_PARSE_WARN | model={used_model_label} | finish={last_finish_reason} "
                f"| len={len(raw_text)} | preview={raw_preview!r}"
            )

        return (None, last_used_model, last_finish_reason)

    @classmethod
    def _split_with_chunk_uzmani_agent(
        cls,
        full_text: str,
        file_name: str,
        belge_turu: str = "Genel",
        progress_cb: Optional[Callable[[int, str, str], None]] = None,
    ) -> Optional[Tuple[int, List[Dict[str, Any]], Dict[str, Any]]]:
        """
        Veritabanındaki `RAG-CHUNK-UZMANI` ajanını kullanarak belge satırlarını yapısal ve anlamsal
        bölüm sınırlarına göre %100 kayıpsız RAG parçalarına ayırır.
        Ajan ulaşılamazsa `None` döner (üst katman güvenli deterministik yedek parçalamaya geçer).
        """
        agent_cfg = cls._load_chunk_uzmani_agent_config("RAG-CHUNK-UZMANI")
        if not agent_cfg:
            return None

        page_count, all_lines = cls._parse_document_pages_and_lines(full_text)
        if not all_lines:
            return None

        total_lines = len(all_lines)
        windows: List[List[Dict[str, Any]]] = []
        curr_win: List[Dict[str, Any]] = []
        curr_chars = 0
        for ln in all_lines:
            ln_len = len(ln["text"]) + 24
            if curr_win and (
                len(curr_win) >= cls.MAX_CHUNK_AGENT_WINDOW_LINES
                or curr_chars + ln_len > cls.MAX_CHUNK_AGENT_WINDOW_CHARS
            ):
                windows.append(curr_win)
                curr_win = [ln]
                curr_chars = ln_len
            else:
                curr_win.append(ln)
                curr_chars += ln_len
        if curr_win:
            windows.append(curr_win)

        t_chunk_start = time.perf_counter()
        state_lock = threading.Lock()
        used_models: List[str] = []
        completed_lines = 0
        last_pct = 32

        def _notify_progress(pct: int, detail: str, model_lbl: str) -> None:
            if not progress_cb:
                return
            progress_cb(pct, detail, model_lbl)

        def _process_slice(
            slice_lines: List[Dict[str, Any]],
            slice_label: str,
            depth: int,
            local_prev_tail: Optional[Dict[str, Any]],
            context_lines: List[Dict[str, Any]],
        ) -> Optional[Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]]:
            nonlocal completed_lines, last_pct
            if not slice_lines:
                return ([], local_prev_tail)

            w_start = int(slice_lines[0]["idx"])
            w_end = int(slice_lines[-1]["idx"])

            with state_lock:
                start_pct = max(last_pct, 34)
                active_model = used_models[-1] if used_models else agent_cfg["model_adi"]
            _notify_progress(
                start_pct,
                f"{agent_cfg['kod']} ajanı belge yapısını analiz ediyor (pencere {slice_label}, satır L{w_start}-L{w_end})...",
                active_model,
            )

            header_meta: Dict[str, Any] = {
                "dosyaAdi": file_name,
                "belgeTuru": belge_turu,
                "toplamBelgeSatiri": total_lines,
                "pencere": slice_label,
                "aralik": f"L{w_start}..L{w_end}",
            }
            if local_prev_tail:
                header_meta["oncekiPencereSonBolum"] = local_prev_tail
            if context_lines:
                header_meta["oncekiPencereSonSatirlar"] = context_lines

            formatted_lines = [
                f"[L{item['idx']}] [Sayfa {item['page']}] {item['text']}"
                for item in slice_lines
            ]
            user_payload = (
                json.dumps(header_meta, ensure_ascii=False)
                + "\n\n"
                + "\n".join(formatted_lines)
            )

            parsed_json, model_used, finish_reason = cls._invoke_chunk_uzmani_llm(
                agent_cfg, user_payload
            )
            with state_lock:
                if model_used and model_used not in used_models:
                    used_models.append(model_used)
                active_model = used_models[-1] if used_models else agent_cfg["model_adi"]

            repaired = (
                cls._normalize_window_sections(
                    parsed_json.get("bolumler") or [], w_start, w_end
                )
                if parsed_json
                else []
            )
            if not repaired:
                # Çıktı sınırı ('length') veya ayrıştırma hatasında alt pencereyi adaptif olarak ikiye böl
                if len(slice_lines) > 15 and depth < 3:
                    mid = len(slice_lines) // 2
                    gateway_logger.info(
                        f"RAG_CHUNK_UZMANI_BISECT | file={file_name} | window={slice_label} "
                        f"| aralik=L{w_start}..L{w_end} | reason={finish_reason or 'parse_fail'} "
                        f"| split={mid}+{len(slice_lines) - mid}"
                    )
                    left_res = _process_slice(
                        slice_lines[:mid],
                        f"{slice_label}.1",
                        depth + 1,
                        local_prev_tail,
                        context_lines,
                    )
                    if left_res is None:
                        return None
                    left_secs, left_tail = left_res
                    right_res = _process_slice(
                        slice_lines[mid:],
                        f"{slice_label}.2",
                        depth + 1,
                        left_tail,
                        [],
                    )
                    if right_res is None:
                        return None
                    right_secs, right_tail = right_res
                    return (left_secs + right_secs, right_tail or left_tail)

                gateway_logger.warning(
                    f"RAG_CHUNK_UZMANI_WINDOW_FAILED | file={file_name} | window={slice_label} "
                    f"| aralik=L{w_start}..L{w_end} | finish={finish_reason}"
                )
                return None

            with state_lock:
                completed_lines += len(slice_lines)
                done_pct = min(59, max(last_pct, 32 + int((completed_lines / max(1, total_lines)) * 27)))
                last_pct = done_pct
            _notify_progress(
                done_pct,
                f"{agent_cfg['kod']} ajanı belge bölümlerini analiz ediyor ({completed_lines}/{total_lines} satır)...",
                active_model,
            )

            last_sec = repaired[-1]
            tail_meta = {
                "baslik": last_sec["baslik"],
                "ustBaslik": last_sec["ust_baslik"],
                "yapiTuru": last_sec["yapi_turu"],
                "bitisIndeks": last_sec["end"],
            }
            return (repaired, tail_meta)

        def _run_window(
            win_idx: int,
            initial_prev_tail: Optional[Dict[str, Any]] = None,
        ) -> Optional[Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]]:
            win_lines = windows[win_idx]
            lookbehind_lines: List[Dict[str, Any]] = []
            if win_idx > 0:
                lookbehind_lines = [
                    {
                        "indeks": int(pl["idx"]),
                        "sayfa": int(pl["page"]),
                        "metin": pl["text"][:280],
                    }
                    for pl in windows[win_idx - 1][-5:]
                ]
            return _process_slice(
                win_lines,
                f"{win_idx + 1}/{len(windows)}",
                0,
                initial_prev_tail,
                lookbehind_lines,
            )

        workers = min(cls.MAX_CHUNK_AGENT_PARALLEL_WORKERS, len(windows))
        if workers <= 1:
            window_outputs: List[Optional[List[Dict[str, Any]]]] = []
            running_tail: Optional[Dict[str, Any]] = None
            for i in range(len(windows)):
                res_pair = _run_window(i, running_tail)
                if res_pair is None:
                    window_outputs.append(None)
                    break
                win_secs, running_tail = res_pair
                window_outputs.append(win_secs)
            if len(window_outputs) != len(windows):
                return None
        else:
            with ThreadPoolExecutor(max_workers=workers) as executor:
                raw_pairs = list(executor.map(lambda idx: _run_window(idx, None), range(len(windows))))
                window_outputs = [p[0] if p is not None else None for p in raw_pairs]

        if any(out is None for out in window_outputs):
            return None

        all_sections: List[Dict[str, Any]] = []
        for sec_list in window_outputs:
            for sec in sec_list or []:
                prev = all_sections[-1] if all_sections else None
                same_title = bool(
                    prev and prev["baslik"].strip().lower() == sec["baslik"].strip().lower()
                )
                same_type = bool(prev and prev["yapi_turu"] == sec["yapi_turu"])
                is_contiguous = bool(prev and sec["start"] == prev["end"] + 1)
                generic_cont = bool(
                    prev
                    and sec.get("onceki_bolumun_devami_mi")
                    and sec["baslik"].strip().lower() in ("belge bölümü", "devam", "")
                )
                if prev and (
                    (sec.get("onceki_bolumun_devami_mi") and (same_type or same_title or generic_cont))
                    or (same_title and same_type and is_contiguous)
                ):
                    prev["end"] = sec["end"]
                    for kw in sec.get("anahtar_kavramlar") or []:
                        if kw not in prev["anahtar_kavramlar"]:
                            prev["anahtar_kavramlar"].append(kw)
                else:
                    all_sections.append(dict(sec))

        gateway_logger.info(
            f"RAG_CHUNK_UZMANI_WINDOWS_DONE | file={file_name} | windows={len(windows)} "
            f"| workers={workers} | sections={len(all_sections)} "
            f"| elapsed_ms={int((time.perf_counter() - t_chunk_start) * 1000)}"
        )

        chunks: List[Dict[str, Any]] = []
        global_chunk_idx = 0
        for sec in all_sections:
            s_idx = int(sec["start"])
            e_idx = int(sec["end"])
            sec_lines = all_lines[s_idx - 1 : e_idx]
            if not sec_lines:
                continue

            raw_title = (sec["baslik"] or sec["ust_baslik"] or "Belge Bölümü").strip()
            section_title = re.sub(r"\s+", " ", raw_title)[:160]

            # Tek bölüm vektör penceresi için çok uzunsa yalnızca satır sınırlarından alt parçalara böl
            sub_groups: List[List[Dict[str, Any]]] = []
            curr_sub: List[Dict[str, Any]] = []
            curr_sub_len = 0
            for ln in sec_lines:
                ln_text = ln["text"]
                if curr_sub and curr_sub_len + len(ln_text) + 1 > cls.MAX_AGENT_SECTION_CHUNK_CHARS:
                    sub_groups.append(curr_sub)
                    curr_sub = [ln]
                    curr_sub_len = len(ln_text)
                else:
                    curr_sub.append(ln)
                    curr_sub_len += len(ln_text) + 1
            if curr_sub:
                sub_groups.append(curr_sub)

            for part_idx, grp in enumerate(sub_groups):
                first_page = int(grp[0]["page"])
                last_page = int(grp[-1]["page"])
                body = "\n".join(item["text"] for item in grp)
                header_prefix = f"[Belge: {file_name} | Sayfa: {first_page} | Bölüm: {section_title}]\n"
                chunk_body = header_prefix + body
                chunks.append(
                    {
                        "chunk_index": global_chunk_idx,
                        "page_number": first_page,
                        "section_title": section_title,
                        "content": chunk_body,
                        "token_count": DocumentService.estimate_tokens(chunk_body),
                        "agent_meta": {
                            "chunking_mode": "rag_chunk_uzmani",
                            "chunking_agent_kod": agent_cfg["kod"],
                            "chunking_model": used_models[0] if len(used_models) == 1 else ", ".join(used_models),
                            "bolum_kodu": sec.get("bolum_kodu") or "",
                            "ust_baslik": sec.get("ust_baslik") or "",
                            "yapi_turu": sec.get("yapi_turu") or "DUZ_YAZI",
                            "sayisal_veri_icerir_mi": bool(sec.get("sayisal_veri_icerir_mi", False)),
                            "onceki_bolumun_devami_mi": bool(sec.get("onceki_bolumun_devami_mi", False)) or part_idx > 0,
                            "anahtar_kavramlar": sec.get("anahtar_kavramlar") or [],
                            "sinir_gerekcesi": sec.get("sinir_gerekcesi") or "",
                            "baslangic_indeks": int(grp[0]["idx"]),
                            "bitis_indeks": int(grp[-1]["idx"]),
                            "sayfa_no_bitis": last_page,
                            "parca_sira": part_idx + 1,
                            "parca_toplam": len(sub_groups),
                        },
                    }
                )
                global_chunk_idx += 1

        if not chunks:
            return None

        agent_summary = {
            "chunking_mode": "rag_chunk_uzmani",
            "chunking_agent_kod": agent_cfg["kod"],
            "chunking_model": used_models[0] if len(used_models) == 1 else ", ".join(used_models),
            "sections_count": len(all_sections),
            "total_lines": total_lines,
        }
        return (page_count, chunks, agent_summary)

    def start_async_ingest(
        self,
        file_name: str,
        base64_data: Optional[str] = None,
        raw_bytes: Optional[bytes] = None,
        extracted_text: Optional[str] = None,
        chunks: Optional[List[Dict[str, Any]]] = None,
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
        use_chunk_agent: bool = False,
    ) -> Dict[str, Any]:
        """
        Döküman indekslemesini arka planda başlatır ve istemciye anında `'indexing'` durumu döner.
        Aynı dosya halihazırda indeksleniyorsa ikinci bir iş başlatmadan mevcut aktif job'ı paylaşır.
        """
        clean_name = (file_name or "belge.txt").strip()
        norm_app = (app_id or "WEBAKUS_ERP").strip().upper()
        norm_firma_id = int(firma_id or 0)
        norm_bulut_id = int(bulut_dosya_id or 0)
        norm_cloud_id = (cloud_file_id or "").strip()

        if not self.is_supported_rag_document(clean_name, mime_type):
            return {
                "status": "skipped",
                "reason": f"Desteklenmeyen dosya türü: {clean_name} ({mime_type})",
                "file_name": clean_name,
            }

        job_key = self._build_job_key(
            app_id=norm_app,
            firma_id=norm_firma_id,
            bulut_dosya_id=norm_bulut_id,
            cloud_file_id=norm_cloud_id,
            file_name=clean_name,
        )
        doc_lock = self._get_doc_lock(job_key)
        if doc_lock.locked():
            with self._jobs_lock:
                existing_job = dict(self._active_jobs.get(job_key) or {})
            return {
                "status": existing_job.get("status") or "indexing",
                "already_running": True,
                "bulut_dosya_id": norm_bulut_id,
                "file_name": clean_name,
                "indexing_stage": existing_job.get("indexing_stage") or "chunking_agent",
                "indexing_progress": existing_job.get("indexing_progress") or 10,
                "status_detail": existing_job.get("status_detail") or f"'{clean_name}' dosyası zaten indeksleniyor...",
            }

        self._update_job_progress(
            job_key,
            app_id=norm_app,
            firma_id=norm_firma_id,
            user_id=user_id,
            bulut_dosya_id=norm_bulut_id,
            cloud_file_id=norm_cloud_id,
            provider=provider,
            belge_turu=belge_turu,
            belge_id=belge_id,
            belge_no=belge_no,
            file_name=clean_name,
            mime_type=mime_type,
            file_size=file_size,
            status="indexing",
            indexing_stage="queued",
            indexing_progress=5,
            status_detail=f"'{clean_name}' dosyası RAG indeksleme sırasına alındı...",
            persist_to_db=True,
        )

        def _bg_worker() -> None:
            try:
                self.ingest_cloud_document(
                    file_name=clean_name,
                    base64_data=base64_data,
                    raw_bytes=raw_bytes,
                    extracted_text=extracted_text,
                    chunks=chunks,
                    app_id=norm_app,
                    firma_id=norm_firma_id,
                    user_id=user_id,
                    bulut_dosya_id=norm_bulut_id,
                    cloud_file_id=norm_cloud_id,
                    provider=provider,
                    belge_turu=belge_turu,
                    belge_id=belge_id,
                    belge_no=belge_no,
                    mime_type=mime_type,
                    file_size=file_size,
                    conversation_id=conversation_id,
                    use_chunk_agent=use_chunk_agent,
                )
            except Exception as bg_exc:
                gateway_logger.warning(
                    f"RAG_ASYNC_INGEST_ERR | bulut_dosya_id={norm_bulut_id} | file={clean_name} | err={bg_exc}"
                )

        t = threading.Thread(target=_bg_worker, name=f"rag-ingest-{norm_bulut_id}", daemon=True)
        t.start()

        return {
            "status": "indexing",
            "already_running": False,
            "bulut_dosya_id": norm_bulut_id,
            "file_name": clean_name,
            "indexing_stage": "queued",
            "indexing_progress": 5,
            "status_detail": f"'{clean_name}' dosyası RAG indeksleme sırasına alındı...",
        }

    def _try_reuse_recent_index(
        self,
        *,
        app_id: str,
        firma_id: int,
        bulut_dosya_id: int,
        cloud_file_id: str,
        file_name: str,
        content_hash: str,
        use_chunk_agent: bool,
        max_age_sec: int = 300,
    ) -> Optional[Dict[str, Any]]:
        """Kilit beklerken az önce tamamlanmış aynı içerik özetine sahip indeksi yeniden kullanarak çift işlemi önler."""
        with postgres_db.rag_connection() as conn:
            row = None
            if bulut_dosya_id > 0:
                row = conn.execute(
                    """
                    SELECT id, page_count, total_chunks, total_tokens, char_count, content_hash,
                           embedding_model, embedding_provider, chunking_mode, chunking_agent_kod,
                           chunking_model, updated_at
                    FROM rag_cloud_documents
                    WHERE app_id = ? AND firma_id = ? AND bulut_dosya_id = ? AND status = 'indexed'
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """,
                    (app_id, firma_id, bulut_dosya_id),
                ).fetchone()
            elif cloud_file_id:
                row = conn.execute(
                    """
                    SELECT id, page_count, total_chunks, total_tokens, char_count, content_hash,
                           embedding_model, embedding_provider, chunking_mode, chunking_agent_kod,
                           chunking_model, updated_at
                    FROM rag_cloud_documents
                    WHERE app_id = ? AND firma_id = ? AND cloud_file_id = ? AND status = 'indexed'
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """,
                    (app_id, firma_id, cloud_file_id),
                ).fetchone()
            if not row or str(row["content_hash"] or "") != content_hash:
                return None
            if use_chunk_agent and str(row["chunking_mode"] or "") != "rag_chunk_uzmani":
                return None
            try:
                upd = datetime.fromisoformat(str(row["updated_at"]).replace("Z", "+00:00"))
                if upd.tzinfo is None:
                    upd = upd.replace(tzinfo=timezone.utc)
                if (datetime.now(timezone.utc) - upd).total_seconds() > max_age_sec:
                    return None
            except Exception:
                return None

            gateway_logger.info(
                f"RAG_DOCUMENT_INGEST_REUSED | doc_id={row['id']} | bulut_dosya_id={bulut_dosya_id} "
                f"| file={file_name} | chunks={row['total_chunks']}"
            )
            return {
                "status": "indexed",
                "reused_recent_index": True,
                "doc_id": row["id"],
                "app_id": app_id,
                "firma_id": firma_id,
                "bulut_dosya_id": bulut_dosya_id,
                "cloud_file_id": cloud_file_id,
                "file_name": file_name,
                "page_count": int(row["page_count"] or 0),
                "total_chunks": int(row["total_chunks"] or 0),
                "total_tokens": int(row["total_tokens"] or 0),
                "char_count": int(row["char_count"] or 0),
                "content_hash": content_hash,
                "embedding_model": str(row["embedding_model"] or ""),
                "embedding_provider": str(row["embedding_provider"] or ""),
                "dimensions": BGE_M3_DIMENSIONS,
                "chunking_mode": str(row["chunking_mode"] or ""),
                "chunking_agent_kod": str(row["chunking_agent_kod"] or ""),
                "chunking_model": str(row["chunking_model"] or ""),
                "proxy_pool_stats": embedding_service.get_proxy_pool_stats(),
            }

    def ingest_cloud_document(
        self,
        file_name: str,
        base64_data: Optional[str] = None,
        raw_bytes: Optional[bytes] = None,
        extracted_text: Optional[str] = None,
        chunks: Optional[List[Dict[str, Any]]] = None,
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
        use_chunk_agent: bool = False,
    ) -> Dict[str, Any]:
        """
        Buluta yüklenen dökümanı metne çözümler, `RAG-CHUNK-UZMANI` ajanı (veya ajan erişilemezse
        deterministik yedek) ile sayfa/bölüm bazlı parçalara ayırır, 1024d `BAAI/bge-m3` vektörlerini
        hesaplar ve PostgreSQL `rag_cloud_documents` ile `rag_document_chunks` tablolarına kaydeder.
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

        job_key = self._build_job_key(
            app_id=norm_app,
            firma_id=norm_firma_id,
            bulut_dosya_id=norm_bulut_id,
            cloud_file_id=norm_cloud_id,
            file_name=clean_name,
        )
        doc_lock = self._get_doc_lock(job_key)
        waited_on_lock = doc_lock.locked()

        with doc_lock:
            common_job_meta = dict(
                app_id=norm_app,
                firma_id=norm_firma_id,
                user_id=user_id,
                bulut_dosya_id=norm_bulut_id,
                cloud_file_id=norm_cloud_id,
                provider=provider,
                belge_turu=belge_turu,
                belge_id=belge_id,
                belge_no=belge_no,
                file_name=clean_name,
                mime_type=mime_type,
                file_size=file_size,
            )

            try:
                if not waited_on_lock:
                    self._update_job_progress(
                        job_key,
                        **common_job_meta,
                        status="indexing",
                        indexing_stage="extracting",
                        indexing_progress=12,
                        status_detail=f"'{clean_name}' belge metni ve sayfaları ayrıştırılıyor...",
                        persist_to_db=True,
                    )

                resolved_bytes: Optional[bytes] = raw_bytes
                if resolved_bytes is None and base64_data:
                    clean_b64 = DocumentService._strip_data_url_header(base64_data)
                    resolved_bytes = DocumentService._decode_base64_bytes(clean_b64)

                has_predefined_chunks = bool(chunks and len(chunks) > 0)
                final_text = (extracted_text or "").strip()
                if not final_text and has_predefined_chunks:
                    final_text = "\n\n".join(str(c.get("content") or "") for c in (chunks or [])).strip()
                elif not final_text and resolved_bytes is not None:
                    final_text = self._doc_service.extract_text_from_bytes(clean_name, resolved_bytes).strip()

                if not final_text and not has_predefined_chunks:
                    self._update_job_progress(
                        job_key,
                        **common_job_meta,
                        status="failed",
                        indexing_stage="failed",
                        indexing_progress=0,
                        status_detail="Belgeden okunabilir metin çıkarılamadı.",
                        persist_to_db=True,
                    )
                    return {
                        "status": "empty",
                        "reason": "Belgeden okunabilir metin çıkarılamadı.",
                        "file_name": clean_name,
                    }

                effective_size = int(file_size or (len(resolved_bytes) if resolved_bytes else len(final_text.encode("utf-8"))))
                common_job_meta["file_size"] = effective_size
                content_hash = hashlib.sha256(final_text.encode("utf-8")).hexdigest()

                if waited_on_lock:
                    reused = self._try_reuse_recent_index(
                        app_id=norm_app,
                        firma_id=norm_firma_id,
                        bulut_dosya_id=norm_bulut_id,
                        cloud_file_id=norm_cloud_id,
                        file_name=clean_name,
                        content_hash=content_hash,
                        use_chunk_agent=use_chunk_agent,
                    )
                    if reused is not None:
                        return reused
                    self._update_job_progress(
                        job_key,
                        **common_job_meta,
                        status="indexing",
                        indexing_stage="extracting",
                        indexing_progress=15,
                        status_detail=f"'{clean_name}' belge metni ve sayfaları ayrıştırıldı...",
                        persist_to_db=True,
                    )

                chunking_mode = "rag_chunk_uzmani" if has_predefined_chunks else "heuristic_fallback"
                chunking_agent_kod = "RAG-CHUNK-UZMANI" if has_predefined_chunks else ""
                chunking_model = ""
                page_count = 0
                resolved_chunks: List[Dict[str, Any]] = []

                if has_predefined_chunks:
                    for idx_c, c in enumerate(chunks or []):
                        pg_num = int(c.get("page_number") or 1)
                        sec_t = str(c.get("section_title") or "Belge Bölümü").strip()
                        c_text = str(c.get("content") or "").strip()
                        meta = c.get("metadata") or c.get("agent_meta") or {}
                        c_model = meta.get("chunking_model") if isinstance(meta, dict) else None
                        if c_model and not chunking_model:
                            chunking_model = str(c_model)
                        resolved_chunks.append({
                            "chunk_index": int(c.get("chunk_index") if c.get("chunk_index") is not None else idx_c),
                            "page_number": pg_num,
                            "section_title": sec_t,
                            "content": c_text,
                            "token_count": DocumentService.estimate_tokens(c_text),
                            "agent_meta": meta if isinstance(meta, dict) else {},
                        })
                    page_count = max((chk["page_number"] for chk in resolved_chunks), default=1)
                    if not chunking_model:
                        chunking_model = "gpt-4o"
                    gateway_logger.info(
                        f"RAG_PREDEFINED_CHUNKS_RECEIVED | file={clean_name} | chunks={len(resolved_chunks)} "
                        f"| pages={page_count} | agent={chunking_agent_kod} | model={chunking_model}"
                    )
                elif use_chunk_agent:
                    self._update_job_progress(
                        job_key,
                        **common_job_meta,
                        status="indexing",
                        indexing_stage="chunking_agent",
                        indexing_progress=30,
                        status_detail="RAG-CHUNK-UZMANI ajanı belge bölüm sınırlarını analiz ediyor...",
                        chunking_mode="rag_chunk_uzmani",
                        chunking_agent_kod="RAG-CHUNK-UZMANI",
                        persist_to_db=True,
                    )

                    def _on_agent_progress(pct: int, detail: str, model_lbl: str) -> None:
                        self._update_job_progress(
                            job_key,
                            **common_job_meta,
                            status="indexing",
                            indexing_stage="chunking_agent",
                            indexing_progress=pct,
                            status_detail=detail,
                            chunking_mode="rag_chunk_uzmani",
                            chunking_agent_kod="RAG-CHUNK-UZMANI",
                            chunking_model=model_lbl,
                            persist_to_db=False,
                        )

                    agent_res = self._split_with_chunk_uzmani_agent(
                        final_text,
                        clean_name,
                        belge_turu=str(belge_turu or "Genel"),
                        progress_cb=_on_agent_progress,
                    )
                    if agent_res is not None:
                        page_count, resolved_chunks, agent_summary = agent_res
                        chunking_mode = str(agent_summary.get("chunking_mode") or "rag_chunk_uzmani")
                        chunking_agent_kod = str(agent_summary.get("chunking_agent_kod") or "RAG-CHUNK-UZMANI")
                        chunking_model = str(agent_summary.get("chunking_model") or "")
                        gateway_logger.info(
                            f"RAG_CHUNK_UZMANI_OK | file={clean_name} | bulut_dosya_id={norm_bulut_id} "
                            f"| model={chunking_model} | sections={agent_summary.get('sections_count')} "
                            f"| chunks={len(resolved_chunks)} | lines={agent_summary.get('total_lines')}"
                        )

                if not resolved_chunks:
                    self._update_job_progress(
                        job_key,
                        **common_job_meta,
                        status="indexing",
                        indexing_stage="chunking",
                        indexing_progress=45,
                        status_detail="Belge yapısal sayfa ve bölümlerine ayrıştırılıyor...",
                        chunking_mode="semantic_chunking",
                        persist_to_db=True,
                    )
                    page_count, resolved_chunks = self.split_document_into_chunks(
                        final_text,
                        clean_name,
                        use_semantic_chunking=False,
                    )

                chunks = resolved_chunks

                total_tokens = DocumentService.estimate_tokens(final_text)
                now_iso = datetime.now(timezone.utc).isoformat()
                doc_id = f"ragdoc_{uuid.uuid4().hex[:18]}"

                vec_agent = embedding_service.get_active_vector_agent_summary()
                vec_agent_kod = str(vec_agent.get("kod") or "RAG-VEKTOR-UZMANI")
                vec_provider = str(vec_agent.get("provider") or "ollama")
                vec_model = str(vec_agent.get("model_adi") or "bge-m3:latest")

                self._update_job_progress(
                    job_key,
                    **common_job_meta,
                    status="indexing",
                    indexing_stage="embedding",
                    indexing_progress=62,
                    status_detail=f"{vec_agent_kod} ({vec_provider}/{vec_model}) ile {len(chunks)} bölüm parçası vektörleştiriliyor...",
                    page_count=page_count,
                    total_chunks=len(chunks),
                    chunking_mode=chunking_mode,
                    chunking_agent_kod=chunking_agent_kod,
                    chunking_model=chunking_model,
                    persist_to_db=True,
                )

                # Büyük belgelerde kullanıcıya canlı ilerleme göstermek için BAAI/bge-m3 çağrılarını alt partiler halinde ilerlet
                chunk_embed_inputs = [
                    f"{clean_name} | {chk['section_title']}\n{chk['content']}"
                    for chk in chunks
                ]
                chunk_vectors: List[List[float]] = []
                embedding_provider_used = ""
                embed_batch_size = 20
                total_inp = len(chunk_embed_inputs)
                for b_start in range(0, total_inp, embed_batch_size):
                    sub_inputs = chunk_embed_inputs[b_start : b_start + embed_batch_size]
                    sub_vecs, sub_prov = embedding_service.embed_texts(
                        sub_inputs,
                        allow_fallback=True,
                    )
                    chunk_vectors.extend(sub_vecs)
                    if sub_prov:
                        embedding_provider_used = sub_prov
                    done_cnt = min(total_inp, b_start + len(sub_inputs))
                    pct_emb = 62 + int((done_cnt / max(1, total_inp)) * 28)
                    self._update_job_progress(
                        job_key,
                        **common_job_meta,
                        status="indexing",
                        indexing_stage="embedding",
                        indexing_progress=pct_emb,
                        status_detail=f"{vec_agent_kod} ({sub_prov or vec_provider}/{vec_model}) vektör hesaplıyor ({done_cnt}/{total_inp} parça)...",
                        page_count=page_count,
                        total_chunks=len(chunks),
                        chunking_mode=chunking_mode,
                        chunking_agent_kod=chunking_agent_kod,
                        chunking_model=chunking_model,
                        persist_to_db=False,
                    )

                effective_embedding_model = embedding_service.get_effective_embedding_model(embedding_provider_used)

                self._update_job_progress(
                    job_key,
                    **common_job_meta,
                    status="indexing",
                    indexing_stage="saving",
                    indexing_progress=93,
                    status_detail="Vektör parçaları PostgreSQL (pgvector) RAG veritabanına yazılıyor...",
                    page_count=page_count,
                    total_chunks=len(chunks),
                    chunking_mode=chunking_mode,
                    chunking_agent_kod=chunking_agent_kod,
                    chunking_model=chunking_model,
                    persist_to_db=False,
                )

                done_detail = (
                    f"RAG indeksleme tamamlandı ({len(chunks)} parça, {page_count} sayfa"
                    + (f", chunk:{chunking_agent_kod}/{chunking_model}" if chunking_model else "")
                    + f", vektör:{embedding_provider_used or vec_provider}/{effective_embedding_model})."
                )

                with postgres_db.rag_connection() as conn:
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
                            char_count, embedding_model, embedding_provider,
                            status, indexing_stage, indexing_progress, status_detail,
                            chunking_mode, chunking_agent_kod, chunking_model,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'indexed', 'indexed', 100, ?, ?, ?, ?, ?, ?)
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
                            effective_embedding_model,
                            embedding_provider_used,
                            done_detail,
                            chunking_mode,
                            chunking_agent_kod,
                            chunking_model,
                            now_iso,
                            now_iso,
                        ),
                    )

                    for idx_chk, chk in enumerate(chunks):
                        chk_id = f"ragchk_{uuid.uuid4().hex[:18]}"
                        chk_content = chk["content"]
                        emb_str = EmbeddingService.to_pgvector_str(chunk_vectors[idx_chk])
                        meta_dict = {
                            "cloud_doc_id": doc_id,
                            "bulut_dosya_id": norm_bulut_id,
                            "cloud_file_id": norm_cloud_id,
                            "provider": str(provider or "google").lower(),
                            "belge_turu": str(belge_turu or "Genel"),
                            "belge_id": int(belge_id or 0),
                            "page_number": chk["page_number"],
                            "section_title": chk["section_title"],
                            "embedding_model": effective_embedding_model,
                            "embedding_provider": embedding_provider_used,
                            "dimensions": BGE_M3_DIMENSIONS,
                            "chunking_mode": chunking_mode,
                        }
                        if isinstance(chk.get("agent_meta"), dict):
                            meta_dict.update(chk["agent_meta"])
                        meta_json = json.dumps(meta_dict, ensure_ascii=False)
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

                self._update_job_progress(
                    job_key,
                    **common_job_meta,
                    status="indexed",
                    indexing_stage="indexed",
                    indexing_progress=100,
                    status_detail=done_detail,
                    page_count=page_count,
                    total_chunks=len(chunks),
                    chunking_mode=chunking_mode,
                    chunking_agent_kod=chunking_agent_kod,
                    chunking_model=chunking_model,
                    persist_to_db=False,
                )

                gateway_logger.info(
                    f"RAG_DOCUMENT_INGESTED | doc_id={doc_id} | app={norm_app} | firma={norm_firma_id} "
                    f"| bulut_dosya_id={norm_bulut_id} | cloud_file_id={norm_cloud_id} "
                    f"| file={clean_name} | pages={page_count} | chunks={len(chunks)} | tokens={total_tokens} "
                    f"| chunk_mode={chunking_mode} | chunk_model={chunking_model or '-'} "
                    f"| model={effective_embedding_model} | emb_provider={embedding_provider_used}"
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
                    "embedding_model": effective_embedding_model,
                    "embedding_provider": embedding_provider_used,
                    "dimensions": BGE_M3_DIMENSIONS,
                    "chunking_mode": chunking_mode,
                    "chunking_agent_kod": chunking_agent_kod,
                    "chunking_model": chunking_model,
                    "proxy_pool_stats": embedding_service.get_proxy_pool_stats(),
                }
            except Exception as exc:
                err_msg = str(exc) or "RAG indeksleme sırasında beklenmeyen hata."
                self._update_job_progress(
                    job_key,
                    **common_job_meta,
                    status="failed",
                    indexing_stage="failed",
                    indexing_progress=0,
                    status_detail=err_msg[:400],
                    persist_to_db=True,
                )
                raise

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
            eff_model = embedding_service.get_effective_embedding_model(used_provider)
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
                        (eff_model, used_provider, now_iso, did),
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
        last_provider_used = "ollama"
        last_model_used = embedding_service.get_effective_embedding_model("ollama")
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
                allow_fallback=True,
            )
            last_provider_used = used_provider
            last_model_used = embedding_service.get_effective_embedding_model(used_provider)
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
                            "embedding_model": last_model_used,
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
                        last_model_used,
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
            f"| chunks={total_reindexed_chunks} | model={last_model_used} | provider={last_provider_used} "
            f"| proxied_requests={proxy_stats.get('total_proxied_requests', 0)}"
        )
        return {
            "ok": True,
            "status": "reindexed",
            "reindexed_documents": total_reindexed_docs,
            "reindexed_chunks": total_reindexed_chunks,
            "updated_documents": total_reindexed_docs,
            "updated_chunks": total_reindexed_chunks,
            "embedding_model": last_model_used,
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
        start_chunk_index: Optional[int] = None,
        end_chunk_index: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        PostgreSQL `rag_document_chunks` ve `rag_cloud_documents` üzerinde 1024 boyutlu
        `BAAI/bge-m3` pgvector kosinüs benzerliği + anahtar kelime (ILIKE) + bölüm/tablo odaklı hibrit arama yapar.
        `start_chunk_index` / `end_chunk_index` verildiğinde çok sayfalı tabloların ardışık parçalarını kesintisiz döner.
        """
        self._ensure_null_embeddings_backfilled()

        clean_query = (query or "").strip()
        effective_k = max(1, min(25, int(top_k or 8)))
        norm_app = (app_id or "WEBAKUS_ERP").strip().upper()
        norm_strategy = (strategy or "HIBRIT_VEKTOR_KELIME").strip().upper()
        clean_section = (section_filter or "").strip()
        has_explicit_chunk_range = start_chunk_index is not None or end_chunk_index is not None

        if start_chunk_index is not None and end_chunk_index is not None:
            if end_chunk_index < start_chunk_index:
                start_chunk_index, end_chunk_index = end_chunk_index, start_chunk_index
            range_span = abs(int(end_chunk_index) - int(start_chunk_index)) + 1
            effective_k = max(effective_k, min(50, range_span))

        if has_explicit_chunk_range:
            query_vec, query_provider = None, "chunk-range-direct"
        else:
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
        if belge_turu and belge_turu.strip() and not (bulut_dosya_id is not None and int(bulut_dosya_id) > 0):
            base_clauses.append("d.belge_turu ILIKE ?")
            base_filter_params.append(f"%{belge_turu.strip()}%")
        if start_chunk_index is not None:
            base_clauses.append("c.chunk_index >= ?")
            base_filter_params.append(max(0, int(start_chunk_index)))
        if end_chunk_index is not None:
            base_clauses.append("c.chunk_index <= ?")
            base_filter_params.append(max(0, int(end_chunk_index)))

        def _fetch_rows(conn: Any, with_section: bool) -> List[Dict[str, Any]]:
            clauses = list(base_clauses)
            filter_params = list(base_filter_params)
            if with_section and clean_section and not has_explicit_chunk_range:
                clauses.append("(c.section_title ILIKE ? OR c.content ILIKE ?)")
                like_sec = f"%{clean_section}%"
                filter_params.extend([like_sec, like_sec])

            where_sql = " AND ".join(clauses)
            if has_explicit_chunk_range:
                if start_chunk_index is not None and end_chunk_index is not None:
                    range_span = abs(int(end_chunk_index) - int(start_chunk_index)) + 1
                    fetch_limit = max(effective_k, min(50, range_span))
                else:
                    fetch_limit = effective_k
                sql_params = tuple(filter_params + [fetch_limit])
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
                        COALESCE(d.total_chunks, 0) AS total_chunks,
                        COALESCE(d.belge_turu, 'Genel') AS belge_turu,
                        COALESCE(d.provider, 'google') AS provider,
                        1.0 AS vector_score
                    FROM rag_document_chunks c
                    LEFT JOIN rag_cloud_documents d ON d.id = c.cloud_doc_id
                    WHERE {where_sql}
                    ORDER BY c.bulut_dosya_id ASC, c.chunk_index ASC
                    LIMIT ?
                    """,
                    sql_params,
                ).fetchall()

            if norm_strategy == "TAM_DOKUMAN_PARCALARI":
                fetch_limit = effective_k
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
                        COALESCE(d.total_chunks, 0) AS total_chunks,
                        COALESCE(d.belge_turu, 'Genel') AS belge_turu,
                        COALESCE(d.provider, 'google') AS provider,
                        (1.0 - (c.embedding <=> ?::vector)) AS vector_score
                    FROM rag_document_chunks c
                    LEFT JOIN rag_cloud_documents d ON d.id = c.cloud_doc_id
                    WHERE {where_sql}
                    ORDER BY c.bulut_dosya_id ASC, c.chunk_index ASC
                    LIMIT ?
                    """,
                    sql_params,
                ).fetchall()

            fetch_limit = (
                min(60, max(32, effective_k * 3))
                if norm_strategy == "BOLUM_VE_TABLO_ODAKLI"
                else min(40, effective_k * 2)
            )
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
                    COALESCE(d.total_chunks, 0) AS total_chunks,
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
        document_outline: List[str] = []
        first_doc_chunk_row: Optional[Dict[str, Any]] = None
        with postgres_db.rag_connection() as conn:
            rows = _fetch_rows(conn, with_section=bool(clean_section))
            if not rows and clean_section:
                rows = _fetch_rows(conn, with_section=False)

            if not has_explicit_chunk_range and bulut_dosya_id is not None and int(bulut_dosya_id) > 0:
                outline_clauses = ["app_id = ?", "bulut_dosya_id = ?"]
                outline_params: List[Any] = [norm_app, int(bulut_dosya_id)]
                if firma_id is not None and int(firma_id) > 0:
                    outline_clauses.append("(firma_id = ? OR firma_id = 0)")
                    outline_params.append(int(firma_id))
                outline_rows = conn.execute(
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
                        c.metadata_json,
                        COALESCE(d.total_chunks, 0) AS total_chunks,
                        COALESCE(d.belge_turu, 'Genel') AS belge_turu,
                        COALESCE(d.provider, 'google') AS provider
                    FROM rag_document_chunks c
                    LEFT JOIN rag_cloud_documents d ON d.id = c.cloud_doc_id
                    WHERE {" AND ".join("c." + cl if not cl.startswith("(") else cl.replace("firma_id", "c.firma_id") for cl in outline_clauses)}
                    ORDER BY c.chunk_index ASC
                    LIMIT 120
                    """,
                    tuple(outline_params),
                ).fetchall()
                if outline_rows:
                    first_doc_chunk_row = dict(outline_rows[0])
                active_table_heading = ""
                for orow in outline_rows:
                    ocontent = str(orow.get("content") or "")
                    osection = str(orow.get("section_title") or "").strip() or "-"
                    ometa: Dict[str, Any] = {}
                    raw_ometa = orow.get("metadata_json")
                    if raw_ometa:
                        try:
                            parsed_om = json.loads(raw_ometa) if isinstance(raw_ometa, str) else raw_ometa
                            if isinstance(parsed_om, dict):
                                ometa = parsed_om
                        except Exception:
                            ometa = {}
                    agent_yapi_turu = str(ometa.get("yapi_turu") or "").upper()
                    agent_numeric = bool(ometa.get("sayisal_veri_icerir_mi", False))
                    has_tbl = (
                        "|---" in ocontent
                        or "| ---" in ocontent
                        or ocontent.count(" | ") >= 3
                        or agent_yapi_turu == "TABLO"
                    )
                    has_price_cells = bool(
                        re.search(
                            r"\|\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})\s*(?:\||$)",
                            ocontent,
                            flags=re.MULTILINE,
                        )
                    ) or (agent_yapi_turu == "TABLO" and agent_numeric)
                    body_lines = [
                        ln.strip()
                        for ln in ocontent.splitlines()
                        if ln.strip() and not ln.strip().startswith("[Belge:")
                    ]
                    heading_candidates: List[str] = []
                    heading_line_indices: List[int] = []
                    for b_idx, bln in enumerate(body_lines):
                        if "|" in bln or bln.startswith("•") or bln.startswith("-"):
                            continue
                        if len(bln) < 12 or len(bln) > 85:
                            continue
                        if re.fullmatch(r"[A-Z0-9,\s\-\/\(\)\.]+", bln):
                            continue
                        if any(
                            kw in bln.lower()
                            for kw in (
                                "fiyat fark",
                                "fırsat model",
                                "firsat model",
                                "bakanlığı model",
                                "bakanligi model",
                                "kampanya",
                                "uygulama",
                                "sorgulama",
                                "nakliye",
                                "modelleri",
                            )
                        ):
                            heading_candidates.append(bln)
                            heading_line_indices.append(b_idx)
                    chunk_kind = (
                        "TABLO(FIYATLI)"
                        if (has_tbl and has_price_cells)
                        else ("TABLO(FIYATSIZ)" if has_tbl else "METİN")
                    )

                    # Çok parçalı tablolarda önceki parçanın devamı ve sınır başlığı durumunu netleştir
                    starts_with_table = (
                        has_tbl
                        and bool(body_lines)
                        and (not heading_line_indices or heading_line_indices[0] > 0)
                    )
                    prev_cont_tag = ""
                    clean_active_hdr = re.sub(
                        r"\s*(?:\d{1,2}[-\/.]\d{1,2}\s*[A-Za-zçğıöşüÇĞİÖŞÜ]*\s*\d{2,4}|\d{1,2}[-\/.]\d{1,2}[-\/.](?:\d{2,4})?|\d{4})\b.*", "", active_table_heading
                    ).strip() or active_table_heading

                    if starts_with_table and clean_active_hdr:
                        if not heading_candidates:
                            prev_cont_tag = f"{clean_active_hdr} (Devam)"
                        elif heading_line_indices and heading_line_indices[0] > 0:
                            prev_cont_tag = f"{clean_active_hdr} (Tablo Sonu)"

                    tags_to_display: List[str] = []
                    if prev_cont_tag:
                        tags_to_display.append(prev_cont_tag)
                    for hc in heading_candidates:
                        if prev_cont_tag and any(w in hc.lower() for w in ("bakanlık", "bakanlik", "sınır", "aile")):
                            tags_to_display.append(f"Sınır/Yeni Tablo: {hc}")
                        else:
                            tags_to_display.append(hc)

                    first_ln = re.sub(r"\s+", " ", body_lines[0])[:65] if body_lines else ""
                    last_ln = (
                        re.sub(r"\s+", " ", body_lines[-1])[:65]
                        if len(body_lines) > 1
                        else ""
                    )
                    heading_tag = (
                        f"Başlıklar: {' ➔ '.join(tags_to_display[:2])} | "
                        if tags_to_display
                        else ""
                    )
                    span_preview = (
                        f"{first_ln} ... {last_ln}"
                        if (last_ln and last_ln != first_ln)
                        else first_ln
                    )
                    document_outline.append(
                        f"[{orow['chunk_index']}] S.{orow['page_number']} | {osection[:28]} | {chunk_kind} | {heading_tag}{span_preview}"
                    )

                    if heading_candidates:
                        active_table_heading = heading_candidates[-1]
                    elif not has_tbl:
                        active_table_heading = ""

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

                if norm_strategy == "BOLUM_VE_TABLO_ODAKLI":
                    has_table_structure = "|---" in content_txt or "| ---" in content_txt or content_txt.count(" | ") >= 3
                    has_numeric_price_cells = bool(
                        re.search(r"\|\s*\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\s*(?:\||$)", content_txt, flags=re.MULTILINE)
                    )
                    if has_table_structure and has_numeric_price_cells:
                        score = min(1.0, score + 0.22)
                    elif has_table_structure:
                        score = min(1.0, score + 0.08)

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
                        "total_chunks": int(r.get("total_chunks") or 0),
                        "token_count": r["token_count"],
                        "similarity_score": round(score, 4),
                        "content": content_txt,
                    }
                )

            if not has_explicit_chunk_range and norm_strategy != "TAM_DOKUMAN_PARCALARI":
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

            # Aktif tekil bulut dosyası aramalarında kapak/başlık/tarih bilgisi taşıyan 0. parçayı her zaman dahil et
            if (
                first_doc_chunk_row is not None
                and not has_explicit_chunk_range
                and not clean_section
                and not any(int(r.get("chunk_index") or -1) == int(first_doc_chunk_row.get("chunk_index") or 0) for r in results)
            ):
                header_item = {
                    "chunk_id": first_doc_chunk_row["chunk_id"],
                    "cloud_doc_id": first_doc_chunk_row["cloud_doc_id"],
                    "bulut_dosya_id": first_doc_chunk_row["bulut_dosya_id"],
                    "cloud_file_id": first_doc_chunk_row["cloud_file_id"],
                    "file_name": first_doc_chunk_row["file_name"],
                    "belge_turu": first_doc_chunk_row["belge_turu"],
                    "provider": first_doc_chunk_row["provider"],
                    "section_title": str(first_doc_chunk_row.get("section_title") or ""),
                    "page_number": first_doc_chunk_row["page_number"],
                    "chunk_index": first_doc_chunk_row["chunk_index"],
                    "total_chunks": int(first_doc_chunk_row.get("total_chunks") or 0),
                    "token_count": first_doc_chunk_row["token_count"],
                    "similarity_score": 1.0,
                    "content": str(first_doc_chunk_row.get("content") or ""),
                }
                results = [header_item] + results[: max(0, effective_k - 1)]

        return {
            "app_id": norm_app,
            "query": clean_query,
            "strategy": norm_strategy,
            "embedding_model": embedding_service.get_effective_embedding_model(query_provider),
            "embedding_provider": query_provider,
            "total_found": len(results),
            "document_outline": document_outline,
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
                    char_count, embedding_model, embedding_provider, status,
                    indexing_stage, indexing_progress, status_detail,
                    chunking_mode, chunking_agent_kod, chunking_model,
                    created_at, updated_at
                FROM rag_cloud_documents
                WHERE {where_sql}
                ORDER BY updated_at DESC
                """,
                tuple(params),
            ).fetchall()
        items = [dict(r) for r in rows]
        orphan_updates: List[Tuple[str, str, int, str, str, str]] = []
        now_iso = datetime.now(timezone.utc).isoformat()
        with self._jobs_lock:
            for item in items:
                bid = int(item.get("bulut_dosya_id") or 0)
                jkey = self._build_job_key(
                    app_id=str(item.get("app_id") or norm_app),
                    firma_id=int(item.get("firma_id") or 0),
                    bulut_dosya_id=bid,
                    cloud_file_id=str(item.get("cloud_file_id") or ""),
                    file_name=str(item.get("file_name") or ""),
                )
                active_job = self._active_jobs.get(jkey)
                if not active_job and bid > 0:
                    for k_job, v_job in self._active_jobs.items():
                        if k_job.endswith(f":{bid}") and v_job.get("bulut_dosya_id") == bid:
                            active_job = v_job
                            break
                if active_job and active_job.get("status") == "indexing":
                    item["status"] = "indexing"
                    item["indexing_stage"] = active_job.get("indexing_stage") or item.get("indexing_stage") or "indexing"
                    item["indexing_progress"] = active_job.get("indexing_progress") or 0
                    item["status_detail"] = active_job.get("status_detail") or item.get("status_detail") or ""
                    item["chunking_mode"] = active_job.get("chunking_mode") or item.get("chunking_mode") or ""
                    item["chunking_agent_kod"] = active_job.get("chunking_agent_kod") or item.get("chunking_agent_kod") or ""
                    item["chunking_model"] = active_job.get("chunking_model") or item.get("chunking_model") or ""
                elif str(item.get("status") or "").lower() == "indexing":
                    updated_dt = self._parse_iso_utc(item.get("updated_at"))
                    if updated_dt is None or updated_dt < _SERVER_BOOT_UTC:
                        healed = self._build_healed_orphan_state(item, now_iso)
                        item.update(healed)
                        orphan_updates.append(
                            (
                                healed["status"],
                                healed["indexing_stage"],
                                int(healed["indexing_progress"]),
                                healed["status_detail"],
                                now_iso,
                                str(item.get("id") or ""),
                            )
                        )
        if orphan_updates:
            self._persist_healed_orphans(orphan_updates)
        return items

    def get_documents_status(
        self,
        bulut_dosya_ids: List[int],
        firma_id: Optional[int] = None,
        app_id: str = "WEBAKUS_ERP",
    ) -> List[Dict[str, Any]]:
        """Belirtilen `BulutDosya.Id` listesi için bellek içi aktif job + PostgreSQL RAG durumunu birleştirip döner."""
        clean_ids = [int(x) for x in (bulut_dosya_ids or []) if int(x) > 0]
        if not clean_ids:
            return []

        norm_app = (app_id or "WEBAKUS_ERP").strip().upper()
        norm_firma = int(firma_id or 0) if firma_id is not None else 0

        placeholders = ", ".join("?" for _ in clean_ids)
        params: List[Any] = [norm_app]
        clauses = ["app_id = ?", f"bulut_dosya_id IN ({placeholders})"]
        params.extend(clean_ids)
        if firma_id is not None and norm_firma > 0:
            clauses.append("(firma_id = ? OR firma_id = 0)")
            params.append(norm_firma)

        db_by_id: Dict[int, Dict[str, Any]] = {}
        with postgres_db.rag_connection() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    id, app_id, firma_id, bulut_dosya_id, cloud_file_id, file_name,
                    page_count, total_chunks, total_tokens, status,
                    indexing_stage, indexing_progress, status_detail,
                    chunking_mode, chunking_agent_kod, chunking_model,
                    created_at, updated_at
                FROM rag_cloud_documents
                WHERE {" AND ".join(clauses)}
                ORDER BY updated_at DESC
                """,
                tuple(params),
            ).fetchall()
            for r in rows:
                d = dict(r)
                bid = int(d.get("bulut_dosya_id") or 0)
                if bid > 0 and bid not in db_by_id:
                    db_by_id[bid] = d

        statuses: List[Dict[str, Any]] = []
        orphan_updates: List[Tuple[str, str, int, str, str, str]] = []
        now_iso = datetime.now(timezone.utc).isoformat()
        with self._jobs_lock:
            for bid in clean_ids:
                db_row = db_by_id.get(bid)
                jkey_specific = self._build_job_key(app_id=norm_app, firma_id=norm_firma, bulut_dosya_id=bid)
                active_job = self._active_jobs.get(jkey_specific)
                if not active_job and db_row:
                    jkey_db = self._build_job_key(
                        app_id=str(db_row.get("app_id") or norm_app),
                        firma_id=int(db_row.get("firma_id") or 0),
                        bulut_dosya_id=bid,
                    )
                    active_job = self._active_jobs.get(jkey_db)
                if not active_job:
                    # Herhangi bir firma anahtarıyla eşleşen aktif job varsa kontrol et
                    for k_job, v_job in self._active_jobs.items():
                        if k_job.endswith(f":{bid}") and v_job.get("bulut_dosya_id") == bid:
                            active_job = v_job
                            break

                if active_job and active_job.get("status") == "indexing":
                    statuses.append(
                        {
                            "bulut_dosya_id": bid,
                            "doc_id": (db_row or {}).get("id") or "",
                            "file_name": active_job.get("file_name") or (db_row or {}).get("file_name") or "",
                            "status": "indexing",
                            "indexing_stage": active_job.get("indexing_stage") or "indexing",
                            "indexing_progress": int(active_job.get("indexing_progress") or 0),
                            "status_detail": active_job.get("status_detail") or "",
                            "page_count": int(active_job.get("page_count") or (db_row or {}).get("page_count") or 0),
                            "total_chunks": int(active_job.get("total_chunks") or (db_row or {}).get("total_chunks") or 0),
                            "chunking_mode": active_job.get("chunking_mode") or "",
                            "chunking_agent_kod": active_job.get("chunking_agent_kod") or "",
                            "chunking_model": active_job.get("chunking_model") or "",
                            "updated_at": active_job.get("updated_at") or "",
                        }
                    )
                elif db_row:
                    st = str(db_row.get("status") or "indexed").lower()
                    t_chunks = int(db_row.get("total_chunks") or 0)
                    if st == "indexing":
                        updated_dt = self._parse_iso_utc(db_row.get("updated_at"))
                        if updated_dt is None or updated_dt < _SERVER_BOOT_UTC:
                            healed = self._build_healed_orphan_state(db_row, now_iso)
                            db_row.update(healed)
                            orphan_updates.append(
                                (
                                    healed["status"],
                                    healed["indexing_stage"],
                                    int(healed["indexing_progress"]),
                                    healed["status_detail"],
                                    now_iso,
                                    str(db_row.get("id") or ""),
                                )
                            )
                            st = str(db_row.get("status") or "not_indexed").lower()
                    # Eğer DB satırı 'indexed' ama parçası yoksa henüz tamamlanmamış say
                    effective_status = st if (st != "indexed" or t_chunks > 0) else "not_indexed"
                    statuses.append(
                        {
                            "bulut_dosya_id": bid,
                            "doc_id": db_row.get("id") or "",
                            "file_name": db_row.get("file_name") or "",
                            "status": effective_status,
                            "indexing_stage": db_row.get("indexing_stage") or effective_status,
                            "indexing_progress": int(db_row.get("indexing_progress") if effective_status == "indexed" else (db_row.get("indexing_progress") or 0)),
                            "status_detail": db_row.get("status_detail") or "",
                            "page_count": int(db_row.get("page_count") or 0),
                            "total_chunks": t_chunks,
                            "chunking_mode": db_row.get("chunking_mode") or "",
                            "chunking_agent_kod": db_row.get("chunking_agent_kod") or "",
                            "chunking_model": db_row.get("chunking_model") or "",
                            "updated_at": db_row.get("updated_at") or "",
                        }
                    )
                else:
                    statuses.append(
                        {
                            "bulut_dosya_id": bid,
                            "doc_id": "",
                            "file_name": "",
                            "status": "not_indexed",
                            "indexing_stage": "not_indexed",
                            "indexing_progress": 0,
                            "status_detail": "Dosya henüz RAG indeksine aktarılmamış.",
                            "page_count": 0,
                            "total_chunks": 0,
                            "chunking_mode": "",
                            "chunking_agent_kod": "",
                            "chunking_model": "",
                            "updated_at": "",
                        }
                    )
        if orphan_updates:
            self._persist_healed_orphans(orphan_updates)
        return statuses

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
