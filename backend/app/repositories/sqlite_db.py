from __future__ import annotations
import hashlib
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Iterator, Optional

try:
    from app.core.config import settings
    DEFAULT_SQLITE_DB_PATH: Path = settings.sqlite_db_path
except Exception:
    DEFAULT_SQLITE_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "gateway.db"

try:
    from app.core.security import hash_api_key
except Exception:
    def hash_api_key(raw_key: str) -> str:
        return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '',
    password_plain TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    token_quota INTEGER NOT NULL DEFAULT 100000,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    rpm_limit INTEGER NOT NULL DEFAULT 15,
    concurrent_limit INTEGER NOT NULL DEFAULT 2,
    last_login_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    raw_preview TEXT,
    key_hash TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    model_id TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'studio',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    total_messages INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    request_id TEXT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    model_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    ttft_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'success',
    error_detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_message_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_kind TEXT NOT NULL DEFAULT 'document',
    mime_type TEXT NOT NULL DEFAULT '',
    file_size INTEGER NOT NULL DEFAULT 0,
    estimated_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_logs (
    request_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    model TEXT NOT NULL,
    session_id TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    is_stream INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    ttft_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'success',
    upstream_provider TEXT NOT NULL DEFAULT '',
    prompt_preview TEXT NOT NULL DEFAULT '',
    response_preview TEXT NOT NULL DEFAULT '',
    attachment_names_json TEXT NOT NULL DEFAULT '[]',
    error_detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    logged_at_iso TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
    ON chat_conversations(user_id, is_pinned DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_source_updated
    ON chat_conversations(source, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON chat_messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_messages_user_model
    ON chat_messages(user_id, model_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachments_message
    ON chat_message_attachments(message_id);

CREATE INDEX IF NOT EXISTS idx_attachments_conversation
    ON chat_message_attachments(conversation_id);

CREATE INDEX IF NOT EXISTS idx_usage_logs_logged_at
    ON usage_logs(logged_at_iso DESC);

CREATE TABLE IF NOT EXISTS user_token_allocations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    token_amount INTEGER NOT NULL DEFAULT 100000,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_user_token_allocations_user
    ON user_token_allocations(user_id, start_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS user_token_usages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    allocation_id TEXT REFERENCES user_token_allocations(id) ON DELETE SET NULL,
    conversation_id TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'studio',
    model_id TEXT NOT NULL DEFAULT 'gpt-4o',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    usage_date TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_token_usages_user_date
    ON user_token_usages(user_id, usage_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS pool_metrics_snapshots (
    id TEXT PRIMARY KEY,
    timestamp_iso TEXT NOT NULL,
    time_label TEXT NOT NULL,
    total_sessions INTEGER NOT NULL DEFAULT 0,
    active_busy_sessions INTEGER NOT NULL DEFAULT 0,
    idle_sessions INTEGER NOT NULL DEFAULT 0,
    warm_sessions INTEGER NOT NULL DEFAULT 0,
    dynamic_sessions INTEGER NOT NULL DEFAULT 0,
    max_capacity INTEGER NOT NULL DEFAULT 16,
    active_proxies INTEGER NOT NULL DEFAULT 0,
    cooldown_proxies INTEGER NOT NULL DEFAULT 0,
    avg_proxy_latency_ms INTEGER NOT NULL DEFAULT 0,
    requests_per_min INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pool_metrics_snapshots_ts
    ON pool_metrics_snapshots(timestamp_iso DESC);

CREATE TABLE IF NOT EXISTS pool_scaling_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    proxy_endpoint TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    total_sessions_after INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pool_scaling_events_created
    ON pool_scaling_events(created_at DESC);

CREATE TABLE IF NOT EXISTS roles_permissions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    code TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_system INTEGER NOT NULL DEFAULT 0,
    is_admin_panel_allowed INTEGER NOT NULL DEFAULT 1,
    permissions_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS smtp_settings (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    host TEXT NOT NULL DEFAULT 'smtp.gmail.com',
    port INTEGER NOT NULL DEFAULT 587,
    username TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    encryption TEXT NOT NULL DEFAULT 'tls',
    from_name TEXT NOT NULL DEFAULT 'ThinkPort API',
    from_email TEXT NOT NULL DEFAULT 'noreply@gateway.local',
    reply_to TEXT NOT NULL DEFAULT '',
    reset_url_base TEXT NOT NULL DEFAULT 'http://localhost:5173/reset-password',
    reset_token_expiry_min INTEGER NOT NULL DEFAULT 30,
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS password_reset_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    user_name TEXT NOT NULL DEFAULT '',
    reset_token TEXT NOT NULL,
    temp_password TEXT NOT NULL DEFAULT '',
    delivery_method TEXT NOT NULL DEFAULT 'smtp',
    status TEXT NOT NULL DEFAULT 'sent',
    detail TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_logs_created
    ON password_reset_logs(created_at DESC);
"""


class SqliteDatabaseManager:
    """
    SQLite veritabanı bağlantı, şema oluşturma (DDL) ve başlangıç (seed) yönetimi.
    WAL (Write-Ahead Logging) modu ve Yabancı Anahtar (Foreign Key) bütünlüğü ile çalışır.
    Tüm kullanıcılar (Sistem Yöneticileri + API/Kota Kullanıcıları) tek bir `users` tablosunda tutulur.
    """

    def __init__(self, db_path: Path | None = None) -> None:
        self._db_path = db_path or DEFAULT_SQLITE_DB_PATH
        self._lock = threading.RLock()
        self._initialize_database()

    @property
    def db_path(self) -> Path:
        """Veritabanı dosya yolunu döner."""
        return self._db_path

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        """Thread-safe, Row fabrikalı ve WAL modlu SQLite bağlantı bağlamı döner."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self._db_path), timeout=30.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        try:
            with self._lock:
                yield conn
                conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _initialize_database(self) -> None:
        """Tabloları, tekil kullanıcı migrasyonunu, benzersizlik indekslerini ve başlangıç (seed) verilerini oluşturur."""
        with self.connection() as conn:
            conn.executescript(SCHEMA_SQL)
            self._migrate_to_single_users_table(conn)
            self._seed_default_users_if_empty(conn)
            self._seed_default_api_keys_if_empty(conn)
            self._seed_default_conversations_if_empty(conn)
            self._seed_default_pool_telemetry_if_empty(conn)
            self._seed_default_roles_and_smtp_if_empty(conn)

    @staticmethod
    def _migrate_to_single_users_table(conn: sqlite3.Connection) -> None:
        """
        Tüm kullanıcıları tek bir `users` tablosunda birleştirir, eski `system_users` tablosunu
        varsa tekil `users` tablosuna aktararak kaldırır ve büyük/küçük harf duyarsız (LOWER(TRIM(email)))
        UNIQUE indeks ile mükerrer kayıt korumasını veritabanı seviyesinde garanti altına alır.
        """
        cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(users)").fetchall()
        }
        if "password_hash" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''")
        if "password_plain" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN password_plain TEXT NOT NULL DEFAULT ''")
        if "last_login_at" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN last_login_at TEXT")

        alloc_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(user_token_allocations)").fetchall()
        }
        if "description" not in alloc_cols:
            conn.execute("ALTER TABLE user_token_allocations ADD COLUMN description TEXT NOT NULL DEFAULT ''")
        if "updated_at" not in alloc_cols:
            conn.execute("ALTER TABLE user_token_allocations ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")

        has_legacy_sys = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='system_users'"
        ).fetchone()
        if has_legacy_sys:
            sys_rows = conn.execute(
                "SELECT id, full_name, email, password_hash, password_plain, role, status, last_login_at, created_at FROM system_users"
            ).fetchall()
            for sr in sys_rows:
                email_clean = (sr["email"] or "").strip().lower()
                if not email_clean:
                    continue
                existing = conn.execute(
                    "SELECT id FROM users WHERE LOWER(TRIM(email)) = ? OR id = ?",
                    (email_clean, sr["id"]),
                ).fetchone()
                if existing:
                    conn.execute(
                        """
                        UPDATE users
                        SET email = ?,
                            full_name = ?,
                            password_hash = CASE WHEN ? != '' THEN ? ELSE password_hash END,
                            password_plain = CASE WHEN ? != '' THEN ? ELSE password_plain END,
                            role = ?,
                            status = ?,
                            last_login_at = COALESCE(?, last_login_at)
                        WHERE id = ?
                        """,
                        (
                            email_clean,
                            sr["full_name"],
                            sr["password_hash"] or "",
                            sr["password_hash"] or "",
                            sr["password_plain"] or "",
                            sr["password_plain"] or "",
                            sr["role"] or "Sistem Yöneticisi",
                            sr["status"] or "active",
                            sr["last_login_at"],
                            existing["id"],
                        ),
                    )
                else:
                    conn.execute(
                        """
                        INSERT INTO users (
                            id, email, full_name, password_hash, password_plain,
                            role, status, token_quota, tokens_used, rpm_limit, concurrent_limit,
                            last_login_at, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1000000, 0, 60, 5, ?, ?)
                        """,
                        (
                            sr["id"],
                            email_clean,
                            sr["full_name"],
                            sr["password_hash"] or "",
                            sr["password_plain"] or "190300",
                            sr["role"] or "Sistem Yöneticisi",
                            sr["status"] or "active",
                            sr["last_login_at"],
                            sr["created_at"] or "2026-01-01T00:00:00+00:00",
                        ),
                    )
            conn.execute("DROP TABLE IF EXISTS system_users")

        # Olası büyük/küçük harf mükerrer kayıtlarını temizle ve normalize et
        all_users = conn.execute(
            "SELECT id, email FROM users ORDER BY CASE WHEN id LIKE 'sys_usr_%' THEN 0 ELSE 1 END, created_at ASC"
        ).fetchall()
        seen_emails: set[str] = set()
        for u in all_users:
            norm_email = (u["email"] or "").strip().lower()
            if norm_email in seen_emails:
                conn.execute("DELETE FROM users WHERE id = ?", (u["id"],))
            else:
                seen_emails.add(norm_email)
                if u["email"] != norm_email:
                    conn.execute("UPDATE users SET email = ? WHERE id = ?", (norm_email, u["id"]))

        # Veritabanı seviyesinde büyük/küçük harf ve boşluk duyarsız UNIQUE indeks
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(TRIM(email)))"
        )

        # Kalıcı olarak kaldırılan eski örnek kullanıcılar (dev@company.com, test@startup.io) ve ilişkili kayıtları temizle
        conn.execute(
            "DELETE FROM api_keys WHERE id IN ('key_demo_01', 'key_demo_02') OR user_id IN ('usr_01', 'usr_02')"
        )
        conn.execute(
            "DELETE FROM chat_message_attachments WHERE id = 'att_seed_01' OR conversation_id IN ('conv_seed_studio_01', 'conv_seed_api_02') OR user_id IN ('usr_01', 'usr_02')"
        )
        conn.execute(
            "DELETE FROM chat_messages WHERE id IN ('msg_seed_01', 'msg_seed_02', 'msg_seed_03', 'msg_seed_04') OR conversation_id IN ('conv_seed_studio_01', 'conv_seed_api_02') OR user_id IN ('usr_01', 'usr_02')"
        )
        conn.execute(
            "DELETE FROM chat_conversations WHERE id IN ('conv_seed_studio_01', 'conv_seed_api_02') OR user_id IN ('usr_01', 'usr_02')"
        )
        conn.execute(
            "DELETE FROM usage_logs WHERE user_id IN ('usr_01', 'usr_02') OR LOWER(TRIM(user_email)) IN ('dev@company.com', 'dev@compy.com', 'test@startup.io')"
        )
        conn.execute(
            "DELETE FROM users WHERE id IN ('usr_01', 'usr_02') OR LOWER(TRIM(email)) IN ('dev@company.com', 'dev@compy.com', 'test@startup.io')"
        )

    @staticmethod
    def sync_system_users_to_users(conn: sqlite3.Connection) -> None:
        """Geriye dönük uyumluluk kancası: tüm kullanıcılar artık tek `users` tablosundadır."""
        return None

    @staticmethod
    def _seed_default_users_if_empty(conn: sqlite3.Connection) -> None:
        """Tekil `users` tablosuna varsayılan Sistem Yöneticisi kaydını ekler."""
        now_iso = datetime.now(timezone.utc).isoformat()
        default_pwd = "190300"
        pwd_hash = hashlib.sha256(default_pwd.encode("utf-8")).hexdigest()

        # Varsayılan Sistem Yöneticisi (Serhat Akalın) her zaman mevcut olmalı
        existing_sys = conn.execute(
            "SELECT id, password_plain FROM users WHERE LOWER(TRIM(email)) = 'akalinserhat@gmail.com' OR id = 'sys_usr_01'"
        ).fetchone()
        if not existing_sys:
            conn.execute(
                """
                INSERT INTO users (
                    id, email, full_name, password_hash, password_plain,
                    role, status, token_quota, tokens_used, rpm_limit, concurrent_limit,
                    last_login_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "sys_usr_01",
                    "akalinserhat@gmail.com",
                    "Serhat Akalın",
                    pwd_hash,
                    default_pwd,
                    "Sistem Yöneticisi",
                    "active",
                    1000000,
                    0,
                    60,
                    5,
                    now_iso,
                    "2026-01-01T00:00:00+00:00",
                ),
            )
        elif not existing_sys["password_plain"]:
            conn.execute(
                "UPDATE users SET password_hash = ?, password_plain = ?, role = 'Sistem Yöneticisi' WHERE id = ?",
                (pwd_hash, default_pwd, existing_sys["id"]),
            )

        # Henüz hiç token tanımı olmayan mevcut kullanıcılar için varsayılan dönem token tanımını oluştur
        user_rows = conn.execute(
            "SELECT id, token_quota, created_at FROM users"
        ).fetchall()
        for u in user_rows:
            alloc_count = conn.execute(
                "SELECT COUNT(1) FROM user_token_allocations WHERE user_id = ?",
                (u["id"],),
            ).fetchone()[0]
            if alloc_count == 0:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO user_token_allocations (
                        id, user_id, start_date, end_date, token_amount, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"tok_init_{u['id']}",
                        u["id"],
                        "2026-01-01",
                        "2026-12-31",
                        int(u["token_quota"] or 1000000),
                        u["created_at"] or now_iso,
                    ),
                )

    @staticmethod
    def _seed_default_api_keys_if_empty(conn: sqlite3.Connection) -> None:
        """Örnek API anahtarı otomatik eklemesi devre dışı bırakıldı."""
        return None

    @staticmethod
    def _seed_default_conversations_if_empty(conn: sqlite3.Connection) -> None:
        """Örnek sohbet oturumu otomatik eklemesi devre dışı bırakıldı."""
        return None

    @staticmethod
    def _seed_default_pool_telemetry_if_empty(conn: sqlite3.Connection) -> None:
        """Bağlantı havuzu zaman serisi ve ölçeklenme olay tabloları boşsa örnek başlangıç verilerini yükler."""
        snap_count = conn.execute("SELECT COUNT(1) FROM pool_metrics_snapshots").fetchone()[0]
        now = datetime.now(timezone.utc)
        if snap_count == 0:
            # Son 60 dakikalık 5'er dakika aralıklı 12 zaman serisi noktası
            series = [
                # (dakika_once, total, busy, idle, warm, dynamic, active_prx, cooldown_prx, latency_ms, rpm)
                (55, 9, 2, 7, 9, 0, 15, 1, 74, 18),
                (50, 9, 4, 5, 9, 0, 15, 1, 72, 26),
                (45, 10, 6, 4, 9, 1, 15, 1, 76, 38),
                (40, 12, 9, 3, 9, 3, 15, 1, 81, 52),
                (35, 14, 11, 3, 9, 5, 14, 2, 85, 64),
                (30, 13, 8, 5, 9, 4, 15, 1, 79, 47),
                (25, 11, 5, 6, 9, 2, 15, 1, 75, 34),
                (20, 9, 3, 6, 9, 0, 15, 1, 71, 24),
                (15, 11, 7, 4, 9, 2, 15, 1, 77, 44),
                (10, 12, 8, 4, 9, 3, 15, 1, 78, 49),
                (5, 10, 4, 6, 9, 1, 15, 1, 73, 31),
                (0, 9, 1, 8, 9, 0, 15, 1, 72, 22),
            ]
            rows = []
            for idx, (mins_ago, total, busy, idle, warm, dyn, act_p, cool_p, lat, rpm) in enumerate(series):
                ts = now - timedelta(minutes=mins_ago)
                local_label = (ts + timedelta(hours=3)).strftime("%H:%M")
                rows.append(
                    (
                        f"snap_seed_{idx + 1:02d}",
                        ts.isoformat(),
                        local_label,
                        total,
                        busy,
                        idle,
                        warm,
                        dyn,
                        16,
                        act_p,
                        cool_p,
                        lat,
                        rpm,
                    )
                )
            conn.executemany(
                """
                INSERT INTO pool_metrics_snapshots (
                    id, timestamp_iso, time_label, total_sessions,
                    active_busy_sessions, idle_sessions, warm_sessions, dynamic_sessions,
                    max_capacity, active_proxies, cooldown_proxies,
                    avg_proxy_latency_ms, requests_per_min
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )

        evt_count = conn.execute("SELECT COUNT(1) FROM pool_scaling_events").fetchone()[0]
        if evt_count == 0:
            events = [
                (
                    "evt_seed_01",
                    "autoscale_up",
                    "sess-gpt-dyn-a4f1",
                    "chatgpt-web",
                    "88.255.140.28:1080 (TR-Mobile)",
                    "Yüksek eşzamanlı istek yükü nedeniyle dinamik oturum otomatik başlatıldı.",
                    11,
                    (now - timedelta(minutes=38)).isoformat(),
                ),
                (
                    "evt_seed_02",
                    "autoscale_up",
                    "sess-claude-dyn-9c20",
                    "claude-web",
                    "138.201.92.14:1080 (DE-Isp)",
                    "Claude 3.5 Sonnet kuyruğu için dinamik oturum ölçeklendirildi.",
                    12,
                    (now - timedelta(minutes=34)).isoformat(),
                ),
                (
                    "evt_seed_03",
                    "proxy_cooldown",
                    "",
                    "deepseek-web",
                    "91.93.120.44:8080 (NL-Res)",
                    "Ardışık bağlantı zaman aşımı sonrası proxy düğümü soğutmaya (cooldown) alındı.",
                    12,
                    (now - timedelta(minutes=26)).isoformat(),
                ),
                (
                    "evt_seed_04",
                    "autoscale_down",
                    "sess-gpt-dyn-a4f1",
                    "chatgpt-web",
                    "88.255.140.28:1080 (TR-Mobile)",
                    "Boşta kalma süresi (Idle TTL: 300s) dolduğu için dinamik oturum kapatıldı.",
                    10,
                    (now - timedelta(minutes=14)).isoformat(),
                ),
                (
                    "evt_seed_05",
                    "autoscale_down",
                    "sess-claude-dyn-9c20",
                    "claude-web",
                    "138.201.92.14:1080 (DE-Isp)",
                    "Boşta kalma süresi (Idle TTL: 300s) dolduğu için dinamik oturum kapatıldı.",
                    9,
                    (now - timedelta(minutes=6)).isoformat(),
                ),
            ]
            conn.executemany(
                """
                INSERT INTO pool_scaling_events (
                    id, event_type, session_id, provider,
                    proxy_endpoint, detail, total_sessions_after, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                events,
            )

    @staticmethod
    def _seed_default_roles_and_smtp_if_empty(conn: sqlite3.Connection) -> None:
        import json as _json
        now_iso = datetime.now(timezone.utc).isoformat()
        all_perms_json = _json.dumps([
            "overview.view",
            "chat.use",
            "chat.manage_all",
            "users.view",
            "users.manage",
            "tokens.manage",
            "apikeys.view",
            "apikeys.manage",
            "nodes.view",
            "nodes.manage",
            "settings.manage",
        ])
        role_cnt = conn.execute("SELECT COUNT(1) FROM roles_permissions").fetchone()[0]
        if role_cnt == 0:
            default_roles = [
                (
                    "role_admin",
                    "Admin",
                    "admin",
                    "Tüm modüllere, kullanıcılara, kota tanımlarına, bağlantı havuzuna, SMTP ve sistem ayarlarına tam yönetim yetkisi (Tam Yetkili - Silinemez).",
                    1,
                    1,
                    all_perms_json,
                    now_iso,
                    now_iso,
                ),
                (
                    "role_ops_admin",
                    "Operasyon Yöneticisi",
                    "ops_manager",
                    "Bağlantı havuzu, tarayıcı oturumları, proxy listesi, kullanıcı kotaları ve sohbet stüdyosu yönetimi.",
                    1,
                    1,
                    _json.dumps([
                        "overview.view",
                        "chat.use",
                        "chat.manage_all",
                        "users.view",
                        "users.manage",
                        "tokens.manage",
                        "apikeys.view",
                        "nodes.view",
                        "nodes.manage",
                    ]),
                    now_iso,
                    now_iso,
                ),
                (
                    "role_sec_admin",
                    "Güvenlik Yöneticisi",
                    "security_admin",
                    "API anahtarları, erişim denetimi, güvenlik politikaları ve kullanıcı durum yönetimi.",
                    1,
                    1,
                    _json.dumps([
                        "overview.view",
                        "chat.use",
                        "users.view",
                        "apikeys.view",
                        "apikeys.manage",
                        "nodes.view",
                        "settings.manage",
                    ]),
                    now_iso,
                    now_iso,
                ),
                (
                    "role_readonly",
                    "Salt Okunur Yönetici",
                    "viewer",
                    "Gösterge paneli, istatistikler, kullanıcı ve oturum kayıtlarını salt okunur görüntüleme yetkisi.",
                    1,
                    1,
                    _json.dumps([
                        "overview.view",
                        "chat.use",
                        "users.view",
                        "apikeys.view",
                        "nodes.view",
                    ]),
                    now_iso,
                    now_iso,
                ),
                (
                    "role_api_user",
                    "API / Kota Kullanıcısı",
                    "user",
                    "Standart geliştirici ve SaaS müşteri hesabı; AI Sohbet Stüdyosu ve /v1 API uç noktası kullanım yetkisi.",
                    1,
                    0,
                    _json.dumps([
                        "chat.use",
                    ]),
                    now_iso,
                    now_iso,
                ),
            ]
            conn.executemany(
                """
                INSERT INTO roles_permissions (
                    id, name, code, description, is_system, is_admin_panel_allowed,
                    permissions_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                default_roles,
            )
        else:
            # Mevcut veritabanında Admin rolünün her zaman tam yetkili ve silinemez olarak bulunmasını garanti et
            admin_by_name = conn.execute(
                "SELECT id FROM roles_permissions WHERE LOWER(TRIM(name)) = 'admin' OR id = 'role_admin' LIMIT 1"
            ).fetchone()
            if admin_by_name:
                conn.execute(
                    """
                    UPDATE roles_permissions
                    SET name = 'Admin',
                        code = 'admin',
                        description = 'Tüm modüllere, kullanıcılara, kota tanımlarına, bağlantı havuzuna, SMTP ve sistem ayarlarına tam yönetim yetkisi (Tam Yetkili - Silinemez).',
                        is_system = 1,
                        is_admin_panel_allowed = 1,
                        permissions_json = ?
                    WHERE id = ?
                    """,
                    (all_perms_json, admin_by_name["id"]),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO roles_permissions (
                        id, name, code, description, is_system, is_admin_panel_allowed,
                        permissions_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)
                    """,
                    (
                        "role_admin",
                        "Admin",
                        "admin",
                        "Tüm modüllere, kullanıcılara, kota tanımlarına, bağlantı havuzuna, SMTP ve sistem ayarlarına tam yönetim yetkisi (Tam Yetkili - Silinemez).",
                        all_perms_json,
                        now_iso,
                        now_iso,
                    ),
                )

        smtp_exists = conn.execute("SELECT id FROM smtp_settings WHERE id = 'default'").fetchone()
        if not smtp_exists:
            conn.execute(
                """
                INSERT INTO smtp_settings (
                    id, enabled, host, port, username, password, encryption,
                    from_name, from_email, reply_to, reset_url_base, reset_token_expiry_min, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "default",
                    1,
                    "smtp.gmail.com",
                    587,
                    "akalinserhat@gmail.com",
                    "",
                    "tls",
                    "ThinkPort API",
                    "akalinserhat@gmail.com",
                    "akalinserhat@gmail.com",
                    "http://localhost:5173/reset-password",
                    30,
                    now_iso,
                ),
            )


sqlite_db = SqliteDatabaseManager()
