from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class ExtractedAttachmentInputDTO(BaseModel):
    """İstek içinden ayrıştırılan ekli dosya meta verisi ve çıkarılmış metin DTO'su."""

    file_name: str
    file_kind: Literal["document", "image"] = "document"
    mime_type: str = ""
    file_size: int = 0
    estimated_tokens: int = 0
    extracted_text: str = ""


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
    """Sohbet oturumu içindeki tekil mesaj, düşünce süreci, araç çağrıları, ham iletişim paketi ve dosya ekleri DTO'su."""

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
    thinking_content: str = ""
    tool_calls_json: str = ""
    raw_payload_json: str = ""
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
    is_deleted: bool = False
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
    """Mevcut sohbet oturumu başlık, model, arşiv, silinme veya sabitleme durumu güncelleme DTO'su."""

    title: Optional[str] = None
    model_id: Optional[str] = None
    system_prompt: Optional[str] = None
    is_pinned: Optional[bool] = None
    is_archived: Optional[bool] = None
    is_deleted: Optional[bool] = None


class RecordTurnRequestDTO(BaseModel):
    """Sohbet turunu (kullanıcı istemi, model yanıtı, düşünce süreci ve ham iletişim paketi) kaydetme DTO'su."""

    conversation_id: Optional[str] = None
    request_id: Optional[str] = None
    user_id: Optional[str] = None
    model: str = "gpt-4o"
    provider: Optional[str] = "gateway"
    source: Optional[Literal["studio", "api"]] = "studio"
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    assistant_content: str = ""
    thinking_content: str = ""
    tool_calls_json: str = ""
    raw_request_json: str = ""
    raw_response_json: str = ""
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    latency_ms: Optional[int] = 0
    ttft_ms: Optional[int] = 0

