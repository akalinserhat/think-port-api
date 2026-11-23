"""
ThinkPort AI Gateway - Sanal Tarayıcı Agentik Tool-Calling Köprüsü (web_browser_agent_bridge.py).

`chatgpt-web` ve `gemini-web` gibi IWebBrowserModel (Docker Playwright) tabanlı modeller için:
1. OpenAI `messages` (`system`, `user`, `assistant`, `tool`) + `tools` şemalarını tarayıcı sohbet
   penceresine uygun prompt-tabanlı araç çağrısı (ReAct / `<tool_call>` XML+JSON) protokolüne dönüştürür.
2. Web arayüzünden dönen ham metindeki `<tool_call>...</tool_call>` veya JSON araç çağrılarını
   ayrıştırıp standart OpenAI `tool_calls` listesine çevirir.
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any, Dict, List, Optional, Set, Tuple, Union


_TOOL_CALL_TAG_RE = re.compile(
    r"<tool_call>\s*(.*?)\s*</tool_call>",
    flags=re.DOTALL | re.IGNORECASE,
)
_JSON_FENCE_RE = re.compile(
    r"```(?:json)?\s*(.*?)\s*```",
    flags=re.DOTALL | re.IGNORECASE,
)


def _extract_text_from_content(content: Any) -> str:
    """OpenAI string veya multimodal list içeriklerinden düz metni çıkarır."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                txt = item.get("text") or item.get("content")
                if isinstance(txt, str) and txt.strip():
                    parts.append(txt.strip())
        return "\n".join(parts).strip()
    return str(content).strip()


def _extract_allowed_tool_names(tools: Optional[List[Dict[str, Any]]]) -> Set[str]:
    """OpenAI `tools` şema listesinden geçerli fonksiyon adlarını döndürür."""
    names: Set[str] = set()
    if not tools:
        return names
    for t in tools:
        if not isinstance(t, dict):
            continue
        fn = t.get("function") if isinstance(t.get("function"), dict) else t
        name = fn.get("name")
        if isinstance(name, str) and name.strip():
            names.add(name.strip())
    return names


def _format_tools_protocol_block(
    tools: List[Dict[str, Any]],
    tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
) -> str:
    """OpenAI araç şemalarını web LLM'in anlayacağı kompakt protokol bloğuna dönüştürür."""
    tool_lines: List[str] = []
    for idx, t in enumerate(tools, start=1):
        if not isinstance(t, dict):
            continue
        fn = t.get("function") if isinstance(t.get("function"), dict) else t
        name = str(fn.get("name") or "").strip()
        if not name:
            continue
        desc = str(fn.get("description") or "").strip()
        params = fn.get("parameters") or {"type": "object", "properties": {}}
        params_json = json.dumps(params, ensure_ascii=False, separators=(",", ":"))
        tool_lines.append(f"{idx}. `{name}`: {desc}\n   Parametreler (JSON Schema): {params_json}")

    forced_note = ""
    if isinstance(tool_choice, str):
        tc_lower = tool_choice.strip().lower()
        if tc_lower == "required":
            forced_note = "\nZORUNLU: Bu adımda mutlaka en az bir araç çağırmalısın."
        elif tc_lower == "none":
            forced_note = "\nBu adımda araç çağırma, doğrudan metin yanıtı ver."
    elif isinstance(tool_choice, dict):
        forced_fn = (tool_choice.get("function") or {}).get("name") or tool_choice.get("name")
        if forced_fn:
            forced_note = f"\nZORUNLU: Bu adımda mutlaka `{forced_fn}` aracını çağırmalısın."

    return (
        "[AGENTİK ARAÇ ÇAĞRISI PROTOKOLÜ]\n"
        "Aşağıdaki araçlara erişimin var:\n"
        + "\n".join(tool_lines)
        + "\n\n"
        "KURALLAR:\n"
        "- Bir araç çağırman gerekiyorsa yanıtında SADECE aşağıdaki biçimde geçerli JSON döndür (ek açıklama yazma):\n"
        "<tool_call>\n"
        '{"name": "arac_adi", "arguments": {"param": "deger"}}\n'
        "</tool_call>\n"
        "- Aynı anda birden fazla araç çağırmak için birden fazla <tool_call>...</tool_call> bloğu kullanabilirsin.\n"
        "- `arguments` her zaman geçerli bir JSON nesnesi (`{...}`) olmalıdır.\n"
        "- Araç çağırmaya gerek yoksa veya görev tamamlandıysa doğrudan kullanıcıya nihai yanıtını ver."
        + forced_note
    )


