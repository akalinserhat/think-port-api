"""
ThinkPort AI Gateway - FLUX.1 Görsel Üretim Model Tanımı (flux_1_model.py).
IThinkPortModel arayüzünü uygulayan bağımsız FLUX.1 görsel üretim model sınıfı.
"""
from typing import List, Optional
from app.models.base_model import BaseThinkPortModel


class Flux1Model(BaseThinkPortModel):
    """Black Forest Labs FLUX.1 yüksek çözünürlüklü genel amaçlı görsel üretim modeli."""

    @property
    def id(self) -> str:
        return "flux"

    @property
    def name(self) -> str:
        return "FLUX.1 (Görsel Üretici)"

    @property
    def vendor(self) -> str:
        return "Black Forest Labs"

    @property
    def provider(self) -> str:
        return "pollinations-image"

    @property
    def badge(self) -> str:
        return "Görsel · HD"

    @property
    def description(self) -> str:
        return "Ücretsiz, yüksek çözünürlüklü genel amaçlı yapay zeka görsel üretim modeli (FLUX.1)."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/Flux1Model.ts"

    @property
    def is_image(self) -> bool:
        return True

    @property
    def image_model(self) -> Optional[str]:
        return "flux"

    @property
    def style_modifier(self) -> Optional[str]:
        return "high quality, detailed, sharp focus, 8k"

    @property
    def aliases(self) -> List[str]:
        return [
            "flux",
            "dall-e-3",
            "dall-e-2",
            "gpt-image-1",
            "flux.1",
            "flux-1",
            "flux-schnell",
            "flux-dev",
            "flux-pro",
        ]

