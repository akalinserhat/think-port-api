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
    ollama_timeout_sec: int = int(os.getenv("OLLAMA_TIMEOUT_SEC", "90"))
    ollama_discovery_timeout_sec: float = float(os.getenv("OLLAMA_DISCOVERY_TIMEOUT_SEC", "2.0"))
    pollinations_host: str = "text.pollinations.ai"
    pollinations_timeout_sec: int = int(os.getenv("POLLINATIONS_TIMEOUT_SEC", "30"))
    web_gateway_timeout_sec: int = int(os.getenv("WEB_GATEWAY_TIMEOUT_SEC", "90"))
    hf_flux_space_url: str = "https://black-forest-labs-flux-1-schnell.hf.space"
    stable_horde_base_url: str = "https://stablehorde.net/api/v2"
    max_extracted_document_chars: int = 60000
    stream_wait_timeout_sec: int = int(os.getenv("STREAM_WAIT_TIMEOUT_SEC", "95"))
    model_discovery_cache_ttl_sec: float = float(os.getenv("MODEL_DISCOVERY_CACHE_TTL_SEC", "15.0"))
    external_openai_base_url: str = os.getenv("EXTERNAL_OPENAI_BASE_URL", os.getenv("OPENAI_BASE_URL", ""))
    external_openai_api_key: str = os.getenv("EXTERNAL_OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", ""))
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", os.getenv("GOOGLE_API_KEY", ""))
    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
    system_fingerprint: str = "fp_browser_gateway_v2"
    frontend_dist_dir: Path = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    sqlite_db_path: Path = Path(__file__).resolve().parents[2] / "data" / "gateway.db"


settings = AppConfig()

IMAGE_STYLE_MODIFIERS: Dict[str, str] = {
    "flux": "high quality, detailed, sharp focus, 8k",
    "flux-realism": "photorealistic, raw photo, 8k uhd, DSLR, natural lighting, ultra detailed, realistic texture",
    "flux-anime": "anime style, vibrant anime key visual, studio ghibli and makoto shinkai aesthetic, crisp lineart, cel shaded",
    "flux-3d": "3d render, octane render, unreal engine 5, Pixar and Blender 3D style, volumetric lighting, ray tracing",
    "turbo": "cinematic lighting, high detail, concept art, sharp focus",
}

WEB_MODEL_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "id": "gpt-4o",
        "name": "GPT-4o (Web Gateway)",
        "vendor": "OpenAI",
        "provider": "chatgpt-web",
        "type": "chat",
        "is_image": False,
        "badge": "Web AI",
        "web_model": "openai-fast",
        "fallback_local": "qwen2.5:7b",
        "description": "OpenAI GPT-4o web oturumu (yüksek hızlı Web AI köprüsü).",
    },
    {
        "id": "claude-3-5-sonnet",
        "name": "Claude 3.5 Sonnet (Web Gateway)",
        "vendor": "Anthropic",
        "provider": "claude-web",
        "type": "chat",
        "is_image": False,
        "badge": "Web AI",
        "web_model": "openai-fast",
        "fallback_local": "qwen2.5:14b",
        "description": "Anthropic Claude 3.5 Sonnet web oturumu köprüsü.",
    },
    {
        "id": "deepseek-r1",
        "name": "DeepSeek R1 (Web Gateway)",
        "vendor": "DeepSeek",
        "provider": "deepseek-web",
        "type": "chat",
        "is_image": False,
        "badge": "Reasoning",
        "web_model": "openai-fast",
        "fallback_local": "qwen2.5:7b",
        "description": "DeepSeek R1 düşünce zinciri (Chain-of-Thought) web köprüsü.",
    },
    {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro (Web Gateway)",
        "vendor": "Google",
        "provider": "gemini-web",
        "type": "chat",
        "is_image": False,
        "badge": "Web AI",
        "web_model": "openai-fast",
        "fallback_local": "gemma4:e4b",
        "description": "Google Gemini 2.5 Pro web oturumu köprüsü.",
    },
]

