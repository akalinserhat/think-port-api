from typing import List, Optional
from app.dtos.user_dto import UserResponseDTO
from app.repositories.state_store import InMemoryStateStore
from app.repositories.sqlite_db import sqlite_db


class UserRepository:
    """Kullanıcı veri erişim katmanı (SQLite kalıcı depolama). Her metot tek bir CRUD işleminden sorumludur."""

    def __init__(self, state_store: InMemoryStateStore) -> None:
        self._store = state_store

    def list_all(self) -> List[UserResponseDTO]:
        """Sistemdeki tüm kullanıcıları (Sistem Yöneticileri dahil) tekil 'users' tablosundan DTO listesi olarak döner."""
        with sqlite_db.connection() as conn:
            rows = conn.execute(
                """
                SELECT id, email, full_name, role, status,
                       token_quota, tokens_used, rpm_limit, concurrent_limit, created_at
                FROM users
                ORDER BY
                    CASE
                        WHEN id = 'sys_usr_01' THEN 0
                        WHEN id LIKE 'sys_usr_%' THEN 1
                        WHEN role = 'admin' OR role LIKE '%Yönetici%' THEN 2
                        ELSE 3
                    END,
                    created_at ASC
                """
            ).fetchall()
        return [UserResponseDTO(**dict(r)) for r in rows]

    def get_by_id(self, user_id: str) -> Optional[UserResponseDTO]:
        """ID değerine göre tekil kullanıcıyı SQLite 'users' tablosundan bulur."""
        with sqlite_db.connection() as conn:
            row = conn.execute(
                """
                SELECT id, email, full_name, role, status,
                       token_quota, tokens_used, rpm_limit, concurrent_limit, created_at
                FROM users
                WHERE id = ?
                """,
                (user_id,),
            ).fetchone()
        return UserResponseDTO(**dict(row)) if row else None

    def get_by_email(self, email: str) -> Optional[UserResponseDTO]:
        """E-posta adresine (büyük/küçük harf duyarsız) göre kullanıcıyı 'users' tablosundan bulur."""
        normalized_email = (email or "").strip().lower()
        if not normalized_email:
            return None
        with sqlite_db.connection() as conn:
            row = conn.execute(
                """
                SELECT id, email, full_name, role, status,
                       token_quota, tokens_used, rpm_limit, concurrent_limit, created_at
                FROM users
                WHERE LOWER(TRIM(email)) = ?
                LIMIT 1
                """,
                (normalized_email,),
            ).fetchone()
        return UserResponseDTO(**dict(row)) if row else None

    def save(self, user: UserResponseDTO) -> UserResponseDTO:
        """Yeni veya güncellenmiş kullanıcı kaydını tekil SQLite 'users' tablosuna yazar."""
        normalized_email = user.email.strip().lower()
        user.email = normalized_email
        with sqlite_db.connection() as conn:
            conn.execute(
                """
                INSERT INTO users (
                    id, email, full_name, role, status,
                    token_quota, tokens_used, rpm_limit, concurrent_limit, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    email = excluded.email,
                    full_name = excluded.full_name,
                    role = excluded.role,
                    status = excluded.status,
                    token_quota = excluded.token_quota,
                    tokens_used = excluded.tokens_used,
                    rpm_limit = excluded.rpm_limit,
                    concurrent_limit = excluded.concurrent_limit
                """,
                (
                    user.id,
                    normalized_email,
                    user.full_name,
                    user.role,
                    user.status,
                    user.token_quota,
                    user.tokens_used,
                    user.rpm_limit,
                    user.concurrent_limit,
                    user.created_at,
                ),
            )
        self._store.users[user.id] = user.model_dump()
        return user

    def update_status(self, user_id: str, new_status: str) -> Optional[UserResponseDTO]:
        """Kullanıcının yalnızca hesap durumunu (active/suspended) tekil 'users' tablosunda günceller."""
        with sqlite_db.connection() as conn:
            conn.execute(
                "UPDATE users SET status = ? WHERE id = ?",
                (new_status, user_id),
            )
        return self.get_by_id(user_id)

    def increment_tokens_used(self, user_id: str, token_delta: int) -> None:
        """Kullanıcının harcadığı toplam token sayısını SQLite tablosunda artırır."""
        delta = max(0, token_delta)
        with sqlite_db.connection() as conn:
            conn.execute(
                "UPDATE users SET tokens_used = tokens_used + ? WHERE id = ?",
                (delta, user_id),
            )
