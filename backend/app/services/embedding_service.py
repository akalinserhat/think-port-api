"""
ThinkPort AI Gateway - Sağlayıcı Bağımsız Online & Yerel BAAI/bge-m3 Embedding Servisi (embedding_service.py).

Sorumluluklar:
1. RAG döküman parçalama (Semantic Chunking) ve vektör indeksleme/arama işlemleri için
   standart `BAAI/bge-m3` (1024 boyutlu, L2-normalize) vektör uzayını üretmek.
2. Online `BAAI/bge-m3` çağrılarını `@akalin/proxy_module` (`akalin_proxy_db`) içerisindeki aktif proxy
   sunucuları üzerinden Round-Robin rotasyonla geçirerek hız sınırlarına (HTTP 429) ve IP banlanmasına
   karşı korumak.
3. Tek bir sağlayıcıya bağımlı kalmadan (Vendor Lock-in olmadan) otomatik yedekli (fallback) çalışmak:
   - Açık Hugging Face Space (`BAAI/bge-m3` — Anahtarsız online katman, Proxy rotasyonlu)
   - SiliconFlow (`https://api.siliconflow.com/v1/embeddings` — Ücretsiz $0 katmanı, Proxy rotasyonlu)
   - Cloudflare Workers AI (`@cf/baai/bge-m3` — Günlük ücretsiz Neuron katmanı, Proxy rotasyonlu)
   - Hugging Face Serverless Inference API (`BAAI/bge-m3` — Ücretsiz HF_TOKEN katmanı, Proxy rotasyonlu)
   - OpenRouter (`baai/bge-m3`) & DeepInfra (`BAAI/bge-m3`)
   - Yerel Ollama (`bge-m3:latest` / `bge-m3`)
"""
from __future__ import annotations
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
import json
import math
import re
import threading
import time
import urllib.error
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlparse
from app.core.config import settings
from app.core.logger import gateway_logger
from app.core.security import create_verified_ssl_context
from app.repositories.proxy_repository import proxy_module_db
from app.repositories.state_store import store as default_store
from app.repositories.telemetry_repository import SettingsRepository

BGE_M3_MODEL_ID = "BAAI/bge-m3"
BGE_M3_DIMENSIONS = 1024
RAG_VECTOR_AGENT_CODE = "RAG-VEKTOR-UZMANI"
VECTOR_AGENT_CACHE_TTL_SEC = 15.0
MAX_BGE_M3_INPUT_CHARS = 24000  # ~8192 token güvenli karakter sınırı
DEFAULT_BATCH_SIZE = 64
HF_SPACE_BATCH_SIZE = 10  # HF Space FastAPI sınırı: "Max 10 texts per request"
HF_SPACE_PARALLEL_WORKERS = 2

NEURAL_BGE_M3_PROVIDERS = (
    "hf-space",
    "siliconflow",
    "cloudflare",
    "huggingface",
    "openrouter",
    "deepinfra",
    "ollama",
)