IMAGE_MODEL_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "id": "flux",
        "name": "FLUX.1 (Görsel Üretici)",
        "vendor": "Black Forest Labs",
        "provider": "pollinations-image",
        "type": "image",
        "badge": "Görsel · HD",
        "image_model": "flux",
        "is_image": True,
        "description": "Ücretsiz, yüksek çözünürlüklü genel amaçlı yapay zeka görsel üretim modeli (FLUX.1).",
    },
    {
        "id": "flux-realism",
        "name": "FLUX Realism (Fotogerçekçi)",
        "vendor": "Black Forest Labs",
        "provider": "pollinations-image",
        "type": "image",
        "badge": "Fotoğraf · HD",
        "image_model": "flux-realism",
        "is_image": True,
        "description": "Fotogerçekçi portre, mimari ve doğa fotoğrafı üretimi için optimize edilmiş FLUX modeli.",
    },
    {
        "id": "flux-anime",
        "name": "FLUX Anime & İllüstrasyon",
        "vendor": "Black Forest Labs",
        "provider": "pollinations-image",
        "type": "image",
        "badge": "Anime · Sanat",
        "image_model": "flux-anime",
        "is_image": True,
        "description": "Anime, manga ve dijital konsept sanat çizimleri için özelleştirilmiş görsel üretim modeli.",
    },
    {
        "id": "flux-3d",
        "name": "FLUX 3D Render",
        "vendor": "Black Forest Labs",
        "provider": "pollinations-image",
        "type": "image",
        "badge": "3D · Render",
        "image_model": "flux-3d",
        "is_image": True,
        "description": "3B karakter, izometrik sahne ve Pixar/Octane Render tarzı görsel üretim modeli.",
    },
    {
        "id": "turbo",
        "name": "SDXL Turbo (Hızlı Görsel)",
        "vendor": "Stability AI",
        "provider": "pollinations-image",
        "type": "image",
        "badge": "Hızlı · Görsel",
        "image_model": "turbo",
        "is_image": True,
        "description": "Saniyeler içinde hızlı görsel ve konsept taslaklar üreten SDXL Turbo modeli.",
    },
]

