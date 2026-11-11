from typing import List, Optional, Tuple
from app.core.exceptions import forbidden_access_error, resource_not_found_error
from app.core.security import hash_api_key
from app.dtos.conversation_dto import (
    ConversationDetailDTO,
    ConversationSummaryDTO,
    CreateConversationRequestDTO,
    RecordTurnRequestDTO,
    UpdateConversationRequestDTO,
)
from app.repositories.api_key_repository import ApiKeyRepository
from app.repositories.conversation_repository import ConversationRepository, conversation_event_broadcaster
from app.repositories.user_repository import UserRepository


class ConversationService:
    """
    Sohbet oturumları (Conversation & Message History) iş mantığı servisi.
    Rol tabanlı yetkilendirme ile çalışır:
    - Admin ('admin'): Kendisinin ve tüm kullanıcıların sohbet geçmişini görüntüleyebilir ve yönetebilir.
    - Normal Kullanıcı ('user'): Yalnızca kendisine ait sohbet listesini ve detaylarını görüntüleyebilir.
    """

    def __init__(
        self,
        conversation_repo: ConversationRepository,
        api_key_repo: ApiKeyRepository,
        user_repo: UserRepository,
    ) -> None:
        self._conversation_repo = conversation_repo
        self._api_key_repo = api_key_repo
        self._user_repo = user_repo

    def list_conversations(
        self,
        authorization: Optional[str] = None,
        x_user_id: Optional[str] = None,
        user_id: Optional[str] = None,
        model_id: Optional[str] = None,
        source: Optional[str] = None,
        search: Optional[str] = None,
        search_field: Optional[str] = None,
        is_archived: bool = False,
        is_deleted: bool = False,
        sort_field: Optional[str] = None,
        sort_order: str = "desc",
        page: int = 1,
        page_size: int = 100,
    ) -> List[ConversationSummaryDTO]:
        """
        İstekte bulunan kullanıcının rolüne göre sohbet oturumlarını listeler:
        - Admin ise: Tüm kullanıcıların ve kendisinin sohbet geçmişini döner (isteğe bağlı user_id filtresi uygulanabilir).
        - Normal kullanıcı ise: Sadece kendi (requester_user_id) sohbet listesini döner.
        """
        requester_id, is_admin = self._resolve_requester(authorization, x_user_id)
        effective_user_id = user_id if is_admin else requester_id
        offset = max(0, (max(1, page) - 1) * max(1, page_size))

        return self._conversation_repo.list_conversations(
            user_id=effective_user_id,
            model_id=model_id,
            source=source,
            search=search,
            search_field=search_field,
            is_archived=is_archived,
            is_deleted=is_deleted,
            sort_field=sort_field,
            sort_order=sort_order,
            limit=page_size,
            offset=offset,
        )

    def get_conversation_or_404(
        self,
        conversation_id: str,
        authorization: Optional[str] = None,
        x_user_id: Optional[str] = None,
    ) -> ConversationDetailDTO:
        """ID değerine göre sohbet oturumunu yetki kontrolü yaparak döner."""
        detail = self._conversation_repo.get_conversation_detail(conversation_id)
        if not detail:
            raise resource_not_found_error("Sohbet oturumu bulunamadı.")
        self._assert_conversation_access(detail.user_id, authorization, x_user_id)
        return detail

    def create_conversation(
        self,
        dto: CreateConversationRequestDTO,
        authorization: Optional[str] = None,
        x_user_id: Optional[str] = None,
    ) -> ConversationSummaryDTO:
        """Yeni bir sohbet oturumu başlatır ve veritabanına kaydeder."""
        requester_id, is_admin = self._resolve_requester(authorization, x_user_id)
        target_user_id = (dto.user_id if (is_admin and dto.user_id) else requester_id)
        return self._conversation_repo.create_conversation(
            user_id=target_user_id,
            title=dto.title or "Yeni Sohbet",
            model_id=dto.model_id,
            system_prompt=dto.system_prompt,
            source=dto.source,
        )

    def update_conversation_or_404(
        self,
        conversation_id: str,
        dto: UpdateConversationRequestDTO,
        authorization: Optional[str] = None,
        x_user_id: Optional[str] = None,
    ) -> ConversationSummaryDTO:
        """Sohbet oturumunun başlık, model, arşiv veya sabitleme bilgilerini yetki kontrolüyle günceller."""
        existing = self._conversation_repo.get_conversation_summary(conversation_id)
        if not existing:
            raise resource_not_found_error("Güncellenecek sohbet oturumu bulunamadı.")
        self._assert_conversation_access(existing.user_id, authorization, x_user_id)

        updated = self._conversation_repo.update_conversation(conversation_id, dto)
        if not updated:
            raise resource_not_found_error("Güncellenecek sohbet oturumu bulunamadı.")
        return updated

    def delete_conversation_or_404(
        self,
        conversation_id: str,
        authorization: Optional[str] = None,
        x_user_id: Optional[str] = None,
        permanent: bool = False,
    ) -> dict:
        """Sohbet oturumunu yetki kontrolüyle çöp kutusuna taşır (soft delete) veya kalıcı olarak siler."""
        existing = self._conversation_repo.get_conversation_summary(conversation_id)
        if not existing:
            raise resource_not_found_error("Silinecek sohbet oturumu bulunamadı.")
        self._assert_conversation_access(existing.user_id, authorization, x_user_id)

        deleted = self._conversation_repo.delete_conversation(
            conversation_id, permanent=permanent
        )
        if not deleted:
            raise resource_not_found_error("Silinecek sohbet oturumu bulunamadı.")
        return {"status": "deleted", "id": conversation_id}

    def restore_conversation_or_404(
        self,
        conversation_id: str,
        authorization: Optional[str] = None,
        x_user_id: Optional[str] = None,
    ) -> ConversationSummaryDTO:
        """Çöp kutusundaki sohbet oturumunu yetki kontrolüyle aktif listeye geri yükler."""
        existing = self._conversation_repo.get_conversation_summary(conversation_id)
        if not existing:
            raise resource_not_found_error("Geri yüklenecek sohbet oturumu bulunamadı.")
        self._assert_conversation_access(existing.user_id, authorization, x_user_id)

        restored = self._conversation_repo.restore_conversation(conversation_id)
        if not restored:
            raise resource_not_found_error("Geri yüklenecek sohbet oturumu bulunamadı.")
        return restored

    def record_turn(
        self,
        dto: RecordTurnRequestDTO,
        authorization: Optional[str] = None,
        x_user_id: Optional[str] = None,
    ) -> dict:
        """
        Sohbet Stüdyosu veya harici istemciden gelen turu idempotent olarak (request_id kontrolüyle)
        veritabanına kaydeder; zaten ChatService tarafından kaydedilmişse mevcut kaydı korur.
        """
        from app.repositories import postgres_cli_bridge

        payload = dto.model_dump()
        payload["authorization"] = authorization or ""
        payload["x_user_id"] = x_user_id or ""
        res = postgres_cli_bridge.record_turn(payload)
        conv_id = res.get("conversation_id")
        if conv_id:
            conversation_event_broadcaster.publish("message_appended", str(conv_id))
        return res

    def _assert_conversation_access(
        self,
        owner_user_id: str,
        authorization: Optional[str] = None,
        x_user_id: Optional[str] = None,
    ) -> None:
        """Normal kullanıcının yalnızca kendi sohbet oturumuna erişebilmesini garanti eder."""
        requester_id, is_admin = self._resolve_requester(authorization, x_user_id)
        if not is_admin and owner_user_id != requester_id:
            raise forbidden_access_error(
                "Bu sohbet oturumuna yalnızca oturum sahibi veya sistem yöneticisi (Admin) erişebilir."
            )

    def _resolve_requester(
        self,
        authorization: Optional[str] = None,
        x_user_id: Optional[str] = None,
    ) -> Tuple[str, bool]:
        """
        İstek başlıklarından (X-User-Id veya Authorization Bearer) çağrıyı yapan kullanıcıyı
        ve Admin yetkisine sahip olup olmadığını çözümler.
        """
        resolved_user_id: Optional[str] = None

        if x_user_id and x_user_id.strip():
            candidate = self._user_repo.get_by_id(x_user_id.strip())
            if candidate:
                resolved_user_id = candidate.id

        if not resolved_user_id and authorization:
            raw_token = authorization.replace("Bearer ", "").strip()
            if raw_token:
                key_record = self._api_key_repo.get_by_hash(hash_api_key(raw_token))
                if key_record:
                    resolved_user_id = key_record.user_id

        if not resolved_user_id:
            resolved_user_id = "sys_usr_01"

        user_record = self._user_repo.get_by_id(resolved_user_id)
        is_admin = bool(user_record and user_record.role in ("admin", "Sistem Yöneticisi"))
        return resolved_user_id, is_admin