class EmbeddingService:
    """
    `BAAI/bge-m3` (1024 boyut) modeli için `@akalin/proxy_module` (`akalin_proxy_db`) destekli
    anti-ban proxy rotasyonu, çoklu online bulut sağlayıcı + yerel Ollama fallback zincirini
    ve sorgu önbelleğini (LRU Cache) yöneten merkezi servis.
    """

    def __init__(self) -> None:
        self._settings_repo = SettingsRepository(default_store)
        self._cache_lock = threading.RLock()
        self._query_cache: OrderedDict[str, Tuple[List[float], str]] = OrderedDict()
        self._max_cache_items = 512
        self._last_active_provider: str = ""
        self._last_latency_ms: int = 0
        self._last_proxy_telemetry: Dict[str, Any] = {}
        self._provider_cooldown_until: Dict[str, float] = {}
        self._agent_cfg_cache: Optional[Dict[str, Any]] = None
        self._agent_cfg_cached_at: float = 0.0

    @staticmethod
    def normalize_vector_1024(raw_vec: Sequence[float]) -> List[float]:
        """Vektörü 1024 boyuta doğrular ve birim uzunluğa (L2 norm = 1.0) normalize eder."""
        if len(raw_vec) != BGE_M3_DIMENSIONS:
            raise ValueError(
                f"Beklenen BAAI/bge-m3 vektör boyutu {BGE_M3_DIMENSIONS}, alınan: {len(raw_vec)}"
            )
        vals = [float(x) for x in raw_vec]
        norm = math.sqrt(sum(v * v for v in vals))
        if norm > 1e-12:
            return [round(v / norm, 6) for v in vals]
        vals[0] = 1.0
        return vals

    @staticmethod
    def to_pgvector_str(vec: Sequence[float]) -> str:
        """1024 boyutlu float listesini PostgreSQL `vector(1024)` metin formatına (`'[0.1,0.2,...]'`) çevirir."""
        return "[" + ",".join(f"{float(v):.6f}" for v in vec) + "]"

    @staticmethod
    def cosine_similarity(vec_a: Sequence[float], vec_b: Sequence[float]) -> float:
        """L2-normalize iki vektör arasındaki kosinüs benzerliğini (-1.0 .. 1.0) döner."""
        if not vec_a or not vec_b or len(vec_a) != len(vec_b):
            return 0.0
        return sum(float(a) * float(b) for a, b in zip(vec_a, vec_b))

    @staticmethod
    def compute_lexical_fallback_1024(text: str) -> List[float]:
        """
        Hiçbir online API anahtarı tanımlı değilken ve yerel Ollama `bge-m3` kapalıyken
        veritabanı işlemlerinin kesintiye uğramaması için üretilen deterministik 1024d acil durum vektörü.
        """
        dim = BGE_M3_DIMENSIONS
        vec = [0.0] * dim
        cleaned = re.sub(r"\s+", " ", (text or "").lower()).strip()
        if not cleaned:
            vec[0] = 1.0
            return vec

        tokens = re.findall(r"[a-z0-9çğıöşü_]{2,}", cleaned)
        for tok in tokens:
            h = int(hashlib.md5(tok.encode("utf-8")).hexdigest()[:8], 16)
            idx = h % dim
            sign = 1.0 if ((h >> 8) & 1) == 0 else -1.0
            vec[idx] += sign * 1.6

        padded = f"  {cleaned[:2500]}  "
        for i in range(len(padded) - 2):
            tri = padded[i : i + 3]
            h = int(hashlib.md5(tri.encode("utf-8")).hexdigest()[:8], 16)
            idx = h % dim
            sign = 1.0 if ((h >> 9) & 1) == 0 else -1.0
            vec[idx] += sign * 0.4

        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 1e-12:
            return [round(v / norm, 6) for v in vec]
        vec[0] = 1.0
        return vec

    @staticmethod
    def _resolve_provider_from_agent_row(
        saglayici_turu: Any,
        saglayici_adi: Optional[str],
        base_url: Optional[str],
    ) -> str:
        """Webakus `AiSaglayicilar` kaydını ThinkPort embedding sağlayıcı anahtarına eşler."""
        name_l = str(saglayici_adi or "").strip().lower()
        url_l = str(base_url or "").strip().lower()
        try:
            turu_int = int(saglayici_turu or 0)
        except Exception:
            turu_int = 0

        if turu_int == 4 or "ollama" in name_l or "11434" in url_l:
            return "ollama"
        if "siliconflow" in name_l or "siliconflow" in url_l:
            return "siliconflow"
        if "cloudflare" in name_l or "cloudflare" in url_l:
            return "cloudflare"
        if "huggingface" in name_l or "hf-inference" in url_l:
            return "huggingface"
        if "hf.space" in url_l or "hf-space" in name_l:
            return "hf-space"
        if "openrouter" in name_l or "openrouter" in url_l:
            return "openrouter"
        if "deepinfra" in name_l or "deepinfra" in url_l:
            return "deepinfra"
        return "ollama"

    def _load_vector_agent_config(self, force_refresh: bool = False) -> Optional[Dict[str, Any]]:
        """
        Öncelikle `thinkport_db.ai_agents` teknik ajan tablosundan, bulunamazsa `webakus_db."AiAjanlar"`
        tablosundan `RAG-VEKTOR-UZMANI` ajanının sağlayıcı ve model (`ollama` / `bge-m3:latest`) yapılandırmasını okur.
        """
        now_m = time.monotonic()
        with self._cache_lock:
            if not force_refresh and self._agent_cfg_cache is not None and (now_m - self._agent_cfg_cached_at) < VECTOR_AGENT_CACHE_TTL_SEC:
                return dict(self._agent_cfg_cache)

        try:
            from app.repositories.postgres_db import postgres_db

            # 1. Öncelik: thinkport_db.ai_agents tablosundaki teknik altyapı ajanı (RAG-VEKTOR-UZMANI)
            row_tp = None
            try:
                with postgres_db.connection() as conn:
                    row_tp = conn.execute(
                        """
                        SELECT
                            id,
                            kod,
                            ad,
                            model_adi,
                            alternatif_modeller_json,
                            ai_saglayici_id
                        FROM ai_agents
                        WHERE aktif_mi = 1
                          AND UPPER(COALESCE(NULLIF(BTRIM(kod), ''), ''))
                              IN ('RAG-VEKTOR-UZMANI', 'RAG_VEKTOR_UZMANI')
                        ORDER BY id ASC
                        LIMIT 1
                        """
                    ).fetchone()
            except Exception as tp_exc:
                gateway_logger.debug(f"thinkport_db.ai_agents RAG-VEKTOR-UZMANI sorgulama: {tp_exc}")

            if row_tp:
                alt_models: List[str] = []
                raw_alt = row_tp.get("alternatif_modeller_json")
                if raw_alt:
                    try:
                        parsed_alt = json.loads(raw_alt) if isinstance(raw_alt, str) else raw_alt
                        if isinstance(parsed_alt, list):
                            alt_models = [str(m).strip() for m in parsed_alt if str(m).strip()]
                    except Exception:
                        alt_models = []

                model_adi = str(row_tp.get("model_adi") or settings.ollama_embedding_model).strip()
                resolved_provider = "ollama"
                m_lower = model_adi.lower()
                if "siliconflow" in m_lower:
                    resolved_provider = "siliconflow"
                elif "cloudflare" in m_lower:
                    resolved_provider = "cloudflare"
                elif "huggingface" in m_lower or "hf" in m_lower:
                    resolved_provider = "huggingface"
                elif "openrouter" in m_lower:
                    resolved_provider = "openrouter"
                elif "deepinfra" in m_lower:
                    resolved_provider = "deepinfra"

                parsed = {
                    "id": int(row_tp.get("id") or 0),
                    "kod": str(row_tp.get("kod") or RAG_VECTOR_AGENT_CODE).strip(),
                    "ad": str(row_tp.get("ad") or "RAG Vektör Uzmanı").strip(),
                    "provider": resolved_provider,
                    "model_adi": model_adi,
                    "alternatif_modeller": alt_models,
                    "saglayici_id": int(row_tp.get("ai_saglayici_id") or 0) if row_tp.get("ai_saglayici_id") is not None else None,
                    "saglayici_adi": "Ollama (Yerel LLM)" if resolved_provider == "ollama" else resolved_provider.title(),
                    "base_url": f"http://{settings.ollama_host}:{settings.ollama_port}" if resolved_provider == "ollama" else "",
                }
                with self._cache_lock:
                    self._agent_cfg_cache = dict(parsed)
                    self._agent_cfg_cached_at = now_m
                return parsed

            # 2. Yedek: webakus_db."AiAjanlar" tablosu
            with postgres_db.rag_connection() as conn:
                row = conn.execute(
                    """
                    SELECT
                        a."Id",
                        COALESCE(NULLIF(BTRIM(a."Kod"), ''), NULLIF(BTRIM(a."AjanId"), '')) AS "Kod",
                        a."Ad",
                        a."ModelAdi",
                        a."AlternatifModellerJson",
                        a."AiSaglayiciId",
                        s."Ad" AS "SaglayiciAdi",
                        s."SaglayiciTuru" AS "SaglayiciTuru",
                        s."BaseUrl" AS "BaseUrl"
                    FROM "AiAjanlar" a
                    LEFT JOIN "AiSaglayicilar" s
                        ON s."Id" = a."AiSaglayiciId" AND NOT s."SilindiMi"
                    WHERE NOT a."SilindiMi"
                      AND a."AktifMi"
                      AND UPPER(COALESCE(NULLIF(BTRIM(a."Kod"), ''), NULLIF(BTRIM(a."AjanId"), ''), ''))
                          IN ('RAG-VEKTOR-UZMANI', 'RAG_VEKTOR_UZMANI')
                    ORDER BY a."Id" ASC
                    LIMIT 1
                    """
                ).fetchone()

            if not row:
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

            resolved_provider = self._resolve_provider_from_agent_row(
                row.get("SaglayiciTuru"),
                row.get("SaglayiciAdi"),
                row.get("BaseUrl"),
            )
            raw_base_url = str(row.get("BaseUrl") or "").strip()
            is_ollama_endpoint = (
                int(row.get("SaglayiciTuru") or 0) == 4
                or "ollama" in str(row.get("SaglayiciAdi") or "").lower()
                or "11434" in raw_base_url.lower()
            )
            parsed = {
                "id": int(row.get("Id") or 0),
                "kod": str(row.get("Kod") or RAG_VECTOR_AGENT_CODE).strip(),
                "ad": str(row.get("Ad") or "RAG Vektör Uzmanı").strip(),
                "provider": resolved_provider,
                "model_adi": str(row.get("ModelAdi") or settings.ollama_embedding_model).strip(),
                "alternatif_modeller": alt_models,
                "saglayici_id": int(row.get("AiSaglayiciId") or 0) if row.get("AiSaglayiciId") is not None else None,
                "saglayici_adi": str(row.get("SaglayiciAdi") or "").strip(),
                "base_url": raw_base_url if is_ollama_endpoint else "",
            }
            with self._cache_lock:
                self._agent_cfg_cache = dict(parsed)
                self._agent_cfg_cached_at = now_m
            return parsed
        except Exception as exc:
            gateway_logger.warning(f"RAG-VEKTOR-UZMANI DB okuma uyarısı: {exc}")
            return None

    def get_active_vector_agent_summary(self) -> Dict[str, Any]:
        """Aktif vektör hesaplama ajanının (`RAG-VEKTOR-UZMANI`) özet bilgisini döner."""
        agent_cfg = self._load_vector_agent_config()
        if agent_cfg:
            return agent_cfg
        return {
            "id": None,
            "kod": RAG_VECTOR_AGENT_CODE,
            "ad": "RAG Vektör Uzmanı",
            "provider": "ollama",
            "model_adi": settings.ollama_embedding_model,
            "alternatif_modeller": [],
            "saglayici_id": None,
            "saglayici_adi": "Ollama (Yerel LLM)",
            "base_url": f"http://{settings.ollama_host}:{settings.ollama_port}",
        }

    def _get_live_config(self) -> Dict[str, Any]:
        """PostgreSQL `system_settings`, `webakus_db."AiAjanlar"` ve ortam değişkenlerinden güncel ayarları okur."""
        dto = self._settings_repo.get_settings()
        agent_cfg = self._load_vector_agent_config()
        raw_primary = (dto.embedding_primary_provider or "ollama").strip().lower()
        effective_primary = raw_primary
        if agent_cfg and agent_cfg.get("provider") and raw_primary in ("", "auto", "ollama"):
            effective_primary = str(agent_cfg["provider"]).strip().lower()
        elif raw_primary in ("", "auto"):
            effective_primary = "ollama"

        return {
            "primary": effective_primary,
            "raw_setting_primary": raw_primary,
            "enable_semantic_chunking": bool(dto.enable_semantic_chunking),
            "vector_agent": agent_cfg,
            "ollama_model": (agent_cfg or {}).get("model_adi") or settings.ollama_embedding_model,
            "ollama_base_url": (agent_cfg or {}).get("base_url") or "",
            "siliconflow_api_key": (dto.siliconflow_api_key or settings.siliconflow_api_key or "").strip(),
            "hf_api_key": (dto.hf_api_key or settings.hf_api_key or "").strip(),
            "cloudflare_account_id": (dto.cloudflare_account_id or settings.cloudflare_account_id or "").strip(),
            "cloudflare_api_token": (dto.cloudflare_api_token or settings.cloudflare_api_token or "").strip(),
            "openrouter_api_key": (dto.openrouter_api_key or settings.openrouter_api_key or "").strip(),
            "deepinfra_api_key": (dto.deepinfra_api_key or settings.deepinfra_api_key or "").strip(),
        }

    def is_semantic_chunking_enabled(self) -> bool:
        """Ayarlarda semantik chunking özelliğinin açık olup olmadığını döner."""
        return bool(self._get_live_config().get("enable_semantic_chunking", True))

    def _build_provider_order(
        self,
        cfg: Dict[str, Any],
        preferred_override: Optional[str] = None,
    ) -> List[str]:
        """Aktif vektör ajanına, anahtarlara ve birincil sağlayıcı tercihine göre deneme sırasını oluşturur."""
        available: List[str] = ["ollama"]
        if cfg["siliconflow_api_key"]:
            available.append("siliconflow")
        if cfg["cloudflare_account_id"] and cfg["cloudflare_api_token"]:
            available.append("cloudflare")
        if cfg["hf_api_key"]:
            available.append("huggingface")
        if cfg["openrouter_api_key"]:
            available.append("openrouter")
        if cfg["deepinfra_api_key"]:
            available.append("deepinfra")
        if settings.hf_bge_m3_space_url.strip():
            available.append("hf-space")

        primary = (preferred_override or cfg["primary"] or "ollama").strip().lower()
        if primary in ("online", "hf-space"):
            primary = "hf-space"
        if primary and primary != "auto" and primary in NEURAL_BGE_M3_PROVIDERS:
            ordered = [primary] + [p for p in available if p != primary]
            return ordered
        return available

    @staticmethod
    def _sanitize_input_text(text: str) -> str:
        clean = (text or "").strip()
        if not clean:
            return " "
        if len(clean) > MAX_BGE_M3_INPUT_CHARS:
            return clean[:MAX_BGE_M3_INPUT_CHARS]
        return clean

    def _post_json_via_proxy_pool(
        self,
        url: str,
        payload_dict: Dict[str, Any],
        extra_headers: Optional[Dict[str, str]] = None,
        timeout_sec: float = 40.0,
    ) -> Tuple[int, Any, Dict[str, Any]]:
        """
        Online `BAAI/bge-m3` HTTP POST isteğini `@akalin/proxy_module` (`akalin_proxy_db`)
        içerisindeki aktif proxy havuzundan dönüşümlü (Round-Robin) olarak geçirir.
        """
        body = json.dumps(payload_dict, ensure_ascii=False).encode("utf-8")
        ctx = create_verified_ssl_context()
        status_code, resp_bytes, proxy_meta = proxy_module_db.execute_proxied_http_post(
            url=url,
            body_bytes=body,
            headers=extra_headers,
            timeout_sec=timeout_sec,
            ssl_context=ctx,
            max_proxy_attempts=2,
        )
        self._last_proxy_telemetry = proxy_meta
        if status_code != 200:
            return (status_code, None, proxy_meta)
        parsed = json.loads(resp_bytes.decode("utf-8", errors="replace"))
        return (status_code, parsed, proxy_meta)

    def _call_openai_compatible_embeddings(
        self,
        endpoint_url: str,
        api_key: str,
        model_name: str,
        batch: List[str],
        extra_headers: Optional[Dict[str, str]] = None,
        timeout_sec: float = 35.0,
    ) -> Optional[List[List[float]]]:
        """SiliconFlow, OpenRouter ve DeepInfra gibi OpenAI `/v1/embeddings` uyumlu servisleri proxy havuzuyla çağırır."""
        if not api_key:
            return None
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        if extra_headers:
            headers.update(extra_headers)

        payload_dict: Dict[str, Any] = {
            "model": model_name,
            "input": batch,
            "encoding_format": "float",
        }
        status_code, parsed, _ = self._post_json_via_proxy_pool(
            endpoint_url,
            payload_dict,
            extra_headers=headers,
            timeout_sec=timeout_sec,
        )
        if status_code != 200 or not isinstance(parsed, dict):
            return None
        data_items = parsed.get("data")
        if not isinstance(data_items, list) or len(data_items) != len(batch):
            return None
        sorted_items = sorted(data_items, key=lambda item: int(item.get("index", 0)))
        return [self.normalize_vector_1024(item["embedding"]) for item in sorted_items]

    def _call_cloudflare_bge_m3(
        self,
        account_id: str,
        api_token: str,
        batch: List[str],
        timeout_sec: float = 35.0,
    ) -> Optional[List[List[float]]]:
        """Cloudflare Workers AI `@cf/baai/bge-m3` REST API uç noktasını proxy havuzuyla çağırır."""
        if not account_id or not api_token:
            return None
        url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/baai/bge-m3"
        status_code, parsed, _ = self._post_json_via_proxy_pool(
            url,
            {"text": batch},
            extra_headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_token}",
            },
            timeout_sec=timeout_sec,
        )
        if status_code != 200 or not isinstance(parsed, dict):
            return None
        result = parsed.get("result") or {}
        vectors = result.get("data")
        if not isinstance(vectors, list) or len(vectors) != len(batch):
            return None
        return [self.normalize_vector_1024(v) for v in vectors]

    def _call_huggingface_bge_m3(
        self,
        api_key: str,
        batch: List[str],
        timeout_sec: float = 35.0,
    ) -> Optional[List[List[float]]]:
        """Hugging Face Inference API üzerinden `BAAI/bge-m3` feature-extraction çağrısını proxy havuzuyla yapar."""
        if not api_key:
            return None
        status_code, parsed, _ = self._post_json_via_proxy_pool(
            settings.hf_inference_url,
            {
                "inputs": batch,
                "options": {"wait_for_model": True},
            },
            extra_headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            timeout_sec=timeout_sec,
        )
        if status_code != 200 or not isinstance(parsed, list) or len(parsed) != len(batch):
            return None
        vectors: List[List[float]] = []
        for item in parsed:
            if isinstance(item, list) and item and isinstance(item[0], list):
                vectors.append(self.normalize_vector_1024(item[0]))
            elif isinstance(item, list):
                vectors.append(self.normalize_vector_1024(item))
            else:
                return None
        return vectors

    def _call_hf_space_bge_m3(
        self,
        batch: List[str],
        timeout_sec: float = 5.0,
    ) -> Optional[List[List[float]]]:
        """
        Anahtarsız (0 API Key) açık Hugging Face Space (`*.hf.space`) üzerinden
        `@akalin/proxy_module` (`akalin_proxy_db`) proxy rotasyonuyla canlı `BAAI/bge-m3` (1024d)
        vektörlerini alır. `_post_json_via_proxy_pool` zaten `max_proxy_attempts=2` farklı düğüm
        denediği için hızlı fail-over yaparak yerel Ollama katmanını bekletmez.
        """
        base_url = settings.hf_bge_m3_space_url.strip().rstrip("/")
        if not base_url:
            return None

        url = f"{base_url}/embeddings"
        payload_dict = {"input": batch[:HF_SPACE_BATCH_SIZE]}
        try:
            status_code, parsed, proxy_meta = self._post_json_via_proxy_pool(
                url=url,
                payload_dict=payload_dict,
                timeout_sec=timeout_sec,
            )
            if status_code != 200 or parsed is None:
                return None

            if isinstance(parsed, dict):
                items = parsed.get("data") or parsed.get("embeddings")
            elif isinstance(parsed, list):
                items = parsed
            else:
                items = None

            if not isinstance(items, list) or len(items) != len(batch):
                return None

            vectors: List[List[float]] = []
            for item in items:
                if isinstance(item, dict) and "embedding" in item:
                    vectors.append(self.normalize_vector_1024(item["embedding"]))
                elif isinstance(item, list):
                    vectors.append(self.normalize_vector_1024(item))
            if len(vectors) == len(batch):
                gateway_logger.info(
                    f"BGE_M3_ONLINE_PROXY_OK | provider=hf-space | batch_size={len(batch)} "
                    f"| proxy_id={proxy_meta.get('proxy_id')} | proxy={proxy_meta.get('proxy_endpoint')} "
                    f"| country={proxy_meta.get('proxy_country')} | mode={proxy_meta.get('transport_mode')} "
                    f"| latency_ms={proxy_meta.get('latency_ms')}"
                )
                return vectors
        except Exception as exc:
            gateway_logger.warning(
                f"BGE_M3_ONLINE_PROXY_RETRY_WARN | url={url} | err={exc}"
            )
        return None

    @staticmethod
    def _parse_ollama_endpoint(ollama_base_url: Optional[str]) -> Tuple[str, int, bool, str]:
        """Sağlayıcı `BaseUrl` değerinden Ollama `(host, port, is_https, path_prefix)` çıkarır."""
        raw = str(ollama_base_url or "").strip().rstrip("/")
        if raw.lower().endswith("/v1"):
            raw = raw[:-3]
        if raw:
            try:
                parsed = urlparse(raw)
                host = parsed.hostname or settings.ollama_host
                is_https = parsed.scheme.lower() == "https"
                port = parsed.port or (443 if is_https else (settings.ollama_port if host == settings.ollama_host else 11434))
                path_prefix = parsed.path.rstrip("/")
                return (host, int(port), is_https, path_prefix)
            except Exception:
                pass
        return (settings.ollama_host, int(settings.ollama_port), False, "")

    def _call_ollama_bge_m3(
        self,
        batch: List[str],
        timeout_sec: float = 60.0,
        model_override: Optional[str] = None,
        ollama_base_url: Optional[str] = None,
    ) -> Optional[List[List[float]]]:
        """Yerel Ollama `/api/embed` uç noktasından ajan tanımlı `bge-m3:latest` (veya `bge-m3`) vektörlerini alır."""
        candidate_models = []
        for m in (model_override, settings.ollama_embedding_model, "bge-m3:latest", "bge-m3"):
            clean_m = str(m or "").strip()
            if clean_m and clean_m not in candidate_models:
                candidate_models.append(clean_m)

        host, port, is_https, path_prefix = self._parse_ollama_endpoint(ollama_base_url)

        for model_name in candidate_models:
            conn = (
                http.client.HTTPSConnection(host, port, timeout=timeout_sec, context=create_verified_ssl_context())
                if is_https
                else http.client.HTTPConnection(host, port, timeout=timeout_sec)
            )
            try:
                payload = json.dumps({"model": model_name, "input": batch}, ensure_ascii=False).encode("utf-8")
                conn.request(
                    "POST",
                    f"{path_prefix}/api/embed",
                    body=payload,
                    headers={"Content-Type": "application/json"},
                )
                resp = conn.getresponse()
                raw_body = resp.read().decode("utf-8", errors="replace")
                if resp.status == 200:
                    parsed = json.loads(raw_body)
                    embeddings = parsed.get("embeddings")
                    if isinstance(embeddings, list) and len(embeddings) == len(batch):
                        return [self.normalize_vector_1024(v) for v in embeddings]
            except Exception as exc:
                gateway_logger.warning(
                    f"OLLAMA_BGE_M3_WARN | model={model_name} | host={host}:{port} | err={exc}"
                )
                continue
            finally:
                conn.close()
        return None

    def _embed_single_batch_via_provider(
        self,
        provider: str,
        batch: List[str],
        cfg: Dict[str, Any],
    ) -> Optional[List[List[float]]]:
        """Tek bir batch listesini belirtilen `BAAI/bge-m3` sağlayıcısı üzerinden vektörleştirir."""
        if provider == "siliconflow":
            base = settings.siliconflow_base_url.rstrip("/")
            return self._call_openai_compatible_embeddings(
                f"{base}/embeddings",
                cfg["siliconflow_api_key"],
                "BAAI/bge-m3",
                batch,
            )
        if provider == "cloudflare":
            return self._call_cloudflare_bge_m3(
                cfg["cloudflare_account_id"],
                cfg["cloudflare_api_token"],
                batch,
            )
        if provider == "huggingface":
            return self._call_huggingface_bge_m3(cfg["hf_api_key"], batch)
        if provider == "openrouter":
            base = settings.openrouter_base_url.rstrip("/")
            return self._call_openai_compatible_embeddings(
                f"{base}/embeddings",
                cfg["openrouter_api_key"],
                "baai/bge-m3",
                batch,
                extra_headers={
                    "HTTP-Referer": "https://thinkport.local",
                    "X-Title": "ThinkPort AI Gateway",
                },
            )
        if provider == "deepinfra":
            base = settings.deepinfra_base_url.rstrip("/")
            return self._call_openai_compatible_embeddings(
                f"{base}/embeddings",
                cfg["deepinfra_api_key"],
                "BAAI/bge-m3",
                batch,
            )
        if provider == "hf-space":
            return self._call_hf_space_bge_m3(batch)
        if provider == "ollama":
            return self._call_ollama_bge_m3(
                batch,
                model_override=cfg.get("ollama_model"),
                ollama_base_url=cfg.get("ollama_base_url"),
            )
        return None

    def embed_texts(
        self,
        texts: Sequence[str],
        allow_fallback: bool = True,
        preferred_provider: Optional[str] = None,
        use_cache: bool = False,
    ) -> Tuple[List[List[float]], str]:
        """
        Metin listesini `BAAI/bge-m3` sağlayıcı zinciri ve `@akalin/proxy_module` (`akalin_proxy_db`)
        proxy rotasyonu üzerinden toplu (batch) olarak 1024 boyutlu vektörlere dönüştürür.
        Dönüş: `(vektor_listesi, kullanilan_saglayici_adi)`
        """
        if not texts:
            return ([], "none")

        sanitized = [self._sanitize_input_text(t) for t in texts]

        # Tekil arama sorguları için LRU önbellek kontrolü
        if use_cache and len(sanitized) == 1:
            cache_key = sanitized[0]
            with self._cache_lock:
                cached = self._query_cache.get(cache_key)
                if cached is not None:
                    self._query_cache.move_to_end(cache_key)
                    return ([list(cached[0])], cached[1])

        cfg = self._get_live_config()
        provider_chain = self._build_provider_order(cfg, preferred_override=preferred_provider)
        t0 = time.perf_counter()

        for provider in provider_chain:
            if (
                not preferred_provider
                and provider != "ollama"
                and self._provider_cooldown_until.get(provider, 0.0) > time.monotonic()
            ):
                continue

            try:
                all_vectors: List[List[float]] = []
                ok = True
                step_size = HF_SPACE_BATCH_SIZE if provider == "hf-space" else DEFAULT_BATCH_SIZE
                sub_batches = [
                    sanitized[start : start + step_size]
                    for start in range(0, len(sanitized), step_size)
                ]

                if provider == "hf-space" and len(sub_batches) > 1:
                    workers = min(HF_SPACE_PARALLEL_WORKERS, len(sub_batches))

                    def _embed_batch_worker(
                        sb: List[str],
                        prov: str = provider,
                    ) -> Optional[List[List[float]]]:
                        return self._embed_single_batch_via_provider(prov, sb, cfg)

                    with ThreadPoolExecutor(max_workers=workers) as pool:
                        batch_results = list(pool.map(_embed_batch_worker, sub_batches))
                    for sb, batch_vecs in zip(sub_batches, batch_results):
                        if not batch_vecs or len(batch_vecs) != len(sb):
                            ok = False
                            break
                        all_vectors.extend(batch_vecs)
                else:
                    for sub_batch in sub_batches:
                        batch_vecs = self._embed_single_batch_via_provider(provider, sub_batch, cfg)
                        if not batch_vecs or len(batch_vecs) != len(sub_batch):
                            ok = False
                            break
                        all_vectors.extend(batch_vecs)

                if ok and len(all_vectors) == len(sanitized):
                    self._provider_cooldown_until.pop(provider, None)
                    elapsed_ms = int((time.perf_counter() - t0) * 1000)
                    self._last_active_provider = provider
                    self._last_latency_ms = elapsed_ms
                    if use_cache and len(sanitized) == 1:
                        with self._cache_lock:
                            self._query_cache[sanitized[0]] = (all_vectors[0], provider)
                            while len(self._query_cache) > self._max_cache_items:
                                self._query_cache.popitem(last=False)
                    return (all_vectors, provider)
                if provider != "ollama":
                    self._provider_cooldown_until[provider] = time.monotonic() + 300.0
            except urllib.error.HTTPError as http_err:
                if provider != "ollama":
                    self._provider_cooldown_until[provider] = time.monotonic() + 300.0
                gateway_logger.warning(
                    f"BGE-M3 embedding HTTP hatası | provider={provider} | code={http_err.code}"
                )
            except Exception as exc:
                if provider != "ollama":
                    self._provider_cooldown_until[provider] = time.monotonic() + 300.0
                if provider != "ollama":
                    gateway_logger.warning(
                        f"BGE-M3 embedding sağlayıcı hatası | provider={provider} | hata={exc}"
                    )

        if not allow_fallback:
            raise RuntimeError(
                "Aktif bir BAAI/bge-m3 online sağlayıcısı (HF-Space / SiliconFlow / Cloudflare / HuggingFace / OpenRouter / DeepInfra) "
                "veya yerel Ollama `bge-m3:latest` modeli yanıt vermedi."
            )

        fallback_vecs = [self.compute_lexical_fallback_1024(t) for t in sanitized]
        self._last_active_provider = "lexical-1024-fallback"
        return (fallback_vecs, "lexical-1024-fallback")

    def embed_query_pgvector(self, query_text: str) -> Tuple[str, str]:
        """Arama sorgusunu LRU önbellekli olarak 1024d pgvector metnine çevirir."""
        vecs, provider = self.embed_texts([query_text], allow_fallback=True, use_cache=True)
        return (self.to_pgvector_str(vecs[0]), provider)

    def get_proxy_pool_stats(self, reset: bool = False) -> Dict[str, Any]:
        """`@akalin/proxy_module` (`akalin_proxy_db`) üzerindeki çalışma zamanı proxy rotasyon istatistiklerini döner."""
        return proxy_module_db.get_proxy_runtime_stats(reset=reset)

    def test_connection(self, provider_override: Optional[str] = None) -> Dict[str, Any]:
        """Seçili veya otomatik `BAAI/bge-m3` sağlayıcısını canlı örnek metinle ve proxy havuzuyla test eder."""
        t0 = time.perf_counter()
        sample_texts = [
            "Webakus ERP bulut döküman yönetimi ve fiyat listesi semantik arama testi.",
            "Ankastre fırın ve bulaşık makinesi kampanya iskonto oranları.",
        ]
        try:
            vecs, used_provider = self.embed_texts(
                sample_texts,
                allow_fallback=False,
                preferred_provider=provider_override,
                use_cache=False,
            )
            latency_ms = int((time.perf_counter() - t0) * 1000)
            sim = round(self.cosine_similarity(vecs[0], vecs[1]), 4)
            return {
                "ok": True,
                "model": BGE_M3_MODEL_ID,
                "provider": used_provider,
                "is_neural_bge_m3": True,
                "dimensions": len(vecs[0]) if vecs else BGE_M3_DIMENSIONS,
                "latency_ms": latency_ms,
                "sample_similarity": sim,
                "proxy_telemetry": self._last_proxy_telemetry,
                "message": f"BAAI/bge-m3 ({used_provider}) 1024d bağlantısı proxy havuzu üzerinden başarılı ({latency_ms} ms).",
            }
        except Exception as exc:
            return {
                "ok": False,
                "model": BGE_M3_MODEL_ID,
                "provider": provider_override or "none",
                "is_neural_bge_m3": False,
                "dimensions": BGE_M3_DIMENSIONS,
                "latency_ms": int((time.perf_counter() - t0) * 1000),
                "proxy_telemetry": self._last_proxy_telemetry,
                "message": str(exc),
            }

    def get_effective_embedding_model(self, provider: Optional[str] = None) -> str:
        """Aktif sağlayıcı için kullanılan model adını (örn. yerel Ollama için `bge-m3:latest`) döner."""
        cfg = self._get_live_config()
        resolved_prov = (provider or self._last_active_provider or cfg.get("primary") or "ollama").strip().lower()
        if resolved_prov == "ollama":
            return str(cfg.get("ollama_model") or settings.ollama_embedding_model)
        return BGE_M3_MODEL_ID

    def get_status_summary(self) -> Dict[str, Any]:
        """Yapılandırılmış tüm online ve yerel `BAAI/bge-m3` sağlayıcılarının, vektör ajanının ve proxy havuzunun durum özetini döner."""
        cfg = self._get_live_config()
        ollama_model = str(cfg.get("ollama_model") or settings.ollama_embedding_model)
        ollama_ready = (
            self._call_ollama_bge_m3(
                ["test"],
                timeout_sec=2.0,
                model_override=ollama_model,
                ollama_base_url=cfg.get("ollama_base_url"),
            )
            is not None
        )
        configured_online = []
        if cfg["siliconflow_api_key"]:
            configured_online.append("siliconflow")
        if cfg["cloudflare_account_id"] and cfg["cloudflare_api_token"]:
            configured_online.append("cloudflare")
        if cfg["hf_api_key"]:
            configured_online.append("huggingface")
        if cfg["openrouter_api_key"]:
            configured_online.append("openrouter")
        if cfg["deepinfra_api_key"]:
            configured_online.append("deepinfra")
        if settings.hf_bge_m3_space_url.strip():
            configured_online.append("hf-space")

        provider_order = self._build_provider_order(cfg)
        default_active = (
            "ollama"
            if (cfg["primary"] == "ollama" and ollama_ready)
            else (provider_order[0] if provider_order else "lexical-1024-fallback")
        )
        active_provider = self._last_active_provider or default_active
        vector_agent = self.get_active_vector_agent_summary()

        return {
            "model": self.get_effective_embedding_model(active_provider),
            "canonical_model": BGE_M3_MODEL_ID,
            "dimensions": BGE_M3_DIMENSIONS,
            "primary_preference": cfg["primary"],
            "ollama_embedding_model": ollama_model,
            "vector_agent": {
                "id": vector_agent.get("id"),
                "kod": vector_agent.get("kod"),
                "ad": vector_agent.get("ad"),
                "saglayici_adi": vector_agent.get("saglayici_adi"),
                "provider": vector_agent.get("provider"),
                "model_adi": vector_agent.get("model_adi"),
            },
            "semantic_chunking_enabled": cfg["enable_semantic_chunking"],
            "configured_online_providers": configured_online,
            "local_ollama_bge_m3_ready": ollama_ready,
            "neural_ready": bool(configured_online or ollama_ready),
            "last_active_provider": active_provider,
            "last_latency_ms": self._last_latency_ms,
            "last_proxy_telemetry": self._last_proxy_telemetry,
            "proxy_pool_stats": self.get_proxy_pool_stats(reset=False),
        }


embedding_service = EmbeddingService()
