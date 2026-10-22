import json
import time
import urllib.request
from typing import Any, Dict, List, Optional
from app.core.config import (
    settings,
    WEB_MODEL_DEFINITIONS,
    IMAGE_MODEL_DEFINITIONS,
    MODEL_ALIAS_MAP,
)
from app.dtos.model_dto import (
    ModelDefinitionDTO,
    ModelItemResponseDTO,
    ModelListResponseDTO,
    ModelTypeLiteral,
)
from app.repositories.state_store import InMemoryStateStore, store as default_store

ACTIVE_SESSION_STATUSES = {"idle", "busy", "warming_up"}


class ModelService:
    """
    Model keşif, alias (takma ad) normalizasyonu ve katalog yönetim servisi.
    Yerel Ollama modellerini, harici API sağlayıcılarını, Web AI modellerini
    ve Görsel üretim modellerini kısa süreli önbellek (cache) ve aktiflik durumuyla yönetir.
    """

    def __init__(self, state_store: Optional[InMemoryStateStore] = None) -> None:
        self._store = state_store or default_store
        self._ollama_cache_payload: List[Dict[str, Any]] = []
        self._ollama_cache_ts: float = 0.0
        self._external_cache_models: List[ModelDefinitionDTO] = []
        self._external_cache_ts: float = 0.0

    def invalidate_cache(self) -> None:
        """Model keşif önbelleğini sıfırlar."""
        self._ollama_cache_payload = []
        self._ollama_cache_ts = 0.0
        self._external_cache_models = []
        self._external_cache_ts = 0.0

    def discover_local_ollama_models(
        self,
        include_embeddings: bool = False,
        force_refresh: bool = False,
    ) -> List[ModelDefinitionDTO]:
        """Yerel Ollama servisinde kurulu modelleri kısa süreli önbellekle dinamik olarak keşfeder."""
        raw_models = self._get_cached_ollama_tags(force_refresh=force_refresh)
        discovered: List[ModelDefinitionDTO] = []
        for raw_entry in raw_models:
            name = raw_entry.get("name", "")
            if not name:
                continue
            is_embed = self._is_embedding_model(name)
            if is_embed and not include_embeddings:
                continue
            discovered.append(self._map_ollama_entry_to_dto(raw_entry, is_embedding=is_embed))
        return discovered

    def discover_external_api_models(self, force_refresh: bool = False) -> List[ModelDefinitionDTO]:
        """Yapılandırılmış harici OpenAI uyumlu API sağlayıcısı varsa canlı modellerini keşfeder."""
        base_url = settings.external_openai_base_url.strip().rstrip("/")
        api_key = settings.external_openai_api_key.strip()
        if not base_url or not api_key:
            return []

        now = time.monotonic()
        ttl = settings.model_discovery_cache_ttl_sec
        if not force_refresh and self._external_cache_ts > 0 and (now - self._external_cache_ts) < ttl:
            return list(self._external_cache_models)

        raw_items = self._fetch_external_models_payload(base_url, api_key)
        discovered: List[ModelDefinitionDTO] = []
        for item in raw_items:
            mid = str(item.get("id", "")).strip()
            if not mid:
                continue
            is_embed = self._is_embedding_model(mid)
            is_img = self._is_image_model_name(mid)
            mtype: ModelTypeLiteral = "embedding" if is_embed else ("image" if is_img else "chat")
            owner = str(item.get("owned_by") or "external-api")
            discovered.append(
                ModelDefinitionDTO(
                    id=mid,
                    name=str(item.get("name") or mid),
                    vendor=owner,
                    provider="external-api",
                    type=mtype,
                    badge="External API",
                    description=f"Harici API sağlayıcısı ({owner}) üzerinden sunulan canlı model.",
                    is_local=False,
                    is_image=is_img,
                    available=True,
                )
            )
        self._external_cache_models = discovered
        self._external_cache_ts = now
        return list(discovered)

    def get_web_models(self) -> List[ModelDefinitionDTO]:
        """Web AI modellerini güncel oturum/sağlayıcı aktiflik durumuyla (`available`) döner."""
        models: List[ModelDefinitionDTO] = []
        for item in WEB_MODEL_DEFINITIONS:
            provider = str(item.get("provider", "chatgpt-web"))
            explicit_avail = item.get("available")
            is_avail = (
                bool(explicit_avail)
                if explicit_avail is not None
                else self._is_provider_available(provider)
            )
            data = {
                **item,
                "type": item.get("type", "chat"),
                "is_image": bool(item.get("is_image", False)),
                "available": is_avail,
            }
            models.append(ModelDefinitionDTO(**data))
        return models

    def get_image_models(self) -> List[ModelDefinitionDTO]:
        """Görsel üretim modellerini güncel sağlayıcı aktiflik durumuyla (`available`) döner."""
        models: List[ModelDefinitionDTO] = []
        for item in IMAGE_MODEL_DEFINITIONS:
            provider = str(item.get("provider", "pollinations-image"))
            explicit_avail = item.get("available")
            is_avail = (
                bool(explicit_avail)
                if explicit_avail is not None
                else self._is_provider_available(provider)
            )
            data = {
                **item,
                "type": "image",
                "is_image": True,
                "available": is_avail,
            }
            models.append(ModelDefinitionDTO(**data))
        return models

    def get_inactive_fallback_local_models(
        self,
        active_local_ids: set[str],
    ) -> List[ModelDefinitionDTO]:
        """
        Kurulu/aktif olmayan ancak yedek olarak tanımlanmış yerel modelleri
        `available=False` olarak döner (`?include_inactive=true` sorguları için).
        """
        inactive: List[ModelDefinitionDTO] = []
        seen: set[str] = set(active_local_ids)
        for item in WEB_MODEL_DEFINITIONS:
            fb_id = str(item.get("fallback_local") or "").strip()
            if not fb_id or fb_id in seen:
                continue
            seen.add(fb_id)
            inactive.append(
                ModelDefinitionDTO(
                    id=fb_id,
                    name=f"{fb_id} (Yerel - Çevrimdışı)",
                    vendor="Local (Ollama)",
                    provider="local-engine",
                    type="chat",
                    badge="Offline",
                    description="Yapılandırılmış yerel yedek model (Ollama servisinde şu anda aktif değil).",
                    is_local=True,
                    is_image=False,
                    available=False,
                )
            )
        return inactive

    def get_full_model_library(
        self,
        include_embeddings: bool = False,
        include_inactive: bool = False,
    ) -> List[ModelDefinitionDTO]:
        """Yerel, Harici API, Web AI ve Görsel üretim modellerinin birleşik kataloğunu döner."""
        local_models = self.discover_local_ollama_models(include_embeddings=include_embeddings)
        external_models = self.discover_external_api_models()
        web_models = self.get_web_models()
        image_models = self.get_image_models()

        combined = local_models + external_models + web_models + image_models
        if include_inactive:
            active_local_ids = {m.id for m in local_models}
            combined.extend(self.get_inactive_fallback_local_models(active_local_ids))

        deduped: List[ModelDefinitionDTO] = []
        seen_ids: set[str] = set()
        for model in combined:
            if model.id in seen_ids:
                continue
            if not include_inactive and not model.available:
                continue
            seen_ids.add(model.id)
            deduped.append(model)
        return deduped

    def get_openai_model_list(
        self,
        model_type: Optional[str] = None,
        exclude_image: bool = False,
        include_inactive: bool = False,
    ) -> ModelListResponseDTO:
        """
        OpenAI /v1/models standardına uygun, filtrelenebilir model listesi DTO'su döner.
        - `model_type`: 'chat' | 'image' | 'embedding'
        - `exclude_image`: True ise `is_image=True` olan görsel üretim modellerini çıkarır.
        - `include_inactive`: False (varsayılan) ise yalnızca `available=True` olan aktif modelleri döndürür.
        """
        normalized_type = (model_type or "").strip().lower() or None
        include_embeddings = normalized_type in (None, "embedding")

        library = self.get_full_model_library(
            include_embeddings=include_embeddings,
            include_inactive=include_inactive,
        )

        filtered: List[ModelDefinitionDTO] = []
        for model in library:
            if not include_inactive and not model.available:
                continue
            if exclude_image and (model.is_image or model.type == "image"):
                continue
            if normalized_type == "chat" and (model.is_image or model.type != "chat"):
                continue
            if normalized_type == "image" and not (model.is_image or model.type == "image"):
                continue
            if normalized_type == "embedding" and model.type != "embedding":
                continue
            filtered.append(model)

        items = [self._map_definition_to_openai_item(m) for m in filtered]
        return ModelListResponseDTO(data=items, models=items)

    def normalize_model_id(self, requested_model: str) -> str:
        """
        Gelen model adını (örn. `gpt-4o-mini`, `gemini-2.0-flash`, `claude-3-5-sonnet-20241022`, `deepseek-chat`)
        desteklenen mevcut bir Gateway modeline normalize eder.
        """
        raw = (requested_model or "").strip()
        if not raw:
            return "gpt-4o"

        lower = raw.lower()
        # Tedarikçi öneki varsa temizlenmiş halini de hazırla (örn. 'openai/gpt-4o-mini' -> 'gpt-4o-mini')
        stripped = lower.split("/", 1)[-1] if "/" in lower else lower

        # 1. Canlı yerel Ollama, harici API, Web ve Görsel modellerde birebir eşleşme kontrolü
        known_models = (
            self.discover_local_ollama_models(include_embeddings=True)
            + self.discover_external_api_models()
            + self.get_web_models()
            + self.get_image_models()
        )
        for m in known_models:
            if m.id == raw or m.id.lower() == lower or m.id.lower() == stripped:
                return m.id

        # 2. Sabit alias (takma ad) tablosu kontrolü
        if lower in MODEL_ALIAS_MAP:
            return MODEL_ALIAS_MAP[lower]
        if stripped in MODEL_ALIAS_MAP:
            return MODEL_ALIAS_MAP[stripped]

        # 3. Aile / Önek (Wildcard) tabanlı eşleştirme
        for candidate in (lower, stripped):
            if candidate.startswith(("claude-3-5-sonnet", "claude-3.5-sonnet", "claude-3-7-sonnet", "claude-3.7-sonnet", "claude-3", "claude-sonnet", "claude-opus", "claude-haiku", "claude")):
                return "claude-3-5-sonnet"
            if candidate.startswith(("gemini-", "gemini")):
                return "gemini-2.5-pro"
            if candidate.startswith(("deepseek-", "deepseek")):
                return "deepseek-r1"
            if candidate.startswith(("gpt-4", "gpt-3.5", "gpt-", "chatgpt-", "o1", "o3", "o4")):
                return "gpt-4o"
            if candidate.startswith("flux-realism"):
                return "flux-realism"
            if candidate.startswith("flux-anime"):
                return "flux-anime"
            if candidate.startswith("flux-3d"):
                return "flux-3d"
            if candidate.startswith(("flux", "dall-e", "gpt-image")):
                return "flux"
            if candidate.startswith(("sdxl", "turbo")):
                return "turbo"

        # 4. Yerel model formatındaysa ancak kurulu değilse mevcut en iyi yerel modeli veya gpt-4o'yu seç
        local_models = self.discover_local_ollama_models()
        local_ids = [m.id for m in local_models]
        if local_ids:
            for lid in local_ids:
                if lid.split(":")[0].lower() == stripped.split(":")[0]:
                    return lid
            if ":" in raw:
                return local_ids[0]

        return "gpt-4o"

    def resolve_provider_for_model(self, model_id: str) -> str:
        """Model ID'sine (veya takma adına) karşılık gelen sağlayıcı (provider) adını çözer."""
        normalized = self.normalize_model_id(model_id)
        for model in self.get_full_model_library(include_embeddings=True, include_inactive=True):
            if model.id == normalized:
                return model.provider
        return "chatgpt-web"

    def find_image_model(self, model_id: str) -> Optional[ModelDefinitionDTO]:
        """Model ID'si (veya alias'ı) bir görsel üretim modeline aitse tanım DTO'sunu döner."""
        normalized = self.normalize_model_id(model_id)
        return next(
            (m for m in self.get_image_models() if m.id in (model_id, normalized)),
            None,
        )

    def find_web_model(self, model_id: str) -> Optional[ModelDefinitionDTO]:
        """Model ID'si (veya alias'ı) bir Web AI modeline aitse tanım DTO'sunu döner."""
        normalized = self.normalize_model_id(model_id)
        return next(
            (m for m in self.get_web_models() if m.id in (model_id, normalized)),
            None,
        )

    def select_best_local_model(self, preferred_model: Optional[str] = "qwen2.5:7b") -> Optional[str]:
        """Tercih edilen yerel modeli veya mevcut ilk yerel sohbet modelini seçer; hiç yerel model yoksa None döner."""
        local_ids = [m.id for m in self.discover_local_ollama_models(include_embeddings=False)]
        if not local_ids:
            return None
        if preferred_model and preferred_model in local_ids:
            return preferred_model
        return local_ids[0]

    def _is_provider_available(self, provider: str) -> bool:
        """Belirtilen sağlayıcının aktif bir oturumu veya API anahtarı olup olmadığını denetler."""
        if provider == "local-engine":
            return len(self._get_cached_ollama_tags()) > 0
        if provider == "external-api":
            return bool(settings.external_openai_base_url and settings.external_openai_api_key)

        api_key_map = {
            "chatgpt-web": settings.external_openai_api_key,
            "claude-web": settings.anthropic_api_key,
            "gemini-web": settings.gemini_api_key,
            "deepseek-web": settings.deepseek_api_key,
        }
        if api_key_map.get(provider):
            return True

        sessions = getattr(self._store, "browser_sessions", [])
        return any(
            s.get("provider") == provider
            and str(s.get("status", "idle")).lower() in ACTIVE_SESSION_STATUSES
            for s in sessions
        )

    def _get_cached_ollama_tags(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Ollama /api/tags yanıtını kısa süreli bellek içi önbellekle döner."""
        now = time.monotonic()
        ttl = settings.model_discovery_cache_ttl_sec
        if not force_refresh and self._ollama_cache_ts > 0 and (now - self._ollama_cache_ts) < ttl:
            return list(self._ollama_cache_payload)

        fetched = self._fetch_ollama_tags_payload()
        self._ollama_cache_payload = fetched
        self._ollama_cache_ts = now
        return list(fetched)

    @staticmethod
    def _fetch_ollama_tags_payload() -> List[Dict[str, Any]]:
        """Ollama /api/tags uç noktasından ham model listesini çeker."""
        url = f"http://{settings.ollama_host}:{settings.ollama_port}/api/tags"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=settings.ollama_discovery_timeout_sec) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("models", [])
        except Exception:
            return []

    @staticmethod
    def _fetch_external_models_payload(base_url: str, api_key: str) -> List[Dict[str, Any]]:
        """Harici OpenAI uyumlu /models uç noktasından canlı model listesini çeker."""
        url = f"{base_url}/models"
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "application/json",
                },
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=settings.ollama_discovery_timeout_sec) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("data", [])
        except Exception:
            return []

    @staticmethod
    def _is_embedding_model(model_name: str) -> bool:
        """Modelin yalnızca vektör/embedding amaçlı olup olmadığını kontrol eder."""
        lower = model_name.lower()
        return "bge-" in lower or "embed" in lower

    @staticmethod
    def _is_image_model_name(model_name: str) -> bool:
        """Model adının görsel üretim modeli olup olmadığını kontrol eder."""
        lower = model_name.lower()
        return any(k in lower for k in ("flux", "dall-e", "sdxl", "stable-diffusion", "gpt-image"))

    @staticmethod
    def _map_ollama_entry_to_dto(
        raw_entry: Dict[str, Any],
        is_embedding: bool = False,
    ) -> ModelDefinitionDTO:
        """Tek bir Ollama model kaydını ModelDefinitionDTO nesnesine dönüştürür."""
        name = raw_entry.get("name", "")
        size_gb = round(raw_entry.get("size", 0) / (1024 ** 3), 1)
        details = raw_entry.get("details", {})
        family = str(details.get("family", "Local LLM")).upper()
        param_size = details.get("parameter_size", f"{size_gb}GB")
        mtype: ModelTypeLiteral = "embedding" if is_embedding else "chat"
        return ModelDefinitionDTO(
            id=name,
            name=name,
            vendor=f"Local ({family})",
            provider="local-engine",
            type=mtype,
            badge=f"{param_size} · {size_gb}GB",
            description=f"Sisteminizde kurulu gerçek yerel yapay zeka modeli ({family}, {size_gb} GB).",
            is_local=True,
            is_image=False,
            available=True,
        )

    @staticmethod
    def _map_definition_to_openai_item(model: ModelDefinitionDTO) -> ModelItemResponseDTO:
        """ModelDefinitionDTO nesnesini OpenAI standart ModelItemResponseDTO nesnesine dönüştürür."""
        resolved_type: ModelTypeLiteral = "image" if model.is_image else model.type
        return ModelItemResponseDTO(
            id=model.id,
            owned_by=model.provider,
            provider=model.provider,
            type=resolved_type,
            is_image=model.is_image,
            available=model.available,
            name=model.name,
            vendor=model.vendor,
            badge=model.badge,
            description=model.description,
            is_local=model.is_local,
        )
