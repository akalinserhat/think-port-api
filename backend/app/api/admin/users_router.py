from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException
from app.core.dependencies import get_user_service
from app.dtos.user_dto import CreateUserRequestDTO, UserResponseDTO
from app.repositories.sqlite_cli_bridge import (
    authenticate_system_user,
    create_system_user,
    delete_system_user,
    list_system_users,
    toggle_system_user_status,
    update_system_user,
)
from app.services.user_service import UserService

router = APIRouter(prefix="/admin/users", tags=["Admin Users"])


@router.post("", response_model=UserResponseDTO)
async def create_user(
    body: CreateUserRequestDTO,
    user_service: UserService = Depends(get_user_service),
) -> UserResponseDTO:
    """Yeni bir SaaS kullanıcısı ve kota tanımı oluşturur."""
    return user_service.create_user(body)


@router.patch("/{user_id}/toggle-status", response_model=UserResponseDTO)
async def toggle_user_status(
    user_id: str,
    user_service: UserService = Depends(get_user_service),
) -> UserResponseDTO:
    """Kullanıcının aktiflik durumunu (active <-> suspended) değiştirir."""
    return user_service.toggle_user_status(user_id)


@router.get("/system")
async def get_admin_system_users() -> List[Dict[str, Any]]:
    """Admin panele giriş yapabilen sistem kullanıcılarını listeler."""
    return list_system_users()


@router.post("/system")
async def create_admin_system_user(body: Dict[str, Any]) -> Dict[str, Any]:
    """Yeni bir Admin panel sistem kullanıcısı oluşturur."""
    res = create_system_user(body)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.patch("/system/{user_id}")
async def update_admin_system_user(user_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """Admin panel sistem kullanıcısını günceller."""
    res = update_system_user(user_id, body)
    if res is None:
        raise HTTPException(status_code=404, detail="Sistem kullanıcısı bulunamadı.")
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.patch("/system/{user_id}/toggle-status")
async def toggle_admin_system_user(user_id: str) -> Dict[str, Any]:
    """Admin panel sistem kullanıcısının durumunu değiştirir."""
    res = toggle_system_user_status(user_id)
    if res is None:
        raise HTTPException(status_code=404, detail="Sistem kullanıcısı bulunamadı.")
    return res


@router.delete("/system/{user_id}")
async def remove_admin_system_user(user_id: str) -> Dict[str, Any]:
    """Admin panel sistem kullanıcısını siler."""
    res = delete_system_user(user_id)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res


@router.post("/auth/login")
async def login_admin_system_user(body: Dict[str, Any]) -> Dict[str, Any]:
    """Admin panel kullanıcı girişi doğrular."""
    res = authenticate_system_user(body)
    if not res.get("authenticated"):
        raise HTTPException(status_code=401, detail=res.get("error", "Giriş başarısız."))
    return res
