from typing import Any, Dict, Optional
import anyio
from fastapi import APIRouter, Depends, Query, Request
from app.core.dependencies import get_model_service
from app.core.logger import gateway_logger
from app.dtos.model_dto import ModelListResponseDTO
from app.models.registry import model_registry
from app.services.browser_tool_service import browser_tool_service
from app.services.model_service import ModelService

router = APIRouter(tags=["OpenAI Models"])

MODEL_LIST_PATHS = (
    "/v1/models",
    "/v1/v1/models",
    "/models",
    "/api/v1/models",
    "/api/models",
    "/api/tags",
    "/v1beta/models",
    "/v1/v1beta/models",
)


async def _handle_list_models(
    request: Request,
    type: Optional[str] = Query(
        default=None,
        description="Model tipi filtresi ('chat', 'image', 'embedding'). '?type=chat' görsel modelleri hariç tutar.",
    ),
    exclude_image: bool = Query(
        default=False,
        description="True olduğunda is_image=true olan Pollinations görsel üretim modellerini listeden çıkarır.",
    ),
    include_inactive: bool = Query(
        default=False,
        description="True olduğunda pasif/oturumu hazır olmayan modelleri de (available=false) listeye dahil eder.",
    ),
    model_service: ModelService = Depends(get_model_service),
) -> ModelListResponseDTO:
    """Sistemdeki aktif yerel, Web AI, harici API ve görsel üretim modellerini OpenAI formatında listeler."""
    res = model_service.get_openai_model_list(
        model_type=type,
        exclude_image=exclude_image,
        include_inactive=include_inactive,
    )
    gateway_logger.info(
        f"MODELS_LIST | path={request.url.path} | query={request.url.query or '-'} | count={len(res.data)}"
    )
    return res


for _path in MODEL_LIST_PATHS:
    router.add_api_route(
        _path,
        _handle_list_models,
        methods=["GET", "POST"],
        response_model=ModelListResponseDTO,
        include_in_schema=(_path == "/v1/models"),
    )


MODEL_PREWARM_PATHS = (
    "/v1/models/{model_id}/prewarm",
    "/models/{model_id}/prewarm",
    "/api/v1/models/{model_id}/prewarm",
    "/api/models/{model_id}/prewarm",
)


async def _handle_prewarm_model(model_id: str) -> Dict[str, Any]:
    """AI Chat ekranında bir web modeli açıldığında sıcak tarayıcı yoksa arka planda hızlıca hazırlar."""
    model_def = model_registry.get(model_id)
    target_url = getattr(model_def, "target_url", None) if model_def else None
    if not target_url:
        return {"status": "not_web_model", "model": model_id}
    use_proxy = bool(getattr(model_def, "use_proxy", True))
    res = await anyio.to_thread.run_sync(
        browser_tool_service.prewarm_target,
        target_url,
        use_proxy,
        1,
    )
    return {"model": model_id, "target_url": target_url, **res}


for _prewarm_path in MODEL_PREWARM_PATHS:
    router.add_api_route(
        _prewarm_path,
        _handle_prewarm_model,
        methods=["POST"],
        include_in_schema=(_prewarm_path == "/v1/models/{model_id}/prewarm"),
    )
