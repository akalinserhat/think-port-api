from datetime import datetime, timezone
from typing import Any, Dict, List
from app.core.logger import gateway_logger
from app.dtos.admin_dto import (
    BrowserSessionDTO,
    CreateBrowserSessionRequestDTO,
    PoolDashboardMetricsDTO,
    PoolDashboardSummaryDTO,
    PoolScalingEventDTO,
    PoolTimelinePointDTO,
    ProviderPoolStatDTO,
    ProxyRegionStatDTO,
)
from app.repositories.proxy_repository import proxy_module_db
from app.repositories.state_store import InMemoryStateStore


class SessionRepository:
    """
    Tarayıcı oturumları (Warm Standby + Dinamik Auto-Scaling Havuzu) veri erişim katmanı.
    Tüm oturumları, zaman serisi anlık görüntülerini ('pool_metrics_snapshots') ve
    ölçeklenme olaylarını ('pool_scaling_events') @akalin/proxy_module'e ait bağımsız
    PostgreSQL veritabanı (`akalin_proxy_db`) üzerinde yönetir.
    """

    def __init__(self, state_store: InMemoryStateStore) -> None:
        self._store = state_store
        self._sync_store_from_db()

    def _sync_store_from_db(self) -> List[Dict[str, Any]]:
        try:
            sessions = proxy_module_db.list_sessions()
            proxies = proxy_module_db.list_proxies()
            self._store.browser_sessions = sessions
            self._store.proxies = proxies
            return sessions
        except Exception:
            return self._store.browser_sessions

    def list_all(self) -> List[BrowserSessionDTO]:
        """Süresi dolan dinamik oturumları temizler ve `akalin_proxy_db` üzerindeki tüm oturumları döner."""
        rows = self._sync_store_from_db()
        return [BrowserSessionDTO(**s) for s in rows]

    def acquire_session_for_provider(self, provider: str) -> BrowserSessionDTO:
        """
        İlgili sağlayıcı için `akalin_proxy_db` üzerinden en az yüklenmiş boşta (idle) oturumu seçer.
        Tüm oturumlar meşgulse (busy) ve üst sınır aşılmamışsa anında dinamik oturum üretir.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        if provider in ("local-engine", "external-api"):
            return BrowserSessionDTO(
                id=f"sess-{provider}",
                provider=provider,
                account=f"{provider}@local",
                proxy="Direct / Local Socket",
                status="busy",
                requests_served=0,
                is_dynamic=False,
                created_at=now_iso,
                last_active_at=now_iso,
                idle_ttl_sec=0,
            )

        self._sync_store_from_db()
        idle_candidates = [
            s
            for s in self._store.browser_sessions
            if s["provider"] == provider and s["status"] == "idle"
        ]
        if idle_candidates:
            chosen = min(idle_candidates, key=lambda x: x.get("requests_served", 0))
            with proxy_module_db.connection() as conn:
                conn.execute(
                    "UPDATE browser_sessions SET status = 'busy', last_active_at = ? WHERE id = ?",
                    (now_iso, chosen["id"]),
                )
            chosen["status"] = "busy"
            chosen["last_active_at"] = now_iso
            self.record_pool_snapshot()
            self._sync_store_from_db()
            return BrowserSessionDTO(**chosen)

        max_browsers = int(self._store.settings.get("max_concurrent_browsers", 16))
        if len(self._store.browser_sessions) < max_browsers:
            req = CreateBrowserSessionRequestDTO(
                provider=provider,
                is_dynamic=True,
                idle_ttl_sec=int(self._store.settings.get("keep_alive_interval_sec", 300)),
            )
            spawned = self.spawn_dynamic_session(
                req,
                initial_status="busy",
                event_type="autoscale_up",
                event_detail=f"{provider} kuyruğu için dinamik oturum otomatik ölçeklendirildi.",
            )
            gateway_logger.info(
                f"SESSION_AUTOSCALE_UP | id={spawned.id} | provider={provider} | proxy='{spawned.proxy}' "
                f"| total_sessions={len(self._store.browser_sessions)}/{max_browsers}"
            )
            return spawned

        provider_sessions = [
            s for s in self._store.browser_sessions if s["provider"] == provider
        ]
        if provider_sessions:
            fallback = min(provider_sessions, key=lambda x: x.get("requests_served", 0))
        elif self._store.browser_sessions:
            fallback = self._store.browser_sessions[0]
        else:
            return BrowserSessionDTO(
                id=f"sess-{provider}-fallback",
                provider=provider,
                account=f"{provider}@gateway",
                proxy="Direct / Gateway IP",
                status="busy",
                requests_served=0,
                is_dynamic=True,
                created_at=now_iso,
                last_active_at=now_iso,
                idle_ttl_sec=300,
            )

        with proxy_module_db.connection() as conn:
            conn.execute(
                "UPDATE browser_sessions SET status = 'busy', last_active_at = ? WHERE id = ?",
                (now_iso, fallback["id"]),
            )
        fallback["status"] = "busy"
        fallback["last_active_at"] = now_iso
        self.record_pool_snapshot()
        self._sync_store_from_db()
        return BrowserSessionDTO(**fallback)

    def release_session(self, session_id: str) -> None:
        """Oturumu `akalin_proxy_db` üzerinde 'idle' durumuna döndürür ve sayacı artırır."""
        now_iso = datetime.now(timezone.utc).isoformat()
        with proxy_module_db.connection() as conn:
            conn.execute(
                """
                UPDATE browser_sessions
                SET status = 'idle',
                    requests_served = COALESCE(requests_served, 0) + 1,
                    last_active_at = ?
                WHERE id = ?
                """,
                (now_iso, session_id),
            )
        self.record_pool_snapshot()
        self._sync_store_from_db()

    def spawn_dynamic_session(
        self,
        req: CreateBrowserSessionRequestDTO,
        initial_status: str = "idle",
        event_type: str = "manual_spawn",
        event_detail: str = "",
    ) -> BrowserSessionDTO:
        """Seçilen sağlayıcı ve en uygun aktif proxy ile `akalin_proxy_db`'de yeni tarayıcı oturumu başlatır."""
        created = proxy_module_db.spawn_dynamic_session(
            provider=req.provider,
            account=req.account,
            proxy_id=req.proxy_id,
            is_dynamic=req.is_dynamic,
            idle_ttl_sec=req.idle_ttl_sec,
            initial_status=initial_status,
            event_type=event_type,
            event_detail=event_detail,
        )
        self._sync_store_from_db()
        return BrowserSessionDTO(**created)

    def terminate_session(self, session_id: str) -> bool:
        """Belirtilen tarayıcı oturumunu `akalin_proxy_db` havuzundan kaldırır."""
        removed = proxy_module_db.terminate_session(session_id)
        if removed:
            gateway_logger.info(f"SESSION_TERMINATED | id={session_id}")
        self._sync_store_from_db()
        return removed

    def prune_idle_dynamic_sessions(self) -> int:
        """Boşta (idle) bekleyen tüm dinamik oturumları `akalin_proxy_db` üzerinden kapatır."""
        pruned_count = proxy_module_db.prune_idle_dynamic_sessions()
        if pruned_count > 0:
            gateway_logger.info(f"SESSION_AUTOSCALE_DOWN | pruned_count={pruned_count} | reason=manual_prune")
        self._sync_store_from_db()
        return pruned_count

    def record_pool_snapshot(self) -> None:
        """Anlık tarayıcı oturumu ve proxy havuzu metriklerini `akalin_proxy_db` veritabanına kaydeder."""
        max_cap = int(self._store.settings.get("max_concurrent_browsers", 16))
        try:
            proxy_module_db.record_pool_snapshot(max_capacity=max_cap)
        except Exception as exc:
            gateway_logger.warning(f"POOL_SNAPSHOT_WRITE_WARN | err={exc}")

    def record_scaling_event(
        self,
        event_type: str,
        session_id: str = "",
        provider: str = "",
        proxy_endpoint: str = "",
        detail: str = "",
    ) -> None:
        """Havuz ölçeklenme veya yaşam döngüsü olayını `akalin_proxy_db` veritabanına kaydeder."""
        try:
            proxy_module_db.record_scaling_event(
                event_type=event_type,
                session_id=session_id,
                provider=provider,
                proxy_endpoint=proxy_endpoint,
                detail=detail,
            )
        except Exception as exc:
            gateway_logger.warning(f"POOL_EVENT_WRITE_WARN | err={exc}")

    def get_pool_dashboard_metrics(self) -> PoolDashboardMetricsDTO:
        """
        `akalin_proxy_db` veritabanındaki zaman serisi çizelgesini, ölçeklenme olaylarını
        ve anlık oturum/proxy dağılımlarını birleştirerek Dashboard DTO'su döner.
        """
        max_cap = int(self._store.settings.get("max_concurrent_browsers", 16))
        raw = proxy_module_db.get_pool_dashboard_metrics(max_capacity=max_cap)
        self._sync_store_from_db()

        return PoolDashboardMetricsDTO(
            summary=PoolDashboardSummaryDTO(**raw["summary"]),
            timeline=[PoolTimelinePointDTO(**pt) for pt in raw["timeline"]],
            provider_distribution=[ProviderPoolStatDTO(**pr) for pr in raw["provider_distribution"]],
            proxy_region_distribution=[ProxyRegionStatDTO(**rg) for rg in raw["proxy_region_distribution"]],
            recent_events=[PoolScalingEventDTO(**ev) for ev in raw["recent_events"]],
        )
