"""
ThinkPort AI Gateway - Mesaj Biçimlendirme ve Ekli Belge Çözümleme Servisi (MessageFormatterService).
Gelen OpenAI uyumlu sohbet mesajlarını, ekli dosya parçalarını (`file`, `document`, `input_file`, `image_url`),
JSON şema doğrulama kurallarını ve Stüdyo görünümü izleme (trace) raporlarını hazırlar.
"""
from __future__ import annotations
import json
import re
from typing import Any, Dict, List, Optional, Tuple
from app.dtos.chat_dto import ChatMessageDTO, PreparedMessagesDTO
from app.dtos.conversation_dto import ExtractedAttachmentInputDTO
from app.services.document_service import DocumentService

SYSTEM_INSTRUCTION_HEADER = "[SYSTEM INSTRUCTIONS - MUST FOLLOW STRICTLY]:"

JSON_MODE_ENFORCEMENT_SUFFIX = (
    "\n\n[CRITICAL OUTPUT FORMAT REQUIREMENT - VALID JSON OBJECT ONLY]:\n"
    "You MUST respond ONLY with a single valid JSON object (RFC 8259 compliant).\n"
    "1. Do NOT output any Markdown tables, headings (#), bullet points, greetings, or explanations before or after the JSON.\n"
    "2. Do NOT wrap the output in ```json or ``` code fences; output raw JSON starting with '{' and ending with '}'.\n"
    "3. NEVER refuse or claim the input/document is too large or complex; process all sections and return the complete JSON object."
)


