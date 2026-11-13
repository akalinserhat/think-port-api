"""
ThinkPort AI Gateway - PostgreSQL (pgvector) Bulut Döküman RAG Senkronizasyon ve Arama Yönlendiricisi (rag_router.py).
Buluta yüklenen dosyaların RAG'a otomatik aktarılması (`ingest`), buluttan silinen dosyaların RAG'dan
otomatik kaldırılması (`delete`) ve hibrit vektör araması (`search`) uç noktalarını sunar.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from app.services.embedding_service import embedding_service
from app.services.rag_document_service import rag_document_service


router = APIRouter(prefix="/v1/rag", tags=["PostgreSQL pgvector RAG"])


class RagIngestRequestDTO(BaseModel):
    """Bulut dökümanını PostgreSQL (pgvector) RAG veritabanına aktarma isteği."""
    file_name: str = Field(..., description="Dosya adı (örn: Fiyat_Listesi.pdf)")
    base64_data: Optional[str] = Field(default=None, description="Base64 kodlu ham dosya içeriği")
    extracted_text: Optional[str] = Field(default=None, description="Önceden çıkarılmış metin varsa")
    app_id: str = Field(default="WEBAKUS_ERP", description="Uygulama kimliği")
    firma_id: int = Field(default=0, description="Firma ID")
    user_id: str = Field(default="", description="Yükleyen kullanıcı ID")
    bulut_dosya_id: int = Field(default=0, description="Webakus BulutDosya tablosundaki kayıt ID'si")
    cloud_file_id: str = Field(default="", description="Google Drive / OneDrive üzerindeki benzersiz dosya ID'si")
    provider: str = Field(default="google", description="Bulut sağlayıcısı (google, onedrive vb.)")
    belge_turu: str = Field(default="Genel", description="Belge türü veya klasör adı")
    belge_id: int = Field(default=0, description="İlişkili ERP belge ID'si")
    belge_no: str = Field(default="-", description="İlişkili ERP belge numarası")
    mime_type: str = Field(default="", description="Dosya MIME tipi")
    file_size: int = Field(default=0, description="Dosya boyutu (bayt)")
    conversation_id: str = Field(default="", description="Opsiyonel sohbet oturumu ID'si")


class RagDeleteRequestDTO(BaseModel):
    """Buluttan kaldırılan dökümanı RAG'dan silme isteği."""
    app_id: str = Field(default="WEBAKUS_ERP")
    firma_id: Optional[int] = Field(default=None)
    bulut_dosya_id: Optional[int] = Field(default=None)
    cloud_file_id: Optional[str] = Field(default=None)
    doc_id: Optional[str] = Field(default=None)
    file_name: Optional[str] = Field(default=None)


class RagRenameRequestDTO(BaseModel):
    """Bulutta yeniden adlandırılan dökümanı RAG'da güncelleme isteği."""
    new_file_name: str = Field(..., description="Yeni dosya adı")
    app_id: str = Field(default="WEBAKUS_ERP")
    firma_id: Optional[int] = Field(default=None)
    bulut_dosya_id: Optional[int] = Field(default=None)
    cloud_file_id: Optional[str] = Field(default=None)


class RagSearchRequestDTO(BaseModel):
    """PostgreSQL pgvector hibrit RAG arama isteği."""
    query: str = Field(..., description="Aranacak soru, ürün kodu, başlık veya anahtar kelime")
    app_id: str = Field(default="WEBAKUS_ERP")
    firma_id: Optional[int] = Field(default=None)
    bulut_dosya_id: Optional[int] = Field(default=None)
    cloud_file_id: Optional[str] = Field(default=None)
    file_name: Optional[str] = Field(default=None)
    belge_turu: Optional[str] = Field(default=None)
    section_filter: Optional[str] = Field(default=None, description="Opsiyonel bölüm veya tablo başlığı filtresi")
    strategy: Optional[str] = Field(default="HIBRIT_VEKTOR_KELIME", description="Arama stratejisi")
    min_score: Optional[float] = Field(default=None, ge=0.0, le=0.95)
    preserve_table_order: bool = Field(default=True)
    top_k: int = Field(default=8, ge=1, le=25)


