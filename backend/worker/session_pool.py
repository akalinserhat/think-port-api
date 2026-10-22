import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Dict, List, Optional
from playwright.async_api import async_playwright, Browser, BrowserContext, Page
from worker.dtos import WarmSessionConfigDTO

logger = logging.getLogger("browser_engine")

STEALTH_INIT_SCRIPT = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
window.chrome = { runtime: {} };
"""

PROVIDER_URLS: Dict[str, str] = {
    "chatgpt-web": "https://chatgpt.com/",
    "claude-web": "https://claude.ai/new",
    "deepseek-web": "https://chat.deepseek.com/",
    "gemini-web": "https://gemini.google.com/app",
}


@dataclass
class WarmTabSession:
    """Hazırda bekleyen (warm) veya dinamik üretilmiş bir tarayıcı sekmesinin çalışma zamanı durumu."""

    session_id: str
    provider: str
    account_id: str
    context: BrowserContext
    page: Page
    proxy_url: Optional[str] = None
    is_busy: bool = False
    requests_served: int = 0
    is_dynamic: bool = False
    idle_ttl_sec: int = 300
    last_active_at: float = field(default_factory=time.time)


class BrowserSessionPool:
    """
    Hibrit Tarayıcı Oturum Havuzu (Warm Standby + Dinamik Auto-Scaling) Servisi.
    Her metot yalnızca tek bir havuz yaşam döngüsü görevini (başlatma, oturum oluşturma,
    otomatik ölçekleme, oturum kilit/serbest bırakma, TTL temizleme ve keep-alive) yerine getirir.
    """

    def __init__(self, max_sessions: int = 16, default_idle_ttl_sec: int = 300) -> None:
        self.max_sessions = max_sessions
        self.default_idle_ttl_sec = default_idle_ttl_sec
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.sessions: Dict[str, List[WarmTabSession]] = {
            "chatgpt-web": [],
            "claude-web": [],
            "deepseek-web": [],
            "gemini-web": [],
        }
        self._lock = asyncio.Lock()

    def total_session_count(self) -> int:
        """Havuzdaki toplam aktif tarayıcı oturumu sayısını döner."""
        return sum(len(pool) for pool in self.sessions.values())

    async def start(self) -> None:
        """Playwright motorunu ve başsız (headless) Chromium sürecini başlatır."""
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-infobars",
            ],
        )
        logger.info("Playwright Chromium motoru başlatıldı.")

    async def create_warm_session_from_dto(self, config: WarmSessionConfigDTO) -> WarmTabSession:
        """WarmSessionConfigDTO kullanarak yeni bir izole sekme hazırlar ve havuza ekler."""
        return await self.create_warm_session(
            session_id=config.session_id,
            provider=config.provider,
            account_id=config.account_id,
            storage_state=config.storage_state,
            proxy_server=config.proxy_server,
            user_agent=config.user_agent,
            is_dynamic=False,
        )

    async def create_warm_session(
        self,
        session_id: str,
        provider: str,
        account_id: str,
        storage_state: Dict[str, Any],
        proxy_server: Optional[str] = None,
        user_agent: Optional[str] = None,
        is_dynamic: bool = False,
        idle_ttl_sec: Optional[int] = None,
    ) -> WarmTabSession:
        """İzole BrowserContext oluşturur, stealth enjekte eder ve hedef sayfayı açar."""
        if not self.browser:
            raise RuntimeError("Tarayıcı motoru henüz başlatılmadı (start() çağrılmalı).")

        context_opts = self._build_context_options(storage_state, proxy_server, user_agent)
        context = await self.browser.new_context(**context_opts)
        await self._inject_stealth_script(context)
        page = await self._open_provider_page(context, provider)

        warm_session = WarmTabSession(
            session_id=session_id,
            provider=provider,
            account_id=account_id,
            context=context,
            page=page,
            proxy_url=proxy_server,
            is_dynamic=is_dynamic,
            idle_ttl_sec=idle_ttl_sec or self.default_idle_ttl_sec,
            last_active_at=time.time(),
        )
        async with self._lock:
            self.sessions.setdefault(provider, []).append(warm_session)

        mode_label = "Dynamic session" if is_dynamic else "Warm session"
        logger.info(f"[{provider}] {mode_label} hazır: {account_id} (Proxy: {proxy_server})")
        return warm_session

    async def spawn_dynamic_session(
        self,
        provider: str,
        proxy_server: Optional[str] = None,
        storage_state: Optional[Dict[str, Any]] = None,
    ) -> WarmTabSession:
        """Trafik yoğunluğunda ilgili sağlayıcı için anında yeni bir dinamik sekme üretir."""
        short_id = uuid.uuid4().hex[:4]
        prefix = provider.split("-")[0]
        session_id = f"sess-{prefix}-dyn-{short_id}"
        account_id = f"dyn_{prefix}_{short_id}@autoscale.pool"
        return await self.create_warm_session(
            session_id=session_id,
            provider=provider,
            account_id=account_id,
            storage_state=storage_state or {},
            proxy_server=proxy_server,
            is_dynamic=True,
            idle_ttl_sec=self.default_idle_ttl_sec,
        )

    async def acquire_session(self, provider: str) -> WarmTabSession:
        """
        İlgili sağlayıcı için en az yüklenmiş boşta (idle) oturumu kilitler.
        Boşta oturum yoksa ve maksimum kapasite aşılmadıysa dinamik oturum başlatır (Auto-Scale Up).
        """
        for _ in range(60):
            can_spawn = False
            template_proxy: Optional[str] = None
            async with self._lock:
                chosen = self._select_least_loaded_idle_session(provider)
                if chosen:
                    chosen.is_busy = True
                    chosen.last_active_at = time.time()
                    return chosen
                if self.browser and self.total_session_count() < self.max_sessions:
                    can_spawn = True
                    existing_pool = self.sessions.get(provider, [])
                    if existing_pool:
                        template_proxy = existing_pool[0].proxy_url

            if can_spawn:
                try:
                    spawned = await self.spawn_dynamic_session(
                        provider=provider,
                        proxy_server=template_proxy,
                    )
                    async with self._lock:
                        spawned.is_busy = True
                        spawned.last_active_at = time.time()
                    return spawned
                except Exception as exc:
                    logger.warning(f"[{provider}] Dinamik oturum başlatılamadı, havuz bekleniyor: {exc}")

            await asyncio.sleep(0.5)

        raise RuntimeError(f"[{provider}] Uygun browser oturumu bulunamadı (Havuz dolu).")

    async def release_session(
        self,
        session: WarmTabSession,
        save_cookies_callback: Optional[Callable[[str, Dict[str, Any]], Coroutine[Any, Any, None]]] = None,
    ) -> None:
        """Güncel çerezleri kaydeder ve sekmeyi tekrar boşta (idle) olarak havuza bırakır."""
        try:
            if save_cookies_callback:
                updated_state = await session.context.storage_state()
                await save_cookies_callback(session.session_id, updated_state)
        finally:
            async with self._lock:
                session.requests_served += 1
                session.last_active_at = time.time()
                session.is_busy = False

    async def prune_expired_dynamic_sessions(self) -> int:
        """TTL süresi dolmuş boşta (idle) dinamik sekmeleri kapatır ve RAM iadesi yapar (Scale-Down)."""
        now = time.time()
        to_close: List[WarmTabSession] = []
        async with self._lock:
            for provider, pool in self.sessions.items():
                kept: List[WarmTabSession] = []
                for session in pool:
                    is_expired = (
                        session.is_dynamic
                        and not session.is_busy
                        and (now - session.last_active_at) >= session.idle_ttl_sec
                    )
                    if is_expired:
                        to_close.append(session)
                    else:
                        kept.append(session)
                self.sessions[provider] = kept

        for session in to_close:
            try:
                await session.context.close()
                logger.info(f"[{session.provider}] Dinamik oturum TTL süresi dolduğu için kapatıldı: {session.session_id}")
            except Exception as exc:
                logger.warning(f"Dinamik oturum kapatılırken hata ({session.session_id}): {exc}")

        return len(to_close)

    async def keep_alive_loop(self, interval_sec: int = 300) -> None:
        """
        Boşta duran sekmelerde periyodik aktivite tetikleyerek oturumların düşmesini önler
        ve süresi dolan dinamik oturumları temizler.
        """
        while True:
            await asyncio.sleep(interval_sec)
            await self.prune_expired_dynamic_sessions()
            async with self._lock:
                for pool in self.sessions.values():
                    for session in pool:
                        if not session.is_busy:
                            await self._send_heartbeat_event(session)

    def _select_least_loaded_idle_session(self, provider: str) -> Optional[WarmTabSession]:
        """Havuzdaki boşta olan oturumlar arasından önce sabit (warm), sonra en az istek sunmuş olanı seçer."""
        pool = self.sessions.get(provider, [])
        idle_sessions = [s for s in pool if not s.is_busy]
        if not idle_sessions:
            return None
        return min(idle_sessions, key=lambda s: (1 if s.is_dynamic else 0, s.requests_served))

    @staticmethod
    def _build_context_options(
        storage_state: Dict[str, Any],
        proxy_server: Optional[str],
        user_agent: Optional[str],
    ) -> Dict[str, Any]:
        """Playwright BrowserContext başlatma seçeneklerini hazırlar."""
        opts: Dict[str, Any] = {
            "viewport": {"width": 1366, "height": 768},
            "locale": "en-US",
        }
        if storage_state and storage_state.get("cookies"):
            opts["storage_state"] = storage_state
        if proxy_server:
            opts["proxy"] = {"server": proxy_server}
        if user_agent:
            opts["user_agent"] = user_agent
        return opts

    @staticmethod
    async def _inject_stealth_script(context: BrowserContext) -> None:
        """Otomasyon izlerini gizleyen başlangıç betiğini BrowserContext'e ekler."""
        await context.add_init_script(STEALTH_INIT_SCRIPT)

    @classmethod
    async def _open_provider_page(cls, context: BrowserContext, provider: str) -> Page:
        """Yeni sekme açar ve sağlayıcının başlangıç URL'sine gider."""
        page = await context.new_page()
        target_url = cls._get_provider_url(provider)
        await page.goto(target_url, wait_until="domcontentloaded", timeout=45000)
        return page

    @staticmethod
    async def _send_heartbeat_event(session: WarmTabSession) -> None:
        """Tek bir sekmede hafif fare hareketi olayı tetikler."""
        try:
            await session.page.evaluate("() => window.dispatchEvent(new Event('mousemove'))")
        except Exception as exc:
            logger.warning(f"Session {session.session_id} keep-alive hatası: {exc}")

    @staticmethod
    def _get_provider_url(provider: str) -> str:
        """Sağlayıcı koduna karşılık gelen hedef web URL'sini döner."""
        return PROVIDER_URLS.get(provider, "https://chatgpt.com/")