class MessageFormatterService:
    """
    Sohbet mesajlarını:
    1) Görsel destekli (Multimodal OpenAI content array) formatına,
    2) Yalnızca metin destekleyen modeller için düz metin (fallback) formatına,
    3) Sistem yönergelerini (`role: "system"`) ve JSON zorunluluğunu (`response_format`)
       alt modellere/web otomasyonuna kayıpsız aktaracak zenginleştirilmiş formata,
    4) Veritabanı kaydı için temiz kullanıcı istemi ve ekli dosya meta verilerine
    dönüştüren tek sorumluluklu servis.
    """

    def prepare_messages(
        self,
        messages: List[ChatMessageDTO],
        response_format: Optional[Dict[str, Any]] = None,
        merge_system_into_user: bool = True,
    ) -> PreparedMessagesDTO:
        """
        Mesaj listesini hem multimodal hem de yalnızca metin formatına hazırlar.
        Web otomasyonu ve alt modellerin `system` mesajlarını veya `response_format` JSON
        zorunluluğunu yoksaymasını önlemek için sistem talimatlarını kullanıcı mesajının
        en üstüne, JSON format kuralını ise en altına ekler.
        """
        multimodal_msgs: List[Dict[str, Any]] = []
        text_only_msgs: List[Dict[str, str]] = []

        system_instructions = self.extract_system_instructions(messages)
        is_json_mode = self.is_json_mode_requested(response_format)

        for msg in messages:
            mm_entry, txt_entry = self._format_single_message(msg)
            multimodal_msgs.append(mm_entry)
            text_only_msgs.append(txt_entry)

        if merge_system_into_user and system_instructions:
            self._inject_system_into_user_messages(multimodal_msgs, text_only_msgs, system_instructions)

        if is_json_mode:
            json_suffix = self.build_json_enforcement_suffix(response_format)
            self._append_suffix_to_last_user_message(multimodal_msgs, text_only_msgs, json_suffix)

        has_multimodal = multimodal_msgs != text_only_msgs
        return PreparedMessagesDTO(
            multimodal_messages=multimodal_msgs,
            text_only_messages=text_only_msgs,
            has_multimodal=has_multimodal,
            is_json_mode=is_json_mode,
            system_instructions=system_instructions,
        )

    @classmethod
    def extract_system_instructions(cls, messages: List[ChatMessageDTO]) -> str:
        """Tüm `system` ve `developer` rolündeki mesajları sırasıyla birleştirerek döner."""
        parts: List[str] = []
        for msg in messages:
            if msg.role not in ("system", "developer"):
                continue
            if isinstance(msg.content, str):
                cleaned = msg.content.strip()
                if cleaned:
                    parts.append(cleaned)
            elif isinstance(msg.content, list):
                segments, _ = cls._extract_segments_from_parts(msg.content)
                joined = "\n\n".join(s.strip() for s in segments if s.strip()).strip()
                if joined:
                    parts.append(joined)
        return "\n\n".join(parts).strip()

    @staticmethod
    def is_json_mode_requested(response_format: Optional[Dict[str, Any]]) -> bool:
        """İstekte `response_format` üzerinden JSON çıktısı (`json_object` veya `json_schema`) istenip istenmediğini döner."""
        if not response_format or not isinstance(response_format, dict):
            return False
        fmt_type = str(response_format.get("type", "")).strip().lower()
        return fmt_type in ("json_object", "json_schema", "json")

    @classmethod
    def build_json_enforcement_suffix(cls, response_format: Optional[Dict[str, Any]]) -> str:
        """`response_format` için prompt sonuna eklenecek kesin JSON şema ve format talimatını üretir."""
        if not response_format or not isinstance(response_format, dict):
            return JSON_MODE_ENFORCEMENT_SUFFIX

        schema_obj: Optional[Dict[str, Any]] = None
        json_schema_field = response_format.get("json_schema")
        if isinstance(json_schema_field, dict):
            schema_obj = json_schema_field.get("schema") or json_schema_field
        elif isinstance(response_format.get("schema"), dict):
            schema_obj = response_format.get("schema")

        if schema_obj:
            schema_str = json.dumps(schema_obj, ensure_ascii=False, indent=2)
            return (
                f"{JSON_MODE_ENFORCEMENT_SUFFIX}\n"
                f"Required JSON Schema:\n{schema_str}"
            )
        return JSON_MODE_ENFORCEMENT_SUFFIX

    @classmethod
    def ensure_web_messages_have_system_and_json_directives(
        cls,
        openai_messages: List[Dict[str, Any]],
        response_format: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Ham OpenAI mesaj sözlükleri doğrudan Web Gateway'e gönderildiğinde
        tüm `system` mesajlarının kullanıcı mesajının en üstüne `[SYSTEM INSTRUCTIONS - MUST FOLLOW STRICTLY]: ...`
        başlığıyla eklendiğinden ve `json_object` modunda JSON zorunluluğunun en sonda yer aldığından emin olur.
        """
        copied: List[Dict[str, Any]] = [dict(m) for m in openai_messages]
        sys_chunks: List[str] = []
        for m in copied:
            if m.get("role") in ("system", "developer"):
                content = m.get("content", "")
                if isinstance(content, str) and content.strip():
                    sys_chunks.append(content.strip())

        combined_sys = "\n\n".join(sys_chunks).strip()
        is_json = cls.is_json_mode_requested(response_format)
        json_suffix = cls.build_json_enforcement_suffix(response_format) if is_json else ""

        # İlk kullanıcı mesajına sistem yönergesini, son kullanıcı mesajına ise JSON zorunluluğunu ekle
        first_user_idx: Optional[int] = None
        last_user_idx: Optional[int] = None
        for idx, msg_item in enumerate(copied):
            if msg_item.get("role") == "user":
                if first_user_idx is None:
                    first_user_idx = idx
                last_user_idx = idx

        if first_user_idx is None or last_user_idx is None:
            return copied

        if combined_sys:
            first_msg = copied[first_user_idx]
            f_content = first_msg.get("content", "")
            if isinstance(f_content, str):
                if SYSTEM_INSTRUCTION_HEADER not in f_content and combined_sys[:80] not in f_content:
                    first_msg["content"] = f"{SYSTEM_INSTRUCTION_HEADER}\n{combined_sys}\n\n{f_content}"
            elif isinstance(f_content, list):
                new_parts = [dict(p) for p in f_content]
                text_indices = [i for i, p in enumerate(new_parts) if p.get("type") == "text"]
                if text_indices:
                    first_ti = text_indices[0]
                    first_txt = str(new_parts[first_ti].get("text", ""))
                    if SYSTEM_INSTRUCTION_HEADER not in first_txt and combined_sys[:80] not in first_txt:
                        new_parts[first_ti]["text"] = f"{SYSTEM_INSTRUCTION_HEADER}\n{combined_sys}\n\n{first_txt}"
                first_msg["content"] = new_parts

        if json_suffix:
            last_msg = copied[last_user_idx]
            l_content = last_msg.get("content", "")
            if isinstance(l_content, str):
                if "[CRITICAL OUTPUT FORMAT REQUIREMENT" not in l_content:
                    last_msg["content"] = f"{l_content}{json_suffix}"
            elif isinstance(l_content, list):
                new_parts = [dict(p) for p in l_content]
                text_indices = [i for i, p in enumerate(new_parts) if p.get("type") == "text"]
                if text_indices:
                    last_ti = text_indices[-1]
                    last_txt = str(new_parts[last_ti].get("text", ""))
                    if "[CRITICAL OUTPUT FORMAT REQUIREMENT" not in last_txt:
                        new_parts[last_ti]["text"] = f"{last_txt}{json_suffix}"
                last_msg["content"] = new_parts

        # Sistem yönergesi kullanıcı mesajına eklendiği için mükerrer (2x token) gönderimi önlemek adına ayrı system mesajlarını çıkar
        if combined_sys:
            copied = [m for m in copied if m.get("role") not in ("system", "developer")]

        return copied

    @classmethod
    def extract_thinking_and_clean_content(cls, raw_text: str) -> Tuple[str, str]:
        """
        Model yanıtı içindeki <think>...</think> veya <thinking>...</thinking> bloklarını
        ayıklar; (düşünce_metni, temizlenmiş_yanıt_metni) ikilisini döner.
        """
        if not raw_text:
            return "", ""
        pattern = re.compile(r"<think(?:ing)?[^>]*>([\s\S]*?)</think(?:ing)?>", flags=re.IGNORECASE)
        matches = pattern.findall(raw_text)
        thinking_parts = [m.strip() for m in matches if m and m.strip()]
        thinking_text = "\n\n".join(thinking_parts)
        cleaned = pattern.sub("", raw_text).strip()
        if not cleaned and raw_text.strip():
            # Henüz kapanmamış <think>... bloğu varsa onu da yakala
            unclosed = re.search(r"<think(?:ing)?[^>]*>([\s\S]*)$", raw_text, flags=re.IGNORECASE)
            if unclosed:
                t_unclosed = unclosed.group(1).strip()
                if t_unclosed and t_unclosed not in thinking_parts:
                    thinking_text = (f"{thinking_text}\n\n{t_unclosed}" if thinking_text else t_unclosed).strip()
                before = raw_text[: unclosed.start()].strip()
                return thinking_text, before
        return thinking_text, cleaned

    @classmethod
    def extract_and_normalize_json_content(cls, raw_text: str) -> str:
        """
        Model yanıtı içindeki ```json ... ``` kod bloklarını veya metin arasına gömülü
        `{ ... }` / `[ ... ]` JSON yapılarını ayıklayıp (extract & parse) saf, geçerli
        JSON string olarak döner.
        """
        if not raw_text or not raw_text.strip():
            return raw_text

        # 1. Varsa <think>...</think> düşünce bloklarını temizle
        cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_text, flags=re.IGNORECASE).strip()
        if not cleaned:
            cleaned = raw_text.strip()

        # 2. Doğrudan geçerli JSON mu kontrol et
        direct = cls._try_parse_json_candidate(cleaned)
        if direct is not None:
            return direct

        # 3. Markdown ```json ... ``` veya ``` ... ``` kod bloklarını ayıkla
        fence_matches = re.findall(r"```(?:json|JSON)?\s*([\s\S]*?)```", cleaned)
        valid_fenced: List[str] = []
        for block in fence_matches:
            parsed_str = cls._try_parse_json_candidate(block.strip())
            if parsed_str is not None:
                valid_fenced.append(parsed_str)
        if valid_fenced:
            # Birden fazla kod bloğu varsa en kapsamlı olanı seç
            return max(valid_fenced, key=len)

        # 4. Metin arasına gömülü { ... } veya [ ... ] yapılarını (trailing comma onarımıyla) JSONDecoder.raw_decode ile tara
        scan_target = re.sub(r",\s*([}\]])", r"\1", cleaned)
        decoder = json.JSONDecoder()
        embedded_objects: List[str] = []
        embedded_arrays: List[str] = []

        for idx, ch in enumerate(scan_target):
            if ch not in ("{", "["):
                continue
            try:
                obj, _ = decoder.raw_decode(scan_target, idx)
                if isinstance(obj, dict):
                    embedded_objects.append(json.dumps(obj, ensure_ascii=False))
                elif isinstance(obj, list):
                    embedded_arrays.append(json.dumps(obj, ensure_ascii=False))
            except Exception:
                continue

        if embedded_objects:
            return max(embedded_objects, key=len)
        if embedded_arrays:
            return max(embedded_arrays, key=len)

        # 5. Sondaki fazladan virgül (trailing comma) vb. bozulmaları onararak en dış { ... } veya [ ... ] bloğunu dene
        first_brace = cleaned.find("{")
        last_brace = cleaned.rfind("}")
        if first_brace != -1 and last_brace > first_brace:
            candidate = cleaned[first_brace : last_brace + 1]
            repaired = cls._try_parse_json_candidate(candidate)
            if repaired is not None:
                return repaired

        first_bracket = cleaned.find("[")
        last_bracket = cleaned.rfind("]")
        if first_bracket != -1 and last_bracket > first_bracket:
            candidate = cleaned[first_bracket : last_bracket + 1]
            repaired = cls._try_parse_json_candidate(candidate)
            if repaired is not None:
                return repaired

        return cleaned

    @staticmethod
    def _try_parse_json_candidate(candidate: str) -> Optional[str]:
        """Verilen aday dizgeyi JSON olarak ayrıştırmayı (gerekirse trailing comma onarımıyla) dener."""
        if not candidate:
            return None
        for attempt in (candidate, re.sub(r",\s*([}\]])", r"\1", candidate)):
            try:
                parsed = json.loads(attempt)
                if isinstance(parsed, (dict, list)):
                    return json.dumps(parsed, ensure_ascii=False)
            except Exception:
                continue
        return None

    @staticmethod
    def _inject_system_into_user_messages(
        multimodal_msgs: List[Dict[str, Any]],
        text_only_msgs: List[Dict[str, str]],
        system_instructions: str,
    ) -> None:
        """Sistem talimatlarını ilk kullanıcı mesajının en üstüne `[SYSTEM INSTRUCTIONS - MUST FOLLOW STRICTLY]:` başlığıyla ekler."""
        prefix_block = f"{SYSTEM_INSTRUCTION_HEADER}\n{system_instructions}\n\n"
        for idx in range(len(text_only_msgs)):
            if text_only_msgs[idx].get("role") == "user":
                current_txt = text_only_msgs[idx].get("content", "")
                if SYSTEM_INSTRUCTION_HEADER not in current_txt and system_instructions[:80] not in current_txt:
                    text_only_msgs[idx]["content"] = f"{prefix_block}{current_txt}"

                mm_content = multimodal_msgs[idx].get("content")
                if isinstance(mm_content, str):
                    if SYSTEM_INSTRUCTION_HEADER not in mm_content and system_instructions[:80] not in mm_content:
                        multimodal_msgs[idx]["content"] = f"{prefix_block}{mm_content}"
                elif isinstance(mm_content, list):
                    for part in mm_content:
                        if part.get("type") == "text":
                            ptxt = str(part.get("text", ""))
                            if SYSTEM_INSTRUCTION_HEADER not in ptxt and system_instructions[:80] not in ptxt:
                                part["text"] = f"{prefix_block}{ptxt}"
                            break
                break

    @staticmethod
    def _append_suffix_to_last_user_message(
        multimodal_msgs: List[Dict[str, Any]],
        text_only_msgs: List[Dict[str, str]],
        suffix: str,
    ) -> None:
        """Verilen zorunlu talimat sonekini son kullanıcı mesajının en sonuna ekler."""
        for idx in range(len(text_only_msgs) - 1, -1, -1):
            if text_only_msgs[idx].get("role") == "user":
                current_txt = text_only_msgs[idx].get("content", "")
                if "[CRITICAL OUTPUT FORMAT REQUIREMENT" not in current_txt:
                    text_only_msgs[idx]["content"] = f"{current_txt}{suffix}"

                mm_content = multimodal_msgs[idx].get("content")
                if isinstance(mm_content, str):
                    if "[CRITICAL OUTPUT FORMAT REQUIREMENT" not in mm_content:
                        multimodal_msgs[idx]["content"] = f"{mm_content}{suffix}"
                elif isinstance(mm_content, list):
                    for part in reversed(mm_content):
                        if part.get("type") == "text":
                            ptxt = str(part.get("text", ""))
                            if "[CRITICAL OUTPUT FORMAT REQUIREMENT" not in ptxt:
                                part["text"] = f"{ptxt}{suffix}"
                            break
                break

    @classmethod
    def strip_ui_trace_blocks(cls, text: str) -> str:
        """
        Sohbet Stüdyosu ekranında mesaj balonlarına eklenen teknik iletişim/düşünce izleme
        bloklarını (📤 [LLM'E GİDEN...], > 🧠 **LLM Düşünce..., 📥 **Gelen LLM İletişim Raporu:**)
        temizleyerek alt LLM sağlayıcısına yalnızca saf konuşma metninin gitmesini sağlar.
        """
        if not text or not isinstance(text, str):
            return text or ""
        cleaned = text
        # Giden iletişim raporu bloğunu ayıkla
        if "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" in cleaned:
            cleaned = cleaned.split("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", 1)[0].rstrip()
        # Gelen düşünce üst bloğunu ayıkla
        cleaned = re.sub(
            r"^> 🧠 \*\*LLM Düşünce[^\n]*\n(?:```text\n[\s\S]*?\n```|> [^\n]*)\n\n",
            "",
            cleaned,
        )
        # Gelen iletişim alt raporunu ayıkla
        if "\n\n---\n📥 **Gelen LLM İletişim Raporu:**" in cleaned:
            cleaned = cleaned.split("\n\n---\n📥 **Gelen LLM İletişim Raporu:**", 1)[0].rstrip()
        if "\n\n📥 **Gelen LLM İletişim Raporu:**" in cleaned:
            cleaned = cleaned.split("\n\n📥 **Gelen LLM İletişim Raporu:**", 1)[0].rstrip()
        if "\n\n---\n📡 **Canlı LLM Akışı" in cleaned:
            cleaned = cleaned.split("\n\n---\n📡 **Canlı LLM Akışı", 1)[0].rstrip()
        if "\n\n---\n📐 **Gönderilen Yanıt JSON Şeması" in cleaned:
            cleaned = cleaned.split("\n\n---\n📐 **Gönderilen Yanıt JSON Şeması", 1)[0].rstrip()
        if "\n\n---\n🛠️ **LLM'e Gönderilen MCP Araç & JSON Şemaları" in cleaned:
            cleaned = cleaned.split("\n\n---\n🛠️ **LLM'e Gönderilen MCP Araç & JSON Şemaları", 1)[0].rstrip()
        if "\n\n---\n📄 **LLM'e Aktarılan Ekli Belge İçeriği" in cleaned:
            cleaned = cleaned.split("\n\n---\n📄 **LLM'e Aktarılan Ekli Belge İçeriği", 1)[0].rstrip()
        if "\n\n📄 **LLM'e Aktarılan Ekli Belge İçeriği" in cleaned:
            cleaned = cleaned.split("\n\n📄 **LLM'e Aktarılan Ekli Belge İçeriği", 1)[0].rstrip()
        return cleaned

    @classmethod
    def _describe_json_shape(cls, parsed: Any) -> str:
        if isinstance(parsed, list):
            return f"{len(parsed)} öğeli JSON Dizisi"
        if isinstance(parsed, dict):
            keys = list(parsed.keys())
            preview = ", ".join(keys[:3])
            suffix = ", …" if len(keys) > 3 else ""
            return f"{len(keys)} alanlı JSON Nesnesi ({preview}{suffix})" if keys else "Boş JSON Nesnesi"
        return "JSON Verisi"

    @classmethod
    def format_outgoing_json_content(cls, raw_text: str, role: str = "user") -> str:
        """
        Bizim gönderdiğimiz (user / tool / system) mesajların içindeki JSON yapılarını
        ([Sorgu Verisi (JSON)]: {...}, [İşlem / Aksiyon Detayı]: {...}, gömülü veya saf JSON)
        tespit ederek özel başlık ve pretty-printed ```json kod bloğuyla formatlar.
        """
        if not raw_text:
            return "🔧 **[GÖNDERİLEN MCP ARAÇ YANITI]**" if role == "tool" else ""

        working = raw_text
        tool_prefix = ""
        if role == "tool":
            m_hdr = re.match(r"^\[([^|\]]+?)(?:\s*\|\s*call_id=([^\]]+))?\]:\s*", working)
            if m_hdr:
                t_name = m_hdr.group(1).strip()
                c_id = (m_hdr.group(2) or "").strip()
                cid_str = f" · `{c_id}`" if c_id else ""
                tool_prefix = f"🔧 **Gönderilen MCP Araç Yanıtı (`{t_name}`{cid_str}):**\n\n"
                working = working[m_hdr.end():]
            elif not working.startswith("🔧"):
                tool_prefix = "🔧 **Gönderilen MCP Araç Yanıtı (Tool Execution Result):**\n\n"

        decoder = json.JSONDecoder()
        result_parts: List[str] = []
        cursor = 0
        n = len(working)

        while cursor < n:
            next_idx = -1
            for i in range(cursor, n):
                if working[i] in ("{", "["):
                    next_idx = i
                    break
            if next_idx == -1:
                tail_txt = working[cursor:].strip()
                if tail_txt:
                    result_parts.append(tail_txt)
                break

            try:
                parsed_obj, end_offset = decoder.raw_decode(working, next_idx)
            except Exception:
                result_parts.append(working[cursor : next_idx + 1])
                cursor = next_idx + 1
                continue

            before_slice = working[cursor:next_idx]
            label_match = re.search(r"(?:^|\n)\s*\[([^\][\n]{2,80})\]\s*:\s*$", before_slice)
            is_valid_struct = isinstance(parsed_obj, (dict, list)) and (
                bool(parsed_obj) or label_match is not None
            )
            if not is_valid_struct:
                result_parts.append(working[cursor : next_idx + 1])
                cursor = next_idx + 1
                continue

            raw_candidate = working[next_idx:end_offset]
            byte_len = len(raw_candidate.encode("utf-8"))
            shape_desc = cls._describe_json_shape(parsed_obj)
            pretty_json = json.dumps(parsed_obj, ensure_ascii=False, indent=2)

            if label_match:
                clean_before = before_slice[: label_match.start()].strip()
                if clean_before:
                    result_parts.append(clean_before)
                label_title = label_match.group(1).strip()
                result_parts.append(
                    f"📦 **Gönderilen JSON Verisi ({label_title} — {shape_desc} · {byte_len} bayt):**\n```json\n{pretty_json}\n```"
                )
            else:
                clean_before = before_slice.strip()
                if clean_before:
                    result_parts.append(clean_before)
                result_parts.append(
                    f"📦 **Gönderilen JSON Verisi ({shape_desc} · {byte_len} bayt):**\n```json\n{pretty_json}\n```"
                )

            cursor = end_offset

        body = "\n\n".join(p for p in result_parts if p).strip()
        return f"{tool_prefix}{body}".strip()

    @classmethod
    def expand_tool_calls_for_display(cls, tool_calls: List[Any]) -> List[Any]:
        """
        Görüntüleme amacıyla tool_calls dizisindeki stringified JSON `function.arguments`
        alanlarını gerçek JSON nesnelerine (dict/list) dönüştürür; böylece `\\u011f` gibi
        kaçış dizileri çözülür ve çok satırlı (pretty-printed) olarak okunabilir hale gelir.
        """
        expanded: List[Any] = []
        for tc in tool_calls or []:
            if not isinstance(tc, dict):
                expanded.append(tc)
                continue
            tc_copy = dict(tc)
            fn = tc_copy.get("function")
            if isinstance(fn, dict):
                fn_copy = dict(fn)
                raw_args = fn_copy.get("arguments")
                if isinstance(raw_args, str) and raw_args.strip():
                    try:
                        fn_copy["arguments"] = json.loads(raw_args)
                    except Exception:
                        repaired_args = re.sub(
                            r'("[^"\\]*(?:\\.[^"\\]*)*")\s*\]\s*(?=,\s*"[^"]+"\s*:)',
                            r"\1",
                            raw_args,
                        )
                        repaired_args = re.sub(
                            r'\}\s*\]\s*,\s*(?="[a-zA-Z_][a-zA-Z0-9_]*"\s*:)',
                            "}]},{",
                            repaired_args,
                        )
                        try:
                            fn_copy["arguments"] = json.loads(repaired_args)
                        except Exception:
                            pass
                tc_copy["function"] = fn_copy
            expanded.append(tc_copy)
        return expanded

    @classmethod
    def format_message_record_for_studio_display(
        cls,
        msg: Dict[str, Any],
        conversation_system_prompt: str = "",
    ) -> str:
        """
        SQLite chat_messages kaydını AI Sohbet Stüdyosu'nda her türlü giden/gelen iletişimi,
        karakter/bayt bilgisini, sistem yönergesini, araç şemalarını ve LLM'in içsel düşünce
        sürecini (thinking_content) eksiksiz gösterecek zengin Markdown metnine dönüştürür.
        """
        raw_content = str(msg.get("content") or "")
        role = str(msg.get("role") or "user")
        model_id = str(msg.get("model_id") or "")
        provider = str(msg.get("provider") or "gateway")
        request_id = str(msg.get("request_id") or "—")
        prompt_tokens = int(msg.get("prompt_tokens") or 0)
        completion_tokens = int(msg.get("completion_tokens") or 0)
        total_tokens = int(msg.get("total_tokens") or (prompt_tokens + completion_tokens))
        latency_ms = int(msg.get("latency_ms") or 0)
        ttft_ms = int(msg.get("ttft_ms") or 0)
        status = str(msg.get("status") or "success")
        error_detail = str(msg.get("error_detail") or "")
        thinking_col = str(msg.get("thinking_content") or "")
        tool_calls_col = str(msg.get("tool_calls_json") or "")
        raw_payload_col = str(msg.get("raw_payload_json") or "")

        raw_payload: Dict[str, Any] = {}
        if raw_payload_col.strip():
            try:
                parsed_p = json.loads(raw_payload_col)
                if isinstance(parsed_p, dict):
                    raw_payload = parsed_p
            except Exception:
                raw_payload = {}

        base_clean = cls.strip_ui_trace_blocks(raw_content)

        if role != "assistant":
            return cls.format_outgoing_json_content(base_clean, role)

        # Assistant mesajı formatlama
        if "📥 **Gelen LLM İletişim Raporu:**" in raw_content:
            return raw_content

        tag_thoughts, cleaned_from_tags = cls.extract_thinking_and_clean_content(base_clean)
        clean_answer = cleaned_from_tags if tag_thoughts else base_clean

        parsed_tcs: List[Any] = []
        if tool_calls_col.strip():
            try:
                tc_parsed = json.loads(tool_calls_col)
                if isinstance(tc_parsed, list):
                    parsed_tcs = tc_parsed
            except Exception:
                pass
        if not parsed_tcs and isinstance(raw_payload.get("tool_calls"), list):
            parsed_tcs = raw_payload["tool_calls"]

        expanded_tcs = cls.expand_tool_calls_for_display(parsed_tcs) if parsed_tcs else []
        if expanded_tcs and clean_answer.lstrip().startswith("[Araç Çağrısı:"):
            call_names = ", ".join(
                tc.get("function", {}).get("name", "tool")
                for tc in expanded_tcs
                if isinstance(tc, dict)
            )
            pretty_tcs = json.dumps(expanded_tcs, ensure_ascii=False, indent=2)
            clean_answer = f"🔧 **Tetiklenen Araç Çağrısı (`{call_names}`):**\n```json\n{pretty_tcs}\n```"

        extracted_thought = str(raw_payload.get("thinking_content") or "").strip()
        if not extracted_thought and thinking_col:
            m = re.search(
                r"🧠 \[LLM DÜŞÜNCE SÜRECİ[^\]]*\]\n([\s\S]*?)(?:\n---\n|$)",
                thinking_col,
            )
            if m and m.group(1):
                extracted_thought = m.group(1).strip()
        if tag_thoughts and tag_thoughts not in extracted_thought:
            extracted_thought = (
                f"{extracted_thought}\n\n{tag_thoughts}".strip()
                if extracted_thought
                else tag_thoughts
            )

        sections: List[str] = []
        if extracted_thought:
            sections.append(
                f"> 🧠 **LLM Düşünce & İçsel Muhakeme Süreci (Chain-of-Thought):**\n```text\n{extracted_thought}\n```"
            )
        else:
            sections.append(
                f"> 🧠 **LLM Düşünce & Karar Süreci:**\n> Model (`{model_id}` · `{provider}`) gelen istemi değerlendirerek **{ttft_ms or latency_ms} ms** içinde ilk token'ı üretti ve toplam **{latency_ms} ms** sürede **{len(clean_answer.encode('utf-8'))} bayt ({len(clean_answer)} karakter)** uzunluğunda yanıt döndürdü."
            )

        if len(clean_answer) > 0:
            sections.append(clean_answer)
        else:
            sections.append("*(Boş metin yanıtı — 0 karakter)*")

        if expanded_tcs and "```json" not in clean_answer:
            sections.append(
                f"🔧 **Tetiklenen Araç Çağrıları (`tool_calls` — {len(expanded_tcs)} adet):**\n```json\n{json.dumps(expanded_tcs, ensure_ascii=False, indent=2)}\n```"
            )

        raw_unfiltered = str(raw_payload.get("raw_unfiltered_output") or "")
        if (
            raw_unfiltered
            and not raw_unfiltered.lstrip().startswith("[Araç Çağrısı:")
            and raw_unfiltered.strip() != clean_answer.strip()
            and raw_unfiltered.strip() != base_clean.strip()
        ):
            sections.append(
                f"📦 **Modelin Ham (Filtrelenmemiş / Normalize Edilmemiş) Çıktısı ({len(raw_unfiltered)} krk):**\n```text\n{raw_unfiltered}\n```"
            )

        session_id = str(raw_payload.get("session_id") or "—")
        stream_label = (
            "Senkron JSON" if raw_payload.get("is_stream") is False else "SSE Gerçek Zamanlı Akış"
        )
        char_len = len(clean_answer)
        byte_len = len(clean_answer.encode("utf-8"))
        err_part = f"\n- **Hata Detayı:** `{error_detail}`" if error_detail else ""
        response_type_desc = (
            f"MCP Araç Çağrısı (`{', '.join(tc.get('function', {}).get('name', 'tool') for tc in expanded_tcs if isinstance(tc, dict))}`)"
            if expanded_tcs
            else "Metin / JSON Yanıtı"
        )

        incoming_report_payload: Dict[str, Any] = {
            "request_id": request_id,
            "model": model_id,
            "provider": provider,
            "session_id": session_id,
            "mode": stream_label,
            "status": status,
            "metrics": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "ttft_ms": ttft_ms,
                "latency_ms": latency_ms,
                "char_length": char_len,
                "byte_length": byte_len,
            },
        }
        if extracted_thought:
            incoming_report_payload["thinking_content"] = extracted_thought
        if raw_unfiltered and not raw_unfiltered.lstrip().startswith("[Araç Çağrısı:"):
            try:
                incoming_report_payload["raw_output"] = json.loads(raw_unfiltered)
            except Exception:
                incoming_report_payload["raw_output"] = raw_unfiltered
        elif clean_answer and not clean_answer.lstrip().startswith(("🔧", "[Araç Çağrısı:")):
            try:
                incoming_report_payload["content"] = json.loads(clean_answer)
            except Exception:
                incoming_report_payload["content"] = clean_answer
        if expanded_tcs:
            incoming_report_payload["tool_calls"] = expanded_tcs
        if error_detail:
            incoming_report_payload["error_detail"] = error_detail

        incoming_report_json = json.dumps(incoming_report_payload, ensure_ascii=False, indent=2)

        sections.append(
            f"📥 **Gelen LLM İletişim Raporu:**\n"
            f"- **İstek & Oturum:** `İstek ID: {request_id}` · `Oturum: {session_id}` · `Sağlayıcı: {provider}` · `Mod: {stream_label}`\n"
            f"- **Yanıt Türü & Boyut:** {response_type_desc} · `{char_len} krk ({byte_len} bayt)` · `Durum: {status}`\n"
            f"- **Token & Performans:** `Girdi: {prompt_tokens} tok` · `Çıktı: {completion_tokens} tok` · `Toplam: {total_tokens} tok` · `TTFT: {ttft_ms} ms` · `Toplam Süre: {latency_ms} ms`{err_part}\n"
            f"```json\n{incoming_report_json}\n```"
        )
        return "\n\n".join(sections)

    @staticmethod
    def extract_last_user_prompt(text_only_messages: List[Dict[str, str]]) -> str:
        """Mesaj geçmişindeki son kullanıcı istemini (prompt) bulur."""
        for msg in reversed(text_only_messages):
            if msg.get("role") == "user" and msg.get("content"):
                return str(msg["content"])
        if text_only_messages:
            return str(text_only_messages[-1].get("content", ""))
        return ""

    @classmethod
    def resolve_document_part(
        cls,
        part: Dict[str, Any],
    ) -> Tuple[str, str, int, int, str]:
        """
        Ekli belge parçasını (`type: "file" | "document" | "input_file"`) çözümler.
        İstemciden parse edilmeden ham Base64 / Data URL (`file_data`, `base64_data`, `data_url`,
        `file.file_data`) olarak gönderilen ekleri sunucu tarafında DocumentService ile okunabilir
        Unicode metne dönüştürür ve `part["_resolved_text"]` üzerinde önbelleğe alır.
        Dönüş: (file_name, mime_type, file_size, estimated_tokens, resolved_readable_text)
        """
        file_obj = part.get("file") if isinstance(part.get("file"), dict) else {}
        fname = str(
            part.get("file_name")
            or part.get("filename")
            or part.get("name")
            or file_obj.get("filename")
            or file_obj.get("file_name")
            or file_obj.get("name")
            or "belge.pdf"
        ).strip()
        mime_type = str(
            part.get("mime_type")
            or file_obj.get("mime_type")
            or ("application/pdf" if fname.lower().endswith(".pdf") else "application/octet-stream")
        ).strip()

        raw_file_data = str(
            part.get("file_data")
            or part.get("base64_data")
            or part.get("data_url")
            or file_obj.get("file_data")
            or file_obj.get("base64_data")
            or file_obj.get("data_url")
            or ""
        ).strip()

        explicit_content = str(
            part.get("content")
            or part.get("text")
            or file_obj.get("content")
            or ""
        )

        cached_resolved = part.get("_resolved_text")
        cached_size = part.get("_resolved_size")
        if isinstance(cached_resolved, str) and cached_resolved:
            resolved_txt = cached_resolved
            fsize = int(
                part.get("file_size")
                or part.get("size")
                or file_obj.get("file_size")
                or cached_size
                or len(resolved_txt.encode("utf-8"))
            )
            est_tokens = int(
                part.get("estimated_tokens") or DocumentService.estimate_tokens(resolved_txt)
            )
            return fname, mime_type, fsize, est_tokens, resolved_txt

        resolved_txt = ""
        decoded_byte_size = 0

        if raw_file_data:
            try:
                doc_svc = DocumentService()
                clean_b64 = doc_svc._strip_data_url_header(raw_file_data)
                raw_bytes = doc_svc._decode_base64_bytes(clean_b64)
                decoded_byte_size = len(raw_bytes)
                resolved_txt = doc_svc.extract_text_from_bytes(fname, raw_bytes)
            except Exception:
                resolved_txt = ""

        if not resolved_txt and explicit_content:
            stripped_explicit = explicit_content.strip()
            # Eğer content alanına yanlışlıkla data:...;base64,... veya %PDF- ham ikili verisi konmuşsa çöz
            if stripped_explicit.startswith("data:") and ";base64," in stripped_explicit[:120]:
                try:
                    doc_svc = DocumentService()
                    clean_b64 = doc_svc._strip_data_url_header(stripped_explicit)
                    raw_bytes = doc_svc._decode_base64_bytes(clean_b64)
                    decoded_byte_size = len(raw_bytes)
                    resolved_txt = doc_svc.extract_text_from_bytes(fname, raw_bytes)
                except Exception:
                    resolved_txt = ""
            elif stripped_explicit.startswith("%PDF-"):
                try:
                    doc_svc = DocumentService()
                    raw_bytes = explicit_content.encode("latin-1", errors="ignore")
                    decoded_byte_size = len(raw_bytes)
                    resolved_txt = doc_svc.extract_text_from_bytes(fname, raw_bytes)
                except Exception:
                    resolved_txt = ""
            else:
                resolved_txt = explicit_content

        # CMap/PDFKit sonrası oluşan Object Replacement Character (\ufffc) kalıntılarını temizle
        if resolved_txt:
            resolved_txt = resolved_txt.replace("\ufffc", "").strip()

        fsize = int(
            part.get("file_size")
            or part.get("size")
            or file_obj.get("file_size")
            or decoded_byte_size
            or len(resolved_txt.encode("utf-8"))
        )
        est_tokens = int(
            part.get("estimated_tokens") or DocumentService.estimate_tokens(resolved_txt)
        )

        if resolved_txt:
            part["_resolved_text"] = resolved_txt
        if fsize:
            part["_resolved_size"] = fsize

        return fname, mime_type, fsize, est_tokens, resolved_txt

    @classmethod
    def extract_last_user_message_details(
        cls,
        messages: List[ChatMessageDTO],
    ) -> Tuple[str, List[ExtractedAttachmentInputDTO], str]:
        """
        Mesaj listesinden:
        1) Son kullanıcının yazdığı saf metni (dosya içerik gövdesi hariç),
        2) Son mesajla birlikte gönderilen ekli dosyaların (isim, tür, boyut) listesini,
        3) Varsa tüm sistem yönergelerinin birleşimini (system prompt)
        ayrıştırarak döner.
        """
        system_prompt = cls.extract_system_instructions(messages)

        target_msg: ChatMessageDTO | None = None
        for msg in reversed(messages):
            if msg.role == "user":
                target_msg = msg
                break
        if target_msg is None and messages:
            target_msg = messages[-1]
        if target_msg is None:
            return "", [], system_prompt

        if target_msg.content is None:
            return "", [], system_prompt

        if isinstance(target_msg.content, str):
            return cls.strip_ui_trace_blocks(target_msg.content).strip(), [], system_prompt

        text_parts: List[str] = []
        attachments: List[ExtractedAttachmentInputDTO] = []

        for part in target_msg.content:
            ptype = str(part.get("type", ""))
            if ptype == "text":
                txt = cls.strip_ui_trace_blocks(str(part.get("text", ""))).strip()
                if txt:
                    text_parts.append(txt)
            elif ptype in ("file", "document", "input_file"):
                fname, mime_type, fsize, est_tokens, fcontent = cls.resolve_document_part(part)
                attachments.append(
                    ExtractedAttachmentInputDTO(
                        file_name=fname,
                        file_kind="document",
                        mime_type=mime_type,
                        file_size=fsize,
                        estimated_tokens=est_tokens,
                        extracted_text=fcontent,
                    )
                )
            elif ptype == "image_url":
                fname = str(part.get("file_name") or part.get("name") or "gorsel.png").strip()
                img_obj = part.get("image_url", {})
                img_url = img_obj.get("url", "") if isinstance(img_obj, dict) else str(img_obj)
                attachments.append(
                    ExtractedAttachmentInputDTO(
                        file_name=fname,
                        file_kind="image",
                        mime_type=str(part.get("mime_type") or "image/*"),
                        file_size=int(part.get("file_size") or part.get("size") or len(img_url)),
                        estimated_tokens=int(part.get("estimated_tokens") or 0),
                        extracted_text=f"[Image URL / Base64 Boyutu: {len(img_url)} karakter]",
                    )
                )

        clean_text = "\n\n".join(text_parts).strip()
        if not clean_text and attachments:
            clean_text = f"[Ekli Dosya: {', '.join(a.file_name for a in attachments)}]"
        return clean_text, attachments, system_prompt

    @classmethod
    def estimate_prompt_tokens(cls, messages: List[ChatMessageDTO]) -> int:
        """Mesaj listesindeki toplam istem (prompt) token sayısını (ekli dosyaların çözümlenmiş metinleri dahil) tahmin eder."""
        chunks: List[str] = []
        for m in messages:
            if m.content is None:
                continue
            if isinstance(m.content, str):
                chunks.append(m.content)
            elif isinstance(m.content, list):
                for part in m.content:
                    if not isinstance(part, dict):
                        continue
                    ptype = str(part.get("type", ""))
                    if ptype == "text":
                        chunks.append(str(part.get("text", "")))
                    elif ptype in ("file", "document", "input_file"):
                        _, _, _, _, resolved_txt = cls.resolve_document_part(part)
                        chunks.append(resolved_txt)
                    else:
                        chunks.append(str(part.get("file_name") or ""))
        return DocumentService.estimate_tokens("\n".join(chunks))

    def _format_single_message(
        self,
        message: ChatMessageDTO,
    ) -> Tuple[Dict[str, Any], Dict[str, str]]:
        """Tek bir ChatMessageDTO nesnesini multimodal ve düz metin sözlüklerine dönüştürür."""
        base_dict: Dict[str, Any] = {"role": message.role}
        if message.tool_calls is not None:
            base_dict["tool_calls"] = message.tool_calls
        if message.tool_call_id is not None:
            base_dict["tool_call_id"] = message.tool_call_id
        if message.name is not None:
            base_dict["name"] = message.name

        if message.content is None:
            base_dict["content"] = ""
            return base_dict, base_dict

        if isinstance(message.content, str):
            base_dict["content"] = self.strip_ui_trace_blocks(message.content)
            return base_dict, base_dict

        text_segments, image_parts = self._extract_segments_from_parts(message.content)
        combined_text = "\n\n".join(self.strip_ui_trace_blocks(s) for s in text_segments).strip() or "Ekli içeriği incele."
        text_entry = dict(base_dict)
        text_entry["content"] = combined_text

        if image_parts:
            mm_content: List[Dict[str, Any]] = [{"type": "text", "text": combined_text}] + image_parts
            mm_entry = dict(base_dict)
            mm_entry["content"] = mm_content
            return mm_entry, text_entry

        return text_entry, text_entry

    @classmethod
    def _extract_segments_from_parts(
        cls,
        parts: List[Dict[str, Any]],
    ) -> Tuple[List[str], List[Dict[str, Any]]]:
        """Çok parçalı (multimodal) içerik dizisinden metin ve görsel parçalarını ayırır."""
        text_segments: List[str] = []
        doc_segments: List[str] = []
        image_parts: List[Dict[str, Any]] = []

        for part in parts:
            ptype = part.get("type", "")
            if ptype == "text":
                txt = part.get("text", "")
                if txt:
                    text_segments.append(txt)
            elif ptype in ("file", "document", "input_file"):
                doc_segments.append(cls._format_document_part(part))
            elif ptype == "image_url":
                img_part, img_label = cls._format_image_part(part)
                if img_part:
                    image_parts.append(img_part)
                    text_segments.append(img_label)

        # Ekli belge varsa önce belge metnini, ardından kullanıcının talimatını da sona yerleştirerek
        # uzun PDF metinlerinden sonra modelin asıl görevi unutmasını engelle.
        if doc_segments and text_segments:
            user_task_reminder = "\n\n".join(t.strip() for t in text_segments if t.strip()).strip()
            combined_segments = (
                text_segments
                + doc_segments
                + [
                    f"[GÖREV HATIRLATMASI — YUKARIDAKİ EKLİ BELGEYİ AŞAĞIDAKİ KULLANICI VE SİSTEM TALİMATINA BİREBİR UYARAK İŞLE]:\n{user_task_reminder}"
                ]
            )
            return combined_segments, image_parts

        return text_segments + doc_segments, image_parts

    @classmethod
    def _format_document_part(cls, part: Dict[str, Any]) -> str:
        """Ekli belge parçasını (ham Base64 eki dahil) okunabilir yapılandırılmış metin bloğuna dönüştürür."""
        fname, _, _, _, fcontent = cls.resolve_document_part(part)
        return f"--- [Ekli Dosya: {fname}] ---\n{fcontent}\n--- [Dosya Sonu: {fname}] ---"

    @staticmethod
    def _format_image_part(part: Dict[str, Any]) -> Tuple[Dict[str, Any] | None, str]:
        """Ekli görsel parçasını OpenAI image_url nesnesine ve metin etiketine dönüştürür."""
        img_obj = part.get("image_url", {})
        url = img_obj.get("url", "") if isinstance(img_obj, dict) else str(img_obj)
        fname = part.get("file_name") or "image"
        if not url:
            return None, ""
        return {"type": "image_url", "image_url": {"url": url}}, f"[Ekli Görsel: {fname}]"
