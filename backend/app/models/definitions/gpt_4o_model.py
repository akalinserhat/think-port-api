"""
ThinkPort AI Gateway - OpenAI GPT-4o Model Tanımı (gpt_4o_model.py).
IThinkPortModel arayüzünü uygulayan bağımsız GPT-4o model sınıfı.
"""
from typing import List, Optional
from app.models.base_model import BaseThinkPortModel, ModelCapabilities


class Gpt4oModel(BaseThinkPortModel):
    """OpenAI GPT-4o Web Gateway & API uyumlu amiral gemisi sohbet modeli."""

    @property
    def id(self) -> str:
        return "gpt-4o"

    @property
    def name(self) -> str:
        return "GPT-4o (Web Gateway)"

    @property
    def vendor(self) -> str:
        return "OpenAI"

    @property
    def provider(self) -> str:
        return "chatgpt-web"

    @property
    def protocol_id(self) -> str:
        return "proto_openai"

    @property
    def badge(self) -> str:
        return "Web AI"

    @property
    def description(self) -> str:
        return "OpenAI GPT-4o web oturumu (yüksek hızlı Web AI köprüsü)."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/Gpt4oModel.ts"

    @property
    def context_window(self) -> int:
        return 128000

    @property
    def max_output_tokens(self) -> int:
        return 16384

    @property
    def web_model(self) -> Optional[str]:
        return "openai-fast"

    @property
    def fallback_local(self) -> Optional[str]:
        return "qwen2.5:7b"

    @property
    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            streaming=True,
            vision=True,
            reasoning=False,
            function_calling=True,
            image_generation=False,
            json_mode=True,
        )

    @property
    def aliases(self) -> List[str]:
        return [
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4o-2024-05-13",
            "gpt-4o-2024-08-06",
            "gpt-4o-2024-11-20",
            "gpt-4o-mini-2024-07-18",
            "chatgpt-4o-latest",
            "gpt-4-turbo",
            "gpt-4-turbo-preview",
            "gpt-4-0125-preview",
            "gpt-4-1106-preview",
            "gpt-4",
            "gpt-4-0613",
            "gpt-4-32k",
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4.1-nano",
            "gpt-4.5-preview",
            "gpt-3.5-turbo",
            "gpt-3.5-turbo-0125",
            "gpt-3.5-turbo-1106",
            "gpt-3.5-turbo-16k",
            "o1",
            "o1-mini",
            "o1-preview",
            "o3",
            "o3-mini",
            "o4-mini",
            "openai",
            "openai-fast",
            "openai-large",
            "chatgpt",
        ]

