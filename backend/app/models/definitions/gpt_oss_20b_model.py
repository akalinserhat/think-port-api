"""
ThinkPort AI Gateway - OpenAI GPT-OSS 20B Model Tanımı (gpt_oss_20b_model.py).
IThinkPortModel arayüzünü uygulayan bağımsız GPT-OSS 20B açık kaynak model sınıfı.
"""
from typing import List, Optional
from app.models.base_model import BaseThinkPortModel, ModelCapabilities


class GptOss20BModel(BaseThinkPortModel):
    """GPT-OSS 20B Açık Kaynak Büyük Dil Modeli (Web AI Ağ Geçidi)."""

    @property
    def id(self) -> str:
        return "gpt-oss:20b"

    @property
    def name(self) -> str:
        return "GPT-OSS 20B"

    @property
    def vendor(self) -> str:
        return "Open Source (OpenAI OSS)"

    @property
    def provider(self) -> str:
        return "web-ai"

    @property
    def protocol_id(self) -> str:
        return "proto_openai"

    @property
    def badge(self) -> str:
        return "Web AI"

    @property
    def description(self) -> str:
        return "GPT-OSS 20B açık kaynak büyük dil modeli (Web AI ağ geçidi üzerinden yüksek hızlı akış)."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/GptOss20BModel.ts"

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
            reasoning=True,
            function_calling=True,
            image_generation=False,
            json_mode=True,
        )

    @property
    def aliases(self) -> List[str]:
        return [
            "gpt-oss:20b",
            "gpt-oss-20b",
            "gpt-oss",
            "openai-fast",
            "gpt-4o",
            "gpt-4o-mini",
            "chatgpt",
            "claude-3-5-sonnet",
            "gemini-2.5-pro",
            "deepseek-r1",
        ]
