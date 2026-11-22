"""
ThinkPort AI Gateway - Google Gemini (Sanal Tarayıcı) Model Tanımı (gemini_web_model.py).
IWebBrowserModel (BaseWebBrowserModel) arayüzünü uygulayan bağımsız Gemini Web modeli.
Hedef Web URL: https://gemini.google.com/app
"""
from typing import List, Optional
from app.models.web_browser_model import BaseWebBrowserModel


class GeminiWebModel(BaseWebBrowserModel):
    """Google Gemini Sanal Tarayıcı modeli (https://gemini.google.com/app)."""

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
    def aliases(self) -> List[str]:
        return [
            "gemini-web",
            "gemini-web-ai",
            "google-gemini-web",
            "gemini-app",
            "gemini-browser",
        ]
