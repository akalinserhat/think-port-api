"""
ThinkPort AI Gateway - PowerPoint (.pptx) -> Markdown Ayrıştırıcı (pptx_parser.py).
Slaytları sırayla `## Slayt N` başlıkları ve madde/paragraf yapısıyla Markdown'a çevirir.
"""
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import List, Tuple
from app.services.document_parsers.base import IDocumentParser


class PptxDocumentParser(IDocumentParser):
    """PowerPoint (.pptx) sunumlarını slayt bazlı Markdown metnine dönüştürür."""

    _A_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"

    @property
    def supported_extensions(self) -> Tuple[str, ...]:
        return (".pptx",)

    def parse_to_markdown(self, filename: str, raw_bytes: bytes) -> str:
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
                slide_files = sorted(
                    (n for n in archive.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")),
                    key=self._slide_sort_key,
                )
                if not slide_files:
                    return ""

                sections: List[str] = []
                for idx, sf in enumerate(slide_files, 1):
                    root = ET.fromstring(archive.read(sf))
                    slide_lines: List[str] = []
                    for p in root.iter(f"{self._A_NS}p"):
                        txt = "".join(t.text or "" for t in p.iter(f"{self._A_NS}t")).strip()
                        if txt:
                            slide_lines.append(f"- {txt}" if slide_lines else f"### {txt}")
                    if slide_lines:
                        sections.append(f"## Slayt {idx}\n" + "\n".join(slide_lines))
                return "\n\n".join(sections).strip()
        except Exception:
            return ""

    @staticmethod
    def _slide_sort_key(path: str) -> int:
        m = re.search(r"slide(\d+)\.xml$", path)
        return int(m.group(1)) if m else 9999