# Standart OpenAI, Google Gemini, Anthropic Claude ve DeepSeek model varyantlarını
# desteklenen Gateway modellerine normalize eden alias (takma ad) eşleştirme haritası.
MODEL_ALIAS_MAP: Dict[str, str] = {
    # OpenAI GPT / O-serisi varyantları -> gpt-4o
    "gpt-4o": "gpt-4o",
    "gpt-4o-mini": "gpt-4o",
    "gpt-4o-2024-05-13": "gpt-4o",
    "gpt-4o-2024-08-06": "gpt-4o",
    "gpt-4o-2024-11-20": "gpt-4o",
    "gpt-4o-mini-2024-07-18": "gpt-4o",
    "chatgpt-4o-latest": "gpt-4o",
    "gpt-4-turbo": "gpt-4o",
    "gpt-4-turbo-preview": "gpt-4o",
    "gpt-4-0125-preview": "gpt-4o",
    "gpt-4-1106-preview": "gpt-4o",
    "gpt-4": "gpt-4o",
    "gpt-4-0613": "gpt-4o",
    "gpt-4-32k": "gpt-4o",
    "gpt-4.1": "gpt-4o",
    "gpt-4.1-mini": "gpt-4o",
    "gpt-4.1-nano": "gpt-4o",
    "gpt-4.5-preview": "gpt-4o",
    "gpt-3.5-turbo": "gpt-4o",
    "gpt-3.5-turbo-0125": "gpt-4o",
    "gpt-3.5-turbo-1106": "gpt-4o",
    "gpt-3.5-turbo-16k": "gpt-4o",
    "o1": "gpt-4o",
    "o1-mini": "gpt-4o",
    "o1-preview": "gpt-4o",
    "o3": "gpt-4o",
    "o3-mini": "gpt-4o",
    "o4-mini": "gpt-4o",
    "openai": "gpt-4o",
    "openai-fast": "gpt-4o",
    "openai-large": "gpt-4o",
    "chatgpt": "gpt-4o",
    # Google Gemini varyantları -> gemini-2.5-pro
    "gemini-2.5-pro": "gemini-2.5-pro",
    "gemini-2.5-pro-preview": "gemini-2.5-pro",
    "gemini-2.5-pro-exp": "gemini-2.5-pro",
    "gemini-2.5-flash": "gemini-2.5-pro",
    "gemini-2.5-flash-preview": "gemini-2.5-pro",
    "gemini-2.0-flash": "gemini-2.5-pro",
    "gemini-2.0-flash-001": "gemini-2.5-pro",
    "gemini-2.0-flash-exp": "gemini-2.5-pro",
    "gemini-2.0-flash-lite": "gemini-2.5-pro",
    "gemini-2.0-pro": "gemini-2.5-pro",
    "gemini-2.0-pro-exp": "gemini-2.5-pro",
    "gemini-1.5-pro": "gemini-2.5-pro",
    "gemini-1.5-pro-latest": "gemini-2.5-pro",
    "gemini-1.5-pro-001": "gemini-2.5-pro",
    "gemini-1.5-pro-002": "gemini-2.5-pro",
    "gemini-1.5-flash": "gemini-2.5-pro",
    "gemini-1.5-flash-latest": "gemini-2.5-pro",
    "gemini-1.5-flash-001": "gemini-2.5-pro",
    "gemini-1.5-flash-002": "gemini-2.5-pro",
    "gemini-1.5-flash-8b": "gemini-2.5-pro",
    "gemini-pro": "gemini-2.5-pro",
    "gemini-ultra": "gemini-2.5-pro",
    "gemini": "gemini-2.5-pro",
    # Anthropic Claude varyantları -> claude-3-5-sonnet
    "claude-3-5-sonnet": "claude-3-5-sonnet",
    "claude-3-5-sonnet-latest": "claude-3-5-sonnet",
    "claude-3-5-sonnet-20241022": "claude-3-5-sonnet",
    "claude-3-5-sonnet-20240620": "claude-3-5-sonnet",
    "claude-3.5-sonnet": "claude-3-5-sonnet",
    "claude-3-7-sonnet": "claude-3-5-sonnet",
    "claude-3-7-sonnet-latest": "claude-3-5-sonnet",
    "claude-3-7-sonnet-20250219": "claude-3-5-sonnet",
    "claude-3.7-sonnet": "claude-3-5-sonnet",
    "claude-3-5-haiku": "claude-3-5-sonnet",
    "claude-3-5-haiku-latest": "claude-3-5-sonnet",
    "claude-3-5-haiku-20241022": "claude-3-5-sonnet",
    "claude-3-opus": "claude-3-5-sonnet",
    "claude-3-opus-latest": "claude-3-5-sonnet",
    "claude-3-opus-20240229": "claude-3-5-sonnet",
    "claude-3-sonnet": "claude-3-5-sonnet",
    "claude-3-sonnet-20240229": "claude-3-5-sonnet",
    "claude-3-haiku": "claude-3-5-sonnet",
    "claude-3-haiku-20240307": "claude-3-5-sonnet",
    "claude-sonnet-4": "claude-3-5-sonnet",
    "claude-sonnet-4-0": "claude-3-5-sonnet",
    "claude-opus-4": "claude-3-5-sonnet",
    "claude-opus-4-0": "claude-3-5-sonnet",
    "claude-hybridspace": "claude-3-5-sonnet",
    "claude": "claude-3-5-sonnet",
    # DeepSeek varyantları -> deepseek-r1
    "deepseek-r1": "deepseek-r1",
    "deepseek-chat": "deepseek-r1",
    "deepseek-reasoner": "deepseek-r1",
    "deepseek-coder": "deepseek-r1",
    "deepseek-v3": "deepseek-r1",
    "deepseek-v2.5": "deepseek-r1",
    "deepseek": "deepseek-r1",
    # Görsel üretim varyantları -> flux / turbo
    "dall-e-3": "flux",
    "dall-e-2": "flux",
    "gpt-image-1": "flux",
    "flux.1": "flux",
    "flux-1": "flux",
    "flux-schnell": "flux",
    "flux-dev": "flux",
    "flux-pro": "flux",
    "sdxl": "turbo",
    "sdxl-turbo": "turbo",
}
