"""
ThinkPort AI Gateway - PostgreSQL (pgvector) Veritabanı Bağlantı, Şema ve Başlangıç Verisi Yöneticisi.
Doğrudan PostgreSQL (thinkport_db) üzerinde ilişkisel veri bütünlüğünü ve pgvector RAG tablolarını yönetir.
"""
from __future__ import annotations
import hashlib
import importlib.util
import os
import threading
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Iterator, List, Optional

try:
    from app.core.config import settings
    PG_HOST: str = settings.postgres_host
    PG_PORT: int = settings.postgres_port
    PG_USER: str = settings.postgres_user
    PG_PASSWORD: str = settings.postgres_password
    PG_DB: str = settings.postgres_db
    PG_RAG_USER: str = getattr(settings, "webakus_postgres_user", "postgres")
    PG_RAG_PASSWORD: str = getattr(settings, "webakus_postgres_password", "postgres")
    PG_RAG_DB: str = getattr(settings, "webakus_postgres_db", "webakus_db")
except Exception:
    PG_HOST = os.getenv("POSTGRES_HOST", "127.0.0.1")
    PG_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
    PG_USER = os.getenv("POSTGRES_USER", "gateway")
    PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "gateway_secret_password")
    PG_DB = os.getenv("POSTGRES_DB", "thinkport_db")
    PG_RAG_USER = os.getenv("WEBAKUS_POSTGRES_USER", "postgres")
    PG_RAG_PASSWORD = os.getenv("WEBAKUS_POSTGRES_PASSWORD", "postgres")
    PG_RAG_DB = os.getenv("WEBAKUS_POSTGRES_DB", "webakus_db")

try:
    from app.repositories.postgres_driver import PgWireConnection
