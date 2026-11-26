"""
ThinkPort AI Gateway - LLM Sağlayıcı İletişim Servisi (llm_provider_service.py).
Web AI (Pollinations / OpenAI Web Bridge) ve yerel Ollama büyük dil modeli sağlayıcılarıyla
HTTP/SSE akışını, yedek (fallback) geçişlerini ve tool_calls ayrıştırmasını yürütür.
"""
import http.client
import json
import re
import ssl
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Union
from app.core.config import settings
from app.core.logger import gateway_logger
from app.core.security import create_verified_ssl_context
from app.models.registry import model_registry
from app.models.web_browser_model import IWebBrowserModel
from app.repositories.proxy_repository import proxy_module_db
from app.services.message_formatter_service import MessageFormatterService
from app.services.web_browser_agent_bridge import (
    build_browser_prompt,
    parse_tool_calls_from_text,
)

# Her çıkış IP'si / proxy uç noktası için bağımsız eşzamanlılık kilidi (farklı IP'ler %100 paralel çalışır)
_PROXY_SLOT_REGISTRY_LOCK = threading.Lock()
_ENDPOINT_LOCKS: Dict[str, threading.Lock] = {}
_IN_FLIGHT_ENDPOINTS: Set[str] = set()
_LANE_CURSOR: List[int] = [0]
_ACTIVE_BROWSER_SESSIONS_LOCK = threading.Lock()
_ACTIVE_BROWSER_SESSIONS: Set[str] = set()

_ROTATING_USER_AGENTS: Tuple[str, ...] = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
)


class _ProxiedHTTPSConnection(http.client.HTTPSConnection):
    """@akalin/proxy_module üzerinden SOCKS5 / SOCKS4 / HTTP CONNECT + TLS tüneli açan HTTPS bağlantısı."""

    def __init__(
        self,
        host: str,
        port: int,
        proxy_node: Dict[str, Any],
        ssl_context: ssl.SSLContext,
        connect_timeout: float = 4.5,
        header_timeout: float = 75.0,
        read_timeout: float = 120.0,
    ) -> None:
        if not proxy_node:
            raise ValueError("Strict Proxy Policy: proxy_node boş olamaz.")
        super().__init__(host, port, timeout=read_timeout, context=ssl_context)
        self._ssl_context = ssl_context
        self._proxy_node = proxy_node
        self._connect_timeout = connect_timeout
        self._header_timeout = header_timeout
        self._read_timeout = read_timeout
        self.handshake_ms: int = 0

    def connect(self) -> None:
        t_conn = time.perf_counter()
        raw_sock = proxy_module_db.open_proxy_tunnel_socket(
            self._proxy_node,
            target_host=self.host,
            target_port=self.port,
            timeout=self._connect_timeout,
        )
        try:
            raw_sock.settimeout(max(self._connect_timeout, 5.0))
            tls_sock = self._ssl_context.wrap_socket(raw_sock, server_hostname=self.host)
            tls_sock.settimeout(self._header_timeout)
            self.sock = tls_sock
            self.handshake_ms = max(5, int((time.perf_counter() - t_conn) * 1000))
        except Exception:
            try:
                raw_sock.close()
            except Exception:
                pass
            raise

    def promote_to_stream_timeout(self) -> None:
        if self.sock is not None:
            try:
                # Proxy tünelinde iki SSE paketi arası en fazla 30 sn sessizlik olabilir
                self.sock.settimeout(min(30.0, self._read_timeout))
            except Exception:
                pass


def _extract_ip_port_from_label(proxy_label: Optional[str]) -> str:
    if not proxy_label:
        return ""
    m = re.search(r"(\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})", proxy_label)
    return m.group(1) if m else ""


def _format_proxy_route_label(proxy_node: Optional[Dict[str, Any]], mode: str = "tunnel") -> str:
    if not proxy_node:
        return "[NO_PROXY_ERROR]"
    proto = str(proxy_node.get("protocol") or "socks5").lower()
    ep = str(proxy_node.get("endpoint") or "")
    ctry = str(proxy_node.get("country") or "-")
    pid = str(proxy_node.get("id") or "-")
    return f"{proto}://{ep} [{ctry}] (id={pid}, {mode})"


def _acquire_outbound_route(
    preferred_proxy: Optional[str] = None,
    excluded_endpoints: Optional[Set[str]] = None,
    force_direct: bool = False,
) -> Tuple[Dict[str, Any], str, threading.Lock]:
    """
    STRICT PROXY POLICY:
    Tüm LLM dış bağlantıları için @akalin/proxy_module havuzundan aktif bir proxy düğümü tahsis eder.
    Yerel IP (DIRECT) kullanımı KESİNLİKLE ENGELLENMİŞTİR.
    Boşta olan aktif bir proxy düğümünü anında seçer; tüm proxy'ler meşgulse round-robin ile
    sıradaki proxy hattının kilidini bekler.
    """
    excluded = set(excluded_endpoints) if excluded_endpoints else set()
    try:
        candidates = proxy_module_db.acquire_rotating_proxies(count=32)
    except Exception as exc:
        gateway_logger.error(f"PROXY_POOL_READ_ERROR | akalin_proxy_db okunamadı: {exc}")
        candidates = []

    preferred_ep = _extract_ip_port_from_label(preferred_proxy)
    if preferred_ep and candidates:
        preferred_matches = [c for c in candidates if str(c.get("endpoint") or "") == preferred_ep]
        others = [c for c in candidates if str(c.get("endpoint") or "") != preferred_ep]
        candidates = preferred_matches + others

    usable_proxies = [
        c for c in candidates if str(c.get("endpoint") or "") and str(c.get("endpoint")) not in excluded
    ]

    # Eğer tüm aktif proxy'ler dışlandıysa (geçici timeout vb.), dışlama listesini sıfırla
    if not usable_proxies and candidates:
        gateway_logger.info(
            f"PROXY_POOL_RECYCLE | Tüm {len(candidates)} proxy dışlanmıştı, dışlama listesi sıfırlanıp havuz yeniden devreye alınıyor."
        )
        usable_proxies = [c for c in candidates if str(c.get("endpoint") or "")]

    if not usable_proxies:
        raise RuntimeError(
            "STRICT_PROXY_ENFORCEMENT_ERROR: Proxy havuzunda aktif proxy düğümü bulunamadı! "
            "Yerel IP üzerinden çıkış yapılması kesinlikle yasaktır."
        )

    with _PROXY_SLOT_REGISTRY_LOCK:
        # 1. Boşta olan doğrulanmış proxy tünelini anında (non-blocking) tahsis et
        for node in usable_proxies:
            ep_key = str(node["endpoint"])
            lock_obj = _ENDPOINT_LOCKS.setdefault(ep_key, threading.Lock())
            if ep_key not in _IN_FLIGHT_ENDPOINTS and lock_obj.acquire(blocking=False):
                _IN_FLIGHT_ENDPOINTS.add(ep_key)
                return (node, ep_key, lock_obj)

        # 2. Tüm proxy'ler o an meşgulse round-robin ile sıradaki proxy hattını seç ve kilidini bekle
        lane_options: List[Tuple[Dict[str, Any], str]] = [
            (n, str(n["endpoint"])) for n in usable_proxies
        ]
        idx = _LANE_CURSOR[0] % len(lane_options)
        _LANE_CURSOR[0] = (_LANE_CURSOR[0] + 1) % 100000
        chosen_node, chosen_key = lane_options[idx]
        chosen_lock = _ENDPOINT_LOCKS.setdefault(chosen_key, threading.Lock())

    chosen_lock.acquire()
    with _PROXY_SLOT_REGISTRY_LOCK:
        _IN_FLIGHT_ENDPOINTS.add(chosen_key)
    return (chosen_node, chosen_key, chosen_lock)


