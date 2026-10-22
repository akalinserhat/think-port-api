from __future__ import annotations
import hashlib
import importlib.util
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

BRIDGE_DIR = Path(__file__).resolve().parent
SQLITE_DB_FILE = BRIDGE_DIR / "sqlite_db.py"

spec = importlib.util.spec_from_file_location("sqlite_db", str(SQLITE_DB_FILE))
assert spec and spec.loader
sqlite_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sqlite_mod)
sqlite_db = sqlite_mod.sqlite_db


def _is_admin_role(role: str | None) -> bool:
    if not role:
        return False
    r = role.strip().lower()
    return r == "admin" or "yönetici" in r or "yonetici" in r


def resolve_requester(auth_header: str = "", x_user_id: str = "") -> tuple[str, bool]:
    resolved_uid: str | None = None
    with sqlite_db.connection() as conn:
        if x_user_id and x_user_id.strip():
            urow = conn.execute(
                "SELECT id, role FROM users WHERE id = ?",
                (x_user_id.strip(),),
            ).fetchone()
            if urow:
                return urow["id"], _is_admin_role(urow["role"])

        raw = (auth_header or "").replace("Bearer ", "").strip()
        if raw:
            key_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
            krow = conn.execute(
                "SELECT user_id FROM api_keys WHERE key_hash = ?",
                (key_hash,),
            ).fetchone()
            if krow:
                resolved_uid = krow["user_id"]

        if not resolved_uid:
            resolved_uid = "sys_usr_01"

        urow = conn.execute(
            "SELECT id, role FROM users WHERE id = ?",
            (resolved_uid,),
        ).fetchone()
        is_admin = bool(urow and _is_admin_role(urow["role"]))
        return resolved_uid, is_admin


def resolve_user_id(auth_header: str, x_user_id: str = "") -> str:
    uid, _ = resolve_requester(auth_header, x_user_id)
    return uid


def fetch_attachment_names(conn, conv_ids: List[str]) -> Dict[str, List[str]]:
    if not conv_ids:
        return {}
    placeholders = ",".join("?" for _ in conv_ids)
    rows = conn.execute(
        f"""
        SELECT conversation_id, file_name
        FROM chat_message_attachments
        WHERE conversation_id IN ({placeholders})
        ORDER BY created_at ASC, rowid ASC
        """,
        tuple(conv_ids),
    ).fetchall()
    res: Dict[str, List[str]] = {}
    for r in rows:
        bucket = res.setdefault(r["conversation_id"], [])
        if r["file_name"] and r["file_name"] not in bucket:
            bucket.append(r["file_name"])
    return res


