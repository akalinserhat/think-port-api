from typing import Optional
from fastapi import Header
from app.dtos.user_dto import AuthenticatedUserContextDTO
from app.repositories.state_store import store
from app.repositories.user_repository import UserRepository
from app.repositories.api_key_repository import ApiKeyRepository
from app.repositories.proxy_repository import ProxyRepository
from app.repositories.session_repository import SessionRepository
from app.repositories.conversation_repository import ConversationRepository
from app.repositories.telemetry_repository import (
    UsageRepository,
    SettingsRepository,
    StreamChannelRepository,
    ImageCacheRepository,
)
from app.services.auth_service import AuthService
from app.services.model_service import ModelService
from app.services.document_service import DocumentService
from app.services.message_formatter_service import MessageFormatterService
from app.services.llm_provider_service import LlmProviderService
from app.services.image_service import ImageService
from app.services.chat_service import ChatService
from app.services.user_service import UserService
from app.services.api_key_service import ApiKeyService
from app.services.proxy_service import ProxyService
from app.services.admin_service import AdminService
from app.services.conversation_service import ConversationService

# Tekil (Singleton) Repository Örnekleri
user_repository = UserRepository(store)
api_key_repository = ApiKeyRepository(store)
proxy_repository = ProxyRepository(store)
session_repository = SessionRepository(store)
usage_repository = UsageRepository(store)
settings_repository = SettingsRepository(store)
stream_channel_repository = StreamChannelRepository(store)
image_cache_repository = ImageCacheRepository(store)
conversation_repository = ConversationRepository()

# Tekil (Singleton) Service Örnekleri
auth_service = AuthService(
    user_repo=user_repository,
    api_key_repo=api_key_repository,
    usage_repo=usage_repository,
)
model_service = ModelService()
document_service = DocumentService()
message_formatter_service = MessageFormatterService()
llm_provider_service = LlmProviderService()
admin_service = AdminService(
    model_service=model_service,
    user_repo=user_repository,
    api_key_repo=api_key_repository,
    session_repo=session_repository,
    proxy_repo=proxy_repository,
    usage_repo=usage_repository,
    settings_repo=settings_repository,
    conversation_repo=conversation_repository,
)
image_service = ImageService(
    image_cache_repo=image_cache_repository,
    model_service=model_service,
    llm_provider=llm_provider_service,
    record_usage_fn=admin_service.record_usage,
)
chat_service = ChatService(
    auth_service=auth_service,
    model_service=model_service,
    formatter_service=message_formatter_service,
    llm_provider=llm_provider_service,
    image_service=image_service,
    session_repo=session_repository,
    channel_repo=stream_channel_repository,
    conversation_repo=conversation_repository,
    record_usage_fn=admin_service.record_usage,
)
user_service = UserService(user_repo=user_repository)
api_key_service = ApiKeyService(api_key_repo=api_key_repository)
proxy_service = ProxyService(proxy_repo=proxy_repository)
conversation_service = ConversationService(
    conversation_repo=conversation_repository,
    api_key_repo=api_key_repository,
    user_repo=user_repository,
)


def get_auth_service() -> AuthService:
    """AuthService bağımlılık sağlayıcısı."""
    return auth_service


def get_model_service() -> ModelService:
    """ModelService bağımlılık sağlayıcısı."""
    return model_service


def get_document_service() -> DocumentService:
    """DocumentService bağımlılık sağlayıcısı."""
    return document_service


def get_image_service() -> ImageService:
    """ImageService bağımlılık sağlayıcısı."""
    return image_service


def get_chat_service() -> ChatService:
    """ChatService bağımlılık sağlayıcısı."""
    return chat_service


def get_user_service() -> UserService:
    """UserService bağımlılık sağlayıcısı."""
    return user_service


def get_api_key_service() -> ApiKeyService:
    """ApiKeyService bağımlılık sağlayıcısı."""
    return api_key_service


def get_proxy_service() -> ProxyService:
    """ProxyService bağımlılık sağlayıcısı."""
    return proxy_service


def get_admin_service() -> AdminService:
    """AdminService bağımlılık sağlayıcısı."""
    return admin_service


def get_conversation_service() -> ConversationService:
    """ConversationService bağımlılık sağlayıcısı."""
    return conversation_service


def get_session_repository() -> SessionRepository:
    """SessionRepository bağımlılık sağlayıcısı."""
    return session_repository


async def require_authenticated_user(
    authorization: Optional[str] = Header(default=None, description="Bearer sk-gw-..."),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
    api_key_header: Optional[str] = Header(default=None, alias="api-key"),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
) -> AuthenticatedUserContextDTO:
    """FastAPI uç noktaları için kimlik doğrulama ve kota kontrolü bağımlılığı."""
    effective_auth = authorization or x_api_key or api_key_header
    return auth_service.authenticate_and_authorize(effective_auth, x_user_id=x_user_id)
