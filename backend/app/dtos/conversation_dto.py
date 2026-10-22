from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class ExtractedAttachmentInputDTO(BaseModel):
    """İstek içinden ayrıştırılan ekli dosya meta verisi DTO'su."""

    file_name: str
    file_kind: Literal["document", "image"] = "document"
    mime_type: str = ""
    file_size: int = 0
    estimated_tokens: int = 0


class MessageAttachmentDTO(BaseModel):
    """Veritabanında saklanan mesaj dosya eki kaydı DTO'su."""

    id: str
    message_id: str
    conversation_id: str
    user_id: str
    file_name: str
    file_kind: Literal["document", "image"] = "document"
    mime_type: str = ""
    file_size: int = 0
    estimated_tokens: int = 0
    created_at: str


class ConversationMessageDTO(BaseModel):
    """Sohbet oturumu içindeki tekil mesaj ve ilişkili dosya ekleri DTO'su."""

    id: str
    conversation_id: str
    request_id: Optional[str] = None
    user_id: str
    user_email: str = ""
    user_full_name: str = ""
    role: Literal["system", "user", "assistant", "developer", "tool"]
    model_id: str
    provider: str = ""
    content: str
    attachments: List[MessageAttachmentDTO] = Field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_ms: int = 0
    ttft_ms: int = 0
    status: str = "success"
    error_detail: str = ""
    created_at: str


class ConversationSummaryDTO(BaseModel):
    """Sohbet geçmişi listesinde gösterilen oturum özeti DTO'su."""

    id: str
    user_id: str
    user_email: str = ""
    user_full_name: str = ""
    title: str
    model_id: str
    system_prompt: str = ""
    source: Literal["studio", "api"] = "studio"
    is_pinned: bool = False
    is_archived: bool = False
    total_messages: int = 0
    total_tokens: int = 0
    attachment_names: List[str] = Field(default_factory=list)
    last_message_preview: str = ""
    created_at: str
    updated_at: str


class ConversationDetailDTO(ConversationSummaryDTO):
    """Mesaj geçmişi ve dosya ekleriyle birlikte tam sohbet oturumu DTO'su."""

    messages: List[ConversationMessageDTO] = Field(default_factory=list)


class CreateConversationRequestDTO(BaseModel):
    """Yeni sohbet oturumu oluşturma isteği DTO'su."""

    title: Optional[str] = "Yeni Sohbet"
    model_id: str = "gpt-4o"
    system_prompt: str = ""
    source: Literal["studio", "api"] = "studio"
    user_id: Optional[str] = None


class UpdateConversationRequestDTO(BaseModel):
    """Mevcut sohbet oturumu başlık, model veya sabitleme durumu güncelleme DTO'su."""

    title: Optional[str] = None
    model_id: Optional[str] = None
    system_prompt: Optional[str] = None
    is_pinned: Optional[bool] = None
    is_archived: Optional[bool] = None
