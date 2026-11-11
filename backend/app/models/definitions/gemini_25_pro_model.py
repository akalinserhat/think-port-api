"""
ThinkPort AI Gateway - Google Gemini 2.5 Pro Model Tanımı (gemini_25_pro_model.py).
IThinkPortModel arayüzünü uygulayan bağımsız Gemini 2.5 Pro model sınıfı.
"""
from typing import List, Optional
from app.models.base_model import BaseThinkPortModel, ModelCapabilities


class Gemini25ProModel(BaseThinkPortModel):
    """Google Gemini 2.5 Pro geniş bağlamlı çok modlu (multimodal) model."""

    @property
    def id(self) -> str:
        return "gemini-2.5-pro"

    @property
    def name(self) -> str:
        return "Gemini 2.5 Pro (Web Gateway)"

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
    def badge(self) -> str:
        return "Web AI"

    @property
    def description(self) -> str:
        return "Google Gemini 2.5 Pro web oturumu köprüsü."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/Gemini25ProModel.ts"

    @property
    def context_window(self) -> int:
        return 1000000

    @property
    def max_output_tokens(self) -> int:
        return 16384

    @property
    def web_model(self) -> Optional[str]:
        return "openai-fast"

    @property
    def fallback_local(self) -> Optional[str]:
        return "gemma4:e4b"

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

    @property
    def aliases(self) -> List[str]:
        return [
            "gemini-2.5-pro",
            "gemini-2.5-pro-preview",
            "gemini-2.5-pro-exp",
            "gemini-2.5-flash",
            "gemini-2.5-flash-preview",
            "gemini-2.0-flash",
            "gemini-2.0-flash-001",
            "gemini-2.0-flash-exp",
            "gemini-2.0-flash-lite",
            "gemini-2.0-pro",
            "gemini-2.0-pro-exp",
            "gemini-1.5-pro",
            "gemini-1.5-pro-latest",
            "gemini-1.5-pro-001",
            "gemini-1.5-pro-002",
            "gemini-1.5-flash",
            "gemini-1.5-flash-latest",
            "gemini-1.5-flash-001",
            "gemini-1.5-flash-002",
            "gemini-1.5-flash-8b",
            "gemini-pro",
            "gemini-ultra",
            "gemini",
        ]