def _release_outbound_route(endpoint_key: str, lock_obj: threading.Lock) -> None:
    with _PROXY_SLOT_REGISTRY_LOCK:
        _IN_FLIGHT_ENDPOINTS.discard(endpoint_key)
    try:
        lock_obj.release()
    except RuntimeError:
        pass


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
        on_finish_reason: Optional[Callable[[str], None]] = None,
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
                on_finish_reason=on_finish_reason,
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
        on_finish_reason: Optional[Callable[[str], None]] = None,
        preferred_proxy: Optional[str] = None,
        on_proxy_used: Optional[Callable[[str], None]] = None,
        reasoning_effort: Optional[str] = None,
    ) -> bool:
        """
        Web AI sağlayıcısından (text.pollinations.ai/openai) gerçek zamanlı SSE akışı okur.
        @akalin/proxy_module üzerinden her isteği bağımsız proxy IP'lerinden paralel geçirir.
        Gelen mesajlara koda gömülü hiçbir prompt eklemesi veya performans kısıtlaması yapmaz.
        """
        enriched_messages = [dict(m) for m in openai_messages]
        target_upstream = (
            "openai-fast"
            if web_model in (
                "openai",
                "openai-fast",
                "gpt-oss:20b",
                "gpt-oss",
                "chatgpt-web",
            )
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
            on_finish_reason=on_finish_reason,
            preferred_proxy=preferred_proxy,
            on_proxy_used=on_proxy_used,
            reasoning_effort=reasoning_effort,
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
            on_finish_reason=on_finish_reason,
            preferred_proxy=preferred_proxy,
            on_proxy_used=on_proxy_used,
        )

    def stream_from_gemini(
        self,
        gemini_model: str,
        openai_messages: List[Dict[str, Any]],
        on_delta: Callable[[str], None],
        requested_model_id: str = "",
        conversation_id: str = "",
        response_format: Optional[Dict[str, Any]] = None,
        temperature: Optional[float] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        on_tool_calls: Optional[Callable[[List[Dict[str, Any]]], None]] = None,
        max_tokens: Optional[int] = None,
        on_finish_reason: Optional[Callable[[str], None]] = None,
        on_proxy_used: Optional[Callable[[str], None]] = None,
        on_reasoning: Optional[Callable[[str], None]] = None,
    ) -> bool:
        """
        Google Gemini modelini doğrudan ve şeffaf biçimde çalıştırır (agentik tool-calling destekli).
        1. GEMINI_API_KEY tanımlıysa Google Generative Language REST API (generativelanguage.googleapis.com) üzerinden SSE akışı yapar.
        2. API anahtarı yoksa @akalin/browser_module (port 8002) üzerinden https://gemini.google.com/app sanal tarayıcısına bağlanır.
        Hiçbir koşulda OpenAI veya text.pollinations.ai proxy köprüsüne gönderilmez.
        """
        target_model = "gemini-2.0-flash" if gemini_model in ("gemini-web", "gemini") else gemini_model
        gateway_logger.info(
            f"Google Gemini isteği yönlendiriliyor | model={gemini_model} -> {target_model} | tools={len(tools or [])} | hedef=Google (gemini.google.com / Google API)"
        )

        # 1. Google Generative Language API ile doğrudan SSE akışı
        if settings.gemini_api_key:
            api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:streamGenerateContent?key={settings.gemini_api_key}&alt=sse"
            effective_msgs = self._flatten_tool_messages_for_web(openai_messages) if any(
                m.get("role") == "tool" or bool(m.get("tool_calls")) for m in openai_messages
            ) else openai_messages
            contents = []
            system_instruction = None
            for msg in effective_msgs:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if role in ("system", "developer"):
                    system_instruction = {"parts": [{"text": str(content)}]}
                else:
                    g_role = "model" if role == "assistant" else "user"
                    contents.append({"role": g_role, "parts": [{"text": str(content)}]})

            payload: Dict[str, Any] = {
                "contents": contents,
                "generationConfig": {
                    "temperature": temperature if temperature is not None else 0.7,
                    "maxOutputTokens": max_tokens or 4096,
                },
            }
            if system_instruction:
                payload["systemInstruction"] = system_instruction
            if tools:
                fn_decls: List[Dict[str, Any]] = []
                for t in tools:
                    if not isinstance(t, dict):
                        continue
                    fn = t.get("function") if isinstance(t.get("function"), dict) else t
                    fn_name = str(fn.get("name") or "").strip()
                    if not fn_name:
                        continue
                    decl: Dict[str, Any] = {
                        "name": fn_name,
                        "description": str(fn.get("description") or ""),
                    }
                    params = fn.get("parameters")
                    if isinstance(params, dict) and params.get("properties"):
                        decl["parameters"] = params
                    fn_decls.append(decl)
                if fn_decls:
                    payload["tools"] = [{"functionDeclarations": fn_decls}]

            try:
                raw_bytes = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(
                    api_url,
                    data=raw_bytes,
                    headers={"Content-Type": "application/json", "User-Agent": "ThinkPort-Gemini/1.0"},
                    method="POST",
                )
                collected_tool_calls: List[Dict[str, Any]] = []
                with urllib.request.urlopen(req, timeout=settings.web_gateway_timeout_sec) as resp:
                    for line_bytes in resp:
                        line = line_bytes.decode("utf-8", errors="replace").strip()
                        if not line or not line.startswith("data:"):
                            continue
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            candidates = chunk.get("candidates") or []
                            if candidates:
                                parts = candidates[0].get("content", {}).get("parts", [])
                                for p in parts:
                                    txt = p.get("text", "")
                                    if txt:
                                        on_delta(txt)
                                    fc = p.get("functionCall")
                                    if isinstance(fc, dict) and fc.get("name"):
                                        collected_tool_calls.append(
                                            {
                                                "id": f"call_gemini_{int(time.time() * 1000)}_{len(collected_tool_calls)}",
                                                "type": "function",
                                                "function": {
                                                    "name": str(fc["name"]),
                                                    "arguments": json.dumps(fc.get("args") or {}, ensure_ascii=False),
                                                },
                                            }
                                        )
                        except Exception:
                            pass
                    if collected_tool_calls and on_tool_calls:
                        on_tool_calls(collected_tool_calls)
                    if on_finish_reason:
                        on_finish_reason("tool_calls" if collected_tool_calls else "stop")
                    gateway_logger.info(
                        f"Google Gemini REST API akışı tamamlandı | model={target_model} | tool_calls={len(collected_tool_calls)} | upstream=generativelanguage.googleapis.com"
                    )
                    return True
            except Exception as exc:
                gateway_logger.warning(
                    f"Google Gemini API çağrısı başarısız oldu (generativelanguage.googleapis.com): {exc}"
                )

        # 2. akalin-browser-module Sanal Tarayıcı (https://gemini.google.com/app)
        gemini_browser_model = model_registry.get("gemini-web")
        if isinstance(gemini_browser_model, IWebBrowserModel):
            return self.stream_from_web_browser_model(
                web_browser_model=gemini_browser_model,
                openai_messages=openai_messages,
                on_delta=on_delta,
                conversation_id=conversation_id,
                response_format=response_format,
                tools=tools,
                tool_choice=tool_choice,
                on_tool_calls=on_tool_calls,
                on_finish_reason=on_finish_reason,
                on_proxy_used=on_proxy_used,
                on_reasoning=on_reasoning,
            )

        return False

    def stream_from_web_browser_model(
        self,
        web_browser_model: IWebBrowserModel,
        openai_messages: List[Dict[str, Any]],
        on_delta: Callable[[str], None],
        conversation_id: str = "",
        response_format: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        on_tool_calls: Optional[Callable[[List[Dict[str, Any]]], None]] = None,
        on_finish_reason: Optional[Callable[[str], None]] = None,
        on_proxy_used: Optional[Callable[[str], None]] = None,
        on_reasoning: Optional[Callable[[str], None]] = None,
        max_retries: int = 5,
    ) -> bool:
        """
        IWebBrowserModel arayüzünü uygulayan herhangi bir sanal tarayıcı modelini
        (GeminiWebModel -> https://gemini.google.com/app, ChatGptWebModel -> https://chatgpt.com/ vb.)
        @akalin/browser_module (Docker Playwright) üzerinden ortak sözleşmeyle çalıştırır.
        Agentik modda (`tools` veya `json_mode`) `system` prompt, araç şemaları ve `tool` sonuçlarını
        prompt-tabanlı `<tool_call>` protokolü ile gönderir ve dönen araç çağrılarını OpenAI
        `tool_calls` formatına ayrıştırarak `on_tool_calls` geri çağırımını tetikler.
        Proxy/bağlantı hatasında hata mesajı göstermeden arka arkaya `max_retries` (varsayılan 5)
        kez yeni proxy IP'si ile tekrar dener ve ilerlemeyi `on_reasoning` üzerinden `x/5` biçiminde bildirir.
        """
        try:
            from app.services.browser_tool_service import browser_tool_service

            target_url = web_browser_model.target_url
            is_json_mode = MessageFormatterService.is_json_mode_requested(response_format)
            is_agentic_mode = bool(tools) or is_json_mode

            conv_id = conversation_id or f"{web_browser_model.session_prefix}-{int(time.time()) // 3600}"
            total_attempts = max(1, max_retries)
            exclude_proxy_ids: List[str] = []
            next_proxy_override: Optional[Dict[str, Any]] = None
            parsed_res: Optional[Dict[str, Any]] = None

            with _ACTIVE_BROWSER_SESSIONS_LOCK:
                session_was_active = conv_id in _ACTIVE_BROWSER_SESSIONS

            for attempt in range(1, total_attempts + 1):
                # Proxy retry durumunda önceki sekme kapatıldığı için tam bağlamı yeniden enjekte et
                use_active_session = session_was_active and attempt == 1
                user_prompt = build_browser_prompt(
                    openai_messages=openai_messages,
                    tools=tools,
                    tool_choice=tool_choice,
                    is_json_mode=is_json_mode,
                    has_active_session=use_active_session,
                )

                if on_reasoning:
                    if attempt == 1:
                        mode_suffix = f" [Agentik | {len(tools)} araç]" if tools else ""
                        on_reasoning(
                            f"🌐 {web_browser_model.name}{mode_suffix} bağlantısı kuruluyor ({attempt}/{total_attempts})...\n"
                        )
                    else:
                        on_reasoning(f"🔄 Yeni proxy IP'si ile yeniden deneniyor ({attempt}/{total_attempts})...\n")

                tool_args: Dict[str, Any] = {
                    "url": target_url,
                    "text": user_prompt,
                    "use_proxy": web_browser_model.use_proxy,
                }
                if next_proxy_override:
                    tool_args["proxy_override"] = next_proxy_override
                if exclude_proxy_ids:
                    tool_args["exclude_proxy_ids"] = list(exclude_proxy_ids)

                streamed_live_chunks: List[str] = []
                if not is_agentic_mode:
                    def _live_delta_cb(chunk: str) -> None:
                        streamed_live_chunks.append(chunk)
                        on_delta(chunk)

                    def _live_status_cb(_stage: str, msg: str) -> None:
                        if on_reasoning and msg:
                            on_reasoning(f"⚡ {msg}\n")

                    candidate: Any = browser_tool_service.stream_browser_prompt_llm(
                        raw_arguments=tool_args,
                        conversation_id=conv_id,
                        on_delta=_live_delta_cb,
                        on_status=_live_status_cb,
                    )
                else:
                    raw_res = browser_tool_service.execute_browser_tool(
                        tool_name="thinkport_browser_prompt_llm",
                        raw_arguments=tool_args,
                        conversation_id=conv_id,
                    )
                    candidate = json.loads(raw_res) if isinstance(raw_res, str) else raw_res

                if isinstance(candidate, dict) and not candidate.get("error"):
                    parsed_res = candidate
                    parsed_res["_already_streamed_live"] = bool(streamed_live_chunks)
                    with _ACTIVE_BROWSER_SESSIONS_LOCK:
                        _ACTIVE_BROWSER_SESSIONS.add(conv_id)
                    break

                with _ACTIVE_BROWSER_SESSIONS_LOCK:
                    _ACTIVE_BROWSER_SESSIONS.discard(conv_id)

                err_msg = (
                    str(candidate.get("error"))
                    if isinstance(candidate, dict)
                    else "Bilinmeyen tarayıcı hatası"
                )
                failed_proxy_id = candidate.get("proxy_id") if isinstance(candidate, dict) else None
                if failed_proxy_id and str(failed_proxy_id) not in exclude_proxy_ids:
                    exclude_proxy_ids.append(str(failed_proxy_id))

                replacement_proxy = (
                    candidate.get("replacement_proxy")
                    if isinstance(candidate, dict)
                    else None
                )
                next_proxy_override = (
                    replacement_proxy if isinstance(replacement_proxy, dict) else None
                )
                requires_auth = bool(candidate.get("requires_auth")) if isinstance(candidate, dict) else False

                gateway_logger.warning(
                    f"{web_browser_model.name} deneme {attempt}/{total_attempts} başarısız: {err_msg}"
                )
                if requires_auth or attempt >= total_attempts:
                    return False

            if not parsed_res:
                return False

            already_streamed_live = bool(parsed_res.get("_already_streamed_live"))

            title = str(parsed_res.get("title") or web_browser_model.name)
            resolved_url = str(parsed_res.get("url") or target_url)
            model_text = str(parsed_res.get("text") or "").strip()
            latency = parsed_res.get("latency_ms", 0)
            inspection = parsed_res.get("inspection") or {}
            api_endpoints = inspection.get("api_endpoints") or []
            wiz_data = inspection.get("wiz_global_data") or {}
            chat_inputs = inspection.get("chat_inputs") or []

            # İlk IP adresini tespit et
            primary_ip = ""
            for ep in api_endpoints:
                if ep.get("ip_address"):
                    primary_ip = f"{ep.get('ip_address')}:{ep.get('port', 443)}"
                    break

            route_label = "Docker Playwright Chromium (akalin-virtual-browser:8002)"
            if primary_ip:
                route_label += f" -> {primary_ip}"

            gateway_logger.info(
                f"{web_browser_model.name} Sanal Tarayıcı akışı tamamlandı: {resolved_url} | IP={primary_ip} | süre={latency}ms | agentic={is_agentic_mode}"
            )
            if on_proxy_used:
                on_proxy_used(route_label)

            # Eğer yanıt DOM üzerinden canlı (delta) olarak zaten akıtıldıysa tekrar basmadan bitir
            if already_streamed_live:
                if on_finish_reason:
                    on_finish_reason("stop")
                return True

            # Temizlenmiş model metni
            clean_text = model_text
            strip_prefix = web_browser_model.response_prefix_to_strip
            if strip_prefix and clean_text.lower().startswith(strip_prefix.lower()):
                clean_text = clean_text[len(strip_prefix):].strip()

            # Modelin kendi özel çıktı biçimlendirmesi varsa (örn. ChatGptWebModel -> yalnızca SAYFA METNİ)
            custom_formatted = web_browser_model.format_browser_response(
                clean_text,
                {
                    "title": title,
                    "url": resolved_url,
                    "latency_ms": latency,
                    "requires_auth": bool(parsed_res.get("requires_auth")),
                    "primary_ip": primary_ip,
                    "inspection": inspection,
                    "raw_mode": is_agentic_mode,
                },
            )

            # Agentik Mod: araç çağrısı (<tool_call> / JSON) ayrıştırması ve temiz çıktı aktarımı
            effective_text = custom_formatted if custom_formatted is not None else clean_text
            if tools and effective_text and not parsed_res.get("requires_auth"):
                parsed_tool_calls, remaining_text = parse_tool_calls_from_text(
                    effective_text,
                    tools=tools,
                )
                if parsed_tool_calls and on_tool_calls:
                    gateway_logger.info(
                        f"{web_browser_model.name} agentik araç çağrısı ayrıştırıldı: "
                        f"{[tc['function']['name'] for tc in parsed_tool_calls]}"
                    )
                    if remaining_text:
                        for chunk in remaining_text.splitlines(keepends=True):
                            on_delta(chunk)
                    on_tool_calls(parsed_tool_calls)
                    if on_finish_reason:
                        on_finish_reason("tool_calls")
                    return True

            if is_agentic_mode and not parsed_res.get("requires_auth"):
                final_agentic_text = effective_text or model_text
                for chunk in final_agentic_text.splitlines(keepends=True):
                    on_delta(chunk)
                if on_finish_reason:
                    on_finish_reason("stop")
                return True

            if custom_formatted is not None:
                for chunk in custom_formatted.splitlines(keepends=True):
                    on_delta(chunk)
                if on_finish_reason:
                    on_finish_reason("stop")
                return True

            # Kullanıcıya şeffaf telemetri ve tespit edilen uç noktalar (varsayılan gizli, tıklanınca açılır)
            telemetry_parts = [
                f"🌐 **Model Sağlayıcısı:** {web_browser_model.vendor} (`{web_browser_model.id}` / {web_browser_model.name})\n",
                f"🖥️ **Sanal Tarayıcı Motoru:** Docker Playwright Chromium (`akalin-virtual-browser:8002`)\n",
                f"🎯 **Hedef URL:** [{resolved_url}]({resolved_url}) (Başlık: `{title}`)\n",
            ]

            if primary_ip:
                telemetry_parts.append(
                    f"📡 **Bağlanılan Sunucu IP:** `{primary_ip}` ({web_browser_model.vendor})\n"
                )

            if api_endpoints:
                telemetry_parts.append(
                    f"\n🔍 **Tespit Edilen API Uç Noktaları (Son {min(len(api_endpoints), 3)}):**\n"
                )
                for ep in api_endpoints[:3]:
                    ep_url = ep.get("base_url") or ep.get("url", "")
                    ep_ip = ep.get("ip_address") or primary_ip or "-"
                    ep_status = ep.get("status") or 200
                    telemetry_parts.append(
                        f"- `{ep_url}` | **IP:** `{ep_ip}` | **Durum:** `{ep_status}`\n"
                    )

            dynamic_details = []
            if wiz_data.get("FdrFJe"):
                dynamic_details.append(f"Session Token (`FdrFJe`): `{wiz_data.get('FdrFJe')}`")
            if wiz_data.get("cfb2h"):
                dynamic_details.append(f"Build Sürümü (`cfb2h`): `{wiz_data.get('cfb2h')}`")
            if chat_inputs:
                dynamic_details.append(f"Giriş Alanı: `{chat_inputs[0].get('selector')}`")
            if inspection.get("cookies_count"):
                dynamic_details.append(f"Aktif Çerezler: `{inspection.get('cookies_count')} adet`")

            if dynamic_details:
                telemetry_parts.append("\n🛡️ **Dinamik Tarayıcı Güvenlik Kontrolleri:**\n")
                for dt in dynamic_details:
                    telemetry_parts.append(f"- {dt}\n")

            telemetry_block = "".join(telemetry_parts).strip()
            browser_reply_parts = [
                f":::details Teknik Bilgiler & Bağlantı Detayları\n{telemetry_block}\n:::\n\n"
            ]

            if parsed_res.get("requires_auth"):
                browser_reply_parts.append(
                    "> [!NOTE]\n"
                    f"> **{web_browser_model.name} Oturum Bilgisi:**\n"
                    f"> Sanal tarayıcı `{web_browser_model.auth_notice_domain}` adresine bağlandı ancak oturum açma ekranı ile karşılaşıldı. "
                    f"{web_browser_model.name} üzerinde tam sohbet oturumu için sanal tarayıcıda bir kez oturum açılması veya API anahtarı girilmesi önerilir.\n"
                )
            elif clean_text:
                browser_reply_parts.append(clean_text)
            else:
                browser_reply_parts.append(model_text)

            full_reply = "".join(browser_reply_parts)
            for chunk in full_reply.splitlines(keepends=True):
                on_delta(chunk)

            if on_finish_reason:
                on_finish_reason("stop")
            return True
        except Exception as exc:
            gateway_logger.warning(f"{web_browser_model.name} Sanal Tarayıcı erişim hatası: {exc}")

        return False

    def stream_from_chatgpt_web(
        self,
        openai_messages: List[Dict[str, Any]],
        on_delta: Callable[[str], None],
        conversation_id: str = "",
        response_format: Optional[Dict[str, Any]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        on_tool_calls: Optional[Callable[[List[Dict[str, Any]]], None]] = None,
        on_finish_reason: Optional[Callable[[str], None]] = None,
        on_proxy_used: Optional[Callable[[str], None]] = None,
        on_reasoning: Optional[Callable[[str], None]] = None,
    ) -> bool:
        """
        ChatGptWebModel (IWebBrowserModel) üzerinden https://chatgpt.com/ sanal tarayıcısına bağlanır.
        """
        chatgpt_browser_model = model_registry.get("chatgpt-web")
        if isinstance(chatgpt_browser_model, IWebBrowserModel):
            return self.stream_from_web_browser_model(
                web_browser_model=chatgpt_browser_model,
                openai_messages=openai_messages,
                on_delta=on_delta,
                conversation_id=conversation_id,
                response_format=response_format,
                tools=tools,
                tool_choice=tool_choice,
                on_tool_calls=on_tool_calls,
                on_finish_reason=on_finish_reason,
                on_proxy_used=on_proxy_used,
                on_reasoning=on_reasoning,
            )
        return False

    def stream_from_claude(
        self,
        claude_model: str,
        openai_messages: List[Dict[str, Any]],
        on_delta: Callable[[str], None],
        requested_model_id: str = "",
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        on_finish_reason: Optional[Callable[[str], None]] = None,
        on_proxy_used: Optional[Callable[[str], None]] = None,
    ) -> bool:
        """
        Anthropic Claude modelini doğrudan çalıştırır (api.anthropic.com veya claude.ai sanal tarayıcısı).
        Hiçbir koşulda OpenAI veya text.pollinations.ai proxy köprüsüne gönderilmez.
        """
        target_model = "claude-3-5-sonnet-20241022" if claude_model in ("claude-web", "claude-3-5-sonnet") else claude_model
        gateway_logger.info(
            f"Anthropic Claude isteği yönlendiriliyor | model={claude_model} -> {target_model} | hedef=Anthropic (api.anthropic.com / claude.ai)"
        )
        if settings.anthropic_api_key:
            api_url = "https://api.anthropic.com/v1/messages"
            system_prompt = ""
            user_msgs = []
            for m in openai_messages:
                role = m.get("role", "user")
                content = m.get("content", "")
                if role == "system":
                    system_prompt = str(content)
                else:
                    c_role = "assistant" if role == "assistant" else "user"
                    user_msgs.append({"role": c_role, "content": str(content)})

            payload: Dict[str, Any] = {
                "model": target_model,
                "messages": user_msgs,
                "max_tokens": max_tokens or 4096,
                "stream": True,
            }
            if system_prompt:
                payload["system"] = system_prompt
            if temperature is not None:
                payload["temperature"] = temperature

            try:
                raw_bytes = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(
                    api_url,
                    data=raw_bytes,
                    headers={
                        "Content-Type": "application/json",
                        "x-api-key": settings.anthropic_api_key,
                        "anthropic-version": "2023-06-01",
                        "User-Agent": "ThinkPort-Claude/1.0",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=settings.web_gateway_timeout_sec) as resp:
                    for line_bytes in resp:
                        line = line_bytes.decode("utf-8", errors="replace").strip()
                        if not line or not line.startswith("data:"):
                            continue
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            c_type = chunk.get("type")
                            if c_type == "content_block_delta":
                                delta_text = chunk.get("delta", {}).get("text", "")
                                if delta_text:
                                    on_delta(delta_text)
                        except Exception:
                            pass
                    if on_finish_reason:
                        on_finish_reason("stop")
                    gateway_logger.info(f"Anthropic Claude API akışı tamamlandı | model={target_model}")
                    return True
            except Exception as exc:
                gateway_logger.warning(f"Anthropic Claude API hatası (api.anthropic.com): {exc}")

        return False

    def stream_from_deepseek(
        self,
        deepseek_model: str,
        openai_messages: List[Dict[str, Any]],
        on_delta: Callable[[str], None],
        requested_model_id: str = "",
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        on_finish_reason: Optional[Callable[[str], None]] = None,
        on_proxy_used: Optional[Callable[[str], None]] = None,
    ) -> bool:
        """
        DeepSeek modelini doğrudan çalıştırır (api.deepseek.com veya chat.deepseek.com sanal tarayıcısı).
        Hiçbir koşulda OpenAI veya text.pollinations.ai proxy köprüsüne gönderilmez.
        """
        target_model = "deepseek-chat" if deepseek_model in ("deepseek-web", "deepseek-r1") else deepseek_model
        gateway_logger.info(
            f"DeepSeek isteği yönlendiriliyor | model={deepseek_model} -> {target_model} | hedef=DeepSeek (api.deepseek.com / chat.deepseek.com)"
        )
        if settings.deepseek_api_key:
            api_url = "https://api.deepseek.com/v1/chat/completions"
            payload = {
                "model": target_model,
                "messages": openai_messages,
                "stream": True,
                "temperature": temperature if temperature is not None else 0.7,
            }
            if max_tokens:
                payload["max_tokens"] = max_tokens

            try:
                raw_bytes = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(
                    api_url,
                    data=raw_bytes,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {settings.deepseek_api_key}",
                        "User-Agent": "ThinkPort-DeepSeek/1.0",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=settings.web_gateway_timeout_sec) as resp:
                    for line_bytes in resp:
                        line = line_bytes.decode("utf-8", errors="replace").strip()
                        if not line or not line.startswith("data:"):
                            continue
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            choices = chunk.get("choices") or []
                            if choices:
                                d_txt = choices[0].get("delta", {}).get("content", "")
                                if d_txt:
                                    on_delta(d_txt)
                        except Exception:
                            pass
                    if on_finish_reason:
                        on_finish_reason("stop")
                    gateway_logger.info(f"DeepSeek API akışı tamamlandı | model={target_model}")
                    return True
            except Exception as exc:
                gateway_logger.warning(f"DeepSeek API hatası (api.deepseek.com): {exc}")

        return False

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
        on_finish_reason: Optional[Callable[[str], None]] = None,
        preferred_proxy: Optional[str] = None,
        on_proxy_used: Optional[Callable[[str], None]] = None,
        reasoning_effort: Optional[str] = None,
        _retry_count: int = 0,
    ) -> bool:
        """text.pollinations.ai/openai uç noktasından çoklu proxy IP tüneli ile chunked-safe SSE yanıtı okur."""
        t0 = time.perf_counter()
        # Performans kısıtlaması (effort='low' vb.) yalnızca istemci/AdminUI açıkça gönderdiyse uygulanır;
        # aksi durumda modelin doğal tam kapasitesi kullanılır.
        effort: Optional[str] = reasoning_effort.strip() if isinstance(reasoning_effort, str) and reasoning_effort.strip() else None
        captured_finish_reason: List[str] = ["stop"]
        last_stream_error: List[str] = [""]
        last_route_used: List[str] = [""]

        def _record_finish(fr: str) -> None:
            captured_finish_reason[-1] = fr
            if on_finish_reason:
                on_finish_reason(fr)

        def _record_stream_error(err_msg: str) -> None:
            last_stream_error[-1] = err_msg or ""

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

        # Prompt metinlerine kod üzerinden hiçbir ekleme veya çıkarma yapılmaz.
        effective_msgs = [dict(m) for m in openai_messages]

        excluded_endpoints: Set[str] = set()
        max_attempts = 5
        ok = False
        best_truncated_snapshot: Optional[Tuple[List[str], List[List[Dict[str, Any]]], List[str], str, str]] = None

        def _flush_attempt_buffers(
            r_list: List[str],
            d_list: List[str],
            tc_batches: List[List[Dict[str, Any]]],
            fin_reason: str,
        ) -> None:
            if on_reasoning and r_list:
                for r_chunk in r_list:
                    if r_chunk:
                        on_reasoning(r_chunk)
            for d_chunk in d_list:
                if d_chunk:
                    on_delta(d_chunk)
            if on_tool_calls and tc_batches:
                for tc_batch in tc_batches:
                    if tc_batch:
                        on_tool_calls(tc_batch)
            _record_finish(fin_reason)

        for attempt_idx in range(max_attempts):
            last_stream_error[-1] = ""
            sleep_after_release = 0.0
            try:
                proxy_node, endpoint_key, ep_lock = _acquire_outbound_route(
                    preferred_proxy=preferred_proxy,
                    excluded_endpoints=excluded_endpoints,
                )
            except RuntimeError as route_err:
                gateway_logger.error(f"STRICT_PROXY_ROUTE_FAIL | {route_err}")
                break

            route_label = _format_proxy_route_label(proxy_node, mode="tunnel")
            last_route_used[-1] = route_label
            if on_proxy_used:
                on_proxy_used(route_label)

            attempt_deltas: List[str] = []
            attempt_tool_calls: List[List[Dict[str, Any]]] = []
            attempt_reasonings: List[str] = []
            attempt_finish: List[str] = ["stop"]

            def _on_attempt_finish(fr: str) -> None:
                if fr:
                    attempt_finish[0] = fr

            context = create_verified_ssl_context()
            conn: Optional[_ProxiedHTTPSConnection] = None
            try:
                effective_tool_choice = (
                    "required"
                    if (has_non_memory_tools and not tool_choice and attempt_idx >= 1)
                    else tool_choice
                )
                seed_offset = attempt_idx * 13
                payload = self._build_stream_payload(
                    model_name,
                    effective_msgs,
                    reasoning_effort=effort,
                    response_format=response_format,
                    temperature=temperature,
                    tools=tools,
                    tool_choice=effective_tool_choice,
                    max_tokens=max_tokens,
                    seed=((int(time.time() * 1000) + seed_offset) % 900000) + 100000,
                    force_stream=True,
                )
                hdr_timeout = 90.0 if len(payload) > 16384 else 75.0

                conn = _ProxiedHTTPSConnection(
                    settings.pollinations_host,
                    443,
                    proxy_node=proxy_node,
                    ssl_context=context,
                    connect_timeout=4.5,
                    header_timeout=hdr_timeout,
                    read_timeout=float(settings.pollinations_timeout_sec),
                )

                ua_idx = (attempt_idx + hash(endpoint_key)) % len(_ROTATING_USER_AGENTS)
                req_headers: Dict[str, str] = {
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream, application/json",
                    "User-Agent": _ROTATING_USER_AGENTS[ua_idx],
                }
                conn.request("POST", "/openai", body=payload, headers=req_headers)
                resp = conn.getresponse()
                conn.promote_to_stream_timeout()

                if resp.status != 200:
                    err_body = resp.read().decode("utf-8", errors="replace")[:500]
                    gateway_logger.warning(
                        f"Web AI (/openai) HTTP {resp.status} döndü | model={requested_model_id or model_name} "
                        f"| proxy='{route_label}' | detay={err_body}"
                    )
                    if (
                        resp.status == 400
                        and effort is not None
                        and ("reasoning_effort" in err_body or "unsupported_parameter" in err_body)
                    ):
                        gateway_logger.info(
                            f"Web AI (/openai) reasoning_effort='{effort}' reddedildi, parametresiz anında yeniden deneniyor..."
                        )
                        effort = None
                        continue

                    if resp.status in (402, 403, 407, 429, 500, 502, 503, 504):
                        try:
                            proxy_module_db.record_proxy_outcome(
                                str(proxy_node["id"]), success=False, cooldown_threshold=1
                            )
                        except Exception:
                            pass
                        excluded_endpoints.add(endpoint_key)
                        if attempt_idx + 1 < max_attempts:
                            gateway_logger.info(
                                f"PROXY_HTTP_FAILOVER | HTTP {resp.status} alındı | proxy='{route_label}' devre dışı bırakıldı, "
                                f"farklı IP üzerinden anında yeniden deneniyor ({attempt_idx + 1}/{max_attempts})..."
                            )
                            sleep_after_release = 0.15
                            continue

                    if resp.status in (402, 429, 500, 502, 503, 504) and attempt_idx + 1 < max_attempts:
                        m_wait = re.search(r"Retry after (\d+)s", err_body)
                        sleep_after_release = float(
                            min(int(m_wait.group(1)) + 1, 6) if m_wait else (1.5 * (attempt_idx + 1))
                        )
                        gateway_logger.info(
                            f"Web AI (/openai) geçici sınır/hata (HTTP {resp.status}, proxy='{route_label}', "
                            f"deneme={attempt_idx + 1}/{max_attempts}), {sleep_after_release:.1f}s sonra tekrar denenecek..."
                        )
                        continue
                    break

                gateway_logger.info(
                    f"PROXY_TUNNEL_OK | proxy='{route_label}' | handshake={conn.handshake_ms}ms | target={settings.pollinations_host}:443"
                )

                stream_ok = self._consume_sse_or_json(
                    resp,
                    self._extract_web_delta,
                    attempt_deltas.append,
                    max_duration_sec=float(settings.web_gateway_timeout_sec),
                    on_tool_calls=attempt_tool_calls.append if on_tool_calls else None,
                    on_reasoning=attempt_reasonings.append if on_reasoning else None,
                    on_finish_reason=_on_attempt_finish,
                    on_stream_error=_record_stream_error,
                )
                if stream_ok:
                    hs_ms = conn.handshake_ms
                    try:
                        proxy_module_db.record_proxy_outcome(
                            str(proxy_node["id"]), success=True, latency_ms=hs_ms
                        )
                        proxy_module_db._record_proxy_usage_stat(proxy_node, mode="tunnel")
                    except Exception:
                        pass

                    joined_attempt_text = "".join(attempt_deltas).strip()
                    # Erken 'length' kesintisi varsa farklı kanaldan mevcut ayarlarla (performansı kısmadan) tekrar dene
                    if (
                        attempt_finish[0] == "length"
                        and not attempt_tool_calls
                        and len(joined_attempt_text) < 1200
                        and attempt_idx + 1 < max_attempts
                    ):
                        if best_truncated_snapshot is None or len(joined_attempt_text) > len("".join(best_truncated_snapshot[2])):
                            best_truncated_snapshot = (
                                list(attempt_reasonings),
                                list(attempt_tool_calls),
                                list(attempt_deltas),
                                attempt_finish[0],
                                route_label,
                            )
                        gateway_logger.warning(
                            f"GATEWAY_SELF_HEAL_LENGTH | Erken kesilme algılandı (krk={len(joined_attempt_text)}, proxy='{route_label}'), "
                            f"farklı kanaldan tekrar deneniyor ({attempt_idx + 1}/{max_attempts})..."
                        )
                        sleep_after_release = 0.2
                        continue

                    _flush_attempt_buffers(
                        attempt_reasonings,
                        attempt_deltas,
                        attempt_tool_calls,
                        attempt_finish[0],
                    )
                    ok = True
                    break

                err_hint = last_stream_error[-1].lower()
                if effort is not None and (
                    "reasoning_effort" in err_hint
                    or "unsupported_parameter" in err_hint
                ):
                    gateway_logger.info(
                        f"Web AI (/openai) akış içi hata ('{err_hint[:60]}') nedeniyle reasoning_effort='{effort}' kaldırılıp yeniden deneniyor..."
                    )
                    effort = None
                    continue

                excluded_endpoints.add(endpoint_key)
                if attempt_idx + 1 < max_attempts:
                    gateway_logger.warning(
                        f"Web AI (/openai) akıştan içerik çıkmadı (proxy='{route_label}', deneme={attempt_idx + 1}/{max_attempts}, "
                        f"hata='{last_stream_error[-1][:140] or '-'}'), yarım tampon temizlenip farklı kanaldan yeniden deneniyor..."
                    )
                    sleep_after_release = 0.25
                    continue
            except Exception as exc:
                elapsed_err = int((time.perf_counter() - t0) * 1000)
                try:
                    proxy_module_db.record_proxy_outcome(
                        str(proxy_node["id"]), success=False, cooldown_threshold=1
                    )
                except Exception:
                    pass
                excluded_endpoints.add(endpoint_key)
                gateway_logger.warning(
                    f"PROXY_TUNNEL_FAILOVER | proxy='{route_label}' | süre={elapsed_err}ms | hata={exc} -> yarım tampon silindi, sonraki aktif proxy deneniyor ({attempt_idx + 1}/{max_attempts})"
                )
                sleep_after_release = 0.05
                if attempt_idx + 1 >= max_attempts:
                    break
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:
                        pass
                _release_outbound_route(endpoint_key, ep_lock)

            if sleep_after_release > 0:
                time.sleep(sleep_after_release)

        if not ok and best_truncated_snapshot is not None:
            r_snap, tc_snap, d_snap, fin_snap, route_snap = best_truncated_snapshot
            last_route_used[-1] = route_snap
            if on_proxy_used:
                on_proxy_used(route_snap)
            _flush_attempt_buffers(r_snap, d_snap, tc_snap, fin_snap)
            ok = True

        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        gateway_logger.info(
            f"Web AI (/openai) akışı tamamlandı | istem={requested_model_id} | upstream={model_name} "
            f"| proxy='{last_route_used[-1]}' | effort={effort} | finish_reason={captured_finish_reason[-1]} "
            f"| ok={ok} | süre={elapsed_ms}ms"
        )
        return ok

    def _try_pollinations_root_endpoint(
        self,
        model_name: str,
        openai_messages: List[Dict[str, Any]],
        on_delta: Callable[[str], None],
        requested_model_id: str = "",
        response_format: Optional[Dict[str, Any]] = None,
        on_finish_reason: Optional[Callable[[str], None]] = None,
        preferred_proxy: Optional[str] = None,
        on_proxy_used: Optional[Callable[[str], None]] = None,
    ) -> bool:
        """Yedek olarak text.pollinations.ai/ kök POST uç noktasından proxy destekli yanıt okur."""
        t0 = time.perf_counter()
        excluded: Set[str] = set()
        for attempt_idx in range(3):
            try:
                proxy_node, endpoint_key, ep_lock = _acquire_outbound_route(
                    preferred_proxy=preferred_proxy,
                    excluded_endpoints=excluded,
                )
            except RuntimeError as route_err:
                gateway_logger.error(f"STRICT_PROXY_ROUTE_FAIL (root) | {route_err}")
                break

            route_label = _format_proxy_route_label(proxy_node, mode="tunnel")
            if on_proxy_used:
                on_proxy_used(route_label)
            context = create_verified_ssl_context()
            conn: Optional[_ProxiedHTTPSConnection] = None
            try:
                conn = _ProxiedHTTPSConnection(
                    settings.pollinations_host,
                    443,
                    proxy_node=proxy_node,
                    ssl_context=context,
                    connect_timeout=4.5,
                    header_timeout=75.0,
                    read_timeout=float(settings.pollinations_timeout_sec),
                )
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
                        "User-Agent": _ROTATING_USER_AGENTS[attempt_idx % len(_ROTATING_USER_AGENTS)],
                    },
                )
                resp = conn.getresponse()
                if resp.status != 200:
                    gateway_logger.warning(
                        f"Web AI (root /) HTTP {resp.status} döndü | istem={requested_model_id} | proxy='{route_label}'"
                    )
                    excluded.add(endpoint_key)
                    continue
                raw_body = resp.read().decode("utf-8", errors="replace").strip()
                if not raw_body:
                    excluded.add(endpoint_key)
                    continue
                on_delta(raw_body)
                if on_finish_reason:
                    on_finish_reason("stop")
                elapsed_ms = int((time.perf_counter() - t0) * 1000)
                gateway_logger.info(
                    f"Web AI (root /) yanıtı alındı | istem={requested_model_id} | proxy='{route_label}' | süre={elapsed_ms}ms"
                )
                return True
            except Exception as exc:
                excluded.add(endpoint_key)
                gateway_logger.warning(
                    f"Web AI (root /) proxy hatası | proxy='{route_label}' | hata={exc}"
                )
                continue
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:
                        pass
                _release_outbound_route(endpoint_key, ep_lock)
        return False

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
            body["max_tokens"] = max_tokens
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
        on_finish_reason: Optional[Callable[[str], None]] = None,
        on_stream_error: Optional[Callable[[str], None]] = None,
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
        last_finish_reason: Optional[str] = None
        saw_done = False
        timed_out = False

        while True:
            if (time.perf_counter() - t_start) > max_duration_sec:
                timed_out = True
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
                    saw_done = True
                    break
                try:
                    chunk = json.loads(data_str)
                    if isinstance(chunk, dict) and chunk.get("error") and not chunk.get("choices"):
                        err_info = (
                            json.dumps(chunk["error"], ensure_ascii=False)
                            if isinstance(chunk["error"], (dict, list))
                            else str(chunk["error"])
                        )
                        gateway_logger.warning(f"Web AI SSE içi hata döndü: {err_info[:400]}")
                        if on_stream_error:
                            on_stream_error(err_info)
                        break
                    choice0 = chunk.get("choices", [{}])[0] if chunk.get("choices") else {}
                    fr_val = choice0.get("finish_reason")
                    if fr_val:
                        last_finish_reason = str(fr_val)
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
            if timed_out or last_finish_reason in ("length", "max_tokens"):
                effective_finish = "length"
            elif last_finish_reason is None and not saw_done:
                effective_finish = "length"
            else:
                effective_finish = last_finish_reason or (
                    "tool_calls" if streamed_tool_calls_by_idx else "stop"
                )
            if on_finish_reason:
                on_finish_reason(effective_finish)
            return True

        if non_sse_lines:
            joined = "\n".join(non_sse_lines).strip()
            try:
                parsed = json.loads(joined)
                if isinstance(parsed, dict) and parsed.get("error") and not parsed.get("choices"):
                    err_info = (
                        json.dumps(parsed["error"], ensure_ascii=False)
                        if isinstance(parsed["error"], (dict, list))
                        else str(parsed["error"])
                    )
                    gateway_logger.warning(f"Web AI JSON gövde hatası döndü: {err_info[:400]}")
                    if on_stream_error:
                        on_stream_error(err_info)
                    return False
                choice = parsed.get("choices", [{}])[0] if parsed.get("choices") else {}
                fr_json = choice.get("finish_reason")
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
                    effective_json_finish = (
                        "length"
                        if fr_json in ("length", "max_tokens")
                        else (str(fr_json) if fr_json else ("tool_calls" if tool_calls else "stop"))
                    )
                    if on_finish_reason:
                        on_finish_reason(effective_json_finish)
                    return True
            except Exception:
                if len(joined) > 0 and not joined.startswith("<"):
                    on_delta(joined)
                    if on_finish_reason:
                        on_finish_reason("stop")
                    return True

        if received_reasoning:
            r_len = sum(len(x) for x in reasoning_buffer)
            gateway_logger.warning(
                f"Web AI yalnızca reasoning üretti (content boş) | reasoning_krk={r_len} | finish_reason={last_finish_reason}"
            )
            if on_stream_error:
                on_stream_error(f"reasoning_only({r_len}_chars,finish={last_finish_reason})")

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
