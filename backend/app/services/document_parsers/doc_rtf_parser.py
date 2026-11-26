"""
ThinkPort AI Gateway - Klasik Word (.doc) ve RTF (.rtf) -> Markdown Ayrıştırıcı (doc_rtf_parser.py).
"""
import os
import re
import subprocess
import sys
import tempfile
from typing import List, Tuple
from app.services.document_parsers.base import IDocumentParser
from app.services.document_parsers.docx_parser import DocxDocumentParser


class DocRtfDocumentParser(IDocumentParser):
    """Klasik Word (.doc) ve RTF (.rtf) belgelerini Markdown/düz metne dönüştürür."""

    @property
    def supported_extensions(self) -> Tuple[str, ...]:
        return (".doc", ".rtf")

    def parse_to_markdown(self, filename: str, raw_bytes: bytes) -> str:
        lower_name = (filename or "").lower()
        if raw_bytes[:4] == b"PK\x03\x04":
            docx_res = DocxDocumentParser().parse_to_markdown(filename, raw_bytes)
            if docx_res:
                return docx_res

        if sys.platform == "darwin" and os.path.exists("/usr/bin/textutil"):
            suffix = ".rtf" if lower_name.endswith(".rtf") else ".doc"
            tmp_path = ""
            try:
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                    tmp.write(raw_bytes)
                    tmp_path = tmp.name
                proc = subprocess.run(
                    ["/usr/bin/textutil", "-convert", "txt", "-stdout", tmp_path],
                    capture_output=True,
                    text=True,
                    timeout=15,
                    check=False,
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    return proc.stdout.strip()
            except Exception:
                pass
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass

        chunks: List[str] = []
        try:
            utf16_text = raw_bytes.decode("utf-16-le", errors="ignore")
            for match in re.findall(r"[A-Za-z0-9ÇĞİÖŞÜçğıöşü.,:;!?'\"()/\-\s]{12,}", utf16_text):
                cleaned = re.sub(r"\s+", " ", match).strip()
                if len(cleaned) >= 12 and any(c.isalpha() for c in cleaned):
                    chunks.append(cleaned)
        except Exception:
            pass

        if not chunks:
            try:
                cp_text = raw_bytes.decode("cp1254", errors="ignore")
                for match in re.findall(r"[A-Za-z0-9ÇĞİÖŞÜçğıöşü.,:;!?'\"()/\-\s]{16,}", cp_text):
                    cleaned = re.sub(r"\s+", " ", match).strip()
                    if len(cleaned) >= 16 and any(c.isalpha() for c in cleaned):
                        chunks.append(cleaned)
            except Exception:
                pass

        return "\n".join(chunks).strip()
