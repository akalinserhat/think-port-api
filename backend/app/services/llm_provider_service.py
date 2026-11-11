"""
ThinkPort AI Gateway - LLM Sağlayıcı İletişim Servisi (llm_provider_service.py).
Web AI (Pollinations / OpenAI Web Bridge) ve yerel Ollama büyük dil modeli sağlayıcılarıyla
HTTP/SSE akışını, yedek (fallback) geçişlerini ve tool_calls ayrıştırmasını yürütür.
"""
import http.client
import json
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple, Union
from app.core.config import settings
from app.core.logger import gateway_logger
from app.core.security import create_verified_ssl_context
from app.services.message_formatter_service import MessageFormatterService


class LlmProviderService:
    """
    Web AI (Pollinations / OpenAI Web Bridge) ve opsiyonel Yerel (Ollama) büyük dil modeli
    sağlayıcılarıyla HTTP/SSE iletişimini yürüten servis.
    Her metot yalnızca tek bir protokol veya akış adımıyla ilgilenir.
    """

    def stream_from_ollama(
        self,
        target_model: str,
        openai_messages: List[Dict[str, Any]],
        on_delta: Callable[[str], None],
        response_format: Optional[Dict[str, Any]] = None,
        temperature: Optional[float] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        on_tool_calls: Optional[Callable[[List[Dict[str, Any]]], None]] = None,
        on_reasoning: Optional[Callable[[str], None]] = None,
        max_tokens: Optional[int] = None,
    ) -> bool:
        """Yerel Ollama /v1/chat/completions uç noktasından gerçek zamanlı SSE akışı okur."""
        t0 = time.perf_counter()
        conn = http.client.HTTPConnection(
            settings.ollama_host,
            settings.ollama_port,
            timeout=settings.ollama_timeout_sec,
        )
        try:
            payload = self._build_stream_payload(
                target_model,
                openai_messages,
                response_format=response_format,
                temperature=temperature,
                tools=tools,
                tool_choice=tool_choice,
                max_tokens=max_tokens,
            )
            conn.request(
                "POST",
                "/v1/chat/completions",
                body=payload,
                headers={"Content-Type": "application/json"},
            )
            resp = conn.getresponse()
            if resp.status != 200:
                gateway_logger.warning(
                    f"Ollama upstream HTTP {resp.status} döndü | model={target_model}"
                )
                return False
            ok = self._consume_sse_or_json(
                resp,
                self._extract_ollama_delta,
                on_delta,
                max_duration_sec=float(settings.ollama_timeout_sec),
                on_tool_calls=on_tool_calls,
                on_reasoning=on_reasoning,
            )
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            gateway_logger.info(
                f"Ollama akışı tamamlandı | model={target_model} | ok={ok} | süre={elapsed_ms}ms"
            )
            return ok
        except Exception as exc:
            gateway_logger.warning(f"Ollama bağlantı hatası | model={target_model} | hata={exc}")
            return False
        finally:
            conn.close()

    def stream_from_pollinations_web(
        self,
        web_model: str,
        openai_messages: List[Dict[str, Any]],
        on_delta: Callable[[str], None],
        requested_model_id: str = "",
        response_format: Optional[Dict[str, Any]] = None,
        temperature: Optional[float] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        on_tool_calls: Optional[Callable[[List[Dict[str, Any]]], None]] = None,
        on_reasoning: Optional[Callable[[str], None]] = None,
        max_tokens: Optional[int] = None,
    ) -> bool:
        """
        Web AI sağlayıcısından (text.pollinations.ai/openai) gerçek zamanlı SSE akışı okur.
        HTTP Chunked Transfer-Encoding uyumlu 'resp.readline()' kullanarak parçalanmış
        JSON satırlarını kayıpsız birleştirir.
        """
        enriched_messages = MessageFormatterService.ensure_web_messages_have_system_and_json_directives(
            openai_messages,
            response_format=None if tools else response_format,
        )
        target_upstream = (
            "openai-fast"
            if web_model in ("openai", "gemini", "claude-hybridspace", "deepseek-r1", "openai-fast")
            else web_model
        )

        # Eğer mesaj geçmişinde 'tool' veya 'tool_calls' varsa (MCP 2. adım), Web AI köprüsünün
        # ham tool mesajlarını HTTP 400 ile reddetmemesi için doğrudan düzleştirilmiş mesajlarla başla
        has_tool_history = any(
            m.get("role") == "tool" or bool(m.get("tool_calls"))
            for m in enriched_messages
        )
        effective_messages = (
            self._flatten_tool_messages_for_web(enriched_messages)
            if has_tool_history
            else enriched_messages
        )

        if self._try_pollinations_openai_endpoint(
            target_upstream,
            effective_messages,
            on_delta,
            requested_model_id,
            response_format=response_format,
            temperature=temperature,
            tools=tools,
            tool_choice=tool_choice,
            on_tool_calls=on_tool_calls,
            on_reasoning=on_reasoning,
            max_tokens=max_tokens,
        ):
            return True

        if tools:
            return False

        return self._try_pollinations_root_endpoint(
            target_upstream,
            effective_messages,
            on_delta,
            requested_model_id,
            response_format=response_format,
        )

    def _try_pollinations_openai_endpoint(
        self,
        model_name: str,
        openai_messages: List[Dict[str, Any]],
        on_delta: Callable[[str], None],
        requested_model_id: str = "",
        response_format: Optional[Dict[str, Any]] = None,
        temperature: Optional[float] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        on_tool_calls: Optional[Callable[[List[Dict[str, Any]]], None]] = None,
        on_reasoning: Optional[Callable[[str], None]] = None,
        max_tokens: Optional[int] = None,
        _retry_count: int = 0,
    ) -> bool:
        """text.pollinations.ai/openai uç noktasından chunked-safe SSE veya JSON yanıtı okur."""
        t0 = time.perf_counter()
        effort = (
            "low"
            if bool(tools)
            else ("high" if requested_model_id == "deepseek-r1" else "low")
        )

        def _execute_single_pollinations_call(
            msgs: List[Dict[str, Any]],
            call_tools_cb: Optional[Callable[[List[Dict[str, Any]]], None]],
            call_delta_cb: Callable[[str], None],
            seed_offset: int = 0,
            retry_idx: int = 0,
        ) -> bool:
            context = create_verified_ssl_context()
            conn = http.client.HTTPSConnection(
                settings.pollinations_host,
                443,
                timeout=settings.pollinations_timeout_sec,
                context=context,
            )
            try:
                has_non_memory_tools = bool(
                    tools
                    and any(
                        str((t.get("function") or {}).get("name") or "")
                        not in (
                            "thinkport_memory_search",
                            "thinkport_memory_save",
                            "thinkport_conversation_recall",
                        )
                        for t in tools
                        if isinstance(t, dict)
                    )
                )
                effective_tool_choice = (
                    "required"
                    if (has_non_memory_tools and not tool_choice and retry_idx >= 1)
                    else tool_choice
                )
                effective_msgs = msgs
                if not tools and requested_model_id != "deepseek-r1" and msgs:
                    effective_msgs = [dict(m) for m in msgs]
                    last_m = dict(effective_msgs[-1])
                    no_draft_hint = (
                        "\n\n[CRITICAL STREAMING DIRECTIVE: Do NOT copy, list, or draft rows inside your internal "
                        "reasoning/thinking! Keep internal thinking under 1 short sentence and write all output directly in content.]"
                    )
                    if isinstance(last_m.get("content"), str) and "CRITICAL STREAMING DIRECTIVE" not in last_m["content"]:
                        last_m["content"] = last_m["content"] + no_draft_hint
                    elif isinstance(last_m.get("content"), list):
                        new_parts = [dict(p) for p in last_m["content"]]
                        for p in reversed(new_parts):
                            if p.get("type") == "text":
                                txt_val = str(p.get("text") or "")
                                if "CRITICAL STREAMING DIRECTIVE" not in txt_val:
                                    p["text"] = txt_val + no_draft_hint
                                break
                        last_m["content"] = new_parts
                    effective_msgs[-1] = last_m

                payload = self._build_stream_payload(
                    model_name,
                    effective_msgs,
                    reasoning_effort=effort,
                    response_format=response_format,
                    temperature=temperature,
                    tools=tools,
                    tool_choice=effective_tool_choice,
                    max_tokens=None,
                    seed=((int(time.time() * 1000) + seed_offset) % 900000) + 100000,
                    force_stream=True,
                )
                conn.request(
                    "POST",
                    "/openai",
                    body=payload,
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "text/event-stream, application/json",
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                    },
                )
                resp = conn.getresponse()
                if resp.status != 200:
                    err_body = resp.read().decode("utf-8", errors="replace")[:500]
                    gateway_logger.warning(
                        f"Web AI (/openai) HTTP {resp.status} döndü | model={requested_model_id or model_name} | detay={err_body}"
                    )
                    if resp.status in (402, 429, 500, 502, 503, 504) and retry_idx < 3:
                        m_wait = re.search(r"Retry after (\d+)s", err_body)
                        wait_sec = min(int(m_wait.group(1)) + 2, 48) if m_wait else (6 * (retry_idx + 1))
                        gateway_logger.info(
                            f"Web AI (/openai) geçici sınır/hata (HTTP {resp.status}, deneme={retry_idx + 1}/3), {wait_sec}s beklenip tekrar denenecek..."
                        )
                        conn.close()
                        time.sleep(wait_sec)
                        return _execute_single_pollinations_call(
                            msgs, call_tools_cb, call_delta_cb, seed_offset + 7, retry_idx=retry_idx + 1
                        )
                    return False
                stream_ok = self._consume_sse_or_json(
                    resp,
                    self._extract_web_delta,
                    call_delta_cb,
                    max_duration_sec=float(settings.web_gateway_timeout_sec),
                    on_tool_calls=call_tools_cb,
                    on_reasoning=on_reasoning if seed_offset == 0 else None,
                )
                if not stream_ok and retry_idx < 3:
                    gateway_logger.warning(
                        f"Web AI (/openai) akıştan içerik veya tool_calls çıkmadı (yalnızca reasoning/kesik akış, deneme={retry_idx + 1}/3), yeniden deneniyor..."
                    )
                    conn.close()
                    time.sleep(3 * (retry_idx + 1))
                    return _execute_single_pollinations_call(
                        msgs, call_tools_cb, call_delta_cb, seed_offset + 13, retry_idx=retry_idx + 1
                    )
                return stream_ok
            except Exception as exc:
                elapsed_err = int((time.perf_counter() - t0) * 1000)
                gateway_logger.error(
                    f"Web AI (/openai) bağlantı hatası | istem={requested_model_id} | upstream={model_name} | süre={elapsed_err}ms | hata={exc}"
                )
                if retry_idx < 2:
                    conn.close()
                    time.sleep(3 * (retry_idx + 1))
                    return _execute_single_pollinations_call(
                        msgs, call_tools_cb, call_delta_cb, seed_offset + 19, retry_idx=retry_idx + 1
                    )
                return False
            finally:
                conn.close()

        ok = _execute_single_pollinations_call(openai_messages, on_tool_calls, on_delta)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        gateway_logger.info(
            f"Web AI (/openai) akışı tamamlandı | istem={requested_model_id} | upstream={model_name} | ok={ok} | süre={elapsed_ms}ms"
        )
        return ok

    def _try_pollinations_root_endpoint(
        self,
        model_name: str,
        openai_messages: List[Dict[str, Any]],
        on_delta: Callable[[str], None],
        requested_model_id: str = "",
        response_format: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Yedek olarak text.pollinations.ai/ kök POST uç noktasından yanıt okur."""
        t0 = time.perf_counter()
        context = create_verified_ssl_context()
        conn = http.client.HTTPSConnection(
            settings.pollinations_host,
            443,
            timeout=settings.pollinations_timeout_sec,
            context=context,
        )
        try:
            is_json = MessageFormatterService.is_json_mode_requested(response_format)
            body_dict: Dict[str, Any] = {
                "messages": openai_messages,
                "model": model_name,
                "stream": False,
            }
            if is_json:
                body_dict["jsonMode"] = True
                body_dict["response_format"] = {"type": "json_object"}
            payload = json.dumps(body_dict).encode("utf-8")
            conn.request(
                "POST",
                "/",
                body=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                },
            )
            resp = conn.getresponse()
            if resp.status != 200:
                gateway_logger.warning(
                    f"Web AI (root /) HTTP {resp.status} döndü | istem={requested_model_id}"
                )
                return False
            raw_body = resp.read().decode("utf-8", errors="replace").strip()
            if not raw_body:
                return False
            on_delta(raw_body)
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            gateway_logger.info(
                f"Web AI (root /) yanıtı alındı | istem={requested_model_id} | süre={elapsed_ms}ms"
            )
            return True
        except Exception as exc:
            gateway_logger.error(
                f"Web AI (root /) hatası | istem={requested_model_id} | hata={exc}"
            )
            return False
        finally:
            conn.close()

    def translate_prompt_via_ollama(
        self,
        prompt: str,
        translator_model: str,
    ) -> Optional[str]:
        """Yerel Ollama modelini kullanarak görsel istemini kısa İngilizce metne çevirir."""
        conn = http.client.HTTPConnection(settings.ollama_host, settings.ollama_port, timeout=4)
        try:
            system_instruction = (
                "Translate the user's image description into a concise, vivid English text-to-image prompt "
                "(max 35 words). Output ONLY the English prompt, no quotes, no explanation."
            )
            payload = json.dumps(
                {
                    "model": translator_model,
                    "messages": [
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": prompt},
                    ],
                    "stream": False,
                    "options": {"num_predict": 60, "temperature": 0.2},
                }
            ).encode("utf-8")
            conn.request(
                "POST",
                "/v1/chat/completions",
                body=payload,
                headers={"Content-Type": "application/json"},
            )
            resp = conn.getresponse()
            if resp.status != 200:
                return None
            data = json.loads(resp.read().decode("utf-8"))
            translated = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
                .strip()
                .strip("\"'")
            )
            return translated if len(translated) > 3 else None
        except Exception:
            return None
        finally:
            conn.close()

    @staticmethod
    def _flatten_tool_messages_for_web(
        messages: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Bazı Web AI uç noktaları geçmişte `role: 'tool'` veya `tool_calls` dizisi bulunduğunda
        HTTP 400/402 döndürebilir. Bu yardımcı metot, geçmişteki araç çağrısı ve araç yanıtı
        mesajlarını standart `assistant` ve `user` metin mesajlarına dönüştürür.
        """
        flattened: List[Dict[str, Any]] = []
        for m in messages:
            role = m.get("role", "user")
            if role == "assistant" and m.get("tool_calls"):
                tc_descriptions: List[str] = []
                for tc in m.get("tool_calls") or []:
                    fn = tc.get("function", {}) if isinstance(tc, dict) else {}
                    fn_name = fn.get("name", "tool")
                    fn_args = fn.get("arguments", "{}")
                    tc_descriptions.append(f"[Çağrılan Araç: {fn_name}({fn_args})]")
                content_str = str(m.get("content") or "").strip()
                combined = "\n".join(p for p in [content_str] + tc_descriptions if p)
                flattened.append({"role": "assistant", "content": combined or "[Araç çağrısı yapıldı]"})
            elif role == "tool":
                tool_name = m.get("name") or "tool"
                tool_content = str(m.get("content") or "")
                flattened.append(
                    {
                        "role": "user",
                        "content": f"[ARAÇ ÇALIŞTIRMA SONUCU ({tool_name})]:\n{tool_content}",
                    }
                )
            else:
                clean_copy = {
                    k: v
                    for k, v in m.items()
                    if k not in ("tool_calls", "tool_call_id", "name")
                }
                flattened.append(clean_copy)
        return flattened

    @staticmethod
    def _build_stream_payload(
        model: str,
        messages: List[Dict[str, Any]],
        reasoning_effort: Optional[str] = None,
        response_format: Optional[Dict[str, Any]] = None,
        temperature: Optional[float] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        max_tokens: Optional[int] = None,
        seed: Optional[int] = None,
        force_stream: bool = False,
    ) -> bytes:
        """OpenAI uyumlu istek gövdesini JSON bytes olarak hazırlar."""
        body: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True if force_stream else (False if tools else True),
        }
        if tools:
            body["tools"] = tools
            if tool_choice:
                body["tool_choice"] = tool_choice
        if reasoning_effort:
            body["reasoning_effort"] = reasoning_effort
        if temperature is not None:
            body["temperature"] = temperature
        if seed is not None:
            body["seed"] = seed
        if max_tokens is not None and max_tokens > 0:
            body["max_tokens"] = min(max(int(max_tokens), 8192) if tools else int(max_tokens), 16384)
        elif tools and not force_stream:
            body["max_tokens"] = 16384
        if MessageFormatterService.is_json_mode_requested(response_format):
            body["response_format"] = {"type": "json_object"}
        return json.dumps(body).encode("utf-8")

    @classmethod
    def _consume_sse_or_json(
        cls,
        resp: http.client.HTTPResponse,
        delta_extractor: Callable[[Dict[str, Any]], str],
        on_delta: Callable[[str], None],
        max_duration_sec: float = 90.0,
        on_tool_calls: Optional[Callable[[List[Dict[str, Any]]], None]] = None,
        on_reasoning: Optional[Callable[[str], None]] = None,
    ) -> bool:
        """
        HTTP yanıtını 'resp.readline()' üzerinden (HTTP chunked transfer encoding
        kod çözümü uygulanmış şekilde) satır satır okur ve her delta parçasını iletir.
        Modelin ürettiği tüm düşünce (reasoning / reasoning_content / thinking) parçalarını
        hiçbir karakter kaybetmeden on_reasoning geri çağırımına aktarır.
        Model tool_calls üretmişse on_tool_calls geri çağırımını tetikler.
        Üst zaman aşımı (`max_duration_sec`) aşıldığında akışı sonlandırır.
        """
        t_start = time.perf_counter()
        received_content = False
        received_reasoning = False
        non_sse_lines: List[str] = []
        reasoning_buffer: List[str] = []
        streamed_tool_calls_by_idx: Dict[int, Dict[str, Any]] = {}

        while True:
            if (time.perf_counter() - t_start) > max_duration_sec:
                gateway_logger.warning(
                    f"SSE okuma üst zaman aşımı ({max_duration_sec}s) aşıldı, akış kesiliyor."
                )
                break
            # ÖNEMLİ: resp.fp.readline() yerine resp.readline() kullanılmalıdır.
            # resp.fp.readline() ham soketi okuduğu için HTTP chunked hex başlıklarını (ad, d1 vb.)
            # JSON satırlarının ortasına karıştırıp yanıtı bozar!
            raw_line = resp.readline()
            if not raw_line:
                break
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            if line.startswith("data:"):
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                    choice0 = chunk.get("choices", [{}])[0] if chunk.get("choices") else {}
                    delta_obj = choice0.get("delta") or choice0.get("message") or {}

                    reasoning_piece = (
                        delta_obj.get("reasoning")
                        or delta_obj.get("reasoning_content")
                        or delta_obj.get("thinking")
                    )
                    if reasoning_piece:
                        r_str = str(reasoning_piece)
                        reasoning_buffer.append(r_str)
                        received_reasoning = True
                        if on_reasoning:
                            on_reasoning(r_str)

                    tc_list = delta_obj.get("tool_calls")
                    if tc_list and isinstance(tc_list, list):
                        for tc_idx, tc_item in enumerate(tc_list):
                            if not isinstance(tc_item, dict):
                                continue
                            idx_key = int(tc_item.get("index", tc_idx))
                            fn_in = tc_item.get("function") or {}
                            existing_tc = streamed_tool_calls_by_idx.get(idx_key)
                            if (
                                not existing_tc
                                and not fn_in.get("name")
                                and streamed_tool_calls_by_idx
                            ):
                                last_key = max(streamed_tool_calls_by_idx.keys())
                                existing_tc = streamed_tool_calls_by_idx[last_key]
                            if not existing_tc:
                                streamed_tool_calls_by_idx[idx_key] = {
                                    "id": tc_item.get("id") or f"call_{idx_key}",
                                    "type": tc_item.get("type") or "function",
                                    "function": {
                                        "name": str(fn_in.get("name") or ""),
                                        "arguments": str(fn_in.get("arguments") or ""),
                                    },
                                }
                            else:
                                if tc_item.get("id") and not existing_tc.get("id"):
                                    existing_tc["id"] = tc_item["id"]
                                if fn_in.get("name") and not existing_tc["function"].get("name"):
                                    existing_tc["function"]["name"] += str(fn_in["name"])
                                if fn_in.get("arguments"):
                                    existing_tc["function"]["arguments"] += str(fn_in["arguments"])
                        received_content = True

                    content = delta_extractor(chunk)
                    if content:
                        received_content = True
                        on_delta(content)
                except Exception:
                    continue
            else:
                non_sse_lines.append(line)

        if streamed_tool_calls_by_idx and on_tool_calls:
            ordered_tcs = [
                streamed_tool_calls_by_idx[k]
                for k in sorted(streamed_tool_calls_by_idx.keys())
            ]
            on_tool_calls(ordered_tcs)

        if received_content:
            return True

        if non_sse_lines:
            joined = "\n".join(non_sse_lines).strip()
            try:
                parsed = json.loads(joined)
                choice = parsed.get("choices", [{}])[0] if parsed.get("choices") else {}
                msg_obj = choice.get("message") or choice.get("delta") or {}
                got_content_or_tools = False

                msg_reasoning = (
                    msg_obj.get("reasoning")
                    or msg_obj.get("reasoning_content")
                    or msg_obj.get("thinking")
                )
                if msg_reasoning and on_reasoning:
                    on_reasoning(str(msg_reasoning))

                msg_content = msg_obj.get("content") or delta_extractor(parsed)
                if msg_content:
                    on_delta(str(msg_content))
                    got_content_or_tools = True

                tool_calls = (
                    choice.get("message", {}).get("tool_calls")
                    or choice.get("delta", {}).get("tool_calls")
                )
                if tool_calls and on_tool_calls:
                    on_tool_calls(tool_calls)
                    got_content_or_tools = True

                if got_content_or_tools:
                    return True
            except Exception:
                if len(joined) > 0 and not joined.startswith("<"):
                    on_delta(joined)
                    return True

        # Eğer yalnızca reasoning alındıysa ama asıl yanıt (content veya tool_calls) hiç gelmediyse
        # False döndür ki üst katman yeniden denesin veya yedek (fallback) uç noktadan tam yanıtı çeksin.
        return False

    @staticmethod
    def _extract_ollama_delta(chunk: Dict[str, Any]) -> str:
        """
        Ollama SSE parçasından yalnızca asıl yanıt (content) metnini çıkarır.
        Düşünce zinciri (reasoning_content) yalnızca content boşsa _consume_sse_or_json yedek tamponundan kullanılır.
        """
        delta = chunk.get("choices", [{}])[0].get("delta", {})
        return delta.get("content") or ""

    @staticmethod
    def _extract_web_delta(chunk: Dict[str, Any]) -> str:
        """Web AI SSE parçasından yalnızca asıl yanıt (content) metnini çıkarır."""
        delta = chunk.get("choices", [{}])[0].get("delta", {})
        return delta.get("content") or ""