def _format_history_message(msg: Dict[str, Any]) -> Optional[str]:
    """Tek bir geçmiş mesajını (user/assistant/tool) düz metin satırına çevirir."""
    role = str(msg.get("role") or "user").lower()
    if role in ("system", "developer"):
        return None
    if role == "tool":
        tool_name = str(msg.get("name") or "tool")
        tool_content = _extract_text_from_content(msg.get("content"))
        return f"[ARAÇ SONUCU ({tool_name})]:\n{tool_content}"
    if role == "assistant":
        parts: List[str] = []
        txt = _extract_text_from_content(msg.get("content"))
        if txt:
            parts.append(txt)
        for tc in msg.get("tool_calls") or []:
            if not isinstance(tc, dict):
                continue
            fn = tc.get("function") or {}
            fn_name = fn.get("name") or "tool"
            fn_args = fn.get("arguments") or "{}"
            parts.append(f'<tool_call>{{"name": "{fn_name}", "arguments": {fn_args}}}</tool_call>')
        if not parts:
            return None
        return "[ASİSTAN]:\n" + "\n".join(parts)
    user_txt = _extract_text_from_content(msg.get("content"))
    return f"[KULLANICI]:\n{user_txt}" if user_txt else None


def build_browser_prompt(
    openai_messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
    is_json_mode: bool = False,
    has_active_session: bool = False,
) -> str:
    """
    OpenAI mesaj geçmişi ve araç tanımlarından sanal tarayıcıya gönderilecek istemi üretir.

    - Normal (araçsız, sistem promptsuz ve tool geçmişsiz) sohbetlerde geriye dönük uyumluluk
      için yalnızca son `user` mesajını döner.
    - Agentik modda (`tools`, `system`, `tool` mesajı veya `is_json_mode` varsa):
      * Aktif tarayıcı oturumunda devam turu (`role == "tool"` ile bitiyorsa) ise yalnızca yeni
        araç sonuçlarını gönderir.
      * İlk tur veya sıfırlanmış oturumda `system` prompt + araç protokolü + geçmiş mesajları
        eksiksiz paketler.
    """
    system_parts: List[str] = []
    for m in openai_messages:
        if str(m.get("role") or "").lower() in ("system", "developer"):
            txt = _extract_text_from_content(m.get("content"))
            if txt:
                system_parts.append(txt)

    has_tools = bool(tools)
    has_tool_history = any(
        str(m.get("role") or "").lower() == "tool" or bool(m.get("tool_calls"))
        for m in openai_messages
    )

    # Normal, araçsız, sistem promptsuz tek-turlu sohbet (mevcut davranış)
    if not has_tools and not has_tool_history and not system_parts and not is_json_mode:
        for m in reversed(openai_messages):
            if str(m.get("role") or "").lower() == "user":
                return _extract_text_from_content(m.get("content"))
        return ""

    # Devam turu: tarayıcıda aynı sohbet sekmesi zaten açıksa ve son mesaj(lar) tool sonucu ise
    # yalnızca yeni araç sonuçlarını göndererek bağlamı tekrarlamadan hızlı ilerle.
    last_role = str(openai_messages[-1].get("role") or "").lower() if openai_messages else ""
    if has_active_session and last_role == "tool":
        trailing_tools: List[str] = []
        for m in reversed(openai_messages):
            if str(m.get("role") or "").lower() == "tool":
                formatted = _format_history_message(m)
                if formatted:
                    trailing_tools.append(formatted)
            else:
                break
        trailing_tools.reverse()
        continuation_blocks = list(trailing_tools)
        if has_tools:
            continuation_blocks.append(
                "Yukarıdaki araç sonucuna göre devam et: başka bir araç çağırman gerekiyorsa "
                "yalnızca <tool_call>{\"name\": \"...\", \"arguments\": {...}}</tool_call> bloğu döndür; "
                "görev tamamlandıysa kullanıcıya nihai yanıtını ver."
            )
        elif is_json_mode:
            continuation_blocks.append("Yanıtını yalnızca geçerli JSON olarak ver.")
        return "\n\n".join(continuation_blocks).strip()

    # İlk tur veya oturum sıfırlanmış (tam bağlam enjeksiyonu)
    blocks: List[str] = []
    if system_parts:
        blocks.append("[SİSTEM TALİMATI]\n" + "\n\n".join(system_parts))
    if has_tools and tools:
        blocks.append(_format_tools_protocol_block(tools, tool_choice=tool_choice))
    if is_json_mode:
        blocks.append("[ÇIKTI BİÇİMİ]\nAraç çağırmadığında yanıtını yalnızca geçerli bir JSON nesnesi olarak döndür.")

    non_system_msgs = [
        m for m in openai_messages
        if str(m.get("role") or "").lower() not in ("system", "developer")
    ]
    if len(non_system_msgs) == 1 and str(non_system_msgs[0].get("role") or "").lower() == "user":
        user_txt = _extract_text_from_content(non_system_msgs[0].get("content"))
        if user_txt:
            blocks.append(f"[KULLANICI İSTEMİ]\n{user_txt}")
    else:
        history_lines: List[str] = []
        for m in non_system_msgs:
            formatted = _format_history_message(m)
            if formatted:
                history_lines.append(formatted)
        if history_lines:
            blocks.append("[SOHBET GEÇMİŞİ VE SON İSTEM]\n" + "\n\n".join(history_lines))
        if last_role == "tool" and has_tools:
            blocks.append(
                "Yukarıdaki araç sonucuna göre devam et: başka bir araç gerekiyorsa "
                "yalnızca <tool_call>...</tool_call> bloğu döndür, değilse nihai yanıtını ver."
            )

    return "\n\n".join(b for b in blocks if b).strip()


