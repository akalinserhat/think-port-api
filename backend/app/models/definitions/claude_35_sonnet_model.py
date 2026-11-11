"""
ThinkPort AI Gateway - Anthropic Claude 3.5 Sonnet Model Tanımı (claude_35_sonnet_model.py).
IThinkPortModel arayüzünü uygulayan bağımsız Claude 3.5 Sonnet model sınıfı.
"""
from typing import List, Optional
from app.models.base_model import BaseThinkPortModel, ModelCapabilities


class Claude35SonnetModel(BaseThinkPortModel):
    """Anthropic Claude 3.5 Sonnet Web Gateway & API uyumlu kodlama ve analiz modeli."""

    @property
    def id(self) -> str:
        return "claude-3-5-sonnet"

    @property
    def name(self) -> str:
        return "Claude 3.5 Sonnet (Web Gateway)"

    @property
    def vendor(self) -> str:
        return "Anthropic"

    @property
    def provider(self) -> str:
        return "claude-web"

    @property
    def protocol_id(self) -> str:
        return "proto_anthropic"

    @property
    def badge(self) -> str:
        return "Web AI"

    @property
    def description(self) -> str:
        return "Anthropic Claude 3.5 Sonnet web oturumu köprüsü."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/Claude35SonnetModel.ts"

    @property
    def context_window(self) -> int:
        return 200000

    @property
    def max_output_tokens(self) -> int:
        return 8192

    @property
    def web_model(self) -> Optional[str]:
        return "openai-fast"

    @property
    def fallback_local(self) -> Optional[str]:
        return "qwen2.5:14b"

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
            "claude-3-5-sonnet",
            "claude-3-5-sonnet-latest",
            "claude-3-5-sonnet-20241022",
            "claude-3-5-sonnet-20240620",
            "claude-3.5-sonnet",
            "claude-3-7-sonnet",
            "claude-3-7-sonnet-latest",
            "claude-3-7-sonnet-20250219",
            "claude-3.7-sonnet",
            "claude-3-5-haiku",
            "claude-3-5-haiku-latest",
            "claude-3-5-haiku-20241022",
            "claude-3-opus",
            "claude-3-opus-latest",
            "claude-3-opus-20240229",
            "claude-3-sonnet",
            "claude-3-sonnet-20240229",
            "claude-3-haiku",
            "claude-3-haiku-20240307",
            "claude-sonnet-4",
            "claude-sonnet-4-0",
            "claude-opus-4",
            "claude-opus-4-0",
            "claude-hybridspace",
            "claude",
        ]

