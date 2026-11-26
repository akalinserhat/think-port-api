"""
ThinkPort AI Gateway - OpenAI ChatGPT (Sanal Tarayıcı) Model Tanımı (chatgpt_web_model.py).
IWebBrowserModel (BaseWebBrowserModel) arayüzünü uygulayan bağımsız ChatGPT Web modeli.
Hedef Web URL: https://chatgpt.com/
"""
import re
from typing import Any, Dict, List, Optional
from app.models.base_model import ModelCapabilities
from app.models.web_browser_model import BaseWebBrowserModel


class ChatGptWebModel(BaseWebBrowserModel):
    """OpenAI ChatGPT Sanal Tarayıcı modeli (https://chatgpt.com/)."""

    _LEADING_UI_PATTERNS: List[str] = [
        r"^Log\s*in",
        r"^Sign\s*up\s*for\s*free",
        r"^Sign\s*up",
        r"^Sign\s*in",
        r"^Temporary\s*Chat",
        r"^Get\s*Plus",
        r"^Upgrade\s*plan",
        r"^New\s*chat",
        r"^ChatGPT\s*said:?",
        r"^You\s*said:?",
        r"^ChatGPT\b",
        r"^Skip\s*to\s*content",
    ]

    _TRAILING_UI_MARKERS: List[str] = [
        "ChatGPT is AI and can make mistakes",
        "ChatGPT can make mistakes",
        "ChatGPT hata yapabilir",
        "By messaging ChatGPT",
        "Ask ChatGPT",
        "Ask anything",
        "Cookie Preferences",
        "AttachSearchReason",
        "See plans and pricing",
        "Copy response",
        "Add files and more",
        "Get responses tailored to you",
        "Clear current chat?",
        "New chatImagesShopping",
    ]

    @property
    def id(self) -> str:
        return "chatgpt-web"

    @property
    def name(self) -> str:
        return "ChatGPT Web (Sanal Tarayıcı)"

    @property
    def vendor(self) -> str:
        return "OpenAI"

    @property
    def provider(self) -> str:
        return "chatgpt-web"

    @property
    def protocol_id(self) -> str:
        return "proto_openai"

    @property
    def description(self) -> str:
        return "OpenAI ChatGPT web arayüzü (https://chatgpt.com/) üzerinden Docker Playwright ile erişilen LLM."

    @property
    def source_file(self) -> str:
        return "src/models/definitions/ChatGptWebModel.ts"

    @property
    def target_url(self) -> str:
        return "https://chatgpt.com/"

    @property
    def session_prefix(self) -> str:
        return "chatgpt-session"

    @property
    def auth_notice_domain(self) -> str:
        return "chatgpt.com"

    @property
    def response_prefix_to_strip(self) -> Optional[str]:
        return "chatgpt said"

    @property
    def context_window(self) -> int:
        return 128000

    @property
    def max_output_tokens(self) -> int:
        return 16384

    @property
    def web_model(self) -> Optional[str]:
        return "chatgpt-web"

    @property
    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            vision=True,
            supports_image_attachments=True,
            supports_file_attachments=False,
        )

    @property
    def aliases(self) -> List[str]:
        return [
            "chatgpt-web",
            "chatgpt-web-ai",
            "openai-chatgpt-web",
            "chatgpt-app",
            "chatgpt-browser",
        ]

    @classmethod
    def _strip_chatgpt_chrome(cls, text: str, page_title: str = "") -> str:
        """ChatGPT web sayfasının üst/alt arayüz kalıntılarını ve tekrarlanan kullanıcı istemini temizler."""
        cleaned = text.strip()

        # 1. Üst menü / oturum arayüz kalıntılarını baştan tekrarlı olarak temizle
        changed = True
        while changed and cleaned:
            changed = False
            for pat in cls._LEADING_UI_PATTERNS:
                m = re.match(pat, cleaned, flags=re.IGNORECASE)
                if m:
                    cleaned = cleaned[m.end():].lstrip(" \t\r\n:-•|")
                    changed = True

        # 2. Sayfa başında kullanıcının kendi sorusunun cevaba bitişik tekrarını temizle
        # (Örn: "Ewingella americana baktersi hakkında bilgi verir misinEwingella americana...")
        title_clean = (page_title or "").strip()
        if title_clean and title_clean.lower() not in ("chatgpt", "new chat"):
            # Sayfa başlığının ilk anlamlı kelimeleriyle başlayan ve küçük harf -> büyük harf sınırında biten istemi ayır
            title_words = [w for w in re.split(r"\s+", title_clean) if len(w) >= 3]
            if title_words and cleaned.lower().startswith(title_words[0].lower()):
                glue_match = re.search(
                    r"(?:misin|mısın|musun|müsün|ederim|lütfen|tanıt|anlat|açıkla|yaz|ver|söyle|\?)(?=[A-ZÇĞİÖŞÜ👋🤖])",
                    cleaned[:220],
                )
                if glue_match:
                    cleaned = cleaned[glue_match.end():].lstrip()
        else:
            # Başlık "ChatGPT" olsa bile ilk 160 karakterde bitişik soru kalıbı varsa temizle
            glue_match = re.search(
                r"^.{8,160}?(?:misin|mısın|musun|müsün|tanıt|anlat|açıkla)\??(?=[A-ZÇĞİÖŞÜ👋🤖])",
                cleaned,
            )
            if glue_match:
                cleaned = cleaned[glue_match.end():].lstrip()

        # 3. "Worked for 19s" benzeri düşünme süresi rozetlerini temizle
        cleaned = re.sub(r"\s*(?:[-•]\s*)?Worked\s+for\s+\d+\s*[smh]\b", "", cleaned, flags=re.IGNORECASE)

        # 4. Alt bar / yasal uyarı / yan menü kalıntılarını sondan kes
        for marker in cls._TRAILING_UI_MARKERS:
            pos = cleaned.find(marker)
            if pos != -1 and pos > 20:
                cleaned = cleaned[:pos].rstrip()

        return cleaned.strip()

    @staticmethod
    def _format_as_readable_markdown(text: str) -> str:
        """
        ChatGPT DOM çıktısını okunabilir Markdown'a dönüştürür.
        Eğer çıktı DOM->Markdown motorundan zaten yapısal (tablo, başlık, liste, kod bloğu)
        olarak geldiyse yapıyı bozmadan korur; yalnızca eski düz/yapışık metinlerde biçimlendirme uygular.
        """
        if not text:
            return text

        out = text.replace("\r\n", "\n").strip()

        # Zaten gerçek Markdown tablosu, kod bloğu veya çok satırlı başlık/liste yapısı varsa bozma
        has_structured_md = (
            "```" in out
            or bool(re.search(r"\n\|\s*[-:]+", out))
            or (out.count("\n") >= 4 and bool(re.search(r"(^|\n)(#{1,4}\s+|[-*]\s+|\d+\.\s+)", out)))
        )
        if has_structured_md:
            out = re.sub(r"[ \t]{2,}", " ", out)
            out = re.sub(r"\n{3,}", "\n\n", out)
            return out.strip()

        # Eski düz/yapışık DOM metni fallback biçimlendirmesi (camelCase özel isimleri bölmeden!)
        out = re.sub(r"([^\n\s])(\d{1,2}\.\s+[A-ZÇĞİÖŞÜ])", r"\1\n\2", out)
        out = re.sub(r"\?(?=[A-ZÇĞİÖŞÜ])", "?\n\n", out)
        out = re.sub(r":(?=[A-ZÇĞİÖŞÜ][^\n.:!?]{2,60}:)", ":\n\n- **", out)
        out = re.sub(r"(^|\n)- \*\*([^\n:*]{2,60}):", r"\1- **\2:**", out)
        out = re.sub(r"(?<=[.!])(?=[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,})", "\n\n", out)
        out = re.sub(r"(?<=[.:!?a-zçğıöşü])([\U0001F300-\U0001FAFF\u2600-\u27BF])", r"\n\n\1", out)

        lines = out.split("\n")
        if lines and lines[0].strip().endswith("?") and len(lines[0].strip()) <= 120 and not lines[0].startswith("#"):
            lines[0] = f"### {lines[0].strip()}"
        out = "\n".join(lines)

        out = re.sub(r"[ \t]{2,}", " ", out)
        out = re.sub(r"\n{3,}", "\n\n", out)
        return out.strip()

    def format_browser_response(
        self,
        raw_text: str,
        metadata: Dict[str, Any],
    ) -> Optional[str]:
        """
        ChatGPT Web çıktısında yalnızca 'SAYFA METNİ' bölümünü alır;
        ChatGPT arayüz kalıntılarını (Log in, Sign up, tekrarlanan istem, alt uyarılar)
        temizleyip okunabilir Markdown biçiminde sunar.
        """
        text = (raw_text or "").strip()
        marker = "SAYFA METNİ:"
        idx = text.find(marker)
        if idx != -1:
            text = text[idx + len(marker):].strip()

        if not text:
            return None

        page_title = str(metadata.get("title") or "")
        cleaned = self._strip_chatgpt_chrome(text, page_title=page_title)
        if not cleaned:
            return None

        if metadata.get("raw_mode"):
            return cleaned

        return self._format_as_readable_markdown(cleaned)
