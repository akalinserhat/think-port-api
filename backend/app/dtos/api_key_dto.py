from typing import Optional
from pydantic import BaseModel, Field


class CreateApiKeyRequestDTO(BaseModel):
    """Yeni API anahtarı oluşturma isteği DTO'su."""

    user_id: str
    name: str = "Production API Key"
    expires_in_days: int = Field(default=30, ge=1, le=3650)
    api_key: Optional[str] = None


class ApiKeyRecordDTO(BaseModel):
    """Depolanan API anahtarı tam kayıt DTO'su."""

    id: str
    user_id: str
    name: str
    key_prefix: str
    raw_preview: Optional[str] = None
    key_hash: str
    is_active: bool
    expires_at: Optional[str] = None
    created_at: str


class ApiKeyPublicDTO(BaseModel):
    """Admin paneline döndürülen güvenli API anahtarı DTO'su."""

    id: str
    user_id: str
    name: str
    key_prefix: str
    raw_preview: Optional[str] = None
    is_active: bool
    expires_at: Optional[str] = None
    created_at: Optional[str] = None


class CreateApiKeyResponseDTO(BaseModel):
    """Yeni oluşturulan API anahtarı yanıt DTO'su."""

    api_key: str
    record: ApiKeyRecordDTO


class RevokeApiKeyResponseDTO(BaseModel):
    """API anahtarı iptal yanıt DTO'su."""

    revoked: bool
    id: str
