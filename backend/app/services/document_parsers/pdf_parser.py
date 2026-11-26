"""
ThinkPort AI Gateway - PDF (.pdf) -> Markdown Ayrıştırıcı (pdf_parser.py).
pypdf / PyMuPDF / macOS PDFKit ve ToUnicode CMap + BT..ET akışlarıyla sayfa bazlı Markdown üretir.
"""
import io
import os
import re
import subprocess
import sys
import tempfile
import zlib
from typing import Dict, List, Tuple
from app.services.document_parsers.base import IDocumentParser


class PdfDocumentParser(IDocumentParser):
    """PDF belgelerini Türkçe karakterleri koruyarak sayfa bazlı Markdown'a dönüştürür."""

    @property
    def supported_extensions(self) -> Tuple[str, ...]:
        return (".pdf",)

    def can_parse(self, filename: str, raw_bytes: bytes) -> bool:
        return super().can_parse(filename, raw_bytes) or raw_bytes[:5] == b"%PDF-"

    def parse_to_markdown(self, filename: str, raw_bytes: bytes) -> str:
        try:
            import pypdf  # type: ignore

            reader = pypdf.PdfReader(io.BytesIO(raw_bytes))
            pages = []
            for idx, page in enumerate(reader.pages, 1):
                txt = (page.extract_text() or "").strip()
                if txt:
                    pages.append(f"## Sayfa {idx}\n\n{txt}")
            if pages:
                return "\n\n".join(pages)
        except Exception:
            pass

        try:
            import fitz  # type: ignore

            doc = fitz.open(stream=raw_bytes, filetype="pdf")
            pages = []
            for idx, page in enumerate(doc, 1):
                txt = (page.get_text("text") or "").strip()
                if txt:
                    pages.append(f"## Sayfa {idx}\n\n{txt}")
            if pages:
                return "\n\n".join(pages)
        except Exception:
            pass

        if sys.platform == "darwin":
            pdfkit_text = self._extract_via_macos_pdfkit(raw_bytes)
            if pdfkit_text and pdfkit_text.strip():
                return pdfkit_text.strip()

        return self._extract_from_pdf_streams(raw_bytes)

    @staticmethod
    def _extract_via_macos_pdfkit(raw_bytes: bytes) -> str:
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(raw_bytes)
                tmp_path = tmp.name

            jxa_script = (
                'ObjC.import("Foundation");'
                'ObjC.import("PDFKit");'
                "var args = $.NSProcessInfo.processInfo.arguments;"
                "var path = ObjC.unwrap(args.objectAtIndex(args.count - 1));"
                "var url = $.NSURL.fileURLWithPath(path);"
                "var doc = $.PDFDocument.alloc.initWithURL(url);"
                "if (!doc || doc.isNil()) { ''; } else {"
                "  var out = [];"
                "  var cnt = doc.pageCount;"
                "  for (var i = 0; i < cnt; i++) {"
                "    var page = doc.pageAtIndex(i);"
                "    if (page && !page.isNil()) {"
                "      var s = ObjC.unwrap(page.string);"
                "      if (s && s.trim().length > 0) {"
                "        out.push('## Sayfa ' + (i + 1) + '\\n\\n' + s.trim());"
                "      }"
                "    }"
                "  }"
                "  out.join('\\n\\n');"
                "}"
            )
            proc = subprocess.run(
                ["/usr/bin/osascript", "-l", "JavaScript", "-e", jxa_script, tmp_path],
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
        return ""

    @classmethod
    def _extract_from_pdf_streams(cls, raw_bytes: bytes) -> str:
        try:
            decompressed_streams: List[bytes] = []
            cmap: Dict[int, str] = {}

            for match in re.finditer(
                rb"(\d+\s+\d+\s+obj[\s\S]*?)?stream\r?\n(.*?)\r?\nendstream",
                raw_bytes,
                re.DOTALL,
            ):
                header = match.group(1) or b""
                if any(
                    skip_tag in header
                    for skip_tag in (
                        b"/Subtype /Image",
                        b"/Subtype/Image",
                        b"/DCTDecode",
                        b"/FontFile",
                        b"/Type /XRef",
                        b"/Type/XRef",
                        b"/Type /ObjStm",
                        b"/Type/ObjStm",
                    )
                ):
                    continue

                stream_data = match.group(2)
                try:
                    decompressed = zlib.decompress(stream_data)
                except Exception:
                    continue

                if b"beginbfchar" in decompressed or b"beginbfrange" in decompressed:
                    cls._parse_tounicode_cmap(decompressed, cmap)
                elif b"BT" in decompressed and b"ET" in decompressed:
                    decompressed_streams.append(decompressed)

            extracted_lines: List[str] = []
            for stream in decompressed_streams:
                lines = cls._extract_pdf_bt_et_text(stream, cmap)
                if lines:
                    extracted_lines.extend(lines)

            return "\n".join(extracted_lines).strip()
        except Exception:
            return ""

    @staticmethod
    def _parse_tounicode_cmap(cmap_bytes: bytes, cmap: Dict[int, str]) -> None:
        text = cmap_bytes.decode("latin-1", errors="ignore")
        for block in re.findall(r"beginbfchar([\s\S]*?)endbfchar", text):
            for src_hex, dst_hex in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
                try:
                    code = int(src_hex, 16)
                    val = bytes.fromhex(dst_hex).decode("utf-16-be", errors="ignore")
                    if val:
                        cmap[code] = val
                except Exception:
                    pass

        for block in re.findall(r"beginbfrange([\s\S]*?)endbfrange", text):
            for start_hex, end_hex, dst_hex in re.findall(
                r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block
            ):
                try:
                    start_c = int(start_hex, 16)
                    end_c = int(end_hex, 16)
                    base_u = int(dst_hex, 16)
                    if end_c - start_c <= 512:
                        for offset in range(end_c - start_c + 1):
                            cmap[start_c + offset] = chr(base_u + offset)
                except Exception:
                    pass

    @staticmethod
    def _extract_pdf_bt_et_text(decompressed_stream: bytes, cmap: Dict[int, str]) -> List[str]:
        lines: List[str] = []
        for bt_block in re.findall(rb"BT([\s\S]*?)ET", decompressed_stream):
            tokens: List[str] = []
            for token_match in re.finditer(rb"\(([^()\\]*(?:\\.[^()\\]*)*)\)|<([0-9A-Fa-f]+)>", bt_block):
                lit_bytes = token_match.group(1)
                hex_bytes = token_match.group(2)
                if lit_bytes is not None:
                    piece = lit_bytes.decode("cp1254", errors="ignore")
                    if any(c.isalnum() for c in piece):
                        tokens.append(piece)
                elif hex_bytes is not None and cmap:
                    hex_str = hex_bytes.decode("ascii", errors="ignore")
                    step = 4 if len(hex_str) % 4 == 0 else 2
                    chars = []
                    for i in range(0, len(hex_str), step):
                        code = int(hex_str[i : i + step], 16)
                        if code in cmap:
                            chars.append(cmap[code])
                    decoded_hex = "".join(chars)
                    if decoded_hex.strip():
                        tokens.append(decoded_hex)
            if tokens:
                line = " ".join(tokens).strip()
                if line:
                    lines.append(line)
        return lines
