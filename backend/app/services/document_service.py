"""
ThinkPort AI Gateway - Belge Çözümleme, Metin Çıkarımı ve Token Tahminleme Servisi (document_service.py).
PDF, Word (DOC/DOCX), Excel (XLS/XLSX), PowerPoint (PPTX), RTF ve düz metin belgelerinden
yapılandırılmış metin ve tablo çıkarımını gerçekleştirir.
"""
import base64
import io
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
import zlib
from typing import Dict, List
from app.core.config import settings
from app.core.exceptions import bad_request_error
from app.dtos.document_dto import ParseFileRequestDTO, ParseFileResponseDTO


class DocumentService:
    """
    Belge çözümleme ve token tahminleme servisi.
    Office (DOC/DOCX/XLSX/PPTX), PDF ve düz metin/kod dosyalarından metin ve tablo çıkarımını
    yapılandırılmış olarak gerçekleştirir.
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
        lower_name = (filename or "").lower()
        if lower_name.endswith(".docx"):
            docx_text = self._extract_docx_structured(raw_bytes)
            if docx_text:
                return docx_text[: settings.max_extracted_document_chars]

        if lower_name.endswith((".doc", ".rtf")):
            doc_text = self._extract_doc_or_rtf(raw_bytes, lower_name)
            if doc_text:
                return doc_text[: settings.max_extracted_document_chars]

        if lower_name.endswith((".xlsx", ".xls")):
            xlsx_text = self._extract_xlsx_structured(raw_bytes)
            if xlsx_text:
                return xlsx_text[: settings.max_extracted_document_chars]

        if lower_name.endswith(".pptx"):
            office_text = self._extract_from_office_zip(raw_bytes)
            if office_text:
                return office_text[: settings.max_extracted_document_chars]

        if lower_name.endswith(".pdf") or raw_bytes[:5] == b"%PDF-":
            pdf_text = self._extract_pdf_text(raw_bytes)
            return pdf_text[: settings.max_extracted_document_chars]

        return self._decode_plain_text(raw_bytes)[: settings.max_extracted_document_chars]

    @classmethod
    def _extract_doc_or_rtf(cls, raw_bytes: bytes, lower_name: str) -> str:
        """
        Klasik Word (.doc) veya RTF (.rtf) belgelerinden yapılandırılmış metin çıkarır.
        1) Eğer dosya ZIP/DOCX yapısındaysa doğrudan DOCX çıkarıcıyı çalıştırır.
        2) macOS ortamında `/usr/bin/textutil -convert txt -stdout` kullanır.
        3) Yedek olarak OLE2 / UTF-16LE / CP1254 okunabilir metin bloklarını ayıklar.
        """
        if raw_bytes[:4] == b"PK\x03\x04":
            docx_fallback = cls._extract_docx_structured(raw_bytes)
            if docx_fallback:
                return docx_fallback

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

        # Yedek: UTF-16LE ve CP1254 okunabilir metin bloklarını çıkar
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
    def _extract_docx_structured(cls, raw_bytes: bytes) -> str:
        """Word (.docx) belgesindeki paragrafları ve tabloları Markdown tablo formatında çıkarır."""
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
                if "word/document.xml" not in archive.namelist():
                    return cls._extract_from_office_zip(raw_bytes)
                xml_bytes = archive.read("word/document.xml")
                root = ET.fromstring(xml_bytes)
                ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
                body = root.find(f"{ns}body")
                if body is None:
                    return cls._extract_text_from_xml_bytes(xml_bytes)

                lines: List[str] = []
                for elem in body:
                    if elem.tag == f"{ns}p":
                        p_text = cls._extract_docx_paragraph(elem, ns)
                        if p_text:
                            lines.append(p_text)
                    elif elem.tag == f"{ns}tbl":
                        lines.append("")
                        for tr in elem.findall(f"{ns}tr"):
                            cells: List[str] = []
                            for tc in tr.findall(f"{ns}tc"):
                                cell_paras = [
                                    cls._extract_docx_paragraph(p, ns)
                                    for p in tc.iter(f"{ns}p")
                                ]
                                cell_str = " ".join(cp for cp in cell_paras if cp).strip()
                                cells.append(cell_str)
                            if any(cells):
                                lines.append("| " + " | ".join(cells) + " |")
                        lines.append("")
                return "\n".join(lines).strip()
        except Exception:
            return cls._extract_from_office_zip(raw_bytes)

    @staticmethod
    def _extract_docx_paragraph(p_elem: ET.Element, ns: str) -> str:
        parts: List[str] = []
        for node in p_elem.iter():
            if node.tag == f"{ns}t" and node.text:
                parts.append(node.text)
            elif node.tag == f"{ns}tab":
                parts.append("\t")
            elif node.tag in (f"{ns}br", f"{ns}cr"):
                parts.append(" ")
        return "".join(parts).strip()

    @classmethod
    def _extract_xlsx_structured(cls, raw_bytes: bytes) -> str:
        """Excel (.xlsx) çalışma sayfalarını sharedStrings ile birleştirerek Markdown tablosu olarak çıkarır."""
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
                names = archive.namelist()
                shared_strings: List[str] = []
                if "xl/sharedStrings.xml" in names:
                    ss_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
                    for si in ss_root.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
                        texts = [
                            t.text or ""
                            for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                        ]
                        shared_strings.append("".join(texts).strip())

                sheet_files = sorted(
                    n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")
                )
                if not sheet_files:
                    return cls._extract_from_office_zip(raw_bytes)

                out_lines: List[str] = []
                ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
                for idx, sf in enumerate(sheet_files, 1):
                    out_lines.append(f"--- SAYFA {idx} ---")
                    s_root = ET.fromstring(archive.read(sf))
                    for row in s_root.iter(f"{ns}row"):
                        row_vals: List[str] = []
                        for c in row.findall(f"{ns}c"):
                            c_type = c.attrib.get("t", "")
                            v_elem = c.find(f"{ns}v")
                            is_elem = c.find(f"{ns}is")
                            val = ""
                            if c_type == "s" and v_elem is not None and v_elem.text:
                                try:
                                    s_idx = int(v_elem.text)
                                    if 0 <= s_idx < len(shared_strings):
                                        val = shared_strings[s_idx]
                                except Exception:
                                    val = v_elem.text
                            elif c_type == "inlineStr" and is_elem is not None:
                                val = "".join(t.text or "" for t in is_elem.iter(f"{ns}t")).strip()
                            elif v_elem is not None and v_elem.text:
                                val = v_elem.text.strip()
                            row_vals.append(val)
                        if any(row_vals):
                            out_lines.append("| " + " | ".join(row_vals) + " |")
                    out_lines.append("")
                return "\n".join(out_lines).strip()
        except Exception:
            return cls._extract_from_office_zip(raw_bytes)

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
    def _extract_pdf_text(cls, raw_bytes: bytes) -> str:
        """
        PDF dosyasından Türkçe karakterleri (ToUnicode CMap / CIDFont) ve satır yapısını
        koruyarak metin çıkarır:
        1) Varsa pypdf veya pymupdf (fitz) kütüphanesini kullanır,
        2) macOS ortamında yerleşik Apple PDFKit (Quartz) motorunu kullanır,
        3) Yedek olarak ToUnicode CMap + BT..ET metin operatörü çözümleyicisini çalıştırır.
        Asla ikili (binary) görüntü/font akışlarını latin-1 çöp metin olarak döndürmez.
        """
        # 1. pypdf / fitz kontrolü
        try:
            import pypdf  # type: ignore

            reader = pypdf.PdfReader(io.BytesIO(raw_bytes))
            pages = []
            for idx, page in enumerate(reader.pages, 1):
                txt = (page.extract_text() or "").strip()
                if txt:
                    pages.append(f"--- SAYFA {idx} ---\n{txt}")
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
                    pages.append(f"--- SAYFA {idx} ---\n{txt}")
            if pages:
                return "\n\n".join(pages)
        except Exception:
            pass

        # 2. macOS yerleşik PDFKit (Quartz) motoru ile %100 doğru CMap/Unicode çıkarımı
        if sys.platform == "darwin":
            pdfkit_text = cls._extract_pdf_via_macos_pdfkit(raw_bytes)
            if pdfkit_text and pdfkit_text.strip():
                return pdfkit_text.strip()

        # 3. Saf Python ToUnicode CMap + BT..ET metin çıkarıcı
        return cls._extract_from_pdf_streams(raw_bytes)

    @staticmethod
    def _extract_pdf_via_macos_pdfkit(raw_bytes: bytes) -> str:
        """macOS yerleşik PDFKit çerçevesi üzerinden sayfa bazlı Unicode metin çıkarır."""
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
                "        out.push('--- SAYFA ' + (i + 1) + ' ---\\n' + s.trim());"
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
        """
        Saf Python PDF metin çıkarıcı:
        - Yalnızca başarıyla zlib ile açılan ve içinde BT ... ET metin blokları barındıran akışları işler.
        - Görüntü (/Subtype /Image, /DCTDecode), Font (/FontFile) ve XRef akışlarını kesin olarak atlar.
        - Varsa ToUnicode CMap tablolarını çözerek hex (<...>) ve literal ((...)) dizgeleri Unicode'a çevirir.
        """
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
                    # Sıkıştırılmış ikili akış açılamadıysa ASLA ham ikili veriyi metin olarak işleme!
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
        """PDF ToUnicode CMap akışındaki beginbfchar ve beginbfrange eşlemelerini çözer."""
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
        """BT ... ET blokları içindeki Tj / TJ operatörlerinden okunabilir metin satırlarını çıkarır."""
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

    @staticmethod
    def _decode_plain_text(raw_bytes: bytes) -> str:
        """Yaygın karakter kodlamalarını sırasıyla deneyerek düz metne çözer."""
        for encoding in ("utf-8", "utf-8-sig", "cp1254", "latin-1"):
            try:
                return raw_bytes.decode(encoding)
            except Exception:
                continue
        return raw_bytes.decode("utf-8", errors="replace")
