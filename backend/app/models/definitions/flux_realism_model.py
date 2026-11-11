"""
ThinkPort AI Gateway - FLUX Realism Model Tanımı (flux_realism_model.py).
IThinkPortModel arayüzünü uygulayan bağımsız FLUX Realism görsel üretim model sınıfı.
"""
from typing import List, Optional
from app.models.base_model import BaseThinkPortModel


class FluxRealismModel(BaseThinkPortModel):
    """Black Forest Labs FLUX Realism fotogerçekçi görsel üretim modeli."""

    @property
    def id(self) -> str:
        return "flux-realism"

    @property
    def name(self) -> str:
        return "FLUX Realism (Fotogerçekçi)"

    @property
    def vendor(self) -> str:
        return "Black Forest Labs"

    @property
    def provider(self) -> str:
        return "pollinations-image"

    @property
    def badge(self) -> str:
        return "Fotoğraf · HD"

    @property
    def description(self) -> str:
        return "Fotogerçekçi portre, mimari ve doğa fotoğrafı üretimi için optimize edilmiş FLUX modeli."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/FluxRealismModel.ts"

    @property
    def is_image(self) -> bool:
        return True

    @property
    def image_model(self) -> Optional[str]:
        return "flux-realism"

    @property
    def style_modifier(self) -> Optional[str]:
        return "photorealistic, raw photo, 8k uhd, DSLR, natural lighting, ultra detailed, realistic texture"

    @property
    def aliases(self) -> List[str]:
        return ["flux-realism", "flux-photo"]

