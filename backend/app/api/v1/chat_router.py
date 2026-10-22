from __future__ import annotations
from fastapi import APIRouter, Depends
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
) -> StreamingResponse | ChatCompletionResponseDTO:
    """OpenAI uyumlu sohbet tamamlama (SSE streaming veya senkron JSON) uç noktası."""
    job = chat_service.initiate_chat_job(request, user_ctx)
    if request.stream:
        headers = {**SSE_HEADERS, "X-Conversation-Id": job.conversation_id}
        return StreamingResponse(
            chat_service.stream_sse_generator(job),
            media_type="text/event-stream",
            headers=headers,
        )
    return await chat_service.build_sync_response(job)


for _chat_path in CHAT_COMPLETION_PATHS:
    router.add_api_route(
        _chat_path,
        create_chat_completion,
        methods=["POST"],
        response_model=None,
        include_in_schema=(_chat_path == "/v1/chat/completions"),
    )
