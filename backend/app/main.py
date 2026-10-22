from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.api.v1.models_router import router as models_router
from app.api.v1.chat_router import router as chat_router
from app.api.v1.images_router import router as images_router
from app.api.admin.state_router import router as admin_state_router
from app.api.admin.users_router import router as admin_users_router
from app.api.admin.api_keys_router import router as admin_api_keys_router
from app.api.admin.proxies_router import router as admin_proxies_router
from app.api.admin.conversations_router import router as admin_conversations_router
from app.api.ui_router import router as ui_router


def configure_cors(application: FastAPI) -> None:
    """Uygulamaya CORS ara katmanını (middleware) ekler."""
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Conversation-Id"],
    )


def configure_exception_handlers(application: FastAPI) -> None:
    """OpenAI standart hata sözlüklerini ({"error": ...}) üst düzey JSON olarak döndüren işleyiciyi kaydeder."""

    @application.exception_handler(HTTPException)
    async def openai_compatible_http_exception_handler(
        request: Request,
        exc: HTTPException,
    ) -> JSONResponse:
        if isinstance(exc.detail, dict) and "error" in exc.detail:
            return JSONResponse(
                status_code=exc.status_code,
                content=exc.detail,
                headers=exc.headers,
            )
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=exc.headers,
        )


def mount_frontend_assets(application: FastAPI) -> None:
    """Derlenmiş React önyüz statik varlıkları mevcutsa '/assets' yoluna bağlar."""
    assets_dir = settings.frontend_dist_dir / "assets"
    if assets_dir.is_dir():
        application.mount(
            "/assets",
            StaticFiles(directory=str(assets_dir)),
            name="frontend-assets",
        )


def register_routers(application: FastAPI) -> None:
    """Tüm OpenAI v1, Admin ve UI yönlendiricilerini (Controller/Router) kaydeder."""
    application.include_router(models_router)
    application.include_router(chat_router)
    application.include_router(images_router)
    application.include_router(admin_state_router)
    application.include_router(admin_users_router)
    application.include_router(admin_api_keys_router)
    application.include_router(admin_proxies_router)
    application.include_router(admin_conversations_router)
    application.include_router(ui_router)


def create_application() -> FastAPI:
    """FastAPI uygulama örneğini oluşturur ve yapılandırır (Application Factory)."""
    application = FastAPI(
        title=settings.app_title,
        version=settings.app_version,
        description=settings.app_description,
    )
    configure_cors(application)
    configure_exception_handlers(application)
    mount_frontend_assets(application)
    register_routers(application)
    return application


app = create_application()