except Exception:
    _pg_drv_path = Path(__file__).resolve().parent / "postgres_driver.py"
    _pg_spec = importlib.util.spec_from_file_location("postgres_driver", str(_pg_drv_path))
    assert _pg_spec and _pg_spec.loader
    _pg_mod = importlib.util.module_from_spec(_pg_spec)
    _pg_spec.loader.exec_module(_pg_mod)
    PgWireConnection = _pg_mod.PgWireConnection

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
    is_deleted INTEGER NOT NULL DEFAULT 0,
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
    thinking_content TEXT NOT NULL DEFAULT '',
    tool_calls_json TEXT NOT NULL DEFAULT '',
    raw_payload_json TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS api_protocols (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    request_script TEXT NOT NULL DEFAULT '',
    response_script TEXT NOT NULL DEFAULT '',
    models_script TEXT NOT NULL DEFAULT '',
    is_system INTEGER NOT NULL DEFAULT 0,
    connected_providers INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ai_agents (
    id INTEGER PRIMARY KEY,
    uygulama_id TEXT NOT NULL DEFAULT 'THINKPORT_CORE',
    ad TEXT NOT NULL,
    kod TEXT NOT NULL,
    aciklama TEXT NOT NULL DEFAULT '',
    rol TEXT NOT NULL DEFAULT 'Genel AI Asistanı',
    ikon TEXT NOT NULL DEFAULT 'Bot',
    renk TEXT NOT NULL DEFAULT '#6366f1',
    kapsam INTEGER NOT NULL DEFAULT 1,
    ust_ajan_id INTEGER,
    kurallar_json TEXT NOT NULL DEFAULT '[]',
    sistem_istemi TEXT NOT NULL DEFAULT '',
    hizli_istekler_json TEXT NOT NULL DEFAULT '[]',
    ai_saglayici_id INTEGER,
    model_adi TEXT NOT NULL DEFAULT 'gpt-4o',
    alternatif_modeller_json TEXT NOT NULL DEFAULT '[]',
    sicaklik REAL NOT NULL DEFAULT 0.7,
    max_tokens INTEGER NOT NULL DEFAULT 2048,
    yanit_sentezi_modu INTEGER NOT NULL DEFAULT 0,
    secili_arac_kodlari_json TEXT NOT NULL DEFAULT '[]',
    hafiza_aktif_mi INTEGER NOT NULL DEFAULT 1,
    hafiza_max_kayit INTEGER NOT NULL DEFAULT 1000,
    hafiza_saklama_gun INTEGER NOT NULL DEFAULT 30,
    hafiza_arama_top_k INTEGER NOT NULL DEFAULT 5,
    gozlemci_aktif_mi INTEGER NOT NULL DEFAULT 1,
    aktif_mi INTEGER NOT NULL DEFAULT 1,
    sistem_kaydi_mi INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ''
);
"""

PG_VECTOR_RAG_SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS rag_session_memory (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL DEFAULT '',
    turn_index INTEGER NOT NULL DEFAULT 0,
    role TEXT NOT NULL DEFAULT 'assistant',
    tool_name TEXT NOT NULL DEFAULT '',
    extracted_count INTEGER NOT NULL DEFAULT 0,
    last_item_key TEXT NOT NULL DEFAULT '',
    cut_item_key TEXT NOT NULL DEFAULT '',
    is_complete INTEGER NOT NULL DEFAULT 1,
    content TEXT NOT NULL DEFAULT '',
    embedding vector(384),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rag_memory_conv_turn
    ON rag_session_memory(conversation_id, turn_index ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL DEFAULT '',
    memory_type TEXT NOT NULL DEFAULT 'interaction',
    role TEXT NOT NULL DEFAULT 'assistant',
    prompt_text TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    importance REAL NOT NULL DEFAULT 0.5,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    access_count INTEGER NOT NULL DEFAULT 0,
    token_count INTEGER NOT NULL DEFAULT 0,
    embedding vector(384),
    expires_at TEXT,
    last_accessed_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_app_agent
    ON agent_memories(app_id, agent_id, is_pinned DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memories_embedding_hnsw
    ON agent_memories USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_agent_memories_content_trgm
    ON agent_memories USING gin (content gin_trgm_ops);
"""

WEBAKUS_RAG_SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS rag_cloud_documents (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL DEFAULT 'WEBAKUS_ERP',
    firma_id INTEGER NOT NULL DEFAULT 0,
    user_id TEXT NOT NULL DEFAULT '',
    bulut_dosya_id INTEGER NOT NULL DEFAULT 0,
    cloud_file_id TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT 'google',
    belge_turu TEXT NOT NULL DEFAULT 'Genel',
    belge_id INTEGER NOT NULL DEFAULT 0,
    belge_no TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT '',
    file_size INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL DEFAULT '',
    page_count INTEGER NOT NULL DEFAULT 1,
    total_chunks INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    char_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'indexed',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rag_cloud_docs_lookup
    ON rag_cloud_documents(app_id, firma_id, bulut_dosya_id);

CREATE INDEX IF NOT EXISTS idx_rag_cloud_docs_cloud_id
    ON rag_cloud_documents(cloud_file_id);

CREATE TABLE IF NOT EXISTS rag_document_chunks (
    id TEXT PRIMARY KEY,
    cloud_doc_id TEXT REFERENCES rag_cloud_documents(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL DEFAULT 'WEBAKUS_ERP',
    firma_id INTEGER NOT NULL DEFAULT 0,
    bulut_dosya_id INTEGER NOT NULL DEFAULT 0,
    cloud_file_id TEXT NOT NULL DEFAULT '',
    conversation_id TEXT NOT NULL DEFAULT '',
    message_id TEXT,
    file_name TEXT NOT NULL,
    section_title TEXT NOT NULL DEFAULT '',
    page_number INTEGER NOT NULL DEFAULT 1,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    embedding vector(384),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_conv_order
    ON rag_document_chunks(conversation_id, file_name, chunk_index ASC);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding_hnsw
    ON rag_document_chunks USING hnsw (embedding vector_cosine_ops);
"""


class PostgresDatabaseManager:
    """
    PostgreSQL (pgvector) birincil veritabanı bağlantı, şema oluşturma (DDL) ve
    başlangıç (seed) yöneticisi.
    Tüm kullanıcılar (Sistem Yöneticileri + API/Kota Kullanıcıları) tek bir `users` tablosunda tutulur.
    Bulut belge RAG tabloları (`rag_cloud_documents` ve `rag_document_chunks`) ise doğrudan
    `webakus_db` veritabanında yönetilir.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._pg_available: bool = True
        self._initialize_database()

    @property
    def is_postgres_active(self) -> bool:
        """Aktif bağlantının PostgreSQL (thinkport_db) üzerinde çalışıp çalışmadığını döner."""
        return bool(self._pg_available)

    def _open_pg_connection(self) -> PgWireConnection:
        return PgWireConnection(
            host=PG_HOST,
            port=PG_PORT,
            user=PG_USER,
            password=PG_PASSWORD,
            database=PG_DB,
            timeout=30.0,
        )

    def _open_rag_pg_connection(self) -> PgWireConnection:
        """Bulut RAG tablolarının (`rag_cloud_documents`, `rag_document_chunks`) bulunduğu `webakus_db` bağlantısını açar."""
        try:
            return PgWireConnection(
                host=PG_HOST,
                port=PG_PORT,
                user=PG_RAG_USER,
                password=PG_RAG_PASSWORD,
                database=PG_RAG_DB,
                timeout=30.0,
            )
        except Exception:
            return PgWireConnection(
                host=PG_HOST,
                port=PG_PORT,
                user=PG_USER,
                password=PG_PASSWORD,
                database=PG_RAG_DB,
                timeout=30.0,
            )

    @contextmanager
    def connection(self) -> Iterator[PgWireConnection]:
        """Thread-safe PostgreSQL (thinkport_db) bağlantı bağlamı döner."""
        with self._lock:
            pg_conn = self._open_pg_connection()
            self._pg_available = True
            try:
                pg_conn.begin()
                yield pg_conn
                pg_conn.commit()
            except Exception:
                pg_conn.rollback()
                raise
            finally:
                pg_conn.close()

    @contextmanager
    def rag_connection(self) -> Iterator[PgWireConnection]:
        """Thread-safe PostgreSQL (`webakus_db` RAG tabloları) bağlantı bağlamı döner."""
        with self._lock:
            pg_conn = self._open_rag_pg_connection()
            try:
                pg_conn.begin()
                yield pg_conn
                pg_conn.commit()
            except Exception:
                pg_conn.rollback()
                raise
            finally:
                pg_conn.close()

    def _initialize_database(self) -> None:
        """Tabloları, `webakus_db` pgvector RAG şemasını ve başlangıç verilerini oluşturur."""
        with self.connection() as conn:
            conn.executescript(SCHEMA_SQL)
            conn.executescript(PG_VECTOR_RAG_SCHEMA_SQL)
            self._migrate_to_single_users_table(conn)
            self._migrate_agent_and_memory_columns(conn)
            self._seed_default_users_if_empty(conn)
            self._seed_default_api_keys_if_empty(conn)
            self._seed_default_conversations_if_empty(conn)
            self._seed_default_pool_telemetry_if_empty(conn)
            self._seed_default_roles_and_smtp_if_empty(conn)
            self._seed_default_protocols_if_empty(conn)
            self._seed_default_agents_if_empty(conn)

        with self.rag_connection() as rag_conn:
            rag_conn.executescript(WEBAKUS_RAG_SCHEMA_SQL)
            self._migrate_rag_cloud_columns(rag_conn)

        self._migrate_rag_tables_from_thinkport_to_webakus()

        try:
            from app.core.logger import gateway_logger
            with self.connection() as conn:
                conv_cnt = conn.execute("SELECT COUNT(1) AS c FROM chat_conversations").fetchone()["c"]
                msg_cnt = conn.execute("SELECT COUNT(1) AS c FROM chat_messages").fetchone()["c"]
                att_cnt = conn.execute("SELECT COUNT(1) AS c FROM chat_message_attachments").fetchone()["c"]
                ulog_cnt = conn.execute("SELECT COUNT(1) AS c FROM usage_logs").fetchone()["c"]
                usr_cnt = conn.execute("SELECT COUNT(1) AS c FROM users").fetchone()["c"]
            with self.rag_connection() as rag_conn:
                rag_doc_cnt = rag_conn.execute("SELECT COUNT(1) AS c FROM rag_cloud_documents").fetchone()["c"]
                rag_chk_cnt = rag_conn.execute("SELECT COUNT(1) AS c FROM rag_document_chunks").fetchone()["c"]
            gateway_logger.info(
                f"PostgreSQL (pgvector) '{PG_DB}' & RAG '{PG_RAG_DB}' aktif | users={usr_cnt} | conversations={conv_cnt} | messages={msg_cnt} | attachments={att_cnt} | webakus_rag_docs={rag_doc_cnt} | webakus_rag_chunks={rag_chk_cnt} | usage_logs={ulog_cnt}"
            )
        except Exception:
            pass

    def _migrate_rag_tables_from_thinkport_to_webakus(self) -> None:
        """
        Eğer `thinkport_db` içerisinde eski `rag_cloud_documents` veya `rag_document_chunks`
        tabloları varsa, tüm verilerini `webakus_db` içerisine aktarır ve `thinkport_db`
        içerisindeki bu iki tabloyu kaldırır.
        """
        old_docs: List[Any] = []
        old_chunks: List[Any] = []
        has_old_tables = False

        with self.connection() as tp_conn:
            tbl_rows = tp_conn.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name IN ('rag_cloud_documents', 'rag_document_chunks')
                """
            ).fetchall()
            found_tables = {r["table_name"] for r in tbl_rows}
            if found_tables:
                has_old_tables = True
                if "rag_cloud_documents" in found_tables:
                    old_docs = tp_conn.execute(
                        """
                        SELECT id, app_id, firma_id, user_id, bulut_dosya_id, cloud_file_id,
                               provider, belge_turu, belge_id, belge_no, file_name, mime_type,
                               file_size, content_hash, page_count, total_chunks, total_tokens,
                               char_count, status, created_at, updated_at
                        FROM rag_cloud_documents
                        """
                    ).fetchall()
                if "rag_document_chunks" in found_tables:
                    old_chunks = tp_conn.execute(
                        """
                        SELECT id, cloud_doc_id, app_id, firma_id, bulut_dosya_id, cloud_file_id,
                               conversation_id, message_id, file_name, section_title,
                               page_number, chunk_index, content, token_count,
                               embedding::text AS embedding_str, metadata_json, created_at
                        FROM rag_document_chunks
                        """
                    ).fetchall()

        if not has_old_tables:
            return

        with self.rag_connection() as rag_conn:
            for d in old_docs:
                rag_conn.execute(
                    """
                    INSERT OR IGNORE INTO rag_cloud_documents (
                        id, app_id, firma_id, user_id, bulut_dosya_id, cloud_file_id,
                        provider, belge_turu, belge_id, belge_no, file_name, mime_type,
                        file_size, content_hash, page_count, total_chunks, total_tokens,
                        char_count, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        d["id"],
                        d["app_id"],
                        d["firma_id"],
                        d["user_id"],
                        d["bulut_dosya_id"],
                        d["cloud_file_id"],
                        d["provider"],
                        d["belge_turu"],
                        d["belge_id"],
                        d["belge_no"],
                        d["file_name"],
                        d["mime_type"],
                        d["file_size"],
                        d["content_hash"],
                        d["page_count"],
                        d["total_chunks"],
                        d["total_tokens"],
                        d["char_count"],
                        d["status"],
                        d["created_at"],
                        d["updated_at"],
                    ),
                )

            for c in old_chunks:
                rag_conn.execute(
                    """
                    INSERT OR IGNORE INTO rag_document_chunks (
                        id, cloud_doc_id, app_id, firma_id, bulut_dosya_id, cloud_file_id,
                        conversation_id, message_id, file_name, section_title,
                        page_number, chunk_index, content, token_count,
                        embedding, metadata_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        c["id"],
                        c["cloud_doc_id"],
                        c["app_id"],
                        c["firma_id"],
                        c["bulut_dosya_id"],
                        c["cloud_file_id"],
                        c["conversation_id"] or "",
                        c["message_id"],
                        c["file_name"],
                        c["section_title"] or "",
                        c["page_number"],
                        c["chunk_index"],
                        c["content"],
                        c["token_count"],
                        c["embedding_str"],
                        c["metadata_json"] or "{}",
                        c["created_at"],
                    ),
                )

        with self.connection() as tp_conn:
            tp_conn.execute("DROP TABLE IF EXISTS rag_document_chunks CASCADE")
            tp_conn.execute("DROP TABLE IF EXISTS rag_cloud_documents CASCADE")

    @staticmethod
    def _migrate_rag_cloud_columns(conn: PgWireConnection) -> None:
        """
        `webakus_db` üzerindeki `rag_document_chunks` ve `rag_cloud_documents` tablolarının
        sütun ve indeks şemasını doğrular; `rag_cloud_documents` üzerinde eski tek-parça
        `full_text` sütunu varsa kaldırır.
        """
        doc_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(rag_cloud_documents)").fetchall()
        }
        if "full_text" in doc_cols:
            conn.execute("ALTER TABLE rag_cloud_documents DROP COLUMN IF EXISTS full_text")

        chunk_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(rag_document_chunks)").fetchall()
        }
        if "cloud_doc_id" not in chunk_cols:
            conn.execute(
                "ALTER TABLE rag_document_chunks ADD COLUMN cloud_doc_id TEXT REFERENCES rag_cloud_documents(id) ON DELETE CASCADE"
            )
        if "app_id" not in chunk_cols:
            conn.execute(
                "ALTER TABLE rag_document_chunks ADD COLUMN app_id TEXT NOT NULL DEFAULT 'WEBAKUS_ERP'"
            )
        if "firma_id" not in chunk_cols:
            conn.execute(
                "ALTER TABLE rag_document_chunks ADD COLUMN firma_id INTEGER NOT NULL DEFAULT 0"
            )
        if "bulut_dosya_id" not in chunk_cols:
            conn.execute(
                "ALTER TABLE rag_document_chunks ADD COLUMN bulut_dosya_id INTEGER NOT NULL DEFAULT 0"
            )
        if "cloud_file_id" not in chunk_cols:
            conn.execute(
                "ALTER TABLE rag_document_chunks ADD COLUMN cloud_file_id TEXT NOT NULL DEFAULT ''"
            )
        if "section_title" not in chunk_cols:
            conn.execute(
                "ALTER TABLE rag_document_chunks ADD COLUMN section_title TEXT NOT NULL DEFAULT ''"
            )

        conn.execute(
            "ALTER TABLE rag_document_chunks DROP CONSTRAINT IF EXISTS rag_document_chunks_conversation_id_fkey"
        )
        conn.execute(
            "ALTER TABLE rag_document_chunks ALTER COLUMN conversation_id SET DEFAULT ''"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_rag_chunks_cloud_doc ON rag_document_chunks(cloud_doc_id, chunk_index ASC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_rag_chunks_bulut_id ON rag_document_chunks(bulut_dosya_id, chunk_index ASC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_rag_chunks_content_trgm ON rag_document_chunks USING gin (content gin_trgm_ops)"
        )

    @staticmethod
    def _migrate_agent_and_memory_columns(conn: PgWireConnection) -> None:
        """
        `ai_agents` ve `chat_conversations` tablolarına `(app_id, agent_id)` birleşik kimlik
        ve pgvector hafıza sınırı sütunlarını ekler.
        """
        agent_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(ai_agents)").fetchall()
        }
        if "uygulama_id" not in agent_cols:
            conn.execute("ALTER TABLE ai_agents ADD COLUMN uygulama_id TEXT NOT NULL DEFAULT 'THINKPORT_CORE'")
        if "hafiza_aktif_mi" not in agent_cols:
            conn.execute("ALTER TABLE ai_agents ADD COLUMN hafiza_aktif_mi INTEGER NOT NULL DEFAULT 1")
        if "hafiza_max_kayit" not in agent_cols:
            conn.execute("ALTER TABLE ai_agents ADD COLUMN hafiza_max_kayit INTEGER NOT NULL DEFAULT 1000")
        if "hafiza_saklama_gun" not in agent_cols:
            conn.execute("ALTER TABLE ai_agents ADD COLUMN hafiza_saklama_gun INTEGER NOT NULL DEFAULT 30")
        if "hafiza_arama_top_k" not in agent_cols:
            conn.execute("ALTER TABLE ai_agents ADD COLUMN hafiza_arama_top_k INTEGER NOT NULL DEFAULT 5")
        if "gozlemci_aktif_mi" not in agent_cols:
            conn.execute("ALTER TABLE ai_agents ADD COLUMN gozlemci_aktif_mi INTEGER NOT NULL DEFAULT 1")

        # Varsayılan Webakus ERP ajanının uygulama_id değerini WEBAKUS_ERP olarak güncelle
        conn.execute(
            "UPDATE ai_agents SET uygulama_id = 'WEBAKUS_ERP' WHERE kod = 'WEBAKUS_ERP_ASISTANI' AND (uygulama_id = '' OR uygulama_id = 'THINKPORT_CORE')"
        )

        conv_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(chat_conversations)").fetchall()
        }
        if "app_id" not in conv_cols:
            conn.execute("ALTER TABLE chat_conversations ADD COLUMN app_id TEXT NOT NULL DEFAULT ''")
        if "agent_id" not in conv_cols:
            conn.execute("ALTER TABLE chat_conversations ADD COLUMN agent_id TEXT NOT NULL DEFAULT ''")

    @staticmethod
    def _migrate_to_single_users_table(conn: PgWireConnection) -> None:
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

        conv_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(chat_conversations)").fetchall()
        }
        if "is_deleted" not in conv_cols:
            conn.execute("ALTER TABLE chat_conversations ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")

        msg_cols = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(chat_messages)").fetchall()
        }
        if "thinking_content" not in msg_cols:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN thinking_content TEXT NOT NULL DEFAULT ''")
        if "tool_calls_json" not in msg_cols:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN tool_calls_json TEXT NOT NULL DEFAULT ''")
        if "raw_payload_json" not in msg_cols:
            conn.execute("ALTER TABLE chat_messages ADD COLUMN raw_payload_json TEXT NOT NULL DEFAULT ''")

        # Mevcut mesaj kayıtlarındaki <think>...</think> bloklarını, araç çağrılarını ve telemetri özetlerini geri doldur (Backfill)
        import json as _json
        import re as _re
        legacy_msgs = conn.execute(
            """
            SELECT m.id, m.conversation_id, m.request_id, m.role, m.model_id, m.provider,
                   m.content, m.thinking_content, m.tool_calls_json, m.raw_payload_json,
                   m.prompt_tokens, m.completion_tokens, m.total_tokens, m.latency_ms, m.ttft_ms,
                   m.status, m.error_detail, m.created_at,
                   c.system_prompt, c.source
            FROM chat_messages m
            LEFT JOIN chat_conversations c ON c.id = m.conversation_id
            WHERE m.thinking_content = '' AND m.raw_payload_json = ''
            """
        ).fetchall()
        for lm in legacy_msgs:
            raw_c = lm["content"] or ""
            think_parts = _re.findall(r"<think(?:ing)?[^>]*>([\s\S]*?)</think(?:ing)?>", raw_c, flags=_re.IGNORECASE)
            extracted_think = "\n\n".join(p.strip() for p in think_parts if p.strip())
            tc_json_str = lm["tool_calls_json"] or ""
            tc_match = _re.match(r"^\[Araç Çağrısı:\s*(.+?)\]$", raw_c.strip())
            if tc_match and not tc_json_str:
                fn_names = [n.strip() for n in tc_match.group(1).split(",") if n.strip()]
                tc_json_str = _json.dumps(
                    [
                        {
                            "id": f"call_legacy_{idx + 1}",
                            "type": "function",
                            "function": {
                                "name": fn,
                                "arguments": "{}",
                            },
                        }
                        for idx, fn in enumerate(fn_names)
                    ],
                    ensure_ascii=False,
                )
            atts = conn.execute(
                "SELECT file_name, file_kind, mime_type, file_size, estimated_tokens FROM chat_message_attachments WHERE message_id = ?",
                (lm["id"],),
            ).fetchall()
            att_list_dicts = [dict(a) for a in atts]
            ulog = None
            if lm["request_id"]:
                ulog = conn.execute(
                    "SELECT session_id, is_stream, upstream_provider, prompt_preview, response_preview FROM usage_logs WHERE request_id = ?",
                    (lm["request_id"],),
                ).fetchone()
            direction = "OUTGOING_REQUEST" if lm["role"] in ("user", "system", "developer", "tool") else "INCOMING_RESPONSE"
            raw_payload = {
                "direction": direction,
                "request_id": lm["request_id"] or "",
                "conversation_id": lm["conversation_id"],
                "source": lm["source"] or "studio",
                "role": lm["role"],
                "model": lm["model_id"],
                "provider": lm["provider"] or (ulog["upstream_provider"] if ulog else ""),
                "session_id": ulog["session_id"] if ulog else "",
                "is_stream": bool(ulog["is_stream"]) if ulog else True,
                "system_prompt": lm["system_prompt"] or "",
                "attachments": att_list_dicts,
                "content_length_chars": len(raw_c),
                "content": raw_c,
                "thinking_extracted": extracted_think,
                "tool_calls": _json.loads(tc_json_str) if tc_json_str else [],
                "metrics": {
                    "prompt_tokens": lm["prompt_tokens"],
                    "completion_tokens": lm["completion_tokens"],
                    "total_tokens": lm["total_tokens"],
                    "latency_ms": lm["latency_ms"],
                    "ttft_ms": lm["ttft_ms"],
                    "status": lm["status"],
                    "error_detail": lm["error_detail"] or "",
                },
                "timestamp": lm["created_at"],
            }
            trace_lines = []
            if lm["role"] in ("user", "system", "developer", "tool"):
                trace_lines.append(f"📤 [GIDEN LLM İSTEĞİ / OUTGOING PAYLOAD] (Rol: {lm['role']} | Model: {lm['model_id']} | Kaynak: {lm['source'] or 'studio'})")
                if lm["request_id"]:
                    trace_lines.append(f"• İstek ID (Request ID): {lm['request_id']}")
                if lm["system_prompt"]:
                    trace_lines.append(f"• Sistem Yönergesi (System Prompt): {lm['system_prompt']}")
                if att_list_dicts:
                    att_summary = ", ".join(
                        f"{a['file_name']} ({a['file_kind']}, {a['file_size']} bayt, ~{a['estimated_tokens']} token)"
                        for a in att_list_dicts
                    )
                    trace_lines.append(f"• Ekli Dosyalar ({len(att_list_dicts)} adet): {att_summary}")
                trace_lines.append(f"• Gönderilen Karakter Sayısı: {len(raw_c)} karakter | Girdi Token: {lm['prompt_tokens']} token")
            else:
                if extracted_think:
                    trace_lines.append("🧠 [LLM DÜŞÜNCE SÜRECİ / INTERNAL REASONING]")
                    trace_lines.append(extracted_think)
                    trace_lines.append("---")
                trace_lines.append(
                    f"📥 [GELEN LLM YANITI / INCOMING PAYLOAD] (Model: {lm['model_id']} | Sağlayıcı: {lm['provider'] or (ulog['upstream_provider'] if ulog else 'gateway')})"
                )
                if lm["request_id"]:
                    trace_lines.append(f"• İstek ID: {lm['request_id']}" + (f" | Oturum: {ulog['session_id']}" if ulog and ulog["session_id"] else ""))
                trace_lines.append(
                    f"• Telemetri: Girdi={lm['prompt_tokens']} tok | Çıktı={lm['completion_tokens']} tok | Toplam={lm['total_tokens']} tok | TTFT={lm['ttft_ms']} ms | Süre={lm['latency_ms']} ms | Durum={lm['status']}"
                )
                trace_lines.append(f"• Ham Yanıt Uzunluğu: {len(raw_c)} karakter")
                if tc_json_str:
                    trace_lines.append(f"• Tetiklenen Araç Çağrıları (tool_calls): {tc_json_str}")
                if lm["error_detail"]:
                    trace_lines.append(f"• Hata Detayı: {lm['error_detail']}")

            final_thinking = "\n".join(trace_lines)
            conn.execute(
                """
                UPDATE chat_messages
                SET thinking_content = ?,
                    tool_calls_json = ?,
                    raw_payload_json = ?
                WHERE id = ?
                """,
                (
                    final_thinking,
                    tc_json_str,
                    _json.dumps(raw_payload, ensure_ascii=False),
                    lm["id"],
                ),
            )

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
    def sync_system_users_to_users(conn: PgWireConnection) -> None:
        """Geriye dönük uyumluluk kancası: tüm kullanıcılar artık tek `users` tablosundadır."""
        return None

    @staticmethod
    def _seed_default_users_if_empty(conn: PgWireConnection) -> None:
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
    def _seed_default_api_keys_if_empty(conn: PgWireConnection) -> None:
        """Örnek API anahtarı otomatik eklemesi devre dışı bırakıldı."""
        return None

    @staticmethod
    def _seed_default_conversations_if_empty(conn: PgWireConnection) -> None:
        """Örnek sohbet oturumu otomatik eklemesi devre dışı bırakıldı."""
        return None

    @staticmethod
    def _seed_default_pool_telemetry_if_empty(conn: PgWireConnection) -> None:
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
    def _seed_default_roles_and_smtp_if_empty(conn: PgWireConnection) -> None:
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

    @staticmethod
    def _seed_default_protocols_if_empty(conn: PgWireConnection) -> None:
        """Varsayılan dinamik AI API protokollerini (OpenAI, Anthropic, Gemini, Ollama) tohumlar."""
        now_iso = datetime.now(timezone.utc).isoformat()
        existing = conn.execute("SELECT COUNT(1) AS cnt FROM api_protocols").fetchone()
        if existing and int(existing["cnt"] or 0) > 0:
            return

        default_protocols = [
            (
                "proto_openai",
                "OpenAI REST API Uyumluluğu",
                "OpenAI, DeepSeek, Groq, Ollama ve vLLM gibi standart /v1/chat/completions uç noktası kullanan sistemler için evrensel adaptör.",
                """function buildRequest(context) {
    var endpoint = context.endpoint || '/chat/completions';
    var headers = {
        'Content-Type': 'application/json'
    };
    if (context.apiKey) {
        headers['Authorization'] = 'Bearer ' + context.apiKey;
    }
    var body = {
        model: context.model,
        messages: context.messages,
        temperature: context.temperature !== undefined ? context.temperature : 0.7,
        max_tokens: context.maxTokens || 2048
    };
    return {
        url: context.baseUrl + endpoint,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    };
}""",
                """function parseResponse(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    var content = '';
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        content = data.choices[0].message.content || '';
    }
    var promptTokens = 0;
    var completionTokens = 0;
    if (data.usage) {
        promptTokens = data.usage.prompt_tokens || 0;
        completionTokens = data.usage.completion_tokens || 0;
    }
    return {
        content: content,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        totalTokens: promptTokens + completionTokens
    };
}""",
                """function parseModels(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    var models = [];
    if (data && data.data && Array.isArray(data.data)) {
        for (var i = 0; i < data.data.length; i++) {
            if (data.data[i] && data.data[i].id) {
                models.push(data.data[i].id);
            }
        }
    }
    return models;
}""",
                1,
                2,
                now_iso,
                now_iso,
            ),
            (
                "proto_anthropic",
                "Anthropic Claude REST API",
                "Anthropic Claude modelleri için /v1/messages formatı ve x-api-key başlığı kullanan resmi protokol adaptörü.",
                """function buildRequest(context) {
    var endpoint = context.endpoint || '/messages';
    var headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
    };
    if (context.apiKey) {
        headers['x-api-key'] = context.apiKey;
    }
    var systemPrompt = '';
    var filteredMessages = [];
    if (context.messages && Array.isArray(context.messages)) {
        for (var i = 0; i < context.messages.length; i++) {
            var msg = context.messages[i];
            if (msg.role === 'system') {
                systemPrompt = (systemPrompt ? systemPrompt + '\\n' : '') + msg.content;
            } else {
                filteredMessages.push(msg);
            }
        }
    }
    var body = {
        model: context.model,
        messages: filteredMessages,
        max_tokens: context.maxTokens || 2048,
        temperature: context.temperature !== undefined ? context.temperature : 0.7
    };
    if (systemPrompt) {
        body.system = systemPrompt;
    }
    return {
        url: context.baseUrl + endpoint,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    };
}""",
                """function parseResponse(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    var content = '';
    if (data.content && Array.isArray(data.content)) {
        for (var i = 0; i < data.content.length; i++) {
            if (data.content[i].type === 'text') {
                content += data.content[i].text || '';
            }
        }
    }
    var promptTokens = 0;
    var completionTokens = 0;
    if (data.usage) {
        promptTokens = data.usage.input_tokens || 0;
        completionTokens = data.usage.output_tokens || 0;
    }
    return {
        content: content,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        totalTokens: promptTokens + completionTokens
    };
}""",
                """function parseModels(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    if (data && data.data && Array.isArray(data.data)) {
        return data.data.map(function(m) { return m.id; });
    }
    return ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'];
}""",
                1,
                1,
                now_iso,
                now_iso,
            ),
            (
                "proto_gemini",
                "Google Gemini REST API",
                "Google Gemini v1beta REST API (models:generateContent) JSON şema adaptörü.",
                """function buildRequest(context) {
    var endpoint = '/models/' + encodeURIComponent(context.model) + ':generateContent';
    var url = context.baseUrl + endpoint + '?key=' + (context.apiKey || '');
    var headers = {
        'Content-Type': 'application/json'
    };
    var contents = [];
    var systemInstruction = null;
    if (context.messages && Array.isArray(context.messages)) {
        for (var i = 0; i < context.messages.length; i++) {
            var msg = context.messages[i];
            if (msg.role === 'system') {
                systemInstruction = { parts: [{ text: msg.content }] };
            } else {
                var role = msg.role === 'assistant' ? 'model' : 'user';
                contents.push({ role: role, parts: [{ text: msg.content }] });
            }
        }
    }
    var body = {
        contents: contents,
        generationConfig: {
            temperature: context.temperature !== undefined ? context.temperature : 0.7,
            maxOutputTokens: context.maxTokens || 2048
        }
    };
    if (systemInstruction) {
        body.systemInstruction = systemInstruction;
    }
    return {
        url: url,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    };
}""",
                """function parseResponse(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    var content = '';
    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts) {
        var parts = data.candidates[0].content.parts;
        for (var i = 0; i < parts.length; i++) {
            content += parts[i].text || '';
        }
    }
    var promptTokens = 0;
    var completionTokens = 0;
    if (data.usageMetadata) {
        promptTokens = data.usageMetadata.promptTokenCount || 0;
        completionTokens = data.usageMetadata.candidatesTokenCount || 0;
    }
    return {
        content: content,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        totalTokens: promptTokens + completionTokens
    };
}""",
                """function parseModels(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    if (data && data.models && Array.isArray(data.models)) {
        return data.models.map(function(m) { return (m.name || '').replace('models/', ''); });
    }
    return ['gemini-2.5-pro', 'gemini-2.0-flash'];
}""",
                1,
                1,
                now_iso,
                now_iso,
            ),
            (
                "proto_ollama",
                "Ollama Yerel Motor API",
                "Yerel sunucuda çalışan Ollama (/api/chat ve /api/tags) açık kaynaklı LLM modelleri için doğrudan protokol adaptörü.",
                """function buildRequest(context) {
    var endpoint = context.endpoint || '/api/chat';
    var headers = {
        'Content-Type': 'application/json'
    };
    var body = {
        model: context.model,
        messages: context.messages,
        stream: false,
        options: {
            temperature: context.temperature !== undefined ? context.temperature : 0.7,
            num_predict: context.maxTokens || 2048
        }
    };
    return {
        url: context.baseUrl + endpoint,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    };
}""",
                """function parseResponse(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    var content = (data.message && data.message.content) ? data.message.content : (data.response || '');
    var promptTokens = data.prompt_eval_count || 0;
    var completionTokens = data.eval_count || 0;
    return {
        content: content,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        totalTokens: promptTokens + completionTokens
    };
}""",
                """function parseModels(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    if (data && data.models && Array.isArray(data.models)) {
        return data.models.map(function(m) { return m.name; });
    }
    return [];
}""",
                1,
                1,
                now_iso,
                now_iso,
            ),
        ]

        conn.executemany(
            """
            INSERT INTO api_protocols (
                id, name, description, request_script, response_script, models_script,
                is_system, connected_providers, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            default_protocols,
        )

    @staticmethod
    def _seed_default_agents_if_empty(conn: PgWireConnection) -> None:
        """
        Varsayılan AI Ajanlarını (Sohbet & Yanıt Gözlemci Ajanı, ThinkPort Genel AI Asistanı ve Webakus ERP Uzman Ajanı)
        yalnızca tablo boşsa tohumlar. Mevcut kayıtların sistem istemlerini veya kurallarını asla ezmez.
        """
        import json as _json

        now_iso = datetime.now(timezone.utc).isoformat()

        observer_rules = [
            {
                "id": "KIMLIK",
                "baslik": "Gözlemci Ajan Kimliği ve Sanal Excel Tablosu Denetim Misyonu",
                "aciklama": "Sohbet, sanal Excel tablosu çıkarımı ve araç çağrısı bütünlüğü denetçisi",
                "icerik": (
                    "Sen ThinkPort AI Gateway ve Webakus Ajan ekosisteminde çalışan otonom Sohbet & Yanıt Gözlemci Ajanısın (Observer LLM). "
                    "Görevin, ekli PDF/belge içerisindeki kullanıcının talep ettiği hedef tabloları (örn: 'Tekil Fiyat Farkları' ve '... Fırsat Modelleri') "
                    "önce kendi hafızanda 1. sütunu (Ürün Grubu) atılmış `UrunKodu;Fiyat` formatında 2 sütunlu eksiksiz bir Sanal Excel/CSV Tablosuna dönüştürmek, "
                    "ardından birincil LLM'in şu ana kadar ürettiği kayıtları bu sanal Excel tablosuyla satır satır karşılaştırarak eksik kalan satırları "
                    "`observer_continue_generation` aracının `continuation_prompt` alanı içinde hazır `UrunKodu;Fiyat` Excel/CSV listesi olarak birincil modele sunmaktır."
                ),
                "sira": 1,
                "durum": "Yeni",
                "kilitliMi": True,
                "orijinalBaseIcerik": None,
            },
            {
                "id": "TETIKLEME_KRITERLERI",
                "baslik": "Sanal Excel Tablosu Kapsamı ve Kesinti Tespit Kriterleri",
                "aciklama": "Hangi durumlarda otomatik tamamlama başlatılacağı ve ne zaman durulacağı",
                "icerik": (
                    "Hafızanda Sanal Excel/CSV Tablosunu (`UrunKodu;Fiyat`) oluştururken ve denetlerken şu kuralları uygula: "
                    "1) YALNIZCA HEDEF TABLOLARI AL, KAPSAM DIŞI TABLOLARI VE DEVAM SAYFALARINI HARİÇ TUT: Yalnızca kullanıcının isteminde talep ettiği hedef tabloları ('Tekil Fiyat Farkları' ve '... Fırsat Modelleri') sanal Excel tablosuna dahil et. Belgede hariç tutulan bir tablo başlığı (örn. 'Aile Bakanlığı Modelleri') başladığı andan itibaren, o başlığın altındaki satırlar VE yeni bir hedef tablo başlığı görülmediği sürece sonraki sayfalarda başlık tekrarlanmadan devam eden TÜM satırlar kesinlikle sanal Excel tablosunun dışındadır. "
                    "2) ÇOK SAYFALI HEDEF TABLOLARI SON SATIRINA KADAR BİRLEŞTİR: Birinci hedef tablonun devam sayfasındaki en son satırları (ikinci hedef tablo başlığının hemen üstündeki satırlar) ve ikinci hedef tablonun devam sayfasındaki en son satırları (kapsam dışı 'Aile Bakanlığı Modelleri' başlığının hemen üstündeki son satıra kadar olan bölüm) sanal Excel tablosuna eksiksiz dahil edilir. "
                    "3) ÇELİŞKİSİZ TAMAMLANMA KURALI: Eğer oluşturduğun sanal Excel tablosundaki tüm hedef satırlar birincil model tarafından çıkarılmışsa (eklenecek yeni bir hedef satır kalmamışsa) KESİNLİKLE `is_complete=true` ve `continuation_prompt=\"\"` döndür! Eklenecek yeni satır yokken asla 'şu kayıtta dur / fazla kayıt var' diyerek `is_complete=false` döndürme!"
                ),
                "sira": 2,
                "durum": "Yeni",
                "kilitliMi": False,
                "orijinalBaseIcerik": None,
            },
            {
                "id": "DEVAM_ISTEMI_KURALLARI",
                "baslik": "Eksik Satırları Hazır Excel/CSV Tablosu (UrunKodu;Fiyat) Olarak Verme Kuralları",
                "aciklama": "Kesilen noktadan sıfır tekrarla ve hazır sanal Excel/CSV tablosuyla devam ettirme yönergesi",
                "icerik": (
                    "Önceki yanıt token sınırı nedeniyle yarıda kaldığında veya hedef tablolarda eksik satır tespit ettiğinde (`is_complete=false`): "
                    "1) EKSİK KALAN TÜM SATIRLARI `UrunKodu;Fiyat` EXCEL/CSV FORMATINDA LİSTELE: `continuation_prompt` içerisine genel bir açıklama yazmak yerine, hafızandaki Sanal Excel Tablosunda henüz çıkarılmamış olan TÜM kalan satırları (varsa 1. tablo sonunda atlanan satırlar ve son çıkarılan kayıttan hedef tablonun en son satırına kadar kalan tüm satırlar dahil) her satırda `UrunKodu;Fiyat` olacak şekilde eksiksiz bir Excel/CSV tablosu olarak yaz! "
                    "2) SADECE SALT ÜRÜN KODU KURALI: Hazırladığın `UrunKodu;Fiyat` tablosunda 1. sütundaki Ürün Grubu / kategori adını (fırın, davlumbaz, bulaşık, kurutma, ocak, derin dondurucu, kapasite veya grup sınıfı vb.) KESİNLİKLE ürün kodunun önüne ekleme; yalnızca boşluksuz, tek kelimelik salt alfanümerik ürün/model kodunu yaz. "
                    "3) HARF ÖNEKİ (PREFIX) VE KARAKTER SADAKATİ: Ardışık satırlarda ürün kodlarının başlangıç harf önekleri değiştiğinde, belgedeki harf dizilimini birebir koru ve birincil modele yalnızca `continuation_prompt` içinde verdiğin bu hazır Excel/CSV tablosundaki satırları birebir aktarmasını, tabloda olmayan hiçbir kodu uydurmamasını söyle."
                ),
                "sira": 3,
                "durum": "Yeni",
                "kilitliMi": False,
                "orijinalBaseIcerik": None,
            },
            {
                "id": "BIRLESTIRME_VE_SENTEZ",
                "baslik": "Yanıt Birleştirme (Stitching) ve Tutarlılık Politikası",
                "aciklama": "Parçalı yanıtları tek yanıt olarak birleştirme",
                "icerik": (
                    "Birincil model, `continuation_prompt` içinde sunduğun `UrunKodu;Fiyat` sanal Excel tablosundaki kalan satırları da ürettiğinde ve hedef tabloların ilk satırından son satırına kadar tüm kayıtlar tamamlandığında `is_complete=true` ve `continuation_prompt=\"\"` döndürerek süreci sonlandır."
                ),
                "sira": 4,
                "durum": "Yeni",
                "kilitliMi": False,
                "orijinalBaseIcerik": None,
            },
        ]
        observer_prompt = "\n\n".join(
            f"[{r['baslik'].upper()}]:\n{r['icerik']}" for r in observer_rules
        )

        existing = conn.execute("SELECT COUNT(1) AS cnt FROM ai_agents").fetchone()
        if existing and int(existing["cnt"] or 0) > 0:
            obs_row = conn.execute(
                "SELECT id, sistem_istemi FROM ai_agents WHERE LOWER(TRIM(kod)) = 'gozlemci_ajan' LIMIT 1"
            ).fetchone()
            if obs_row and "EKSİK KALAN TÜM SATIRLARI `UrunKodu;Fiyat` EXCEL/CSV FORMATINDA LİSTELE" not in str(obs_row.get("sistem_istemi") or ""):
                conn.execute(
                    "UPDATE ai_agents SET kurallar_json = ?, sistem_istemi = ?, updated_at = ? WHERE id = ?",
                    (_json.dumps(observer_rules, ensure_ascii=False), observer_prompt, now_iso, obs_row["id"]),
                )
            return

        general_rules = [
            {
                "id": "KIMLIK",
                "baslik": "Ajan Kimliği ve Yetki Sınırları",
                "aciklama": "ThinkPort Genel AI Asistanı temel kimliği",
                "icerik": (
                    "Sen ThinkPort AI Gateway üzerinde çalışan çok modelli yapay zeka asistanısın. "
                    "Kullanıcının sorularını, ekli dokümanlarını (RAG) ve teknik taleplerini doğru, yapılandırılmış ve eksiksiz şekilde yanıtlarsın."
                ),
                "sira": 1,
                "durum": "Yeni",
                "kilitliMi": False,
                "orijinalBaseIcerik": None,
            },
            {
                "id": "DOKUMAN_VE_RAG",
                "baslik": "Ekli Belge ve RAG Bağlamı Kullanımı",
                "aciklama": "pgvector RAG ve belge doğrulama ilkesi",
                "icerik": (
                    "Sohbete eklenmiş belge veya pgvector RAG parçaları varsa yanıtlarını doğrudan belge içeriğine dayandır; "
                    "belgede yer almayan bilgileri tahmini olarak uydurma."
                ),
                "sira": 2,
                "durum": "Yeni",
                "kilitliMi": False,
                "orijinalBaseIcerik": None,
            },
        ]
        general_prompt = "\n\n".join(
            f"[{r['baslik'].upper()}]:\n{r['icerik']}" for r in general_rules
        )

        erp_rules = [
            {
                "id": "KIMLIK",
                "baslik": "Ajan Kimliği ve Yetki Sınırları",
                "aciklama": "Webakus ERP uzman ajan kimliği",
                "icerik": (
                    "Sen Webakus ERP sisteminde çalışan yetkili bir yapay zeka asistanısın. "
                    "Yalnızca ERP kapsamındaki ticari belgeler, cari hesaplar, stok/ürün yönetimi ve şirket içi analizlerde yardımcı ol; "
                    "konu dışı soruları nazikçe reddet."
                ),
                "sira": 1,
                "durum": "Yeni",
                "kilitliMi": False,
                "orijinalBaseIcerik": None,
            },
            {
                "id": "OTONOM_MCP",
                "baslik": "Otonom MCP Araç ve Flowchart Kullanımı",
                "aciklama": "MCP fonksiyonlarını ve görev akışlarını yürütme",
                "icerik": (
                    "Kullanıcının talebi yetki sınırların içerisindeyse tanımlı MCP araçlarını (erp_query_data, erp_navigate, "
                    "erp_create_document, erp_request_confirmation) kendi zekanla seç ve çalıştır. Tanımlı bir Görev Akışı (Flowchart) "
                    "tetiklendiyse adımları sırasıyla ve eksiksiz uygula."
                ),
                "sira": 2,
                "durum": "Yeni",
                "kilitliMi": False,
                "orijinalBaseIcerik": None,
            },
        ]
        erp_prompt = "\n\n".join(
            f"[{r['baslik'].upper()}]:\n{r['icerik']}" for r in erp_rules
        )

        seed_agents = [
            (
                1,
                "Sohbet & Yanıt Gözlemci Ajanı",
                "GOZLEMCI_AJAN",
                "Token yetmezliği (finish_reason=length), tembel kısaltma (...), erken akış kesilmesi ve yarım kalan yanıtları tespit ederek otomatik devam istemi (continuation prompt) üreten ve yanıtları birleştiren sistem gözetmen ajanı.",
                "Kesintisiz Yanıt & Akış Denetçisi (Observer LLM)",
                "Shield",
                "#10b981",
                2,
                None,
                _json.dumps(observer_rules, ensure_ascii=False),
                observer_prompt,
                "[]",
                1,
                "gpt-4o",
                _json.dumps(["claude-3-5-sonnet", "gemini-2.5-pro"], ensure_ascii=False),
                0.2,
                2048,
                1,
                _json.dumps(["observer_detect_truncation", "observer_continue_generation"], ensure_ascii=False),
                1,
                1,
                now_iso,
                now_iso,
            ),
            (
                2,
                "ThinkPort Genel AI Asistanı",
                "THINKPORT_GENEL_ASISTAN",
                "ThinkPort Sohbet Stüdyosu ve /v1 API istekleri için çok modelli genel asistan ve pgvector RAG doküman analiz uzmanı.",
                "Çok Modelli Genel AI & Doküman Analiz Asistanı",
                "Bot",
                "#6366f1",
                1,
                None,
                _json.dumps(general_rules, ensure_ascii=False),
                general_prompt,
                "[]",
                1,
                "gpt-4o",
                _json.dumps(["claude-3-5-sonnet", "deepseek-r1"], ensure_ascii=False),
                0.7,
                4096,
                0,
                _json.dumps(["rag_search_documents"], ensure_ascii=False),
                1,
                1,
                now_iso,
                now_iso,
            ),
            (
                3,
                "Webakus ERP & MCP Uzman Ajanı",
                "WEBAKUS_ERP_ASISTANI",
                "Webakus ERP modülleri, ticari belgeler, cari hesaplar ve görsel Flowchart görev akışları için temel kök (Base) uzman ajan.",
                "Kurumsal ERP, Belge & Görev Akışı (Flowchart) Ajanı",
                "Sparkles",
                "#3b82f6",
                1,
                None,
                _json.dumps(erp_rules, ensure_ascii=False),
                erp_prompt,
                "[]",
                1,
                "gpt-4o",
                _json.dumps(["claude-3-5-sonnet"], ensure_ascii=False),
                0.4,
                4096,
                0,
                _json.dumps(["erp_query_data", "erp_navigate", "erp_create_document", "erp_request_confirmation", "erp_get_page_context", "erp_list_cloud_files"], ensure_ascii=False),
                1,
                1,
                now_iso,
                now_iso,
            ),
        ]

        conn.executemany(
            """
            INSERT INTO ai_agents (
                id, ad, kod, aciklama, rol, ikon, renk, kapsam, ust_ajan_id,
                kurallar_json, sistem_istemi, hizli_istekler_json, ai_saglayici_id,
                model_adi, alternatif_modeller_json, sicaklik, max_tokens,
                yanit_sentezi_modu, secili_arac_kodlari_json, aktif_mi, sistem_kaydi_mi,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            seed_agents,
        )


postgres_db = PostgresDatabaseManager()
sqlite_db = postgres_db
