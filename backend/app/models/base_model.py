"""
ThinkPort AI Gateway - Yapay Zeka Model Arayüzü (base_model.py).

Sistemde kullanılan tüm yapay zeka modellerinin (Web AI, Yerel Ollama, Görsel Üretim, Harici API)
uyması gereken ortak sözleşmeyi (IThinkPortModel) ve temel veri yapılarını tanımlar.
Yeni bir model eklemek için bu arayüzü uygulayan tekil bir sınıf oluşturup ModelRegistry'ye
kaydetmek yeterlidir.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Protocol, runtime_checkable

ModelCategoryLiteral = Literal["chat", "image", "embedding"]


@dataclass(frozen=True)
class ModelCapabilities:
    """Modelin desteklediği teknik yetenekler."""

    streaming: bool = True
    vision: bool = False
    reasoning: bool = False
    function_calling: bool = True
    image_generation: bool = False
    json_mode: bool = True


@runtime_checkable
class IThinkPortModel(Protocol):
    """
    ThinkPort AI Gateway üzerindeki her bir yapay zeka modelinin uyguladığı arayüz (Interface).
    """

    @property
    def id(self) -> str: ...

    @property
    def name(self) -> str: ...

    @property
    def vendor(self) -> str: ...

    @property
    def provider(self) -> str: ...

    @property
    def protocol_id(self) -> str: ...

    @property
    def category(self) -> ModelCategoryLiteral: ...

    @property
    def badge(self) -> str: ...

    @property
    def description(self) -> str: ...

    @property
    def source_file(self) -> str: ...

    @property
    def is_local(self) -> bool: ...

    @property
    def is_image(self) -> bool: ...

    @property
    def context_window(self) -> int: ...

    @property
    def max_output_tokens(self) -> int: ...

    @property
    def fallback_local(self) -> Optional[str]: ...

    @property
    def web_model(self) -> Optional[str]: ...

    @property
    def image_model(self) -> Optional[str]: ...

    @property
    def style_modifier(self) -> Optional[str]: ...

    @property
    def aliases(self) -> List[str]: ...

    @property
    def capabilities(self) -> ModelCapabilities: ...

    def matches_alias(self, requested_model: str) -> bool: ...

    def to_definition_dict(self) -> Dict[str, Any]: ...


class BaseThinkPortModel(ABC):
    """
    IThinkPortModel arayüzünü uygulayan tüm model sınıfları için ortak temel sınıf.
    """

    @property
    @abstractmethod
    def id(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def name(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def vendor(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def provider(self) -> str:
        raise NotImplementedError

    @property
    def protocol_id(self) -> str:
        return "proto_openai"

    @property
    def category(self) -> ModelCategoryLiteral:
        return "image" if self.is_image else "chat"

    @property
    @abstractmethod
    def badge(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def description(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def source_file(self) -> str:
        raise NotImplementedError

    @property
    def is_local(self) -> bool:
        return False

    @property
    def is_image(self) -> bool:
        return False

    @property
    def context_window(self) -> int:
        return 128000

    @property
    def max_output_tokens(self) -> int:
        return 16384

    @property
    def fallback_local(self) -> Optional[str]:
        return None

    @property
    def web_model(self) -> Optional[str]:
        return None

    @property
    def image_model(self) -> Optional[str]:
        return None

    @property
    def style_modifier(self) -> Optional[str]:
        return None

    @property
    def aliases(self) -> List[str]:
        return []

    @property
    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            streaming=not self.is_image,
            vision=False,
            reasoning=False,
            function_calling=not self.is_image,
            image_generation=self.is_image,
            json_mode=not self.is_image,
        )

    def matches_alias(self, requested_model: str) -> bool:
        clean = (requested_model or "").strip().lower()
        if not clean:
            return False
        if clean == self.id.lower():
            return True
        return any(a.lower() == clean for a in self.aliases)

    def to_definition_dict(self) -> Dict[str, Any]:
        caps = self.capabilities
        payload: Dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "vendor": self.vendor,
            "provider": self.provider,
            "protocol_id": self.protocol_id,
            "type": self.category,
            "badge": self.badge,
            "description": self.description,
            "source_file": self.source_file,
            "is_local": self.is_local,
            "is_image": self.is_image,
            "context_window": self.context_window,
            "max_output_tokens": self.max_output_tokens,
            "aliases": list(self.aliases),
            "capabilities": {
                "streaming": caps.streaming,
                "vision": caps.vision,
                "reasoning": caps.reasoning,
                "function_calling": caps.function_calling,
                "image_generation": caps.image_generation,
                "json_mode": caps.json_mode,
            },
        }
        if self.web_model:
            payload["web_model"] = self.web_model
        if self.fallback_local:
            payload["fallback_local"] = self.fallback_local
        if self.image_model:
            payload["image_model"] = self.image_model
        if self.style_modifier:
            payload["style_modifier"] = self.style_modifier
        return payload

