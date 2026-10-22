import asyncio
import json
from datetime import datetime, timezone
from typing import List, Optional
from app.dtos.admin_dto import UsageLogDTO, GatewaySettingsDTO
from app.dtos.image_dto import CachedImageDTO
from app.repositories.state_store import InMemoryStateStore
from app.repositories.sqlite_db import sqlite_db


class UsageRepository:
    """Kullanım logları (SQLite kalıcı depolama), hız sınırları (RPM) ve eşzamanlı istek sayaçları veri erişim katmanı."""

    def __init__(self, state_store: InMemoryStateStore) -> None:
        self._store = state_store

    def list_recent_logs(self, limit: int = 50) -> List[UsageLogDTO]:
        """En güncel kullanım kayıtlarını SQLite tablosundan belirtilen limitle döner."""
        with sqlite_db.connection() as conn:
            rows = conn.execute(
                """
                SELECT request_id, conversation_id, user_email, model, session_id,
                       prompt_tokens, completion_tokens, total_tokens, is_stream,
                       latency_ms, ttft_ms, status, upstream_provider,
                       prompt_preview, response_preview, attachment_names_json,
                       error_detail, created_at
                FROM usage_logs
                ORDER BY logged_at_iso DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        results: List[UsageLogDTO] = []
        for r in rows:
            try:
                att_names = json.loads(r["attachment_names_json"] or "[]")
            except Exception:
                att_names = []
            results.append(
                UsageLogDTO(
                    request_id=r["request_id"],
                    conversation_id=r["conversation_id"] or "",
                    user_email=r["user_email"],
                    model=r["model"],
                    session_id=r["session_id"],
                    prompt_tokens=r["prompt_tokens"],
                    completion_tokens=r["completion_tokens"],
                    total_tokens=r["total_tokens"],
                    is_stream=bool(r["is_stream"]),
                    latency_ms=r["latency_ms"],
                    ttft_ms=r["ttft_ms"],
                    status=r["status"],
                    upstream_provider=r["upstream_provider"],
                    prompt_preview=r["prompt_preview"],
                    response_preview=r["response_preview"],
                    attachment_names=att_names,
                    error_detail=r["error_detail"],
                    created_at=r["created_at"],
                )
            )
        return results

    def insert_log(self, log: UsageLogDTO, user_id: str = "sys_usr_01") -> UsageLogDTO:
        """Yeni kullanım kaydını SQLite veritabanına ve kullanıcı token harcama defterine yazar."""
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.isoformat()
        usage_date = now_iso[:10]
        with sqlite_db.connection() as conn:
            urow = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
            effective_uid = urow["id"] if urow else "sys_usr_01"

            conn.execute(
                """
                INSERT OR REPLACE INTO usage_logs (
                    request_id, conversation_id, user_id, user_email, model, session_id,
                    prompt_tokens, completion_tokens, total_tokens, is_stream,
                    latency_ms, ttft_ms, status, upstream_provider,
                    prompt_preview, response_preview, attachment_names_json,
                    error_detail, created_at, logged_at_iso
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    log.request_id,
                    log.conversation_id,
                    effective_uid,
                    log.user_email,
                    log.model,
                    log.session_id,
                    log.prompt_tokens,
                    log.completion_tokens,
                    log.total_tokens,
                    1 if log.is_stream else 0,
                    log.latency_ms,
                    log.ttft_ms,
                    log.status,
                    log.upstream_provider,
                    log.prompt_preview,
                    log.response_preview,
                    json.dumps(log.attachment_names, ensure_ascii=False),
                    log.error_detail,
                    log.created_at,
                    now_iso,
                ),
            )

            crow = conn.execute(
                "SELECT source FROM chat_conversations WHERE id = ?",
                (log.conversation_id or "",),
            ).fetchone()
            source = crow["source"] if crow and crow["source"] in ("studio", "api") else ("studio" if log.conversation_id else "api")

            alloc = conn.execute(
                """
                SELECT id FROM user_token_allocations
                WHERE user_id = ? AND start_date <= ? AND end_date >= ?
                ORDER BY start_date ASC, created_at ASC
                LIMIT 1
                """,
                (effective_uid, usage_date, usage_date),
            ).fetchone()
            alloc_id = alloc["id"] if alloc else None

            conn.execute(
                """
                INSERT OR REPLACE INTO user_token_usages (
                    id, user_id, allocation_id, conversation_id, request_id,
                    source, model_id, prompt_tokens, completion_tokens, total_tokens,
                    usage_date, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"utu_{log.request_id}",
                    effective_uid,
                    alloc_id,
                    log.conversation_id or "",
                    log.request_id,
                    source,
                    log.model,
                    int(log.prompt_tokens or 0),
                    int(log.completion_tokens or 0),
                    int(log.total_tokens or 0),
                    usage_date,
                    now_iso,
                ),
            )
            total_spent = conn.execute(
                "SELECT COALESCE(SUM(total_tokens), 0) FROM user_token_usages WHERE user_id = ?",
                (effective_uid,),
            ).fetchone()[0]
            conn.execute(
                "UPDATE users SET tokens_used = ? WHERE id = ?",
                (int(total_spent), effective_uid),
            )
        return log

    def clear_logs(self) -> None:
        """Tüm kullanım kayıtlarını SQLite tablosundan temizler."""
        with sqlite_db.connection() as conn:
            conn.execute("DELETE FROM usage_logs")
        self._store.usage_logs.clear()

    def increment_minute_rate_counter(self, rate_key: str) -> int:
        """Dakikalık istek sayacını 1 artırır ve güncel değeri döner."""
        count = self._store.rate_counters.get(rate_key, 0) + 1
        self._store.rate_counters[rate_key] = count
        return count

    def increment_active_requests(self, user_id: str) -> int:
        """Kullanıcının aktif eşzamanlı istek sayacını 1 artırır."""
        count = self._store.active_requests.get(user_id, 0) + 1
        self._store.active_requests[user_id] = count
        return count

    def decrement_active_requests(self, user_id: str) -> int:
        """Kullanıcının aktif eşzamanlı istek sayacını 1 azaltır."""
        current = self._store.active_requests.get(user_id, 1)
        updated = max(0, current - 1)
        self._store.active_requests[user_id] = updated
        return updated


class SettingsRepository:
    """Sistem genel ayarları veri erişim katmanı."""

    def __init__(self, state_store: InMemoryStateStore) -> None:
        self._store = state_store

    def get_settings(self) -> GatewaySettingsDTO:
        """Mevcut sistem ayarlarını DTO olarak döner."""
        return GatewaySettingsDTO(**self._store.settings)

    def update_settings(self, updated: GatewaySettingsDTO) -> GatewaySettingsDTO:
        """Sistem ayarlarını günceller ve yeni durumu döner."""
        self._store.settings.update(updated.model_dump())
        return GatewaySettingsDTO(**self._store.settings)


class StreamChannelRepository:
    """Aktif SSE akış kanallarını (job_id -> asyncio.Queue) yöneten veri katmanı."""

    def __init__(self, state_store: InMemoryStateStore) -> None:
        self._store = state_store

    def create_channel(self, job_id: str) -> asyncio.Queue:
        """Belirtilen iş ID'si için yeni bir asenkron kuyruk oluşturur."""
        queue: asyncio.Queue = asyncio.Queue()
        self._store.stream_channels[job_id] = queue
        return queue

    def get_channel(self, job_id: str) -> Optional[asyncio.Queue]:
        """İş ID'sine ait asenkron kuyruğu döner."""
        return self._store.stream_channels.get(job_id)

    def remove_channel(self, job_id: str) -> None:
        """Tamamlanan işin kuyruğunu bellekten temizler."""
        self._store.stream_channels.pop(job_id, None)


class ImageCacheRepository:
    """Üretilen görsellerin bellek içi önbellek erişim katmanı."""

    def __init__(self, state_store: InMemoryStateStore) -> None:
        self._store = state_store

    def save(self, image: CachedImageDTO) -> None:
        """Üretilen görseli önbelleğe kaydeder."""
        self._store.generated_images_cache[image.image_id] = {
            "bytes": image.raw_bytes,
            "media_type": image.media_type,
            "prompt": image.prompt,
            "model": image.model,
            "width": image.width,
            "height": image.height,
            "seed": image.seed,
        }

    def get_by_id(self, image_id: str) -> Optional[CachedImageDTO]:
        """Önbellekteki görseli ID ile bulur."""
        entry = self._store.generated_images_cache.get(image_id)
        if not entry:
            return None
        return CachedImageDTO(
            image_id=image_id,
            raw_bytes=entry["bytes"],
            media_type=entry["media_type"],
            prompt=entry["prompt"],
            model=entry["model"],
            width=entry["width"],
            height=entry["height"],
            seed=entry["seed"],
        )
