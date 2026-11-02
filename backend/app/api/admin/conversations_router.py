"""
ThinkPort AI Gateway - Sohbet Oturumları ve Geçmişi Yönetim Yönlendiricisi (conversations_router.py).
AI Sohbet Stüdyosu ve harici API istemcileri üzerinden gerçekleşen sohbet oturumlarının listelenmesini,
detay görüntülenmesini, güncellenmesini, silinmesini ve SSE ile anlık (real-time) yayınlanmasını sağlar.
"""
import asyncio
import json
from typing import AsyncGenerator, List, Optional
from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse
from app.core.dependencies import get_conversation_service
from app.dtos.conversation_dto import (
    ConversationDetailDTO,
    ConversationSummaryDTO,
    CreateConversationRequestDTO,
    RecordTurnRequestDTO,
    UpdateConversationRequestDTO,
)
from app.repositories.conversation_repository import conversation_event_broadcaster
from app.services.conversation_service import ConversationService

router = APIRouter(prefix="/admin/conversations", tags=["Admin Conversations & Chat History"])


@router.get("", response_model=List[ConversationSummaryDTO])
async def list_conversations(
    user_id: Optional[str] = Query(default=None),
    model_id: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    arama: Optional[str] = Query(default=None),
    aramaKelimesi: Optional[str] = Query(default=None),
    aramaTipi: Optional[str] = Query(default=None),
    arsivdekiler: Optional[bool] = Query(default=False),
    silinmisleriGetir: Optional[bool] = Query(default=False),
    silinenler: Optional[bool] = Query(default=False),
    sortField: Optional[str] = Query(default=None),
    sirala: Optional[str] = Query(default=None),
    sortOrder: Optional[str] = Query(default="desc"),
    yon: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=100, ge=1, le=500),
    limit: Optional[int] = Query(default=None, ge=1, le=500),
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> List[ConversationSummaryDTO]:
    """
    İstekte bulunan kullanıcının rolüne göre sohbet oturumlarını listeler:
    - Admin ('admin'): Kendisinin ve tüm kullanıcıların sohbet geçmişini döner.
    - Normal Kullanıcı ('user'): Sadece kendisine ait sohbet listesini döner.
    """
    effective_search = search or arama or aramaKelimesi
    effective_sort_field = sortField or sirala
    effective_sort_order = yon or sortOrder or "desc"
    effective_page_size = limit or pageSize
    effective_deleted = bool(silinmisleriGetir or silinenler)

    return await asyncio.to_thread(
        service.list_conversations,
        authorization=authorization,
        x_user_id=x_user_id,
        user_id=user_id,
        model_id=model_id,
        source=source,
        search=effective_search,
        search_field=aramaTipi,
        is_archived=bool(arsivdekiler),
        is_deleted=effective_deleted,
        sort_field=effective_sort_field,
        sort_order=effective_sort_order,
        page=page,
        page_size=effective_page_size,
    )


@router.post("", response_model=ConversationSummaryDTO)
async def create_conversation(
    request: CreateConversationRequestDTO,
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationSummaryDTO:
    """Yeni bir sohbet oturumu oluşturur."""
    return await asyncio.to_thread(
        service.create_conversation, request, authorization, x_user_id
    )


@router.get("/events")
async def stream_conversation_events(request: Request) -> StreamingResponse:
    """
    AI Sohbet Stüdyosu listesinin yeni gelen API/Stüdyo sohbetlerini ve mesajlarını
    sayfa yenilemeye gerek kalmadan anlık (real-time) olarak listelemesi için SSE akışı sunar.
    Yoğun kullanımda art arda gelen olayları 150ms pencerede birleştirerek (coalescing)
    istemciye fırtına (event storm) gönderilmesini önler.
    """
    async def event_generator() -> AsyncGenerator[str, None]:
        sub_entry = conversation_event_broadcaster.subscribe()
        _, queue = sub_entry
        try:
            init_payload = {
                "event": "connected",
                "revision": conversation_event_broadcaster.revision,
            }
            yield f"data: {json.dumps(init_payload, ensure_ascii=False)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event_data = await asyncio.wait_for(queue.get(), timeout=15.0)
                    # Kısa birleştirme penceresi: eşzamanlı patlamalarda (burst) kuyruktaki son durumu al
                    await asyncio.sleep(0.15)
                    while not queue.empty():
                        try:
                            event_data = queue.get_nowait()
                        except Exception:
                            break
                    yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            conversation_event_broadcaster.unsubscribe(sub_entry)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/record-turn")
async def record_conversation_turn(
    request: RecordTurnRequestDTO,
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> dict:
    """Sohbet turunu idempotent olarak veritabanına kaydeder."""
    return await asyncio.to_thread(
        service.record_turn, request, authorization, x_user_id
    )


@router.get("/{conversation_id}", response_model=ConversationDetailDTO)
async def get_conversation_detail(
    conversation_id: str,
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationDetailDTO:
    """Belirtilen sohbet oturumunu yetki kontrolü yaparak tüm mesajları ve ekli dosya isimleriyle döner."""
    return await asyncio.to_thread(
        service.get_conversation_or_404, conversation_id, authorization, x_user_id
    )


@router.patch("/{conversation_id}", response_model=ConversationSummaryDTO)
async def update_conversation(
    conversation_id: str,
    request: UpdateConversationRequestDTO,
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationSummaryDTO:
    """Sohbet oturumunun başlığını, seçili modelini veya sabitleme durumunu günceller."""
    return await asyncio.to_thread(
        service.update_conversation_or_404,
        conversation_id,
        request,
        authorization,
        x_user_id,
    )


@router.put("/{conversation_id}/restore", response_model=ConversationSummaryDTO)
async def restore_conversation(
    conversation_id: str,
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationSummaryDTO:
    """Çöp kutusundaki sohbet oturumunu yetki kontrolüyle geri yükler."""
    return await asyncio.to_thread(
        service.restore_conversation_or_404,
        conversation_id,
        authorization,
        x_user_id,
    )


@router.put("/{conversation_id}/archive", response_model=ConversationSummaryDTO)
async def archive_conversation(
    conversation_id: str,
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationSummaryDTO:
    """Sohbet oturumunu yetki kontrolüyle arşive alır."""
    return await asyncio.to_thread(
        service.update_conversation_or_404,
        conversation_id,
        UpdateConversationRequestDTO(is_archived=True, is_deleted=False),
        authorization,
        x_user_id,
    )


@router.put("/{conversation_id}/unarchive", response_model=ConversationSummaryDTO)
async def unarchive_conversation(
    conversation_id: str,
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationSummaryDTO:
    """Arşivdeki sohbet oturumunu yetki kontrolüyle arşivden çıkarır."""
    return await asyncio.to_thread(
        service.update_conversation_or_404,
        conversation_id,
        UpdateConversationRequestDTO(is_archived=False, is_deleted=False),
        authorization,
        x_user_id,
    )


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    permanent: bool = Query(default=False),
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> dict:
    """Sohbet oturumunu yetki kontrolüyle çöp kutusuna taşır veya kalıcı olarak siler."""
    return await asyncio.to_thread(
        service.delete_conversation_or_404,
        conversation_id,
        authorization,
        x_user_id,
        permanent,
    )

