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
        enriched_messages = self._inject_persona_if_needed(
            openai_messages,
            requested_model_id,
        )
        enriched_messages = MessageFormatterService.ensure_web_messages_have_system_and_json_directives(
            enriched_messages,
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
                payload = self._build_stream_payload(
                    model_name,
                    msgs,
                    reasoning_effort=effort,
                    response_format=response_format,
                    temperature=temperature,
                    tools=tools,
                    tool_choice=tool_choice,
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
                    if resp.status in (402, 429) and retry_idx == 0:
                        m_wait = re.search(r"Retry after (\d+)s", err_body)
                        wait_sec = min(int(m_wait.group(1)) + 2, 48) if m_wait else 15
                        gateway_logger.info(
                            f"Web AI (/openai) hız sınırına (HTTP {resp.status}) takıldı, {wait_sec}s beklenip tekrar denenecek..."
                        )
                        conn.close()
                        time.sleep(wait_sec)
                        return _execute_single_pollinations_call(
                            msgs, call_tools_cb, call_delta_cb, seed_offset + 7, retry_idx=1
                        )
                    return False
                return self._consume_sse_or_json(
                    resp,
                    self._extract_web_delta,
                    call_delta_cb,
                    max_duration_sec=float(settings.web_gateway_timeout_sec),
                    on_tool_calls=call_tools_cb,
                    on_reasoning=on_reasoning if seed_offset == 0 else None,
                )
            except Exception as exc:
                elapsed_err = int((time.perf_counter() - t0) * 1000)
                gateway_logger.error(
                    f"Web AI (/openai) bağlantı hatası | istem={requested_model_id} | upstream={model_name} | süre={elapsed_err}ms | hata={exc}"
                )
                return False
            finally:
                conn.close()

        if not tools or not on_tool_calls:
            ok = _execute_single_pollinations_call(openai_messages, on_tool_calls, on_delta)
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            gateway_logger.info(
                f"Web AI (/openai) akışı tamamlandı | istem={requested_model_id} | upstream={model_name} | ok={ok} | süre={elapsed_ms}ms"
            )
            return ok

        first_chunk_tcs: List[Dict[str, Any]] = []
        ok = _execute_single_pollinations_call(
            openai_messages,
            lambda tcs: first_chunk_tcs.extend(tcs),
            on_delta,
        )
        if not ok:
            return False

        if not first_chunk_tcs:
            return True

        primary_tc = first_chunk_tcs[0]
        fn_obj = primary_tc.get("function") or {}
        tc_name = str(fn_obj.get("name") or "")
        raw_args = str(fn_obj.get("arguments") or "")
        expected_doc_type = self._infer_expected_doc_type(openai_messages)

        parsed_obj, is_complete, array_key, last_cut_name = self._parse_or_salvage_tool_args(
            raw_args, fallback_doc_type=expected_doc_type
        )
        if parsed_obj is None or not array_key:
            if parsed_obj is not None:
                primary_tc["function"]["arguments"] = json.dumps(parsed_obj, ensure_ascii=False)
            on_tool_calls(first_chunk_tcs)
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            gateway_logger.info(
                f"Web AI (/openai) tek parçada tool_calls tamamlandı | araç={tc_name} | süre={elapsed_ms}ms"
            )
            return True

        doc_msg_idx: int = -1
        doc_pre: str = ""
        doc_header: str = ""
        doc_text: str = ""
        doc_footer: str = ""
        doc_post: str = ""
        for m_idx in range(len(openai_messages) - 1, -1, -1):
            if openai_messages[m_idx].get("role") == "user":
                u_content = str(openai_messages[m_idx].get("content") or "")
                m_doc = re.search(
                    r"(---\s*\[Ekli Dosya:[^\]]+\]\s*---\r?\n)([\s\S]+?)(\r?\n---\s*\[Dosya Sonu[^\]]*\]\s*---)",
                    u_content,
                )
                if m_doc:
                    doc_msg_idx = m_idx
                    doc_pre = u_content[: m_doc.start()]
                    doc_header = m_doc.group(1)
                    doc_text = m_doc.group(2)
                    doc_footer = m_doc.group(3)
                    doc_post = u_content[m_doc.end() :]
                    break

        initial_items = parsed_obj.get(array_key) or []
        last_valid_item: Optional[Dict[str, Any]] = (
            initial_items[-1] if initial_items and isinstance(initial_items[-1], dict) else None
        )
        doc_offset = (
            self._find_resume_offset_in_doc(doc_text, 0, last_cut_name, last_valid_item)
            if len(doc_text) > 5000
            else len(doc_text)
        )

        if is_complete and (len(doc_text) <= 5000 or (len(doc_text) - doc_offset) < 2200):
            primary_tc["function"]["arguments"] = json.dumps(parsed_obj, ensure_ascii=False)
            on_tool_calls(first_chunk_tcs)
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            gateway_logger.info(
                f"Web AI (/openai) tek parçada tool_calls tamamlandı | araç={tc_name} | süre={elapsed_ms}ms"
            )
            return True

        merged_doc: Dict[str, Any] = parsed_obj
        all_items: List[Dict[str, Any]] = []
        seen_titles: List[str] = []

        def _extract_item_key(item_dict: Dict[str, Any]) -> str:
            return str(
                item_dict.get("adi")
                or item_dict.get("kampanyaAdi")
                or item_dict.get("baslik")
                or item_dict.get("name")
                or item_dict.get("tedarikciUrunKodu")
                or item_dict.get("urunKodu")
                or item_dict.get("stokKodu")
                or item_dict.get("kod")
                or ""
            ).strip()

        def _collect_chunk_items(items_list: List[Dict[str, Any]]) -> Tuple[int, Optional[Dict[str, Any]]]:
            added = 0
            last_it: Optional[Dict[str, Any]] = None
            for it in items_list:
                if not isinstance(it, dict):
                    continue
                last_it = it
                nm = _extract_item_key(it)
                if nm and nm not in seen_titles:
                    seen_titles.append(nm)
                if array_key == "kampanyalar":
                    rules = it.get("kurallar") or it.get("rules")
                    if isinstance(rules, list) and len(rules) == 0:
                        continue
                if nm and any(
                    _extract_item_key(x).lower() == nm.lower()
                    and (
                        array_key != "kalemler"
                        or x.get("fiyat") == it.get("fiyat")
                    )
                    for x in all_items
                ):
                    continue
                all_items.append(it)
                added += 1
            return added, last_it

        _collect_chunk_items(initial_items)
        gateway_logger.info(
            f"Web AI (/openai) çok parçalı tool_calls birleştirme | Parça 1: {len(all_items)} geçerli kayıt alındı | kesilen={last_cut_name} | doc_offset={doc_offset}/{len(doc_text)}"
        )

        for cont_idx in range(1, 4):
            if (time.perf_counter() - t0) > 120.0:
                break
            done_list_str = ", ".join(f"'{n}'" for n in seen_titles)
            if doc_msg_idx != -1 and len(doc_text) > 5000 and doc_offset > 0:
                sliced_doc = (
                    doc_text[:850]
                    + "\n\n... [ÖNCEKİ SAYFALAR İŞLENDİ - KALINAN BÖLÜMDEN DEVAMI]: ...\n\n"
                    + doc_text[doc_offset:]
                )
                sliced_user_content = (
                    f"{doc_pre}"
                    f"[ÖNEMLİ DEVAM YÖNERGESİ: Önceki adımda şu kayıtlar işlendi: {done_list_str}. "
                    f"Önceki kayıtları tekrar etmeden, aşağıda kalınan yerden devam eden belge metnindeki TÜM geçerli kayıt ve tabloları (son sayfaya kadar eksiksiz) '{tc_name}' (documentType: '{expected_doc_type}') aracıyla çıkar.]\n\n"
                    f"{doc_header}{sliced_doc}{doc_footer}{doc_post}"
                )
                cont_messages = list(openai_messages)
                cont_messages[doc_msg_idx] = {"role": "user", "content": sliced_user_content}
            else:
                if last_cut_name:
                    start_clause = f"dokümanda yarım kalan '{last_cut_name}' kaydından başlayarak "
                elif seen_titles:
                    start_clause = f"dokümanda '{seen_titles[-1]}' kaydından hemen sonraki satır/bölümden başlayarak "
                else:
                    start_clause = "dokümanda kaldığın yerden devam ederek "

                cont_prompt = (
                    f"Önceki adımda çıktı token sınırından dolayı yalnızca şu {len(seen_titles)} kayıt işlenebildi: [{done_list_str}].\n"
                    f"Şimdi önceki kayıtları ASLA tekrar etmeden, {start_clause}"
                    f"dokümanda henüz çıkarılmamış GERİ KALAN tüm geçerli kayıt ve tabloları (son sayfaya kadar eksiksiz) '{tc_name}' (documentType: '{expected_doc_type}') aracıyla çıkar."
                )
                cont_messages = list(openai_messages) + [{"role": "user", "content": cont_prompt}]

            cont_tcs: List[Dict[str, Any]] = []
            cont_ok = _execute_single_pollinations_call(
                cont_messages,
                lambda tcs: cont_tcs.extend(tcs),
                lambda _: None,
                seed_offset=cont_idx * 101,
            )
            if not cont_ok or not cont_tcs:
                break
            cont_raw_args = str((cont_tcs[0].get("function") or {}).get("arguments") or "")
            cont_parsed, cont_complete, _, last_cut_name = self._parse_or_salvage_tool_args(
                cont_raw_args, fallback_doc_type=expected_doc_type
            )
            if not cont_parsed:
                break
            for hk in ("baslangicTarihi", "bitisTarihi", "hakedisSonTarihi", "aciklama", "adi", "cariUnvan", "kdvOrani", "kdvDahilMi"):
                if hk in cont_parsed and cont_parsed[hk] is not None and hk not in merged_doc:
                    merged_doc[hk] = cont_parsed[hk]
            chunk_items = cont_parsed.get(array_key) or []
            added_count, chunk_last_it = _collect_chunk_items(chunk_items)
            if len(doc_text) > 5000:
                new_offset = self._find_resume_offset_in_doc(doc_text, doc_offset, last_cut_name, chunk_last_it)
            else:
                new_offset = doc_offset
            gateway_logger.info(
                f"Web AI (/openai) çok parçalı tool_calls birleştirme | Parça {cont_idx + 1}: +{added_count} yeni kayıt (toplam={len(all_items)}) | tam={cont_complete} | kesilen={last_cut_name} | doc_offset={new_offset}/{len(doc_text)}"
            )
            if len(doc_text) > 5000:
                if new_offset <= doc_offset and added_count == 0:
                    break
                doc_offset = new_offset
                if (len(doc_text) - doc_offset) < 2200 or (cont_complete and not last_cut_name):
                    break
            else:
                if cont_complete or not last_cut_name or added_count == 0:
                    break

        if array_key == "kampanyalar":
            for idx_k, k_obj in enumerate(all_items, 1):
                if isinstance(k_obj, dict):
                    k_obj["kodu"] = f"KMP-{idx_k:02d}"
        merged_doc[array_key] = all_items
        primary_tc["function"]["arguments"] = json.dumps(merged_doc, ensure_ascii=False)
        on_tool_calls([primary_tc])
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        gateway_logger.info(
            f"Web AI (/openai) çok parçalı tool_calls tamamlandı | araç={tc_name} | toplam_kayıt={len(all_items)} | süre={elapsed_ms}ms"
        )
        return True

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
        if any(m.get("role") == "system" for m in messages):
            return messages

        persona_map = {
            "gpt-4o": "Sen OpenAI GPT-4o modelisin. Kullanıcının dilinde (Türkçe ise akıcı, doğru ve anlaşılır Türkçe ile) doğrudan ve eksiksiz yanıt ver.",
            "claude-3-5-sonnet": "Sen Anthropic Claude 3.5 Sonnet modelisin. Analitik, özenli, doğal ve akıcı bir dille doğrudan yanıt ver.",
            "deepseek-r1": "Sen DeepSeek R1 modelisin. Mantıksal ve yapılandırılmış biçimde, kullanıcının dilinde net yanıt ver.",
            "gemini-2.5-pro": "Sen Google Gemini 2.5 Pro modelisin. Kullanıcının dilinde (Türkçe ise akıcı ve özenli Türkçe ile) kapsamlı, net ve doğrudan yanıt ver.",
        }
        persona = persona_map.get(
            requested_model_id,
            f"Sen {requested_model_id or 'yapay zeka'} modelisin. Kullanıcının dilinde doğrudan ve eksiksiz yanıt ver.",
        )
        return [{"role": "system", "content": persona}] + list(messages)

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
                        "content": f"[ARAÇ ÇALIŞTIRMA SONUCU ({tool_name})]:\n{tool_content}\n\nYukarıdaki araç sonucunu ve önceki belge verilerini kullanarak asıl görevi tamamla ve gerekli hedef aracı (örn: erp_create_document) çağır.",
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

    @classmethod
    def _infer_expected_doc_type(cls, messages: List[Dict[str, Any]]) -> str:
        """Mesaj geçmişindeki sistem istemi veya hedef şema bildiriminden beklenen belge türünü çözümler."""
        for m in messages:
            content = str(m.get("content") or "")
            m_schema = re.search(
                r"\[HEDEF BELGE RESMİ JSON ŞEMASI\s*\(\s*([A-Za-z0-9_]+)",
                content,
            )
            if m_schema:
                return m_schema.group(1).strip()
            m_doc = re.search(
                r'documentType\s*["\']?\s*:\s*["\'](BshFiyatFarki|FiyatListesi|KampanyaBelgesi|Siparis|Fatura|Irsaliye|CariKart|UrunKarti)["\']',
                content,
            )
            if m_doc:
                return m_doc.group(1).strip()
        return "KampanyaBelgesi"

    @classmethod
    def _find_resume_offset_in_doc(
        cls,
        doc_text: str,
        current_offset: int,
        last_cut_name: Optional[str],
        last_item: Optional[Dict[str, Any]],
    ) -> int:
        """
        Çok sayfalı bir belgede bir önceki parçanın kaldığı karakter konumunu (offset) hesaplar.
        Öncelikle yarıda kesilen başlık/kod adını (last_cut_name) arar; yoksa son tamamlanan
        kaydın ürün kodunu, alfanümerik model kodlarını (kuralAlani == 1) veya başlığını baz alır.
        """
        doc_norm = doc_text.replace("’", "'").replace("‘", "'")
        if last_cut_name:
            cut_norm = last_cut_name.strip().replace("’", "'").replace("‘", "'")
            pos = doc_norm.find(cut_norm, current_offset)
            if pos != -1 and pos > current_offset:
                return max(current_offset + 100, pos - 60)

        best_pos = current_offset
        if last_item:
            rules = last_item.get("kurallar") or last_item.get("rules") or []
            for r in reversed(rules):
                if not isinstance(r, dict):
                    continue
                alan = r.get("kuralAlani") or r.get("field") or 1
                try:
                    if int(alan) != 1:
                        continue
                except Exception:
                    continue
                val = str(r.get("kuralDegeri") or "")
                tokens = [
                    t.strip()
                    for t in val.split(",")
                    if re.match(r"^[A-Z0-9]{5,}$", t.strip())
                ]
                for tok in reversed(tokens):
                    pos = doc_text.find(tok, current_offset, current_offset + 8500)
                    if pos == -1 and current_offset == 0:
                        pos = doc_text.find(tok, current_offset)
                    if pos != -1:
                        best_pos = max(best_pos, pos + len(tok))
                        break
                if best_pos > current_offset:
                    break

            if best_pos == current_offset:
                code_val = str(
                    last_item.get("tedarikciUrunKodu")
                    or last_item.get("urunKodu")
                    or last_item.get("stokKodu")
                    or last_item.get("kod")
                    or ""
                ).strip()
                if code_val:
                    pos = doc_norm.find(code_val, current_offset, current_offset + 12000)
                    if pos == -1:
                        pos = doc_norm.find(code_val, current_offset)
                    if pos != -1:
                        best_pos = max(best_pos, pos + len(code_val))

            if best_pos == current_offset:
                nm = (
                    str(last_item.get("adi") or last_item.get("kampanyaAdi") or "")
                    .strip()
                    .replace("’", "'")
                    .replace("‘", "'")
                )
                if nm:
                    pos = doc_norm.find(nm, current_offset, current_offset + 8500)
                    if pos == -1 and current_offset == 0:
                        pos = doc_norm.find(nm, current_offset)
                    if pos != -1:
                        best_pos = max(best_pos, pos + len(nm) + 350)
        return best_pos

    @classmethod
    def _repair_llm_json_glitches(cls, s: str) -> str:
        """LLM tarafından üretilen tool_calls JSON dizgesindeki yaygın sözdizimi hatalarını onarır."""
        s = re.sub(r'([,{]\s*"[^"]+")\s*,\s*(?=")', r"\1:null,", s)
        s = re.sub(r'(:\s*(?:-?\d+(?:\.\d+)?|true|false|null))"\s*(?=[,}\]])', r"\1", s)
        s = re.sub(r'("[^"\\]*(?:\\.[^"\\]*)*")\s*\]\s*(?=,\s*"[^"]+"\s*:)', r"\1", s)
        s = re.sub(
            r'\}\s*\]\s*,\s*(?="(?:kodu|kod|adi|ad|kampanyaKodu|kampanyaAdi|tedarikciUrunKodu|urunKodu)"\s*:)',
            "}]},{",
            s,
        )
        return s

    @classmethod
    def _normalize_document_header(
        cls,
        header_obj: Dict[str, Any],
        cleaned_raw: str,
        arr_key: Optional[str],
        items: List[Dict[str, Any]],
        fallback_doc_type: str,
    ) -> Dict[str, Any]:
        """Kurtarılan veya ayrıştırılan üst bilgi nesnesindeki eksik başlık alanlarını ve documentType değerini tamamlar."""
        for str_key in ("documentType", "aciklama", "adi", "baslangicTarihi", "bitisTarihi", "hakedisSonTarihi", "cariUnvan"):
            if not header_obj.get(str_key):
                m_str = re.search(rf'"{str_key}"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', cleaned_raw)
                if m_str:
                    header_obj[str_key] = m_str.group(1)

        for bool_key in ("isDraft", "kdvDahilMi"):
            if bool_key not in header_obj:
                m_bool = re.search(rf'"{bool_key}"\s*:\s*(true|false)', cleaned_raw, re.IGNORECASE)
                if m_bool:
                    header_obj[bool_key] = m_bool.group(1).lower() == "true"

        if "kdvOrani" not in header_obj:
            m_num = re.search(r'"kdvOrani"\s*:\s*(-?\d+(?:\.\d+)?)', cleaned_raw)
            if m_num:
                try:
                    num_val = float(m_num.group(1))
                    header_obj["kdvOrani"] = int(num_val) if num_val.is_integer() else num_val
                except Exception:
                    pass

        header_obj.setdefault("isDraft", True)

        has_supplier_code = arr_key == "kalemler" and any(
            isinstance(x, dict) and "tedarikciUrunKodu" in x for x in items
        )
        effective_fallback = (
            fallback_doc_type
            if fallback_doc_type and fallback_doc_type != "KampanyaBelgesi"
            else ("BshFiyatFarki" if has_supplier_code else "KampanyaBelgesi")
        )

        cur_dt = str(header_obj.get("documentType") or "").strip()
        if not cur_dt or (cur_dt == "KampanyaBelgesi" and effective_fallback != "KampanyaBelgesi"):
            header_obj["documentType"] = effective_fallback

        return header_obj

    @classmethod
    def _parse_or_salvage_tool_args(
        cls,
        raw_args: str,
        fallback_doc_type: str = "KampanyaBelgesi",
    ) -> Tuple[Optional[Dict[str, Any]], bool, Optional[str], Optional[str]]:
        """
        Tool argümanı JSON dizgesini ayrıştırır. Eğer upstream token sınırından dolayı yarıda
        kesilmişse, tamamlanmış tüm dizi elemanlarını kurtarır ve yarım kalan elemanın adını döner.
        Dönüş: (parsed_dict, is_complete, array_key, cut_off_name)
        """
        cleaned = cls._repair_llm_json_glitches(raw_args.strip())
        if not cleaned:
            return None, True, None, None

        has_ellipsis = "..." in cleaned[-80:] or '".."' in cleaned[-60:]
        if not has_ellipsis:
            try:
                obj = json.loads(cleaned)
                if isinstance(obj, dict):
                    for k in ("kampanyalar", "kalemler", "items", "satirlar", "fiyatlar", "urunler"):
                        if isinstance(obj.get(k), list):
                            cls._normalize_document_header(obj, cleaned, k, obj.get(k) or [], fallback_doc_type)
                            return obj, True, k, None
                    cls._normalize_document_header(obj, cleaned, None, [], fallback_doc_type)
                    return obj, True, None, None
            except Exception:
                pass

        m = re.search(r'"(kampanyalar|kalemler|items|satirlar|fiyatlar|urunler)"\s*:\s*\[', cleaned)
        if not m:
            return None, False, None, None

        arr_key = m.group(1)
        arr_start = m.end()
        header_prefix = cleaned[: m.start()].rstrip().rstrip(",")

        decoder = json.JSONDecoder()
        complete_items: List[Dict[str, Any]] = []
        idx = arr_start
        n = len(cleaned)
        last_good_end = arr_start

        while idx < n:
            while idx < n and cleaned[idx] in " \t\r\n,":
                idx += 1
            if idx >= n or cleaned[idx] == "]":
                break
            if cleaned[idx] != "{":
                break
            try:
                item_obj, next_idx = decoder.raw_decode(cleaned, idx)
                if isinstance(item_obj, dict):
                    item_str = cleaned[idx:next_idx]
                    if "..." in item_str or '".."' in item_str:
                        break
                    complete_items.append(item_obj)
                last_good_end = next_idx
                idx = next_idx
            except Exception:
                break

        remainder = cleaned[last_good_end:]
        cut_off_name = None
        m_name = re.search(
            r'"(?:adi|kampanyaAdi|baslik|name|title|tedarikciUrunKodu|urunKodu|stokKodu|kod)"\s*:\s*"([^"]+)"',
            remainder,
        )
        if m_name:
            cut_off_name = m_name.group(1)

        try:
            parsed_hdr = json.loads(header_prefix + "}")
            header_obj = parsed_hdr if isinstance(parsed_hdr, dict) else {}
        except Exception:
            header_obj = {}

        cls._normalize_document_header(header_obj, cleaned, arr_key, complete_items, fallback_doc_type)
        header_obj[arr_key] = complete_items
        return header_obj, False, arr_key, cut_off_name

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
                            existing_tc = streamed_tool_calls_by_idx.get(idx_key)
                            if not existing_tc:
                                fn_in = tc_item.get("function") or {}
                                streamed_tool_calls_by_idx[idx_key] = {
                                    "id": tc_item.get("id") or f"call_{idx_key}",
                                    "type": tc_item.get("type") or "function",
                                    "function": {
                                        "name": str(fn_in.get("name") or ""),
                                        "arguments": str(fn_in.get("arguments") or ""),
                                    },
                                }
                            else:
                                if tc_item.get("id"):
                                    existing_tc["id"] = tc_item["id"]
                                fn_in = tc_item.get("function") or {}
                                if fn_in.get("name"):
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

        if reasoning_buffer and not on_reasoning:
            on_delta("".join(reasoning_buffer))
            return True

        # Eğer yalnızca reasoning alındıysa ama asıl yanıt (content veya tool_calls) hiç gelmediyse
        # False döndür ki üst katman yedek (fallback) uç noktadan tam yanıtı çeksin.
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
