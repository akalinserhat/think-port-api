"""
ThinkPort AI Gateway - FLUX 3D Render Model Tanımı (flux_3d_model.py).
IThinkPortModel arayüzünü uygulayan bağımsız FLUX 3D görsel üretim model sınıfı.
"""
from typing import List, Optional
from app.models.base_model import BaseThinkPortModel


class Flux3dModel(BaseThinkPortModel):
    """Black Forest Labs FLUX 3D Render görsel üretim modeli."""

    @property
    def id(self) -> str:
        return "flux-3d"

    @property
    def name(self) -> str:
        return "FLUX 3D Render"

    @property
    def vendor(self) -> str:
        return "Black Forest Labs"

    @property
    def provider(self) -> str:
        return "pollinations-image"

    @property
    def badge(self) -> str:
        return "3D · Render"

    @property
    def description(self) -> str:
        return "3B karakter, izometrik sahne ve Pixar/Octane Render tarzı görsel üretim modeli."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/Flux3dModel.ts"

    @property
    def is_image(self) -> bool:
        return True

    @property
    def image_model(self) -> Optional[str]:
        return "flux-3d"

    @property
    def style_modifier(self) -> Optional[str]:
        return "3d render, octane render, unreal engine 5, Pixar and Blender 3D style, volumetric lighting, ray tracing"

    @property
    def aliases(self) -> List[str]:
        return ["flux-3d", "3d-render"]

