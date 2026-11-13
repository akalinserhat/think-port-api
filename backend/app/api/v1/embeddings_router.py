"""
ThinkPort AI Gateway - OpenAI Uyumlu `/v1/embeddings` Yönlendiricisi (embeddings_router.py).
`BAAI/bge-m3` (1024 boyut) modeli üzerinden online (SiliconFlow / Cloudflare / HuggingFace / OpenRouter / DeepInfra)
ve yerel (Ollama `bge-m3:latest`) sağlayıcı bağımsız vektör üretimini standart OpenAI formatında sunar.
"""
from __future__ import annotations
import asyncio
import base64
import struct
import time
import uuid
from typing import Any, Dict, List, Optional, Union
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from app.core.dependencies import get_admin_service, require_authenticated_user
from app.dtos.admin_dto import RecordUsageInputDTO
from app.dtos.user_dto import AuthenticatedUserContextDTO
from app.services.admin_service import AdminService
from app.services.document_service import DocumentService
from app.services.embedding_service import BGE_M3_MODEL_ID, embedding_service

router = APIRouter(tags=["OpenAI Embeddings"])


class OpenAIEmbeddingRequestDTO(BaseModel):
    """OpenAI `/v1/embeddings` standart istek gövdesi."""

    model: str = Field(default=BGE_M3_MODEL_ID, description="Model kimliği (varsayılan: BAAI/bge-m3)")
    input: Union[str, List[str]] = Field(..., description="Vektörleştirilecek metin veya metin dizisi")
    encoding_format: Optional[str] = Field(default="float", description="'float' veya 'base64'")
    user: Optional[str] = Field(default=None)


async def _handle_create_embeddings(
    payload: OpenAIEmbeddingRequestDTO,
    user_ctx: AuthenticatedUserContextDTO = Depends(require_authenticated_user),
    admin_service: AdminService = Depends(get_admin_service),
) -> Dict[str, Any]:
    """OpenAI uyumlu `/v1/embeddings` isteğini `BAAI/bge-m3` (1024d) üzerinden işler."""
    t0 = time.perf_counter()
    texts = [payload.input] if isinstance(payload.input, str) else list(payload.input)
    if not texts:
        texts = [" "]

    vectors, provider_used = await asyncio.to_thread(
        embedding_service.embed_texts,
        texts,
        True,
        None,
        len(texts) == 1,
    )

    use_base64 = (payload.encoding_format or "float").strip().lower() == "base64"
    data_items: List[Dict[str, Any]] = []
    for idx, vec in enumerate(vectors):
        emb_val: Any = vec
        if use_base64:
            packed = struct.pack(f"<{len(vec)}f", *vec)
            emb_val = base64.b64encode(packed).decode("ascii")
        data_items.append(
            {
                "object": "embedding",
                "index": idx,
                "embedding": emb_val,
            }
        )

    prompt_tokens = sum(DocumentService.estimate_tokens(t) for t in texts)
    latency_ms = int((time.perf_counter() - t0) * 1000)

    admin_service.record_usage(
        RecordUsageInputDTO(
            user_id=user_ctx.user_id,
            request_id=f"emb-{uuid.uuid4().hex[:12]}",
            model=BGE_M3_MODEL_ID,
            prompt_tokens=prompt_tokens,
            completion_tokens=0,
            is_stream=False,
            latency_ms=latency_ms,
            ttft_ms=latency_ms,
            status="success",
            upstream_provider=provider_used,
            prompt_preview=texts[0][:300] if texts else "",
            response_preview=f"[{len(vectors)} x 1024d vector via {provider_used}]",
            session_id=f"bge-m3-{provider_used}",
        )
    )

    return {
        "object": "list",
        "data": data_items,
        "model": BGE_M3_MODEL_ID,
        "provider": provider_used,
        "usage": {
            "prompt_tokens": prompt_tokens,
            "total_tokens": prompt_tokens,
        },
    }


for _emb_path in ("/v1/embeddings", "/v1/v1/embeddings", "/embeddings"):
    router.add_api_route(
        _emb_path,
        _handle_create_embeddings,
        methods=["POST"],
        include_in_schema=(_emb_path == "/v1/embeddings"),
    )
