from typing import List, Optional
from fastapi import APIRouter, Depends, Header, Query
from app.core.dependencies import get_conversation_service
from app.dtos.conversation_dto import (
    ConversationDetailDTO,
    ConversationSummaryDTO,
    CreateConversationRequestDTO,
    UpdateConversationRequestDTO,
)
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

    return service.list_conversations(
        authorization=authorization,
        x_user_id=x_user_id,
        user_id=user_id,
        model_id=model_id,
        source=source,
        search=effective_search,
        search_field=aramaTipi,
        is_archived=bool(arsivdekiler),
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
    return service.create_conversation(request, authorization, x_user_id)


@router.get("/{conversation_id}", response_model=ConversationDetailDTO)
async def get_conversation_detail(
    conversation_id: str,
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationDetailDTO:
    """Belirtilen sohbet oturumunu yetki kontrolü yaparak tüm mesajları ve ekli dosya isimleriyle döner."""
    return service.get_conversation_or_404(conversation_id, authorization, x_user_id)


@router.patch("/{conversation_id}", response_model=ConversationSummaryDTO)
async def update_conversation(
    conversation_id: str,
    request: UpdateConversationRequestDTO,
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> ConversationSummaryDTO:
    """Sohbet oturumunun başlığını, seçili modelini veya sabitleme durumunu günceller."""
    return service.update_conversation_or_404(conversation_id, request, authorization, x_user_id)


@router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    authorization: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
    service: ConversationService = Depends(get_conversation_service),
) -> dict:
    """Sohbet oturumunu ve ilişkili tüm mesaj/dosya kayıtlarını yetki kontrolüyle siler."""
    return service.delete_conversation_or_404(conversation_id, authorization, x_user_id)

