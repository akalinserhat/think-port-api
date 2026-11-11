from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, Header
from fastapi.responses import StreamingResponse
from app.core.dependencies import get_chat_service, require_authenticated_user
from app.dtos.chat_dto import ChatCompletionRequestDTO, ChatCompletionResponseDTO
from app.dtos.user_dto import AuthenticatedUserContextDTO
from app.services.chat_service import ChatService

router = APIRouter(tags=["OpenAI Chat Completions"])

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

CHAT_COMPLETION_PATHS = (
    "/v1/chat/completions",
    "/v1/v1/chat/completions",
    "/chat/completions",
    "/api/v1/chat/completions",
    "/api/chat/completions",
)


async def create_chat_completion(
    request: ChatCompletionRequestDTO,
    user_ctx: AuthenticatedUserContextDTO = Depends(require_authenticated_user),
    chat_service: ChatService = Depends(get_chat_service),
    x_app_id: Optional[str] = Header(default=None, alias="X-App-Id"),
    x_application_id: Optional[str] = Header(default=None, alias="X-Application-Id"),
    x_agent_id: Optional[str] = Header(default=None, alias="X-Agent-Id"),
    x_agent_code: Optional[str] = Header(default=None, alias="X-Agent-Code"),
    x_agent_name: Optional[str] = Header(default=None, alias="X-Agent-Name"),
) -> StreamingResponse | ChatCompletionResponseDTO:
    """OpenAI uyumlu sohbet tamamlama (SSE streaming veya senkron JSON) uç noktası."""
    # Tenant & Agent synchronization with authenticated context to prevent tenant impersonation
    if user_ctx.app_id:
        request.app_id = user_ctx.app_id
    else:
        fallback_app = (x_app_id or "").strip() or (x_application_id or "").strip() or None
        request.app_id = (request.app_id or "").strip() or fallback_app
        user_ctx.app_id = request.app_id

    if user_ctx.agent_id:
        request.agent_id = user_ctx.agent_id
    else:
        fallback_agent = (x_agent_id or "").strip() or (x_agent_code or "").strip() or None
        effective_agent = (request.agent_id or "").strip() or (request.agent_code or "").strip() or fallback_agent
        if effective_agent:
            request.agent_id = effective_agent
            user_ctx.agent_id = effective_agent

    if not request.agent_name and x_agent_name:
        request.agent_name = x_agent_name.strip() if x_agent_name else None

    job = chat_service.initiate_chat_job(request, user_ctx)
    if request.stream:
        headers = {**SSE_HEADERS, "X-Conversation-Id": job.conversation_id}
        return StreamingResponse(
            chat_service.stream_sse_generator(job),
            media_type="text/event-stream",
            headers=headers,
        )
    return await chat_service.build_sync_response(job, user_ctx=user_ctx)


for _chat_path in CHAT_COMPLETION_PATHS:
    router.add_api_route(
        _chat_path,
        create_chat_completion,
        methods=["POST"],
        response_model=None,
        include_in_schema=(_chat_path == "/v1/chat/completions"),
    )
