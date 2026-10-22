from __future__ import annotations
import asyncio
import time
import uuid
from typing import AsyncGenerator, Callable, Dict, Any, List, Optional, Tuple
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
from app.repositories.conversation_repository import ConversationRepository
from app.services.auth_service import AuthService
from app.services.model_service import ModelService
from app.services.message_formatter_service import MessageFormatterService
from app.services.llm_provider_service import LlmProviderService
from app.services.image_service import ImageService
from app.services.document_service import DocumentService


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
        prompt_tokens = self._formatter.estimate_prompt_tokens(request.messages)

        clean_user_text, attachments, system_prompt = (
            self._formatter.extract_last_user_message_details(request.messages)
        )
        source = request.source or ("studio" if request.conversation_id else "api")
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

        saved_user_msg = self._conversation_repo.append_message(
            conversation_id=conversation.id,
            user_id=user_ctx.user_id,
            role="user",
            model_id=normalized_model,
            content=clean_user_text,
            request_id=job_id,
            provider=provider,
            attachments=attachments,
            prompt_tokens=prompt_tokens,
            completion_tokens=0,
            auto_update_title=True,
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
            prompt_tokens=prompt_tokens,
            response_format=normalized_rf,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )
        gateway_logger.info(
            f"CHAT_START | id={job_id} | conv={conversation.id} | user={user_ctx.user_id} "
            f"| requested_model={request.model} | resolved_model={normalized_model} "
            f"| json_mode={self._formatter.is_json_mode_requested(normalized_rf)} "
            f"| files={[a.file_name for a in attachments]} | stream={request.stream}"
        )
        asyncio.create_task(self._execute_ai_job(job))
        return job

    async def build_sync_response(self, job: ChatJobDTO) -> ChatCompletionResponseDTO:
        """Kanaldan tüm yanıt parçalarını toplar, JSON modundaysa ayıklar ve OpenAI senkron yanıt DTO'su oluşturur."""
        full_content, completion_tokens, _, _ = await self._collect_full_response(job)
        if self._formatter.is_json_mode_requested(job.response_format):
            full_content = self._formatter.extract_and_normalize_json_content(full_content)
            completion_tokens = DocumentService.estimate_tokens(full_content)

        return ChatCompletionResponseDTO(
            id=job.job_id,
            model=job.model,
            conversation_id=job.conversation_id,
            choices=[
                ChatCompletionChoiceDTO(
                    index=0,
                    message=ChatMessageDTO(role="assistant", content=full_content),
                    finish_reason="stop",
                )
            ],
            usage=CompletionUsageDTO(
                prompt_tokens=job.prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=job.prompt_tokens + completion_tokens,
            ),
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

                if payload["event"] == "delta":
                    delta_text = payload["text"]
                    if ttft_ms == 0:
                        ttft_ms = int((time.perf_counter() - start_time) * 1000)
                    collected_chunks.append(delta_text)
                    completion_tokens += DocumentService.estimate_tokens(delta_text)
                    yield self._format_sse_chunk(
                        job.job_id,
                        created_ts,
                        job.model,
                        DeltaMessageDTO(content=delta_text),
                        conversation_id=job.conversation_id,
                    )
                elif payload["event"] == "done":
                    finish_reason = "error" if status in ("error", "timeout") and not collected_chunks else "stop"
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
            self._finalize_job(
                job=job,
                completion_tokens=completion_tokens,
                is_stream=True,
                start_time=start_time,
                ttft_ms=ttft_ms,
                status=status,
                upstream_provider=upstream_provider,
                response_preview="".join(collected_chunks),
                error_detail=error_detail,
                session_id=used_session,
            )

    async def _collect_full_response(self, job: ChatJobDTO) -> Tuple[str, int, str, int]:
        """Senkron istekler için kanaldaki tüm delta parçalarını üst zaman aşımı kontrolüyle birleştirir."""
        channel = self._channel_repo.get_channel(job.job_id)
        collected: List[str] = []
        start_time = time.perf_counter()
        deadline = start_time + float(settings.web_gateway_timeout_sec)
        ttft_ms = 0
        used_session = "sess-gpt-01"
        upstream_provider = job.provider
        status = "success"
        error_detail = ""

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

                    if payload["event"] == "delta":
                        if ttft_ms == 0:
                            ttft_ms = int((time.perf_counter() - start_time) * 1000)
                        collected.append(payload["text"])
                    elif payload["event"] == "done":
                        break
        except asyncio.TimeoutError:
            status = "timeout"
            error_detail = (
                f"Model '{job.requested_model or job.model}' ({job.model}) "
                f"{settings.web_gateway_timeout_sec} saniye içinde yanıt vermedi (Gateway Timeout)."
            )
            gateway_logger.error(
                f"CHAT_SYNC_TIMEOUT | id={job.job_id} | model={job.model} | timeout={settings.web_gateway_timeout_sec}s"
            )
        finally:
            full_text = "".join(collected)
            if self._formatter.is_json_mode_requested(job.response_format) and full_text and status == "success":
                full_text = self._formatter.extract_and_normalize_json_content(full_text)
            comp_tokens = DocumentService.estimate_tokens(full_text)
            latency_ms = self._finalize_job(
                job=job,
                completion_tokens=comp_tokens,
                is_stream=False,
                start_time=start_time,
                ttft_ms=ttft_ms,
                status=status,
                upstream_provider=upstream_provider,
                response_preview=full_text,
                error_detail=error_detail,
                session_id=used_session,
            )

        if status == "timeout" or (status == "error" and not full_text):
            raise gateway_timeout_error(
                message=error_detail
                or f"Model '{job.requested_model or job.model}' ({job.model}) alt sağlayıcısından sürede yanıt alınamadı."
            )

        return full_text, comp_tokens, used_session, latency_ms

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
    ) -> int:
        """
        İş tamamlandığında kanalı siler, eşzamanlılık slotunu bırakır,
        modelin ürettiği tam yanıtı SQLite chat_messages tablosuna yazar ve telemetriyi kaydeder.
        """
        self._channel_repo.remove_channel(job.job_id)
        self._auth_service.release_concurrency_slot(job.user_id)
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        clean_user_text, attachments, _ = (
            self._formatter.extract_last_user_message_details(job.messages)
        )
        attachment_names = [a.file_name for a in attachments]

        self._conversation_repo.append_message(
            conversation_id=job.conversation_id,
            user_id=job.user_id,
            role="assistant",
            model_id=job.model,
            content=response_preview,
            request_id=job.job_id,
            provider=upstream_provider,
            attachments=None,
            prompt_tokens=0,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
            ttft_ms=ttft_ms or latency_ms,
            status=status,
            error_detail=error_detail,
            auto_update_title=False,
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
                ttft_ms=ttft_ms or latency_ms,
                status=status,
                upstream_provider=upstream_provider,
                prompt_preview=clean_user_text,
                response_preview=response_preview,
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
            merge_system_into_user=True,
        )
        loop = asyncio.get_running_loop()

        image_def = self._model_service.find_image_model(job.model)
        web_def = self._model_service.find_web_model(job.model)
        upstream_name = job.provider

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
    ) -> bool:
        """Web AI sağlayıcısını çalıştırır; ulaşılamazsa yerel Ollama yedek modeline düşer."""
        callback = self._create_threadsafe_delta_callback(loop, channel, session_id)
        web_model_name = web_def.web_model or "openai-fast"

        success = await asyncio.to_thread(
            self._llm_provider.stream_from_pollinations_web,
            web_model_name,
            prepared.multimodal_messages,
            callback,
            web_def.id,
            response_format,
            temperature,
        )
        if not success and prepared.has_multimodal:
            success = await asyncio.to_thread(
                self._llm_provider.stream_from_pollinations_web,
                web_model_name,
                prepared.text_only_messages,
                callback,
                web_def.id,
                response_format,
                temperature,
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
                callback,
                response_format,
                temperature,
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
    ) -> bool:
        """Yerel Ollama modelinden akış alır; Ollama kapalıysa otomatik olarak Web AI köprüsünü kullanır."""
        callback = self._create_threadsafe_delta_callback(loop, channel, session_id)
        success = await asyncio.to_thread(
            self._llm_provider.stream_from_ollama,
            model_id,
            prepared.multimodal_messages,
            callback,
            response_format,
            temperature,
        )
        if not success and prepared.has_multimodal:
            success = await asyncio.to_thread(
                self._llm_provider.stream_from_ollama,
                model_id,
                prepared.text_only_messages,
                callback,
                response_format,
                temperature,
            )
        if success:
            return True

        return await asyncio.to_thread(
            self._llm_provider.stream_from_pollinations_web,
            "openai-fast",
            prepared.text_only_messages,
            callback,
            model_id,
            response_format,
            temperature,
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
