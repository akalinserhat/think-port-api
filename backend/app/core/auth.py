from typing import Any, Dict, Optional
from fastapi import Header
from app.core.security import generate_api_key_bundle as generate_api_key, hash_api_key
from app.repositories.state_store import InMemoryStateStore, store
from app.repositories.user_repository import UserRepository
from app.repositories.api_key_repository import ApiKeyRepository
from app.repositories.telemetry_repository import UsageRepository
from app.services.auth_service import AuthService


class AuthAndQuotaManager:
    """
    Geriye dönük uyumluluk sağlayan ince güvenlik cephesi (Facade).
    Tüm doğrulama ve kota işlemlerini tek sorumluluklu AuthService katmanına devreder.
    """

    def __init__(self, state_store: InMemoryStateStore) -> None:
        self.store = state_store
        self._auth_service = AuthService(
            user_repo=UserRepository(state_store),
            api_key_repo=ApiKeyRepository(state_store),
            usage_repo=UsageRepository(state_store),
        )

    async def verify_request(
        self,
        authorization: Optional[str] = Header(default=None, description="Bearer sk-gw-..."),
    ) -> Dict[str, Any]:
        """İsteği doğrular ve sözlük biçiminde kullanıcı bağlamını döner."""
        ctx = self._auth_service.authenticate_and_authorize(authorization)
        return ctx.model_dump()


__all__ = [
    "generate_api_key",
    "hash_api_key",
    "InMemoryStateStore",
    "store",
    "AuthAndQuotaManager",
]
