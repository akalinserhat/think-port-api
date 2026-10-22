from typing import List, Literal, Optional
from pydantic import BaseModel


ModelTypeLiteral = Literal["chat", "image", "embedding"]


class ModelDefinitionDTO(BaseModel):
    """Model kütüphanesindeki tek bir modelin tanım DTO'su."""

    id: str
    name: str
    vendor: str
    provider: str
    type: ModelTypeLiteral = "chat"
    badge: str
    description: str
    is_local: bool = False
    is_image: bool = False
    available: bool = True
    web_model: Optional[str] = None
    fallback_local: Optional[str] = None
    image_model: Optional[str] = None


class ModelItemResponseDTO(BaseModel):
    """OpenAI /v1/models listesindeki tekil model öğesi DTO'su."""

    id: str
    object: Literal["model"] = "model"
    created: int = 1715000000
    owned_by: str
    provider: str
    type: ModelTypeLiteral = "chat"
    is_image: bool = False
    available: bool = True
    name: str
    vendor: str
    badge: str
    description: str
    is_local: bool = False


class ModelListResponseDTO(BaseModel):
    """OpenAI /v1/models uç noktası yanıt DTO'su."""

    object: Literal["list"] = "list"
    data: List[ModelItemResponseDTO]
    models: List[ModelItemResponseDTO] = []
