import time
from datetime import datetime, timezone
from typing import Optional
from app.core.security import extract_bearer_token, hash_api_key, parse_composite_bearer_token
from app.core.exceptions import (
    invalid_auth_header_error,
    invalid_api_key_error,
    expired_api_key_error,
    account_suspended_error,
    quota_exceeded_error,
    rpm_limit_exceeded_error,
    concurrency_limit_exceeded_error,
)
from app.dtos.api_key_dto import ApiKeyRecordDTO
from app.dtos.user_dto import UserResponseDTO, AuthenticatedUserContextDTO
from app.repositories.user_repository import UserRepository
from app.repositories.api_key_repository import ApiKeyRepository
from app.repositories.telemetry_repository import UsageRepository


class AuthService:
    """
    Kimlik doğrulama, kota denetimi ve hız sınırlandırma (Rate-Limit / Concurrency) servisi.
    Her doğrulama adımı tek bir yardımcı metoda ayrılmıştır.
    """

    def __init__(
        self,
        user_repo: UserRepository,
        api_key_repo: ApiKeyRepository,
        usage_repo: UsageRepository,
    ) -> None:
        self._user_repo = user_repo
        self._api_key_repo = api_key_repo
        self._usage_repo = usage_repo

    def authenticate_and_authorize(
        self,
        authorization: Optional[str],
        x_user_id: Optional[str] = None,
        header_app_id: Optional[str] = None,
        header_agent_id: Optional[str] = None,
        x_app_id: Optional[str] = None,
        x_agent_id: Optional[str] = None,
    ) -> AuthenticatedUserContextDTO:
        """Gelen isteğin kimlik, süre, aktiflik, kota ve RPM kontrollerini sırasıyla yürütür.

        - Composite Bearer token (<API_KEY>:<APP_ID>:<AGENT_ID> veya <API_KEY>:<AGENT_ID>) ayrıştırılır.
        - Yalnızca ham api_key kısmı SHA-256 ile özetlenir (hash).
        - api_key eksikse veya veritabanında bulunamazsa / pasifse derhal HTTP 401 Unauthorized fırlatılır.
        - app_id hiyerarşisi: token_app_id -> header_app_id -> candidate_key.id (varsayılan).
        - agent_id hiyerarşisi: token_agent_id -> header_agent_id -> "".
        - Yetkisiz oturum (studio_session / sys_usr_01) varsayılanı tamamen kaldırılmıştır.
        """
        raw_token = extract_bearer_token(authorization)
        if not raw_token:
            raise invalid_auth_header_error()

        api_key, token_app_id, token_agent_id = parse_composite_bearer_token(raw_token)
        if not api_key:
            raise invalid_auth_header_error()

        key_hash = hash_api_key(api_key)
        candidate_key = self._api_key_repo.get_by_hash(key_hash)
        if not candidate_key:
            raise invalid_api_key_error()

        if not candidate_key.is_active:
            raise invalid_api_key_error()

        self._require_unexpired_key(candidate_key)

        user = self._require_active_user(candidate_key.user_id)
        self._require_sufficient_token_quota(user)
        self._enforce_minute_rate_limit(user)

        effective_header_app = (header_app_id or x_app_id or "").strip() or None
        effective_header_agent = (header_agent_id or x_agent_id or "").strip() or None

        effective_app_id = token_app_id or effective_header_app or candidate_key.id
        effective_agent_id = token_agent_id or effective_header_agent or ""

        return self._build_user_context(
            user=user,
            key_record=candidate_key,
            app_id=effective_app_id,
            agent_id=effective_agent_id,
            raw_api_key=api_key,
        )

    def acquire_concurrency_slot(self, user_ctx: AuthenticatedUserContextDTO) -> None:
        """Kullanıcı için eşzamanlı istek slotu ayırır; sınır aşılırsa geri alır ve hata fırlatır."""
        active_count = self._usage_repo.increment_active_requests(user_ctx.user_id)
        if active_count > user_ctx.concurrent_limit:
            self._usage_repo.decrement_active_requests(user_ctx.user_id)
            raise concurrency_limit_exceeded_error(user_ctx.concurrent_limit)

    def release_concurrency_slot(self, user_id: str) -> None:
        """Tamamlanan isteğin eşzamanlılık slotunu serbest bırakır."""
        self._usage_repo.decrement_active_requests(user_id)

    @staticmethod
    def _extract_valid_bearer_token(authorization: Optional[str]) -> str:
        """Authorization başlığından Bearer token değerini çıkarır veya 401 fırlatır."""
        token = extract_bearer_token(authorization)
        if not token:
            raise invalid_auth_header_error()
        return token

    def _require_active_api_key(self, raw_key: str) -> ApiKeyRecordDTO:
        """API anahtarının varlığını ve aktifliğini doğrular."""
        api_key, _, _ = parse_composite_bearer_token(raw_key)
        target_key = api_key or raw_key
        key_hash = hash_api_key(target_key)
        key_record = self._api_key_repo.get_by_hash(key_hash)
        if not key_record or not key_record.is_active:
            raise invalid_api_key_error()
        return key_record

    @staticmethod
    def _require_unexpired_key(key_record: ApiKeyRecordDTO) -> None:
        """API anahtarının geçerlilik süresinin dolmadığını doğrular."""
        if not key_record.expires_at:
            return
        expiration_dt = datetime.fromisoformat(key_record.expires_at)
        if datetime.now(timezone.utc) >= expiration_dt:
            raise expired_api_key_error()

    def _require_active_user(self, user_id: str) -> UserResponseDTO:
        """Anahtar sahibinin sistemde var olduğunu ve aktif durumda olduğunu doğrular."""
        user = self._user_repo.get_by_id(user_id)
        if not user or user.status != "active":
            status_label = user.status if user else "unknown"
            raise account_suspended_error(status_label)
        return user

    @staticmethod
    def _require_sufficient_token_quota(user: UserResponseDTO) -> None:
        """Kullanıcının kalan token kotası olduğunu doğrular."""
        if user.tokens_used >= user.token_quota:
            raise quota_exceeded_error()

    def _enforce_minute_rate_limit(self, user: UserResponseDTO) -> None:
        """Kullanıcının dakikalık istek sınırını (RPM) aşmadığını doğrular."""
        current_minute = int(time.time() // 60)
        rate_key = f"{user.id}:{current_minute}"
        request_count = self._usage_repo.increment_minute_rate_counter(rate_key)
        if request_count > user.rpm_limit:
            raise rpm_limit_exceeded_error(user.rpm_limit)

    @staticmethod
    def _build_user_context(
        user: UserResponseDTO,
        key_record: ApiKeyRecordDTO,
        app_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        raw_api_key: Optional[str] = None,
    ) -> AuthenticatedUserContextDTO:
        """Doğrulanmış kullanıcı ve anahtar bilgilerinden bağlam DTO'su üretir."""
        return AuthenticatedUserContextDTO(
            user_id=user.id,
            email=user.email,
            api_key_id=key_record.id,
            token_quota=user.token_quota,
            tokens_used=user.tokens_used,
            rpm_limit=user.rpm_limit,
            concurrent_limit=user.concurrent_limit,
            app_id=app_id,
            agent_id=agent_id,
            raw_api_key=raw_api_key,
        )
