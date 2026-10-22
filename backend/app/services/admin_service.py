from datetime import datetime, timezone
from app.core.logger import gateway_logger, read_recent_log_lines, clear_log_file
from app.dtos.admin_dto import (
    AdminStateResponseDTO,
    GatewaySettingsDTO,
    RecordUsageInputDTO,
    UsageLogDTO,
)
from app.repositories.user_repository import UserRepository
from app.repositories.api_key_repository import ApiKeyRepository
from app.repositories.proxy_repository import ProxyRepository
from app.repositories.session_repository import SessionRepository
from app.repositories.telemetry_repository import UsageRepository, SettingsRepository
from app.repositories.conversation_repository import ConversationRepository
from app.services.model_service import ModelService


class AdminService:
    """
    Yönetim konsolu (Admin Dashboard) durum toplama, sistem ayarları güncelleme
    ve kullanım telemetrisi / log kaydetme servisi.
    """

    def __init__(
        self,
        model_service: ModelService,
        user_repo: UserRepository,
        api_key_repo: ApiKeyRepository,
        session_repo: SessionRepository,
        proxy_repo: ProxyRepository,
        usage_repo: UsageRepository,
        settings_repo: SettingsRepository,
        conversation_repo: ConversationRepository,
    ) -> None:
        self._model_service = model_service
        self._user_repo = user_repo
        self._api_key_repo = api_key_repo
        self._session_repo = session_repo
        self._proxy_repo = proxy_repo
        self._usage_repo = usage_repo
        self._settings_repo = settings_repo
        self._conversation_repo = conversation_repo

    def get_dashboard_state(self) -> AdminStateResponseDTO:
        """Admin panelinin ihtiyaç duyduğu tüm güncel sistem durumunu, sohbet oturumlarını, havuz dashboard telemetrisini ve logları tek bir DTO'da toplar."""
        return AdminStateResponseDTO(
            models=self._model_service.get_full_model_library(),
            users=self._user_repo.list_all(),
            api_keys=self._api_key_repo.list_public(),
            browser_sessions=self._session_repo.list_all(),
            proxies=self._proxy_repo.list_all(),
            usage_logs=self._usage_repo.list_recent_logs(limit=50),
            conversations=self._conversation_repo.list_conversations(limit=50),
            system_logs=read_recent_log_lines(max_lines=150),
            settings=self._settings_repo.get_settings(),
            pool_dashboard=self._session_repo.get_pool_dashboard_metrics(),
        )

    def update_gateway_settings(self, dto: GatewaySettingsDTO) -> GatewaySettingsDTO:
        """Sistem genel ayarlarını günceller ve yeni ayarları döner."""
        gateway_logger.info(
            f"Gateway ayarları güncellendi | global_rpm={dto.global_rpm} | max_browsers={dto.max_concurrent_browsers}"
        )
        return self._settings_repo.update_settings(dto)

    def clear_all_logs(self) -> None:
        """Hem SQLite kullanım loglarını hem de gateway.log dosyasını temizler."""
        self._usage_repo.clear_logs()
        clear_log_file()
        gateway_logger.info("Sistem ve telemetri logları yönetici tarafından temizlendi.")

    def record_usage(self, dto: RecordUsageInputDTO) -> UsageLogDTO:
        """Kullanıcının token sayacını artırır, SQLite telemetri tablosuna ve gateway.log dosyasına kayıt ekler."""
        total_tokens = dto.prompt_tokens + dto.completion_tokens
        self._user_repo.increment_tokens_used(dto.user_id, total_tokens)

        user = self._user_repo.get_by_id(dto.user_id)
        user_email = user.email if user else dto.user_id

        log_entry = UsageLogDTO(
            request_id=dto.request_id,
            conversation_id=dto.conversation_id,
            user_email=user_email,
            model=dto.model,
            session_id=dto.session_id,
            prompt_tokens=dto.prompt_tokens,
            completion_tokens=dto.completion_tokens,
            total_tokens=total_tokens,
            is_stream=dto.is_stream,
            latency_ms=dto.latency_ms,
            ttft_ms=dto.ttft_ms,
            status=dto.status,
            upstream_provider=dto.upstream_provider,
            prompt_preview=dto.prompt_preview[:500],
            response_preview=dto.response_preview[:1000],
            attachment_names=dto.attachment_names,
            error_detail=dto.error_detail[:500],
            created_at=datetime.now(timezone.utc).strftime("%H:%M:%S"),
        )
        gateway_logger.info(
            f"CHAT_COMPLETION | id={dto.request_id} | conv={dto.conversation_id} | model={dto.model} "
            f"| upstream={dto.upstream_provider} | status={dto.status} | ttft={dto.ttft_ms}ms "
            f"| total={dto.latency_ms}ms | tokens={dto.prompt_tokens}+{dto.completion_tokens}={total_tokens} "
            f"| files={dto.attachment_names} | prompt={dto.prompt_preview[:80]!r}"
        )
        return self._usage_repo.insert_log(log_entry, user_id=dto.user_id)
