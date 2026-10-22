from fastapi import APIRouter, Depends
from app.core.dependencies import get_api_key_service
from app.dtos.api_key_dto import (
    CreateApiKeyRequestDTO,
    CreateApiKeyResponseDTO,
    RevokeApiKeyResponseDTO,
)
from app.services.api_key_service import ApiKeyService

router = APIRouter(prefix="/admin/api-keys", tags=["Admin API Keys"])


@router.post("", response_model=CreateApiKeyResponseDTO)
async def create_api_key(
    body: CreateApiKeyRequestDTO,
    api_key_service: ApiKeyService = Depends(get_api_key_service),
) -> CreateApiKeyResponseDTO:
    """Belirtilen kullanıcı için yeni bir OpenAI uyumlu Bearer API anahtarı üretir."""
    return api_key_service.create_api_key(body)


@router.delete("/{key_id}", response_model=RevokeApiKeyResponseDTO)
async def revoke_api_key(
    key_id: str,
    api_key_service: ApiKeyService = Depends(get_api_key_service),
) -> RevokeApiKeyResponseDTO:
    """Belirtilen API anahtarını iptal eder (devre dışı bırakır)."""
    return api_key_service.revoke_api_key(key_id)
