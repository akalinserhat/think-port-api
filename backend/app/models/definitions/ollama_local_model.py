"""
ThinkPort AI Gateway - Yerel Ollama Model Adaptörü (ollama_local_model.py).
IThinkPortModel arayüzünü uygulayan dinamik yerel Ollama model sınıfı.
"""
from typing import Any, Dict, List
from app.models.base_model import BaseThinkPortModel, ModelCapabilities, ModelCategoryLiteral


class OllamaLocalModel(BaseThinkPortModel):
    """Ollama yerel motorunda (11434) çalışan modelleri IThinkPortModel arayüzüne uyarlar."""

    def __init__(
        self,
        model_id: str,
        family: str = "LOCAL LLM",
        parameter_size: str = "7B",
        size_gb: float = 4.7,
        is_embedding: bool = False,
    ) -> None:
        self._id = model_id
        self._family = family.upper()
        self._parameter_size = parameter_size
        self._size_gb = size_gb
        self._is_embedding = is_embedding

    @classmethod
    def from_ollama_tag(cls, raw_entry: Dict[str, Any], is_embedding: bool = False) -> "OllamaLocalModel":
        name = str(raw_entry.get("name") or "")
        size_gb = round(int(raw_entry.get("size") or 0) / (1024 ** 3), 1)
        details = raw_entry.get("details") or {}
        family = str(details.get("family") or "Local LLM").upper()
        param_size = str(details.get("parameter_size") or f"{size_gb}GB")
        return cls(
            model_id=name,
            family=family,
            parameter_size=param_size,
            size_gb=size_gb,
            is_embedding=is_embedding,
        )

    @property
    def id(self) -> str:
        return self._id

    @property
    def name(self) -> str:
        return self._id

    @property
    def vendor(self) -> str:
        return f"Local ({self._family})"

    @property
    def provider(self) -> str:
        return "local-engine"

    @property
    def protocol_id(self) -> str:
        return "proto_ollama"

    @property
    def category(self) -> ModelCategoryLiteral:
        return "embedding" if self._is_embedding else "chat"

    @property
    def badge(self) -> str:
        return f"{self._parameter_size} · {self._size_gb}GB"

    @property
    def description(self) -> str:
        return f"Sisteminizde kurulu gerçek yerel yapay zeka modeli ({self._family}, {self._size_gb} GB)."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/DynamicOllamaModelAdapter.ts"

    @property
    def is_local(self) -> bool:
        return True

    @property
    def is_image(self) -> bool:
        return False

    @property
    def context_window(self) -> int:
        return 32768

    @property
    def max_output_tokens(self) -> int:
        return 8192

    @property
    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            streaming=not self._is_embedding,
            vision="vl" in self._id.lower() or "vision" in self._id.lower() or "gemma" in self._id.lower(),
            reasoning="r1" in self._id.lower() or "qwq" in self._id.lower(),
            function_calling=not self._is_embedding,
            image_generation=False,
            json_mode=not self._is_embedding,
        )

    @property
    def aliases(self) -> List[str]:
        base = self._id.split(":")[0]
        return [self._id, base] if base != self._id else [self._id]