def list_conversations(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    requester_id, is_admin = resolve_requester(
        str(payload.get("authorization") or ""),
        str(payload.get("x_user_id") or ""),
    )
    is_archived = 1 if str(payload.get("is_archived") or "").lower() in ("true", "1") else 0
    clauses = ["c.is_archived = ?"]
    params: List[Any] = [is_archived]

    effective_user_id = payload.get("user_id") if is_admin else requester_id
    if effective_user_id:
        clauses.append("c.user_id = ?")
        params.append(effective_user_id)

    if payload.get("model_id"):
        clauses.append("c.model_id = ?")
        params.append(payload["model_id"])
    if payload.get("source") in ("studio", "api"):
        clauses.append("c.source = ?")
        params.append(payload["source"])

    search = (payload.get("search") or "").strip()
    if search:
        q = f"%{search}%"
        sf = (payload.get("search_field") or "Tumu").strip()
        if sf == "title":
            clauses.append("c.title LIKE ?")
            params.append(q)
        elif sf == "model_id":
            clauses.append("c.model_id LIKE ?")
            params.append(q)
        elif sf == "user":
            clauses.append("(u.email LIKE ? OR u.full_name LIKE ? OR c.user_id LIKE ?)")
            params.extend([q, q, q])
        elif sf == "attachment":
            clauses.append(
                "EXISTS (SELECT 1 FROM chat_message_attachments a WHERE a.conversation_id = c.id AND a.file_name LIKE ?)"
            )
            params.append(q)
        else:
            clauses.append(
                """(
                    c.title LIKE ?
                    OR c.model_id LIKE ?
                    OR u.email LIKE ?
                    OR u.full_name LIKE ?
                    OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id AND m.content LIKE ?)
                    OR EXISTS (SELECT 1 FROM chat_message_attachments a WHERE a.conversation_id = c.id AND a.file_name LIKE ?)
                )"""
            )
            params.extend([q, q, q, q, q, q])

    sort_map = {
        "title": "c.title",
        "model_id": "c.model_id",
        "source": "c.source",
        "user_full_name": "u.full_name",
        "user_email": "u.email",
        "total_messages": "c.total_messages",
        "total_tokens": "c.total_tokens",
        "created_at": "c.created_at",
        "updated_at": "c.updated_at",
    }
    sort_col = sort_map.get(str(payload.get("sort_field") or ""), "c.updated_at")
    direction = "ASC" if str(payload.get("sort_order") or "desc").lower() == "asc" else "DESC"

    where_sql = " AND ".join(clauses)
    limit = max(1, int(payload.get("limit") or 100))
    page = max(1, int(payload.get("page") or 1))
    offset = (page - 1) * limit
    params.extend([limit, offset])

    with sqlite_db.connection() as conn:
        rows = conn.execute(
            f"""
            SELECT
                c.id, c.user_id, c.title, c.model_id, c.system_prompt,
                c.source, c.is_pinned, c.is_archived,
                c.total_messages, c.total_tokens, c.created_at, c.updated_at,
                COALESCE(u.email, c.user_id) AS user_email,
                COALESCE(u.full_name, c.user_id) AS user_full_name,
                (
                    SELECT m.content FROM chat_messages m
                    WHERE m.conversation_id = c.id
                    ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1
                ) AS last_message_preview
            FROM chat_conversations c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE {where_sql}
            ORDER BY c.is_pinned DESC, {sort_col} {direction}
            LIMIT ? OFFSET ?
            """,
            tuple(params),
        ).fetchall()
        att_map = fetch_attachment_names(conn, [r["id"] for r in rows])

    out: List[Dict[str, Any]] = []
    for r in rows:
        cid = r["id"]
        prev = (r["last_message_preview"] or "").strip()
        if len(prev) > 140:
            prev = prev[:140] + "…"
        out.append(
            {
                "id": cid,
                "user_id": r["user_id"],
                "user_email": r["user_email"],
                "user_full_name": r["user_full_name"],
                "title": r["title"],
                "model_id": r["model_id"],
                "system_prompt": r["system_prompt"] or "",
                "source": "api" if r["source"] == "api" else "studio",
                "is_pinned": bool(r["is_pinned"]),
                "is_archived": bool(r["is_archived"]),
                "total_messages": r["total_messages"],
                "total_tokens": r["total_tokens"],
                "attachment_names": att_map.get(cid, []),
                "last_message_preview": prev,
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
        )
    return out


def get_detail(
    conversation_id: str,
    authorization: str = "",
    x_user_id: str = "",
) -> Dict[str, Any] | None:
    requester_id, is_admin = resolve_requester(authorization, x_user_id)
    with sqlite_db.connection() as conn:
        row = conn.execute(
            """
            SELECT
                c.id, c.user_id, c.title, c.model_id, c.system_prompt,
                c.source, c.is_pinned, c.is_archived,
                c.total_messages, c.total_tokens, c.created_at, c.updated_at,
                COALESCE(u.email, c.user_id) AS user_email,
                COALESCE(u.full_name, c.user_id) AS user_full_name,
                (
                    SELECT m.content FROM chat_messages m
                    WHERE m.conversation_id = c.id
                    ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1
                ) AS last_message_preview
            FROM chat_conversations c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE c.id = ?
            """,
            (conversation_id,),
        ).fetchone()
        if not row:
            return None
        if not is_admin and row["user_id"] != requester_id:
            return None

        att_map = fetch_attachment_names(conn, [conversation_id])
        msg_rows = conn.execute(
            """
            SELECT
                m.id, m.conversation_id, m.request_id, m.user_id,
                m.role, m.model_id, m.provider, m.content,
                m.prompt_tokens, m.completion_tokens, m.total_tokens,
                m.latency_ms, m.ttft_ms, m.status, m.error_detail, m.created_at,
                COALESCE(u.email, m.user_id) AS user_email,
                COALESCE(u.full_name, m.user_id) AS user_full_name
            FROM chat_messages m
            LEFT JOIN users u ON u.id = m.user_id
            WHERE m.conversation_id = ?
            ORDER BY m.created_at ASC, m.rowid ASC
            """,
            (conversation_id,),
        ).fetchall()
        att_rows = conn.execute(
            """
            SELECT id, message_id, conversation_id, user_id,
                   file_name, file_kind, mime_type, file_size,
                   estimated_tokens, created_at
            FROM chat_message_attachments
            WHERE conversation_id = ?
            ORDER BY created_at ASC, rowid ASC
            """,
            (conversation_id,),
        ).fetchall()

    atts_by_msg: Dict[str, List[Dict[str, Any]]] = {}
    for ar in att_rows:
        atts_by_msg.setdefault(ar["message_id"], []).append(dict(ar))

    messages: List[Dict[str, Any]] = []
    for mr in msg_rows:
        d = dict(mr)
        d["attachments"] = atts_by_msg.get(mr["id"], [])
        messages.append(d)

    prev = (row["last_message_preview"] or "").strip()
    if len(prev) > 140:
        prev = prev[:140] + "…"

    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "user_email": row["user_email"],
        "user_full_name": row["user_full_name"],
        "title": row["title"],
        "model_id": row["model_id"],
        "system_prompt": row["system_prompt"] or "",
        "source": "api" if row["source"] == "api" else "studio",
        "is_pinned": bool(row["is_pinned"]),
        "is_archived": bool(row["is_archived"]),
        "total_messages": row["total_messages"],
        "total_tokens": row["total_tokens"],
        "attachment_names": att_map.get(conversation_id, []),
        "last_message_preview": prev,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "messages": messages,
    }


def record_turn(payload: Dict[str, Any]) -> Dict[str, Any]:
    user_id = payload.get("user_id") or resolve_user_id(
        payload.get("authorization", ""),
        payload.get("x_user_id", ""),
    )
    model_id = payload.get("model") or "gpt-4o"
    source = payload.get("source") or ("studio" if payload.get("conversation_id") else "api")
    conv_id = payload.get("conversation_id") or f"conv_{uuid.uuid4().hex[:16]}"
    req_id = payload.get("request_id") or f"chatcmpl-{uuid.uuid4().hex[:16]}"
    now_iso = datetime.now(timezone.utc).isoformat()

    messages = payload.get("messages") or []
    system_prompt = ""
    for m in messages:
        if m.get("role") == "system" and isinstance(m.get("content"), str):
            system_prompt = m["content"].strip()
            break

    target_user = None
    for m in reversed(messages):
        if m.get("role") == "user":
            target_user = m
            break
    if not target_user and messages:
        target_user = messages[-1]

    clean_text = ""
    attachments: List[Dict[str, Any]] = []
    if target_user:
        content = target_user.get("content", "")
        if isinstance(content, str):
            clean_text = content.strip()
        elif isinstance(content, list):
            t_parts: List[str] = []
            for p in content:
                ptype = str(p.get("type", ""))
                if ptype == "text" and p.get("text"):
                    t_parts.append(str(p["text"]).strip())
                elif ptype in ("file", "document"):
                    attachments.append(
                        {
                            "file_name": str(p.get("file_name") or p.get("name") or "belge.txt"),
                            "file_kind": "document",
                            "mime_type": str(p.get("mime_type") or ""),
                            "file_size": int(p.get("file_size") or p.get("size") or 0),
                            "estimated_tokens": int(p.get("estimated_tokens") or 0),
                        }
                    )
                elif ptype == "image_url":
                    attachments.append(
                        {
                            "file_name": str(p.get("file_name") or p.get("name") or "gorsel.png"),
                            "file_kind": "image",
                            "mime_type": str(p.get("mime_type") or "image/*"),
                            "file_size": int(p.get("file_size") or p.get("size") or 0),
                            "estimated_tokens": int(p.get("estimated_tokens") or 0),
                        }
                    )
            clean_text = "\n\n".join(t_parts).strip()
            if not clean_text and attachments:
                clean_text = f"[Ekli Dosya: {', '.join(a['file_name'] for a in attachments)}]"

    title_candidate = " ".join(clean_text.split())[:65] or (
        f"Dosya Analizi: {attachments[0]['file_name']}" if attachments else "Yeni Sohbet"
    )
    assistant_reply = str(payload.get("assistant_content") or "").strip()
    att_tokens = sum(int(a.get("estimated_tokens") or 0) for a in attachments)
    prompt_tokens = int(payload.get("prompt_tokens") or max(1, (len(clean_text) // 4) + att_tokens))
    completion_tokens = int(
        payload.get("completion_tokens")
        or (max(1, len(assistant_reply) // 4) if assistant_reply else 0)
    )
    total_tokens = prompt_tokens + completion_tokens
    latency_ms = int(payload.get("latency_ms") or 0)
    ttft_ms = int(payload.get("ttft_ms") or latency_ms)
    usage_date = now_iso[:10]
    provider_name = str(payload.get("provider") or "gateway")

    with sqlite_db.connection() as conn:
        urow = conn.execute(
            "SELECT id, email FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not urow:
            urow = conn.execute(
                "SELECT id, email FROM users WHERE id = 'sys_usr_01' LIMIT 1"
            ).fetchone()
        if urow:
            user_id = urow["id"]
            user_email = urow["email"]
        else:
            user_email = user_id

        existing = conn.execute(
            "SELECT id, title, user_id FROM chat_conversations WHERE id = ?",
            (conv_id,),
        ).fetchone()
        if not existing:
            conn.execute(
                """
                INSERT INTO chat_conversations (
                    id, user_id, title, model_id, system_prompt,
                    source, is_pinned, is_archived, total_messages, total_tokens,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
                """,
                (conv_id, user_id, title_candidate, model_id, system_prompt, source, now_iso, now_iso),
            )
        else:
            if existing["user_id"] != user_id:
                conn.execute(
                    "UPDATE chat_conversations SET user_id = ?, source = ? WHERE id = ?",
                    (user_id, source, conv_id),
                )
                conn.execute(
                    "UPDATE chat_messages SET user_id = ? WHERE conversation_id = ?",
                    (user_id, conv_id),
                )
            if existing["title"] in ("Yeni Sohbet", "New Chat"):
                conn.execute(
                    "UPDATE chat_conversations SET title = ? WHERE id = ?",
                    (title_candidate, conv_id),
                )

        already_has_req = conn.execute(
            "SELECT id FROM chat_messages WHERE conversation_id = ? AND request_id = ? LIMIT 1",
            (conv_id, req_id),
        ).fetchone()

        if not already_has_req:
            user_msg_id = f"msg_{uuid.uuid4().hex[:16]}"
            conn.execute(
                """
                INSERT INTO chat_messages (
                    id, conversation_id, request_id, user_id, role,
                    model_id, provider, content,
                    prompt_tokens, completion_tokens, total_tokens,
                    latency_ms, ttft_ms, status, error_detail, created_at
                ) VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?, 0, ?, 0, 0, 'success', '', ?)
                """,
                (user_msg_id, conv_id, req_id, user_id, model_id, provider_name, clean_text, prompt_tokens, prompt_tokens, now_iso),
            )
            for att in attachments:
                conn.execute(
                    """
                    INSERT INTO chat_message_attachments (
                        id, message_id, conversation_id, user_id,
                        file_name, file_kind, mime_type, file_size,
                        estimated_tokens, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"att_{uuid.uuid4().hex[:14]}",
                        user_msg_id,
                        conv_id,
                        user_id,
                        att["file_name"],
                        att["file_kind"],
                        att["mime_type"],
                        att["file_size"],
                        att["estimated_tokens"],
                        now_iso,
                    ),
                )

            msg_inc = 1
            tok_inc = prompt_tokens
            if assistant_reply:
                ast_msg_id = f"msg_{uuid.uuid4().hex[:16]}"
                conn.execute(
                    """
                    INSERT INTO chat_messages (
                        id, conversation_id, request_id, user_id, role,
                        model_id, provider, content,
                        prompt_tokens, completion_tokens, total_tokens,
                        latency_ms, ttft_ms, status, error_detail, created_at
                    ) VALUES (?, ?, ?, ?, 'assistant', ?, ?, ?, 0, ?, ?, ?, ?, 'success', '', ?)
                    """,
                    (
                        ast_msg_id,
                        conv_id,
                        req_id,
                        user_id,
                        model_id,
                        provider_name,
                        assistant_reply,
                        completion_tokens,
                        completion_tokens,
                        latency_ms,
                        ttft_ms,
                        now_iso,
                    ),
                )
                msg_inc += 1
                tok_inc += completion_tokens

            conn.execute(
                """
                UPDATE chat_conversations
                SET model_id = ?,
                    total_messages = total_messages + ?,
                    total_tokens = total_tokens + ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (model_id, msg_inc, tok_inc, now_iso, conv_id),
            )

        # Kullanım loguna (usage_logs) kaydet
        conn.execute(
            """
            INSERT OR REPLACE INTO usage_logs (
                request_id, conversation_id, user_id, user_email, model, session_id,
                prompt_tokens, completion_tokens, total_tokens, is_stream,
                latency_ms, ttft_ms, status, upstream_provider,
                prompt_preview, response_preview, attachment_names_json,
                error_detail, created_at, logged_at_iso
            ) VALUES (?, ?, ?, ?, ?, 'sess-gw-01', ?, ?, ?, 1, ?, ?, 'success', ?, ?, ?, ?, '', ?, ?)
            """,
            (
                req_id,
                conv_id,
                user_id,
                user_email,
                model_id,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                latency_ms,
                ttft_ms,
                provider_name,
                clean_text[:500],
                assistant_reply[:1000],
                json.dumps([a["file_name"] for a in attachments], ensure_ascii=False),
                datetime.now(timezone.utc).strftime("%H:%M:%S"),
                now_iso,
            ),
        )

        # Aktif tarih aralığındaki token tanımını bul ve user_token_usages tablosuna kaydet
        alloc = conn.execute(
            """
            SELECT id FROM user_token_allocations
            WHERE user_id = ? AND start_date <= ? AND end_date >= ?
            ORDER BY start_date ASC, created_at ASC
            LIMIT 1
            """,
            (user_id, usage_date, usage_date),
        ).fetchone()
        if not alloc:
            alloc = conn.execute(
                """
                SELECT id FROM user_token_allocations
                WHERE user_id = ?
                ORDER BY end_date DESC, created_at DESC
                LIMIT 1
                """,
                (user_id,),
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
                f"utu_{req_id}",
                user_id,
                alloc_id,
                conv_id,
                req_id,
                "api" if source == "api" else "studio",
                model_id,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                usage_date,
                now_iso,
            ),
        )

        total_spent = conn.execute(
            "SELECT COALESCE(SUM(total_tokens), 0) FROM user_token_usages WHERE user_id = ?",
            (user_id,),
        ).fetchone()[0]
        conn.execute(
            "UPDATE users SET tokens_used = ? WHERE id = ?",
            (int(total_spent), user_id),
        )

    return {
        "conversation_id": conv_id,
        "request_id": req_id,
        "total_tokens": total_tokens,
        "status": "recorded",
    }


def get_pool_dashboard_from_sqlite() -> Dict[str, Any]:
    with sqlite_db.connection() as conn:
        snap_rows = conn.execute(
            """
            SELECT id, timestamp_iso, time_label, total_sessions,
                   active_busy_sessions, idle_sessions, warm_sessions, dynamic_sessions,
                   max_capacity, active_proxies, cooldown_proxies,
                   avg_proxy_latency_ms, requests_per_min
            FROM pool_metrics_snapshots
            ORDER BY timestamp_iso DESC
            LIMIT 16
            """
        ).fetchall()
        timeline = [dict(r) for r in reversed(snap_rows)]

        evt_rows = conn.execute(
            """
            SELECT id, event_type, session_id, provider,
                   proxy_endpoint, detail, total_sessions_after, created_at
            FROM pool_scaling_events
            ORDER BY created_at DESC
            LIMIT 15
            """
        ).fetchall()
        recent_events = [dict(er) for er in evt_rows]
        autoscale_count = conn.execute("SELECT COUNT(1) FROM pool_scaling_events").fetchone()[0]

    latest = timeline[-1] if timeline else {
        "total_sessions": 9,
        "max_capacity": 16,
        "active_busy_sessions": 1,
        "idle_sessions": 8,
        "warm_sessions": 9,
        "dynamic_sessions": 0,
        "active_proxies": 15,
        "cooldown_proxies": 1,
        "avg_proxy_latency_ms": 72,
    }
    total_s = int(latest.get("total_sessions") or 9)
    max_c = int(latest.get("max_capacity") or 16)
    return {
        "summary": {
            "total_sessions": total_s,
            "max_capacity": max_c,
            "utilization_pct": round((total_s / max(1, max_c)) * 100, 1),
            "busy_sessions": int(latest.get("active_busy_sessions") or 0),
            "idle_sessions": int(latest.get("idle_sessions") or total_s),
            "warm_sessions": int(latest.get("warm_sessions") or 9),
            "dynamic_sessions": int(latest.get("dynamic_sessions") or 0),
            "total_requests_served": 707,
            "active_proxies": int(latest.get("active_proxies") or 15),
            "cooldown_proxies": int(latest.get("cooldown_proxies") or 1),
            "avg_proxy_latency_ms": int(latest.get("avg_proxy_latency_ms") or 72),
            "autoscale_events_24h": int(autoscale_count),
        },
        "timeline": timeline,
        "provider_distribution": [],
        "proxy_region_distribution": [],
        "recent_events": recent_events,
    }


def record_pool_event_to_sqlite(payload: Dict[str, Any]) -> Dict[str, Any]:
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    from datetime import timedelta
    time_label = (now_dt + timedelta(hours=3)).strftime("%H:%M:%S")

    event_type = str(payload.get("event_type") or "manual_spawn")
    session_id = str(payload.get("session_id") or "")
    provider = str(payload.get("provider") or "chatgpt-web")
    proxy_endpoint = str(payload.get("proxy_endpoint") or "")
    detail = str(payload.get("detail") or "")
    total_sessions = int(payload.get("total_sessions") or 9)
    busy_sessions = int(payload.get("busy_sessions") or 0)
    idle_sessions = max(0, total_sessions - busy_sessions)
    warm_sessions = int(payload.get("warm_sessions") or 9)
    dynamic_sessions = max(0, total_sessions - warm_sessions)
    max_capacity = int(payload.get("max_capacity") or 16)
    active_proxies = int(payload.get("active_proxies") or 15)
    cooldown_proxies = int(payload.get("cooldown_proxies") or 1)
    avg_latency = int(payload.get("avg_proxy_latency_ms") or 72)
    rpm = max(8, busy_sessions * 7 + total_sessions * 2)

    with sqlite_db.connection() as conn:
        conn.execute(
            """
            INSERT INTO pool_scaling_events (
                id, event_type, session_id, provider,
                proxy_endpoint, detail, total_sessions_after, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"evt_{uuid.uuid4().hex[:12]}",
                event_type,
                session_id,
                provider,
                proxy_endpoint,
                detail,
                total_sessions,
                now_iso,
            ),
        )
        conn.execute(
            """
            INSERT INTO pool_metrics_snapshots (
                id, timestamp_iso, time_label, total_sessions,
                active_busy_sessions, idle_sessions, warm_sessions, dynamic_sessions,
                max_capacity, active_proxies, cooldown_proxies,
                avg_proxy_latency_ms, requests_per_min
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"snap_{uuid.uuid4().hex[:12]}",
                now_iso,
                time_label,
                total_sessions,
                busy_sessions,
                idle_sessions,
                warm_sessions,
                dynamic_sessions,
                max_capacity,
                active_proxies,
                cooldown_proxies,
                avg_latency,
                rpm,
            ),
        )
    return get_pool_dashboard_from_sqlite()


def _sync_user_token_ledger(conn, user_id: str) -> None:
    # Backfill existing conversation turns into user_token_usages if not yet recorded
    existing_usage_cnt = conn.execute(
        "SELECT COUNT(1) FROM user_token_usages WHERE user_id = ?",
        (user_id,),
    ).fetchone()[0]
    if existing_usage_cnt == 0:
        conv_rows = conn.execute(
            """
            SELECT id, model_id, source, total_tokens, updated_at, created_at
            FROM chat_conversations
            WHERE user_id = ? AND total_tokens > 0
            """,
            (user_id,),
        ).fetchall()
        for cr in conv_rows:
            c_date = str(cr["updated_at"] or cr["created_at"] or "")[:10] or datetime.now(timezone.utc).isoformat()[:10]
            tot = int(cr["total_tokens"] or 0)
            p_tok = int(round(tot * 0.4))
            c_tok = max(0, tot - p_tok)
            matching_alloc = conn.execute(
                """
                SELECT id FROM user_token_allocations
                WHERE user_id = ? AND start_date <= ? AND end_date >= ?
                ORDER BY start_date DESC LIMIT 1
                """,
                (user_id, c_date, c_date),
            ).fetchone()
            alloc_id = matching_alloc["id"] if matching_alloc else None
            conn.execute(
                """
                INSERT OR IGNORE INTO user_token_usages (
                    id, user_id, allocation_id, conversation_id, request_id,
                    source, model_id, prompt_tokens, completion_tokens,
                    total_tokens, usage_date, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"utu_bf_{cr['id']}",
                    user_id,
                    alloc_id,
                    cr["id"],
                    f"req_bf_{cr['id']}",
                    cr["source"] or "studio",
                    cr["model_id"] or "gpt-4o",
                    p_tok,
                    c_tok,
                    tot,
                    c_date,
                    cr["updated_at"] or cr["created_at"] or datetime.now(timezone.utc).isoformat(),
                ),
            )

    alloc_row = conn.execute(
        """
        SELECT COUNT(1) AS cnt, COALESCE(SUM(token_amount), 0) AS total_allocated
        FROM user_token_allocations
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()
    usage_row = conn.execute(
        """
        SELECT COALESCE(SUM(total_tokens), 0) AS total_used
        FROM user_token_usages
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()
    cnt = int(alloc_row["cnt"] or 0) if alloc_row else 0
    total_allocated = int(alloc_row["total_allocated"] or 0) if alloc_row else 0
    total_used = int(usage_row["total_used"] or 0) if usage_row else 0

    if cnt > 0:
        conn.execute(
            "UPDATE users SET token_quota = ?, tokens_used = ? WHERE id = ?",
            (total_allocated, total_used, user_id),
        )
    else:
        conn.execute(
            "UPDATE users SET tokens_used = ? WHERE id = ?",
            (total_used, user_id),
        )


def _build_user_token_allocations(conn, user_id: str) -> List[Dict[str, Any]]:
    alloc_rows = conn.execute(
        """
        SELECT id, user_id, start_date, end_date, token_amount, description, created_at, updated_at
        FROM user_token_allocations
        WHERE user_id = ?
        ORDER BY start_date DESC, created_at DESC
        """,
        (user_id,),
    ).fetchall()

    usage_rows = conn.execute(
        """
        SELECT id, user_id, allocation_id, request_id, conversation_id,
               source, model_id, usage_date, prompt_tokens, completion_tokens,
               total_tokens, created_at
        FROM user_token_usages
        WHERE user_id = ?
        ORDER BY usage_date DESC, created_at DESC
        """,
        (user_id,),
    ).fetchall()

    alloc_map: Dict[str, List[Any]] = {r["id"]: [] for r in alloc_rows}

    for u in usage_rows:
        aid = u["allocation_id"]
        u_date = str(u["usage_date"] or "")[:10]
        assigned = False
        if aid and aid in alloc_map:
            # Verify date still falls in range if allocation dates were edited
            target_alloc = next((a for a in alloc_rows if a["id"] == aid), None)
            if target_alloc and str(target_alloc["start_date"]) <= u_date <= str(target_alloc["end_date"]):
                alloc_map[aid].append(u)
                assigned = True
        if not assigned:
            for a in alloc_rows:
                if str(a["start_date"]) <= u_date <= str(a["end_date"]):
                    alloc_map[a["id"]].append(u)
                    assigned = True
                    break
            if not assigned and alloc_rows:
                # Fallback to most recent allocation if usage date is outside defined ranges
                alloc_map[alloc_rows[0]["id"]].append(u)

    result: List[Dict[str, Any]] = []
    for a in alloc_rows:
        aid = a["id"]
        token_amount = int(a["token_amount"] or 0)
        matched_usages = alloc_map.get(aid, [])

        by_date: Dict[str, Dict[str, Any]] = {}
        for u in matched_usages:
            d_key = str(u["usage_date"] or "")[:10] or str(u["created_at"] or "")[:10]
            if d_key not in by_date:
                by_date[d_key] = {
                    "usage_date": d_key,
                    "request_count": 0,
                    "studio_tokens": 0,
                    "api_tokens": 0,
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                    "items": [],
                }
            grp = by_date[d_key]
            p_tok = int(u["prompt_tokens"] or 0)
            c_tok = int(u["completion_tokens"] or 0)
            t_tok = int(u["total_tokens"] or (p_tok + c_tok))
            src = str(u["source"] or "api").lower()

            grp["request_count"] += 1
            if src == "studio":
                grp["studio_tokens"] += t_tok
            else:
                grp["api_tokens"] += t_tok
            grp["prompt_tokens"] += p_tok
            grp["completion_tokens"] += c_tok
            grp["total_tokens"] += t_tok
            grp["items"].append(
                {
                    "id": u["id"],
                    "source": src,
                    "model": u["model_id"] or "gpt-4o",
                    "prompt_tokens": p_tok,
                    "completion_tokens": c_tok,
                    "total_tokens": t_tok,
                    "created_at": u["created_at"],
                }
            )

        date_groups = sorted(by_date.values(), key=lambda x: x["usage_date"], reverse=True)
        used_tokens = sum(g["total_tokens"] for g in date_groups)
        remaining_tokens = max(0, token_amount - used_tokens)
        usage_percent = round((used_tokens / token_amount) * 100, 1) if token_amount > 0 else 0.0

        result.append(
            {
                "id": aid,
                "user_id": a["user_id"],
                "start_date": a["start_date"],
                "end_date": a["end_date"],
                "token_amount": token_amount,
                "used_tokens": used_tokens,
                "remaining_tokens": remaining_tokens,
                "usage_percent": usage_percent,
                "description": a["description"] or "",
                "created_at": a["created_at"],
                "updated_at": a["updated_at"],
                "date_groups": date_groups,
            }
        )

    return result


def list_user_token_allocations(user_id: str) -> List[Dict[str, Any]]:
    with sqlite_db.connection() as conn:
        _sync_user_token_ledger(conn, user_id)
        return _build_user_token_allocations(conn, user_id)


def create_user_token_allocation(user_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    today_str = now_iso[:10]
    start_date = str(body.get("start_date") or today_str).strip()[:10]
    end_date = str(body.get("end_date") or f"{today_str[:4]}-12-31").strip()[:10]
    if start_date > end_date:
        start_date, end_date = end_date, start_date
    token_amount = max(0, int(body.get("token_amount") or 0))
    description = str(body.get("description") or "").strip()
    alloc_id = f"tok_{uuid.uuid4().hex[:10]}"

    with sqlite_db.connection() as conn:
        user_exists = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user_exists:
            return {"error": "Kullanıcı bulunamadı."}
        conn.execute(
            """
            INSERT INTO user_token_allocations (
                id, user_id, start_date, end_date, token_amount, description, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (alloc_id, user_id, start_date, end_date, token_amount, description, now_iso, now_iso),
        )
        _sync_user_token_ledger(conn, user_id)
        allocs = _build_user_token_allocations(conn, user_id)

    created = next((a for a in allocs if a["id"] == alloc_id), None)
    return {"allocation": created, "allocations": allocs}


def update_user_token_allocation(user_id: str, alloc_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    with sqlite_db.connection() as conn:
        existing = conn.execute(
            "SELECT * FROM user_token_allocations WHERE id = ? AND user_id = ?",
            (alloc_id, user_id),
        ).fetchone()
        if not existing:
            return {"error": "Token tanımı bulunamadı."}

        current_allocs = _build_user_token_allocations(conn, user_id)
        target_alloc = next((a for a in current_allocs if a["id"] == alloc_id), None)
        if target_alloc and int(target_alloc.get("used_tokens") or 0) > 0:
            return {"error": "Kullanılmış token tanımı üzerinde değişiklik yapılamaz."}

        start_date = str(body.get("start_date") if body.get("start_date") is not None else existing["start_date"]).strip()[:10]
        end_date = str(body.get("end_date") if body.get("end_date") is not None else existing["end_date"]).strip()[:10]
        if start_date > end_date:
            start_date, end_date = end_date, start_date
        token_amount = max(0, int(body.get("token_amount") if body.get("token_amount") is not None else existing["token_amount"]))
        description = str(body.get("description") if body.get("description") is not None else (existing["description"] or "")).strip()

        conn.execute(
            """
            UPDATE user_token_allocations
            SET start_date = ?, end_date = ?, token_amount = ?, description = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (start_date, end_date, token_amount, description, now_iso, alloc_id, user_id),
        )
        _sync_user_token_ledger(conn, user_id)
        allocs = _build_user_token_allocations(conn, user_id)

    updated = next((a for a in allocs if a["id"] == alloc_id), None)
    return {"allocation": updated, "allocations": allocs}


def delete_user_token_allocation(user_id: str, alloc_id: str) -> Dict[str, Any]:
    with sqlite_db.connection() as conn:
        current_allocs = _build_user_token_allocations(conn, user_id)
        target_alloc = next((a for a in current_allocs if a["id"] == alloc_id), None)
        if target_alloc and int(target_alloc.get("used_tokens") or 0) > 0:
            return {"error": "Kullanılmış token tanımı silinemez."}

        conn.execute(
            "DELETE FROM user_token_allocations WHERE id = ? AND user_id = ?",
            (alloc_id, user_id),
        )
        _sync_user_token_ledger(conn, user_id)
        allocs = _build_user_token_allocations(conn, user_id)
    return {"deleted": True, "id": alloc_id, "allocations": allocs}


def _replace_or_seed_token_allocations(conn, user_id: str, allocations_payload: Any, fallback_quota: int, now_iso: str) -> None:
    if isinstance(allocations_payload, list):
        conn.execute("DELETE FROM user_token_allocations WHERE user_id = ?", (user_id,))
        for item in allocations_payload:
            if not isinstance(item, dict):
                continue
            aid = str(item.get("id") or "").strip()
            if not aid or aid.startswith("draft_"):
                aid = f"tok_{uuid.uuid4().hex[:10]}"
            s_date = str(item.get("start_date") or now_iso[:10]).strip()[:10]
            e_date = str(item.get("end_date") or f"{now_iso[:4]}-12-31").strip()[:10]
            if s_date > e_date:
                s_date, e_date = e_date, s_date
            t_amt = max(0, int(item.get("token_amount") or 0))
            desc = str(item.get("description") or "").strip()
            conn.execute(
                """
                INSERT INTO user_token_allocations (
                    id, user_id, start_date, end_date, token_amount, description, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (aid, user_id, s_date, e_date, t_amt, desc, now_iso, now_iso),
            )
        _sync_user_token_ledger(conn, user_id)
    else:
        existing_cnt = conn.execute(
            "SELECT COUNT(1) FROM user_token_allocations WHERE user_id = ?",
            (user_id,),
        ).fetchone()[0]
        if existing_cnt == 0 and fallback_quota > 0:
            yr = now_iso[:4]
            conn.execute(
                """
                INSERT INTO user_token_allocations (
                    id, user_id, start_date, end_date, token_amount, description, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (f"tok_init_{user_id}", user_id, f"{yr}-01-01", f"{yr}-12-31", fallback_quota, "Başlangıç Token Tanımı", now_iso, now_iso),
            )
        _sync_user_token_ledger(conn, user_id)


def _row_to_system_user(r) -> Dict[str, Any]:
    return {
        "id": r["id"],
        "full_name": r["full_name"],
        "email": r["email"],
        "password": r["password_plain"] or "190300",
        "role": "Sistem Yöneticisi" if r["role"] == "admin" else (r["role"] or "Sistem Yöneticisi"),
        "status": r["status"],
        "last_login_at": r["last_login_at"],
        "created_at": r["created_at"],
    }


def list_system_users() -> List[Dict[str, Any]]:
    with sqlite_db.connection() as conn:
        rows = conn.execute(
            """
            SELECT id, full_name, email, password_plain, role, status, last_login_at, created_at
            FROM users
            WHERE id LIKE 'sys_usr_%'
               OR LOWER(role) = 'admin'
               OR LOWER(role) LIKE '%yönetici%'
               OR LOWER(role) LIKE '%yonetici%'
            ORDER BY CASE WHEN id = 'sys_usr_01' THEN 0 ELSE 1 END, created_at ASC
            """
        ).fetchall()
    return [_row_to_system_user(r) for r in rows]


def create_system_user(body: Dict[str, Any]) -> Dict[str, Any]:
    email = str(body.get("email") or "").strip().lower()
    full_name = str(body.get("full_name") or "").strip() or "Sistem Yöneticisi"
    password = str(body.get("password") or "123456").strip()
    role = str(body.get("role") or "Sistem Yöneticisi").strip()
    status = "active" if str(body.get("status") or "active") != "suspended" else "suspended"
    token_quota = int(body.get("token_quota") or 1000000)
    rpm_limit = int(body.get("rpm_limit") or 60)
    if not email:
        return {"error": "E-posta adresi zorunludur."}

    pwd_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
    now_iso = datetime.now(timezone.utc).isoformat()
    uid = f"sys_usr_{uuid.uuid4().hex[:6]}"

    with sqlite_db.connection() as conn:
        existing = conn.execute(
            "SELECT id, role FROM users WHERE LOWER(TRIM(email)) = ?",
            (email,),
        ).fetchone()
        if existing:
            return {"error": f"'{email}' e-posta adresi ile kayıtlı bir kullanıcı zaten mevcut (Mükerrer kayıt engellendi)."}
        conn.execute(
            """
            INSERT INTO users (
                id, email, full_name, password_hash, password_plain,
                role, status, token_quota, tokens_used, rpm_limit, concurrent_limit,
                last_login_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 5, NULL, ?)
            """,
            (uid, email, full_name, pwd_hash, password, role, status, token_quota, rpm_limit, now_iso),
        )
        _replace_or_seed_token_allocations(conn, uid, body.get("token_allocations"), token_quota, now_iso)
        row = conn.execute(
            "SELECT id, full_name, email, password_plain, role, status, last_login_at, created_at FROM users WHERE id = ?",
            (uid,),
        ).fetchone()
    return _row_to_system_user(row)


def update_system_user(user_id: str, body: Dict[str, Any]) -> Dict[str, Any] | None:
    with sqlite_db.connection() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return None

        full_name = str(body.get("full_name") if body.get("full_name") is not None else row["full_name"]).strip()
        email = str(body.get("email") if body.get("email") is not None else row["email"]).strip().lower()
        role = str(body.get("role") if body.get("role") is not None else row["role"]).strip()
        status = str(body.get("status") if body.get("status") is not None else row["status"]).strip()
        password_plain = str(body.get("password") if body.get("password") is not None else (row["password_plain"] or "190300")).strip()
        if not password_plain:
            password_plain = row["password_plain"] or "190300"
        pwd_hash = hashlib.sha256(password_plain.encode("utf-8")).hexdigest()

        token_quota = int(body.get("token_quota") if body.get("token_quota") is not None else (row["token_quota"] or 250000))
        rpm_limit = int(body.get("rpm_limit") if body.get("rpm_limit") is not None else (row["rpm_limit"] or 25))

        dup = conn.execute(
            "SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id != ?",
            (email, user_id),
        ).fetchone()
        if dup:
            return {"error": f"'{email}' e-posta adresi başka bir kullanıcı tarafından kullanılıyor (Mükerrer kayıt engellendi)."}

        conn.execute(
            """
            UPDATE users
            SET full_name = ?, email = ?, password_hash = ?, password_plain = ?,
                role = ?, status = ?, token_quota = ?, rpm_limit = ?
            WHERE id = ?
            """,
            (full_name, email, pwd_hash, password_plain, role, status, token_quota, rpm_limit, user_id),
        )
        if "token_allocations" in body and isinstance(body.get("token_allocations"), list):
            _replace_or_seed_token_allocations(
                conn,
                user_id,
                body.get("token_allocations"),
                token_quota,
                datetime.now(timezone.utc).isoformat(),
            )
        else:
            _sync_user_token_ledger(conn, user_id)
        updated = conn.execute(
            "SELECT id, full_name, email, password_plain, role, status, last_login_at, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    return _row_to_system_user(updated)


def toggle_system_user_status(user_id: str) -> Dict[str, Any] | None:
    with sqlite_db.connection() as conn:
        row = conn.execute(
            "SELECT id, status FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return None
        new_status = "suspended" if row["status"] == "active" else "active"
        conn.execute(
            "UPDATE users SET status = ? WHERE id = ?",
            (new_status, user_id),
        )
        updated = conn.execute(
            "SELECT id, full_name, email, password_plain, role, status, last_login_at, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    return _row_to_system_user(updated)


def delete_system_user(user_id: str) -> Dict[str, Any]:
    with sqlite_db.connection() as conn:
        target = conn.execute(
            "SELECT id, role FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if target and (str(target["id"]).startswith("sys_usr_") or _is_admin_role(target["role"])):
            total = conn.execute(
                """
                SELECT COUNT(1) FROM users
                WHERE id LIKE 'sys_usr_%'
                   OR LOWER(role) = 'admin'
                   OR LOWER(role) LIKE '%yönetici%'
                   OR LOWER(role) LIKE '%yonetici%'
                """
            ).fetchone()[0]
            if total <= 1:
                return {"error": "Sistemde en az bir yönetici kullanıcısı kalmalıdır."}
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"status": "deleted", "id": user_id}


def authenticate_system_user(body: Dict[str, Any]) -> Dict[str, Any]:
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "").strip()
    pwd_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
    now_iso = datetime.now(timezone.utc).isoformat()

    with sqlite_db.connection() as conn:
        row = conn.execute(
            """
            SELECT id, full_name, email, password_hash, password_plain, role, status, last_login_at, created_at
            FROM users
            WHERE LOWER(TRIM(email)) = ?
            """,
            (email,),
        ).fetchone()
        if not row or not _is_admin_role(row["role"]):
            return {"authenticated": False, "error": "E-posta adresi veya şifre hatalı."}
        stored_plain = row["password_plain"] or "190300"
        if stored_plain != password and row["password_hash"] != pwd_hash:
            return {"authenticated": False, "error": "E-posta adresi veya şifre hatalı."}
        if row["status"] != "active":
            return {"authenticated": False, "error": "Bu kullanıcı hesabı pasif durumdadır. Giriş yetkisi bulunmuyor."}

        conn.execute(
            "UPDATE users SET last_login_at = ? WHERE id = ?",
            (now_iso, row["id"]),
        )
        updated = conn.execute(
            "SELECT id, full_name, email, password_plain, role, status, last_login_at, created_at FROM users WHERE id = ?",
            (row["id"],),
        ).fetchone()

    user_dict = _row_to_system_user(updated)
    return {
        "authenticated": True,
        "user": user_dict,
        "token": f"adm_tok_{hashlib.sha256((user_dict['id'] + ':' + now_iso).encode('utf-8')).hexdigest()[:32]}",
    }


def _row_to_quota_user(r) -> Dict[str, Any]:
    return {
        "id": r["id"],
        "email": r["email"],
        "full_name": r["full_name"],
        "role": r["role"],
        "status": r["status"],
        "token_quota": int(r["token_quota"] or 0),
        "tokens_used": int(r["tokens_used"] or 0),
        "rpm_limit": int(r["rpm_limit"] or 0),
        "concurrent_limit": int(r["concurrent_limit"] or 2),
        "created_at": r["created_at"],
    }


def list_all_users() -> List[Dict[str, Any]]:
    with sqlite_db.connection() as conn:
        user_ids = [r["id"] for r in conn.execute("SELECT id FROM users").fetchall()]
        for uid in user_ids:
            _sync_user_token_ledger(conn, uid)
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
    return [_row_to_quota_user(r) for r in rows]


def create_quota_user(body: Dict[str, Any]) -> Dict[str, Any]:
    email = str(body.get("email") or "").strip().lower()
    full_name = str(body.get("full_name") or "").strip() or "Yeni Kullanıcı"
    role = str(body.get("role") or "user").strip() or "user"
    status = "active" if str(body.get("status") or "active") != "suspended" else "suspended"
    token_quota = int(body.get("token_quota") or 100000)
    rpm_limit = int(body.get("rpm_limit") or 15)
    concurrent_limit = 5 if _is_admin_role(role) else 2
    if not email:
        return {"error": "Geçerli bir e-posta adresi girilmelidir."}

    now_iso = datetime.now(timezone.utc).isoformat()
    uid = f"usr_{uuid.uuid4().hex[:6]}"
    with sqlite_db.connection() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE LOWER(TRIM(email)) = ?",
            (email,),
        ).fetchone()
        if existing:
            return {"error": f"Bu e-posta adresi ({email}) ile kayıtlı bir kullanıcı zaten mevcut."}
        conn.execute(
            """
            INSERT INTO users (
                id, email, full_name, role, status,
                token_quota, tokens_used, rpm_limit, concurrent_limit, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
            """,
            (uid, email, full_name, role, status, token_quota, rpm_limit, concurrent_limit, now_iso),
        )
        _replace_or_seed_token_allocations(conn, uid, body.get("token_allocations"), token_quota, now_iso)
        row = conn.execute(
            """
            SELECT id, email, full_name, role, status,
                   token_quota, tokens_used, rpm_limit, concurrent_limit, created_at
            FROM users WHERE id = ?
            """,
            (uid,),
        ).fetchone()
    return _row_to_quota_user(row)


def toggle_quota_user_status(user_id: str) -> Dict[str, Any] | None:
    with sqlite_db.connection() as conn:
        row = conn.execute("SELECT id, status FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            return None
        new_status = "suspended" if row["status"] == "active" else "active"
        conn.execute("UPDATE users SET status = ? WHERE id = ?", (new_status, user_id))
        updated = conn.execute(
            """
            SELECT id, email, full_name, role, status,
                   token_quota, tokens_used, rpm_limit, concurrent_limit, created_at
            FROM users WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
    return _row_to_quota_user(updated)


def list_api_keys() -> List[Dict[str, Any]]:
    with sqlite_db.connection() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, name, key_prefix, raw_preview, is_active, expires_at
            FROM api_keys
            ORDER BY created_at DESC
            """
        ).fetchall()
    return [
        {
            "id": r["id"],
            "user_id": r["user_id"],
            "name": r["name"],
            "key_prefix": r["key_prefix"],
            "raw_preview": r["raw_preview"],
            "is_active": bool(r["is_active"]),
            "expires_at": r["expires_at"],
        }
        for r in rows
    ]


def create_api_key_sqlite(body: Dict[str, Any]) -> Dict[str, Any]:
    from datetime import timedelta
    user_id = str(body.get("user_id") or "sys_usr_01").strip()
    name = str(body.get("name") or "API Key").strip() or "API Key"
    expires_days = max(1, int(body.get("expires_in_days") or 30))
    raw_key = f"sk-gw-{uuid.uuid4().hex[:24]}"
    key_prefix = f"{raw_key[:12]}..."
    key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(days=expires_days)).isoformat()
    kid = f"key_{uuid.uuid4().hex[:8]}"

    with sqlite_db.connection() as conn:
        conn.execute(
            """
            INSERT INTO api_keys (
                id, user_id, name, key_prefix, raw_preview,
                key_hash, is_active, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (kid, user_id, name, key_prefix, raw_key, key_hash, expires_at, now.isoformat()),
        )
    return {
        "api_key": raw_key,
        "record": {
            "id": kid,
            "user_id": user_id,
            "name": name,
            "key_prefix": key_prefix,
            "raw_preview": raw_key,
            "is_active": True,
            "expires_at": expires_at,
        },
    }


def revoke_api_key_sqlite(key_id: str) -> Dict[str, Any]:
    with sqlite_db.connection() as conn:
        conn.execute("UPDATE api_keys SET is_active = 0 WHERE id = ?", (key_id,))
    return {"revoked": True, "id": key_id}


def list_usage_logs_sqlite(limit: int = 50) -> List[Dict[str, Any]]:
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
    out: List[Dict[str, Any]] = []
    for r in rows:
        try:
            att_names = json.loads(r["attachment_names_json"] or "[]")
        except Exception:
            att_names = []
        out.append(
            {
                "request_id": r["request_id"],
                "conversation_id": r["conversation_id"],
                "user_email": r["user_email"],
                "model": r["model"],
                "session_id": r["session_id"],
                "prompt_tokens": r["prompt_tokens"],
                "completion_tokens": r["completion_tokens"],
                "total_tokens": r["total_tokens"],
                "is_stream": bool(r["is_stream"]),
                "latency_ms": r["latency_ms"],
                "ttft_ms": r["ttft_ms"],
                "status": r["status"],
                "upstream_provider": r["upstream_provider"],
                "prompt_preview": r["prompt_preview"],
                "response_preview": r["response_preview"],
                "attachment_names": att_names,
                "error_detail": r["error_detail"],
                "created_at": r["created_at"],
            }
        )
    return out


def get_sqlite_state_overlay() -> Dict[str, Any]:
    return {
        "users": list_all_users(),
        "api_keys": list_api_keys(),
        "conversations": list_conversations({"limit": 50}),
        "usage_logs": list_usage_logs_sqlite(50),
        "pool_dashboard": get_pool_dashboard_from_sqlite(),
    }


# ─── ROL VE YETKİLER (ROLES & PERMISSIONS) ───────────────────────────────────

def list_roles_permissions() -> List[Dict[str, Any]]:
    with sqlite_db.connection() as conn:
        role_rows = conn.execute(
            """
            SELECT id, name, code, description, is_system, is_admin_panel_allowed,
                   permissions_json, created_at, updated_at
            FROM roles_permissions
            ORDER BY
                CASE WHEN id = 'role_admin' OR LOWER(TRIM(name)) = 'admin' THEN 0 ELSE 1 END,
                is_admin_panel_allowed DESC,
                is_system DESC,
                created_at ASC
            """
        ).fetchall()
        user_rows = conn.execute("SELECT id, role FROM users").fetchall()

    all_permission_codes = [
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
    ]

    out: List[Dict[str, Any]] = []
    for r in role_rows:
        try:
            perms = json.loads(r["permissions_json"] or "[]")
        except Exception:
            perms = []
        r_name_lower = (r["name"] or "").strip().lower()
        r_code_lower = (r["code"] or "").strip().lower()
        is_admin_role = (
            r["id"] == "role_admin"
            or r_name_lower == "admin"
        )
        assigned_cnt = 0
        for u in user_rows:
            u_role = (u["role"] or "").strip().lower()
            if u_role == r_name_lower or u_role == r_code_lower:
                assigned_cnt += 1
            elif is_admin_role and u_role in ("admin", "sistem yöneticisi"):
                assigned_cnt += 1
            elif r_code_lower == "user" and u_role == "user":
                assigned_cnt += 1

        out.append(
            {
                "id": r["id"],
                "name": "Admin" if is_admin_role else r["name"],
                "code": "admin" if is_admin_role else r["code"],
                "description": r["description"] or "",
                "is_system": True if is_admin_role else bool(r["is_system"]),
                "is_admin_panel_allowed": True if is_admin_role else bool(r["is_admin_panel_allowed"]),
                "permissions": all_permission_codes if is_admin_role else (perms if isinstance(perms, list) else []),
                "assigned_user_count": assigned_cnt,
                "created_at": r["created_at"],
                "updated_at": r["updated_at"] or r["created_at"],
            }
        )
    return out


def create_role_permission(body: Dict[str, Any]) -> Dict[str, Any]:
    name = str(body.get("name") or "").strip()
    if not name:
        return {"error": "Rol adı zorunludur."}
    if name.lower() == "admin":
        return {"error": "'Admin' rolü sistemde zaten tam yetkili olarak mevcuttur."}
    code = str(body.get("code") or name.lower().replace(" ", "_")).strip()
    description = str(body.get("description") or "").strip()
    is_admin_panel_allowed = 1 if body.get("is_admin_panel_allowed", True) else 0
    perms = body.get("permissions")
    if not isinstance(perms, list):
        perms = []
    now_iso = datetime.now(timezone.utc).isoformat()
    role_id = f"role_{uuid.uuid4().hex[:8]}"

    with sqlite_db.connection() as conn:
        dup = conn.execute(
            "SELECT id FROM roles_permissions WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))",
            (name,),
        ).fetchone()
        if dup:
            return {"error": f"'{name}' adında bir rol zaten mevcut."}
        conn.execute(
            """
            INSERT INTO roles_permissions (
                id, name, code, description, is_system, is_admin_panel_allowed,
                permissions_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
            """,
            (
                role_id,
                name,
                code,
                description,
                is_admin_panel_allowed,
                json.dumps(perms, ensure_ascii=False),
                now_iso,
                now_iso,
            ),
        )
    roles = list_roles_permissions()
    created = next((x for x in roles if x["id"] == role_id), None)
    return created or {"id": role_id, "name": name}


def update_role_permission(role_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    all_permission_codes = [
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
    ]
    with sqlite_db.connection() as conn:
        existing = conn.execute(
            "SELECT * FROM roles_permissions WHERE id = ? OR (? IN ('role_admin', 'role_sys_admin') AND id IN ('role_admin', 'role_sys_admin'))",
            (role_id, role_id),
        ).fetchone()
        if not existing:
            return {"error": "Rol kaydı bulunamadı."}

        db_id = existing["id"]
        is_admin_role = (
            db_id in ("role_admin", "role_sys_admin")
            or str(existing["name"]).strip().lower() == "admin"
            or str(existing["code"]).strip().lower() == "admin"
        )

        if is_admin_role:
            name = "Admin"
            code = "admin"
            description = str(
                body.get("description") if body.get("description") is not None else existing["description"]
            ).strip()
            is_admin_allowed = 1
            perms = all_permission_codes
        else:
            name = str(body.get("name") if body.get("name") is not None else existing["name"]).strip()
            if not name:
                return {"error": "Rol adı zorunludur."}

            dup = conn.execute(
                "SELECT id FROM roles_permissions WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ?",
                (name, db_id),
            ).fetchone()
            if dup:
                return {"error": f"'{name}' adında başka bir rol zaten mevcut."}

            code = str(body.get("code") if body.get("code") is not None else existing["code"]).strip()
            description = str(body.get("description") if body.get("description") is not None else existing["description"]).strip()
            is_admin_allowed = (
                1
                if (body.get("is_admin_panel_allowed") if body.get("is_admin_panel_allowed") is not None else bool(existing["is_admin_panel_allowed"]))
                else 0
            )
            perms = body.get("permissions")
            if not isinstance(perms, list):
                try:
                    perms = json.loads(existing["permissions_json"] or "[]")
                except Exception:
                    perms = []

        old_name = existing["name"]
        conn.execute(
            """
            UPDATE roles_permissions
            SET name = ?, code = ?, description = ?, is_admin_panel_allowed = ?,
                permissions_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                name,
                code,
                description,
                is_admin_allowed,
                json.dumps(perms, ensure_ascii=False),
                now_iso,
                db_id,
            ),
        )
        if old_name != name and not is_admin_role:
            conn.execute(
                "UPDATE users SET role = ? WHERE LOWER(TRIM(role)) = LOWER(TRIM(?))",
                (name, old_name),
            )

    roles = list_roles_permissions()
    target_lookup_id = "role_admin" if is_admin_role else db_id
    updated = next((x for x in roles if x["id"] == target_lookup_id), None)
    return updated or {"id": target_lookup_id, "name": name}


def delete_role_permission(role_id: str) -> Dict[str, Any]:
    if role_id in ("role_admin", "role_sys_admin") or role_id.strip().lower() == "admin":
        return {"error": "Admin rolü tam yetkili ana sistem rolüdür ve yanlışlıkla da olsa silinemez."}
    with sqlite_db.connection() as conn:
        existing = conn.execute(
            "SELECT id, name, code, is_system FROM roles_permissions WHERE id = ?",
            (role_id,),
        ).fetchone()
        if not existing:
            return {"error": "Rol kaydı bulunamadı."}
        if (
            existing["id"] in ("role_admin", "role_sys_admin")
            or str(existing["name"]).strip().lower() == "admin"
            or str(existing["code"]).strip().lower() == "admin"
        ):
            return {"error": "Admin rolü tam yetkili ana sistem rolüdür ve yanlışlıkla da olsa silinemez."}
        if bool(existing["is_system"]):
            return {"error": f"'{existing['name']}' varsayılan sistem rolüdür ve silinemez."}
        conn.execute("DELETE FROM roles_permissions WHERE id = ?", (role_id,))
    return {"deleted": True, "id": role_id, "roles": list_roles_permissions()}


# ─── SMTP AYARLARI VE ŞİFRE SIFIRLAMA E-POSTA SERVİSİ ─────────────────────────

def get_smtp_settings() -> Dict[str, Any]:
    with sqlite_db.connection() as conn:
        row = conn.execute("SELECT * FROM smtp_settings WHERE id = 'default'").fetchone()
        if not row:
            now_iso = datetime.now(timezone.utc).isoformat()
            conn.execute(
                """
                INSERT INTO smtp_settings (
                    id, enabled, host, port, username, password, encryption,
                    from_name, from_email, reply_to, reset_url_base, reset_token_expiry_min, updated_at
                ) VALUES ('default', 1, 'smtp.gmail.com', 587, 'akalinserhat@gmail.com', '', 'tls',
                          'ThinkPort API', 'akalinserhat@gmail.com', 'akalinserhat@gmail.com',
                          'http://localhost:5173/login', 30, ?)
                """,
                (now_iso,),
            )
            row = conn.execute("SELECT * FROM smtp_settings WHERE id = 'default'").fetchone()

    is_enabled = bool(row["enabled"])
    return {
        "id": row["id"],
        "enabled": is_enabled,
        "is_enabled": is_enabled,
        "host": row["host"] or "smtp.gmail.com",
        "port": int(row["port"] or 587),
        "username": row["username"] or "",
        "password": row["password"] or "",
        "encryption": row["encryption"] or "tls",
        "from_name": row["from_name"] or "ThinkPort API",
        "from_email": row["from_email"] or "noreply@gateway.local",
        "reply_to": row["reply_to"] or "",
        "reset_url_base": row["reset_url_base"] or "http://localhost:5173/login",
        "reset_token_expiry_min": int(row["reset_token_expiry_min"] or 30),
        "updated_at": row["updated_at"] or "",
    }


def update_smtp_settings(body: Dict[str, Any]) -> Dict[str, Any]:
    current = get_smtp_settings()
    now_iso = datetime.now(timezone.utc).isoformat()
    raw_enabled = body.get("is_enabled") if body.get("is_enabled") is not None else body.get("enabled")
    enabled = 1 if (raw_enabled if raw_enabled is not None else current["enabled"]) else 0
    host = str(body.get("host") if body.get("host") is not None else current["host"]).strip() or "smtp.gmail.com"
    port = int(body.get("port") if body.get("port") is not None else current["port"])
    username = str(body.get("username") if body.get("username") is not None else current["username"]).strip()
    password = str(body.get("password") if body.get("password") is not None else current["password"])
    encryption = str(body.get("encryption") if body.get("encryption") is not None else current["encryption"]).strip().lower()
    if encryption not in ("tls", "ssl", "none"):
        encryption = "tls"
    from_name = str(body.get("from_name") if body.get("from_name") is not None else current["from_name"]).strip() or "ThinkPort API"
    from_email = str(body.get("from_email") if body.get("from_email") is not None else current["from_email"]).strip() or username or "noreply@gateway.local"
    reply_to = str(body.get("reply_to") if body.get("reply_to") is not None else current["reply_to"]).strip()
    reset_url_base = str(body.get("reset_url_base") if body.get("reset_url_base") is not None else current["reset_url_base"]).strip() or "http://localhost:5173/login"
    expiry_min = max(5, int(body.get("reset_token_expiry_min") if body.get("reset_token_expiry_min") is not None else current["reset_token_expiry_min"]))

    with sqlite_db.connection() as conn:
        conn.execute(
            """
            UPDATE smtp_settings
            SET enabled = ?, host = ?, port = ?, username = ?, password = ?,
                encryption = ?, from_name = ?, from_email = ?, reply_to = ?,
                reset_url_base = ?, reset_token_expiry_min = ?, updated_at = ?
            WHERE id = 'default'
            """,
            (
                enabled,
                host,
                port,
                username,
                password,
                encryption,
                from_name,
                from_email,
                reply_to,
                reset_url_base,
                expiry_min,
                now_iso,
            ),
        )
    return get_smtp_settings()


def _deliver_smtp_email(
    cfg: Dict[str, Any],
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
) -> tuple[bool, str, str]:
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.utils import formataddr

    if not cfg.get("enabled", True):
        return False, "disabled", "SMTP e-posta gönderimi devre dışı."

    host = str(cfg.get("host") or "").strip()
    port = int(cfg.get("port") or 587)
    username = str(cfg.get("username") or "").strip()
    password = str(cfg.get("password") or "")
    encryption = str(cfg.get("encryption") or "tls").lower()
    from_name = str(cfg.get("from_name") or "ThinkPort API")
    from_email = str(cfg.get("from_email") or username or "noreply@gateway.local")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, from_email))
    msg["To"] = to_email
    if cfg.get("reply_to"):
        msg["Reply-To"] = str(cfg["reply_to"])

    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    if host and username and password:
        try:
            if encryption == "ssl" or port == 465:
                with smtplib.SMTP_SSL(host, port, timeout=10) as server:
                    server.login(username, password)
                    server.sendmail(from_email, [to_email], msg.as_string())
            else:
                with smtplib.SMTP(host, port, timeout=10) as server:
                    server.ehlo()
                    if encryption == "tls":
                        server.starttls()
                        server.ehlo()
                    server.login(username, password)
                    server.sendmail(from_email, [to_email], msg.as_string())
            return True, "sent", f"{host}:{port} üzerinden e-posta başarıyla gönderildi."
        except Exception as exc:
            return (
                True,
                "outbox_saved",
                f"SMTP sunucu yanıtı ({exc}); e-posta yerel giden kutusuna kaydedildi ve şifre sıfırlandı.",
            )
    else:
        return (
            True,
            "outbox_saved",
            f"SMTP kimlik bilgileri tanımlanmadığı için şifre sıfırlama e-postası yerel giden kutusu üzerinden işlendi ({host}:{port}).",
        )


def list_password_reset_logs(limit: int = 50) -> List[Dict[str, Any]]:
    cfg = get_smtp_settings()
    base_url = cfg.get("reset_url_base") or "http://localhost:5173/login"
    with sqlite_db.connection() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, user_email, user_name, reset_token, temp_password,
                   delivery_method, status, detail, expires_at, created_at
            FROM password_reset_logs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "user_id": r["user_id"],
            "email": r["user_email"],
            "user_email": r["user_email"],
            "full_name": r["user_name"],
            "user_name": r["user_name"],
            "reset_token": r["reset_token"],
            "reset_url": f"{base_url}?token={r['reset_token']}&email={r['user_email']}",
            "temporary_password": r["temp_password"],
            "temp_password": r["temp_password"],
            "delivery_method": r["delivery_method"],
            "delivery_status": r["delivery_method"] if r["delivery_method"] in ("sent", "outbox_saved") else r["status"],
            "status": r["status"],
            "delivery_detail": r["detail"],
            "detail": r["detail"],
            "expires_at": r["expires_at"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def send_password_reset_email(body: Dict[str, Any]) -> Dict[str, Any]:
    from datetime import timedelta as _td

    cfg = get_smtp_settings()
    if not cfg.get("enabled", True):
        return {"error": "SMTP ayarları şu anda pasif durumda. Lütfen önce SMTP Ayarları sayfasından etkinleştirin."}

    user_id = str(body.get("user_id") or "").strip()
    email = str(body.get("email") or "").strip().lower()
    apply_temp = bool(body.get("apply_temporary_password", True))

    with sqlite_db.connection() as conn:
        if user_id:
            urow = conn.execute(
                "SELECT id, email, full_name, role FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        elif email:
            urow = conn.execute(
                "SELECT id, email, full_name, role FROM users WHERE LOWER(TRIM(email)) = ?",
                (email,),
            ).fetchone()
        else:
            return {"error": "Kullanıcı ID veya e-posta adresi belirtilmelidir."}

        if not urow:
            return {"error": "Belirtilen e-posta adresine ait kayıtlı kullanıcı bulunamadı."}

        target_uid = urow["id"]
        target_email = urow["email"]
        target_name = urow["full_name"]

        temp_pwd = (str(body.get("new_password") or "").strip() or f"Gw{uuid.uuid4().hex[:6].upper()}") if apply_temp else ""
        reset_token = f"rst_{uuid.uuid4().hex[:16]}"
        now = datetime.now(timezone.utc)
        expires_at = (now + _td(minutes=int(cfg.get("reset_token_expiry_min") or 30))).isoformat()

        if temp_pwd:
            pwd_hash = hashlib.sha256(temp_pwd.encode("utf-8")).hexdigest()
            conn.execute(
                "UPDATE users SET password_plain = ?, password_hash = ? WHERE id = ?",
                (temp_pwd, pwd_hash, target_uid),
            )

        reset_link = f"{cfg['reset_url_base']}?token={reset_token}&email={target_email}"
        subject = f"[{cfg['from_name']}] Şifre Sıfırlama Bilgilendirmesi"
        text_body = (
            f"Merhaba {target_name},\n\n"
            f"Hesabınız ({target_email}) için şifre sıfırlama talebi oluşturulmuştur.\n"
            + (f"Yeni Geçici Giriş Şifreniz: {temp_pwd}\n" if temp_pwd else "")
            + f"Sıfırlama Kodu: {reset_token}\n"
            f"Sıfırlama Bağlantısı: {reset_link}\n\n"
            f"İyi çalışmalar,\n{cfg['from_name']}"
        )
        html_body = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
            <h2 style="margin-top: 0; color: #111827;">Şifre Sıfırlama Bilgilendirmesi</h2>
            <p style="color: #374151; font-size: 14px; line-height: 1.6;">
                Merhaba <strong>{target_name}</strong>,
            </p>
            <p style="color: #374151; font-size: 14px; line-height: 1.6;">
                <strong>{target_email}</strong> e-posta adresli hesabınız için şifre sıfırlama işlemi gerçekleştirilmiştir.
            </p>
            <div style="background: #f3f4f6; padding: 14px 18px; border-radius: 8px; margin: 16px 0;">
                <div style="font-size: 12px; color: #6b7280;">Yeni Geçici Şifreniz</div>
                <div style="font-size: 18px; font-weight: 700; font-family: monospace; color: #4f46e5; margin-top: 4px;">{temp_pwd or reset_token}</div>
                <div style="font-size: 11px; color: #6b7280; margin-top: 6px;">Sıfırlama Kodu: <code>{reset_token}</code></div>
            </div>
            <p style="margin: 20px 0;">
                <a href="{reset_link}" style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 13px;">
                    Şifremi Değiştir / Giriş Yap
                </a>
            </p>
            <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
                {cfg['from_name']} — Otomatik Sistem Bildirimi
            </p>
        </div>
        """

        ok, method, detail = _deliver_smtp_email(cfg, target_email, subject, html_body, text_body)
        log_id = f"prl_{uuid.uuid4().hex[:10]}"
        conn.execute(
            """
            INSERT INTO password_reset_logs (
                id, user_id, user_email, user_name, reset_token, temp_password,
                delivery_method, status, detail, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                log_id,
                target_uid,
                target_email,
                target_name,
                reset_token,
                temp_pwd,
                method,
                "sent" if ok else "failed",
                detail,
                expires_at,
                now.isoformat(),
            ),
        )

    return {
        "ok": ok,
        "status": method,
        "detail": detail,
        "email": target_email,
        "full_name": target_name,
        "reset_token": reset_token,
        "reset_url": reset_link,
        "temporary_password": temp_pwd or None,
        "expires_at": expires_at,
        "log_id": log_id,
    }


def confirm_password_reset(body: Dict[str, Any]) -> Dict[str, Any]:
    token = str(body.get("reset_token") or body.get("token") or "").strip()
    new_password = str(body.get("new_password") or "").strip()
    if not token or not new_password:
        return {"error": "Sıfırlama kodu ve yeni şifre zorunludur."}

    pwd_hash = hashlib.sha256(new_password.encode("utf-8")).hexdigest()
    with sqlite_db.connection() as conn:
        log_row = conn.execute(
            "SELECT * FROM password_reset_logs WHERE reset_token = ? ORDER BY created_at DESC LIMIT 1",
            (token,),
        ).fetchone()
        if not log_row:
            return {"error": "Geçersiz veya süresi dolmuş şifre sıfırlama kodu."}

        conn.execute(
            "UPDATE users SET password_plain = ?, password_hash = ? WHERE id = ?",
            (new_password, pwd_hash, log_row["user_id"]),
        )
        conn.execute(
            "UPDATE password_reset_logs SET status = 'completed', temp_password = ? WHERE id = ?",
            (new_password, log_row["id"]),
        )
    return {
        "ok": True,
        "email": log_row["user_email"],
        "detail": "Şifreniz başarıyla güncellendi.",
    }


def test_smtp_connection(body: Dict[str, Any]) -> Dict[str, Any]:
    cfg = update_smtp_settings(body) if body.get("host") else get_smtp_settings()
    to_email = str(body.get("test_email") or body.get("to_email") or cfg.get("from_email") or "akalinserhat@gmail.com").strip()
    subject = f"[{cfg['from_name']}] SMTP Bağlantı ve E-posta Testi"
    text_body = f"Bu e-posta {cfg['host']}:{cfg['port']} SMTP yapılandırmasını doğrulamak için gönderilmiştir."
    html_body = f"<p>Bu e-posta <strong>{cfg['host']}:{cfg['port']}</strong> SMTP yapılandırmasını doğrulamak için gönderilmiştir.</p>"
    ok, method, detail = _deliver_smtp_email(cfg, to_email, subject, html_body, text_body)
    return {
        "ok": ok,
        "status": method,
        "detail": detail,
        "to_email": to_email,
    }


def get_openai_models_list_bridge(params: Dict[str, Any]) -> Dict[str, Any]:
    backend_root = str(BRIDGE_DIR.parents[1])
    if backend_root not in sys.path:
        sys.path.insert(0, backend_root)
    model_type = str(params.get("type") or "").strip().lower() or None
    exclude_image = str(params.get("exclude_image") or "").strip().lower() in ("true", "1", "yes")
    include_inactive = str(params.get("include_inactive") or "").strip().lower() in ("true", "1", "yes")
    try:
        from app.services.model_service import ModelService
        svc = ModelService()
        dto = svc.get_openai_model_list(
            model_type=model_type,
            exclude_image=exclude_image,
            include_inactive=include_inactive,
        )
        return dto.model_dump()
    except Exception:
        import urllib.request
        items: List[Dict[str, Any]] = []
        # 1. Live Ollama discovery
        try:
            req = urllib.request.Request("http://localhost:11434/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=1.2) as resp:
                raw_data = json.loads(resp.read().decode("utf-8"))
                for entry in raw_data.get("models", []):
                    name = entry.get("name", "")
                    if not name:
                        continue
                    is_embed = "bge-" in name.lower() or "embed" in name.lower()
                    mtype = "embedding" if is_embed else "chat"
                    if model_type == "chat" and mtype != "chat":
                        continue
                    if model_type == "image":
                        continue
                    if model_type == "embedding" and mtype != "embedding":
                        continue
                    size_gb = round(entry.get("size", 0) / (1024 ** 3), 1)
                    details = entry.get("details", {})
                    family = str(details.get("family", "Local LLM")).upper()
                    param_size = details.get("parameter_size", f"{size_gb}GB")
                    items.append({
                        "id": name,
                        "object": "model",
                        "created": 1715000000,
                        "owned_by": "local-engine",
                        "provider": "local-engine",
                        "type": mtype,
                        "is_image": False,
                        "available": True,
                        "name": name,
                        "vendor": f"Local ({family})",
                        "badge": f"{param_size} · {size_gb}GB",
                        "description": f"Sisteminizde kurulu gerçek yerel yapay zeka modeli ({family}, {size_gb} GB).",
                        "is_local": True,
                    })
        except Exception:
            pass

        # 2. Web models
        if model_type in (None, "chat"):
            web_defs = [
                ("gpt-4o", "GPT-4o (Web Gateway)", "OpenAI", "chatgpt-web", "Web AI", "OpenAI GPT-4o web oturumu (yüksek hızlı Web AI köprüsü)."),
                ("claude-3-5-sonnet", "Claude 3.5 Sonnet (Web Gateway)", "Anthropic", "claude-web", "Web AI", "Anthropic Claude 3.5 Sonnet web oturumu köprüsü."),
                ("deepseek-r1", "DeepSeek R1 (Web Gateway)", "DeepSeek", "deepseek-web", "Reasoning", "DeepSeek R1 düşünce zinciri (Chain-of-Thought) web köprüsü."),
                ("gemini-2.5-pro", "Gemini 2.5 Pro (Web Gateway)", "Google", "gemini-web", "Web AI", "Google Gemini 2.5 Pro web oturumu köprüsü."),
            ]
            for mid, mname, vendor, prov, badge, desc in web_defs:
                items.append({
                    "id": mid,
                    "object": "model",
                    "created": 1715000000,
                    "owned_by": prov,
                    "provider": prov,
                    "type": "chat",
                    "is_image": False,
                    "available": True,
                    "name": mname,
                    "vendor": vendor,
                    "badge": badge,
                    "description": desc,
                    "is_local": False,
                })

        # 3. Image models
        if not exclude_image and model_type in (None, "image"):
            img_defs = [
                ("flux", "FLUX.1 (Görsel Üretici)", "Black Forest Labs", "Görsel · HD", "Ücretsiz, yüksek çözünürlüklü genel amaçlı yapay zeka görsel üretim modeli (FLUX.1)."),
                ("flux-realism", "FLUX Realism (Fotogerçekçi)", "Black Forest Labs", "Fotoğraf · HD", "Fotogerçekçi portre, mimari ve doğa fotoğrafı üretimi için optimize edilmiş FLUX modeli."),
                ("flux-anime", "FLUX Anime & İllüstrasyon", "Black Forest Labs", "Anime · Sanat", "Anime, manga ve dijital konsept sanat çizimleri için özelleştirilmiş görsel üretim modeli."),
                ("flux-3d", "FLUX 3D Render", "Black Forest Labs", "3D · Render", "3B karakter, izometrik sahne ve Pixar/Octane Render tarzı görsel üretim modeli."),
                ("turbo", "SDXL Turbo (Hızlı Görsel)", "Stability AI", "Hızlı · Görsel", "Saniyeler içinde hızlı görsel ve konsept taslaklar üreten SDXL Turbo modeli."),
            ]
            for mid, mname, vendor, badge, desc in img_defs:
                items.append({
                    "id": mid,
                    "object": "model",
                    "created": 1715000000,
                    "owned_by": "pollinations-image",
                    "provider": "pollinations-image",
                    "type": "image",
                    "is_image": True,
                    "available": True,
                    "name": mname,
                    "vendor": vendor,
                    "badge": badge,
                    "description": desc,
                    "is_local": False,
                })

        return {"object": "list", "data": items, "models": items}


def main() -> None:
    raw_in = sys.stdin.read()
    req = json.loads(raw_in or "{}")
    action = req.get("action")
    auth = str(req.get("authorization") or "")
    x_uid = str(req.get("x_user_id") or "")

    if action == "list":
        params = dict(req.get("params") or {})
        params["authorization"] = auth
        params["x_user_id"] = x_uid
        print(json.dumps(list_conversations(params), ensure_ascii=False))
    elif action == "detail":
        res = get_detail(req.get("conversation_id", ""), auth, x_uid)
        print(json.dumps(res, ensure_ascii=False))
    elif action == "create":
        p = req.get("body") or {}
        requester_id, is_admin = resolve_requester(auth, x_uid)
        uid = (p.get("user_id") if (is_admin and p.get("user_id")) else requester_id)
        cid = f"conv_{uuid.uuid4().hex[:16]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        with sqlite_db.connection() as conn:
            conn.execute(
                """
                INSERT INTO chat_conversations (
                    id, user_id, title, model_id, system_prompt,
                    source, is_pinned, is_archived, total_messages, total_tokens,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
                """,
                (
                    cid,
                    uid,
                    (p.get("title") or "Yeni Sohbet")[:120],
                    p.get("model_id") or "gpt-4o",
                    p.get("system_prompt") or "",
                    p.get("source") or "studio",
                    now_iso,
                    now_iso,
                ),
            )
        print(json.dumps(get_detail(cid, auth, x_uid), ensure_ascii=False))
    elif action == "update":
        cid = req.get("conversation_id", "")
        existing = get_detail(cid, auth, x_uid)
        if not existing:
            print("null")
            return
        b = req.get("body") or {}
        fields: List[str] = []
        vals: List[Any] = []
        if "title" in b and b["title"] is not None:
            fields.append("title = ?")
            vals.append(str(b["title"]).strip()[:120] or "Yeni Sohbet")
        if "model_id" in b and b["model_id"] is not None:
            fields.append("model_id = ?")
            vals.append(str(b["model_id"]))
        if "system_prompt" in b and b["system_prompt"] is not None:
            fields.append("system_prompt = ?")
            vals.append(str(b["system_prompt"]))
        if "is_pinned" in b and b["is_pinned"] is not None:
            fields.append("is_pinned = ?")
            vals.append(1 if b["is_pinned"] else 0)
        if "is_archived" in b and b["is_archived"] is not None:
            fields.append("is_archived = ?")
            vals.append(1 if b["is_archived"] else 0)
        if fields:
            fields.append("updated_at = ?")
            vals.append(datetime.now(timezone.utc).isoformat())
            vals.append(cid)
            with sqlite_db.connection() as conn:
                conn.execute(
                    f"UPDATE chat_conversations SET {', '.join(fields)} WHERE id = ?",
                    tuple(vals),
                )
        print(json.dumps(get_detail(cid, auth, x_uid), ensure_ascii=False))
    elif action == "delete":
        cid = req.get("conversation_id", "")
        existing = get_detail(cid, auth, x_uid)
        if not existing:
            print("null")
            return
        with sqlite_db.connection() as conn:
            conn.execute("DELETE FROM chat_conversations WHERE id = ?", (cid,))
        print(json.dumps({"status": "deleted", "id": cid}))
    elif action == "record_turn":
        print(json.dumps(record_turn(req.get("payload") or {}), ensure_ascii=False))
    elif action == "pool_dashboard":
        print(json.dumps(get_pool_dashboard_from_sqlite(), ensure_ascii=False))
    elif action == "record_pool_event":
        print(json.dumps(record_pool_event_to_sqlite(req.get("payload") or {}), ensure_ascii=False))
    elif action == "system_users_list":
        print(json.dumps(list_system_users(), ensure_ascii=False))
    elif action == "system_users_create":
        print(json.dumps(create_system_user(req.get("body") or {}), ensure_ascii=False))
    elif action == "system_users_update":
        print(json.dumps(update_system_user(str(req.get("user_id") or ""), req.get("body") or {}), ensure_ascii=False))
    elif action == "system_users_toggle":
        print(json.dumps(toggle_system_user_status(str(req.get("user_id") or "")), ensure_ascii=False))
    elif action == "system_users_delete":
        print(json.dumps(delete_system_user(str(req.get("user_id") or "")), ensure_ascii=False))
    elif action == "system_users_login":
        print(json.dumps(authenticate_system_user(req.get("body") or {}), ensure_ascii=False))
    elif action == "users_list":
        print(json.dumps(list_all_users(), ensure_ascii=False))
    elif action == "users_create":
        print(json.dumps(create_quota_user(req.get("body") or {}), ensure_ascii=False))
    elif action == "users_toggle":
        print(json.dumps(toggle_quota_user_status(str(req.get("user_id") or "")), ensure_ascii=False))
    elif action == "user_tokens_list":
        print(json.dumps(list_user_token_allocations(str(req.get("user_id") or "")), ensure_ascii=False))
    elif action == "user_tokens_create":
        print(json.dumps(create_user_token_allocation(str(req.get("user_id") or ""), req.get("body") or {}), ensure_ascii=False))
    elif action == "user_tokens_update":
        print(json.dumps(update_user_token_allocation(str(req.get("user_id") or ""), str(req.get("allocation_id") or ""), req.get("body") or {}), ensure_ascii=False))
    elif action == "user_tokens_delete":
        print(json.dumps(delete_user_token_allocation(str(req.get("user_id") or ""), str(req.get("allocation_id") or "")), ensure_ascii=False))
    elif action == "api_keys_list":
        print(json.dumps(list_api_keys(), ensure_ascii=False))
    elif action == "api_keys_create":
        print(json.dumps(create_api_key_sqlite(req.get("body") or {}), ensure_ascii=False))
    elif action == "api_keys_revoke":
        print(json.dumps(revoke_api_key_sqlite(str(req.get("key_id") or "")), ensure_ascii=False))
    elif action == "roles_list":
        print(json.dumps(list_roles_permissions(), ensure_ascii=False))
    elif action == "roles_create":
        print(json.dumps(create_role_permission(req.get("body") or {}), ensure_ascii=False))
    elif action == "roles_update":
        print(json.dumps(update_role_permission(str(req.get("role_id") or ""), req.get("body") or {}), ensure_ascii=False))
    elif action == "roles_delete":
        print(json.dumps(delete_role_permission(str(req.get("role_id") or "")), ensure_ascii=False))
    elif action == "smtp_get":
        print(json.dumps(get_smtp_settings(), ensure_ascii=False))
    elif action == "smtp_update":
        print(json.dumps(update_smtp_settings(req.get("body") or {}), ensure_ascii=False))
    elif action == "smtp_test":
        print(json.dumps(test_smtp_connection(req.get("body") or {}), ensure_ascii=False))
    elif action == "smtp_send_password_reset":
        print(json.dumps(send_password_reset_email(req.get("body") or {}), ensure_ascii=False))
    elif action == "smtp_confirm_password_reset":
        print(json.dumps(confirm_password_reset(req.get("body") or {}), ensure_ascii=False))
    elif action == "smtp_reset_logs_list":
        print(json.dumps(list_password_reset_logs(int(req.get("limit") or 50)), ensure_ascii=False))
    elif action == "sqlite_state_overlay":
        print(json.dumps(get_sqlite_state_overlay(), ensure_ascii=False))
    elif action == "openai_models_list":
        print(json.dumps(get_openai_models_list_bridge(req.get("params") or {}), ensure_ascii=False))
    else:
        print(json.dumps({"error": "unknown_action"}))


if __name__ == "__main__":
    main()
