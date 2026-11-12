"""
ThinkPort AI Gateway - pgvector Ajan Hafızası, Gateway Tool Call Yakalama ve Gözlemci Ajan Servisi (agent_memory_service.py).

Sorumluluklar:
1. (app_id, agent_id) birleşik anahtarı (composite key) ile her uygulamanın her ajanına izole pgvector hafıza alanı sağlamak.
2. Kapasite (hafiza_max_kayit), yaşam süresi (TTL - hafiza_saklama_gun) ve sorgu başına sonuç (Top-K & Token) sınırlarını işletmek.
3. Ajanların kendi ortamlarında MCP çağırdığı gibi think-port-api üzerinde `thinkport_memory_search`,
   `thinkport_memory_save` ve `thinkport_conversation_recall` tool_call çağrılarını yapabilmesini sağlamak.
4. Gözlemci Ajan (GOZLEMCI_AJAN) kurallarını veritabanından okuyarak yarıda kesilen (token sınırı / açık JSON-kod bloğu)
   yanıtları tespit etmek ve devam istemi (continuation) ile birleştirmek.
"""
from __future__ import annotations
import hashlib
import json
import math
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
from app.core.logger import gateway_logger
from app.repositories.postgres_db import postgres_db


GATEWAY_MEMORY_TOOL_NAMES = {
    "thinkport_memory_search",
    "thinkport_memory_save",
    "thinkport_conversation_recall",
    "thinkport_rag_search",
}

MAX_SINGLE_MEMORY_CHARS = 4000
MAX_RETRIEVAL_TOTAL_CHARS = 6000  # ~1.500 token bütçe sınırı


