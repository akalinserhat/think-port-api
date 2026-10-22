import uuid
from datetime import datetime, timezone, timedelta
from typing import List
from app.core.security import generate_api_key_bundle
from app.core.exceptions import resource_not_found_error
from app.dtos.api_key_dto import (
    CreateApiKeyRequestDTO,
    ApiKeyRecordDTO,
    ApiKeyPublicDTO,
    CreateApiKeyResponseDTO,
    RevokeApiKeyResponseDTO,
)
from app.repositories.api_key_repository import ApiKeyRepository


class ApiKeyService:
    """
    API Anahtarı (Bearer Token) oluşturma, listeleme ve iptal etme servisi.
    """

    def __init__(self, api_key_repo: ApiKeyRepository) -> None:
        self._api_key_repo = api_key_repo

    def list_public_keys(self) -> List[ApiKeyPublicDTO]:
        """Admin paneli için tüm API anahtarlarını döner."""
        return self._api_key_repo.list_public()

    def create_api_key(self, dto: CreateApiKeyRequestDTO) -> CreateApiKeyResponseDTO:
        """Yeni bir API anahtarı üretir, SHA-256 özetini saklar ve ham anahtarı bir kez döner."""
        raw_key, prefix, key_hash = generate_api_key_bundle(dto.api_key)
        now = datetime.now(timezone.utc)
        expires_iso = (now + timedelta(days=dto.expires_in_days)).isoformat()

        record = ApiKeyRecordDTO(
            id=f"key_{uuid.uuid4().hex[:6]}",
            user_id=dto.user_id,
            name=dto.name.strip() or "Production API Key",
            key_prefix=prefix,
            raw_preview=raw_key,
            key_hash=key_hash,
            is_active=True,
            expires_at=expires_iso,
            created_at=now.isoformat(),
        )
        self._api_key_repo.save(record)
        return CreateApiKeyResponseDTO(api_key=raw_key, record=record)

    def revoke_api_key(self, key_id: str) -> RevokeApiKeyResponseDTO:
        """Belirtilen API anahtarını iptal eder; bulunamazsa 404 fırlatır."""
        revoked = self._api_key_repo.deactivate_by_id(key_id)
        if not revoked:
            raise resource_not_found_error("Anahtar bulunamadı")
        return RevokeApiKeyResponseDTO(revoked=True, id=key_id)
