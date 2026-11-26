"""
ThinkPort AI Gateway - Modüler Belge Ayrıştırıcı Kayıt Defteri (registry.py).
"""
from typing import List
from app.services.document_parsers.base import IDocumentParser
from app.services.document_parsers.doc_rtf_parser import DocRtfDocumentParser
from app.services.document_parsers.docx_parser import DocxDocumentParser
from app.services.document_parsers.pdf_parser import PdfDocumentParser
from app.services.document_parsers.pptx_parser import PptxDocumentParser
from app.services.document_parsers.text_parser import PlainTextDocumentParser
from app.services.document_parsers.xlsx_parser import XlsxDocumentParser


class DocumentParserRegistry:
    """Kayıtlı format ayrıştırıcılarını sırayla deneyerek Markdown metin üretir."""

    def __init__(self) -> None:
        self._parsers: List[IDocumentParser] = [
            DocxDocumentParser(),
            DocRtfDocumentParser(),
            XlsxDocumentParser(),
            PptxDocumentParser(),
            PdfDocumentParser(),
            PlainTextDocumentParser(),
        ]

    def parse_to_markdown(self, filename: str, raw_bytes: bytes) -> str:
        """Dosya formatına uygun ilk ayrıştırıcıyı çalıştırır ve Markdown döner."""
        for parser in self._parsers:
            if parser.can_parse(filename, raw_bytes):
                result = parser.parse_to_markdown(filename, raw_bytes)
                if result:
                    return result
        return ""


document_parser_registry = DocumentParserRegistry()
