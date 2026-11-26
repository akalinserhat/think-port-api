"""
ThinkPort AI Gateway - Düz Metin, CSV, JSON ve Kod Dosyaları -> Markdown Ayrıştırıcı (text_parser.py).
"""
import csv
import io
from typing import List, Tuple
from app.services.document_parsers.base import IDocumentParser


class PlainTextDocumentParser(IDocumentParser):
    """Düz metin, Markdown, CSV, JSON ve kaynak kod dosyalarını okunabilir Markdown'a çevirir."""

    @property
    def supported_extensions(self) -> Tuple[str, ...]:
        return (".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".log", ".yaml", ".yml")

    def can_parse(self, filename: str, raw_bytes: bytes) -> bool:
        return True

    def parse_to_markdown(self, filename: str, raw_bytes: bytes) -> str:
        decoded = self._decode_plain_text(raw_bytes)
        lower_name = (filename or "").strip().lower()
        if lower_name.endswith(".csv") or lower_name.endswith(".tsv"):
            md_table = self._csv_to_markdown(decoded, delimiter="\t" if lower_name.endswith(".tsv") else ",")
            if md_table:
                return md_table
        return decoded

    @staticmethod
    def _decode_plain_text(raw_bytes: bytes) -> str:
        for encoding in ("utf-8", "utf-8-sig", "cp1254", "latin-1"):
            try:
                return raw_bytes.decode(encoding)
            except Exception:
                continue
        return raw_bytes.decode("utf-8", errors="replace")

    @staticmethod
    def _csv_to_markdown(text: str, delimiter: str = ",") -> str:
        try:
            reader = csv.reader(io.StringIO(text), delimiter=delimiter)
            rows = [
                [cell.strip().replace("|", "\\|") for cell in row]
                for row in reader
                if any(cell.strip() for cell in row)
            ]
            if not rows:
                return ""
            col_count = max(len(r) for r in rows)
            lines: List[str] = []
            for idx, r in enumerate(rows):
                padded = r + [""] * (col_count - len(r))
                lines.append("| " + " | ".join(padded) + " |")
                if idx == 0:
                    lines.append("| " + " | ".join(["---"] * col_count) + " |")
            return "\n".join(lines).strip()
        except Exception:
            return ""
