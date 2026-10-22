from typing import Any, Dict
from fastapi import APIRouter, Body, Depends
from app.core.dependencies import get_admin_service, get_document_service
from app.core.logger import LOG_DIR, gateway_logger
from app.dtos.admin_dto import AdminStateResponseDTO, GatewaySettingsDTO
from app.dtos.document_dto import ParseFileRequestDTO, ParseFileResponseDTO
from app.services.admin_service import AdminService
from app.services.document_service import DocumentService

router = APIRouter(prefix="/admin", tags=["Admin System & State"])


@router.get("/state", response_model=AdminStateResponseDTO)
async def get_admin_state(
    admin_service: AdminService = Depends(get_admin_service),
) -> AdminStateResponseDTO:
    """Admin yönetim konsolunun tüm anlık durumunu ve log kayıtlarını döner."""
    return admin_service.get_dashboard_state()


@router.delete("/logs")
async def clear_admin_logs(
    admin_service: AdminService = Depends(get_admin_service),
) -> dict:
    """Tüm telemetri ve sistem log kayıtlarını temizler."""
    admin_service.clear_all_logs()
    return {"status": "cleared"}


@router.post("/logs/client-error")
async def log_client_error(payload: Dict[str, Any] = Body(...)) -> dict:
    """Önyüz (React/Tarayıcı) çalışma zamanı hatalarını gateway.log ve frontend_errors.log dosyasına kaydeder."""
    err_type = payload.get("type", "FRONTEND_ERROR")
    message = payload.get("message", "")
    url = payload.get("href", "")
    stack = payload.get("stack", "")
    component_stack = payload.get("componentStack", "")
    gateway_logger.error(f"FRONTEND_ERROR | type={err_type} | url={url} | message={message}")
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        fe_log_file = LOG_DIR / "frontend_errors.log"
        with fe_log_file.open("a", encoding="utf-8") as f:
            f.write(
                f"=== {payload.get('ts', '')} | {err_type} | {url} ===\n"
                f"Message: {message}\n"
                f"Stack:\n{stack}\n"
                f"ComponentStack:\n{component_stack}\n\n"
            )
    except Exception:
        pass
    return {"status": "logged"}


@router.patch("/settings", response_model=GatewaySettingsDTO)
async def update_admin_settings(
    body: GatewaySettingsDTO,
    admin_service: AdminService = Depends(get_admin_service),
) -> GatewaySettingsDTO:
    """Sistem genel hız sınırı, tarayıcı havuzu ve anti-bot ayarlarını günceller."""
    return admin_service.update_gateway_settings(body)


@router.post("/parse-file", response_model=ParseFileResponseDTO)
async def parse_uploaded_file(
    body: ParseFileRequestDTO,
    document_service: DocumentService = Depends(get_document_service),
) -> ParseFileResponseDTO:
    """Yüklenen belgeden (PDF, DOCX, XLSX, PPTX, kod, metin) içerik çıkarır ve token hesaplar."""
    return document_service.parse_base64_document(body)
