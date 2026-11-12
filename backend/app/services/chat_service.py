"""
ThinkPort AI Gateway - Sohbet Tamamlama Orkestrasyon Servisi (chat_service.py).
OpenAI uyumlu /v1/chat/completions isteklerinin hazırlanmasını, sohbet geçmişinin (kullanıcı istemi,
ekli dosyalar ve model yanıtlarının) SQLite veritabanına anlık kaydedilmesini ve SSE/senkron akışını yönetir.
"""
from __future__ import annotations
import asyncio
import json
import re
import time
import uuid
from typing import AsyncGenerator, Callable, Dict, Any, List, Optional, Tuple, Union
from app.core.config import settings
from app.core.exceptions import gateway_timeout_error
from app.core.logger import gateway_logger
from app.dtos.chat_dto import (
    ChatCompletionRequestDTO,
    ChatCompletionResponseDTO,
    ChatCompletionChoiceDTO,
    ChatCompletionChunkDTO,
    ChatCompletionChunkChoiceDTO,
    DeltaMessageDTO,
    ChatMessageDTO,
    CompletionUsageDTO,
    PreparedMessagesDTO,
    ChatJobDTO,
)
from app.dtos.model_dto import ModelDefinitionDTO
from app.dtos.user_dto import AuthenticatedUserContextDTO
from app.dtos.admin_dto import RecordUsageInputDTO
from app.repositories.session_repository import SessionRepository
from app.repositories.telemetry_repository import StreamChannelRepository
from app.repositories.conversation_repository import (
    ConversationRepository,
    conversation_event_broadcaster,
)
from app.services.auth_service import AuthService
from app.services.model_service import ModelService
from app.services.message_formatter_service import MessageFormatterService
from app.services.llm_provider_service import LlmProviderService
from app.services.image_service import ImageService
from app.services.document_service import DocumentService
from app.services.agent_memory_service import (
    agent_memory_service,
    GATEWAY_MEMORY_TOOL_NAMES,
)
from app.repositories.postgres_db import postgres_db


