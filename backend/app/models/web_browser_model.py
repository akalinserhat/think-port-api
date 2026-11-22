"""
ThinkPort AI Gateway - Sanal Tarayıcı (Web AI) Model Arayüzü (web_browser_model.py).

https://gemini.google.com/app ve https://chatgpt.com/ gibi sanal tarayıcı
(@akalin/browser_module Docker Playwright) üzerinden erişilen tüm web tabanlı LLM
modellerinin uyması gereken ortak arayüzü (IWebBrowserModel) ve temel soyut sınıfı
(BaseWebBrowserModel) tanımlar.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional, Protocol, runtime_checkable
from app.models.base_model import BaseThinkPortModel, IThinkPortModel, ModelCapabilities


@runtime_checkable
class IWebBrowserModel(IThinkPortModel, Protocol):
    """
    Sanal tarayıcı (@akalin/browser_module) üzerinden bir web arayüzüne bağlanan
    yapay zeka modellerinin (GeminiWebModel, ChatGptWebModel vb.) uyguladığı ortak arayüz.
    """

    @property
    def target_url(self) -> str:
        """Sanal tarayıcının açacağı hedef web uygulaması URL'si."""
        ...

    @property
    def browser_engine(self) -> str:
        """Kullanılan sanal tarayıcı motorunun adı."""
        ...

    @property
    def use_proxy(self) -> bool:
        """İsteklerin proxy tüneli üzerinden geçirilip geçirilmeyeceği."""
        ...

    @property
    def session_prefix(self) -> str:
        """Tarayıcı oturum kimliği (conversation_id) öneki."""
        ...

    @property
    def response_prefix_to_strip(self) -> Optional[str]:
        """DOM metninden temizlenecek model ön eki (ör. 'gemini said', 'chatgpt said')."""
        ...

    @property
    def auth_notice_domain(self) -> str:
        """Oturum uyarısında gösterilecek hedef alan adı (ör. 'gemini.google.com/app')."""
        ...

    def format_browser_response(
        self,
        raw_text: str,
        metadata: Dict[str, Any],
    ) -> Optional[str]:
        """Model özel çıktı biçimlendirmesi döner; None dönerse varsayılan telemetri formatı kullanılır."""
        ...


class BaseWebBrowserModel(BaseThinkPortModel, ABC):
    """
    IWebBrowserModel arayüzünü uygulayan tüm sanal tarayıcı modelleri için ortak temel sınıf.
    """

    @property
    @abstractmethod
    def target_url(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def session_prefix(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def auth_notice_domain(self) -> str:
        raise NotImplementedError

    @property
    def badge(self) -> str:
        return "Sanal Tarayıcı"

    @property
    def browser_engine(self) -> str:
        return "@akalin/browser_module (Docker Playwright)"

    @property
    def use_proxy(self) -> bool:
        return True

    @property
    def response_prefix_to_strip(self) -> Optional[str]:
        return None

    @property
    def fallback_local(self) -> Optional[str]:
        return None

    @property
    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            streaming=True,
            vision=True,
            reasoning=True,
            function_calling=True,
            image_generation=False,
            json_mode=True,
        )

    def format_browser_response(
        self,
        raw_text: str,
        metadata: Dict[str, Any],
    ) -> Optional[str]:
        """Varsayılan olarak None döner (standart telemetri + yanıt akışı kullanılır)."""
        return None

    def to_definition_dict(self) -> Dict[str, Any]:
        payload = super().to_definition_dict()
        payload["target_url"] = self.target_url
        payload["browser_engine"] = self.browser_engine
        payload["use_proxy"] = self.use_proxy
        payload["session_prefix"] = self.session_prefix
        return payload
