"""
ThinkPort AI Gateway - Google Gemini (Sanal Tarayıcı) Model Tanımı (gemini_web_model.py).
IWebBrowserModel (BaseWebBrowserModel) arayüzünü uygulayan bağımsız Gemini Web modeli.
Hedef Web URL: https://gemini.google.com/app
"""
import re
from typing import Any, Dict, List, Optional
from app.models.base_model import ModelCapabilities
from app.models.web_browser_model import BaseWebBrowserModel


class GeminiWebModel(BaseWebBrowserModel):
    """Google Gemini Sanal Tarayıcı modeli (https://gemini.google.com/app)."""

    _TRAILING_MARKERS: List[str] = [
        "About Gemini",
        "Gemini can make mistakes",
        "Gemini hata yapabilir",
        "Google Terms",
        "Privacy Policy",
    ]

    @property
    def id(self) -> str:
        return "gemini-web"

    @property
    def name(self) -> str:
        return "Gemini Web (Sanal Tarayıcı)"

    @property
    def vendor(self) -> str:
        return "Google"

    @property
    def provider(self) -> str:
        return "gemini-web"

    @property
    def protocol_id(self) -> str:
        return "proto_gemini"

    @property
    def description(self) -> str:
        return "Google Gemini web arayüzü (https://gemini.google.com/app) üzerinden Docker Playwright ile erişilen LLM."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/GeminiWebModel.ts"

    @property
    def target_url(self) -> str:
        return "https://gemini.google.com/app"

    @property
    def session_prefix(self) -> str:
        return "gemini-session"

    @property
    def auth_notice_domain(self) -> str:
        return "gemini.google.com/app"

    @property
    def response_prefix_to_strip(self) -> Optional[str]:
        return "gemini said"

    @property
    def context_window(self) -> int:
        return 1000000

    @property
    def max_output_tokens(self) -> int:
        return 16384

    @property
    def web_model(self) -> Optional[str]:
        return "gemini-web"

    @property
    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            vision=False,
            supports_image_attachments=False,
            supports_file_attachments=False,
        )

    @property
    def aliases(self) -> List[str]:
        return [
            "gemini-web",
            "gemini-web-ai",
            "google-gemini-web",
            "gemini-app",
            "gemini-browser",
        ]

    def format_browser_response(
        self,
        raw_text: str,
        metadata: Dict[str, Any],
    ) -> Optional[str]:
        """Gemini Web çıktısından arayüz kalıntılarını temizleyip okunabilir Markdown olarak sunar."""
        text = (raw_text or "").replace("\r\n", "\n").strip()
        if not text:
            return None

        text = re.sub(r"^(?:Gemini\s+said:?\s*)", "", text, flags=re.IGNORECASE).strip()
        for marker in self._TRAILING_MARKERS:
            pos = text.find(marker)
            if pos != -1 and pos > 20:
                text = text[:pos].rstrip()

        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        return text or None