def _normalize_single_call(
    obj: Any,
    allowed_names: Set[str],
) -> List[Dict[str, Any]]:
    """Tek bir JSON nesnesini veya `tool_calls` dizisini OpenAI `tool_calls` biçimine dönüştürür."""
    results: List[Dict[str, Any]] = []
    if isinstance(obj, list):
        for item in obj:
            results.extend(_normalize_single_call(item, allowed_names))
        return results

    if not isinstance(obj, dict):
        return results

    if isinstance(obj.get("tool_calls"), list):
        return _normalize_single_call(obj["tool_calls"], allowed_names)

    fn_container = obj.get("function") if isinstance(obj.get("function"), dict) else obj
    raw_name = (
        fn_container.get("name")
        or obj.get("tool")
        or obj.get("tool_name")
        or obj.get("action")
    )
    if not isinstance(raw_name, str) or not raw_name.strip():
        return results

    fn_name = raw_name.strip()
    if allowed_names and fn_name not in allowed_names:
        return results

    raw_args = (
        fn_container.get("arguments")
        if "arguments" in fn_container
        else (
            fn_container.get("parameters")
            if "parameters" in fn_container
            else (obj.get("input") if "input" in obj else {})
        )
    )
    if isinstance(raw_args, str):
        try:
            parsed_args = json.loads(raw_args)
            args_str = json.dumps(parsed_args, ensure_ascii=False)
        except Exception:
            args_str = raw_args
    elif isinstance(raw_args, dict):
        args_str = json.dumps(raw_args, ensure_ascii=False)
    else:
        args_str = "{}"

    results.append(
        {
            "id": str(obj.get("id") or f"call_web_{uuid.uuid4().hex[:12]}"),
            "type": "function",
            "function": {
                "name": fn_name,
                "arguments": args_str,
            },
        }
    )
    return results


def _try_parse_json_candidate(raw: str) -> Any:
    """Gelecek olası küçük biçim bozukluklarına (sondaki virgül vb.) dayanıklı JSON ayrıştırıcı."""
    cleaned = raw.strip()
    if not cleaned:
        return None
    # Kod bloğu ile sarılmışsa içeriği çıkar
    fence_m = _JSON_FENCE_RE.search(cleaned)
    if fence_m:
        cleaned = fence_m.group(1).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        # Sondaki fazla virgülleri temizleyip tekrar dene
        fixed = re.sub(r",\s*([}\]])", r"\1", cleaned)
        try:
            return json.loads(fixed)
        except Exception:
            return None


def parse_tool_calls_from_text(
    raw_text: str,
    tools: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[List[Dict[str, Any]], str]:
    """
    Web LLM yanıtından `<tool_call>...</tool_call>` bloklarını veya geçerli JSON araç çağrılarını
    ayrıştırır.

    Returns:
        (tool_calls, remaining_text)
    """
    text = (raw_text or "").strip()
    if not text or not tools:
        return [], text

    allowed_names = _extract_allowed_tool_names(tools)
    found_calls: List[Dict[str, Any]] = []

    # 1. Öncelik: Açık <tool_call>...</tool_call> etiketleri
    tag_matches = list(_TOOL_CALL_TAG_RE.finditer(text))
    if tag_matches:
        for m in tag_matches:
            parsed = _try_parse_json_candidate(m.group(1))
            if parsed is not None:
                found_calls.extend(_normalize_single_call(parsed, allowed_names))
        if found_calls:
            remaining = _TOOL_CALL_TAG_RE.sub("", text).strip()
            return found_calls, remaining

    # 2. Yedek: Kod çiti (```json ... ```) içinde araç çağrısı JSON'u
    for fence_m in _JSON_FENCE_RE.finditer(text):
        parsed = _try_parse_json_candidate(fence_m.group(1))
        if parsed is not None:
            calls = _normalize_single_call(parsed, allowed_names)
            if calls:
                found_calls.extend(calls)
    if found_calls:
        remaining = _JSON_FENCE_RE.sub("", text).strip()
        return found_calls, remaining

    # 3. Yedek: Yanıtın tamamı doğrudan JSON nesnesi veya dizisi ise
    stripped = text.strip()
    if (stripped.startswith("{") and stripped.endswith("}")) or (
        stripped.startswith("[") and stripped.endswith("]")
    ):
        parsed = _try_parse_json_candidate(stripped)
        if parsed is not None:
            calls = _normalize_single_call(parsed, allowed_names)
            if calls:
                return calls, ""

    return [], text
