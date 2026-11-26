"""
ThinkPort AI Gateway - Excel (.xlsx / .xls) -> Markdown Ayrıştırıcı (xlsx_parser.py).
Çalışma sayfalarını başlıklar (`## Sayfa`) ve Markdown tabloları halinde çıkarır.
"""
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import List, Tuple
from app.services.document_parsers.base import IDocumentParser


class XlsxDocumentParser(IDocumentParser):
    """Excel (.xlsx / .xls) çalışma kitaplarını Markdown tablolarına dönüştürür."""

    _NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

    @property
    def supported_extensions(self) -> Tuple[str, ...]:
        return (".xlsx", ".xls")

    def parse_to_markdown(self, filename: str, raw_bytes: bytes) -> str:
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
                names = archive.namelist()
                shared_strings = self._load_shared_strings(archive, names)
                sheet_names = self._load_sheet_names(archive, names)

                sheet_files = sorted(
                    (n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")),
                    key=self._sheet_sort_key,
                )
                if not sheet_files:
                    return "\n".join(shared_strings).strip()

                out_lines: List[str] = []
                for idx, sf in enumerate(sheet_files, 1):
                    title = sheet_names[idx - 1] if idx - 1 < len(sheet_names) else f"Sayfa {idx}"
                    s_root = ET.fromstring(archive.read(sf))
                    rows: List[List[str]] = []
                    for row in s_root.iter(f"{self._NS}row"):
                        row_vals: List[str] = []
                        for c in row.findall(f"{self._NS}c"):
                            val = self._read_cell_value(c, shared_strings)
                            row_vals.append(val.replace("|", "\\|"))
                        if any(row_vals):
                            rows.append(row_vals)

                    if not rows:
                        continue

                    out_lines.append(f"## {title}")
                    col_count = max(len(r) for r in rows)
                    for r_idx, r in enumerate(rows):
                        padded = r + [""] * (col_count - len(r))
                        out_lines.append("| " + " | ".join(padded) + " |")
                        if r_idx == 0:
                            out_lines.append("| " + " | ".join(["---"] * col_count) + " |")
                    out_lines.append("")

                return "\n".join(out_lines).strip()
        except Exception:
            return ""

    @staticmethod
    def _sheet_sort_key(path: str) -> int:
        m = re.search(r"sheet(\d+)\.xml$", path)
        return int(m.group(1)) if m else 9999

    def _load_shared_strings(self, archive: zipfile.ZipFile, names: List[str]) -> List[str]:
        shared: List[str] = []
        if "xl/sharedStrings.xml" not in names:
            return shared
        ss_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        for si in ss_root.iter(f"{self._NS}si"):
            texts = [t.text or "" for t in si.iter(f"{self._NS}t")]
            shared.append("".join(texts).strip())
        return shared

    def _load_sheet_names(self, archive: zipfile.ZipFile, names: List[str]) -> List[str]:
        if "xl/workbook.xml" not in names:
            return []
        try:
            wb_root = ET.fromstring(archive.read("xl/workbook.xml"))
            return [
                (s.attrib.get("name") or "").strip()
                for s in wb_root.iter(f"{self._NS}sheet")
                if (s.attrib.get("name") or "").strip()
            ]
        except Exception:
            return []

    def _read_cell_value(self, c_elem: ET.Element, shared_strings: List[str]) -> str:
        c_type = c_elem.attrib.get("t", "")
        v_elem = c_elem.find(f"{self._NS}v")
        is_elem = c_elem.find(f"{self._NS}is")
        if c_type == "s" and v_elem is not None and v_elem.text:
            try:
                s_idx = int(v_elem.text)
                if 0 <= s_idx < len(shared_strings):
                    return shared_strings[s_idx]
            except Exception:
                return v_elem.text
        elif c_type == "inlineStr" and is_elem is not None:
            return "".join(t.text or "" for t in is_elem.iter(f"{self._NS}t")).strip()
        elif v_elem is not None and v_elem.text:
            return v_elem.text.strip()
        return ""
