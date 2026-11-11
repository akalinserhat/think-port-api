"""
ThinkPort AI Gateway - DeepSeek R1 Model Tanımı (deepseek_r1_model.py).
IThinkPortModel arayüzünü uygulayan bağımsız DeepSeek R1 model sınıfı.
"""
from typing import List, Optional
from app.models.base_model import BaseThinkPortModel, ModelCapabilities


class DeepSeekR1Model(BaseThinkPortModel):
    """DeepSeek R1 Düşünce Zinciri (Chain-of-Thought) muhakeme modeli."""

    @property
    def id(self) -> str:
        return "deepseek-r1"

    @property
    def name(self) -> str:
        return "DeepSeek R1 (Web Gateway)"

    @property
    def vendor(self) -> str:
        return "DeepSeek"

    @property
    def provider(self) -> str:
        return "deepseek-web"

    @property
    def protocol_id(self) -> str:
        return "proto_openai"

    @property
    def badge(self) -> str:
        return "Reasoning"

    @property
    def description(self) -> str:
        return "DeepSeek R1 düşünce zinciri (Chain-of-Thought) web köprüsü."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/DeepSeekR1Model.ts"

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
            vision=False,
            reasoning=True,
            function_calling=True,
            image_generation=False,
            json_mode=True,
        )

    @property
    def aliases(self) -> List[str]:
        return [
            "deepseek-r1",
            "deepseek-chat",
            "deepseek-reasoner",
            "deepseek-coder",
            "deepseek-v3",
            "deepseek-v2.5",
            "deepseek",
        ]

