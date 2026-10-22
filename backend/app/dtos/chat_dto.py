import time
import uuid
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, ConfigDict, Field
from app.core.config import settings


class ResponseFormatJsonSchemaDTO(BaseModel):
    """OpenAI Structured Outputs json_schema detay DTO'su."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    name: Optional[str] = None
    description: Optional[str] = None
    schema_: Optional[Dict[str, Any]] = Field(default=None, alias="schema")
    strict: Optional[bool] = None


class ResponseFormatDTO(BaseModel):
    """OpenAI response_format yapılandırma DTO'su (`text`, `json_object`, `json_schema`)."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    type: Literal["text", "json_object", "json_schema"] = "text"
    json_schema: Optional[Union[ResponseFormatJsonSchemaDTO, Dict[str, Any]]] = None
    schema_: Optional[Dict[str, Any]] = Field(default=None, alias="schema")


class ChatMessageDTO(BaseModel):
    """Tek bir sohbet mesajını temsil eden veri transfer nesnesi."""

    model_config = ConfigDict(extra="allow")

    role: Literal["system", "user", "assistant", "developer", "tool"]
    content: Union[str, List[Dict[str, Any]]]
    name: Optional[str] = None


class ChatCompletionRequestDTO(BaseModel):
    """OpenAI /v1/chat/completions istek DTO'su."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    model: str = Field(..., examples=["gpt-4o", "claude-3-5-sonnet", "deepseek-r1"])
    messages: List[ChatMessageDTO]
    stream: Optional[bool] = False
    temperature: Optional[float] = Field(default=0.7, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=1.0, ge=0.0, le=1.0)
    max_tokens: Optional[int] = Field(default=None)
    presence_penalty: Optional[float] = 0.0
    frequency_penalty: Optional[float] = 0.0
    response_format: Optional[Union[ResponseFormatDTO, Dict[str, Any], str]] = None
    user: Optional[str] = None
    conversation_id: Optional[str] = None
    source: Optional[Literal["studio", "api"]] = None

    def normalized_response_format(self) -> Optional[Dict[str, Any]]:
        """`response_format` alanını standart sözlük yapısına dönüştürür."""
        if self.response_format is None:
            return None
        if isinstance(self.response_format, ResponseFormatDTO):
            return self.response_format.model_dump(by_alias=True, exclude_none=True)
        if isinstance(self.response_format, dict):
            return dict(self.response_format)
        if isinstance(self.response_format, str):
            val = self.response_format.strip().lower()
            if val in ("json", "json_object"):
                return {"type": "json_object"}
            if val == "json_schema":
                return {"type": "json_schema"}
            return {"type": "text"}
        return None


class CompletionUsageDTO(BaseModel):
    """Token kullanım istatistikleri DTO'su."""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionChoiceDTO(BaseModel):
    """Senkron sohbet yanıtı seçeneği DTO'su."""

    index: int = 0
    message: ChatMessageDTO
    finish_reason: Optional[Literal["stop", "length", "content_filter", "error"]] = "stop"


class ChatCompletionResponseDTO(BaseModel):
    """OpenAI /v1/chat/completions senkron yanıt DTO'su."""

    id: str = Field(default_factory=lambda: f"chatcmpl-{uuid.uuid4().hex[:24]}")
    object: Literal["chat.completion"] = "chat.completion"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str
    choices: List[ChatCompletionChoiceDTO]
    usage: CompletionUsageDTO
    system_fingerprint: str = settings.system_fingerprint
    conversation_id: Optional[str] = None


class DeltaMessageDTO(BaseModel):
    """SSE akışındaki (streaming) anlık içerik farkı (delta) DTO'su."""

    role: Optional[Literal["assistant"]] = None
    content: Optional[str] = None


class ChatCompletionChunkChoiceDTO(BaseModel):
    """SSE akışı parça seçeneği DTO'su."""

    index: int = 0
    delta: DeltaMessageDTO
    finish_reason: Optional[Literal["stop", "length", "error"]] = None


class ChatCompletionChunkDTO(BaseModel):
    """OpenAI /v1/chat/completions SSE chunk yanıt DTO'su."""

    id: str
    object: Literal["chat.completion.chunk"] = "chat.completion.chunk"
    created: int
    model: str
    choices: List[ChatCompletionChunkChoiceDTO]
    system_fingerprint: str = settings.system_fingerprint
    conversation_id: Optional[str] = None


class PreparedMessagesDTO(BaseModel):
    """AI motoruna gönderilmek üzere ayrıştırılmış mesaj formatları DTO'su."""

    multimodal_messages: List[Dict[str, Any]]
    text_only_messages: List[Dict[str, str]]
    has_multimodal: bool
    is_json_mode: bool = False
    system_instructions: str = ""


class ChatJobDTO(BaseModel):
    """Arka plan AI işçisine (worker) iletilen görev DTO'su."""

    job_id: str
    conversation_id: str
    user_message_id: str
    source: Literal["studio", "api"] = "api"
    user_id: str
    provider: str
    model: str
    requested_model: Optional[str] = None
    messages: List[ChatMessageDTO]
    prompt_tokens: int
    response_format: Optional[Dict[str, Any]] = None
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = None


class StreamEventDTO(BaseModel):
    """Asenkron yayın kuyruğundaki tek bir olayı temsil eden DTO."""

    event: Literal["delta", "done", "error"]
    text: str = ""
    session_id: str = "sess-gpt-01"
