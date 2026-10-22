from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional


@dataclass(frozen=True)
class ProviderSelectorsDTO:
    """Tarayıcı sağlayıcısına özgü DOM seçicilerini taşıyan DTO."""

    prompt_input: str
    send_button: str
    assistant_message: str
    streaming_indicator: str


@dataclass(frozen=True)
class WarmSessionConfigDTO:
    """Yeni bir warm tarayıcı oturumu başlatmak için gereken yapılandırma DTO'su."""

    session_id: str
    provider: str
    account_id: str
    storage_state: Dict[str, Any] = field(default_factory=dict)
    proxy_server: Optional[str] = None
    user_agent: Optional[str] = None


@dataclass(frozen=True)
class BrowserJobDTO:
    """Redis kuyruğundan okunan tarayıcı otomasyon görevini temsil eden DTO."""

    job_id: str
    provider: str
    prompt: str
    response_format_type: Optional[str] = None

    @classmethod
    def from_raw_dict(cls, data: Dict[str, Any]) -> "BrowserJobDTO":
        """Ham JSON sözlüğünü sistem talimatları ve JSON modu kurallarıyla BrowserJobDTO nesnesine dönüştürür."""
        raw_prompt = str(data.get("prompt", "")).strip()
        system_parts = []

        explicit_sys = str(data.get("system_prompt", "")).strip()
        if explicit_sys:
            system_parts.append(explicit_sys)

        messages = data.get("messages")
        user_parts = []
        if isinstance(messages, list):
            for msg in messages:
                if not isinstance(msg, dict):
                    continue
                role = str(msg.get("role", "")).lower().strip()
                content = str(msg.get("content", "")).strip()
                if not content:
                    continue
                if role in ("system", "developer"):
                    system_parts.append(content)
                else:
                    user_parts.append(content)

        if not raw_prompt and user_parts:
            raw_prompt = "\n\n".join(user_parts)

        if system_parts and "[SYSTEM INSTRUCTIONS - MUST FOLLOW STRICTLY]:" not in raw_prompt:
            combined_system = "\n\n".join(system_parts)
            raw_prompt = (
                f"[SYSTEM INSTRUCTIONS - MUST FOLLOW STRICTLY]:\n{combined_system}\n\n"
                f"{raw_prompt}"
            ).strip()

        rf = data.get("response_format")
        rf_type: Optional[str] = None
        if isinstance(rf, dict):
            rf_type = str(rf.get("type", "")).strip() or None
        elif isinstance(rf, str):
            rf_type = rf.strip() or None

        if rf_type in ("json_object", "json_schema") and "[JSON OUTPUT REQUIREMENT - CRITICAL]:" not in raw_prompt:
            raw_prompt = (
                f"{raw_prompt}\n\n"
                "[JSON OUTPUT REQUIREMENT - CRITICAL]:\n"
                "You MUST respond ONLY with a valid JSON object. "
                "Do NOT include markdown code blocks (no ```json or ```), "
                "do NOT render Markdown tables, and do NOT add any conversational text, "
                "explanations, or prose before or after the JSON object. "
                "Your entire response must be directly parseable by json.loads()."
            ).strip()

        return cls(
            job_id=str(data["job_id"]),
            provider=str(data.get("provider", "chatgpt-web")),
            prompt=raw_prompt,
            response_format_type=rf_type,
        )


@dataclass(frozen=True)
class RedisStreamEventDTO:
    """Redis Pub/Sub kanalına basılan gerçek zamanlı akış olayı DTO'su."""

    event: Literal["delta", "done", "error"]
    text: Optional[str] = None
    message: Optional[str] = None

    def to_payload_dict(self) -> Dict[str, Any]:
        """Yalnızca dolu alanları içeren yayın sözlüğü döner."""
        payload: Dict[str, Any] = {"event": self.event}
        if self.text is not None:
            payload["text"] = self.text
        if self.message is not None:
            payload["message"] = self.message
        return payload