class ChatService:
    """
    Sohbet tamamlama (Chat Completions) orkestrasyon servisi.
    İstek hazırlama, veritabanına kullanıcı istemi/dosya eki/model yanıtı kaydetme,
    arka plan işçisi (worker) çalıştırma, SSE akışı ve senkron yanıt toplama
    sorumluluklarını tek görevli metotlara ayırır.
    """

    def __init__(
        self,
        auth_service: AuthService,
        model_service: ModelService,
        formatter_service: MessageFormatterService,
        llm_provider: LlmProviderService,
        image_service: ImageService,
        session_repo: SessionRepository,
        channel_repo: StreamChannelRepository,
        conversation_repo: ConversationRepository,
        record_usage_fn: Callable[[RecordUsageInputDTO], None],
    ) -> None:
        self._auth_service = auth_service
        self._model_service = model_service
        self._formatter = formatter_service
        self._llm_provider = llm_provider
        self._image_service = image_service
        self._session_repo = session_repo
        self._channel_repo = channel_repo
        self._conversation_repo = conversation_repo
        self._record_usage = record_usage_fn
        self._job_finish_reasons: Dict[str, str] = {}

    def initiate_chat_job(
        self,
        request: ChatCompletionRequestDTO,
        user_ctx: AuthenticatedUserContextDTO,
    ) -> ChatJobDTO:
        """
        Eşzamanlılık slotu ayırır, model takma adını (alias) normalize eder,
        sohbet oturumunu ve kullanıcının mesajını SQLite veritabanına kaydeder,
        yayın kanalını açar ve arka plan AI görevini başlatır.
        """
        self._auth_service.acquire_concurrency_slot(user_ctx)
        normalized_model = self._model_service.normalize_model_id(request.model)
        provider = self._model_service.resolve_provider_for_model(normalized_model)
        normalized_rf = request.normalized_response_format()
        job_id = f"chatcmpl-{uuid.uuid4().hex[:20]}"

        effective_app_id = (request.app_id or getattr(user_ctx, "app_id", None) or "").strip()
        effective_agent_id = (
            request.agent_id
            or request.agent_code
            or getattr(user_ctx, "agent_id", None)
            or ""
        ).strip()
        norm_app, norm_agent = agent_memory_service.normalize_identity(
            effective_app_id,
            effective_agent_id,
        )
        if norm_app and not request.app_id:
            request.app_id = norm_app
        if norm_agent and not request.agent_id:
            request.agent_id = norm_agent
        clean_user_text, attachments, system_prompt = (
            self._formatter.extract_last_user_message_details(request.messages)
        )
        upper_sys = (system_prompt or "").upper()
        upper_usr = (clean_user_text or "").upper()
        is_explicit_no_tools = (
            isinstance(request.tool_choice, str)
            and request.tool_choice.strip().lower() == "none"
        )
        is_pure_extraction_without_tools = (
            not request.tools
            and (
                bool(attachments)
                or "AKIŞ HAFIZA & SCRIPT HATTI AKTİF" in upper_sys
                or "ARAÇ ÇAĞIRMA" in upper_sys
                or "ARAÇ ÇAĞIRMAYINIZ" in upper_sys
                or "SADECE CSV" in upper_sys
                or "SADECE CSV" in upper_usr
                or "ARAÇ ÇAĞIRMA" in upper_usr
            )
        )
        if is_explicit_no_tools or is_pure_extraction_without_tools:
            request.tools = None
            request.tool_choice = None

        gozlemci_aktif_mi = True
        if norm_agent:
            agent_cfg = agent_memory_service.ensure_agent_registered_and_get_config(
                app_id=norm_app,
                agent_id=norm_agent,
                agent_name=request.agent_name,
                model_id=normalized_model,
            )
            gozlemci_aktif_mi = bool(agent_cfg.get("gozlemci_aktif_mi", True))
            if not (is_explicit_no_tools or is_pure_extraction_without_tools):
                injected_tools, mem_instruction = (
                    agent_memory_service.inject_memory_tools_and_instructions(
                        existing_tools=request.tools,
                        app_id=norm_app,
                        agent_id=norm_agent,
                        agent_config=agent_cfg,
                    )
                )
                if injected_tools:
                    request.tools = injected_tools
                if mem_instruction and request.messages:
                    sys_msg = next((m for m in request.messages if m.role in ("system", "developer")), None)
                    if sys_msg and isinstance(sys_msg.content, str):
                        if "thinkport_memory_search" not in sys_msg.content:
                            sys_msg.content = f"{sys_msg.content.rstrip()}{mem_instruction}"
                    else:
                        request.messages.insert(
                            0,
                            ChatMessageDTO(role="system", content=mem_instruction.strip()),
                        )

        prompt_tokens = self._formatter.estimate_prompt_tokens(request.messages)
        source = (
            "studio"
            if request.source == "studio"
            or (
                request.source is None
                and bool(request.conversation_id)
                and request.conversation_id.startswith("conv_")
            )
            else "api"
        )
        initial_title = ConversationRepository._derive_title_from_prompt(
            clean_user_text, attachments
        )

        conversation = self._conversation_repo.ensure_conversation(
            conversation_id=request.conversation_id,
            user_id=user_ctx.user_id,
            model_id=normalized_model,
            system_prompt=system_prompt,
            source=source,
            initial_title=initial_title,
        )
        if norm_agent:
            try:
                with postgres_db.connection() as conn:
                    conn.execute(
                        "UPDATE chat_conversations SET app_id = ?, agent_id = ? WHERE id = ?",
                        (norm_app, norm_agent, conversation.id),
                    )
            except Exception:
                pass

        last_msg = request.messages[-1] if request.messages else None
        if last_msg and last_msg.role == "tool":
            incoming_role = "tool"
            tool_content = str(last_msg.content or "")
            tool_name = last_msg.name or "tool"
            tool_call_id_str = last_msg.tool_call_id or ""
            incoming_content = (
                f"[{tool_name}" + (f" | call_id={tool_call_id_str}" if tool_call_id_str else "") + f"]: {tool_content}"
                if tool_content
                else f"[{tool_name}]"
            )
            auto_title = False
        else:
            incoming_role = "user"
            incoming_content = clean_user_text
            auto_title = not (
                incoming_content.startswith("[OTOMATİK DEVAM")
                or incoming_content.startswith("[GOZLEMCI_AJAN")
            )

        sanitized_incoming_messages: List[Dict[str, Any]] = []
        for m in request.messages:
            md = m.model_dump(exclude_none=True)
            if isinstance(md.get("content"), list):
                clean_parts: List[Dict[str, Any]] = []
                for p in md["content"]:
                    if isinstance(p, dict) and p.get("type") in ("file", "document", "input_file"):
                        fname, mime_type, fsize, est_tokens, resolved_doc_txt = (
                            self._formatter.resolve_document_part(p)
                        )
                        has_raw_file = bool(
                            p.get("file_data")
                            or p.get("base64_data")
                            or p.get("data_url")
                            or (isinstance(p.get("file"), dict) and p["file"].get("file_data"))
                        )
                        p_copy = {
                            "type": p.get("type", "file"),
                            "file_name": fname,
                            "mime_type": mime_type,
                            "file_size": fsize,
                            "estimated_tokens": est_tokens,
                            "extracted_chars": len(resolved_doc_txt),
                            "sent_as_raw_attachment": has_raw_file,
                        }
                        clean_parts.append(p_copy)
                    else:
                        clean_parts.append(p)
                md["content"] = clean_parts
            sanitized_incoming_messages.append(md)

        outgoing_raw_payload: Dict[str, Any] = {
            "direction": "OUTGOING_REQUEST",
            "request_id": job_id,
            "conversation_id": conversation.id,
            "source": source,
            "requested_model": request.model,
            "resolved_model": normalized_model,
            "provider": provider,
            "stream": bool(request.stream),
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "response_format": normalized_rf,
            "system_prompt": system_prompt,
            "tools_count": len(request.tools or []),
            "tools": request.tools or [],
            "tool_choice": request.tool_choice,
            "incoming_messages_count": len(request.messages),
            "incoming_messages": sanitized_incoming_messages,
            "attachments": [
                {
                    "file_name": a.file_name,
                    "file_kind": a.file_kind,
                    "mime_type": a.mime_type,
                    "file_size": a.file_size,
                    "estimated_tokens": a.estimated_tokens,
                    "extracted_chars": len(a.extracted_text or ""),
                    "extracted_text": a.extracted_text or "",
                }
                for a in attachments
            ],
            "prompt_tokens": prompt_tokens,
        }

        out_trace_lines: List[str] = [
            f"📤 [GİDEN LLM İSTEĞİ / OUTGOING PAYLOAD] (Rol: {incoming_role} | Kaynak: {source})",
            f"• İstek ID: {job_id} | İstenen Model: {request.model} -> Çözümlenen: {normalized_model} ({provider})",
            f"• İstek Parametreleri: stream={bool(request.stream)} | temperature={request.temperature} | max_tokens={request.max_tokens} | response_format={json.dumps(normalized_rf, ensure_ascii=False) if normalized_rf else 'text'} | Girdi Token={prompt_tokens}",
            f"• Geçmiş Mesaj Sayısı: {len(request.messages)} mesaj | Gönderilen Karakter: {len(incoming_content)} krk",
        ]
        if system_prompt:
            out_trace_lines.append(f"• Sistem Yönergesi (System Prompt - {len(system_prompt)} krk):\n{system_prompt}")
        if request.tools:
            tool_summaries = []
            for t_obj in request.tools:
                fn_obj = t_obj.get("function", {}) if isinstance(t_obj, dict) else {}
                t_name = fn_obj.get("name") or t_obj.get("name") or "tool"
                t_desc = fn_obj.get("description") or ""
                t_params = json.dumps(fn_obj.get("parameters", {}), ensure_ascii=False)
                tool_summaries.append(f"  - {t_name}: {t_desc} | Şema: {t_params}")
            out_trace_lines.append(
                f"• LLM'e Gönderilen Araç Tanımları (Tools - {len(request.tools)} adet | tool_choice={request.tool_choice or 'auto'}):\n"
                + "\n".join(tool_summaries)
            )
        if attachments:
            att_lines = []
            for a in attachments:
                ext_txt = (a.extracted_text or "").strip()
                att_lines.append(
                    f"  - 📎 {a.file_name} ({a.file_kind}, {a.mime_type or 'belge'}, {a.file_size} bayt, "
                    f"Çıkarılan Metin={len(ext_txt)} krk, ~{a.estimated_tokens} token)"
                )
                if ext_txt:
                    att_lines.append(f"    [LLM'e Aktarılan Belge Metni ({len(ext_txt)} krk)]:\n{ext_txt}")
            out_trace_lines.append(f"• Ekli Dosyalar ({len(attachments)} adet):\n" + "\n".join(att_lines))

        saved_user_msg = self._conversation_repo.append_message(
            conversation_id=conversation.id,
            user_id=user_ctx.user_id,
            role=incoming_role,
            model_id=normalized_model,
            content=incoming_content,
            request_id=job_id,
            provider=provider,
            thinking_content="\n".join(out_trace_lines),
            tool_calls_json=json.dumps(request.tools, ensure_ascii=False) if request.tools else "",
            raw_payload_json=json.dumps(outgoing_raw_payload, ensure_ascii=False),
            attachments=attachments if incoming_role == "user" else None,
            prompt_tokens=prompt_tokens,
            completion_tokens=0,
            auto_update_title=auto_title,
        )

        self._channel_repo.create_channel(job_id)
        job = ChatJobDTO(
            job_id=job_id,
            conversation_id=conversation.id,
            user_message_id=saved_user_msg.id,
            source=source,
            user_id=user_ctx.user_id,
            provider=provider,
            model=normalized_model,
            requested_model=request.model,
            messages=request.messages,
            tools=request.tools,
            tool_choice=request.tool_choice,
            prompt_tokens=prompt_tokens,
            response_format=normalized_rf,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            app_id=norm_app,
            agent_id=norm_agent,
            gozlemci_aktif_mi=gozlemci_aktif_mi,
        )
        gateway_logger.info(
            f"CHAT_START | id={job_id} | conv={conversation.id} | user={user_ctx.user_id} "
            f"| app={norm_app or '-'} | agent={norm_agent or '-'} "
            f"| requested_model={request.model} | resolved_model={normalized_model} "
            f"| tools={bool(request.tools)} "
            f"| json_mode={self._formatter.is_json_mode_requested(normalized_rf)} "
            f"| files={[a.file_name for a in attachments]} | stream={request.stream}"
        )
        asyncio.create_task(self._execute_ai_job(job))
        return job

    async def build_sync_response(
        self,
        job: ChatJobDTO,
        user_ctx: Optional[AuthenticatedUserContextDTO] = None,
    ) -> ChatCompletionResponseDTO:
        """
        Kanaldan tüm yanıt parçalarını toplar.
        1. Eğer model `thinkport_memory_*` hafıza aracını çağırdıysa, çağrıyı doğrudan Gateway (pgvector)
           içerisinde çalıştırıp sonucu modele geri besler.
        2. Eğer yanıt token sınırı nedeniyle yarıda kesildiyse ve Gözlemci Ajan (`GOZLEMCI_AJAN`) aktifse,
           otomatik devam istemi üreterek yanıtı birleştirir.
        """
        current_job = job
        full_content, completion_tokens, _, _, tool_calls, reasoning_text = await self._collect_full_response(current_job)

        # 1. Gateway-Seviyesi pgvector Ajan Hafızası Tool Call Yakalama (Maksimum 2 Tur)
        for _mem_step in range(2):
            if not tool_calls or not current_job.agent_id:
                break
            called_names = [
                str((tc.get("function") or {}).get("name") or "")
                for tc in tool_calls
                if isinstance(tc, dict)
            ]
            if not called_names or not all(n in GATEWAY_MEMORY_TOOL_NAMES for n in called_names):
                break

            followup_messages = list(current_job.messages)
            followup_messages.append(
                ChatMessageDTO(
                    role="assistant",
                    content=full_content or "",
                    tool_calls=tool_calls,
                )
            )
            for tc in tool_calls:
                fn = (tc.get("function") or {}) if isinstance(tc, dict) else {}
                fn_name = str(fn.get("name") or "")
                fn_args = fn.get("arguments")
                call_id = str(tc.get("id") or f"call_mem_{uuid.uuid4().hex[:8]}")
                tool_out = agent_memory_service.execute_gateway_memory_tool(
                    tool_name=fn_name,
                    raw_arguments=fn_args,
                    app_id=current_job.app_id,
                    agent_id=current_job.agent_id,
                    conversation_id=current_job.conversation_id,
                )
                followup_messages.append(
                    ChatMessageDTO(
                        role="tool",
                        name=fn_name,
                        tool_call_id=call_id,
                        content=tool_out,
                    )
                )

            if user_ctx is None:
                break

            followup_req = ChatCompletionRequestDTO(
                model=current_job.requested_model or current_job.model,
                messages=followup_messages,
                tools=current_job.tools,
                tool_choice=current_job.tool_choice,
                stream=False,
                temperature=current_job.temperature,
                max_tokens=current_job.max_tokens,
                response_format=current_job.response_format,
                conversation_id=current_job.conversation_id,
                source="api",
                app_id=current_job.app_id,
                agent_id=current_job.agent_id,
            )
            self._job_finish_reasons.pop(current_job.job_id, None)
            current_job = self.initiate_chat_job(followup_req, user_ctx)
            next_content, next_tokens, _, _, next_tcs, next_reasoning = await self._collect_full_response(current_job)
            full_content = next_content
            completion_tokens += next_tokens
            tool_calls = next_tcs
            if next_reasoning:
                reasoning_text = f"{reasoning_text}\n\n{next_reasoning}".strip() if reasoning_text else next_reasoning

        # 2. Gözlemci Ajan (GOZLEMCI_AJAN) — Tüm Modlarda (tool_calls, CSV, JSON, Metin/Kod) Evrensel Denetim ve Tamamlama
        actual_finish_reason = self._job_finish_reasons.pop(current_job.job_id, "stop")
        is_json_mode = self._formatter.is_json_mode_requested(current_job.response_format)
        if current_job.gozlemci_aktif_mi:
            pre_obs_content = full_content
            pre_obs_reasoning = reasoning_text
            pre_obs_tcs = json.dumps(tool_calls, ensure_ascii=False) if tool_calls else ""

            if tool_calls and isinstance(tool_calls, list) and len(tool_calls) > 0:
                tool_calls, added_tc_tokens, reasoning_text, _ = (
                    await self._run_tool_calls_observer_pipeline(
                        root_job=job,
                        current_job=current_job,
                        user_ctx=user_ctx,
                        tool_calls=tool_calls,
                        full_content=full_content or "",
                        reasoning_text=reasoning_text or "",
                        actual_finish_reason=actual_finish_reason,
                    )
                )
                completion_tokens += added_tc_tokens
            elif not tool_calls and (
                full_content
                or actual_finish_reason == "length"
                or bool(job.messages)
            ):
                (
                    full_content,
                    added_cont_tokens,
                    reasoning_text,
                    _,
                    _,
                ) = await self._run_content_observer_pipeline(
                    root_job=job,
                    current_job=current_job,
                    user_ctx=user_ctx,
                    full_content=full_content or "",
                    reasoning_text=reasoning_text or "",
                    actual_finish_reason=actual_finish_reason,
                    is_json_mode=is_json_mode,
                )
                completion_tokens += added_cont_tokens

            post_obs_tcs = json.dumps(tool_calls, ensure_ascii=False) if tool_calls else ""
            if (
                full_content != pre_obs_content
                or reasoning_text != pre_obs_reasoning
                or post_obs_tcs != pre_obs_tcs
            ):
                self._sync_observer_result_to_db(
                    job=current_job,
                    full_content=full_content or "",
                    reasoning_text=reasoning_text or "",
                    tool_calls=tool_calls,
                    completion_tokens=completion_tokens,
                )

        if is_json_mode and full_content:
            full_content = self._formatter.extract_and_normalize_json_content(full_content)
            completion_tokens = DocumentService.estimate_tokens(full_content)

        finish_reason = "tool_calls" if tool_calls else "stop"
        return ChatCompletionResponseDTO(
            id=current_job.job_id,
            model=current_job.model,
            conversation_id=current_job.conversation_id,
            choices=[
                ChatCompletionChoiceDTO(
                    index=0,
                    message=ChatMessageDTO(
                        role="assistant",
                        content=full_content if full_content else None,
                        reasoning_content=reasoning_text if reasoning_text else None,
                        thinking=reasoning_text if reasoning_text else None,
                        tool_calls=tool_calls,
                    ),
                    finish_reason=finish_reason,
                )
            ],
            usage=CompletionUsageDTO(
                prompt_tokens=current_job.prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=current_job.prompt_tokens + completion_tokens,
            ),
        )

    @staticmethod
    def _build_internal_continuation_user_ctx(
        job: ChatJobDTO,
        user_ctx: Optional[AuthenticatedUserContextDTO] = None,
    ) -> AuthenticatedUserContextDTO:
        """
        Gözlemci Ajanın tetiklediği iç devam (continuation) turları için üst isteğin
        eşzamanlılık slotuna takılmayan güvenli kullanıcı bağlamı oluşturur.
        """
        base_limit = user_ctx.concurrent_limit if user_ctx is not None else 5
        return AuthenticatedUserContextDTO(
            user_id=user_ctx.user_id if user_ctx is not None else job.user_id,
            email=user_ctx.email if user_ctx is not None else "observer@internal.local",
            api_key_id=user_ctx.api_key_id if user_ctx is not None else "internal_observer",
            token_quota=user_ctx.token_quota if user_ctx is not None else 999999999,
            tokens_used=user_ctx.tokens_used if user_ctx is not None else 0,
            rpm_limit=max(user_ctx.rpm_limit if user_ctx is not None else 1000, 1000),
            concurrent_limit=max(base_limit + 4, 10),
            app_id=job.app_id or (user_ctx.app_id if user_ctx is not None else None),
            agent_id=job.agent_id or (user_ctx.agent_id if user_ctx is not None else None),
            raw_api_key=user_ctx.raw_api_key if user_ctx is not None else None,
        )

    @staticmethod
    def _detect_content_output_mode(
        full_content: str,
        is_json_mode: bool,
        clean_user_text: str,
        system_prompt: str,
    ) -> str:
        """Üretilen metnin veya aktif istemin çıktı modunu ('csv', 'json', 'text') belirler."""
        if is_json_mode:
            return "json"

        non_fence_lines = [
            ln.strip()
            for ln in (full_content or "").splitlines()
            if ln.strip() and not ln.strip().startswith("```")
        ]
        upper_prompts = f"{system_prompt or ''}\n{clean_user_text or ''}".upper()
        csv_prompt_hint = any(
            kw in upper_prompts
            for kw in (
                "#META",
                "SADECE CSV",
                "URUNKODU;FIYAT",
                "ÜRÜNKODU;FIYAT",
                "NOKTALI VİRGÜL",
                "AKIŞ HAFIZA & SCRIPT HATTI AKTİF",
            )
        )

        stripped = (full_content or "").lstrip()
        is_json_shaped = (
            stripped.startswith("{")
            or stripped.startswith("[")
            or stripped.startswith("```json")
        )

        if non_fence_lines and not is_json_shaped:
            first_ln = non_fence_lines[0]
            semicolon_cnt = sum(1 for ln in non_fence_lines if ";" in ln)
            if (
                first_ln.upper().startswith("#META")
                or first_ln.upper().startswith("#TABLO")
                or semicolon_cnt >= 2
                or csv_prompt_hint
            ):
                return "csv"
        elif csv_prompt_hint and not is_json_shaped:
            return "csv"

        if is_json_shaped or (not stripped and "SADECE JSON" in upper_prompts):
            return "json"

        return "text"

    def _sync_observer_result_to_db(
        self,
        job: ChatJobDTO,
        full_content: str,
        reasoning_text: str,
        tool_calls: Optional[List[Dict[str, Any]]],
        completion_tokens: int,
    ) -> None:
        """
        Senkron akışta GOZLEMCI_AJAN birleştirme yaptıktan sonra `chat_messages` kaydını
        tamamlanmış içerik, araç çağrıları ve gözlemci denetim izleriyle günceller.
        """
        try:
            tc_list = tool_calls or []
            tc_json_str = json.dumps(tc_list, ensure_ascii=False, indent=2) if tc_list else ""
            tc_display_list = (
                self._formatter.expand_tool_calls_for_display(tc_list) if tc_list else []
            )
            tc_display_json_str = (
                json.dumps(tc_display_list, ensure_ascii=False, indent=2)
                if tc_display_list
                else ""
            )

            saved_content = full_content
            if tc_display_list:
                call_names = ", ".join(
                    tc.get("function", {}).get("name", "tool")
                    for tc in tc_display_list
                    if isinstance(tc, dict)
                )
                if not full_content.strip():
                    saved_content = (
                        f"🔧 **Tetiklenen Araç Çağrısı (`{call_names}`):**\n```json\n{tc_display_json_str}\n```"
                    )
                else:
                    saved_content = (
                        f"{full_content}\n\n🔧 **Tetiklenen Araç Çağrısı (`{call_names}`):**\n```json\n{tc_display_json_str}\n```"
                    )

            total_tok = job.prompt_tokens + completion_tokens
            with postgres_db.connection() as conn:
                existing_row = conn.execute(
                    "SELECT id, thinking_content FROM chat_messages WHERE request_id = ? AND role = 'assistant' LIMIT 1",
                    (job.job_id,),
                ).fetchone()
                if existing_row:
                    updated_thinking = existing_row.get("thinking_content") or ""
                    if reasoning_text:
                        obs_lines = [
                            ln
                            for ln in reasoning_text.splitlines()
                            if "GOZLEMCI_AJAN DENETİMİ" in ln and ln not in updated_thinking
                        ]
                        if obs_lines:
                            obs_block = "\n".join(obs_lines)
                            updated_thinking = (
                                f"{obs_block}\n\n{updated_thinking}".strip()
                                if updated_thinking
                                else obs_block
                            )
                    conn.execute(
                        """
                        UPDATE chat_messages
                        SET content = ?, thinking_content = ?, tool_calls_json = ?,
                            completion_tokens = ?, total_tokens = ?
                        WHERE id = ?
                        """,
                        (
                            saved_content,
                            updated_thinking,
                            tc_json_str,
                            completion_tokens,
                            total_tok,
                            existing_row["id"],
                        ),
                    )
            if job.conversation_id:
                conversation_event_broadcaster.publish("message_updated", job.conversation_id)
        except Exception as db_exc:
            gateway_logger.warning(
                f"OBSERVER_DB_SYNC_WARNING | id={job.job_id} | exc={db_exc}"
            )

    async def _run_tool_calls_observer_pipeline(
        self,
        root_job: ChatJobDTO,
        current_job: ChatJobDTO,
        user_ctx: Optional[AuthenticatedUserContextDTO],
        tool_calls: List[Dict[str, Any]],
        full_content: str,
        reasoning_text: str,
        actual_finish_reason: str,
    ) -> Tuple[List[Dict[str, Any]], int, str, List[str]]:
        """
        Araç çağrısı (`tool_calls`) çıktısını `GOZLEMCI_AJAN` ile denetler ve eksik/kesik
        kayıtları çok turlu devam çağrılarıyla tamamlar.
        """
        added_tokens = 0
        added_traces: List[str] = []

        clean_user_text, req_attachments, _ = self._formatter.extract_last_user_message_details(
            root_job.messages
        )
        prepared_orig = self._formatter.prepare_messages(
            root_job.messages,
            response_format=root_job.response_format,
            merge_system_into_user=False,
        )

        primary_tc = tool_calls[0] if isinstance(tool_calls[0], dict) else {}
        fn_obj = (primary_tc.get("function") or {}) if isinstance(primary_tc, dict) else {}
        tc_name = str(fn_obj.get("name") or "tool")
        raw_args = fn_obj.get("arguments")

        salvaged_dict, is_json_truncated, cut_off_tail = (
            agent_memory_service.salvage_generic_json_arguments(raw_args)
        )
        if salvaged_dict is not None and isinstance(primary_tc.get("function"), dict):
            primary_tc["function"]["arguments"] = json.dumps(
                salvaged_dict, ensure_ascii=False
            )

        should_inspect_tool_call = salvaged_dict is not None and (
            is_json_truncated
            or actual_finish_reason == "length"
            or bool(req_attachments)
            or len(clean_user_text or "") > 1500
        )
        if not should_inspect_tool_call or salvaged_dict is None:
            return (tool_calls, added_tokens, reasoning_text, added_traces)

        internal_ctx = self._build_internal_continuation_user_ctx(current_job, user_ctx)
        for obs_step in range(1, 6):
            needs_cont, obs_reason, cont_prompt, obs_was_trunc = await asyncio.to_thread(
                agent_memory_service.evaluate_with_observer_agent,
                self._llm_provider,
                self._model_service,
                prepared_orig.text_only_messages,
                full_content or "",
                tc_name,
                salvaged_dict,
                is_json_truncated or (actual_finish_reason == "length" and obs_step == 1),
                cut_off_tail,
                "tool_calls",
            )
            current_items_count = agent_memory_service.count_json_array_items(salvaged_dict)
            gateway_logger.info(
                f"OBSERVER_INSPECTION | id={current_job.job_id} | step={obs_step} | mode=tool_calls "
                f"| app={current_job.app_id} | agent={current_job.agent_id} | tool={tc_name} "
                f"| items={current_items_count} | json_truncated={is_json_truncated} "
                f"| needs_continuation={needs_cont} | obs_truncated={obs_was_trunc} | reason={obs_reason}"
            )
            obs_trace_line = (
                f"🛡️ [GOZLEMCI_AJAN DENETİMİ (Tur {obs_step} - TOOL)]: "
                f"Çıkarılan Kayıt={current_items_count} | JSON Kesildi Mi={is_json_truncated} "
                f"| Devam Gerekli Mi={needs_cont} | Neden={obs_reason}"
            )
            added_traces.append(obs_trace_line)
            reasoning_text = (
                f"{reasoning_text}\n\n{obs_trace_line}".strip()
                if reasoning_text
                else obs_trace_line
            )
            if not needs_cont or not cont_prompt:
                break

            last_items_preview = json.dumps(
                agent_memory_service.extract_last_array_items(salvaged_dict, 4),
                ensure_ascii=False,
            )
            compact_prev_dict = agent_memory_service.build_compact_continuation_preview(
                salvaged_dict
            )
            cont_user_directive = (
                f"[GOZLEMCI_AJAN SANAL EXCEL TABLOSU DEVAM YÖNERGESİ (Tur {obs_step})]\n"
                f"{cont_prompt}\n\n"
                f"Şu ana kadar üretilen ve hafızaya alınan toplam kayıt sayısı: {current_items_count}.\n"
                f"En son üretilen 4 kayıt (#{max(1, current_items_count - 3)}..#{current_items_count}): {last_items_preview}\n"
                f"KRİTİK AKTARIM KURALLARI:\n"
                f"1) Önceki {current_items_count} kaydı KESİNLİKLE tekrar üretme! `{tc_name}` aracını çağırırken dizi içerisine YALNIZCA yukarıda GOZLEMCI_AJAN tarafından çıkarılan Sanal Excel/CSV tablosundaki (veya belgedeki hedef tabloların kalan bölümündeki) YENİ satırları sırasıyla ekle.\n"
                f"2) SIFIR UYDURMA VERİ KURALI: Kesinlikle tahmin yoluyla veya önceki ürün kodunun içindeki sayıları artırarak/değiştirerek uydurma ürün kodu üretme! Yalnızca yukarıdaki Sanal Excel/CSV listesinde ve belgedeki hedef tablolarda fiziksel olarak yer alan gerçek satırları aktar.\n"
                f"3) SADECE SALT ÜRÜN KODU KURALI: 1. sütundaki kategori/ürün grubu ibarelerini KESİNLİKLE EKLEME; yalnızca boşluksuz salt model/ürün kodunu yaz ve harf öneklerini birebir koru.\n"
                f"4) KAPSAM DIŞI TABLO YASAĞI: Kullanıcı veya sistem yönergesinde hariç tutulan tablo başlığına ulaşıldığında okumayı tamamen durdur; o tabloyu ve sonraki devam sayfalarındaki hiçbir satırını ekleme."
            )
            base_text_messages = [
                ChatMessageDTO(
                    role=str(m.get("role") or "user"),
                    content=str(m.get("content") or ""),
                )
                for m in prepared_orig.text_only_messages
            ]
            cont_messages = base_text_messages + [
                ChatMessageDTO(
                    role="assistant",
                    content=json.dumps(compact_prev_dict, ensure_ascii=False),
                ),
                ChatMessageDTO(role="user", content=cont_user_directive),
            ]
            cont_req = ChatCompletionRequestDTO(
                model=current_job.requested_model or current_job.model,
                messages=cont_messages,
                tools=current_job.tools,
                tool_choice={"type": "function", "function": {"name": tc_name}}
                if current_job.tools
                else None,
                stream=False,
                temperature=0.1,
                max_tokens=current_job.max_tokens,
                conversation_id=current_job.conversation_id,
                source="api",
                app_id=current_job.app_id,
                agent_id=current_job.agent_id,
            )
            cont_job = self.initiate_chat_job(cont_req, internal_ctx)
            (
                cont_content,
                cont_tokens,
                _,
                _,
                cont_tcs,
                cont_reasoning,
            ) = await self._collect_full_response(cont_job)
            self._job_finish_reasons.pop(cont_job.job_id, None)
            added_tokens += cont_tokens
            if cont_reasoning:
                reasoning_text = (
                    f"{reasoning_text}\n\n{cont_reasoning}".strip()
                    if reasoning_text
                    else cont_reasoning
                )

            next_raw_args: Any = None
            if cont_tcs and isinstance(cont_tcs, list) and len(cont_tcs) > 0:
                first_cont_tc = cont_tcs[0] if isinstance(cont_tcs[0], dict) else {}
                next_raw_args = (first_cont_tc.get("function") or {}).get("arguments")
            elif cont_content:
                next_raw_args = cont_content

            if not next_raw_args:
                break

            next_dict, is_json_truncated, cut_off_tail = (
                agent_memory_service.salvage_generic_json_arguments(next_raw_args)
            )
            if not next_dict:
                break

            salvaged_dict, added_count = agent_memory_service.merge_generic_json_arguments(
                salvaged_dict, next_dict
            )
            primary_tc["function"]["arguments"] = json.dumps(
                salvaged_dict, ensure_ascii=False
            )
            tool_calls = [primary_tc]
            gateway_logger.info(
                f"OBSERVER_CONTINUATION_MERGED | id={current_job.job_id} | step={obs_step} "
                f"| added_items={added_count} "
                f"| total_items={agent_memory_service.count_json_array_items(salvaged_dict)}"
            )
            if added_count == 0:
                break

        return (tool_calls, added_tokens, reasoning_text, added_traces)

    async def _run_content_observer_pipeline(
        self,
        root_job: ChatJobDTO,
        current_job: ChatJobDTO,
        user_ctx: Optional[AuthenticatedUserContextDTO],
        full_content: str,
        reasoning_text: str,
        actual_finish_reason: str,
        is_json_mode: bool,
    ) -> Tuple[str, int, str, List[str], str]:
        """
        CSV, JSON ve genel metin/kod yanıtlarını `GOZLEMCI_AJAN` ile denetler ve eksik/kesik
        çıktıları hem doğrudan gözlemci çıktısıyla hem de devam çağrılarıyla tamamlar.
        Dönüş: `(updated_content, added_tokens, updated_reasoning, added_traces, clean_initial_prefix)`
        """
        added_tokens = 0
        added_traces: List[str] = []

        clean_user_text, req_attachments, system_prompt = (
            self._formatter.extract_last_user_message_details(root_job.messages)
        )
        output_mode = self._detect_content_output_mode(
            full_content=full_content,
            is_json_mode=is_json_mode,
            clean_user_text=clean_user_text,
            system_prompt=system_prompt,
        )
        is_truncated, trunc_reason = agent_memory_service.detect_response_truncation(
            content=full_content,
            finish_reason=actual_finish_reason,
            is_json_mode=(output_mode == "json"),
        )

        if output_mode in ("csv", "json"):
            should_inspect = (
                is_truncated
                or actual_finish_reason == "length"
                or bool(req_attachments)
                or len(clean_user_text or "") > 1500
            )
        else:
            should_inspect = (
                is_truncated
                or actual_finish_reason == "length"
                or bool(req_attachments)
                or len(clean_user_text or "") > 2500
            )

        if not should_inspect:
            return (full_content, added_tokens, reasoning_text, added_traces, full_content)

        prepared_orig = self._formatter.prepare_messages(
            root_job.messages,
            response_format=root_job.response_format,
            merge_system_into_user=False,
        )
        base_text_messages = [
            ChatMessageDTO(
                role=str(m.get("role") or "user"),
                content=str(m.get("content") or ""),
            )
            for m in prepared_orig.text_only_messages
        ]
        internal_ctx = self._build_internal_continuation_user_ctx(current_job, user_ctx)

        # --- MOD 1: CSV / Noktalı Virgüllü Tablo Denetimi ve Tamamlama ---
        if output_mode == "csv":
            initial_dropped_row: Optional[str] = None
            csv_cut_off_tail = ""
            prep_finish_mode = "length" if actual_finish_reason == "length" else "stop"
            clean_pref, _, _, dropped_cand, csv_cut_off_tail = (
                agent_memory_service.prepare_csv_chunk_for_continuation(
                    full_content, prep_finish_mode
                )
            )
            if actual_finish_reason == "length":
                initial_dropped_row = dropped_cand
            full_content = clean_pref

            clean_initial_prefix = full_content
            total_added_csv_rows = 0
            combined_usr_text_for_zoom = "\n\n".join(
                str(m.get("content") or "")
                for m in prepared_orig.text_only_messages
                if m.get("role", "user") == "user"
            ).strip()

            for obs_step in range(1, 7):
                active_csv_hdr, active_csv_cols = (
                    agent_memory_service.detect_csv_header_info(full_content or "")
                )
                active_csv_schema = active_csv_hdr or "Kod;Tutar"
                current_csv_rows = [
                    ln.strip()
                    for ln in (full_content or "").splitlines()
                    if agent_memory_service.is_valid_csv_data_row(
                        ln, expected_cols=active_csv_cols
                    )
                ]
                effective_cut_tail = csv_cut_off_tail or trunc_reason
                needs_cont, obs_reason, cont_directive, obs_was_truncated = (
                    await asyncio.to_thread(
                        agent_memory_service.evaluate_with_observer_agent,
                        self._llm_provider,
                        self._model_service,
                        prepared_orig.text_only_messages,
                        full_content or "",
                        None,
                        None,
                        is_truncated,
                        effective_cut_tail,
                        "csv",
                    )
                )
                gateway_logger.info(
                    f"OBSERVER_INSPECTION | id={current_job.job_id} | step={obs_step} | mode=csv "
                    f"| app={current_job.app_id} | agent={current_job.agent_id} "
                    f"| rows={len(current_csv_rows)} | truncated={is_truncated} "
                    f"| cut_hint={csv_cut_off_tail[:80] if csv_cut_off_tail else '-'} "
                    f"| needs_continuation={needs_cont} | obs_truncated={obs_was_truncated} | reason={obs_reason}"
                )
                obs_trace_line = (
                    f"🛡️ [GOZLEMCI_AJAN DENETİMİ (Tur {obs_step} - CSV)]: "
                    f"Mevcut Satır={len(current_csv_rows)} | Kesinti={is_truncated} "
                    f"| Devam Gerekli Mi={needs_cont} | Neden={obs_reason}"
                )
                added_traces.append(obs_trace_line)
                reasoning_text = (
                    f"{reasoning_text}\n\n{obs_trace_line}".strip()
                    if reasoning_text
                    else obs_trace_line
                )

                if not needs_cont:
                    gateway_logger.info(
                        f"OBSERVER_CSV_VERIFIED_COMPLETE | id={current_job.job_id} | step={obs_step} "
                        f"| total_rows={len(current_csv_rows)}"
                    )
                    break

                cont_non_fence = [
                    ln.strip()
                    for ln in (cont_directive or "").splitlines()
                    if ln.strip() and not ln.strip().startswith("```")
                ]
                has_direct_csv_lines = any(
                    agent_memory_service.is_valid_csv_data_row(
                        re.sub(r"^(?:#?\d+[\.\)\:\-\s]+|\-\s+|\*\s+)", "", ln).strip(),
                        expected_cols=2,
                    )
                    or (ln.startswith("#") and "=" in ln)
                    for ln in cont_non_fence
                )

                if has_direct_csv_lines:
                    cont_to_merge = "\n".join(cont_non_fence)
                    next_cut_fragment = ""
                    if obs_was_truncated and len(cont_non_fence) >= 2:
                        # GOZLEMCI_AJAN token sınırına çarptıysa son satırı ipucu olarak sakla ve birleştirmeden ayır
                        next_cut_fragment = cont_non_fence[-1]
                        cont_to_merge = "\n".join(cont_non_fence[:-1])

                    merged_csv, direct_added = agent_memory_service.merge_csv_continuation(
                        full_content, cont_to_merge
                    )
                    if direct_added > 0:
                        full_content = merged_csv
                        total_added_csv_rows += direct_added
                        added_tokens += DocumentService.estimate_tokens(cont_to_merge)
                        is_truncated = obs_was_truncated
                        csv_cut_off_tail = next_cut_fragment
                        trunc_reason = "observer_output_length" if obs_was_truncated else ""
                        _, updated_cols = agent_memory_service.detect_csv_header_info(
                            full_content
                        )
                        updated_row_cnt = sum(
                            1
                            for ln in full_content.splitlines()
                            if agent_memory_service.is_valid_csv_data_row(
                                ln, expected_cols=updated_cols
                            )
                        )
                        gateway_logger.info(
                            f"OBSERVER_CSV_DIRECT_MERGED | id={current_job.job_id} | step={obs_step} "
                            f"| added_rows={direct_added} | total_rows={updated_row_cnt} "
                            f"| obs_truncated={obs_was_truncated}"
                        )
                        continue
                    if not obs_was_truncated:
                        gateway_logger.info(
                            f"OBSERVER_CSV_VERIFIED_COMPLETE | id={current_job.job_id} | step={obs_step} "
                            f"| reason=all_rows_already_present | total_rows={len(current_csv_rows)}"
                        )
                        break

                # Yedek yol: GOZLEMCI_AJAN doğrudan CSV satırı yerine metinsel yönerge döndürdüyse (veya fiziksel kesinti override devreye girdiyse)
                last_row = current_csv_rows[-1] if current_csv_rows else ""
                last_code = last_row.split(";", 1)[0].strip() if ";" in last_row else ""
                prev_codes = [
                    ln.split(";", 1)[0].strip()
                    for ln in current_csv_rows[-4:-1]
                    if ";" in ln
                ]
                zoom_window = (
                    agent_memory_service.extract_post_anchor_document_window(
                        document_text=combined_usr_text_for_zoom,
                        anchor_code=last_code,
                        prev_codes=prev_codes,
                    )
                    if last_code
                    else ""
                )
                zoom_block = (
                    f"\n\n[SON ÇIKARILAN KOD (`{last_code}`) ETRAFINDAKİ ODAKLANMIŞ BELGE KESİTİ]:\n{zoom_window}"
                    if zoom_window
                    else ""
                )
                cut_hint_block = (
                    f"\nToken sınırında yarıda kesilen ve henüz listeye eklenmeyen satır parçası: `{csv_cut_off_tail}`."
                    if csv_cut_off_tail
                    else ""
                )
                fallback_instruction = (
                    f"[GOZLEMCI_AJAN DEVAM YÖNERGESİ (Tur {obs_step})]\n"
                    f"{cont_directive or 'Tablo çıktısı token sınırında yarıda kesildi; kaldığın satırdan devam et.'}\n"
                    + (
                        f"\nSon tamamlanan satır: `{last_row}`.{cut_hint_block}\n"
                        f"Önceki {len(current_csv_rows)} satırı, `#META`/`#TABLOLAR` satırlarını veya sütun başlığını TEKRAR YAZMADAN yalnızca `{last_code}` satırından hemen sonra gelen (kapsam dışı tablo başlığından önceki) kalan hedef satırları `{active_csv_schema}` formatında yaz.{zoom_block}"
                        if last_row
                        else f"Belgedeki yalnızca talep edilen hedef tablolarda yer alan satırları `#META` ve sütun başlığıyla birlikte `{active_csv_schema}` formatında yaz."
                    )
                )
                cont_messages = (
                    list(base_text_messages)
                    + [
                        ChatMessageDTO(role="assistant", content=full_content),
                        ChatMessageDTO(role="user", content=fallback_instruction),
                    ]
                    if full_content
                    else list(base_text_messages)
                    + [ChatMessageDTO(role="user", content=fallback_instruction)]
                )
                cont_req = ChatCompletionRequestDTO(
                    model=current_job.requested_model or current_job.model,
                    messages=cont_messages,
                    tools=None,
                    tool_choice="none",
                    stream=False,
                    temperature=0.0,
                    max_tokens=current_job.max_tokens,
                    conversation_id=current_job.conversation_id,
                    source="api",
                    app_id=current_job.app_id,
                    agent_id=current_job.agent_id,
                )
                cont_job = self.initiate_chat_job(cont_req, internal_ctx)
                try:
                    cont_content, cont_tokens, _, _, _, cont_reasoning = (
                        await self._collect_full_response(cont_job)
                    )
                except Exception as cont_exc:
                    gateway_logger.warning(
                        f"OBSERVER_CSV_FALLBACK_ERROR | id={current_job.job_id} | step={obs_step} | exc={cont_exc}"
                    )
                    break

                cont_finish_reason = self._job_finish_reasons.pop(cont_job.job_id, "stop")
                added_tokens += cont_tokens
                if cont_reasoning:
                    reasoning_text = (
                        f"{reasoning_text}\n\n{cont_reasoning}".strip()
                        if reasoning_text
                        else cont_reasoning
                    )
                if not cont_content or not cont_content.strip():
                    break

                chunk_to_merge = cont_content
                next_fallback_cut = ""
                if cont_finish_reason == "length":
                    cont_lines = [
                        ln.strip()
                        for ln in cont_content.splitlines()
                        if ln.strip() and not ln.strip().startswith("```")
                    ]
                    if len(cont_lines) >= 2:
                        next_fallback_cut = cont_lines.pop()
                        chunk_to_merge = "\n".join(cont_lines)

                full_content, added_csv_rows = agent_memory_service.merge_csv_continuation(
                    full_content, chunk_to_merge
                )
                total_added_csv_rows += added_csv_rows
                csv_cut_off_tail = next_fallback_cut
                is_truncated, trunc_reason = agent_memory_service.detect_response_truncation(
                    content=full_content,
                    finish_reason=cont_finish_reason,
                    is_json_mode=False,
                )
                if added_csv_rows == 0:
                    break

            if total_added_csv_rows == 0 and initial_dropped_row:
                full_content, _ = agent_memory_service.merge_csv_continuation(
                    full_content, initial_dropped_row
                )

            return (
                full_content,
                added_tokens,
                reasoning_text,
                added_traces,
                clean_initial_prefix,
            )

        # --- MOD 2 & 3: Yapılandırılmış JSON ve Genel Metin / Markdown / Kod Denetimi ---
        clean_initial_prefix = full_content
        for obs_step in range(1, 5):
            json_struct_trunc = False
            cut_tail = trunc_reason
            if output_mode == "json" and (full_content or "").lstrip().startswith(
                ("{", "[", "```json")
            ):
                _, json_struct_trunc, salvaged_tail = (
                    agent_memory_service.salvage_generic_json_arguments(full_content)
                )
                if salvaged_tail:
                    cut_tail = salvaged_tail

            inspect_truncated = is_truncated or json_struct_trunc
            needs_cont, obs_reason, cont_directive, _ = await asyncio.to_thread(
                agent_memory_service.evaluate_with_observer_agent,
                self._llm_provider,
                self._model_service,
                prepared_orig.text_only_messages,
                full_content or "",
                None,
                None,
                inspect_truncated,
                cut_tail,
                output_mode,
            )
            gateway_logger.info(
                f"OBSERVER_INSPECTION | id={current_job.job_id} | step={obs_step} | mode={output_mode} "
                f"| app={current_job.app_id} | agent={current_job.agent_id} "
                f"| chars={len(full_content or '')} | truncated={inspect_truncated} "
                f"| needs_continuation={needs_cont} | reason={obs_reason}"
            )
            obs_trace_line = (
                f"🛡️ [GOZLEMCI_AJAN DENETİMİ (Tur {obs_step} - {output_mode.upper()})]: "
                f"Uzunluk={len(full_content or '')} krk | Kesinti={inspect_truncated} "
                f"| Devam Gerekli Mi={needs_cont} | Neden={obs_reason}"
            )
            added_traces.append(obs_trace_line)
            reasoning_text = (
                f"{reasoning_text}\n\n{obs_trace_line}".strip()
                if reasoning_text
                else obs_trace_line
            )

            if not needs_cont and not inspect_truncated:
                gateway_logger.info(
                    f"OBSERVER_CONTENT_VERIFIED_COMPLETE | id={current_job.job_id} | step={obs_step} | mode={output_mode}"
                )
                break

            raw_directive = (
                cont_directive or ""
            ).strip() or agent_memory_service.get_observer_continuation_directive(
                tail_snippet=(full_content or "")[-350:],
                reason=obs_reason or trunc_reason or "incomplete_output",
            )
            effective_directive = (
                raw_directive
                if raw_directive.startswith(("[GOZLEMCI_AJAN", "[OTOMATİK DEVAM"))
                else f"[GOZLEMCI_AJAN DEVAM YÖNERGESİ (Tur {obs_step})]\n{raw_directive}\n\nKRİTİK KURAL: Önceki metni veya yapıyı tekrarlamadan tam kaldığın noktadan devam et."
            )
            cont_messages = (
                list(base_text_messages)
                + [
                    ChatMessageDTO(role="assistant", content=full_content),
                    ChatMessageDTO(role="user", content=effective_directive),
                ]
                if full_content
                else list(base_text_messages)
                + [ChatMessageDTO(role="user", content=effective_directive)]
            )
            cont_req = ChatCompletionRequestDTO(
                model=current_job.requested_model or current_job.model,
                messages=cont_messages,
                tools=None,
                tool_choice="none",
                stream=False,
                temperature=0.1,
                max_tokens=current_job.max_tokens,
                response_format=current_job.response_format if not full_content else None,
                conversation_id=current_job.conversation_id,
                source="api",
                app_id=current_job.app_id,
                agent_id=current_job.agent_id,
            )
            cont_job = self.initiate_chat_job(cont_req, internal_ctx)
            try:
                cont_content, cont_tokens, _, _, _, cont_reasoning = (
                    await self._collect_full_response(cont_job)
                )
            except Exception as cont_exc:
                gateway_logger.warning(
                    f"OBSERVER_CONTENT_CONTINUATION_ERROR | id={current_job.job_id} | step={obs_step} | exc={cont_exc}"
                )
                break

            cont_fr = self._job_finish_reasons.pop(cont_job.job_id, "stop")
            if not cont_content:
                break

            added_tokens += cont_tokens
            if cont_reasoning:
                reasoning_text = (
                    f"{reasoning_text}\n\n{cont_reasoning}".strip()
                    if reasoning_text
                    else cont_reasoning
                )

            merged_structurally = False
            if output_mode == "json" and full_content:
                base_json_dict, _, _ = agent_memory_service.salvage_generic_json_arguments(
                    full_content
                )
                next_json_dict, _, _ = agent_memory_service.salvage_generic_json_arguments(
                    cont_content
                )
                if base_json_dict is not None and next_json_dict is not None:
                    merged_dict, added_json_items = (
                        agent_memory_service.merge_generic_json_arguments(
                            base_json_dict, next_json_dict
                        )
                    )
                    if added_json_items > 0:
                        full_content = json.dumps(merged_dict, ensure_ascii=False)
                        merged_structurally = True

            if not merged_structurally:
                full_content = agent_memory_service.merge_continued_response(
                    full_content or "", cont_content
                )

            is_truncated, trunc_reason = agent_memory_service.detect_response_truncation(
                content=full_content,
                finish_reason=cont_fr,
                is_json_mode=(output_mode == "json"),
            )
            if not is_truncated and cont_fr != "length":
                break

        return (
            full_content,
            added_tokens,
            reasoning_text,
            added_traces,
            clean_initial_prefix,
        )

    async def stream_sse_generator(self, job: ChatJobDTO) -> AsyncGenerator[str, None]:
        """Kanaldaki olayları OpenAI standartlarında SSE (text/event-stream) olarak yayınlar."""
        channel = self._channel_repo.get_channel(job.job_id)
        if not channel:
            return

        created_ts = int(time.time())
        start_time = time.perf_counter()
        deadline = start_time + float(settings.web_gateway_timeout_sec)
        completion_tokens = 0
        ttft_ms = 0
        used_session = "sess-gpt-01"
        upstream_provider = job.provider
        status = "success"
        error_detail = ""
        collected_chunks: List[str] = []
        collected_reasoning: List[str] = []
        collected_tool_calls: List[Dict[str, Any]] = []
        studio_reasoning_started = False
        studio_reasoning_closed = False
        finalized = False

        def _do_finalize() -> None:
            nonlocal finalized, completion_tokens
            if finalized:
                return
            finalized = True
            raw_stream_text = "".join(collected_chunks)
            stream_preview = raw_stream_text
            if not stream_preview and collected_tool_calls:
                call_names = ", ".join(
                    tc.get("function", {}).get("name", "tool") for tc in collected_tool_calls
                )
                stream_preview = f"[Araç Çağrısı: {call_names}]"
            if completion_tokens == 0 and (raw_stream_text or collected_tool_calls or collected_reasoning):
                completion_tokens = DocumentService.estimate_tokens(
                    raw_stream_text
                    + "".join(collected_reasoning)
                    + (json.dumps(collected_tool_calls, ensure_ascii=False) if collected_tool_calls else "")
                )
            self._finalize_job(
                job=job,
                completion_tokens=completion_tokens,
                is_stream=True,
                start_time=start_time,
                ttft_ms=ttft_ms,
                status=status,
                upstream_provider=upstream_provider,
                response_preview=stream_preview,
                raw_response_text=raw_stream_text,
                reasoning_text="".join(collected_reasoning),
                tool_calls=collected_tool_calls,
                error_detail=error_detail,
                session_id=used_session,
            )

        try:
            yield self._format_sse_chunk(
                job.job_id,
                created_ts,
                job.model,
                DeltaMessageDTO(role="assistant"),
                conversation_id=job.conversation_id,
            )
            while True:
                remaining = max(0.1, deadline - time.perf_counter())
                payload = await asyncio.wait_for(
                    channel.get(), timeout=min(float(settings.stream_wait_timeout_sec), remaining)
                )
                used_session = payload.get("session_id", used_session)
                upstream_provider = payload.get("upstream_provider", upstream_provider)
                if payload.get("status"):
                    status = payload["status"]
                if payload.get("error_detail"):
                    error_detail = payload["error_detail"]

                if payload["event"] == "reasoning":
                    r_text = payload.get("text") or ""
                    if r_text:
                        if ttft_ms == 0:
                            ttft_ms = int((time.perf_counter() - start_time) * 1000)
                        collected_reasoning.append(r_text)
                        completion_tokens += DocumentService.estimate_tokens(r_text)
                        studio_content_piece: Optional[str] = None
                        if job.source == "studio":
                            if not studio_reasoning_started:
                                studio_reasoning_started = True
                                studio_content_piece = f"<think>{r_text}"
                            else:
                                studio_content_piece = r_text
                        yield self._format_sse_chunk(
                            job.job_id,
                            created_ts,
                            job.model,
                            DeltaMessageDTO(
                                reasoning_content=r_text,
                                content=studio_content_piece,
                            ),
                            conversation_id=job.conversation_id,
                        )
                elif payload["event"] == "delta":
                    delta_text = payload["text"]
                    if ttft_ms == 0:
                        ttft_ms = int((time.perf_counter() - start_time) * 1000)
                    collected_chunks.append(delta_text)
                    completion_tokens += DocumentService.estimate_tokens(delta_text)
                    out_delta = delta_text
                    if job.source == "studio" and studio_reasoning_started and not studio_reasoning_closed:
                        studio_reasoning_closed = True
                        out_delta = f"</think>\n\n{delta_text}"
                    yield self._format_sse_chunk(
                        job.job_id,
                        created_ts,
                        job.model,
                        DeltaMessageDTO(content=out_delta),
                        conversation_id=job.conversation_id,
                    )
                elif payload["event"] == "tool_calls":
                    if ttft_ms == 0:
                        ttft_ms = int((time.perf_counter() - start_time) * 1000)
                    tcs = payload.get("tool_calls") or []
                    if tcs:
                        collected_tool_calls.extend(tcs)
                elif payload["event"] == "done":
                    upstream_fr = str(payload.get("provider_finish_reason") or "stop")
                    is_json_mode = self._formatter.is_json_mode_requested(job.response_format)

                    if job.gozlemci_aktif_mi and status == "success":
                        if collected_tool_calls:
                            (
                                updated_tcs,
                                added_tc_tokens,
                                _,
                                obs_tc_traces,
                            ) = await self._run_tool_calls_observer_pipeline(
                                root_job=job,
                                current_job=job,
                                user_ctx=None,
                                tool_calls=collected_tool_calls,
                                full_content="".join(collected_chunks),
                                reasoning_text="".join(collected_reasoning),
                                actual_finish_reason=upstream_fr,
                            )
                            collected_tool_calls[:] = updated_tcs
                            completion_tokens += added_tc_tokens
                            for tr in obs_tc_traces:
                                trace_piece = f"\n\n{tr}" if collected_reasoning else tr
                                collected_reasoning.append(trace_piece)
                                yield self._format_sse_chunk(
                                    job.job_id,
                                    created_ts,
                                    job.model,
                                    DeltaMessageDTO(reasoning_content=trace_piece),
                                    conversation_id=job.conversation_id,
                                )
                        elif not collected_tool_calls and (
                            collected_chunks
                            or upstream_fr == "length"
                            or bool(job.messages)
                        ):
                            raw_initial_text = "".join(collected_chunks)
                            (
                                updated_content,
                                added_cont_tokens,
                                _,
                                obs_cont_traces,
                                clean_initial_prefix,
                            ) = await self._run_content_observer_pipeline(
                                root_job=job,
                                current_job=job,
                                user_ctx=None,
                                full_content=raw_initial_text,
                                reasoning_text="".join(collected_reasoning),
                                actual_finish_reason=upstream_fr,
                                is_json_mode=is_json_mode,
                            )
                            completion_tokens += added_cont_tokens
                            for tr in obs_cont_traces:
                                trace_piece = f"\n\n{tr}" if collected_reasoning else tr
                                collected_reasoning.append(trace_piece)
                                yield self._format_sse_chunk(
                                    job.job_id,
                                    created_ts,
                                    job.model,
                                    DeltaMessageDTO(reasoning_content=trace_piece),
                                    conversation_id=job.conversation_id,
                                )
                            if updated_content != raw_initial_text:
                                sse_delta_suffix = ""
                                if raw_initial_text and updated_content.startswith(raw_initial_text):
                                    sse_delta_suffix = updated_content[len(raw_initial_text) :]
                                elif clean_initial_prefix and updated_content.startswith(
                                    clean_initial_prefix
                                ):
                                    added_part = updated_content[len(clean_initial_prefix) :].lstrip(
                                        "\n"
                                    )
                                    if added_part:
                                        sse_delta_suffix = f"\n{added_part}"
                                elif not raw_initial_text and updated_content:
                                    sse_delta_suffix = updated_content

                                collected_chunks[:] = [updated_content] if updated_content else []
                                upstream_fr = "stop"
                                if sse_delta_suffix:
                                    if (
                                        job.source == "studio"
                                        and studio_reasoning_started
                                        and not studio_reasoning_closed
                                    ):
                                        studio_reasoning_closed = True
                                        sse_delta_suffix = f"</think>\n\n{sse_delta_suffix}"
                                    yield self._format_sse_chunk(
                                        job.job_id,
                                        created_ts,
                                        job.model,
                                        DeltaMessageDTO(content=sse_delta_suffix),
                                        conversation_id=job.conversation_id,
                                    )

                    if collected_tool_calls:
                        yield self._format_sse_chunk(
                            job.job_id,
                            created_ts,
                            job.model,
                            DeltaMessageDTO(tool_calls=collected_tool_calls),
                            finish_reason="tool_calls",
                            conversation_id=job.conversation_id,
                        )

                    finish_reason = (
                        "error"
                        if status in ("error", "timeout")
                        and not collected_chunks
                        and not collected_tool_calls
                        and not collected_reasoning
                        else (
                            "tool_calls"
                            if collected_tool_calls and not collected_chunks
                            else ("length" if upstream_fr == "length" else "stop")
                        )
                    )
                    # [DONE] göndermeden önce veritabanı kaydını tamamla (yarış durumunu önler)
                    _do_finalize()
                    yield self._format_sse_chunk(
                        job.job_id,
                        created_ts,
                        job.model,
                        DeltaMessageDTO(),
                        finish_reason=finish_reason,
                        conversation_id=job.conversation_id,
                    )
                    yield "data: [DONE]\n\n"
                    break
        except asyncio.TimeoutError:
            status = "timeout"
            error_detail = (
                f"Web AI Gateway akışı {settings.web_gateway_timeout_sec} saniye üst sınırını aştı (Gateway Timeout)."
            )
            gateway_logger.error(f"CHAT_STREAM_TIMEOUT | id={job.job_id} | model={job.model}")
            _do_finalize()
            yield self._format_sse_chunk(
                job.job_id,
                created_ts,
                job.model,
                DeltaMessageDTO(),
                finish_reason="error",
                conversation_id=job.conversation_id,
            )
            yield "data: [DONE]\n\n"
        finally:
            _do_finalize()

    async def _collect_full_response(
        self, job: ChatJobDTO
    ) -> Tuple[str, int, str, int, Optional[List[Dict[str, Any]]], str]:
        """Senkron istekler için kanaldaki tüm delta, reasoning ve tool_calls olaylarını birleştirir."""
        channel = self._channel_repo.get_channel(job.job_id)
        collected: List[str] = []
        collected_reasoning: List[str] = []
        collected_tool_calls: List[Dict[str, Any]] = []
        start_time = time.perf_counter()
        deadline = start_time + float(settings.web_gateway_timeout_sec)
        ttft_ms = 0
        used_session = "sess-gpt-01"
        upstream_provider = job.provider
        status = "success"
        error_detail = ""
        combined_reasoning = ""
        provider_finish_reason = "stop"

        try:
            if channel:
                while True:
                    remaining = max(0.1, deadline - time.perf_counter())
                    payload = await asyncio.wait_for(
                        channel.get(),
                        timeout=min(float(settings.stream_wait_timeout_sec), remaining),
                    )
                    used_session = payload.get("session_id", used_session)
                    upstream_provider = payload.get("upstream_provider", upstream_provider)
                    if payload.get("status"):
                        status = payload["status"]
                    if payload.get("error_detail"):
                        error_detail = payload["error_detail"]

                    if payload["event"] == "reasoning":
                        if ttft_ms == 0:
                            ttft_ms = int((time.perf_counter() - start_time) * 1000)
                        if payload.get("text"):
                            collected_reasoning.append(payload["text"])
                    elif payload["event"] == "delta":
                        if ttft_ms == 0:
                            ttft_ms = int((time.perf_counter() - start_time) * 1000)
                        collected.append(payload["text"])
                    elif payload["event"] == "tool_calls":
                        if payload.get("tool_calls"):
                            collected_tool_calls.extend(payload["tool_calls"])
                    elif payload["event"] == "done":
                        if payload.get("provider_finish_reason"):
                            provider_finish_reason = str(payload["provider_finish_reason"])
                        break
        except asyncio.TimeoutError:
            status = "timeout"
            provider_finish_reason = "length"
            error_detail = (
                f"Model '{job.requested_model or job.model}' ({job.model}) "
                f"{settings.web_gateway_timeout_sec} saniye içinde yanıt vermedi (Gateway Timeout)."
            )
            gateway_logger.error(
                f"CHAT_SYNC_TIMEOUT | id={job.job_id} | model={job.model} | timeout={settings.web_gateway_timeout_sec}s"
            )
        finally:
            if len(self._job_finish_reasons) > 500:
                self._job_finish_reasons.clear()
            self._job_finish_reasons[job.job_id] = provider_finish_reason
            raw_full_text = "".join(collected)
            think_from_tags, cleaned_from_tags = self._formatter.extract_thinking_and_clean_content(raw_full_text)
            streamed_reasoning = "".join(collected_reasoning).strip()
            combined_reasoning = "\n\n".join(
                p for p in (streamed_reasoning, think_from_tags) if p
            ).strip()

            full_text = raw_full_text
            if self._formatter.is_json_mode_requested(job.response_format) and full_text and status == "success":
                full_text = self._formatter.extract_and_normalize_json_content(full_text)
            elif think_from_tags and cleaned_from_tags and job.source == "api":
                # API yanıtında <think> bloğunu reasoning_content'e ayırıp content'i temiz tut
                full_text = cleaned_from_tags

            comp_tokens = DocumentService.estimate_tokens(
                raw_full_text
                + streamed_reasoning
                + (json.dumps(collected_tool_calls, ensure_ascii=False) if collected_tool_calls else "")
            )
            preview_text = full_text
            if not preview_text and collected_tool_calls:
                call_names = ", ".join(
                    tc.get("function", {}).get("name", "tool") for tc in collected_tool_calls
                )
                preview_text = f"[Araç Çağrısı: {call_names}]"

            latency_ms = self._finalize_job(
                job=job,
                completion_tokens=comp_tokens,
                is_stream=False,
                start_time=start_time,
                ttft_ms=ttft_ms,
                status=status,
                upstream_provider=upstream_provider,
                response_preview=preview_text,
                raw_response_text=raw_full_text,
                reasoning_text=combined_reasoning,
                tool_calls=collected_tool_calls,
                error_detail=error_detail,
                session_id=used_session,
            )

        if status == "timeout" or (
            status == "error" and not full_text and not collected_tool_calls
        ):
            raise gateway_timeout_error(
                message=error_detail
                or f"Model '{job.requested_model or job.model}' ({job.model}) alt sağlayıcısından sürede yanıt alınamadı."
            )

        return full_text, comp_tokens, used_session, latency_ms, (collected_tool_calls or None), combined_reasoning

    def _finalize_job(
        self,
        job: ChatJobDTO,
        completion_tokens: int,
        is_stream: bool,
        start_time: float,
        ttft_ms: int,
        status: str,
        upstream_provider: str,
        response_preview: str,
        error_detail: str,
        session_id: str,
        raw_response_text: str = "",
        reasoning_text: str = "",
        tool_calls: Optional[List[Dict[str, Any]]] = None,
    ) -> int:
        """
        İş tamamlandığında kanalı siler, eşzamanlılık slotunu bırakır,
        modelin ürettiği tam yanıtı, düşünce sürecini (thinking_content), araç çağrılarını (tool_calls_json)
        ve ham iletişim paketini (raw_payload_json) SQLite chat_messages tablosuna yazar ve telemetriyi kaydeder.
        """
        self._channel_repo.remove_channel(job.job_id)
        self._auth_service.release_concurrency_slot(job.user_id)
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        effective_ttft = ttft_ms or latency_ms
        clean_user_text, attachments, _ = (
            self._formatter.extract_last_user_message_details(job.messages)
        )
        attachment_names = [a.file_name for a in attachments]
        tc_list = tool_calls or []
        tc_json_str = json.dumps(tc_list, ensure_ascii=False, indent=2) if tc_list else ""
        tc_display_list = self._formatter.expand_tool_calls_for_display(tc_list) if tc_list else []
        tc_display_json_str = (
            json.dumps(tc_display_list, ensure_ascii=False, indent=2) if tc_display_list else ""
        )

        raw_unfiltered = (
            raw_response_text
            if raw_response_text
            else ("" if tc_list else response_preview)
        )
        think_from_tags, _ = self._formatter.extract_thinking_and_clean_content(raw_unfiltered)

        thought_segments: List[str] = []
        if reasoning_text and reasoning_text.strip():
            thought_segments.append(reasoning_text.strip())
        if think_from_tags and think_from_tags.strip() and think_from_tags.strip() not in (reasoning_text or ""):
            thought_segments.append(think_from_tags.strip())
        if tc_display_list and not thought_segments:
            tc_reasons = []
            for idx, tc in enumerate(tc_display_list):
                fn = tc.get("function", {}) if isinstance(tc, dict) else {}
                fn_name = fn.get("name", "tool")
                fn_args_obj = fn.get("arguments", {})
                fn_args_pretty = (
                    json.dumps(fn_args_obj, ensure_ascii=False, indent=2)
                    if isinstance(fn_args_obj, (dict, list))
                    else str(fn_args_obj)
                )
                tc_reasons.append(
                    f"{idx + 1}. Araç Seçimi: `{fn_name}` (Çağrı ID: `{tc.get('id', '-') if isinstance(tc, dict) else '-'}`)\n"
                    f"   Üretilen Argümanlar:\n{fn_args_pretty}"
                )
            thought_segments.append(
                "Model, gelen sistem yönergesini, kullanıcı istemini ve tanımlı araç (tool) şemalarını değerlendirerek "
                "doğrudan metin yanıtı yerine aşağıdaki fonksiyon çağrısını (tool_calls) çalıştırmaya karar verdi:\n"
                + "\n".join(tc_reasons)
            )
        elif self._formatter.is_json_mode_requested(job.response_format) and not thought_segments and raw_unfiltered:
            thought_segments.append(
                f"Model `response_format=json_object` kısıtlaması altında çalışarak {len(raw_unfiltered)} karakterlik "
                f"yapılandırılmış JSON yanıtı üretti (Normalize edilen çıktı: {len(response_preview)} karakter)."
            )

        combined_thoughts = "\n\n".join(thought_segments).strip()

        thinking_lines: List[str] = []
        if combined_thoughts:
            thinking_lines.append("🧠 [LLM DÜŞÜNCE SÜRECİ / INTERNAL REASONING]")
            thinking_lines.append(combined_thoughts)
            thinking_lines.append("---")

        thinking_lines.append(
            f"📥 [GELEN LLM YANITI & TEKNİK İLETİŞİM RAPORU / INCOMING PAYLOAD] (Model: {job.model} | İstenen: {job.requested_model} | Sağlayıcı: {upstream_provider})"
        )
        thinking_lines.append(
            f"• İstek ID: {job.job_id} | Oturum (Session): {session_id} | Akış Modu: {'SSE Stream' if is_stream else 'Senkron JSON'}"
        )
        thinking_lines.append(
            f"• Telemetri: Girdi={job.prompt_tokens} tok | Çıktı={completion_tokens} tok | Toplam={job.prompt_tokens + completion_tokens} tok | İlk Token (TTFT)={effective_ttft} ms | Toplam Süre={latency_ms} ms | Durum={status}"
        )
        thinking_lines.append(
            f"• Karakter İstatistiği: Ham Çıktı={len(raw_unfiltered)} krk | İşlenmiş Çıktı={len(response_preview)} krk | Düşünce={len(combined_thoughts)} krk"
        )
        if tc_display_list:
            thinking_lines.append(
                f"• Tetiklenen Araç Çağrıları (tool_calls - {len(tc_display_list)} adet):\n{tc_display_json_str}"
            )
        if raw_unfiltered and raw_unfiltered != response_preview:
            thinking_lines.append(f"• Modelin Ham (Filtrelenmemiş) Çıktısı:\n{raw_unfiltered}")
        if error_detail:
            thinking_lines.append(f"• Hata Detayı: {error_detail}")

        final_thinking_content = "\n".join(thinking_lines)

        # Sohbet ekranında görünür asistan içeriği: eğer yalnızca tool_calls döndüyse, argümanlarıyla birlikte sakla
        saved_assistant_content = response_preview
        if tc_display_list:
            call_names = ", ".join(
                tc.get("function", {}).get("name", "tool")
                for tc in tc_display_list
                if isinstance(tc, dict)
            )
            if not raw_unfiltered.strip():
                saved_assistant_content = (
                    f"🔧 **Tetiklenen Araç Çağrısı (`{call_names}`):**\n```json\n{tc_display_json_str}\n```"
                )
            else:
                saved_assistant_content = (
                    f"{raw_unfiltered}\n\n🔧 **Tetiklenen Araç Çağrısı (`{call_names}`):**\n```json\n{tc_display_json_str}\n```"
                )
        elif raw_unfiltered and not saved_assistant_content:
            saved_assistant_content = raw_unfiltered
        elif combined_thoughts and not saved_assistant_content.strip():
            saved_assistant_content = combined_thoughts

        incoming_raw_payload: Dict[str, Any] = {
            "direction": "INCOMING_RESPONSE",
            "request_id": job.job_id,
            "conversation_id": job.conversation_id,
            "source": job.source,
            "requested_model": job.requested_model,
            "resolved_model": job.model,
            "provider": upstream_provider,
            "session_id": session_id,
            "is_stream": is_stream,
            "raw_unfiltered_output": raw_unfiltered,
            "normalized_output": response_preview,
            "thinking_content": combined_thoughts,
            "tool_calls": tc_list,
            "metrics": {
                "prompt_tokens": job.prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": job.prompt_tokens + completion_tokens,
                "ttft_ms": effective_ttft,
                "latency_ms": latency_ms,
                "status": status,
                "error_detail": error_detail,
            },
        }

        self._conversation_repo.append_message(
            conversation_id=job.conversation_id,
            user_id=job.user_id,
            role="assistant",
            model_id=job.model,
            content=saved_assistant_content,
            request_id=job.job_id,
            provider=upstream_provider,
            thinking_content=final_thinking_content,
            tool_calls_json=tc_json_str,
            raw_payload_json=json.dumps(incoming_raw_payload, ensure_ascii=False),
            attachments=None,
            prompt_tokens=job.prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
            ttft_ms=effective_ttft,
            status=status,
            error_detail=error_detail,
            auto_update_title=False,
        )

        if job.app_id and job.agent_id and status == "success" and not tc_list and (response_preview or raw_unfiltered):
            agent_memory_service.record_interaction_memory(
                app_id=job.app_id,
                agent_id=job.agent_id,
                conversation_id=job.conversation_id,
                request_id=job.job_id,
                prompt_text=clean_user_text,
                response_text=response_preview or raw_unfiltered,
            )

        self._record_usage(
            RecordUsageInputDTO(
                user_id=job.user_id,
                request_id=job.job_id,
                conversation_id=job.conversation_id,
                model=job.model,
                prompt_tokens=job.prompt_tokens,
                completion_tokens=completion_tokens,
                is_stream=is_stream,
                latency_ms=latency_ms,
                ttft_ms=effective_ttft,
                status=status,
                upstream_provider=upstream_provider,
                prompt_preview=clean_user_text,
                response_preview=saved_assistant_content,
                attachment_names=attachment_names,
                error_detail=error_detail,
                session_id=session_id,
            )
        )
        return latency_ms

    async def _execute_ai_job(self, job: ChatJobDTO) -> None:
        """Seçilen model türüne (Görsel, Web AI veya Yerel Ollama) göre ilgili üreticiyi üst zaman aşımıyla çalıştırır."""
        channel = self._channel_repo.get_channel(job.job_id)
        if not channel:
            return

        session = self._session_repo.acquire_session_for_provider(job.provider)
        prepared = self._formatter.prepare_messages(
            job.messages,
            response_format=job.response_format,
            merge_system_into_user=not bool(job.tools),
        )
        loop = asyncio.get_running_loop()

        image_def = self._model_service.find_image_model(job.model)
        web_def = self._model_service.find_web_model(job.model)
        upstream_name = job.provider
        finish_reason_holder: List[str] = ["stop"]

        def _on_provider_finish_reason(fr: str) -> None:
            if fr:
                finish_reason_holder[-1] = str(fr)

        try:
            if image_def:
                upstream_name = f"pollinations-image ({image_def.image_model or 'flux'})"
                coro = self._run_image_generation_branch(
                    image_def, prepared, channel, session.id
                )
            elif web_def:
                upstream_name = f"pollinations-web ({web_def.web_model or 'openai-fast'})"
                coro = self._run_web_model_branch(
                    web_def,
                    prepared,
                    loop,
                    channel,
                    session.id,
                    response_format=job.response_format,
                    temperature=job.temperature,
                    tools=job.tools,
                    tool_choice=job.tool_choice,
                    max_tokens=job.max_tokens,
                    on_finish_reason=_on_provider_finish_reason,
                )
            else:
                upstream_name = f"ollama-local ({job.model})"
                coro = self._run_local_model_branch(
                    job.model,
                    prepared,
                    loop,
                    channel,
                    session.id,
                    response_format=job.response_format,
                    temperature=job.temperature,
                    tools=job.tools,
                    tool_choice=job.tool_choice,
                    max_tokens=job.max_tokens,
                    on_finish_reason=_on_provider_finish_reason,
                )

            success = await asyncio.wait_for(
                coro,
                timeout=float(settings.web_gateway_timeout_sec),
            )

            if not success:
                err_detail = (
                    f"Model '{job.requested_model or job.model}' ({job.model}) alt sağlayıcısına "
                    f"('{upstream_name}') şu anda erişilemedi veya zaman aşımına uğradı."
                )
                if job.source == "studio":
                    err_msg = f"[Web AI Gateway Uyarısı: '{job.model}' sağlayıcısına şu anda erişilemedi. Lütfen internet bağlantınızı kontrol edin veya tekrar deneyin.]"
                    await channel.put(
                        {
                            "event": "delta",
                            "text": err_msg,
                            "session_id": session.id,
                            "status": "error",
                            "upstream_provider": upstream_name,
                            "error_detail": err_detail,
                        }
                    )
                await channel.put(
                    {
                        "event": "done",
                        "session_id": session.id,
                        "status": "error",
                        "upstream_provider": upstream_name,
                        "error_detail": err_detail,
                    }
                )
                return

            await channel.put(
                {
                    "event": "done",
                    "session_id": session.id,
                    "upstream_provider": upstream_name,
                    "provider_finish_reason": finish_reason_holder[-1],
                }
            )
        except asyncio.TimeoutError:
            timeout_detail = (
                f"Web AI Gateway çağrısı üst zaman aşımı sınırını ({settings.web_gateway_timeout_sec}s) aştı "
                f"| model='{job.requested_model or job.model}' -> '{job.model}'"
            )
            gateway_logger.error(f"CHAT_TIMEOUT | id={job.job_id} | {timeout_detail}")
            if job.source == "studio":
                await channel.put(
                    {
                        "event": "delta",
                        "text": f"\n[Web AI Gateway Zaman Aşımı: {timeout_detail}]",
                        "session_id": session.id,
                        "status": "timeout",
                        "upstream_provider": upstream_name,
                        "error_detail": timeout_detail,
                    }
                )
            await channel.put(
                {
                    "event": "done",
                    "session_id": session.id,
                    "status": "timeout",
                    "upstream_provider": upstream_name,
                    "error_detail": timeout_detail,
                    "provider_finish_reason": "length",
                }
            )
        except Exception as exc:
            gateway_logger.error(f"CHAT_ERROR | id={job.job_id} | model={job.model} | exc={exc}")
            if job.source == "studio":
                await channel.put(
                    {
                        "event": "delta",
                        "text": f"\n[AI Gateway Hatası: {exc}]",
                        "session_id": session.id,
                        "status": "error",
                        "error_detail": str(exc),
                    }
                )
            await channel.put(
                {
                    "event": "done",
                    "session_id": session.id,
                    "status": "error",
                    "upstream_provider": upstream_name,
                    "error_detail": str(exc),
                }
            )
        finally:
            self._session_repo.release_session(session.id)

    async def _run_image_generation_branch(
        self,
        image_def: ModelDefinitionDTO,
        prepared: PreparedMessagesDTO,
        channel: asyncio.Queue,
        session_id: str,
    ) -> bool:
        """Görsel üretim modeli seçildiğinde görseli oluşturur ve Markdown olarak kanala basar."""
        last_prompt = self._formatter.extract_last_user_prompt(prepared.text_only_messages)
        generated = await asyncio.to_thread(
            self._image_service.generate_single_image_sync,
            last_prompt,
            image_def.image_model or "flux",
        )
        md_output = (
            f"![{generated.clean_prompt}](/v1/images/files/{generated.image_id})\n\n"
            f"**Model:** `{image_def.name}` · **Çözünürlük:** `{generated.width}×{generated.height}` · **Seed:** `{generated.used_seed}`"
        )
        await channel.put({"event": "delta", "text": md_output, "session_id": session_id})
        return True

    async def _run_web_model_branch(
        self,
        web_def: ModelDefinitionDTO,
        prepared: PreparedMessagesDTO,
        loop: asyncio.AbstractEventLoop,
        channel: asyncio.Queue,
        session_id: str,
        response_format: Optional[Dict[str, Any]] = None,
        temperature: Optional[float] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        max_tokens: Optional[int] = None,
        on_finish_reason: Optional[Callable[[str], None]] = None,
    ) -> bool:
        """Web AI sağlayıcısını çalıştırır; ulaşılamazsa yerel Ollama yedek modeline düşer."""
        delta_cb = self._create_threadsafe_delta_callback(loop, channel, session_id)
        tools_cb = self._create_threadsafe_tool_calls_callback(loop, channel, session_id)
        reasoning_cb = self._create_threadsafe_reasoning_callback(loop, channel, session_id)
        web_model_name = web_def.web_model or "openai-fast"

        success = await asyncio.to_thread(
            self._llm_provider.stream_from_pollinations_web,
            web_model_name,
            prepared.multimodal_messages,
            delta_cb,
            web_def.id,
            response_format,
            temperature,
            tools,
            tool_choice,
            tools_cb,
            reasoning_cb,
            max_tokens,
            on_finish_reason,
        )
        if not success and prepared.has_multimodal:
            success = await asyncio.to_thread(
                self._llm_provider.stream_from_pollinations_web,
                web_model_name,
                prepared.text_only_messages,
                delta_cb,
                web_def.id,
                response_format,
                temperature,
                tools,
                tool_choice,
                tools_cb,
                reasoning_cb,
                max_tokens,
                on_finish_reason,
            )
        if success:
            return True

        fallback_local = self._model_service.select_best_local_model(web_def.fallback_local)
        if fallback_local:
            gateway_logger.info(
                f"Web AI yanıt vermedi, yerel Ollama yedek modeline geçiliyor | istem={web_def.id} | fallback={fallback_local}"
            )
            return await asyncio.to_thread(
                self._llm_provider.stream_from_ollama,
                fallback_local,
                prepared.text_only_messages,
                delta_cb,
                response_format,
                temperature,
                tools,
                tool_choice,
                tools_cb,
                reasoning_cb,
                max_tokens,
                on_finish_reason,
            )
        return False

    async def _run_local_model_branch(
        self,
        model_id: str,
        prepared: PreparedMessagesDTO,
        loop: asyncio.AbstractEventLoop,
        channel: asyncio.Queue,
        session_id: str,
        response_format: Optional[Dict[str, Any]] = None,
        temperature: Optional[float] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        max_tokens: Optional[int] = None,
        on_finish_reason: Optional[Callable[[str], None]] = None,
    ) -> bool:
        """Yerel Ollama modelinden akış alır; Ollama kapalıysa otomatik olarak Web AI köprüsünü kullanır."""
        delta_cb = self._create_threadsafe_delta_callback(loop, channel, session_id)
        tools_cb = self._create_threadsafe_tool_calls_callback(loop, channel, session_id)
        reasoning_cb = self._create_threadsafe_reasoning_callback(loop, channel, session_id)
        success = await asyncio.to_thread(
            self._llm_provider.stream_from_ollama,
            model_id,
            prepared.multimodal_messages,
            delta_cb,
            response_format,
            temperature,
            tools,
            tool_choice,
            tools_cb,
            reasoning_cb,
            max_tokens,
            on_finish_reason,
        )
        if not success and prepared.has_multimodal:
            success = await asyncio.to_thread(
                self._llm_provider.stream_from_ollama,
                model_id,
                prepared.text_only_messages,
                delta_cb,
                response_format,
                temperature,
                tools,
                tool_choice,
                tools_cb,
                reasoning_cb,
                max_tokens,
                on_finish_reason,
            )
        if success:
            return True

        return await asyncio.to_thread(
            self._llm_provider.stream_from_pollinations_web,
            "openai-fast",
            prepared.text_only_messages,
            delta_cb,
            model_id,
            response_format,
            temperature,
            tools,
            tool_choice,
            tools_cb,
            reasoning_cb,
            max_tokens,
            on_finish_reason,
        )

    @staticmethod
    def _create_threadsafe_delta_callback(
        loop: asyncio.AbstractEventLoop,
        channel: asyncio.Queue,
        session_id: str,
    ) -> Callable[[str], None]:
        """Senkron HTTP okuma iş parçacığından asyncio kuyruğuna güvenli delta gönderen callback döner."""
        def _on_delta(text: str) -> None:
            asyncio.run_coroutine_threadsafe(
                channel.put({"event": "delta", "text": text, "session_id": session_id}),
                loop,
            ).result(timeout=10)

        return _on_delta

    @staticmethod
    def _create_threadsafe_reasoning_callback(
        loop: asyncio.AbstractEventLoop,
        channel: asyncio.Queue,
        session_id: str,
    ) -> Callable[[str], None]:
        """Senkron HTTP okuma iş parçacığından asyncio kuyruğuna güvenli reasoning (düşünce) gönderen callback döner."""
        def _on_reasoning(text: str) -> None:
            asyncio.run_coroutine_threadsafe(
                channel.put({"event": "reasoning", "text": text, "session_id": session_id}),
                loop,
            ).result(timeout=10)

        return _on_reasoning

    @staticmethod
    def _create_threadsafe_tool_calls_callback(
        loop: asyncio.AbstractEventLoop,
        channel: asyncio.Queue,
        session_id: str,
    ) -> Callable[[List[Dict[str, Any]]], None]:
        """Senkron HTTP okuma iş parçacığından asyncio kuyruğuna güvenli tool_calls gönderen callback döner."""
        def _on_tool_calls(tool_calls: List[Dict[str, Any]]) -> None:
            asyncio.run_coroutine_threadsafe(
                channel.put({"event": "tool_calls", "tool_calls": tool_calls, "session_id": session_id}),
                loop,
            ).result(timeout=10)

        return _on_tool_calls

    @staticmethod
    def _format_sse_chunk(
        job_id: str,
        created_ts: int,
        model: str,
        delta: DeltaMessageDTO,
        finish_reason: str | None = None,
        conversation_id: str | None = None,
    ) -> str:
        """Tek bir ChatCompletionChunkDTO nesnesini SSE 'data: ...' satırı olarak biçimlendirir."""
        chunk = ChatCompletionChunkDTO(
            id=job_id,
            created=created_ts,
            model=model,
            conversation_id=conversation_id,
            choices=[
                ChatCompletionChunkChoiceDTO(
                    delta=delta,
                    finish_reason=finish_reason,  # type: ignore[arg-type]
                )
            ],
        )
        return f"data: {chunk.model_dump_json(exclude_none=True)}\n\n"
