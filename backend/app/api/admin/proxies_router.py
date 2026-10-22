from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException
from app.core.dependencies import get_proxy_service, get_session_repository
from app.dtos.admin_dto import (
    BrowserSessionDTO,
    CreateBrowserSessionRequestDTO,
    PoolDashboardMetricsDTO,
)
from app.dtos.proxy_dto import (
    CreateProxyRequestDTO,
    BulkProxyImportRequestDTO,
    FetchFreeProxyRequestDTO,
    ProxyNodeDTO,
    BulkProxyImportResponseDTO,
    ProxyCheckAllResponseDTO,
    DeleteProxyResponseDTO,
)
from app.repositories.session_repository import SessionRepository
from app.services.proxy_service import ProxyService

router = APIRouter(prefix="/admin/proxies", tags=["Admin Proxies & Sessions"])


@router.get("/dashboard", response_model=PoolDashboardMetricsDTO)
async def get_pool_dashboard_metrics(
    session_repo: SessionRepository = Depends(get_session_repository),
) -> PoolDashboardMetricsDTO:
    """Bağlantı Havuzu Dashboard için SQLite zaman serisi çizelgesini, dağılımları ve olay kayıtlarını döner."""
    return session_repo.get_pool_dashboard_metrics()


@router.post("/sessions", response_model=BrowserSessionDTO)
async def spawn_dynamic_browser_session(
    body: CreateBrowserSessionRequestDTO,
    session_repo: SessionRepository = Depends(get_session_repository),
) -> BrowserSessionDTO:
    """İlgili sağlayıcı için dinamik (auto-scaled) yeni bir tarayıcı oturumu başlatır."""
    return session_repo.spawn_dynamic_session(body)


@router.post("/sessions/prune")
async def prune_idle_dynamic_sessions(
    session_repo: SessionRepository = Depends(get_session_repository),
) -> Dict[str, Any]:
    """Boşta (idle) olan tüm dinamik tarayıcı oturumlarını temizler (Scale-Down)."""
    removed_count = session_repo.prune_idle_dynamic_sessions()
    return {
        "removed_count": removed_count,
        "sessions": session_repo.list_all(),
    }


@router.delete("/sessions/{session_id}")
async def terminate_browser_session(
    session_id: str,
    session_repo: SessionRepository = Depends(get_session_repository),
) -> Dict[str, Any]:
    """Belirtilen tarayıcı oturumunu sonlandırır ve havuzdan kaldırır."""
    removed = session_repo.terminate_session(session_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Tarayıcı oturumu bulunamadı.")
    return {"terminated": True, "session": removed}


@router.post("", response_model=ProxyNodeDTO)
async def create_proxy(
    body: CreateProxyRequestDTO,
    proxy_service: ProxyService = Depends(get_proxy_service),
) -> ProxyNodeDTO:
    """Havuza yeni bir tekil proxy düğümü ekler."""
    return await proxy_service.create_proxy(body)


@router.post("/bulk", response_model=BulkProxyImportResponseDTO)
async def bulk_import_proxies(
    body: BulkProxyImportRequestDTO,
    proxy_service: ProxyService = Depends(get_proxy_service),
) -> BulkProxyImportResponseDTO:
    """Metin listesinden toplu proxy düğümü içe aktarır."""
    return proxy_service.bulk_import_proxies(body)


@router.post("/fetch-free", response_model=BulkProxyImportResponseDTO)
async def fetch_free_proxies(
    body: FetchFreeProxyRequestDTO,
    proxy_service: ProxyService = Depends(get_proxy_service),
) -> BulkProxyImportResponseDTO:
    """Açık kaynaklı güncel proxy beslemelerinden canlı proxy düğümleri çeker."""
    return await proxy_service.fetch_free_proxies(body)


@router.post("/check-all", response_model=ProxyCheckAllResponseDTO)
async def check_all_proxies(
    proxy_service: ProxyService = Depends(get_proxy_service),
) -> ProxyCheckAllResponseDTO:
    """Havuzdaki tüm proxy düğümlerinin gecikme ve erişilebilirlik kontrolünü yapar."""
    return await proxy_service.check_all_proxies()


@router.post("/{proxy_id}/check", response_model=ProxyNodeDTO)
async def check_single_proxy(
    proxy_id: str,
    proxy_service: ProxyService = Depends(get_proxy_service),
) -> ProxyNodeDTO:
    """Tek bir proxy düğümünün gecikmesini ölçer ve aktif duruma getirir."""
    return await proxy_service.check_single_proxy(proxy_id)


@router.patch("/{proxy_id}/toggle", response_model=ProxyNodeDTO)
async def toggle_proxy_status(
    proxy_id: str,
    proxy_service: ProxyService = Depends(get_proxy_service),
) -> ProxyNodeDTO:
    """Proxy düğümünün durumunu (active <-> cooldown) değiştirir."""
    return proxy_service.toggle_proxy_status(proxy_id)


@router.delete("/{proxy_id}", response_model=DeleteProxyResponseDTO)
async def delete_proxy(
    proxy_id: str,
    proxy_service: ProxyService = Depends(get_proxy_service),
) -> DeleteProxyResponseDTO:
    """Proxy düğümünü havuzdan siler."""
    return proxy_service.delete_proxy(proxy_id)
