from fastapi import APIRouter, Depends, Response
from app.core.dependencies import get_image_service, require_authenticated_user
from app.dtos.image_dto import ImageGenerationRequestDTO, ImageGenerationResponseDTO
from app.dtos.user_dto import AuthenticatedUserContextDTO
from app.services.image_service import ImageService

router = APIRouter(prefix="/v1/images", tags=["OpenAI Images"])


@router.post("/generations", response_model=ImageGenerationResponseDTO)
async def create_image_generation(
    request: ImageGenerationRequestDTO,
    user_ctx: AuthenticatedUserContextDTO = Depends(require_authenticated_user),
    image_service: ImageService = Depends(get_image_service),
) -> ImageGenerationResponseDTO:
    """OpenAI uyumlu görsel üretim (/v1/images/generations) uç noktası."""
    return await image_service.generate_images(request, user_ctx)


@router.get("/files/{image_id}")
async def serve_generated_image(
    image_id: str,
    download: int = 0,
    image_service: ImageService = Depends(get_image_service),
) -> Response:
    """Üretilen ve önbellekte tutulan görsel dosyasını sunar."""
    cached = image_service.get_cached_image_or_404(image_id)
    headers = {"Cache-Control": "public, max-age=86400"}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{image_id}"'
    return Response(content=cached.raw_bytes, media_type=cached.media_type, headers=headers)
