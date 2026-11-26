"""
ThinkPort AI Gateway - Belge Çözümleme, Markdown Dönüştürme ve Token Tahminleme Servisi (document_service.py).
Modüler `document_parsers` paketini kullanarak PDF, Word (DOC/DOCX), Excel (XLS/XLSX),
PowerPoint (PPTX), RTF, CSV ve düz metin belgelerinden yapılandırılmış Markdown metni çıkarır.
"""
import base64
from app.core.config import settings
from app.core.exceptions import bad_request_error
from app.dtos.document_dto import ParseFileRequestDTO, ParseFileResponseDTO
from app.services.document_parsers import document_parser_registry


class DocumentService:
    """
    Belge çözümleme ve token tahminleme servisi.
    Tüm format ayrıştırma işlemlerini `document_parsers` kayıt defterine delege eder.
    """

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Verilen metnin yaklaşık OpenAI token sayısını hesaplar."""
        if not text:
            return 0
        return max(1, len(text.split()) * 4 // 3)

    def parse_base64_document(self, request: ParseFileRequestDTO) -> ParseFileResponseDTO:
        """Base64 kodlu dosyayı çözer, Markdown metnini çıkarır ve istatistik DTO'su döner."""
        clean_b64 = self._strip_data_url_header(request.base64_data)
        raw_bytes = self._decode_base64_bytes(clean_b64)
        extracted_text = self.extract_text_from_bytes(request.filename, raw_bytes)
        return ParseFileResponseDTO(
            filename=request.filename,
            extracted_text=extracted_text,
            char_count=len(extracted_text),
            estimated_tokens=self.estimate_tokens(extracted_text),
        )

    def extract_text_from_bytes(self, filename: str, raw_bytes: bytes) -> str:
        """Dosya uzantısına göre uygun format ayrıştırıcısını çalıştırarak Markdown metni döner."""
        parsed = document_parser_registry.parse_to_markdown(filename, raw_bytes)
        return parsed[: settings.max_extracted_document_chars]

    @staticmethod
    def _strip_data_url_header(base64_data: str) -> str:
        """Data URL ('data:...;base64,') başlığı varsa temizler."""
        if "," in base64_data and base64_data.startswith("data:"):
            return base64_data.split(",", 1)[1]
        return base64_data

    @staticmethod
    def _decode_base64_bytes(clean_b64: str) -> bytes:
        """Base64 dizgesini ikili (bytes) veriye çözer; hatalıysa 400 fırlatır."""
        try:
            return base64.b64decode(clean_b64)
        except Exception:
            raise bad_request_error("Geçersiz Base64 dosya verisi")
