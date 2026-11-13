"""
ThinkPort AI Gateway - BAAI/bge-m3 Çok Dilli RAG Embedding Model Tanımı (bge_m3_model.py).
IThinkPortModel arayüzünü uygulayan, online (SiliconFlow / Cloudflare / HuggingFace / OpenRouter / DeepInfra)
ve yerel (Ollama bge-m3:latest) sağlayıcı bağımsız 1024 boyutlu vektör gömme modeli sınıfı.
"""
from typing import List, Optional
from app.models.base_model import BaseThinkPortModel, ModelCapabilities, ModelCategoryLiteral


class BgeM3EmbeddingModel(BaseThinkPortModel):
    """BAAI/bge-m3 çok dilli (100+ dil), 8192 token bağlamlı, 1024 boyutlu standart RAG embedding modeli."""

    @property
    def id(self) -> str:
        return "BAAI/bge-m3"

    @property
    def name(self) -> str:
        return "BAAI/bge-m3 (Online RAG Embedding · 1024d)"

    @property
    def vendor(self) -> str:
        return "BAAI"

    @property
    def provider(self) -> str:
        return "bge-m3-gateway"

    @property
    def protocol_id(self) -> str:
        return "proto_openai"

    @property
    def category(self) -> ModelCategoryLiteral:
        return "embedding"

    @property
    def badge(self) -> str:
        return "Embedding · 1024d"

    @property
    def description(self) -> str:
        return (
            "Çok dilli (Türkçe dahil 100+ dil), 8192 token bağlam pencereli ve 1024 boyutlu "
            "sağlayıcı bağımsız standart RAG vektör ve semantik parçalama (chunking) modeli."
        )

    @property
    def source_file(self) -> str:
        return "src/models/definitions/BgeM3EmbeddingModel.ts"

    @property
    def context_window(self) -> int:
        return 8192

    @property
    def max_output_tokens(self) -> int:
        return 1024

    @property
    def fallback_local(self) -> Optional[str]:
        return "bge-m3:latest"

    @property
    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            streaming=False,
            vision=False,
            reasoning=False,
            function_calling=False,
            image_generation=False,
            json_mode=True,
        )

    @property
    def aliases(self) -> List[str]:
        return [
            "BAAI/bge-m3",
            "baai/bge-m3",
            "bge-m3",
            "bge-m3:latest",
            "@cf/baai/bge-m3",
            "Pro/BAAI/bge-m3",
            "text-embedding-3-small",
            "text-embedding-3-large",
            "text-embedding-ada-002",
        ]
