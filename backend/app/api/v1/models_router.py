from typing import Optional
from fastapi import APIRouter, Depends, Query, Request
from app.core.dependencies import get_model_service
from app.core.logger import gateway_logger
from app.dtos.model_dto import ModelListResponseDTO
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
