from typing import Any, Dict, List
from fastapi import APIRouter, Body, Depends, HTTPException
from app.core.dependencies import get_admin_service, get_document_service
from app.core.logger import LOG_DIR, gateway_logger
from app.dtos.admin_dto import AdminStateResponseDTO, GatewaySettingsDTO
from app.dtos.document_dto import ParseFileRequestDTO, ParseFileResponseDTO
from app.repositories.postgres_cli_bridge import (
    create_ai_agent,
    create_api_protocol,
    delete_ai_agent,
    delete_api_protocol,
    fetch_ai_provider_models,
    get_ai_agent,
    get_api_protocol,
    list_ai_agents,
    list_ai_providers,
    list_ai_tools_catalog,
    list_ai_tools_templates,
    list_api_protocols,
    set_ai_agent_tools,
    test_api_protocol,
    update_ai_agent,
    update_api_protocol,
)
from app.services.admin_service import AdminService
from app.services.document_service import DocumentService
from app.services.agent_memory_service import agent_memory_service

router = APIRouter(prefix="/admin", tags=["Admin System & State"])
api_agents_router = APIRouter(prefix="/api", tags=["AI Agents & MCP Management"])


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


@router.get("/protocols")
async def get_protocols() -> List[Dict[str, Any]]:
    """Dinamik AI API protokollerini listeler."""
    return list_api_protocols()


@router.get("/protocols/{protocol_id}")
async def get_protocol_by_id(protocol_id: str) -> Dict[str, Any]:
    """Belirtilen API protokolünü döner."""
    proto = get_api_protocol(protocol_id)
    if not proto:
        raise HTTPException(status_code=404, detail="Protokol bulunamadı.")
    return proto


@router.post("/protocols")
async def create_protocol(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Yeni bir özel API protokolü oluşturur."""
    res = create_api_protocol(body)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.post("/protocols/test")
async def test_protocol_endpoint(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """API protokolü istek ve yanıt dönüştürücü scriptlerini canlı ortamda test eder."""
    res = test_api_protocol(body)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.put("/protocols/{protocol_id}")
@router.patch("/protocols/{protocol_id}")
async def update_protocol(protocol_id: str, body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Mevcut bir API protokolünün scriptlerini ve bilgilerini günceller."""
    res = update_api_protocol(protocol_id, body)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.delete("/protocols/{protocol_id}")
async def remove_protocol(protocol_id: str) -> Dict[str, Any]:
    """Özel bir API protokolünü siler."""
    res = delete_api_protocol(protocol_id)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.get("/agents")
@api_agents_router.get("/AiAjanlar")
async def get_ai_agents_endpoint() -> List[Dict[str, Any]]:
    """Kayıtlı tüm AI ajanlarını (Gözlemci Ajan, Genel Asistan, ERP Uzman Ajanları vb.) listeler."""
    return list_ai_agents()


@router.get("/agents/{agent_id}")
@api_agents_router.get("/AiAjanlar/{agent_id}")
async def get_ai_agent_by_id_endpoint(agent_id: int) -> Dict[str, Any]:
    """Belirtilen ID'ye sahip AI ajanını döner."""
    agent = get_ai_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Ajan bulunamadı.")
    return agent


@router.post("/agents")
@api_agents_router.post("/AiAjanlar")
async def create_ai_agent_endpoint(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Yeni bir AI ajanı oluşturur."""
    res = create_ai_agent(body)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.put("/agents/{agent_id}")
@router.patch("/agents/{agent_id}")
@api_agents_router.put("/AiAjanlar/{agent_id}")
@api_agents_router.patch("/AiAjanlar/{agent_id}")
async def update_ai_agent_endpoint(agent_id: int, body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Mevcut bir AI ajanını günceller."""
    res = update_ai_agent(agent_id, body)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.delete("/agents/{agent_id}")
@api_agents_router.delete("/AiAjanlar/{agent_id}")
async def delete_ai_agent_endpoint(agent_id: int) -> Dict[str, Any]:
    """Özel bir AI ajanını siler (sistem kayıtları silinemez)."""
    res = delete_ai_agent(agent_id)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@api_agents_router.get("/AiSaglayicilar")
async def get_ai_providers_endpoint() -> List[Dict[str, Any]]:
    """ThinkPort üzerindeki aktif AI sağlayıcılarını ve modellerini listeler."""
    return list_ai_providers()


@api_agents_router.post("/AiSaglayicilar/{provider_id}/fetch-models")
async def fetch_ai_provider_models_endpoint(provider_id: int) -> List[str]:
    """Belirtilen sağlayıcıdaki aktif model kimliklerini döner."""
    return fetch_ai_provider_models(provider_id)


@api_agents_router.get("/AiAraclar/katalog")
async def get_ai_tools_catalog_endpoint() -> List[Dict[str, Any]]:
    """Ajanlara atanabilecek MCP ve sistem araçları kataloğunu döner."""
    return list_ai_tools_catalog()


@api_agents_router.get("/AiAraclar/sablonlar")
async def get_ai_tools_templates_endpoint() -> List[Dict[str, Any]]:
    """Hazır ajan kural şablonlarını döner."""
    return list_ai_tools_templates()


@api_agents_router.post("/AiAraclar/ajan/{agent_id}/araclar")
async def set_ai_agent_tools_endpoint(agent_id: int, body: Any = Body(...)) -> Dict[str, Any]:
    """Belirtilen ajanın seçili MCP araç kodlarını kaydeder."""
    res = set_ai_agent_tools(agent_id, body)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@api_agents_router.post("/AiAjanlar/hafiza/tara")
async def search_agent_memory_endpoint(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """(app_id, agent_id) birleşik anahtarıyla pgvector ajan hafızasını tarar."""
    app_id = str(body.get("app_id") or body.get("uygulamaId") or "")
    agent_id = str(body.get("agent_id") or body.get("ajanKodu") or body.get("kod") or "")
    query = str(body.get("query") or body.get("sorgu") or "")
    memory_type = str(body.get("memory_type") or "all")
    top_k = int(body.get("top_k") or 5)
    return agent_memory_service.search_agent_memory(
        app_id=app_id,
        agent_id=agent_id,
        query=query,
        memory_type=memory_type,
        top_k=top_k,
    )


@api_agents_router.post("/AiAjanlar/hafiza/kaydet")
async def save_agent_memory_endpoint(body: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """(app_id, agent_id) birleşik anahtarıyla pgvector ajan hafızasına bilgi/kural kaydeder."""
    app_id = str(body.get("app_id") or body.get("uygulamaId") or "")
    agent_id = str(body.get("agent_id") or body.get("ajanKodu") or body.get("kod") or "")
    content = str(body.get("content") or body.get("icerik") or "")
    memory_type = str(body.get("memory_type") or "fact")
    importance = float(body.get("importance") or 0.8)
    is_pinned = bool(body.get("is_pinned", False))
    tags = body.get("tags") if isinstance(body.get("tags"), list) else []
    return agent_memory_service.save_explicit_agent_memory(
        app_id=app_id,
        agent_id=agent_id,
        conversation_id=str(body.get("conversation_id") or ""),
        content=content,
        memory_type=memory_type,
        importance=importance,
        is_pinned=is_pinned,
        tags=tags,
    )
