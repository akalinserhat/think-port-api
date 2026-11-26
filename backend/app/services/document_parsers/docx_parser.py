"""
ThinkPort AI Gateway - Word (.docx) -> Markdown Ayrıştırıcı (docx_parser.py).
Paragraf stillerini (Heading1..4, Title, ListParagraph) Markdown başlık/listelere ve tabloları Markdown tablolarına çevirir.
"""
import io
import xml.etree.ElementTree as ET
import zipfile
from typing import List, Tuple
from app.services.document_parsers.base import IDocumentParser


class DocxDocumentParser(IDocumentParser):
    """Word (.docx) belgelerini başlık hiyerarşisi ve tablolarıyla Markdown'a dönüştürür."""

    _NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

    @property
    def supported_extensions(self) -> Tuple[str, ...]:
        return (".docx",)

    def parse_to_markdown(self, filename: str, raw_bytes: bytes) -> str:
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
                if "word/document.xml" not in archive.namelist():
                    return self._extract_fallback_xml(archive)
                xml_bytes = archive.read("word/document.xml")
                root = ET.fromstring(xml_bytes)
                body = root.find(f"{self._NS}body")
                if body is None:
                    return self._iter_xml_text(xml_bytes)

                lines: List[str] = []
                for elem in body:
                    if elem.tag == f"{self._NS}p":
                        p_md = self._format_paragraph_markdown(elem)
                        if p_md:
                            lines.append(p_md)
                    elif elem.tag == f"{self._NS}tbl":
                        table_md = self._format_table_markdown(elem)
                        if table_md:
                            lines.append("")
                            lines.extend(table_md)
                            lines.append("")
                return "\n".join(lines).strip()
        except Exception:
            return ""

    def _format_paragraph_markdown(self, p_elem: ET.Element) -> str:
        text = self._extract_paragraph_text(p_elem)
        if not text:
            return ""

        style_val = ""
        p_pr = p_elem.find(f"{self._NS}pPr")
        if p_pr is not None:
            p_style = p_pr.find(f"{self._NS}pStyle")
            if p_style is not None:
                style_val = (p_style.attrib.get(f"{self._NS}val") or p_style.attrib.get("val") or "").lower()
            num_pr = p_pr.find(f"{self._NS}numPr")
            if num_pr is not None and "heading" not in style_val:
                return f"- {text}"

        if style_val in ("title", "heading1", "heading 1", "baslik1", "başlık 1"):
            return f"# {text}"
        if style_val in ("subtitle", "heading2", "heading 2", "baslik2", "başlık 2"):
            return f"## {text}"
        if style_val in ("heading3", "heading 3", "baslik3", "başlık 3"):
            return f"### {text}"
        if style_val in ("heading4", "heading 4", "baslik4", "başlık 4"):
            return f"#### {text}"
        if "list" in style_val:
            return f"- {text}"
        return text

    def _format_table_markdown(self, tbl_elem: ET.Element) -> List[str]:
        rows: List[List[str]] = []
        for tr in tbl_elem.findall(f"{self._NS}tr"):
            cells: List[str] = []
            for tc in tr.findall(f"{self._NS}tc"):
                cell_paras = [self._extract_paragraph_text(p) for p in tc.iter(f"{self._NS}p")]
                cell_str = " ".join(cp for cp in cell_paras if cp).replace("|", "\\|").strip()
                cells.append(cell_str)
            if any(cells):
                rows.append(cells)

        if not rows:
            return []

        col_count = max(len(r) for r in rows)
        md_lines: List[str] = []
        for idx, r in enumerate(rows):
            padded = r + [""] * (col_count - len(r))
            md_lines.append("| " + " | ".join(padded) + " |")
            if idx == 0:
                md_lines.append("| " + " | ".join(["---"] * col_count) + " |")
        return md_lines

    def _extract_paragraph_text(self, p_elem: ET.Element) -> str:
        parts: List[str] = []
        for node in p_elem.iter():
            if node.tag == f"{self._NS}t" and node.text:
                parts.append(node.text)
            elif node.tag == f"{self._NS}tab":
                parts.append("\t")
            elif node.tag in (f"{self._NS}br", f"{self._NS}cr"):
                parts.append(" ")
        return "".join(parts).strip()

    @staticmethod
    def _iter_xml_text(xml_bytes: bytes) -> str:
        root = ET.fromstring(xml_bytes)
        return " ".join(t.strip() for t in root.itertext() if t and t.strip())

    def _extract_fallback_xml(self, archive: zipfile.ZipFile) -> str:
        chunks: List[str] = []
        for name in sorted(archive.namelist()):
            if name.startswith("word/") and name.endswith(".xml"):
                txt = self._iter_xml_text(archive.read(name))
                if txt:
                    chunks.append(txt)
        return "\n\n".join(chunks).strip()
