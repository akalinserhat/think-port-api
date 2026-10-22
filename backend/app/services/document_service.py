import base64
import io
import re
import xml.etree.ElementTree as ET
import zipfile
import zlib
from typing import List
from app.core.config import settings
from app.core.exceptions import bad_request_error
from app.dtos.document_dto import ParseFileRequestDTO, ParseFileResponseDTO


class DocumentService:
    """
    Belge çözümleme ve token tahminleme servisi.
    Office (DOCX/XLSX/PPTX), PDF ve düz metin/kod dosyalarından metin çıkarımını
    tek görevli fonksiyonlarla gerçekleştirir.
    """

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Verilen metnin yaklaşık OpenAI token sayısını hesaplar."""
        if not text:
            return 0
        return max(1, len(text.split()) * 4 // 3)

    def parse_base64_document(self, request: ParseFileRequestDTO) -> ParseFileResponseDTO:
        """Base64 kodlu dosyayı çözer, metnini çıkarır ve istatistik DTO'su döner."""
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
        """Dosya uzantısına göre uygun metin çıkarıcıyı çalıştırır."""
        lower_name = filename.lower()
        if lower_name.endswith((".docx", ".xlsx", ".pptx")):
            office_text = self._extract_from_office_zip(raw_bytes)
            if office_text:
                return office_text[: settings.max_extracted_document_chars]

        if lower_name.endswith(".pdf"):
            pdf_text = self._extract_from_pdf_streams(raw_bytes)
            if pdf_text:
                return pdf_text[: settings.max_extracted_document_chars]

        return self._decode_plain_text(raw_bytes)[: settings.max_extracted_document_chars]

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

    @classmethod
    def _extract_from_office_zip(cls, raw_bytes: bytes) -> str:
        """ZIP tabanlı Office (Word, Excel, PowerPoint) XML bileşenlerinden metin çıkarır."""
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
                target_xmls = cls._filter_office_xml_paths(archive.namelist())
                chunks: List[str] = []
                for xml_name in sorted(target_xmls):
                    chunk = cls._extract_text_from_xml_bytes(archive.read(xml_name))
                    if chunk:
                        chunks.append(chunk)
                return "\n\n".join(chunks)
        except Exception:
            return ""

    @staticmethod
    def _filter_office_xml_paths(namelist: List[str]) -> List[str]:
        """Office arşivindeki metin barındıran XML dosya yollarını filtreler."""
        prefixes = ("word/document", "xl/sharedStrings", "ppt/slides/slide")
        return [name for name in namelist if name.startswith(prefixes) and name.endswith(".xml")]

    @staticmethod
    def _extract_text_from_xml_bytes(xml_bytes: bytes) -> str:
        """Tek bir XML dosyasının içindeki tüm metin düğümlerini birleştirir."""
        root = ET.fromstring(xml_bytes)
        return " ".join(t.strip() for t in root.itertext() if t and t.strip())

    @classmethod
    def _extract_from_pdf_streams(cls, raw_bytes: bytes) -> str:
        """PDF akışlarından (FlateDecode) okunabilir metin parçalarını çıkarır."""
        try:
            extracted_chunks: List[str] = []
            for match in re.finditer(rb"stream[\r\n]+(.*?)[\r\n]+endstream", raw_bytes, re.DOTALL):
                decompressed = cls._decompress_pdf_stream(match.group(1))
                extracted_chunks.extend(cls._extract_pdf_text_literals(decompressed))
            return " ".join(extracted_chunks)
        except Exception:
            return ""

    @staticmethod
    def _decompress_pdf_stream(stream_data: bytes) -> bytes:
        """Sıkıştırılmış PDF stream verisini açar; sıkıştırılmamışsa olduğu gibi döner."""
        try:
            return zlib.decompress(stream_data)
        except Exception:
            return stream_data

    @staticmethod
    def _extract_pdf_text_literals(decompressed_stream: bytes) -> List[str]:
        """Açılmış PDF akışındaki parantez içi metin operatörlerini ayıklar."""
        pieces: List[str] = []
        for txt_match in re.finditer(rb"\(([^()\\]{2,})\)", decompressed_stream):
            piece = txt_match.group(1).decode("latin-1", errors="ignore")
            if any(c.isalpha() for c in piece):
                pieces.append(piece)
        return pieces

    @staticmethod
    def _decode_plain_text(raw_bytes: bytes) -> str:
        """Yaygın karakter kodlamalarını sırasıyla deneyerek düz metne çözer."""
        for encoding in ("utf-8", "utf-8-sig", "cp1254", "latin-1"):
            try:
                return raw_bytes.decode(encoding)
            except Exception:
                continue
        return raw_bytes.decode("utf-8", errors="replace")
