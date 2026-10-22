from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from app.core.config import settings

router = APIRouter(tags=["Web UI Dashboard"])

FALLBACK_TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "templates" / "dashboard_fallback.html"


def _load_dashboard_html() -> str:
    """Önce derlenmiş React arayüzünü (frontend/dist/index.html), yoksa yedek şablonu yükler."""
    dist_index = settings.frontend_dist_dir / "index.html"
    if dist_index.is_file():
        return dist_index.read_text(encoding="utf-8")
    if FALLBACK_TEMPLATE_PATH.is_file():
        return FALLBACK_TEMPLATE_PATH.read_text(encoding="utf-8")
    return "<html><body><h1>Gateway UI</h1></body></html>"


@router.get("/", response_class=HTMLResponse)
@router.get("/login", response_class=HTMLResponse)
@router.get("/admin", response_class=HTMLResponse)
@router.get("/chat", response_class=HTMLResponse)
@router.get("/chat/{subpath:path}", response_class=HTMLResponse)
@router.get("/overview", response_class=HTMLResponse)
@router.get("/users", response_class=HTMLResponse)
@router.get("/keys", response_class=HTMLResponse)
@router.get("/nodes", response_class=HTMLResponse)
@router.get("/nodes/{subpath:path}", response_class=HTMLResponse)
@router.get("/settings", response_class=HTMLResponse)
@router.get("/settings/{subpath:path}", response_class=HTMLResponse)
async def serve_admin_dashboard(subpath: str = "") -> HTMLResponse:
    """Yönetim ve AI Sohbet Konsolu web arayüzünü sunar."""
    return HTMLResponse(content=_load_dashboard_html())