@router.post("/documents/ingest")
def ingest_cloud_document(payload: RagIngestRequestDTO) -> Dict[str, Any]:
    """
    Buluta yüklenen dökümanı (.pdf, .doc, .docx, .xlsx, .csv, .txt, .md vb.)
    otomatik olarak metne çözümler, parçalara (chunk) ayırır ve PostgreSQL `pgvector`
    RAG tablolarına (`rag_cloud_documents` & `rag_document_chunks`) kaydeder.
    """
    return rag_document_service.ingest_cloud_document(
        file_name=payload.file_name,
        base64_data=payload.base64_data,
        extracted_text=payload.extracted_text,
        app_id=payload.app_id,
        firma_id=payload.firma_id,
        user_id=payload.user_id,
        bulut_dosya_id=payload.bulut_dosya_id,
        cloud_file_id=payload.cloud_file_id,
        provider=payload.provider,
        belge_turu=payload.belge_turu,
        belge_id=payload.belge_id,
        belge_no=payload.belge_no,
        mime_type=payload.mime_type,
        file_size=payload.file_size,
        conversation_id=payload.conversation_id,
    )


@router.delete("/documents")
def delete_cloud_document_by_query(
    app_id: str = Query(default="WEBAKUS_ERP"),
    firma_id: Optional[int] = Query(default=None),
    bulut_dosya_id: Optional[int] = Query(default=None),
    cloud_file_id: Optional[str] = Query(default=None),
    doc_id: Optional[str] = Query(default=None),
    file_name: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    """
    Buluttan silinen bir dökümanı sorgu parametreleriyle (`bulut_dosya_id` veya `cloud_file_id`)
    PostgreSQL `pgvector` RAG veritabanından ve tüm vektör parçalarından kaldırır.
    """
    return rag_document_service.delete_cloud_document(
        app_id=app_id,
        firma_id=firma_id,
        bulut_dosya_id=bulut_dosya_id,
        cloud_file_id=cloud_file_id,
        doc_id=doc_id,
        file_name=file_name,
    )


@router.delete("/documents/{bulut_dosya_id}")
def delete_cloud_document_by_bulut_id(
    bulut_dosya_id: int,
    app_id: str = Query(default="WEBAKUS_ERP"),
    firma_id: Optional[int] = Query(default=None),
    cloud_file_id: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    """`BulutDosya.Id` üzerinden buluttan kaldırılan dökümanı RAG'dan siler."""
    return rag_document_service.delete_cloud_document(
        app_id=app_id,
        firma_id=firma_id,
        bulut_dosya_id=bulut_dosya_id,
        cloud_file_id=cloud_file_id,
    )


@router.post("/documents/delete")
def delete_cloud_document_by_body(payload: RagDeleteRequestDTO) -> Dict[str, Any]:
    """JSON gövdesi ile buluttan kaldırılan dökümanı RAG'dan siler."""
    return rag_document_service.delete_cloud_document(
        app_id=payload.app_id,
        firma_id=payload.firma_id,
        bulut_dosya_id=payload.bulut_dosya_id,
        cloud_file_id=payload.cloud_file_id,
        doc_id=payload.doc_id,
        file_name=payload.file_name,
    )


@router.patch("/documents/rename")
@router.put("/documents/rename")
def rename_cloud_document(payload: RagRenameRequestDTO) -> Dict[str, Any]:
    """Bulutta yeniden adlandırılan dosyanın RAG kayıtlarındaki adını günceller."""
    return rag_document_service.rename_cloud_document(
        new_file_name=payload.new_file_name,
        app_id=payload.app_id,
        firma_id=payload.firma_id,
        bulut_dosya_id=payload.bulut_dosya_id,
        cloud_file_id=payload.cloud_file_id,
    )


@router.get("/documents")
def list_cloud_documents(
    app_id: str = Query(default="WEBAKUS_ERP"),
    firma_id: Optional[int] = Query(default=None),
    provider: Optional[str] = Query(default=None),
    belge_turu: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    """RAG veritabanında indekslenmiş bulut dökümanlarını listeler."""
    items = rag_document_service.list_cloud_documents(
        app_id=app_id,
        firma_id=firma_id,
        provider=provider,
        belge_turu=belge_turu,
        search=search,
    )
    return {
        "total": len(items),
        "documents": items,
    }


@router.get("/documents/by-bulut-id/{bulut_dosya_id}")
def get_cloud_document_by_bulut_id(
    bulut_dosya_id: int,
    firma_id: Optional[int] = Query(default=None),
    app_id: str = Query(default="WEBAKUS_ERP"),
    include_chunks: bool = Query(default=False),
) -> Dict[str, Any]:
    """`BulutDosya.Id` ile indekslenmiş dökümanın tam metnini ve üst verilerini döner."""
    doc = rag_document_service.get_cloud_document_by_bulut_id(
        bulut_dosya_id=bulut_dosya_id,
        firma_id=firma_id,
        app_id=app_id,
        include_chunks=include_chunks,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="RAG veritabanında bu bulut dosyası bulunamadı.")
    return doc


@router.post("/search")
def search_cloud_documents(payload: RagSearchRequestDTO) -> Dict[str, Any]:
    """PostgreSQL `pgvector` üzerinde hibrit (vektör + anahtar kelime) döküman araması yapar."""
    return rag_document_service.search_cloud_documents(
        query=payload.query,
        app_id=payload.app_id,
        firma_id=payload.firma_id,
        bulut_dosya_id=payload.bulut_dosya_id,
        cloud_file_id=payload.cloud_file_id,
        file_name=payload.file_name,
        belge_turu=payload.belge_turu,
        section_filter=payload.section_filter,
        strategy=payload.strategy,
        min_score=payload.min_score,
        preserve_table_order=payload.preserve_table_order,
        top_k=payload.top_k,
    )


class RagReindexRequestDTO(BaseModel):
    """PostgreSQL'deki mevcut RAG chunk kayıtlarını aktif BAAI/bge-m3 sağlayıcısıyla yeniden vektörleştirme isteği."""

    app_id: str = Field(default="WEBAKUS_ERP")
    firma_id: Optional[int] = Field(default=None)
    only_fallback: bool = Field(
        default=False,
        description="True ise yalnızca fallback veya boş vektörlü parçaları yeniden vektörleştirir",
    )


class RagEmbeddingTestRequestDTO(BaseModel):
    """Online veya yerel BAAI/bge-m3 sağlayıcı bağlantı testi isteği."""

    provider: Optional[str] = Field(
        default=None,
        description="Opsiyonel sağlayıcı adı (siliconflow, cloudflare, huggingface, openrouter, deepinfra, ollama)",
    )


@router.get("/embedding-status")
def get_rag_embedding_status() -> Dict[str, Any]:
    """Aktif `BAAI/bge-m3` (1024d) online ve yerel sağlayıcı durum özetini döner."""
    return embedding_service.get_status_summary()


@router.post("/embedding-test")
def test_rag_embedding_provider(payload: RagEmbeddingTestRequestDTO) -> Dict[str, Any]:
    """Belirtilen veya otomatik seçilen `BAAI/bge-m3` sağlayıcısını canlı örnek metinle test eder."""
    return embedding_service.test_connection(provider_override=payload.provider)


@router.post("/documents/reindex")
def reindex_cloud_documents(payload: RagReindexRequestDTO) -> Dict[str, Any]:
    """
    Buluttan tekrar dosya indirmeye gerek kalmadan PostgreSQL `rag_document_chunks` içindeki
    mevcut metinleri `BAAI/bge-m3` (1024d) ile yeniden vektörleştirir.
    """
    return rag_document_service.reindex_cloud_documents(
        app_id=payload.app_id,
        firma_id=payload.firma_id,
        only_fallback=payload.only_fallback,
    )

