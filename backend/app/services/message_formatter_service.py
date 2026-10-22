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

        # Son kullanıcı mesajını bul ve zenginleştir
        target_idx: Optional[int] = None
        for idx in range(len(copied) - 1, -1, -1):
            if copied[idx].get("role") == "user":
                target_idx = idx
                break

        if target_idx is None:
            return copied

        target_msg = copied[target_idx]
        content = target_msg.get("content", "")
        if isinstance(content, str):
            updated = content
            if combined_sys and SYSTEM_INSTRUCTION_HEADER not in updated and combined_sys[:80] not in updated:
                updated = f"{SYSTEM_INSTRUCTION_HEADER}\n{combined_sys}\n\n{updated}"
            if json_suffix and "[CRITICAL OUTPUT FORMAT REQUIREMENT" not in updated:
                updated = f"{updated}{json_suffix}"
            target_msg["content"] = updated
        elif isinstance(content, list):
            new_parts = [dict(p) for p in content]
            # İlk metin parçasına sistem yönergesini, son metin parçasına JSON zorunluluğunu ekle
            text_indices = [i for i, p in enumerate(new_parts) if p.get("type") == "text"]
            if text_indices:
                first_ti = text_indices[0]
                first_txt = str(new_parts[first_ti].get("text", ""))
                if combined_sys and SYSTEM_INSTRUCTION_HEADER not in first_txt and combined_sys[:80] not in first_txt:
                    new_parts[first_ti]["text"] = f"{SYSTEM_INSTRUCTION_HEADER}\n{combined_sys}\n\n{first_txt}"
                last_ti = text_indices[-1]
                last_txt = str(new_parts[last_ti].get("text", ""))
                if json_suffix and "[CRITICAL OUTPUT FORMAT REQUIREMENT" not in last_txt:
                    new_parts[last_ti]["text"] = f"{last_txt}{json_suffix}"
            target_msg["content"] = new_parts

        return copied

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
        """Sistem talimatlarını son kullanıcı mesajının en üstüne `[SYSTEM INSTRUCTIONS - MUST FOLLOW STRICTLY]:` başlığıyla ekler."""
        prefix_block = f"{SYSTEM_INSTRUCTION_HEADER}\n{system_instructions}\n\n"
        for idx in range(len(text_only_msgs) - 1, -1, -1):
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

        if isinstance(target_msg.content, str):
            return target_msg.content.strip(), [], system_prompt

        text_parts: List[str] = []
        attachments: List[ExtractedAttachmentInputDTO] = []

        for part in target_msg.content:
            ptype = str(part.get("type", ""))
            if ptype == "text":
                txt = str(part.get("text", "")).strip()
                if txt:
                    text_parts.append(txt)
            elif ptype in ("file", "document"):
                fname = str(part.get("file_name") or part.get("name") or "belge.txt").strip()
                fcontent = str(part.get("content") or part.get("text") or "")
                est_tokens = int(
                    part.get("estimated_tokens") or DocumentService.estimate_tokens(fcontent)
                )
                attachments.append(
                    ExtractedAttachmentInputDTO(
                        file_name=fname,
                        file_kind="document",
                        mime_type=str(part.get("mime_type") or ""),
                        file_size=int(part.get("file_size") or part.get("size") or len(fcontent.encode("utf-8"))),
                        estimated_tokens=est_tokens,
                    )
                )
            elif ptype == "image_url":
                fname = str(part.get("file_name") or part.get("name") or "gorsel.png").strip()
                attachments.append(
                    ExtractedAttachmentInputDTO(
                        file_name=fname,
                        file_kind="image",
                        mime_type=str(part.get("mime_type") or "image/*"),
                        file_size=int(part.get("file_size") or part.get("size") or 0),
                        estimated_tokens=int(part.get("estimated_tokens") or 0),
                    )
                )

        clean_text = "\n\n".join(text_parts).strip()
        if not clean_text and attachments:
            clean_text = f"[Ekli Dosya: {', '.join(a.file_name for a in attachments)}]"
        return clean_text, attachments, system_prompt

    @staticmethod
    def estimate_prompt_tokens(messages: List[ChatMessageDTO]) -> int:
        """Mesaj listesindeki toplam istem (prompt) token sayısını tahmin eder."""
        serialized = "\n".join(
            m.content if isinstance(m.content, str) else json.dumps(m.content)
            for m in messages
        )
        return DocumentService.estimate_tokens(serialized)

    def _format_single_message(
        self,
        message: ChatMessageDTO,
    ) -> Tuple[Dict[str, Any], Dict[str, str]]:
        """Tek bir ChatMessageDTO nesnesini multimodal ve düz metin sözlüklerine dönüştürür."""
        if isinstance(message.content, str):
            simple = {"role": message.role, "content": message.content}
            return simple, simple

        text_segments, image_parts = self._extract_segments_from_parts(message.content)
        combined_text = "\n\n".join(text_segments).strip() or "Ekli içeriği incele."
        text_entry = {"role": message.role, "content": combined_text}

        if image_parts:
            mm_content: List[Dict[str, Any]] = [{"type": "text", "text": combined_text}] + image_parts
            return {"role": message.role, "content": mm_content}, text_entry

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
            elif ptype in ("file", "document"):
                doc_segments.append(cls._format_document_part(part))
            elif ptype == "image_url":
                img_part, img_label = cls._format_image_part(part)
                if img_part:
                    image_parts.append(img_part)
                    text_segments.append(img_label)

        # Ekli belge varsa önce belge metnini, ardından kullanıcının talimatını da sona yerleştirerek
        # uzun PDF metinlerinden sonra modelin asıl görevi unutmasını engelle.
        if doc_segments and text_segments:
            combined_segments = (
                text_segments
                + doc_segments
                + [
                    "[GÖREV HATIRLATMASI]: Yukarıdaki ekli belge içeriğini başta verilen sistem ve kullanıcı kurallarına birebir uyarak işle."
                ]
            )
            return combined_segments, image_parts

        return text_segments + doc_segments, image_parts

    @staticmethod
    def _format_document_part(part: Dict[str, Any]) -> str:
        """Ekli belge parçasını yapılandırılmış metin bloğuna dönüştürür."""
        fname = part.get("file_name") or part.get("name") or "attachment"
        fcontent = part.get("content") or part.get("text") or ""
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
