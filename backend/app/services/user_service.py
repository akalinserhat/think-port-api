import uuid
from datetime import datetime, timezone
from typing import List
from app.core.exceptions import bad_request_error, resource_not_found_error
from app.dtos.user_dto import CreateUserRequestDTO, UserResponseDTO
from app.repositories.user_repository import UserRepository


class UserService:
    """
    Kullanıcı yönetimi iş mantığı servisi.
    Her metot yalnızca tek bir kullanıcı yönetim görevini yerine getirir.
    """

    def __init__(self, user_repo: UserRepository) -> None:
        self._user_repo = user_repo

    def list_users(self) -> List[UserResponseDTO]:
        """Sistemdeki tüm kullanıcıları listeler."""
        return self._user_repo.list_all()

    def create_user(self, dto: CreateUserRequestDTO) -> UserResponseDTO:
        """Yeni bir kullanıcı kaydı oluşturur, mükerrer e-posta kontrolü yapar ve kaydeder."""
        normalized_email = dto.email.strip().lower()
        if not normalized_email:
            raise bad_request_error("Geçerli bir e-posta adresi girilmelidir.")

        existing = self._user_repo.get_by_email(normalized_email)
        if existing:
            raise bad_request_error(
                f"Bu e-posta adresi ({normalized_email}) ile kayıtlı bir kullanıcı zaten mevcut."
            )

        role_val = (dto.role or "user").strip() or "user"
        new_user = UserResponseDTO(
            id=f"usr_{uuid.uuid4().hex[:6]}",
            email=normalized_email,
            full_name=dto.full_name.strip() or "Yeni Kullanıcı",
            role=role_val,
            status="active",
            token_quota=dto.token_quota,
            tokens_used=0,
            rpm_limit=dto.rpm_limit,
            concurrent_limit=5 if (role_val == "admin" or "yönetici" in role_val.lower()) else 2,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        return self._user_repo.save(new_user)

    def toggle_user_status(self, user_id: str) -> UserResponseDTO:
        """Kullanıcının aktif/askıda (active/suspended) durumunu tersine çevirir."""
        existing = self._user_repo.get_by_id(user_id)
        if not existing:
            raise resource_not_found_error("Kullanıcı bulunamadı")
        next_status = "suspended" if existing.status == "active" else "active"
        updated = self._user_repo.update_status(user_id, next_status)
        if not updated:
            raise resource_not_found_error("Kullanıcı bulunamadı")
        return updated
