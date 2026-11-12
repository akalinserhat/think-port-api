"""
ThinkPort AI Gateway - Merkezi Uygulama Yapılandırma Modülü (config.py).
PostgreSQL (pgvector) veritabanı bağlantı bilgilerini, yerel Ollama ve Web AI uç noktalarını,
model takma ad (alias) haritalarını ve sistem sabitlerini yönetir.
"""
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Any


@dataclass(frozen=True)
class AppConfig:
    """Merkezi uygulama yapılandırma sabitleri."""

    app_title: str = "ThinkPort API — Enterprise AI Gateway"
    app_version: str = "2.0.0"
    app_description: str = (
        "Clean Architecture (Controller-Service-Repository-DTO) tabanlı, "
        "yerel (Ollama) ve Web AI modelleriyle uyumlu ölçeklenebilir SaaS API katmanı."
    )
    ollama_host: str = os.getenv("OLLAMA_HOST", "127.0.0.1")
    ollama_port: int = int(os.getenv("OLLAMA_PORT", "11434"))
    ollama_timeout_sec: int = int(os.getenv("OLLAMA_TIMEOUT_SEC", "240"))
    ollama_discovery_timeout_sec: float = float(os.getenv("OLLAMA_DISCOVERY_TIMEOUT_SEC", "2.0"))
    pollinations_host: str = "text.pollinations.ai"
    pollinations_timeout_sec: int = int(os.getenv("POLLINATIONS_TIMEOUT_SEC", "120"))
    web_gateway_timeout_sec: int = int(os.getenv("WEB_GATEWAY_TIMEOUT_SEC", "180"))
    hf_flux_space_url: str = "https://black-forest-labs-flux-1-schnell.hf.space"
    stable_horde_base_url: str = "https://stablehorde.net/api/v2"
    max_extracted_document_chars: int = 60000
    stream_wait_timeout_sec: int = int(os.getenv("STREAM_WAIT_TIMEOUT_SEC", "185"))
    model_discovery_cache_ttl_sec: float = float(os.getenv("MODEL_DISCOVERY_CACHE_TTL_SEC", "15.0"))
    external_openai_base_url: str = os.getenv("EXTERNAL_OPENAI_BASE_URL", os.getenv("OPENAI_BASE_URL", ""))
    external_openai_api_key: str = os.getenv("EXTERNAL_OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", ""))
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", os.getenv("GOOGLE_API_KEY", ""))
    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
    system_fingerprint: str = "fp_browser_gateway_v2"
    frontend_dist_dir: Path = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    postgres_host: str = os.getenv("POSTGRES_HOST", "127.0.0.1")
    postgres_port: int = int(os.getenv("POSTGRES_PORT", "5432"))
    postgres_user: str = os.getenv("POSTGRES_USER", "gateway")
    postgres_password: str = os.getenv("POSTGRES_PASSWORD", "gateway_secret_password")
    postgres_db: str = os.getenv("POSTGRES_DB", "thinkport_db")
    webakus_postgres_user: str = os.getenv("WEBAKUS_POSTGRES_USER", "postgres")
    webakus_postgres_password: str = os.getenv("WEBAKUS_POSTGRES_PASSWORD", "postgres")
    webakus_postgres_db: str = os.getenv("WEBAKUS_POSTGRES_DB", "webakus_db")


settings = AppConfig()

# Modeller her biri kendi kod dosyasında IThinkPortModel arayüzünü uygulayan
# merkezi model_registry üzerinden dinamik olarak yüklenir.
from app.models.registry import model_registry

IMAGE_STYLE_MODIFIERS: Dict[str, str] = model_registry.get_style_modifiers()

WEB_MODEL_DEFINITIONS: List[Dict[str, Any]] = model_registry.get_web_model_dicts()

IMAGE_MODEL_DEFINITIONS: List[Dict[str, Any]] = model_registry.get_image_model_dicts()

# Standart OpenAI, Google Gemini, Anthropic Claude ve DeepSeek model varyantlarını
# desteklenen Gateway modellerine normalize eden alias (takma ad) eşleştirme haritası.
MODEL_ALIAS_MAP: Dict[str, str] = model_registry.get_alias_map()