class AgentMemoryService:
    """
    (app_id, agent_id) birleşik anahtarına dayalı pgvector + pg_trgm hibrit ajan hafızası
    ve Gözlemci Ajan (GOZLEMCI_AJAN) kesinti denetim servisi.
    """

    @staticmethod
    def normalize_identity(
        app_id: Optional[str],
        agent_id: Optional[str],
    ) -> Tuple[str, str]:
        """Uygulama kimliği (app_id) ve ajan kimliğini (agent_id) standart büyük harf formatına normalize eder."""
        raw_agent = (agent_id or "").strip().upper()
        raw_app = (app_id or "").strip().upper()
        if not raw_agent or not raw_app:
            return ("", "")
        return (raw_app, raw_agent)

    @staticmethod
    def compute_embedding_384(text: str) -> str:
        """
        Metni PostgreSQL `vector(384)` sütunuyla uyumlu, birim uzunluğa (L2) normalize edilmiş
        384 boyutlu kelime + karakter trigram özellik vektörüne dönüştürür.
        Harici ağ çağrısı gerektirmez, sıfır gecikmeyle çalışır.
        """
        dim = 384
        vec = [0.0] * dim
        cleaned = re.sub(r"\s+", " ", (text or "").lower()).strip()
        if not cleaned:
            return "[" + ",".join("0.0" for _ in range(dim)) + "]"

        tokens = re.findall(r"[a-z0-9çğıöşü_]{2,}", cleaned)
        for tok in tokens:
            h = int(hashlib.md5(tok.encode("utf-8")).hexdigest()[:8], 16)
            idx = h % dim
            sign = 1.0 if ((h >> 8) & 1) == 0 else -1.0
            vec[idx] += sign * 1.5

        padded = f"  {cleaned[:1500]}  "
        for i in range(len(padded) - 2):
            tri = padded[i : i + 3]
            h = int(hashlib.md5(tri.encode("utf-8")).hexdigest()[:8], 16)
            idx = h % dim
            sign = 1.0 if ((h >> 9) & 1) == 0 else -1.0
            vec[idx] += sign * 0.4

        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 1e-9:
            vec = [round(v / norm, 6) for v in vec]
        else:
            vec[0] = 1.0
        return "[" + ",".join(str(v) for v in vec) + "]"

    def ensure_agent_registered_and_get_config(
        self,
        app_id: str,
        agent_id: str,
        agent_name: Optional[str] = None,
        model_id: str = "gpt-4o",
    ) -> Dict[str, Any]:
        """
        (app_id, agent_id) ikilisine ait ajan yapılandırmasını `ai_agents` tablosundan okur.
        Eğer ajan istemci uygulama (örn. Webakus) içerisinde geliştirilmiş ve think-port-api'ye
        ilk kez ulaşıyorsa, veritabanına varsayılan hafıza sınırlarıyla otomatik kaydeder.
        """
        norm_app, norm_agent = self.normalize_identity(app_id, agent_id)
        if not norm_agent or not norm_app:
            return {
                "app_id": "",
                "agent_id": "",
                "hafiza_aktif_mi": False,
                "hafiza_max_kayit": 1000,
                "hafiza_saklama_gun": 30,
                "hafiza_arama_top_k": 5,
                "gozlemci_aktif_mi": True,
                "sistem_istemi": "",
            }

        with postgres_db.connection() as conn:
            row = conn.execute(
                """
                SELECT id, uygulama_id, ad, kod, sistem_istemi, kurallar_json,
                       hafiza_aktif_mi, hafiza_max_kayit, hafiza_saklama_gun,
                       hafiza_arama_top_k, gozlemci_aktif_mi, aktif_mi
                FROM ai_agents
                WHERE LOWER(TRIM(uygulama_id)) = LOWER(TRIM(?))
                  AND LOWER(TRIM(kod)) = LOWER(TRIM(?))
                LIMIT 1
                """,
                (norm_app, norm_agent),
            ).fetchone()

            if not row:
                # Sadece kod ile eşleşen sistem kaydı var mı kontrol et
                row = conn.execute(
                    """
                    SELECT id, uygulama_id, ad, kod, sistem_istemi, kurallar_json,
                           hafiza_aktif_mi, hafiza_max_kayit, hafiza_saklama_gun,
                           hafiza_arama_top_k, gozlemci_aktif_mi, aktif_mi
                    FROM ai_agents
                    WHERE LOWER(TRIM(kod)) = LOWER(TRIM(?))
                    LIMIT 1
                    """,
                    (norm_agent,),
                ).fetchone()

            if not row:
                # Harici uygulamada geliştirilmiş yeni ajan: otomatik kaydet
                max_row = conn.execute("SELECT COALESCE(MAX(id), 0) AS m FROM ai_agents").fetchone()
                next_id = int(max_row["m"] or 0) + 1
                now_iso = datetime.now(timezone.utc).isoformat()
                display_name = (agent_name or f"{norm_app} - {norm_agent}").strip()
                default_tools = json.dumps(list(GATEWAY_MEMORY_TOOL_NAMES), ensure_ascii=False)
                conn.execute(
                    """
                    INSERT INTO ai_agents (
                        id, uygulama_id, ad, kod, aciklama, rol, ikon, renk, kapsam,
                        ust_ajan_id, kurallar_json, sistem_istemi, hizli_istekler_json,
                        ai_saglayici_id, model_adi, alternatif_modeller_json,
                        sicaklik, max_tokens, yanit_sentezi_modu, secili_arac_kodlari_json,
                        hafiza_aktif_mi, hafiza_max_kayit, hafiza_saklama_gun,
                        hafiza_arama_top_k, gozlemci_aktif_mi, aktif_mi, sistem_kaydi_mi,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'Bot', '#3b82f6', 1, NULL, '[]', '', '[]', 1, ?, '[]', 0.7, 4096, 0, ?, 1, 1000, 30, 5, 1, 1, 0, ?, ?)
                    """,
                    (
                        next_id,
                        norm_app,
                        display_name,
                        norm_agent,
                        f"{norm_app} uygulaması üzerinden otomatik keşfedilen AI ajanı.",
                        f"{norm_app} Uygulama Ajanı",
                        model_id or "gpt-4o",
                        default_tools,
                        now_iso,
                        now_iso,
                    ),
                )
                return {
                    "id": next_id,
                    "app_id": norm_app,
                    "agent_id": norm_agent,
                    "hafiza_aktif_mi": True,
                    "hafiza_max_kayit": 1000,
                    "hafiza_saklama_gun": 30,
                    "hafiza_arama_top_k": 5,
                    "gozlemci_aktif_mi": True,
                    "sistem_istemi": "",
                }

            return {
                "id": int(row["id"]),
                "app_id": str(row.get("uygulama_id") or norm_app),
                "agent_id": str(row.get("kod") or norm_agent),
                "hafiza_aktif_mi": bool(row.get("hafiza_aktif_mi") if row.get("hafiza_aktif_mi") is not None else 1),
                "hafiza_max_kayit": int(row.get("hafiza_max_kayit") or 1000),
                "hafiza_saklama_gun": int(row.get("hafiza_saklama_gun") or 30),
                "hafiza_arama_top_k": int(row.get("hafiza_arama_top_k") or 5),
                "gozlemci_aktif_mi": bool(row.get("gozlemci_aktif_mi") if row.get("gozlemci_aktif_mi") is not None else 1),
                "sistem_istemi": str(row.get("sistem_istemi") or ""),
            }

    @staticmethod
    def get_gateway_memory_tools_schema() -> List[Dict[str, Any]]:
        """
        Ajanın think-port-api üzerindeki kendi (app_id, agent_id) pgvector hafızasını
        taraması ve kayıt eklemesi için OpenAI Function Calling uyumlu araç şemalarını döner.
        """
        return [
            {
                "type": "function",
                "function": {
                    "name": "thinkport_memory_search",
                    "description": (
                        "Ajanın (app_id + agent_id) birleşik kimliğine ait ThinkPort pgvector uzun süreli hafızasını "
                        "ve geçmiş soru-cevap kayıtlarını anlamsal (vektör) ve anahtar kelime bazlı tarar. "
                        "Kullanıcı önceki bir işlemden, geçmiş bir sohbetten veya daha önce öğrendiğin bir kuraldan bahsettiğinde bu aracı çağır."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Hafızada aranacak anahtar kelime, kavram, belge/cari kodu veya soru metni.",
                            },
                            "memory_type": {
                                "type": "string",
                                "enum": ["all", "interaction", "fact", "rule", "summary"],
                                "description": "Aranacak hafıza türü (varsayılan: all).",
                            },
                            "top_k": {
                                "type": "integer",
                                "description": "Döndürülecek maksimum hafıza kaydı sayısı (varsayılan: 5, maksimum: 15).",
                            },
                        },
                        "required": ["query"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "thinkport_memory_save",
                    "description": (
                        "Ajanın sonraki sohbetlerde hatırlaması gereken önemli bir bilgiyi, kullanıcı tercihini, "
                        "iş kuralını veya özet kararı (app_id + agent_id) özel pgvector hafızasına kaydeder."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "Hafızaya kaydedilecek net ve öz bilgi/kural metni.",
                            },
                            "memory_type": {
                                "type": "string",
                                "enum": ["fact", "rule", "summary"],
                                "description": "Hafıza kaydının türü (fact: bilgi, rule: kural/tercih, summary: özet).",
                            },
                            "importance": {
                                "type": "number",
                                "description": "Önem derecesi (0.1 ile 1.0 arası, varsayılan: 0.8).",
                            },
                            "is_pinned": {
                                "type": "boolean",
                                "description": "True ise kayıt süresiz (TTL'den muaf) olarak sabitlenir.",
                            },
                            "tags": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Aramayı kolaylaştıracak etiket listesi.",
                            },
                        },
                        "required": ["content"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "thinkport_conversation_recall",
                    "description": (
                        "Aynı (app_id + agent_id) ajan kimliğinin önceki sohbet oturumlarındaki son konuşma turlarını getirir."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Opsiyonel konu veya anahtar kelime filtresi.",
                            },
                            "limit": {
                                "type": "integer",
                                "description": "Getirilecek maksimum geçmiş tur sayısı (varsayılan: 5).",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "thinkport_rag_search",
                    "description": (
                        "Bulut depolamaya (Google Drive, OneDrive vb.) yüklenmiş ve PostgreSQL pgvector RAG veritabanına "
                        "otomatik aktarılmış döküman dosyaları (.pdf, .doc, .docx, .xlsx, .csv, .txt) içinde anlamsal (vektör) "
                        "ve anahtar kelime bazlı arama yapar."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Dökümanlarda aranacak ürün kodu, başlık, fiyat, madde veya soru metni.",
                            },
                            "file_name": {
                                "type": "string",
                                "description": "Opsiyonel dosya adı filtresi.",
                            },
                            "belge_turu": {
                                "type": "string",
                                "description": "Opsiyonel belge türü/klasör filtresi (örn: FiyatListesi, KampanyaBelgesi, Fatura).",
                            },
                            "top_k": {
                                "type": "integer",
                                "description": "Getirilecek maksimum döküman parçası sayısı (varsayılan: 8).",
                            },
                        },
                        "required": ["query"],
                    },
                },
            },
        ]

    def inject_memory_tools_and_instructions(
        self,
        existing_tools: Optional[List[Dict[str, Any]]],
        app_id: str,
        agent_id: str,
        agent_config: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], str]:
        """
        Ajanın hafıza özelliği aktifse, isteğin `tools` listesine ThinkPort hafıza araçlarını
        mükerrerlik oluşturmadan ekler ve veritabanındaki hafıza protokolü talimatını döner.
        """
        tools_list: List[Dict[str, Any]] = list(existing_tools) if existing_tools else []
        if not agent_config.get("hafiza_aktif_mi", True):
            return (tools_list, "")

        existing_names = set()
        for t in tools_list:
            fn = t.get("function") if isinstance(t, dict) else None
            if isinstance(fn, dict) and fn.get("name"):
                existing_names.add(str(fn["name"]))

        for mem_tool in self.get_gateway_memory_tools_schema():
            t_name = mem_tool["function"]["name"]
            if t_name not in existing_names:
                tools_list.append(mem_tool)

        # Veritabanındaki THINKPORT_GENEL_ASISTAN veya ajanın kendi kurallarından hafıza yönergesini hazırla
        top_k = int(agent_config.get("hafiza_arama_top_k") or 5)
        instruction = (
            f"\n\n[THINKPORT PGVECTOR AJAN HAFIZASI YETKİSİ ({app_id}:{agent_id})]:\n"
            f"- Benzersiz Ajan Kimliğin: uygulama `{app_id}`, ajan `{agent_id}`.\n"
            f"- Geçmiş konuşmaları, önceki kararları veya kaydedilmiş bilgileri hatırlaman gerektiğinde "
            f"`thinkport_memory_search` aracını (maksimum top_k={top_k}) çağırarak kendi pgvector hafızanı tarayabilirsin.\n"
            f"- Gelecekteki oturumlarda unutulmaması gereken kritik kullanıcı tercihlerini veya kararları "
            f"`thinkport_memory_save` aracıyla hafızana kaydedebilirsin."
        )
        return (tools_list, instruction)

    def record_interaction_memory(
        self,
        app_id: str,
        agent_id: str,
        conversation_id: str,
        request_id: str,
        prompt_text: str,
        response_text: str,
        agent_config: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """
        Ajanın tamamladığı (istek + yanıt) turunu `(app_id, agent_id)` anahtarıyla `agent_memories`
        pgvector tablosuna kaydeder ve ardından kapasite/TTL sınırlarını (auto-pruning) işletir.
        """
        norm_app, norm_agent = self.normalize_identity(app_id, agent_id)
        if not norm_agent or not norm_app:
            return None

        cfg = agent_config or self.ensure_agent_registered_and_get_config(norm_app, norm_agent)
        if not cfg.get("hafiza_aktif_mi", True):
            return None

        clean_prompt = (prompt_text or "").strip()
        clean_response = (response_text or "").strip()
        if not clean_prompt and not clean_response:
            return None

        combined = f"İstek: {clean_prompt[:1200]}\nYanıt: {clean_response[:2600]}"
        if len(combined) > MAX_SINGLE_MEMORY_CHARS:
            combined = combined[:MAX_SINGLE_MEMORY_CHARS] + "..."

        est_tokens = max(1, len(combined) // 4)
        emb_str = self.compute_embedding_384(f"{clean_prompt} {clean_response}")
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.isoformat()
        retention_days = max(1, int(cfg.get("hafiza_saklama_gun") or 30))
        expires_iso = (now_dt + timedelta(days=retention_days)).isoformat()
        mem_id = f"mem_{uuid.uuid4().hex[:18]}"

        try:
            with postgres_db.connection() as conn:
                conn.execute(
                    """
                    INSERT INTO agent_memories (
                        id, app_id, agent_id, conversation_id, request_id,
                        memory_type, role, prompt_text, content, tags_json,
                        importance, is_pinned, access_count, token_count,
                        embedding, expires_at, last_accessed_at, created_at
                    ) VALUES (?, ?, ?, ?, ?, 'interaction', 'assistant', ?, ?, '[]', 0.5, 0, 0, ?, ?, ?, ?, ?)
                    """,
                    (
                        mem_id,
                        norm_app,
                        norm_agent,
                        conversation_id or "",
                        request_id or "",
                        clean_prompt[:1500],
                        combined,
                        est_tokens,
                        emb_str,
                        expires_iso,
                        now_iso,
                        now_iso,
                    ),
                )
            self.prune_agent_memories(
                norm_app,
                norm_agent,
                max_records=int(cfg.get("hafiza_max_kayit") or 1000),
                retention_days=retention_days,
            )
            return mem_id
        except Exception as exc:
            gateway_logger.warning(f"Ajan hafıza kaydı yazılamadı ({norm_app}:{norm_agent}): {exc}")
            return None

    def prune_agent_memories(
        self,
        app_id: str,
        agent_id: str,
        max_records: int = 1000,
        retention_days: int = 30,
    ) -> int:
        """
        (app_id, agent_id) için:
        1. Süresi dolmuş (expires_at < now) ve sabitlenmemiş (is_pinned = 0) kayıtları temizler.
        2. Toplam kayıt sayısı `max_records` sınırını aşıyorsa en eski ve en az erişilen kayıtları siler.
        """
        norm_app, norm_agent = self.normalize_identity(app_id, agent_id)
        if not norm_agent or not norm_app:
            return 0

        now_iso = datetime.now(timezone.utc).isoformat()
        deleted_total = 0
        try:
            with postgres_db.connection() as conn:
                res_ttl = conn.execute(
                    """
                    DELETE FROM agent_memories
                    WHERE app_id = ? AND agent_id = ?
                      AND is_pinned = 0
                      AND expires_at IS NOT NULL AND expires_at != ''
                      AND expires_at < ?
                    """,
                    (norm_app, norm_agent, now_iso),
                )
                deleted_total += res_ttl.rowcount

                cnt_row = conn.execute(
                    "SELECT COUNT(1) AS c FROM agent_memories WHERE app_id = ? AND agent_id = ?",
                    (norm_app, norm_agent),
                ).fetchone()
                total_cnt = int(cnt_row["c"] or 0) if cnt_row else 0

                if total_cnt > max_records:
                    excess = total_cnt - max_records
                    old_rows = conn.execute(
                        """
                        SELECT id FROM agent_memories
                        WHERE app_id = ? AND agent_id = ? AND is_pinned = 0
                        ORDER BY importance ASC, access_count ASC, created_at ASC
                        LIMIT ?
                        """,
                        (norm_app, norm_agent, excess),
                    ).fetchall()
                    for r in old_rows:
                        conn.execute("DELETE FROM agent_memories WHERE id = ?", (r["id"],))
                        deleted_total += 1
        except Exception as exc:
            gateway_logger.warning(f"Ajan hafıza temizliği hatası ({norm_app}:{norm_agent}): {exc}")
        return deleted_total

    def search_agent_memory(
        self,
        app_id: str,
        agent_id: str,
        query: str,
        memory_type: str = "all",
        top_k: int = 5,
    ) -> Dict[str, Any]:
        """
        (app_id, agent_id) birleşik anahtarına ait `agent_memories` tablosunda
        pgvector kosinüs benzerliği (`embedding <=> query_vec`) + kelime eşleşmesi ile
        hibrit arama yapar ve token bütçesi sınırına uygun sonuçları döner.
        """
        norm_app, norm_agent = self.normalize_identity(app_id, agent_id)
        clean_query = (query or "").strip()
        effective_k = max(1, min(15, int(top_k or 5)))

        if not norm_agent or not norm_app or not clean_query:
            return {"app_id": norm_app, "agent_id": norm_agent, "results": [], "total_found": 0}

        query_vec = self.compute_embedding_384(clean_query)
        like_pattern = f"%{clean_query[:80]}%"
        now_iso = datetime.now(timezone.utc).isoformat()

        type_filter_sql = ""
        params: List[Any] = [query_vec, like_pattern, norm_app, norm_agent]
        if memory_type and memory_type not in ("all", "*"):
            type_filter_sql = " AND memory_type = ? "
            params.append(memory_type)
        params.extend([query_vec, effective_k])

        sql = f"""
            SELECT id, conversation_id, memory_type, prompt_text, content,
                   tags_json, importance, is_pinned, access_count, created_at,
                   (1.0 - (embedding <=> ?::vector)) AS vector_score,
                   CASE WHEN content ILIKE ? THEN 0.35 ELSE 0.0 END AS keyword_boost
            FROM agent_memories
            WHERE app_id = ? AND agent_id = ?
            {type_filter_sql}
            ORDER BY is_pinned DESC,
                     ((1.0 - (embedding <=> ?::vector)) + CASE WHEN content ILIKE '{postgres_db._open_pg_connection().format_sql_value(like_pattern)[1:-1]}' THEN 0.35 ELSE 0.0 END) DESC,
                     created_at DESC
            LIMIT ?
        """

        results: List[Dict[str, Any]] = []
        used_chars = 0

        try:
            with postgres_db.connection() as conn:
                rows = conn.execute(
                    f"""
                    SELECT id, conversation_id, memory_type, prompt_text, content,
                           tags_json, importance, is_pinned, access_count, created_at,
                           (1.0 - (embedding <=> ?::vector)) AS vector_score
                    FROM agent_memories
                    WHERE app_id = ? AND agent_id = ?
                    {type_filter_sql}
                    ORDER BY is_pinned DESC, (embedding <=> ?::vector) ASC, created_at DESC
                    LIMIT ?
                    """,
                    (
                        [query_vec, norm_app, norm_agent, memory_type, query_vec, effective_k]
                        if type_filter_sql
                        else [query_vec, norm_app, norm_agent, query_vec, effective_k]
                    ),
                ).fetchall()

                for r in rows:
                    snippet = str(r["content"] or "")
                    if used_chars + len(snippet) > MAX_RETRIEVAL_TOTAL_CHARS:
                        remaining = max(200, MAX_RETRIEVAL_TOTAL_CHARS - used_chars)
                        snippet = snippet[:remaining] + "..."
                    used_chars += len(snippet)

                    score_val = float(r.get("vector_score") or 0.0)
                    if clean_query.lower() in snippet.lower():
                        score_val = min(1.0, score_val + 0.25)

                    results.append(
                        {
                            "memory_id": r["id"],
                            "memory_type": r["memory_type"],
                            "similarity_score": round(score_val, 4),
                            "is_pinned": bool(r["is_pinned"]),
                            "created_at": r["created_at"],
                            "conversation_id": r["conversation_id"],
                            "content": snippet,
                        }
                    )
                    conn.execute(
                        "UPDATE agent_memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?",
                        (now_iso, r["id"]),
                    )
                    if used_chars >= MAX_RETRIEVAL_TOTAL_CHARS:
                        break
        except Exception as exc:
            gateway_logger.warning(f"pgvector hafıza arama hatası ({norm_app}:{norm_agent}): {exc}")

        return {
            "app_id": norm_app,
            "agent_id": norm_agent,
            "query": clean_query,
            "total_found": len(results),
            "results": results,
        }

    def save_explicit_agent_memory(
        self,
        app_id: str,
        agent_id: str,
        conversation_id: str,
        content: str,
        memory_type: str = "fact",
        importance: float = 0.8,
        is_pinned: bool = False,
        tags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Ajanın `thinkport_memory_save` aracını çağırarak kaydettiği bilgiyi pgvector tablosuna yazar."""
        norm_app, norm_agent = self.normalize_identity(app_id, agent_id)
        clean_content = (content or "").strip()
        if not norm_agent or not norm_app or not clean_content:
            return {"status": "error", "message": "Geçerli (app_id, agent_id) ve içerik zorunludur."}

        cfg = self.ensure_agent_registered_and_get_config(norm_app, norm_agent)
        if len(clean_content) > MAX_SINGLE_MEMORY_CHARS:
            clean_content = clean_content[:MAX_SINGLE_MEMORY_CHARS]

        emb_str = self.compute_embedding_384(clean_content)
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.isoformat()
        retention_days = max(1, int(cfg.get("hafiza_saklama_gun") or 30))
        expires_iso = "" if is_pinned else (now_dt + timedelta(days=retention_days)).isoformat()
        mem_id = f"mem_{uuid.uuid4().hex[:18]}"
        valid_type = memory_type if memory_type in ("fact", "rule", "summary", "interaction") else "fact"
        clamped_imp = max(0.1, min(1.0, float(importance or 0.8)))

        with postgres_db.connection() as conn:
            conn.execute(
                """
                INSERT INTO agent_memories (
                    id, app_id, agent_id, conversation_id, request_id,
                    memory_type, role, prompt_text, content, tags_json,
                    importance, is_pinned, access_count, token_count,
                    embedding, expires_at, last_accessed_at, created_at
                ) VALUES (?, ?, ?, ?, '', ?, 'assistant', '', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
                """,
                (
                    mem_id,
                    norm_app,
                    norm_agent,
                    conversation_id or "",
                    valid_type,
                    clean_content,
                    json.dumps(tags or [], ensure_ascii=False),
                    clamped_imp,
                    1 if is_pinned else 0,
                    max(1, len(clean_content) // 4),
                    emb_str,
                    expires_iso,
                    now_iso,
                    now_iso,
                ),
            )

        self.prune_agent_memories(
            norm_app,
            norm_agent,
            max_records=int(cfg.get("hafiza_max_kayit") or 1000),
            retention_days=retention_days,
        )
        return {
            "status": "saved",
            "memory_id": mem_id,
            "app_id": norm_app,
            "agent_id": norm_agent,
            "memory_type": valid_type,
            "is_pinned": bool(is_pinned),
        }

    def recall_agent_conversations(
        self,
        app_id: str,
        agent_id: str,
        query: str = "",
        limit: int = 5,
    ) -> Dict[str, Any]:
        """Aynı (app_id, agent_id) ajan kimliğinin geçmiş sohbet oturumlarındaki mesaj özetlerini getirir."""
        norm_app, norm_agent = self.normalize_identity(app_id, agent_id)
        if not norm_agent or not norm_app:
            return {"app_id": norm_app, "agent_id": norm_agent, "turns": []}
        take = max(1, min(10, int(limit or 5)))
        items: List[Dict[str, Any]] = []
        with postgres_db.connection() as conn:
            if query and query.strip():
                like_q = f"%{query.strip()[:80]}%"
                rows = conn.execute(
                    """
                    SELECT m.conversation_id, m.role, m.content, m.created_at, c.title
                    FROM chat_messages m
                    JOIN chat_conversations c ON c.id = m.conversation_id
                    WHERE c.app_id = ? AND c.agent_id = ? AND c.is_deleted = 0
                      AND m.content ILIKE ?
                    ORDER BY m.created_at DESC
                    LIMIT ?
                    """,
                    (norm_app, norm_agent, like_q, take),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT m.conversation_id, m.role, m.content, m.created_at, c.title
                    FROM chat_messages m
                    JOIN chat_conversations c ON c.id = m.conversation_id
                    WHERE c.app_id = ? AND c.agent_id = ? AND c.is_deleted = 0
                    ORDER BY m.created_at DESC
                    LIMIT ?
                    """,
                    (norm_app, norm_agent, take),
                ).fetchall()

            for r in rows:
                items.append(
                    {
                        "conversation_id": r["conversation_id"],
                        "conversation_title": r["title"],
                        "role": r["role"],
                        "content": str(r["content"] or "")[:800],
                        "created_at": r["created_at"],
                    }
                )
        return {
            "app_id": norm_app,
            "agent_id": norm_agent,
            "turns": items,
        }

    def execute_gateway_memory_tool(
        self,
        tool_name: str,
        raw_arguments: Any,
        app_id: str,
        agent_id: str,
        conversation_id: str = "",
    ) -> str:
        """
        LLM tarafından çağrılan `thinkport_memory_*` aracını think-port-api içerisinde çalıştırır
        ve JSON string olarak sonucu döner.
        """
        args: Dict[str, Any] = {}
        if isinstance(raw_arguments, dict):
            args = raw_arguments
        elif isinstance(raw_arguments, str) and raw_arguments.strip():
            try:
                parsed = json.loads(raw_arguments)
                if isinstance(parsed, dict):
                    args = parsed
            except Exception:
                args = {"query": raw_arguments.strip()}

        if tool_name == "thinkport_memory_search":
            res = self.search_agent_memory(
                app_id=app_id,
                agent_id=agent_id,
                query=str(args.get("query") or ""),
                memory_type=str(args.get("memory_type") or "all"),
                top_k=int(args.get("top_k") or 5),
            )
            return json.dumps(res, ensure_ascii=False)

        if tool_name == "thinkport_memory_save":
            res = self.save_explicit_agent_memory(
                app_id=app_id,
                agent_id=agent_id,
                conversation_id=conversation_id,
                content=str(args.get("content") or ""),
                memory_type=str(args.get("memory_type") or "fact"),
                importance=float(args.get("importance") or 0.8),
                is_pinned=bool(args.get("is_pinned", False)),
                tags=args.get("tags") if isinstance(args.get("tags"), list) else [],
            )
            return json.dumps(res, ensure_ascii=False)

        if tool_name == "thinkport_conversation_recall":
            res = self.recall_agent_conversations(
                app_id=app_id,
                agent_id=agent_id,
                query=str(args.get("query") or ""),
                limit=int(args.get("limit") or 5),
            )
            return json.dumps(res, ensure_ascii=False)

        if tool_name == "thinkport_rag_search":
            from app.services.rag_document_service import rag_document_service
            res = rag_document_service.search_cloud_documents(
                query=str(args.get("query") or ""),
                app_id=app_id or "WEBAKUS_ERP",
                file_name=str(args.get("file_name") or "") or None,
                belge_turu=str(args.get("belge_turu") or "") or None,
                top_k=int(args.get("top_k") or 8),
            )
            return json.dumps(res, ensure_ascii=False)

        return json.dumps({"error": f"Bilinmeyen hafıza aracı: {tool_name}"}, ensure_ascii=False)

    # ─── GÖZLEMCİ AJAN (GOZLEMCI_AJAN) KESİNTİ TESPİT & OTOMATİK DEVAM ─────────

    @staticmethod
    def get_observer_agent_config() -> Optional[Dict[str, Any]]:
        """
        Veritabanındaki `ai_agents` tablosundan `GOZLEMCI_AJAN` kaydını (sistem istemi, model, sıcaklık, aktiflik) okur.
        Veritabanı tek otoritedir; kod içinde sabit (hardcoded) sistem istemi tutulmaz.
        """
        try:
            with postgres_db.connection() as conn:
                row = conn.execute(
                    """
                    SELECT id, ad, kod, sistem_istemi, kurallar_json, model_adi, sicaklik, max_tokens, aktif_mi
                    FROM ai_agents
                    WHERE LOWER(TRIM(kod)) = 'gozlemci_ajan'
                    LIMIT 1
                    """
                ).fetchone()
                if not row or not bool(row.get("aktif_mi", 1)):
                    return None
                return {
                    "id": int(row["id"]),
                    "ad": str(row.get("ad") or "GOZLEMCI_AJAN"),
                    "kod": str(row.get("kod") or "GOZLEMCI_AJAN"),
                    "sistem_istemi": str(row.get("sistem_istemi") or "").strip(),
                    "model_adi": str(row.get("model_adi") or "gpt-4o").strip(),
                    "sicaklik": float(row["sicaklik"] if row.get("sicaklik") is not None else 0.2),
                    "max_tokens": int(row.get("max_tokens") or 2048),
                    "aktif_mi": True,
                }
        except Exception as exc:
            gateway_logger.warning(f"GOZLEMCI_AJAN veritabanı yapılandırması okunamadı: {exc}")
            return None

    @staticmethod
    def get_observer_tools_schema() -> List[Dict[str, Any]]:
        """
        Veritabanında GOZLEMCI_AJAN'a tanımlı `observer_continue_generation` aracının
        OpenAI Function Calling uyumlu şemasını döner.
        """
        return [
            {
                "type": "function",
                "function": {
                    "name": "observer_continue_generation",
                    "description": (
                        "Birincil LLM tarafından üretilen yanıtı veya araç çağrısını (tool_calls) kullanıcı istemi ve "
                        "ekli belgeyle karşılaştırarak eksiksiz olup olmadığını denetler; kesinti veya eksik tablo/satır "
                        "varsa birincil modele gönderilecek devam istemini (continuation_prompt) üretir."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "is_complete": {
                                "type": "boolean",
                                "description": (
                                    "Kullanıcının talep ettiği tüm veriler, tablolar ve satırlar eksiksiz aktarıldıysa true; "
                                    "token sınırı kesintisi varsa veya belgede henüz aktarılmamış tablo/satırlar kaldıysa false."
                                ),
                            },
                            "reason": {
                                "type": "string",
                                "description": "Kesinti veya eksiklik tespitinin nedeni.",
                            },
                            "continuation_prompt": {
                                "type": "string",
                                "description": (
                                    "is_complete=false olduğunda birincil modele gönderilecek; önceki çıkarılan kayıtları "
                                    "tekrarlamadan tam olarak hangi tablo ve satırdan devam ederek kalan tüm kayıtları "
                                    "üretmesi gerektiğini belirten devam yönergesi."
                                ),
                            },
                        },
                        "required": ["is_complete", "reason", "continuation_prompt"],
                    },
                },
            }
        ]

    @classmethod
    def salvage_generic_json_arguments(
        cls,
        raw_args: str,
    ) -> Tuple[Optional[Dict[str, Any]], bool, str]:
        """
        Herhangi bir alan veya iş kuralı bilmeden (tamamen jenerik olarak) `tool_calls` JSON argümanını ayrıştırır.
        Eğer çıktı token sınırından dolayı JSON dizisinin ortasında kesilmişse, tamamlanmış tüm `{...}`
        nesnelerini kurtarır ve `(salvaged_dict, is_truncated, cut_off_tail)` döner.
        """
        cleaned = (raw_args or "").strip()
        if not cleaned:
            return (None, False, "")

        has_trailing_ellipsis = "..." in cleaned[-60:] or '".."' in cleaned[-40:]
        if not has_trailing_ellipsis:
            try:
                parsed = json.loads(cleaned)
                if isinstance(parsed, dict):
                    return (parsed, False, "")
            except Exception:
                pass

        # Jenerik açık dizi kurtarma: JSON içindeki son açık `"<key>": [` dizisini bul
        array_matches = list(re.finditer(r'"([^"\\]+)"\s*:\s*\[', cleaned))
        if not array_matches:
            return (None, True, cleaned[-200:])

        target_match = array_matches[-1]
        arr_key = target_match.group(1)
        arr_start = target_match.end()
        prefix_before_key = cleaned[: target_match.start()].rstrip().rstrip(",")

        decoder = json.JSONDecoder()
        complete_items: List[Any] = []
        idx = arr_start
        n = len(cleaned)
        last_good_end = arr_start

        while idx < n:
            while idx < n and cleaned[idx] in " \t\r\n,":
                idx += 1
            if idx >= n or cleaned[idx] == "]":
                break
            try:
                item_obj, next_idx = decoder.raw_decode(cleaned, idx)
                item_raw = cleaned[idx:next_idx]
                if "..." in item_raw or '".."' in item_raw:
                    break
                complete_items.append(item_obj)
                last_good_end = next_idx
                idx = next_idx
            except Exception:
                break

        cut_off_tail = cleaned[last_good_end:].strip()

        # Üst JSON nesnesini jenerik olarak kapatmayı dene
        salvaged_root: Optional[Dict[str, Any]] = None
        for closing_braces_count in range(1, 4):
            candidate = prefix_before_key
            if candidate and not candidate.endswith("{"):
                candidate = candidate + ", "
            candidate = candidate + f'"{arr_key}": ' + json.dumps(complete_items, ensure_ascii=False) + ("}" * closing_braces_count)
            try:
                obj = json.loads(candidate)
                if isinstance(obj, dict):
                    salvaged_root = obj
                    break
            except Exception:
                continue

        if salvaged_root is None:
            salvaged_root = {arr_key: complete_items}

        return (salvaged_root, True, cut_off_tail[:240])

    @classmethod
    def count_json_array_items(cls, obj: Any) -> int:
        """JSON nesnesi içindeki dizi (list) elemanlarının toplam sayısını jenerik olarak döner."""
        if isinstance(obj, list):
            return len(obj)
        if isinstance(obj, dict):
            total = 0
            for v in obj.values():
                if isinstance(v, list):
                    total += len(v)
                elif isinstance(v, dict):
                    total += cls.count_json_array_items(v)
            return total
        return 0

    @classmethod
    def extract_last_array_items(cls, obj: Any, take: int = 5) -> List[Any]:
        """JSON nesnesi içindeki en son dizinin son `take` adet elemanını jenerik olarak döner."""
        if isinstance(obj, list):
            return obj[-take:]
        if isinstance(obj, dict):
            last_found: List[Any] = []
            for v in obj.values():
                if isinstance(v, list) and v:
                    last_found = v[-take:]
                elif isinstance(v, dict):
                    sub = cls.extract_last_array_items(v, take)
                    if sub:
                        last_found = sub
            return last_found
        return []

    @classmethod
    def build_compact_continuation_preview(cls, obj: Any) -> Any:
        """
        Devam turlarında birincil modelin önceki 50-100 kaydı baştan tekrar üretmesini
        ve girdi token sınırını şişirmesini önlemek için büyük dizilerin yalnızca
        ilk 2 ve son 4 elemanını koruyan kompakt bir JSON özeti döner.
        """
        if isinstance(obj, list):
            if len(obj) <= 6:
                return obj
            omitted = len(obj) - 6
            return (
                obj[:2]
                + [{"_bilgi": f"... aradaki {omitted} kayıt önceki turda başarıyla kaydedildi ..."}]
                + obj[-4:]
            )
        if isinstance(obj, dict):
            return {k: cls.build_compact_continuation_preview(v) for k, v in obj.items()}
        return obj

    @classmethod
    def format_indexed_array_summary(cls, obj: Any) -> str:
        """
        GOZLEMCI_AJAN'ın çıkarılan dizi elemanlarının sırasını (#1..#N) net görebilmesi için
        dizi elemanlarını sıra numarasıyla listeler.
        """
        lines: List[str] = []

        def _walk(node: Any, prefix: str = "") -> None:
            if isinstance(node, dict):
                for k, v in node.items():
                    path = f"{prefix}.{k}" if prefix else k
                    if isinstance(v, list) and v:
                        lines.append(f"Dizi `{path}` (Toplam {len(v)} kayıt):")
                        for idx, item in enumerate(v, start=1):
                            lines.append(f"  #{idx}: {json.dumps(item, ensure_ascii=False)}")
                    elif isinstance(v, dict):
                        _walk(v, path)

        _walk(obj)
        return "\n".join(lines) if lines else json.dumps(obj, ensure_ascii=False)

    @classmethod
    def merge_generic_json_arguments(
        cls,
        base_obj: Dict[str, Any],
        next_obj: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], int]:
        """
        İki ardışık `tool_calls` JSON nesnesini hiçbir alan adı varsayımı yapmadan jenerik olarak birleştirir.
        Dizi (`list`) olan alanlarda mükerrer olmayan yeni elemanları mevcut dizinin sonuna ekler.
        Dönüş: `(merged_dict, added_items_count)`
        """
        merged = json.loads(json.dumps(base_obj, ensure_ascii=False))
        added_count = 0

        def _merge_dict(target: Dict[str, Any], source: Dict[str, Any]) -> None:
            nonlocal added_count
            for k, src_val in source.items():
                if src_val is None:
                    continue
                if k not in target or target[k] is None or target[k] == "":
                    target[k] = src_val
                    if isinstance(src_val, list):
                        added_count += len(src_val)
                elif isinstance(target[k], list) and isinstance(src_val, list):
                    existing_fingerprints = {
                        json.dumps(item, sort_keys=True, ensure_ascii=False)
                        for item in target[k]
                    }
                    for item in src_val:
                        fp = json.dumps(item, sort_keys=True, ensure_ascii=False)
                        if fp not in existing_fingerprints:
                            target[k].append(item)
                            existing_fingerprints.add(fp)
                            added_count += 1
                elif isinstance(target[k], dict) and isinstance(src_val, dict):
                    _merge_dict(target[k], src_val)

        _merge_dict(merged, next_obj)
        return (merged, added_count)

    @classmethod
    def detect_response_truncation(
        cls,
        content: str,
        finish_reason: Optional[str],
        is_json_mode: bool = False,
    ) -> Tuple[bool, str]:
        """
        Yanıtın token yetmezliği veya yapısal kesilme nedeniyle yarıda kalıp kalmadığını tespit eder.
        (kesildi_mi, kesilme_nedeni) döner.
        """
        text = (content or "").strip()
        if not text:
            if finish_reason == "length":
                return (True, "finish_reason_length")
            return (False, "")

        if finish_reason == "length":
            return (True, "finish_reason_length")

        # Açık kalan markdown kod bloğu (tek sayıda ```)
        fence_count = len(re.findall(r"```", text))
        if fence_count % 2 == 1:
            return (True, "unclosed_code_fence")

        # JSON modunda veya JSON bloğu içeriyorsa dengesiz süslü/köşeli parantez kontrolü
        if is_json_mode or text.startswith("{") or "```json" in text:
            open_braces = text.count("{") - text.count("}")
            open_brackets = text.count("[") - text.count("]")
            if open_braces > 0 or open_brackets > 0:
                return (True, "unclosed_json_structure")
            return (False, "")

        # Noktalı virgül (;) ayraca sahip tablo / CSV çıktılarında satır ortası veya sadece başlıkta kesilme kontrolü
        table_lines = [
            ln.strip()
            for ln in text.splitlines()
            if ln.strip() and not ln.strip().startswith("```")
        ]
        if table_lines:
            starts_with_meta = table_lines[0].startswith("#")
            semicolon_line_count = sum(1 for ln in table_lines if ";" in ln)
            header_line, expected_cols = cls.detect_csv_header_info(text)
            non_comment_lines = [ln for ln in table_lines if not ln.startswith("#")]
            if starts_with_meta and len(non_comment_lines) <= 1 and (not header_line or non_comment_lines == [header_line]):
                return (True, "incomplete_delimited_header")
            if starts_with_meta or (len(table_lines) >= 3 and semicolon_line_count >= len(table_lines) - 1):
                last_ln = table_lines[-1]
                if last_ln.startswith("#"):
                    if "=" not in last_ln or last_ln[-1] in ("-", "=", ";"):
                        return (True, "incomplete_delimited_header")
                    return (True, "incomplete_delimited_header")
                if ";" not in last_ln:
                    return (True, "incomplete_delimited_row")
                parts = [p.strip() for p in last_ln.split(";")]
                if len(parts) < max(2, expected_cols) or any(not p for p in parts):
                    return (True, "incomplete_delimited_row")
                if any(p[-1] in (",", ".", "-", "=") for p in parts[1:]):
                    return (True, "incomplete_delimited_row")

        return (False, "")

    @staticmethod
    def detect_csv_header_info(csv_text: str) -> Tuple[str, int]:
        """CSV metnindeki sütun başlığı satırını ve beklenen sütun sayısını tespit eder (varsayılan: 2)."""
        header_keywords = (
            "urunkodu",
            "ürünkodu",
            "kod",
            "urun_kodu",
            "model",
            "tablono",
            "tablo_no",
        )
        for raw_ln in (csv_text or "").splitlines():
            s = raw_ln.strip()
            if not s or s.startswith("#") or s.startswith("```") or ";" not in s:
                continue
            parts = [p.strip() for p in s.split(";")]
            if len(parts) >= 2 and parts[0].lower() in header_keywords and all(bool(p) for p in parts):
                return (";".join(parts), len(parts))
        return ("", 2)

    @staticmethod
    def is_valid_csv_data_row(line: str, expected_cols: int = 2) -> bool:
        """Verilen satırın eksiksiz bir noktalı virgüllü CSV veri satırı olup olmadığını kontrol eder."""
        s = (line or "").strip()
        if not s or ";" not in s or s.startswith("#") or s.startswith("```"):
            return False
        parts = [p.strip() for p in s.split(";")]
        min_cols = max(2, expected_cols or 2)
        if len(parts) < min_cols or any(not p for p in parts[:min_cols]):
            return False
        if parts[0].lower() in (
            "urunkodu",
            "ürünkodu",
            "kod",
            "urun_kodu",
            "model",
            "tablono",
            "tablo_no",
        ):
            return False
        if " " in parts[0] or len(parts[0]) < 4:
            return False
        if any(p[-1] in (",", ".", "-", "=") for p in parts[1:] if p):
            return False
        if not re.search(r"\d", parts[1]):
            return False
        return True

    @classmethod
    def prepare_csv_chunk_for_continuation(
        cls,
        csv_text: str,
        finish_reason: Optional[str],
    ) -> Tuple[str, List[str], Optional[str], Optional[str], str]:
        """
        Kesilen bir CSV/tablo parçasını bir sonraki devam (continuation) turuna hazırlar.
        Token sınırına (`finish_reason == 'length'`) çarpıldığında en son satır rakam/kod ortasından
        bölünmüş olabileceği için son satırı güvenli biçimde ayırır ve gözlemciye ipucu (`cut_off_fragment`)
        olarak iletilmek üzere saklar.
        Dönüş: `(clean_prefix_csv, data_rows, last_valid_data_row, dropped_complete_row, cut_off_fragment)`
        """
        lines = [
            ln.strip()
            for ln in (csv_text or "").splitlines()
            if ln.strip() and not ln.strip().startswith("```")
        ]
        _, expected_cols = cls.detect_csv_header_info(csv_text)
        dropped_complete_row: Optional[str] = None
        removed_fragments: List[str] = []

        if finish_reason == "length" and lines:
            popped = lines.pop()
            removed_fragments.append(popped)
            if cls.is_valid_csv_data_row(popped, expected_cols=expected_cols):
                dropped_complete_row = popped

        while lines:
            tail = lines[-1]
            if tail.startswith("#"):
                has_delim = any(ch in tail for ch in ("=", ";", ":"))
                if not has_delim or tail[-1] in ("-", "=", ";", ":"):
                    removed_fragments.append(lines.pop())
                break
            first_col = tail.split(";", 1)[0].strip().lower() if ";" in tail else ""
            if first_col in (
                "urunkodu",
                "ürünkodu",
                "kod",
                "urun_kodu",
                "model",
                "tablono",
                "tablo_no",
            ):
                parts_hdr = [p.strip() for p in tail.split(";")]
                if len(parts_hdr) < 2 or any(not p for p in parts_hdr):
                    removed_fragments.append(lines.pop())
                break
            if not cls.is_valid_csv_data_row(tail, expected_cols=expected_cols):
                removed_fragments.append(lines.pop())
            else:
                break

        cut_off_fragment = "\n".join(reversed(removed_fragments)).strip()
        data_rows = [
            ln for ln in lines if cls.is_valid_csv_data_row(ln, expected_cols=expected_cols)
        ]
        if not lines:
            return ("", [], None, dropped_complete_row, cut_off_fragment)

        return (
            "\n".join(lines),
            data_rows,
            data_rows[-1] if data_rows else None,
            dropped_complete_row,
            cut_off_fragment,
        )

    @staticmethod
    def extract_post_anchor_document_window(
        document_text: str,
        anchor_code: str,
        prev_codes: Optional[List[str]] = None,
        pre_chars: int = 300,
        post_chars: int = 2500,
    ) -> str:
        """
        Uzun belge metinlerinde son çıkarılan kodun (`anchor_code`) geçtiği konumu bularak
        hemen sonrasındaki ~2.500 karakterlik odaklanmış belge kesitini (Zoom-In Context) döner.
        Böylece benzer ön ekli ardışık kodların uzun metin içinde gözden kaçması önlenir.
        """
        doc = document_text or ""
        code = (anchor_code or "").strip()
        if not doc or len(doc) < 600 or len(code) < 3:
            return ""

        matches = list(re.finditer(re.escape(code), doc, re.IGNORECASE))
        if not matches:
            return ""

        chosen_match = matches[0]
        if len(matches) > 1 and prev_codes:
            clean_prev = [
                c.strip().upper() for c in prev_codes if c and len(c.strip()) >= 3
            ]
            best_score = -1
            for m in matches:
                lookback = doc[max(0, m.start() - 1500) : m.start()].upper()
                score = sum(1 for pc in clean_prev if pc in lookback)
                if score > best_score:
                    best_score = score
                    chosen_match = m

        start_idx = max(0, chosen_match.start() - pre_chars)
        end_idx = min(len(doc), chosen_match.end() + post_chars)
        prefix_ellipsis = "...\n" if start_idx > 0 else ""
        suffix_ellipsis = "\n..." if end_idx < len(doc) else ""
        return f"{prefix_ellipsis}{doc[start_idx:end_idx].strip()}{suffix_ellipsis}"

    @staticmethod
    def _extract_item_code_candidates(items: List[Any]) -> List[str]:
        """Araç çağrısı dizi elemanlarından boşluksuz ürün/model kodu adaylarını sırasıyla çıkarır."""
        codes: List[str] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            picked = ""
            for k, v in item.items():
                if isinstance(v, str):
                    sv = v.strip()
                    kl = k.lower()
                    if (
                        sv
                        and " " not in sv
                        and len(sv) >= 3
                        and any(tag in kl for tag in ("kod", "code", "sku", "model"))
                    ):
                        picked = sv
                        break
            if not picked:
                for v in item.values():
                    if isinstance(v, str):
                        sv = v.strip()
                        if sv and " " not in sv and len(sv) >= 4:
                            picked = sv
                            break
            if picked:
                codes.append(picked)
        return codes

    @staticmethod
    def _unescape_json_fragment(raw_fragment: str) -> str:
        """
        Kesilmiş (truncated) JSON dizesi içinden yakalanan ham metin parçasını
        Türkçe UTF-8 karakterleri bozmadan (mojibake oluşturmadan) güvenli biçimde çözer.
        """
        if not raw_fragment:
            return ""
        frag = re.sub(r"\\u[0-9a-fA-F]{0,3}$", "", raw_fragment)
        if frag.endswith("\\") and not frag.endswith("\\\\"):
            frag = frag[:-1]
        try:
            val = json.loads(f'"{frag}"')
            if isinstance(val, str):
                return val
        except Exception:
            pass
        return (
            frag.replace("\\n", "\n")
            .replace("\\r", "\r")
            .replace("\\t", "\t")
            .replace('\\"', '"')
            .replace("\\\\", "\\")
        )

    def evaluate_with_observer_agent(
        self,
        llm_provider: Any,
        model_service: Any,
        user_messages: List[Dict[str, Any]],
        primary_content: str,
        primary_tool_name: Optional[str],
        salvaged_tool_args: Optional[Dict[str, Any]],
        is_json_truncated: bool,
        cut_off_tail: str,
        output_mode: str = "auto",
    ) -> Tuple[bool, str, str, bool]:
        """
        Veritabanındaki `GOZLEMCI_AJAN` ajanını (sistem istemi, modeli ve sıcaklığıyla) canlı olarak çalıştırır.
        Birincil LLM'in ürettiği `tool_calls`, CSV/tablo, JSON veya düz metin yanıtını kullanıcı istemi
        ve ekli belgeyle karşılaştırır.
        Dönüş: `(needs_continuation, reason, continuation_prompt, observer_was_truncated)`
        """
        obs_cfg = self.get_observer_agent_config()
        if not obs_cfg:
            return (False, "", "", False)

        obs_system_prompt = obs_cfg["sistem_istemi"]
        if not obs_system_prompt:
            return (False, "", "", False)

        # Sistem/akış yönergesini ve kullanıcının mesajını (ekli belge metni dahil) hazırla
        system_context_parts: List[str] = []
        user_context_parts: List[str] = []
        for m in user_messages:
            role = m.get("role", "user")
            if role in ("system", "developer"):
                system_context_parts.append(str(m.get("content") or ""))
            elif role == "user":
                user_context_parts.append(str(m.get("content") or ""))
        combined_sys_context = "\n\n".join(p for p in system_context_parts if p).strip()
        combined_usr_only = "\n\n".join(p for p in user_context_parts if p).strip()
        combined_user_context = (
            f"[AKTİF SİSTEM VE AKIŞ DÜĞÜMÜ YÖNERGESİ]:\n{combined_sys_context}\n\n{combined_usr_only}".strip()
            if combined_sys_context
            else combined_usr_only
        )

        detected_header_line, expected_csv_cols = self.detect_csv_header_info(
            primary_content or ""
        )
        csv_lines = [
            ln.strip()
            for ln in (primary_content or "").splitlines()
            if self.is_valid_csv_data_row(ln, expected_cols=expected_csv_cols)
        ]
        csv_meta_lines = [
            ln.strip()
            for ln in (primary_content or "").splitlines()
            if ln.strip().startswith("#") and "=" in ln
        ]
        has_meta_line = any(
            ln.upper().startswith("#META") for ln in csv_meta_lines
        )
        has_header_line = bool(detected_header_line)

        effective_mode = output_mode
        if effective_mode == "auto":
            if primary_tool_name and salvaged_tool_args is not None:
                effective_mode = "tool_calls"
            elif csv_lines or has_meta_line:
                effective_mode = "csv"
            elif (primary_content or "").lstrip().startswith(("{", "[", "```json")):
                effective_mode = "json"
            else:
                effective_mode = "text"

        if effective_mode == "tool_calls" and primary_tool_name and salvaged_tool_args is not None:
            total_items = self.count_json_array_items(salvaged_tool_args)
            last_items = self.extract_last_array_items(salvaged_tool_args, 5)
            indexed_summary = self.format_indexed_array_summary(salvaged_tool_args)
            tc_codes = self._extract_item_code_candidates(last_items)
            last_tc_code = tc_codes[-1] if tc_codes else ""
            tc_zoom_window = (
                self.extract_post_anchor_document_window(
                    document_text=combined_usr_only,
                    anchor_code=last_tc_code,
                    prev_codes=tc_codes[:-1],
                )
                if last_tc_code
                else ""
            )
            tc_zoom_section = (
                f"[SON ÇIKARILAN KOD (`{last_tc_code}`) ETRAFINDAKİ ODAKLANMIŞ BELGE KESİTİ (ZOOM-IN CONTEXT)]:\n"
                f"{tc_zoom_window}\n\n"
                if tc_zoom_window
                else ""
            )
            tc_trunc_warning = (
                f"⚠️ KRİTİK FİZİKSEL KESİNTİ UYARISI: Birincil model yanıtı doğal olarak bitirmedi (`finish_reason=length` / JSON kesilmesi) ve `{cut_off_tail or 'son kayıt'}` yazılırken yarıda kesildi! "
                f"Yukarıdaki ODAKLANMIŞ BELGE KESİTİNDE `{last_tc_code or 'son kayıt'}` sonrasında hedef tabloda kalan satırları kontrol etmeden KESİNLİKLE `is_complete=true` DÖNDÜRME!\n"
                if is_json_truncated
                else ""
            )
            inspection_payload = (
                f"[DENETİM TİPİ]: Araç Çağrısı (tool_calls -> `{primary_tool_name}`)\n"
                f"[JSON AKIŞINDA FİZİKSEL KESİLME VAR MI]: {is_json_truncated}\n"
                f"[TOKEN SINIRINDA YARIDA KESİLEN VE LİSTEYE EKLENMEYEN SON İFADE]: {cut_off_tail or '-'}\n"
                f"[ŞU ANA KADAR ÇIKARILAN TOPLAM ELEMAN SAYISI]: {total_items}\n"
                f"[SON ÇIKARILAN 5 ELEMAN (#{max(1, total_items - len(last_items) + 1)}..#{total_items})]: {json.dumps(last_items, ensure_ascii=False)}\n\n"
                f"{tc_zoom_section}"
                f"[ŞU ANA KADAR ÇIKARILAN SIRALI KAYIT LİSTESİ (#1..#{total_items})]:\n{indexed_summary}\n\n"
                f"[KULLANICI İSTEMİ VE EKLİ BELGE İÇERİĞİ]:\n{combined_user_context}\n\n"
                f"[GÖZLEMCİ GÖREVİ — SANAL EXCEL TABLOSU (`UrunKodu;Fiyat`) KARŞILAŞTIRMASI]:\n"
                f"{tc_trunc_warning}"
                f"1) Önce ODAKLANMIŞ BELGE KESİTİNİ ve tam belge metnini inceleyerek YALNIZCA kullanıcının veya sistem yönergesinin talep ettiği hedef tabloları zihninde 1. sütunu (Ürün Grubu/Kategori) atılmış `UrunKodu;Fiyat` formatında 2 sütunlu eksiksiz bir Sanal Excel/CSV Tablosuna dönüştür. "
                f"(Çok sayfalı hedef tabloların devam sayfalarındaki tüm satırlarını ve kapsam dışı tablo başlığından hemen önceki son satırları eksiksiz birleştir; kapsam dışı tutulan bir tablo başlığını gördüğün anda sanal Excel tablosunu sonlandır).\n"
                f"2) Oluşturduğun bu Sanal Excel Tablosunu yukarıdaki #{total_items} kayıtlık sıralı listeyle satır satır karşılaştır:\n"
                f"   - ÇELİŞKİSİZ TAMAMLANMA KURALI: Eğer Sanal Excel Tablosundaki tüm hedef satırlar (kapsam dışı tablo başlığından hemen önceki benzer ön ekli son satırlar dahil) zaten çıkarılmışsa ve eklenecek YENİ bir gerçek satır kalmamışsa KESİNLİKLE `observer_continue_generation` aracını `is_complete=true` ve `continuation_prompt=\"\"` ile çağır!\n"
                f"   - EKSİK SATIRLARI HAZIR EXCEL/CSV (`UrunKodu;Fiyat`) TABLOSU OLARAK VERME KURALI: Eğer Sanal Excel Tablosunda henüz çıkarılmamış veya token sınırında yarıda kesilmiş hedef satırlar varsa `observer_continue_generation` aracını `is_complete=false` ile çağır ve `continuation_prompt` içerisine ÖNCEKİ #{total_items} KAYDI TEKRARLAMADAN yalnızca eksik kalan hedef satırları her satırda `UrunKodu;Fiyat` olacak şekilde listele."
            )
        elif effective_mode == "csv":
            last_csv_row = csv_lines[-1] if csv_lines else ""
            last_csv_code = last_csv_row.split(";", 1)[0].strip() if ";" in last_csv_row else ""
            prev_csv_codes = [
                ln.split(";", 1)[0].strip()
                for ln in csv_lines[-4:-1]
                if ";" in ln
            ]
            csv_zoom_window = (
                self.extract_post_anchor_document_window(
                    document_text=combined_usr_only,
                    anchor_code=last_csv_code,
                    prev_codes=prev_csv_codes,
                )
                if last_csv_code
                else ""
            )
            csv_zoom_section = (
                f"[SON ÇIKARILAN KOD (`{last_csv_code}`) ETRAFINDAKİ ODAKLANMIŞ BELGE KESİTİ (ZOOM-IN CONTEXT)]:\n"
                f"{csv_zoom_window}\n\n"
                if csv_zoom_window
                else ""
            )
            clean_cut_hint = (
                cut_off_tail.strip()
                if cut_off_tail
                and cut_off_tail.strip()
                not in (
                    "finish_reason_length",
                    "incomplete_delimited_row",
                    "incomplete_delimited_header",
                    "observer_output_length",
                    "unclosed_code_fence",
                )
                else ""
            )
            cut_hint_line = (
                f"[TOKEN SINIRINDA YARIDA KESİLEN VE LİSTEYE EKLENMEYEN SATIR PARÇASI]: {clean_cut_hint}\n"
                if clean_cut_hint
                else ""
            )
            csv_trunc_warning = (
                f"⚠️ KRİTİK FİZİKSEL KESİNTİ UYARISI: Birincil akış token sınırına (`finish_reason=length` / kesinti) çarparak durdu"
                + (
                    f" ve `{clean_cut_hint}` satırı yazılırken yarıda kesildiği için yukarıdaki #{len(csv_lines)} satırlık listeye EKLENMEDİ! "
                    if clean_cut_hint
                    else "! "
                )
                + f"Yukarıdaki ODAKLANMIŞ BELGE KESİTİNDE `{last_csv_code or 'son satır'}` satırından hemen sonra gelen (kapsam dışı tablo başlığından önceki) kalan hedef satırları tek tek kontrol etmeden KESİNLİKLE `is_complete=true` DÖNDÜRME!\n"
                if is_json_truncated
                else ""
            )
            numbered_csv = (
                "\n".join(f"#{idx + 1}: {ln}" for idx, ln in enumerate(csv_lines))
                if csv_lines
                else "(Henüz geçerli veri satırı çıkarılamadı)"
            )
            csv_schema_label = detected_header_line or "UrunKodu;Fiyat"
            csv_meta_section = (
                "[MEVCUT CSV ÜST BİLGİ / TABLO HARİTASI SATIRLARI]:\n"
                + "\n".join(csv_meta_lines)
                + "\n"
                if csv_meta_lines
                else ""
            )
            meta_directive = (
                ""
                if (has_meta_line and has_header_line)
                else f"0) Mevcut çıktıda `#META` veya sütun başlığı satırı eksik olduğu için `continuation_prompt` metninin en başına kullanıcı/sistem yönergesinde istenen `#META;...` (ve istenmişse `#TABLOLAR;...`) satırını ve hemen altına sütun başlığı (`{csv_schema_label}` vb.) satırını yaz.\n"
            )
            anchor_directive = (
                f"KESİN TEKRARSIZLIK KURALI: Yukarıdaki #{len(csv_lines)} satırın HİÇBİRİNİ (`#1..#{len(csv_lines)}`), `#META`/`#TABLOLAR` satırlarını veya sütun başlığını `continuation_prompt` içine TEKRAR YAZMA! "
                f"Son tamamlanan satır `{last_csv_row}` olduğu için YALNIZCA belgedeki hedef tablolarda `{last_csv_code}` satırından HEMEN SONRA gelen"
                + (
                    f" (`{clean_cut_hint}` olarak yarım kalan satırın tam hali dahil)"
                    if clean_cut_hint
                    else ""
                )
                + f" YENİ satırları `{csv_schema_label}` sütun düzenini birebir koruyarak yaz!"
                if last_csv_row
                else f"Belgedeki yalnızca talep edilen hedef tablolarda yer alan tüm satırları sırasıyla `{csv_schema_label}` formatında yaz."
            )
            inspection_payload = (
                f"[DENETİM TİPİ]: Hafıza / Akış İçin Üretilen Noktalı Virgüllü CSV Tablo Çıktısı\n"
                f"[AKTİF CSV SÜTUN ŞEMASI]: {csv_schema_label} ({expected_csv_cols} sütun)\n"
                f"[AKIŞ KESİNTİSİ / TOKEN SINIRI KESİLMESİ VAR MI]: {is_json_truncated}\n"
                f"[#META SATIRI MEVCUT MU]: {has_meta_line} | [BAŞLIK SATIRI MEVCUT MU]: {has_header_line}\n"
                f"{csv_meta_section}"
                f"[ŞU ANA KADAR ÇIKARILAN TOPLAM CSV VERİ SATIRI SAYISI]: {len(csv_lines)}\n"
                f"[SON TAMAMLANAN CSV SATIRI]: {last_csv_row or '-'}\n"
                f"{cut_hint_line}\n"
                f"{csv_zoom_section}"
                f"[ŞU ANA KADAR ÇIKARILAN SIRALI CSV LİSTESİ (#1..#{len(csv_lines)})]:\n{numbered_csv}\n\n"
                f"[KULLANICI İSTEMİ VE EKLİ BELGE İÇERİĞİ]:\n{combined_user_context}\n\n"
                f"[GÖZLEMCİ GÖREVİ — CSV TABLO DENETİMİ VE DOĞRUDAN TAMAMLAMA]:\n"
                f"{csv_trunc_warning}"
                f"{meta_directive}"
                f"1) Önce yukarıdaki ODAKLANMIŞ BELGE KESİTİNDE `{last_csv_code or '-'}` kodundan hemen sonra (kapsam dışı tutulan tablo başlığından önce) kalan benzer ön ekli veya ardışık satır olup olmadığını, ardından tam belge metninde başka hedef tablo kalıp kalmadığını kontrol et.\n"
                f"2) Eğer tüm hedef tablolardaki bütün satırlar (çok sayfalı hedef tabloların devam sayfaları ve kapsam dışı tablo başlığından hemen önceki en son satırları dahil) eksiksiz çıkarılmışsa ve eklenecek YENİ satır kalmamışsa `observer_continue_generation` aracını `is_complete=true` ve `continuation_prompt=\"\"` ile çağır.\n"
                f"3) Eğer henüz çıkarılmamış veya token sınırıyla yarıda kesilmiş satırlar varsa `observer_continue_generation` aracını `is_complete=false` ile çağır ve `continuation_prompt` içerisine YALNIZCA eksik kalan satırları her satırda `{csv_schema_label}` formatında (1. sütundaki ürün grubu/kategori adını almadan, aktif sütun sayısını ve varsa tablo numarası sütununu birebir koruyarak) alt alta listele.\n"
                f"4) {anchor_directive}"
            )
        elif effective_mode == "json":
            inspection_payload = (
                f"[DENETİM TİPİ]: Yapılandırılmış JSON Yanıtı (content)\n"
                f"[YAPISAL KESİLME / TOKEN SINIRI KESİLMESİ VAR MI]: {is_json_truncated}\n"
                f"[KESİLEN SON İFADE]: {cut_off_tail or (primary_content[-300:] if primary_content else '-')}\n\n"
                f"[ŞU ANA KADAR ÜRETİLEN JSON METNİ]:\n{primary_content}\n\n"
                f"[KULLANICI İSTEMİ VE EKLİ BELGE İÇERİĞİ]:\n{combined_user_context}\n\n"
                f"[GÖZLEMCİ GÖREVİ — JSON TAMAMLAMA DENETİMİ]:\n"
                f"1) Üretilen JSON yanıtı eksiksiz ve geçerliyse `observer_continue_generation` aracını `is_complete=true` ve `continuation_prompt=\"\"` ile çağır.\n"
                f"2) JSON yarıda kesildiyse veya belgedeki talep edilen kayıtlar eksikse `is_complete=false` ile çağır ve `continuation_prompt` içinde birincil modele önceki kısmı tekrarlamadan tam olarak kaldığı karakterden/elemandan itibaren nasıl devam edip JSON'u kapatması gerektiğini net biçimde belirt."
            )
        else:
            inspection_payload = (
                f"[DENETİM TİPİ]: Genel Metin / Markdown / Kod Yanıtı (content)\n"
                f"[YAPISAL KESİLME / TOKEN SINIRI KESİLMESİ VAR MI]: {is_json_truncated}\n"
                f"[SON ÜRETİLEN BÖLÜM]: {cut_off_tail or (primary_content[-350:] if primary_content else '-')}\n\n"
                f"[ŞU ANA KADAR ÜRETİLEN METİN]:\n{primary_content}\n\n"
                f"[KULLANICI İSTEMİ VE EKLİ BELGE İÇERİĞİ]:\n{combined_user_context}\n\n"
                f"[GÖZLEMCİ GÖREVİ — METİN/KOD TAMAMLAMA DENETİMİ]:\n"
                f"1) Yanıt kullanıcının talebini eksiksiz karşılıyorsa ve yarım kalan cümle/kod bloğu yoksa `observer_continue_generation` aracını `is_complete=true` ve `continuation_prompt=\"\"` ile çağır.\n"
                f"2) Yanıt token sınırı nedeniyle yarıda kesildiyse veya eksikse `is_complete=false` ile çağır ve `continuation_prompt` içine önceki metni tekrarlamadan tam olarak kaldığı ifadeden devam etmesini sağlayan net devam yönergesini yaz."
            )

        obs_messages = [
            {"role": "system", "content": obs_system_prompt},
            {"role": "user", "content": inspection_payload},
        ]
        obs_tools = self.get_observer_tools_schema()
        obs_tool_choice = {
            "type": "function",
            "function": {"name": "observer_continue_generation"},
        }

        obs_model_id = model_service.normalize_model_id(obs_cfg["model_adi"])
        web_def = model_service.find_web_model(obs_model_id)
        web_model_name = (web_def.web_model if web_def else None) or "openai-fast"

        collected_obs_tcs: List[Dict[str, Any]] = []
        collected_obs_text: List[str] = []
        obs_finish_holder: List[str] = ["stop"]

        def _on_obs_finish(fr: str) -> None:
            if fr:
                obs_finish_holder[-1] = str(fr)

        try:
            llm_provider.stream_from_pollinations_web(
                web_model_name,
                obs_messages,
                lambda d: collected_obs_text.append(d),
                obs_model_id,
                None,
                obs_cfg["sicaklik"],
                obs_tools,
                obs_tool_choice,
                lambda tcs: collected_obs_tcs.extend(tcs),
                None,
                obs_cfg["max_tokens"],
                _on_obs_finish,
            )
        except Exception as exc:
            gateway_logger.warning(f"GOZLEMCI_AJAN LLM çağrısı hatası: {exc}")

        obs_finish_reason = obs_finish_holder[-1]
        obs_json_truncated = False

        if collected_obs_tcs:
            merged_raw_obs_args = "".join(
                str((tc.get("function") or {}).get("arguments") or "")
                for tc in collected_obs_tcs
                if isinstance(tc, dict)
            ).strip()
            gateway_logger.info(
                f"OBSERVER_RAW_TOOL_OUTPUT | mode={effective_mode} | finish={obs_finish_reason} "
                f"| len={len(merged_raw_obs_args)} | preview={merged_raw_obs_args[:400]}"
            )
            obs_decision: Optional[Dict[str, Any]] = None
            try:
                parsed_obs = json.loads(merged_raw_obs_args)
                if isinstance(parsed_obs, dict):
                    obs_decision = parsed_obs
            except Exception:
                obs_json_truncated = True
                salvaged_obs, _, _ = self.salvage_generic_json_arguments(merged_raw_obs_args)
                if isinstance(salvaged_obs, dict) and (
                    "continuation_prompt" in salvaged_obs or "is_complete" in salvaged_obs
                ):
                    obs_decision = salvaged_obs
                else:
                    m_comp = re.search(
                        r'"is_complete"\s*:\s*(true|false)',
                        merged_raw_obs_args,
                        re.IGNORECASE,
                    )
                    m_reason = re.search(
                        r'"reason"\s*:\s*"((?:[^"\\]|\\.)*)"', merged_raw_obs_args
                    )
                    m_prompt = re.search(
                        r'"continuation_prompt"\s*:\s*"((?:[^"\\]|\\.)*)',
                        merged_raw_obs_args,
                    )
                    if m_comp or m_prompt:
                        obs_decision = {
                            "is_complete": (m_comp.group(1).lower() == "true")
                            if (m_comp and not obs_json_truncated)
                            else False,
                            "reason": self._unescape_json_fragment(m_reason.group(1))
                            if m_reason
                            else "observer_stream_truncated",
                            "continuation_prompt": self._unescape_json_fragment(
                                m_prompt.group(1)
                            )
                            if m_prompt
                            else "",
                        }

            obs_was_truncated = (obs_finish_reason == "length") or obs_json_truncated
            if isinstance(obs_decision, dict):
                is_complete = bool(obs_decision.get("is_complete", False))
                reason = str(obs_decision.get("reason") or "").strip()
                cont_prompt = str(obs_decision.get("continuation_prompt") or "").strip()
                if obs_was_truncated and cont_prompt:
                    is_complete = False
                # Eğer GOZLEMCI_AJAN hem `is_complete=true` hem de yeni CSV/tablo satırları içeren dolu `continuation_prompt`
                # döndürdüyse ("tüm tabloları ben çıkardım" yanılgısı), üretilen verinin çöpe gitmemesi için is_complete=False zorlanır.
                if is_complete and cont_prompt:
                    existing_upper_codes = {
                        ln.split(";", 1)[0].strip().upper()
                        for ln in csv_lines
                        if ";" in ln
                    }
                    cont_has_new_csv = any(
                        self.is_valid_csv_data_row(
                            re.sub(r"^(?:#?\d+[\.\)\:\-\s]+|\-\s+|\*\s+)", "", cln).strip(),
                            expected_cols=2,
                        )
                        and (
                            re.sub(r"^(?:#?\d+[\.\)\:\-\s]+|\-\s+|\*\s+)", "", cln)
                            .strip()
                            .split(";", 1)[0]
                            .strip()
                            .upper()
                            not in existing_upper_codes
                        )
                        for cln in cont_prompt.splitlines()
                        if cln.strip() and not cln.strip().startswith(("```", "#"))
                    )
                    primary_is_tiny = len((primary_content or "").strip()) < 120 and not csv_lines
                    if cont_has_new_csv or (primary_is_tiny and len(cont_prompt) > 80):
                        gateway_logger.info(
                            f"OBSERVER_NONEMPTY_PAYLOAD_OVERRIDE | mode={effective_mode} | "
                            f"cont_len={len(cont_prompt)} | existing_rows={len(csv_lines)}"
                        )
                        is_complete = False
                is_physically_incomplete = bool(is_json_truncated)
                if is_physically_incomplete and is_complete:
                    gateway_logger.info(
                        f"OBSERVER_TRUNCATION_OVERRIDE | mode={effective_mode} | "
                        f"observer_claimed_complete_on_truncated_stream=True | cut_off={cut_off_tail[:120] if cut_off_tail else '-'}"
                    )
                    is_complete = False
                if not is_complete and cont_prompt:
                    return (
                        True,
                        reason or "observer_detected_incomplete_output",
                        cont_prompt,
                        obs_was_truncated,
                    )
                if is_complete:
                    return (False, reason or "complete", "", False)
                if not is_physically_incomplete and not is_json_truncated:
                    return (False, reason or "observer_empty_continuation", "", False)

        # Eğer GOZLEMCI_AJAN düz metin/JSON döndürdüyse ayrıştırmayı dene
        raw_obs_out = "".join(collected_obs_text).strip()
        if raw_obs_out:
            obs_was_truncated = obs_finish_reason == "length"
            try:
                m_json = re.search(r"\{[\s\S]*\}", raw_obs_out)
                if m_json:
                    obs_decision = json.loads(m_json.group(0))
                    is_complete = bool(obs_decision.get("is_complete", False))
                    reason = str(obs_decision.get("reason") or "").strip()
                    cont_prompt = str(obs_decision.get("continuation_prompt") or "").strip()
                    if not is_complete and cont_prompt:
                        return (
                            True,
                            reason or "observer_detected_incomplete_output",
                            cont_prompt,
                            obs_was_truncated,
                        )
                    if is_complete and not is_json_truncated:
                        return (False, reason or "complete", "", False)
            except Exception:
                pass
            if effective_mode == "csv" and ";" in raw_obs_out:
                return (
                    True,
                    "observer_text_csv_extracted",
                    raw_obs_out,
                    obs_was_truncated,
                )

        # Yapısal kesilme varsa veritabanındaki GOZLEMCI_AJAN devam kuralıyla devam ettir
        if is_json_truncated:
            last_item_str = ""
            if salvaged_tool_args is not None:
                last_items = self.extract_last_array_items(salvaged_tool_args, 2)
                if last_items:
                    last_item_str = json.dumps(last_items[-1], ensure_ascii=False)
            elif csv_lines:
                last_item_str = "\n".join(csv_lines[-3:])
            fallback_directive = self.get_observer_continuation_directive(
                tail_snippet=last_item_str or cut_off_tail or (primary_content[-300:] if primary_content else ""),
                reason="truncated_output",
            )
            return (True, "truncated_output_fallback", fallback_directive, False)

        return (False, "complete", "", False)

    @staticmethod
    def get_observer_continuation_directive(tail_snippet: str, reason: str) -> str:
        """
        Veritabanındaki `GOZLEMCI_AJAN` kaydının `DEVAM_ISTEMI_KURALLARI` kuralını / sistem istemini okuyarak
        kesilen yanıtı kaldığı yerden devam ettirecek gözlemci istemini döner.
        """
        rule_text = ""
        try:
            with postgres_db.connection() as conn:
                row = conn.execute(
                    "SELECT kurallar_json, sistem_istemi FROM ai_agents WHERE LOWER(TRIM(kod)) = 'gozlemci_ajan' AND aktif_mi = 1 LIMIT 1"
                ).fetchone()
                if row:
                    raw_rules = str(row.get("kurallar_json") or "").strip()
                    if raw_rules:
                        rules_list = json.loads(raw_rules)
                        if isinstance(rules_list, list):
                            for r in rules_list:
                                if isinstance(r, dict) and str(r.get("id") or "").upper() == "DEVAM_ISTEMI_KURALLARI":
                                    rule_text = str(r.get("icerik") or "").strip()
                                    break
                    if not rule_text and row.get("sistem_istemi"):
                        rule_text = str(row["sistem_istemi"]).strip()
        except Exception:
            pass

        if "{{SON_120_KARAKTER}}" in rule_text:
            return rule_text.replace("{{SON_120_KARAKTER}}", tail_snippet[-160:])
        return f"{rule_text}\n\n{tail_snippet[-200:]}".strip()

    @staticmethod
    def merge_continued_response(prefix: str, continuation: str) -> str:
        """
        Yarıda kesilen ilk yanıt (`prefix`) ile Gözlemci Ajanın aldığı devam yanıtını (`continuation`)
        olası tekrar eden örtüşmeleri (overlap) temizleyerek tek bir bütün yanıt halinde birleştirir.
        """
        if not continuation:
            return prefix
        if not prefix:
            return continuation

        clean_cont = continuation
        # Eğer model devam ederken ```json gibi tekrar başlık açtıysa ve prefix içinde zaten açık fence varsa temizle
        if prefix.count("```") % 2 == 1 and clean_cont.lstrip().startswith("```"):
            first_newline = clean_cont.find("\n")
            if first_newline != -1:
                clean_cont = clean_cont[first_newline + 1 :]

        # Son 120 karakter içinde örtüşme (overlap) kontrolü
        tail = prefix[-120:]
        max_overlap = 0
        for size in range(min(len(tail), len(clean_cont)), 4, -1):
            if tail.endswith(clean_cont[:size]):
                max_overlap = size
                break

        if max_overlap > 0:
            return prefix + clean_cont[max_overlap:]
        return prefix + clean_cont

    @classmethod
    def merge_csv_continuation(cls, prefix_csv: str, cont_text: str) -> Tuple[str, int]:
        """
        İlk turda üretilen CSV (`UrunKodu;Fiyat` veya `UrunKodu;Fiyat;TabloNo` vb.) metnine,
        devam turundan veya gözlemciden gelen yeni satırları sütun yapısını ve `#...` üst veri
        satırlarını koruyarak mükerrerlik oluşturmadan ekler.
        """
        if not cont_text:
            return (prefix_csv, 0)

        header_keywords = (
            "urunkodu",
            "ürünkodu",
            "kod",
            "urun_kodu",
            "model",
            "tablono",
            "tablo_no",
        )
        base_lines = [
            ln.rstrip()
            for ln in (prefix_csv or "").splitlines()
            if ln.strip()
            and not ln.strip().startswith("```")
            and not (
                ln.strip().startswith("#")
                and (
                    not any(ch in ln for ch in ("=", ";", ":"))
                    or ln.strip()[-1] in ("-", "=", ";", ":")
                )
            )
        ]
        _, expected_cols = cls.detect_csv_header_info(prefix_csv or cont_text)
        existing_comment_lines = {
            ln.strip().upper()
            for ln in base_lines
            if ln.strip().startswith("#")
        }
        has_meta = any(
            ln.strip().upper().startswith("#META") for ln in base_lines
        )
        has_header = any(
            ln.split(";", 1)[0].strip().lower() in header_keywords
            for ln in base_lines
            if ";" in ln and not ln.strip().startswith("#")
        )
        seen_keys = set()
        last_base_code = ""
        last_extra_cols: List[str] = []
        for ln in base_lines:
            s = ln.strip()
            if s.startswith("#") or s.startswith("```") or ";" not in s:
                continue
            parts = [p.strip() for p in s.split(";")]
            if len(parts) >= 2 and parts[0].lower() not in header_keywords:
                seen_keys.add(";".join([parts[0].upper()] + parts[1:]))
                last_base_code = parts[0].upper()
                last_extra_cols = parts[2:] if len(parts) > 2 else []

        added = 0
        for raw_ln in cont_text.splitlines():
            s = raw_ln.strip()
            if not s or s.startswith("```"):
                continue
            if s.startswith("#"):
                upper_s = s.upper()
                has_delim = any(ch in s for ch in ("=", ";", ":"))
                if (
                    has_delim
                    and s[-1] not in ("-", "=", ";", ":")
                    and upper_s not in existing_comment_lines
                ):
                    if upper_s.startswith("#META") and not has_meta:
                        base_lines.insert(0, s)
                        has_meta = True
                        existing_comment_lines.add(upper_s)
                    elif upper_s.startswith("#TABLOLAR"):
                        insert_pos = 1 if has_meta and len(base_lines) >= 1 else 0
                        base_lines.insert(insert_pos, s)
                        existing_comment_lines.add(upper_s)
                    elif not upper_s.startswith("#META"):
                        base_lines.append(s)
                        existing_comment_lines.add(upper_s)
                continue
            # Satır başı numaralandırma önekleri varsa temizle (örn: "#100: KOD123;620,16;2" -> "KOD123;620,16;2")
            s = re.sub(r"^(?:#?\d+[\.\)\:\-\s]+|\-\s+|\*\s+)", "", s).strip()
            if ";" not in s or s.startswith("#"):
                continue
            parts = [p.strip() for p in s.split(";")]
            if len(parts) >= 2:
                code = parts[0].strip()
                price = parts[1].strip()
                if not code:
                    continue
                if code.lower() in header_keywords:
                    if not has_header and all(bool(p) for p in parts):
                        insert_idx = sum(1 for bl in base_lines if bl.strip().startswith("#"))
                        base_lines.insert(insert_idx, ";".join(parts))
                        has_header = True
                        expected_cols = max(expected_cols, len(parts))
                    continue
                # Ürün kodu boşluk içermemeli, en az 4 karakter olmalı ve fiyat geçerli rakamla bitmeli
                if " " in code or len(code) < 4 or not price:
                    continue
                if any(p[-1] in (",", ".", "-", "=") for p in parts[1:] if p) or not re.search(r"\d", price):
                    continue
                if len(parts) < expected_cols and last_extra_cols:
                    parts = parts + last_extra_cols[: expected_cols - len(parts)]
                if any(not p for p in parts[: max(2, expected_cols)]):
                    continue
                if last_base_code and added == 0 and code.upper() == last_base_code:
                    continue
                normalized_row = ";".join([code, price] + parts[2:])
                key = ";".join([code.upper(), price] + parts[2:])
                if key not in seen_keys:
                    seen_keys.add(key)
                    base_lines.append(normalized_row)
                    if len(parts) > 2:
                        last_extra_cols = parts[2:]
                    added += 1

        return ("\n".join(base_lines), added)


agent_memory_service = AgentMemoryService()

