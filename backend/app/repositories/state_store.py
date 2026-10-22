import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List
from app.core.security import hash_api_key


class InMemoryStateStore:
    """
    Bellek içi durum ve kuyruk deposu.
    Her veri koleksiyonunun başlangıç (seed) yüklemesi tek görevli metotlara ayrılmıştır.
    """

    def __init__(self) -> None:
        self.users: Dict[str, Dict[str, Any]] = {}
        self.api_keys: Dict[str, Dict[str, Any]] = {}
        self.rate_counters: Dict[str, int] = {}
        self.active_requests: Dict[str, int] = {}
        self.browser_sessions: List[Dict[str, Any]] = []
        self.proxies: List[Dict[str, Any]] = []
        self.usage_logs: List[Dict[str, Any]] = []
        self.settings: Dict[str, Any] = {}
        self.stream_channels: Dict[str, asyncio.Queue] = {}
        self.generated_images_cache: Dict[str, Dict[str, Any]] = {}
        self._initialize_seed_data()

    def _initialize_seed_data(self) -> None:
        """Tüm başlangıç verilerini sırasıyla yükler."""
        self._seed_default_settings()
        self._seed_users()
        self._seed_api_keys()
        self._seed_browser_sessions()
        self._seed_proxies()

    def _seed_default_settings(self) -> None:
        """Varsayılan sistem ayarlarını yükler."""
        self.settings = {
            "global_rpm": 600,
            "max_concurrent_browsers": 16,
            "keep_alive_interval_sec": 300,
            "enable_stealth": True,
            "auto_rotate_proxy_on_403": True,
        }

    def _seed_users(self) -> None:
        """Varsayılan sistem yöneticisi kullanıcısını yükler."""
        now_iso = datetime.now(timezone.utc).isoformat()
        self.users["sys_usr_01"] = {
            "id": "sys_usr_01",
            "email": "akalinserhat@gmail.com",
            "full_name": "Serhat Akalın",
            "role": "Sistem Yöneticisi",
            "status": "active",
            "token_quota": 1000000,
            "tokens_used": 0,
            "rpm_limit": 60,
            "concurrent_limit": 5,
            "created_at": now_iso,
        }

    def _seed_api_keys(self) -> None:
        """Örnek API anahtarı otomatik eklemesi devre dışı bırakıldı."""
        return None

    def _seed_browser_sessions(self) -> None:
        """Hazırda bekleyen (warm) çekirdek tarayıcı oturum havuzunu yükler."""
        now_iso = datetime.now(timezone.utc).isoformat()
        self.browser_sessions = [
            {
                "id": "sess-gpt-01",
                "provider": "chatgpt-web",
                "account": "pool_gpt_01@domain.com",
                "proxy": "194.36.110.12:8080 (TR-Res)",
                "status": "idle",
                "requests_served": 142,
                "is_dynamic": False,
                "created_at": now_iso,
                "last_active_at": now_iso,
                "idle_ttl_sec": 0,
            },
            {
                "id": "sess-gpt-02",
                "provider": "chatgpt-web",
                "account": "pool_gpt_02@domain.com",
                "proxy": "85.105.42.91:8080 (DE-Res)",
                "status": "idle",
                "requests_served": 98,
                "is_dynamic": False,
                "created_at": now_iso,
                "last_active_at": now_iso,
                "idle_ttl_sec": 0,
            },
            {
                "id": "sess-claude-01",
                "provider": "claude-web",
                "account": "pool_claude_01@domain.com",
                "proxy": "176.88.19.204:1080 (US-SOCKS5)",
                "status": "idle",
                "requests_served": 67,
                "is_dynamic": False,
                "created_at": now_iso,
                "last_active_at": now_iso,
                "idle_ttl_sec": 0,
            },
            {
                "id": "sess-claude-02",
                "provider": "claude-web",
                "account": "pool_claude_02@domain.com",
                "proxy": "179.43.148.19:8443 (CH-Res)",
                "status": "idle",
                "requests_served": 49,
                "is_dynamic": False,
                "created_at": now_iso,
                "last_active_at": now_iso,
                "idle_ttl_sec": 0,
            },
            {
                "id": "sess-deepseek-01",
                "provider": "deepseek-web",
                "account": "pool_ds_01@domain.com",
                "proxy": "91.93.120.44:8080 (NL-Res)",
                "status": "idle",
                "requests_served": 54,
                "is_dynamic": False,
                "created_at": now_iso,
                "last_active_at": now_iso,
                "idle_ttl_sec": 0,
            },
            {
                "id": "sess-deepseek-02",
                "provider": "deepseek-web",
                "account": "pool_ds_02@domain.com",
                "proxy": "45.76.210.88:1080 (JP-SOCKS5)",
                "status": "idle",
                "requests_served": 38,
                "is_dynamic": False,
                "created_at": now_iso,
                "last_active_at": now_iso,
                "idle_ttl_sec": 0,
            },
            {
                "id": "sess-gemini-01",
                "provider": "gemini-web",
                "account": "pool_gemini_01@domain.com",
                "proxy": "185.220.101.5:8443 (GB-Res)",
                "status": "idle",
                "requests_served": 81,
                "is_dynamic": False,
                "created_at": now_iso,
                "last_active_at": now_iso,
                "idle_ttl_sec": 0,
            },
            {
                "id": "sess-gemini-02",
                "provider": "gemini-web",
                "account": "pool_gemini_02@domain.com",
                "proxy": "64.225.88.110:8443 (US-Mobile)",
                "status": "idle",
                "requests_served": 63,
                "is_dynamic": False,
                "created_at": now_iso,
                "last_active_at": now_iso,
                "idle_ttl_sec": 0,
            },
            {
                "id": "sess-flux-01",
                "provider": "pollinations-image",
                "account": "flux_render_node_01",
                "proxy": "51.158.118.42:1080 (FR-SOCKS5)",
                "status": "idle",
                "requests_served": 115,
                "is_dynamic": False,
                "created_at": now_iso,
                "last_active_at": now_iso,
                "idle_ttl_sec": 0,
            },
        ]

    def _seed_proxies(self) -> None:
        """Çok bölgeli anti-bot proxy havuzu başlangıç düğümlerini yükler."""
        self.proxies = [
            {"id": "prx-01", "protocol": "http", "endpoint": "194.36.110.12:8080", "country": "TR", "city": "Istanbul", "proxy_type": "residential", "provider": "TurkNet Res", "latency_ms": 14, "status": "active", "fails": 0},
            {"id": "prx-02", "protocol": "socks5", "endpoint": "88.255.140.28:1080", "country": "TR", "city": "Ankara", "proxy_type": "mobile", "provider": "TR 5G Mobile", "latency_ms": 21, "status": "active", "fails": 0},
            {"id": "prx-03", "protocol": "https", "endpoint": "85.105.42.91:8080", "country": "DE", "city": "Frankfurt", "proxy_type": "residential", "provider": "BrightData EU", "latency_ms": 38, "status": "active", "fails": 0},
            {"id": "prx-04", "protocol": "socks5", "endpoint": "138.201.92.14:1080", "country": "DE", "city": "Berlin", "proxy_type": "isp", "provider": "DE-CIX Static", "latency_ms": 42, "status": "active", "fails": 0},
            {"id": "prx-05", "protocol": "socks5", "endpoint": "176.88.19.204:1080", "country": "US", "city": "New York", "proxy_type": "residential", "provider": "Oxylabs US", "latency_ms": 96, "status": "active", "fails": 1},
            {"id": "prx-06", "protocol": "https", "endpoint": "64.225.88.110:8443", "country": "US", "city": "Los Angeles", "proxy_type": "mobile", "provider": "T-Mobile 5G", "latency_ms": 134, "status": "active", "fails": 0},
            {"id": "prx-07", "protocol": "socks5", "endpoint": "198.51.100.77:1080", "country": "US", "city": "Ashburn", "proxy_type": "isp", "provider": "Smartproxy ISP", "latency_ms": 89, "status": "active", "fails": 0},
            {"id": "prx-08", "protocol": "http", "endpoint": "91.93.120.44:8080", "country": "NL", "city": "Amsterdam", "proxy_type": "residential", "provider": "IPRoyal NL", "latency_ms": 47, "status": "cooldown", "fails": 3},
            {"id": "prx-09", "protocol": "https", "endpoint": "185.220.101.5:8443", "country": "GB", "city": "London", "proxy_type": "residential", "provider": "SOAX UK", "latency_ms": 54, "status": "active", "fails": 0},
            {"id": "prx-10", "protocol": "socks5", "endpoint": "51.158.118.42:1080", "country": "FR", "city": "Paris", "proxy_type": "isp", "provider": "Scaleway FR", "latency_ms": 49, "status": "active", "fails": 0},
            {"id": "prx-11", "protocol": "https", "endpoint": "179.43.148.19:8443", "country": "CH", "city": "Zurich", "proxy_type": "residential", "provider": "SwissPrivacy", "latency_ms": 44, "status": "active", "fails": 0},
            {"id": "prx-12", "protocol": "socks5", "endpoint": "45.76.210.88:1080", "country": "JP", "city": "Tokyo", "proxy_type": "residential", "provider": "NTT Japan", "latency_ms": 168, "status": "active", "fails": 0},
            {"id": "prx-13", "protocol": "http", "endpoint": "128.199.180.52:8080", "country": "SG", "city": "Singapore", "proxy_type": "datacenter", "provider": "SingTel DC", "latency_ms": 152, "status": "active", "fails": 0},
            {"id": "prx-14", "protocol": "socks4", "endpoint": "159.203.24.91:1080", "country": "CA", "city": "Toronto", "proxy_type": "residential", "provider": "Bell Canada", "latency_ms": 108, "status": "active", "fails": 0},
            {"id": "prx-15", "protocol": "https", "endpoint": "193.138.218.60:8443", "country": "SE", "city": "Stockholm", "proxy_type": "residential", "provider": "Mullvad SE", "latency_ms": 59, "status": "active", "fails": 0},
            {"id": "prx-16", "protocol": "socks5", "endpoint": "95.216.144.33:1080", "country": "FI", "city": "Helsinki", "proxy_type": "datacenter", "provider": "NordNode FI", "latency_ms": 62, "status": "active", "fails": 0},
            {"id": "prx-17", "protocol": "socks5", "endpoint": "145.220.227.208:8080", "country": "NL", "city": "Rotterdam", "proxy_type": "residential", "provider": "KPN Fiber NL", "latency_ms": 45, "status": "active", "fails": 0},
            {"id": "prx-18", "protocol": "socks5", "endpoint": "49.13.162.163:1081", "country": "DE", "city": "Nuremberg", "proxy_type": "datacenter", "provider": "Hetzner Cloud DE", "latency_ms": 36, "status": "active", "fails": 0},
            {"id": "prx-19", "protocol": "socks5", "endpoint": "212.47.71.179:9167", "country": "FR", "city": "Marseille", "proxy_type": "isp", "provider": "OnlineSAS FR", "latency_ms": 48, "status": "active", "fails": 0},
            {"id": "prx-20", "protocol": "socks5", "endpoint": "185.151.86.121:3699", "country": "GB", "city": "Manchester", "proxy_type": "residential", "provider": "BT Broadband UK", "latency_ms": 56, "status": "active", "fails": 0},
            {"id": "prx-21", "protocol": "socks5", "endpoint": "192.252.215.5:16137", "country": "US", "city": "Chicago", "proxy_type": "residential", "provider": "Comcast Xfinity", "latency_ms": 104, "status": "active", "fails": 0},
            {"id": "prx-22", "protocol": "socks5", "endpoint": "208.102.51.6:58208", "country": "US", "city": "Dallas", "proxy_type": "mobile", "provider": "AT&T 5G US", "latency_ms": 118, "status": "active", "fails": 0},
            {"id": "prx-23", "protocol": "socks5", "endpoint": "142.54.237.34:4145", "country": "US", "city": "Kansas City", "proxy_type": "isp", "provider": "Wholesale ISP", "latency_ms": 112, "status": "active", "fails": 0},
            {"id": "prx-24", "protocol": "socks5", "endpoint": "184.170.245.148:4145", "country": "US", "city": "Phoenix", "proxy_type": "residential", "provider": "Cox Residential", "latency_ms": 127, "status": "active", "fails": 0},
            {"id": "prx-25", "protocol": "http", "endpoint": "91.107.143.251:80", "country": "DE", "city": "Falkenstein", "proxy_type": "datacenter", "provider": "Hetzner Edge", "latency_ms": 39, "status": "active", "fails": 0},
            {"id": "prx-26", "protocol": "http", "endpoint": "137.74.50.101:15054", "country": "PL", "city": "Warsaw", "proxy_type": "isp", "provider": "OVH Poland", "latency_ms": 51, "status": "active", "fails": 0},
            {"id": "prx-27", "protocol": "https", "endpoint": "82.69.119.68:49200", "country": "GB", "city": "Bristol", "proxy_type": "residential", "provider": "Virgin Media UK", "latency_ms": 58, "status": "active", "fails": 0},
            {"id": "prx-28", "protocol": "http", "endpoint": "195.114.209.50:80", "country": "PL", "city": "Krakow", "proxy_type": "residential", "provider": "Orange Polska", "latency_ms": 53, "status": "active", "fails": 0},
            {"id": "prx-29", "protocol": "https", "endpoint": "5.45.126.128:8080", "country": "AT", "city": "Vienna", "proxy_type": "isp", "provider": "A1 Telekom AT", "latency_ms": 41, "status": "active", "fails": 0},
            {"id": "prx-30", "protocol": "http", "endpoint": "174.138.119.88:80", "country": "CA", "city": "Montreal", "proxy_type": "datacenter", "provider": "DigitalOcean CA", "latency_ms": 102, "status": "active", "fails": 0},
            {"id": "prx-31", "protocol": "socks5", "endpoint": "8.219.94.23:7890", "country": "SG", "city": "Jurong", "proxy_type": "datacenter", "provider": "Alibaba Cloud SG", "latency_ms": 146, "status": "active", "fails": 0},
            {"id": "prx-32", "protocol": "socks5", "endpoint": "193.200.85.129:1081", "country": "IT", "city": "Milan", "proxy_type": "residential", "provider": "Fastweb IT", "latency_ms": 46, "status": "active", "fails": 0},
            {"id": "prx-33", "protocol": "socks5", "endpoint": "146.19.143.200:1081", "country": "ES", "city": "Madrid", "proxy_type": "residential", "provider": "Telefonica ES", "latency_ms": 61, "status": "active", "fails": 0},
            {"id": "prx-34", "protocol": "socks4", "endpoint": "149.248.201.109:9000", "country": "CH", "city": "Geneva", "proxy_type": "isp", "provider": "Swisscom ISP", "latency_ms": 45, "status": "active", "fails": 0},
            {"id": "prx-35", "protocol": "socks4", "endpoint": "72.195.34.41:4145", "country": "US", "city": "Seattle", "proxy_type": "residential", "provider": "Verizon Fios", "latency_ms": 129, "status": "active", "fails": 0},
            {"id": "prx-36", "protocol": "socks4", "endpoint": "66.42.224.229:41679", "country": "JP", "city": "Osaka", "proxy_type": "datacenter", "provider": "Vultr Osaka", "latency_ms": 162, "status": "active", "fails": 0},
            {"id": "prx-37", "protocol": "socks4", "endpoint": "46.101.148.225:10000", "country": "GB", "city": "London", "proxy_type": "datacenter", "provider": "LON1 Edge", "latency_ms": 52, "status": "active", "fails": 0},
            {"id": "prx-38", "protocol": "socks4", "endpoint": "167.99.3.26:11080", "country": "NL", "city": "Amsterdam", "proxy_type": "datacenter", "provider": "AMS3 Core", "latency_ms": 43, "status": "active", "fails": 0},
            {"id": "prx-39", "protocol": "https", "endpoint": "212.156.98.44:8443", "country": "TR", "city": "Izmir", "proxy_type": "residential", "provider": "TurkTelekom Fiber", "latency_ms": 19, "status": "active", "fails": 0},
            {"id": "prx-40", "protocol": "socks5", "endpoint": "176.240.112.75:1080", "country": "TR", "city": "Bursa", "proxy_type": "mobile", "provider": "Vodafone TR 5G", "latency_ms": 23, "status": "active", "fails": 0},
        ]


store = InMemoryStateStore()
