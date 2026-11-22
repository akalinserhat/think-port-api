"""
think-port-api - Gateway Sanal Tarayıcı Araçları Köprüsü (browser_tool_service.py)
akalin-browser-module (Docker / HTTP) servisi ile OpenAI Function Calling şemalarını bağlar.
"""

from __future__ import annotations
import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

logger = logging.getLogger("browser_tool_service")

BROWSER_SERVICE_URL = os.getenv("BROWSER_SERVICE_URL", "http://localhost:8002").rstrip("/")

GATEWAY_BROWSER_TOOL_NAMES = {
    "thinkport_browser_navigate",
    "thinkport_browser_snapshot",
    "thinkport_browser_click",
    "thinkport_browser_type",
    "thinkport_browser_scroll",
    "thinkport_browser_inspect_apis",
    "thinkport_browser_prompt_llm",
    "thinkport_browser_close",
}


class BrowserToolService:
    """Gateway seviyesinde AI Ajanları için Sanal Tarayıcı Araçları Servisi."""

    def __init__(self, base_url: str = BROWSER_SERVICE_URL) -> None:
        self.base_url = base_url

    @staticmethod
    def get_gateway_browser_tools_schema() -> List[Dict[str, Any]]:
        """Ajanın webde gezinmesi için OpenAI Function Calling uyumlu araç şemaları döner."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "thinkport_browser_navigate",
                    "description": (
                        "Belirtilen URL adresini sanal tarayıcıda açar ve sayfanın sadeleştirilmiş "
                        "erişilebilirlik ağacını, metnini ve [ref] numaralı tıklanabilir öğelerini döner."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {
                                "type": "string",
                                "description": "Açılacak web adresi (örn: https://en.wikipedia.org).",
                            },
                            "use_proxy": {
                                "type": "boolean",
                                "description": "İsteğin anti-bot proxy havuzu üzerinden yapılıp yapılmayacağı (varsayılan: false).",
                            },
                        },
                        "required": ["url"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "thinkport_browser_snapshot",
                    "description": "Mevcut açık sayfanın güncel metnini ve [ref] numaralı öğelerini tekrar okur.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "thinkport_browser_click",
                    "description": "Sayfadaki [ref] numaralı bağlantıya, butona veya etkileşimli öğeye tıklar.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "ref": {
                                "type": "integer",
                                "description": "Tıklanacak öğenin ref numarası (örn: 12).",
                            },
                        },
                        "required": ["ref"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "thinkport_browser_type",
                    "description": "Sayfadaki [ref] numaralı metin kutusuna veya form alanına yazı yazar.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "ref": {
                                "type": "integer",
                                "description": "Yazı yazılacak öğenin ref numarası.",
                            },
                            "text": {
                                "type": "string",
                                "description": "Yazılacak metin.",
                            },
                        },
                        "required": ["ref", "text"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "thinkport_browser_scroll",
                    "description": "Sayfayı aşağı (down) veya yukarı (up) kaydırır.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "direction": {
                                "type": "string",
                                "enum": ["down", "up"],
                                "description": "Kaydırma yönü (varsayılan: down).",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "thinkport_browser_inspect_apis",
                    "description": (
                        "Açık olan veya belirtilen web sayfasını açarak sayfanın iletişim kurduğu API uç noktalarını "
                        "(fetch/xhr/stream), sunucu IP adreslerini, dinamik JavaScript verilerini (WIZ_global_data, session tokenları) "
                        "ve form kontrollerini tespit eder."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {
                                "type": "string",
                                "description": "İncelenecek sayfa adresi (isteğe bağlı, boş bırakılırsa açık sayfa incelenir).",
                            },
                            "use_proxy": {
                                "type": "boolean",
                                "description": "İsteğin anti-bot proxy havuzu üzerinden yapılıp yapılmayacağı.",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "thinkport_browser_prompt_llm",
                    "description": (
                        "LLM web arayüzünü (örn: Gemini, Claude, ChatGPT vb.) açarak dinamik güvenlik kontrollerini "
                        "(WIZ_global_data, cookies, anti-bot) inceler, istemi (prompt) hızlıca gönderir ve API akışını "
                        "dinleyerek cevabı döner."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "text": {
                                "type": "string",
                                "description": "Gönderilecek istem (prompt metni).",
                            },
                            "url": {
                                "type": "string",
                                "description": "Hedef LLM web adresi (varsayılan: https://gemini.google.com/app).",
                            },
                            "use_proxy": {
                                "type": "boolean",
                                "description": "İsteğin anti-bot proxy havuzu üzerinden yapılıp yapılmayacağı.",
                            },
                        },
                        "required": ["text"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "thinkport_browser_close",
                    "description": "Açık olan sanal tarayıcı sekmesini ve oturumunu kapatır.",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                    },
                },
            },
        ]

    def inject_browser_tools(
        self,
        existing_tools: Optional[List[Dict[str, Any]]],
        agent_config: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Ajanın araç izinlerinde 'thinkport_browser' varsa araç şemalarını ekler."""
        tools_list: List[Dict[str, Any]] = list(existing_tools) if existing_tools else []
        selected_tools = agent_config.get("secili_arac_kodlari") or []

        # Eğer ajan yetkilerinde thinkport_browser varsa veya listede zaten bir browser aracı varsa
        has_browser_perm = "thinkport_browser" in selected_tools or any(
            t in selected_tools for t in GATEWAY_BROWSER_TOOL_NAMES
        )
        if not has_browser_perm:
            return tools_list

        existing_names = set()
        for t in tools_list:
            fn = t.get("function") if isinstance(t, dict) else None
            if isinstance(fn, dict) and fn.get("name"):
                existing_names.add(str(fn["name"]))

        for b_tool in self.get_gateway_browser_tools_schema():
            t_name = b_tool["function"]["name"]
            if t_name not in existing_names:
                tools_list.append(b_tool)

        return tools_list

    def execute_browser_tool(
        self,
        tool_name: str,
        raw_arguments: Any,
        conversation_id: str,
        app_id: str = "",
        agent_id: str = "",
    ) -> str:
        """LLM çağrısını akalin-browser-module REST API servisine iletir."""
        action_map = {
            "thinkport_browser_navigate": "navigate",
            "thinkport_browser_snapshot": "snapshot",
            "thinkport_browser_click": "click",
            "thinkport_browser_type": "type",
            "thinkport_browser_scroll": "scroll",
            "thinkport_browser_inspect_apis": "inspect_apis",
            "thinkport_browser_prompt_llm": "prompt_llm",
            "thinkport_browser_close": "close",
        }
        action = action_map.get(tool_name)
        if not action:
            return json.dumps({"error": f"Bilinmeyen tarayıcı aracı: {tool_name}"}, ensure_ascii=False)

        args: Dict[str, Any] = {}
        if isinstance(raw_arguments, dict):
            args = raw_arguments
        elif isinstance(raw_arguments, str) and raw_arguments.strip():
            try:
                parsed = json.loads(raw_arguments)
                if isinstance(parsed, dict):
                    args = parsed
            except Exception:
                args = {"url": raw_arguments.strip()}

        payload: Dict[str, Any] = {
            "action": action,
            "conversation_id": conversation_id or "default-conv",
            "app_id": app_id,
            "agent_id": agent_id,
            "url": args.get("url"),
            "ref": args.get("ref"),
            "text": args.get("text"),
            "direction": args.get("direction", "down"),
            "use_proxy": bool(args.get("use_proxy", False)),
        }
        if args.get("proxy_override"):
            payload["proxy_override"] = args["proxy_override"]
        if args.get("exclude_proxy_ids"):
            payload["exclude_proxy_ids"] = args["exclude_proxy_ids"]

        api_url = f"{self.base_url}/api/browser/execute"
        try:
            req = urllib.request.Request(
                api_url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": "ThinkPortAPI/1.0"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=75.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return json.dumps(data, ensure_ascii=False)
        except Exception as exc:
            logger.warning(f"Browser motoruna bağlanılamadı ({api_url}): {exc}")
            return json.dumps({
                "error": f"Sanal tarayıcı motoru yanıt vermedi ({exc}). Lütfen 'akalin-virtual-browser' Docker konteynerinin çalıştığından emin olun."
            }, ensure_ascii=False)


browser_tool_service = BrowserToolService()
