import time
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class ImageGenerationRequestDTO(BaseModel):
    """OpenAI /v1/images/generations istek DTO'su."""

    prompt: str = Field(..., description="Oluşturulacak görselin detaylı açıklaması.")
    model: Optional[str] = Field(
        default="flux",
        examples=["flux", "flux-realism", "flux-anime", "flux-3d", "turbo"],
    )
    n: Optional[int] = Field(default=1, ge=1, le=4)
    size: Optional[str] = Field(
        default="1024x1024",
        examples=["1024x1024", "1280x720", "720x1280"],
    )
    response_format: Optional[Literal["url", "b64_json"]] = "url"
    seed: Optional[int] = None


class ImageDataItemDTO(BaseModel):
    """Üretilen tekil görsel çıktı öğesi DTO'su."""

    url: Optional[str] = None
    b64_json: Optional[str] = None
    revised_prompt: Optional[str] = None


class ImageGenerationResponseDTO(BaseModel):
    """OpenAI /v1/images/generations yanıt DTO'su."""

    created: int = Field(default_factory=lambda: int(time.time()))
    data: List[ImageDataItemDTO]


class ImageDimensionsDTO(BaseModel):
    """Görsel genişlik ve yükseklik değerlerini taşıyan DTO."""

    width: int = 1024
    height: int = 1024


class GeneratedImageResultDTO(BaseModel):
    """Görsel üretim motorunun döndürdüğü iç sonuç DTO'su."""

    image_id: str
    raw_bytes: bytes
    media_type: str
    width: int
    height: int
    used_seed: int
    clean_prompt: str


class CachedImageDTO(BaseModel):
    """Bellek önbelleğinde saklanan görsel verisi DTO'su."""

    image_id: str
    raw_bytes: bytes
    media_type: str
    prompt: str
    model: str
    width: int
    height: int
    seed: int
