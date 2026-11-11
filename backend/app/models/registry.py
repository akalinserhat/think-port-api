"""
ThinkPort AI Gateway - Merkezi Genişletilebilir Model Kayıt Defteri (registry.py).

Yeni bir yapay zeka modeli eklemek için:
1. `app/models/definitions/` altında `BaseThinkPortModel` (`IThinkPortModel`) sınıfından türeyen
   yeni bir model dosyası oluşturun.
2. `DEFAULT_REGISTERED_MODELS` listesine ekleyin veya `model_registry.register(YeniModel())` çağırın.
"""
from typing import Any, Dict, List, Optional
from app.models.base_model import IThinkPortModel
from app.models.definitions import (
    Gpt4oModel,
    Claude35SonnetModel,
    DeepSeekR1Model,
    Gemini25ProModel,
    Flux1Model,
    FluxRealismModel,
    FluxAnimeModel,
    Flux3dModel,
    SdxlTurboModel,
)


class ThinkPortModelRegistry:
    """IThinkPortModel örneklerini merkezi olarak yöneten genişletilebilir kayıt defteri."""

    def __init__(self) -> None:
        self._models: Dict[str, IThinkPortModel] = {}

    def register(self, model: IThinkPortModel) -> None:
        """Yeni bir IThinkPortModel örneğini kayıt defterine ekler veya günceller."""
        self._models[model.id] = model

    def unregister(self, model_id: str) -> None:
        """Belirtilen ID'ye sahip modeli kayıt defterinden çıkarır."""
        self._models.pop(model_id, None)

    def get(self, model_id: str) -> Optional[IThinkPortModel]:
        """ID ile model tanımını getirir."""
        return self._models.get(model_id)

    def list_all(self) -> List[IThinkPortModel]:
        """Kayıtlı tüm IThinkPortModel örneklerini döner."""
        return list(self._models.values())

    def list_web_models(self) -> List[IThinkPortModel]:
        """Web AI / Sohbet modellerini döner."""
        return [m for m in self._models.values() if not m.is_image and not m.is_local]

    def list_image_models(self) -> List[IThinkPortModel]:
        """Görsel üretim modellerini döner."""
        return [m for m in self._models.values() if m.is_image]

    def get_web_model_dicts(self) -> List[Dict[str, Any]]:
        """config.WEB_MODEL_DEFINITIONS uyumlu sözlük listesi döner."""
        return [m.to_definition_dict() for m in self.list_web_models()]

    def get_image_model_dicts(self) -> List[Dict[str, Any]]:
        """config.IMAGE_MODEL_DEFINITIONS uyumlu sözlük listesi döner."""
        return [m.to_definition_dict() for m in self.list_image_models()]

    def get_style_modifiers(self) -> Dict[str, str]:
        """Görsel üretim modellerinin stil değiştirici haritasını döner."""
        return {
            m.id: m.style_modifier
            for m in self.list_image_models()
            if m.style_modifier
        }

    def get_alias_map(self) -> Dict[str, str]:
        """Tüm kayıtlı modellerin alias -> model.id eşleştirme tablosunu döner."""
        alias_map: Dict[str, str] = {}
        for model in self._models.values():
            alias_map[model.id.lower()] = model.id
            for alias in model.aliases:
                alias_map[alias.lower()] = model.id
        return alias_map


DEFAULT_REGISTERED_MODELS: List[IThinkPortModel] = [
    Gpt4oModel(),
    Claude35SonnetModel(),
    DeepSeekR1Model(),
    Gemini25ProModel(),
    Flux1Model(),
    FluxRealismModel(),
    FluxAnimeModel(),
    Flux3dModel(),
    SdxlTurboModel(),
]

model_registry = ThinkPortModelRegistry()
for _m in DEFAULT_REGISTERED_MODELS:
    model_registry.register(_m)

