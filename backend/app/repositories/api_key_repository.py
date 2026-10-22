from typing import List, Optional
from app.dtos.api_key_dto import ApiKeyRecordDTO, ApiKeyPublicDTO
from app.repositories.state_store import InMemoryStateStore
from app.repositories.sqlite_db import sqlite_db


class ApiKeyRepository:
    """API Anahtarı veri erişim katmanı (SQLite kalıcı depolama)."""

    def __init__(self, state_store: InMemoryStateStore) -> None:
        self._store = state_store

    def list_public(self) -> List[ApiKeyPublicDTO]:
        """Admin görünümü için tüm API anahtarlarını SQLite tablosundan güvenli DTO olarak döner."""
        with sqlite_db.connection() as conn:
            rows = conn.execute(
                """
                SELECT id, user_id, name, key_prefix, raw_preview, is_active, expires_at, created_at
                FROM api_keys
                ORDER BY created_at DESC
                """
            ).fetchall()
        return [
            ApiKeyPublicDTO(
                id=r["id"],
                user_id=r["user_id"],
                name=r["name"],
                key_prefix=r["key_prefix"],
                raw_preview=r["raw_preview"],
                is_active=bool(r["is_active"]),
                expires_at=r["expires_at"],
                created_at=r["created_at"],
            )
            for r in rows
        ]

    def get_by_hash(self, key_hash: str) -> Optional[ApiKeyRecordDTO]:
        """SHA-256 hash değerine göre API anahtarı kaydını SQLite tablosundan bulur."""
        with sqlite_db.connection() as conn:
            row = conn.execute(
                """
                SELECT id, user_id, name, key_prefix, raw_preview,
                       key_hash, is_active, expires_at, created_at
                FROM api_keys
                WHERE key_hash = ?
                """,
                (key_hash,),
            ).fetchone()
        if not row:
            return None
        data = dict(row)
        data["is_active"] = bool(data["is_active"])
        return ApiKeyRecordDTO(**data)

    def save(self, record: ApiKeyRecordDTO) -> ApiKeyRecordDTO:
        """Yeni API anahtarı kaydını SQLite veritabanına yazar."""
        with sqlite_db.connection() as conn:
            conn.execute(
                """
                INSERT INTO api_keys (
                    id, user_id, name, key_prefix, raw_preview,
                    key_hash, is_active, expires_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(key_hash) DO UPDATE SET
                    name = excluded.name,
                    is_active = excluded.is_active,
                    expires_at = excluded.expires_at
                """,
                (
                    record.id,
                    record.user_id,
                    record.name,
                    record.key_prefix,
                    record.raw_preview,
                    record.key_hash,
                    1 if record.is_active else 0,
                    record.expires_at,
                    record.created_at,
                ),
            )
        return record

    def deactivate_by_id(self, key_id: str) -> bool:
        """Belirtilen ID'ye sahip API anahtarını SQLite tablosunda pasif (iptal) duruma getirir."""
        with sqlite_db.connection() as conn:
            cursor = conn.execute(
                "UPDATE api_keys SET is_active = 0 WHERE id = ?",
                (key_id,),
            )
            return cursor.rowcount > 0
