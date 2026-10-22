import uuid
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional
from app.dtos.conversation_dto import (
    ConversationDetailDTO,
    ConversationMessageDTO,
    ConversationSummaryDTO,
    ExtractedAttachmentInputDTO,
    MessageAttachmentDTO,
    UpdateConversationRequestDTO,
)
from app.repositories.sqlite_db import sqlite_db


class ConversationRepository:
    """
    Sohbet oturumları (chat_conversations), mesajlar (chat_messages) ve
    ekli dosya kayıtları (chat_message_attachments) için ilişkisel SQLite veri erişim katmanı.
    """

    def create_conversation(
        self,
        user_id: str,
        title: str = "Yeni Sohbet",
        model_id: str = "gpt-4o",
        system_prompt: str = "",
        source: Literal["studio", "api"] = "studio",
        conversation_id: Optional[str] = None,
    ) -> ConversationSummaryDTO:
        """Yeni bir sohbet oturumu kaydı oluşturur ve özet DTO olarak döner."""
        conv_id = conversation_id or f"conv_{uuid.uuid4().hex[:16]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        clean_title = (title or "Yeni Sohbet").strip()[:120]

        with sqlite_db.connection() as conn:
            conn.execute(
                """
                INSERT INTO chat_conversations (
                    id, user_id, title, model_id, system_prompt,
                    source, is_pinned, is_archived, total_messages, total_tokens,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
                """,
                (conv_id, user_id, clean_title, model_id, system_prompt, source, now_iso, now_iso),
            )
        summary = self.get_conversation_summary(conv_id)
        if not summary:
            raise RuntimeError("Sohbet oturumu oluşturulamadı.")
        return summary

    def ensure_conversation(
        self,
        conversation_id: Optional[str],
        user_id: str,
        model_id: str,
        system_prompt: str = "",
        source: Literal["studio", "api"] = "api",
        initial_title: str = "Yeni Sohbet",
    ) -> ConversationSummaryDTO:
        """Belirtilen ID ile oturum varsa döner, yoksa yeni oturum oluşturur."""
        if conversation_id:
            existing = self.get_conversation_summary(conversation_id)
            if existing:
                return existing
        return self.create_conversation(
            user_id=user_id,
            title=initial_title,
            model_id=model_id,
            system_prompt=system_prompt,
            source=source,
            conversation_id=conversation_id,
        )

    def append_message(
        self,
        conversation_id: str,
        user_id: str,
        role: Literal["system", "user", "assistant", "developer", "tool"],
        model_id: str,
        content: str,
        request_id: Optional[str] = None,
        provider: str = "",
        attachments: Optional[List[ExtractedAttachmentInputDTO]] = None,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        latency_ms: int = 0,
        ttft_ms: int = 0,
        status: str = "success",
        error_detail: str = "",
        auto_update_title: bool = False,
    ) -> ConversationMessageDTO:
        """
        Sohbet oturumuna yeni bir mesaj (ve varsa ekli dosya isimlerini) kaydeder,
        oturumun mesaj/token sayaçlarını ve son güncellenme zamanını atomik olarak günceller.
        """
        msg_id = f"msg_{uuid.uuid4().hex[:16]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        total_tokens = max(0, prompt_tokens) + max(0, completion_tokens)
        att_list = attachments or []

        with sqlite_db.connection() as conn:
            conn.execute(
                """
                INSERT INTO chat_messages (
                    id, conversation_id, request_id, user_id, role,
                    model_id, provider, content,
                    prompt_tokens, completion_tokens, total_tokens,
                    latency_ms, ttft_ms, status, error_detail, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    msg_id,
                    conversation_id,
                    request_id,
                    user_id,
                    role,
                    model_id,
                    provider,
                    content,
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                    latency_ms,
                    ttft_ms,
                    status,
                    error_detail,
                    now_iso,
                ),
            )

            saved_attachments: List[MessageAttachmentDTO] = []
            for att in att_list:
                att_id = f"att_{uuid.uuid4().hex[:14]}"
                conn.execute(
                    """
                    INSERT INTO chat_message_attachments (
                        id, message_id, conversation_id, user_id,
                        file_name, file_kind, mime_type, file_size,
                        estimated_tokens, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        att_id,
                        msg_id,
                        conversation_id,
                        user_id,
                        att.file_name,
                        att.file_kind,
                        att.mime_type,
                        att.file_size,
                        att.estimated_tokens,
                        now_iso,
                    ),
                )
                saved_attachments.append(
                    MessageAttachmentDTO(
                        id=att_id,
                        message_id=msg_id,
                        conversation_id=conversation_id,
                        user_id=user_id,
                        file_name=att.file_name,
                        file_kind=att.file_kind,
                        mime_type=att.mime_type,
                        file_size=att.file_size,
                        estimated_tokens=att.estimated_tokens,
                        created_at=now_iso,
                    )
                )

            if auto_update_title and role == "user":
                cur_row = conn.execute(
                    "SELECT title FROM chat_conversations WHERE id = ?",
                    (conversation_id,),
                ).fetchone()
                if cur_row and cur_row["title"] in ("Yeni Sohbet", "New Chat", "API Sohbeti"):
                    derived = self._derive_title_from_prompt(content, att_list)
                    conn.execute(
                        "UPDATE chat_conversations SET title = ? WHERE id = ?",
                        (derived, conversation_id),
                    )

            conn.execute(
                """
                UPDATE chat_conversations
                SET model_id = ?,
                    total_messages = total_messages + 1,
                    total_tokens = total_tokens + ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (model_id, total_tokens, now_iso, conversation_id),
            )

            user_row = conn.execute(
                "SELECT email, full_name FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()

        return ConversationMessageDTO(
            id=msg_id,
            conversation_id=conversation_id,
            request_id=request_id,
            user_id=user_id,
            user_email=user_row["email"] if user_row else user_id,
            user_full_name=user_row["full_name"] if user_row else user_id,
            role=role,
            model_id=model_id,
            provider=provider,
            content=content,
            attachments=saved_attachments,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_ms=latency_ms,
            ttft_ms=ttft_ms,
            status=status,
            error_detail=error_detail,
            created_at=now_iso,
        )

    def list_conversations(
        self,
        user_id: Optional[str] = None,
        model_id: Optional[str] = None,
        source: Optional[str] = None,
        search: Optional[str] = None,
        search_field: Optional[str] = None,
        is_archived: bool = False,
        sort_field: Optional[str] = None,
        sort_order: str = "desc",
        limit: int = 100,
        offset: int = 0,
    ) -> List[ConversationSummaryDTO]:
        """Filtrelere ve sıralama ölçütlerine göre sohbet oturumlarını kullanıcı ve dosya eki bilgileriyle listeler."""
        clauses = ["c.is_archived = ?"]
        params: List[object] = [1 if is_archived else 0]

        if user_id:
            clauses.append("c.user_id = ?")
            params.append(user_id)
        if model_id:
            clauses.append("c.model_id = ?")
            params.append(model_id)
        if source and source in ("studio", "api"):
            clauses.append("c.source = ?")
            params.append(source)
        if search and search.strip():
            q = f"%{search.strip()}%"
            sf = (search_field or "Tumu").strip()
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
                        OR EXISTS (
                            SELECT 1 FROM chat_messages m
                            WHERE m.conversation_id = c.id AND m.content LIKE ?
                        )
                        OR EXISTS (
                            SELECT 1 FROM chat_message_attachments a
                            WHERE a.conversation_id = c.id AND a.file_name LIKE ?
                        )
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
        sort_col = sort_map.get(sort_field or "", "c.updated_at")
        direction = "ASC" if str(sort_order).lower() == "asc" else "DESC"

        where_sql = " AND ".join(clauses)
        params.extend([max(1, limit), max(0, offset)])

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
                        SELECT m.content
                        FROM chat_messages m
                        WHERE m.conversation_id = c.id
                        ORDER BY m.created_at DESC, m.rowid DESC
                        LIMIT 1
                    ) AS last_message_preview
                FROM chat_conversations c
                LEFT JOIN users u ON u.id = c.user_id
                WHERE {where_sql}
                ORDER BY c.is_pinned DESC, {sort_col} {direction}
                LIMIT ? OFFSET ?
                """,
                tuple(params),
            ).fetchall()

            conv_ids = [r["id"] for r in rows]
            att_map = self._fetch_attachment_names_by_conversations(conn, conv_ids)

        results: List[ConversationSummaryDTO] = []
        for r in rows:
            cid = r["id"]
            preview = (r["last_message_preview"] or "").strip()
            if len(preview) > 140:
                preview = preview[:140] + "…"
            results.append(
                ConversationSummaryDTO(
                    id=cid,
                    user_id=r["user_id"],
                    user_email=r["user_email"],
                    user_full_name=r["user_full_name"],
                    title=r["title"],
                    model_id=r["model_id"],
                    system_prompt=r["system_prompt"] or "",
                    source="api" if r["source"] == "api" else "studio",
                    is_pinned=bool(r["is_pinned"]),
                    is_archived=bool(r["is_archived"]),
                    total_messages=r["total_messages"],
                    total_tokens=r["total_tokens"],
                    attachment_names=att_map.get(cid, []),
                    last_message_preview=preview,
                    created_at=r["created_at"],
                    updated_at=r["updated_at"],
                )
            )
        return results

    def get_conversation_summary(self, conversation_id: str) -> Optional[ConversationSummaryDTO]:
        """Tek bir sohbet oturumunun özet bilgilerini döner."""
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
                        SELECT m.content
                        FROM chat_messages m
                        WHERE m.conversation_id = c.id
                        ORDER BY m.created_at DESC, m.rowid DESC
                        LIMIT 1
                    ) AS last_message_preview
                FROM chat_conversations c
                LEFT JOIN users u ON u.id = c.user_id
                WHERE c.id = ?
                """,
                (conversation_id,),
            ).fetchone()
            if not row:
                return None
            att_map = self._fetch_attachment_names_by_conversations(conn, [conversation_id])

        preview = (row["last_message_preview"] or "").strip()
        if len(preview) > 140:
            preview = preview[:140] + "…"
        return ConversationSummaryDTO(
            id=row["id"],
            user_id=row["user_id"],
            user_email=row["user_email"],
            user_full_name=row["user_full_name"],
            title=row["title"],
            model_id=row["model_id"],
            system_prompt=row["system_prompt"] or "",
            source="api" if row["source"] == "api" else "studio",
            is_pinned=bool(row["is_pinned"]),
            is_archived=bool(row["is_archived"]),
            total_messages=row["total_messages"],
            total_tokens=row["total_tokens"],
            attachment_names=att_map.get(conversation_id, []),
            last_message_preview=preview,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def get_conversation_detail(self, conversation_id: str) -> Optional[ConversationDetailDTO]:
        """Sohbet oturumunu tüm sıralı mesajları ve dosya ekleriyle birlikte döner."""
        summary = self.get_conversation_summary(conversation_id)
        if not summary:
            return None

        with sqlite_db.connection() as conn:
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
                SELECT
                    id, message_id, conversation_id, user_id,
                    file_name, file_kind, mime_type, file_size,
                    estimated_tokens, created_at
                FROM chat_message_attachments
                WHERE conversation_id = ?
                ORDER BY created_at ASC, rowid ASC
                """,
                (conversation_id,),
            ).fetchall()

        attachments_by_msg: Dict[str, List[MessageAttachmentDTO]] = {}
        for ar in att_rows:
            mid = ar["message_id"]
            attachments_by_msg.setdefault(mid, []).append(
                MessageAttachmentDTO(
                    id=ar["id"],
                    message_id=mid,
                    conversation_id=ar["conversation_id"],
                    user_id=ar["user_id"],
                    file_name=ar["file_name"],
                    file_kind="image" if ar["file_kind"] == "image" else "document",
                    mime_type=ar["mime_type"] or "",
                    file_size=ar["file_size"] or 0,
                    estimated_tokens=ar["estimated_tokens"] or 0,
                    created_at=ar["created_at"],
                )
            )

        messages: List[ConversationMessageDTO] = []
        for mr in msg_rows:
            mid = mr["id"]
            messages.append(
                ConversationMessageDTO(
                    id=mid,
                    conversation_id=mr["conversation_id"],
                    request_id=mr["request_id"],
                    user_id=mr["user_id"],
                    user_email=mr["user_email"],
                    user_full_name=mr["user_full_name"],
                    role=mr["role"],
                    model_id=mr["model_id"],
                    provider=mr["provider"] or "",
                    content=mr["content"],
                    attachments=attachments_by_msg.get(mid, []),
                    prompt_tokens=mr["prompt_tokens"],
                    completion_tokens=mr["completion_tokens"],
                    total_tokens=mr["total_tokens"],
                    latency_ms=mr["latency_ms"],
                    ttft_ms=mr["ttft_ms"],
                    status=mr["status"] or "success",
                    error_detail=mr["error_detail"] or "",
                    created_at=mr["created_at"],
                )
            )

        return ConversationDetailDTO(
            **summary.model_dump(),
            messages=messages,
        )

    def update_conversation(
        self,
        conversation_id: str,
        dto: UpdateConversationRequestDTO,
    ) -> Optional[ConversationSummaryDTO]:
        """Sohbet oturumu başlığını, modelini, sistem yönergesini veya sabitleme durumunu günceller."""
        fields: List[str] = []
        params: List[object] = []

        if dto.title is not None:
            fields.append("title = ?")
            params.append(dto.title.strip()[:120] or "Yeni Sohbet")
        if dto.model_id is not None:
            fields.append("model_id = ?")
            params.append(dto.model_id)
        if dto.system_prompt is not None:
            fields.append("system_prompt = ?")
            params.append(dto.system_prompt)
        if dto.is_pinned is not None:
            fields.append("is_pinned = ?")
            params.append(1 if dto.is_pinned else 0)
        if dto.is_archived is not None:
            fields.append("is_archived = ?")
            params.append(1 if dto.is_archived else 0)

        if not fields:
            return self.get_conversation_summary(conversation_id)

        fields.append("updated_at = ?")
        params.append(datetime.now(timezone.utc).isoformat())
        params.append(conversation_id)

        with sqlite_db.connection() as conn:
            conn.execute(
                f"UPDATE chat_conversations SET {', '.join(fields)} WHERE id = ?",
                tuple(params),
            )
        return self.get_conversation_summary(conversation_id)

    def delete_conversation(self, conversation_id: str) -> bool:
        """Sohbet oturumunu, ilişkili tüm mesajlarını ve dosya eklerini (CASCADE) siler."""
        with sqlite_db.connection() as conn:
            cursor = conn.execute(
                "DELETE FROM chat_conversations WHERE id = ?",
                (conversation_id,),
            )
            return cursor.rowcount > 0

    @staticmethod
    def _fetch_attachment_names_by_conversations(
        conn,
        conversation_ids: List[str],
    ) -> Dict[str, List[str]]:
        """Verilen oturum ID listesi için gönderilmiş tekil dosya isimlerini toplar."""
        if not conversation_ids:
            return {}
        placeholders = ",".join("?" for _ in conversation_ids)
        rows = conn.execute(
            f"""
            SELECT conversation_id, file_name
            FROM chat_message_attachments
            WHERE conversation_id IN ({placeholders})
            ORDER BY created_at ASC, rowid ASC
            """,
            tuple(conversation_ids),
        ).fetchall()

        result: Dict[str, List[str]] = {}
        for r in rows:
            cid = r["conversation_id"]
            fname = r["file_name"]
            bucket = result.setdefault(cid, [])
            if fname and fname not in bucket:
                bucket.append(fname)
        return result

    @staticmethod
    def _derive_title_from_prompt(
        content: str,
        attachments: List[ExtractedAttachmentInputDTO],
    ) -> str:
        """Kullanıcının ilk mesajından veya gönderdiği dosya adından anlamlı bir sohbet başlığı üretir."""
        clean = " ".join((content or "").strip().split())
        if clean:
            return clean[:65] + ("…" if len(clean) > 65 else "")
        if attachments:
            return f"Dosya Analizi: {attachments[0].file_name}"[:65]
        return "Yeni Sohbet"
