"""
ThinkPort AI Gateway - Bireysel Model Tanımları Paketi (definitions/__init__.py).
Her yapay zeka modeli kendi bağımsız kod dosyasında IThinkPortModel arayüzünü uygular.
"""
from app.models.definitions.gpt_4o_model import Gpt4oModel
from app.models.definitions.claude_35_sonnet_model import Claude35SonnetModel
from app.models.definitions.deepseek_r1_model import DeepSeekR1Model
from app.models.definitions.gemini_25_pro_model import Gemini25ProModel
from app.models.definitions.flux_1_model import Flux1Model
from app.models.definitions.flux_realism_model import FluxRealismModel
from app.models.definitions.flux_anime_model import FluxAnimeModel
from app.models.definitions.flux_3d_model import Flux3dModel
from app.models.definitions.sdxl_turbo_model import SdxlTurboModel
from app.models.definitions.ollama_local_model import OllamaLocalModel
from app.models.definitions.bge_m3_model import BgeM3EmbeddingModel

__all__ = [
    "Gpt4oModel",
    "Claude35SonnetModel",
    "DeepSeekR1Model",
    "Gemini25ProModel",
    "Flux1Model",
    "FluxRealismModel",
    "FluxAnimeModel",
    "Flux3dModel",
    "SdxlTurboModel",
    "OllamaLocalModel",
    "BgeM3EmbeddingModel",
]

