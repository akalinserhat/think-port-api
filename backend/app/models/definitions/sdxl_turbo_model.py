"""
ThinkPort AI Gateway - SDXL Turbo Model Tanımı (sdxl_turbo_model.py).
IThinkPortModel arayüzünü uygulayan bağımsız SDXL Turbo hızlı görsel üretim model sınıfı.
"""
from typing import List, Optional
from app.models.base_model import BaseThinkPortModel


class SdxlTurboModel(BaseThinkPortModel):
    """Stability AI SDXL Turbo ultra hızlı görsel üretim modeli."""

    @property
    def id(self) -> str:
        return "turbo"

    @property
    def name(self) -> str:
        return "SDXL Turbo (Hızlı Görsel)"

    @property
    def vendor(self) -> str:
        return "Stability AI"

    @property
    def provider(self) -> str:
        return "pollinations-image"

    @property
    def badge(self) -> str:
        return "Hızlı · Görsel"

    @property
    def description(self) -> str:
        return "Saniyeler içinde hızlı görsel ve konsept taslaklar üreten SDXL Turbo modeli."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/SdxlTurboModel.ts"

    @property
    def is_image(self) -> bool:
        return True

    @property
    def image_model(self) -> Optional[str]:
        return "turbo"

    @property
    def style_modifier(self) -> Optional[str]:
        return "cinematic lighting, high detail, concept art, sharp focus"

    @property
    def aliases(self) -> List[str]:
        return ["turbo", "sdxl", "sdxl-turbo"]

