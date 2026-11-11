"""
ThinkPort AI Gateway - FLUX Anime Model Tanımı (flux_anime_model.py).
IThinkPortModel arayüzünü uygulayan bağımsız FLUX Anime görsel üretim model sınıfı.
"""
from typing import List, Optional
from app.models.base_model import BaseThinkPortModel


class FluxAnimeModel(BaseThinkPortModel):
    """Black Forest Labs FLUX Anime & İllüstrasyon görsel üretim modeli."""

    @property
    def id(self) -> str:
        return "flux-anime"

    @property
    def name(self) -> str:
        return "FLUX Anime & İllüstrasyon"

    @property
    def vendor(self) -> str:
        return "Black Forest Labs"

    @property
    def provider(self) -> str:
        return "pollinations-image"

    @property
    def badge(self) -> str:
        return "Anime · Sanat"

    @property
    def description(self) -> str:
        return "Anime, manga ve dijital konsept sanat çizimleri için özelleştirilmiş görsel üretim modeli."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/FluxAnimeModel.ts"

    @property
    def is_image(self) -> bool:
        return True

    @property
    def image_model(self) -> Optional[str]:
        return "flux-anime"

    @property
    def style_modifier(self) -> Optional[str]:
        return "anime style, vibrant anime key visual, studio ghibli and makoto shinkai aesthetic, crisp lineart, cel shaded"

    @property
    def aliases(self) -> List[str]:
        return ["flux-anime", "anime"]

