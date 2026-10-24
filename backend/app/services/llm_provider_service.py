import http.client
import json
import time
from typing import Any, Callable, Dict, List, Optional
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
    ) -> bool:
        """
        Web AI sağlayıcısından (text.pollinations.ai/openai) gerçek zamanlı SSE akışı okur.
        HTTP Chunked Transfer-Encoding uyumlu 'resp.readline()' kullanarak parçalanmış
        JSON satırlarını kayıpsız birleştirir.
        """
        enriched_messages = self._inject_persona_if_needed(openai_messages, requested_model_id)
        enriched_messages = MessageFormatterService.ensure_web_messages_have_system_and_json_directives(
            enriched_messages,
            response_format=response_format,
        )
        target_upstream = (
            "openai-fast"
            if web_model in ("openai", "gemini", "claude-hybridspace", "deepseek-r1", "openai-fast")
            else web_model
        )

        if self._try_pollinations_openai_endpoint(
            target_upstream,
            enriched_messages,
            on_delta,
            requested_model_id,
            response_format=response_format,
            temperature=temperature,
            tools=tools,
            tool_choice=tool_choice,
            on_tool_calls=on_tool_calls,
        ):
            return True

        return self._try_pollinations_root_endpoint(
            target_upstream,
            enriched_messages,
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
    ) -> bool:
        """text.pollinations.ai/openai uç noktasından chunked-safe SSE veya JSON yanıtı okur."""
        t0 = time.perf_counter()
        context = create_verified_ssl_context()
        conn = http.client.HTTPSConnection(
            settings.pollinations_host,
            443,
            timeout=settings.pollinations_timeout_sec,
            context=context,
        )
        try:
            payload = self._build_stream_payload(
                model_name,
                openai_messages,
                reasoning_effort="high" if requested_model_id == "deepseek-r1" else "low",
                response_format=response_format,
                temperature=temperature,
                tools=tools,
                tool_choice=tool_choice,
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
                gateway_logger.warning(
                    f"Web AI (/openai) HTTP {resp.status} döndü | model={requested_model_id or model_name}"
                )
                return False
            ok = self._consume_sse_or_json(
                resp,
                self._extract_web_delta,
                on_delta,
                max_duration_sec=float(settings.web_gateway_timeout_sec),
                on_tool_calls=on_tool_calls,
            )
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            gateway_logger.info(
                f"Web AI (/openai) akışı tamamlandı | istem={requested_model_id} | upstream={model_name} | ok={ok} | süre={elapsed_ms}ms"
            )
            return ok
        except Exception as exc:
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            gateway_logger.error(
                f"Web AI (/openai) bağlantı hatası | istem={requested_model_id} | upstream={model_name} | süre={elapsed_ms}ms | hata={exc}"
            )
            return False
        finally:
            conn.close()

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
    def _inject_persona_if_needed(
        messages: List[Dict[str, Any]],
        requested_model_id: str,
    ) -> List[Dict[str, Any]]:
        """
        Seçilen Web Gateway modeline göre uygun sistem yönergesini ekler,
        böylece yanıtlar akıcı, doğal ve seçilen model kimliğiyle tutarlı olur.
        """
        persona_map = {
            "gpt-4o": "Sen OpenAI GPT-4o modelisin. Kullanıcının dilinde (Türkçe ise akıcı, doğru ve anlaşılır Türkçe ile) doğrudan ve eksiksiz yanıt ver.",
            "claude-3-5-sonnet": "Sen Anthropic Claude 3.5 Sonnet modelisin. Analitik, özenli, doğal ve akıcı bir dille doğrudan yanıt ver.",
            "deepseek-r1": "Sen DeepSeek R1 modelisin. Mantıksal ve yapılandırılmış biçimde, kullanıcının dilinde net yanıt ver.",
            "gemini-2.5-pro": "Sen Google Gemini 2.5 Pro modelisin. Kullanıcının dilinde (Türkçe ise akıcı ve özenli Türkçe ile) kapsamlı, net ve doğrudan yanıt ver.",
        }
        persona = persona_map.get(requested_model_id)
        if not persona:
            return messages

        has_system = any(m.get("role") == "system" for m in messages)
        if has_system:
            return messages
        return [{"role": "system", "content": persona}] + list(messages)

    @staticmethod
    def _build_stream_payload(
        model: str,
        messages: List[Dict[str, Any]],
        reasoning_effort: Optional[str] = None,
        response_format: Optional[Dict[str, Any]] = None,
        temperature: Optional[float] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
    ) -> bytes:
        """OpenAI uyumlu istek gövdesini JSON bytes olarak hazırlar. tools varsa senkron JSON (stream: False) modunda çalışır."""
        body: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False if tools else True,
        }
        if tools:
            body["tools"] = tools
            if tool_choice:
                body["tool_choice"] = tool_choice
        if reasoning_effort:
            body["reasoning_effort"] = reasoning_effort
        if temperature is not None:
            body["temperature"] = temperature
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
    ) -> bool:
        """
        HTTP yanıtını 'resp.readline()' üzerinden (HTTP chunked transfer encoding
        kod çözümü uygulanmış şekilde) satır satır okur ve her delta parçasını iletir.
        Eğer model yalnızca reasoning alanı döndürürse onu da yedek olarak yakalar.
        Model tool_calls üretmişse on_tool_calls geri çağırımını tetikler.
        Üst zaman aşımı (`max_duration_sec`) aşıldığında akışı sonlandırır.
        """
        t_start = time.perf_counter()
        received_content = False
        non_sse_lines: List[str] = []
        reasoning_buffer: List[str] = []

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
                    delta_obj = chunk.get("choices", [{}])[0].get("delta", {})
                    tc = delta_obj.get("tool_calls")
                    if tc and on_tool_calls:
                        on_tool_calls(tc)
                        received_content = True
                    content = delta_extractor(chunk)
                    if content:
                        received_content = True
                        on_delta(content)
                    else:
                        reasoning_piece = delta_obj.get("reasoning") or delta_obj.get("reasoning_content")
                        if reasoning_piece:
                            reasoning_buffer.append(reasoning_piece)
                except Exception:
                    continue
            else:
                non_sse_lines.append(line)

        if received_content:
            return True

        if reasoning_buffer:
            on_delta("".join(reasoning_buffer))
            return True

        if non_sse_lines:
            joined = "\n".join(non_sse_lines).strip()
            try:
                parsed = json.loads(joined)
                choice = parsed.get("choices", [{}])[0]
                tool_calls = (
                    choice.get("message", {}).get("tool_calls")
                    or choice.get("delta", {}).get("tool_calls")
                )
                if tool_calls and on_tool_calls:
                    on_tool_calls(tool_calls)
                    return True
                msg_content = (
                    choice.get("message", {}).get("content")
                    or delta_extractor(parsed)
                )
                if msg_content:
                    on_delta(msg_content)
                    return True
            except Exception:
                if len(joined) > 0 and not joined.startswith("<"):
                    on_delta(joined)
                    return True

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
