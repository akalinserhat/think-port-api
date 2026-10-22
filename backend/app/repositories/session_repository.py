import uuid
from datetime import datetime, timezone, timedelta
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
from app.repositories.sqlite_db import sqlite_db
from app.repositories.state_store import InMemoryStateStore

PROVIDER_SHORT_PREFIX: Dict[str, str] = {
    "chatgpt-web": "gpt",
    "claude-web": "claude",
    "deepseek-web": "deepseek",
    "gemini-web": "gemini",
    "pollinations-image": "flux",
}


class SessionRepository:
    """
    Tarayıcı oturumları (Warm Standby + Dinamik Auto-Scaling Havuzu) veri erişim katmanı.
    Boşta oturum kalmadığında 'max_concurrent_browsers' sınırına kadar otomatik yeni oturum
    açar, en uygun aktif proxy düğümünü atar, süresi dolan dinamik oturumları temizler
    ve tüm havuz telemetrisini SQLite veritabanına ('pool_metrics_snapshots' & 'pool_scaling_events') yazar.
    """

    def __init__(self, state_store: InMemoryStateStore) -> None:
        self._store = state_store

    def list_all(self) -> List[BrowserSessionDTO]:
        """Süresi dolan dinamik oturumları temizler ve tüm aktif tarayıcı oturumlarını döner."""
        self._prune_expired_dynamic_sessions()
        return [BrowserSessionDTO(**s) for s in self._store.browser_sessions]

    def acquire_session_for_provider(self, provider: str) -> BrowserSessionDTO:
        """
        İlgili sağlayıcı için en az yüklenmiş boşta (idle) oturumu seçer.
        Tüm oturumlar meşgulse (busy) ve üst sınır aşılmamışsa anında dinamik oturum üretir.
        Yerel Ollama ('local-engine') veya harici API ('external-api') için tarayıcı havuzunu kirletmez.
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

        self._prune_expired_dynamic_sessions()

        idle_candidates = [
            s
            for s in self._store.browser_sessions
            if s["provider"] == provider and s["status"] == "idle"
        ]
        if idle_candidates:
            chosen = min(idle_candidates, key=lambda x: x.get("requests_served", 0))
            chosen["status"] = "busy"
            chosen["last_active_at"] = now_iso
            self.record_pool_snapshot()
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
        fallback["status"] = "busy"
        fallback["last_active_at"] = now_iso
        self.record_pool_snapshot()
        return BrowserSessionDTO(**fallback)

    def release_session(self, session_id: str) -> None:
        """Oturumu 'idle' durumuna döndürür, sayacı artırır ve süresi dolan dinamik oturumları temizler."""
        now_iso = datetime.now(timezone.utc).isoformat()
        for s in self._store.browser_sessions:
            if s["id"] == session_id:
                s["status"] = "idle"
                s["requests_served"] = int(s.get("requests_served", 0)) + 1
                s["last_active_at"] = now_iso
                break
        self._prune_expired_dynamic_sessions()
        self.record_pool_snapshot()

    def spawn_dynamic_session(
        self,
        req: CreateBrowserSessionRequestDTO,
        initial_status: str = "idle",
        event_type: str = "manual_spawn",
        event_detail: str = "",
    ) -> BrowserSessionDTO:
        """Seçilen sağlayıcı ve en uygun aktif proxy ile yeni bir dinamik tarayıcı oturumu başlatır."""
        now_iso = datetime.now(timezone.utc).isoformat()
        short_prefix = PROVIDER_SHORT_PREFIX.get(req.provider, "node")
        short_uid = uuid.uuid4().hex[:4]
        mode_tag = "dyn" if req.is_dynamic else "warm"
        session_id = f"sess-{short_prefix}-{mode_tag}-{short_uid}"

        account = req.account.strip() or f"auto_{short_prefix}_{short_uid}@pool.local"
        proxy_label = self._resolve_proxy_label(req.proxy_id)

        new_session: Dict[str, Any] = {
            "id": session_id,
            "provider": req.provider,
            "account": account,
            "proxy": proxy_label,
            "status": initial_status,
            "requests_served": 0,
            "is_dynamic": req.is_dynamic,
            "created_at": now_iso,
            "last_active_at": now_iso,
            "idle_ttl_sec": req.idle_ttl_sec if req.is_dynamic else 0,
        }
        self._store.browser_sessions.append(new_session)
        detail_msg = event_detail or (
            f"Yönetici tarafından yeni dinamik oturum başlatıldı (TTL: {req.idle_ttl_sec}s)."
        )
        self.record_scaling_event(
            event_type=event_type,
            session_id=session_id,
            provider=req.provider,
            proxy_endpoint=proxy_label,
            detail=detail_msg,
        )
        self.record_pool_snapshot()
        return BrowserSessionDTO(**new_session)

    def terminate_session(self, session_id: str) -> bool:
        """Belirtilen tarayıcı oturumunu havuzdan kaldırır."""
        target = next((s for s in self._store.browser_sessions if s["id"] == session_id), None)
        before_len = len(self._store.browser_sessions)
        self._store.browser_sessions = [
            s for s in self._store.browser_sessions if s["id"] != session_id
        ]
        removed = len(self._store.browser_sessions) < before_len
        if removed:
            gateway_logger.info(f"SESSION_TERMINATED | id={session_id}")
            self.record_scaling_event(
                event_type="session_terminated",
                session_id=session_id,
                provider=str(target.get("provider", "")) if target else "",
                proxy_endpoint=str(target.get("proxy", "")) if target else "",
                detail="Tarayıcı oturumu yönetici tarafından sonlandırıldı.",
            )
            self.record_pool_snapshot()
        return removed

    def prune_idle_dynamic_sessions(self) -> int:
        """Boşta (idle) bekleyen tüm dinamik oturumları anında kapatır ve silinen sayıyı döner."""
        kept: List[Dict[str, Any]] = []
        removed_sessions: List[Dict[str, Any]] = []
        for s in self._store.browser_sessions:
            if s.get("is_dynamic") and s.get("status") == "idle":
                removed_sessions.append(s)
                gateway_logger.info(f"SESSION_AUTOSCALE_DOWN | id={s['id']} | reason=manual_prune")
            else:
                kept.append(s)
        self._store.browser_sessions = kept
        for rs in removed_sessions:
            self.record_scaling_event(
                event_type="autoscale_down",
                session_id=rs["id"],
                provider=rs.get("provider", ""),
                proxy_endpoint=rs.get("proxy", ""),
                detail="Boştaki dinamik oturum havuz temizliği ile kapatıldı.",
            )
        if removed_sessions:
            self.record_pool_snapshot()
        return len(removed_sessions)

    def _prune_expired_dynamic_sessions(self) -> None:
        """Boşta kalma süresi (idle_ttl_sec) dolan dinamik oturumları otomatik sonlandırır."""
        now_dt = datetime.now(timezone.utc)
        kept: List[Dict[str, Any]] = []
        expired: List[Dict[str, Any]] = []
        for s in self._store.browser_sessions:
            if not s.get("is_dynamic") or s.get("status") != "idle":
                kept.append(s)
                continue

            ttl_sec = int(s.get("idle_ttl_sec") or 300)
            if ttl_sec <= 0:
                kept.append(s)
                continue

            last_active_str = s.get("last_active_at") or s.get("created_at")
            try:
                last_dt = datetime.fromisoformat(str(last_active_str))
                idle_seconds = (now_dt - last_dt).total_seconds()
                if idle_seconds >= ttl_sec:
                    gateway_logger.info(
                        f"SESSION_AUTOSCALE_DOWN | id={s['id']} | idle_sec={int(idle_seconds)} | ttl={ttl_sec}"
                    )
                    expired.append(s)
                    continue
            except Exception:
                pass
            kept.append(s)

        self._store.browser_sessions = kept
        for exp in expired:
            self.record_scaling_event(
                event_type="autoscale_down",
                session_id=exp["id"],
                provider=exp.get("provider", ""),
                proxy_endpoint=exp.get("proxy", ""),
                detail=f"Boşta kalma süresi (TTL: {exp.get('idle_ttl_sec', 300)}s) dolduğu için otomatik kapatıldı.",
            )
        if expired:
            self.record_pool_snapshot()

    def record_pool_snapshot(self) -> None:
        """Anlık tarayıcı oturumu ve proxy havuzu metriklerini SQLite 'pool_metrics_snapshots' tablosuna kaydeder."""
        now_dt = datetime.now(timezone.utc)
        time_label = (now_dt + timedelta(hours=3)).strftime("%H:%M:%S")
        sessions = self._store.browser_sessions
        proxies = self._store.proxies

        total_sessions = len(sessions)
        busy_sessions = sum(1 for s in sessions if s.get("status") != "idle")
        idle_sessions = total_sessions - busy_sessions
        warm_sessions = sum(1 for s in sessions if not s.get("is_dynamic"))
        dynamic_sessions = total_sessions - warm_sessions
        max_cap = int(self._store.settings.get("max_concurrent_browsers", 16))

        active_proxies = sum(1 for p in proxies if p.get("status") == "active")
        cooldown_proxies = len(proxies) - active_proxies
        latencies = [int(p.get("latency_ms") or 50) for p in proxies]
        avg_latency = round(sum(latencies) / len(latencies)) if latencies else 48
        rpm_estimate = max(8, busy_sessions * 7 + (total_sessions * 2))

        snap_id = f"snap_{uuid.uuid4().hex[:12]}"
        try:
            with sqlite_db.connection() as conn:
                conn.execute(
                    """
                    INSERT INTO pool_metrics_snapshots (
                        id, timestamp_iso, time_label, total_sessions,
                        active_busy_sessions, idle_sessions, warm_sessions, dynamic_sessions,
                        max_capacity, active_proxies, cooldown_proxies,
                        avg_proxy_latency_ms, requests_per_min
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        snap_id,
                        now_dt.isoformat(),
                        time_label,
                        total_sessions,
                        busy_sessions,
                        idle_sessions,
                        warm_sessions,
                        dynamic_sessions,
                        max_cap,
                        active_proxies,
                        cooldown_proxies,
                        avg_latency,
                        rpm_estimate,
                    ),
                )
                # Tabloyu en güncel 60 kayıtla sınırla
                conn.execute(
                    """
                    DELETE FROM pool_metrics_snapshots
                    WHERE id NOT IN (
                        SELECT id FROM pool_metrics_snapshots
                        ORDER BY timestamp_iso DESC
                        LIMIT 60
                    )
                    """
                )
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
        """Havuz ölçeklenme veya yaşam döngüsü olayını SQLite 'pool_scaling_events' tablosuna kaydeder."""
        now_iso = datetime.now(timezone.utc).isoformat()
        evt_id = f"evt_{uuid.uuid4().hex[:12]}"
        total_after = len(self._store.browser_sessions)
        try:
            with sqlite_db.connection() as conn:
                conn.execute(
                    """
                    INSERT INTO pool_scaling_events (
                        id, event_type, session_id, provider,
                        proxy_endpoint, detail, total_sessions_after, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        evt_id,
                        event_type,
                        session_id,
                        provider,
                        proxy_endpoint,
                        detail,
                        total_after,
                        now_iso,
                    ),
                )
        except Exception as exc:
            gateway_logger.warning(f"POOL_EVENT_WRITE_WARN | err={exc}")

    def get_pool_dashboard_metrics(self) -> PoolDashboardMetricsDTO:
        """
        SQLite veritabanındaki zaman serisi çizelgesini, ölçeklenme olaylarını
        ve anlık oturum/proxy dağılımlarını birleştirerek Dashboard DTO'su döner.
        """
        self._prune_expired_dynamic_sessions()
        sessions = self._store.browser_sessions
        proxies = self._store.proxies
        max_cap = int(self._store.settings.get("max_concurrent_browsers", 16))

        total_sessions = len(sessions)
        busy_sessions = sum(1 for s in sessions if s.get("status") != "idle")
        idle_sessions = total_sessions - busy_sessions
        warm_sessions = sum(1 for s in sessions if not s.get("is_dynamic"))
        dynamic_sessions = total_sessions - warm_sessions
        total_requests = sum(int(s.get("requests_served") or 0) for s in sessions)
        utilization_pct = round((total_sessions / max(1, max_cap)) * 100, 1)

        active_proxies = sum(1 for p in proxies if p.get("status") == "active")
        cooldown_proxies = len(proxies) - active_proxies
        latencies = [int(p.get("latency_ms") or 50) for p in proxies]
        avg_latency = round(sum(latencies) / len(latencies)) if latencies else 48

        timeline: List[PoolTimelinePointDTO] = []
        recent_events: List[PoolScalingEventDTO] = []
        autoscale_count = 0

        try:
            with sqlite_db.connection() as conn:
                snap_rows = conn.execute(
                    """
                    SELECT id, timestamp_iso, time_label, total_sessions,
                           active_busy_sessions, idle_sessions, warm_sessions, dynamic_sessions,
                           max_capacity, active_proxies, cooldown_proxies,
                           avg_proxy_latency_ms, requests_per_min
                    FROM pool_metrics_snapshots
                    ORDER BY timestamp_iso DESC
                    LIMIT 16
                    """
                ).fetchall()
                for r in reversed(snap_rows):
                    timeline.append(PoolTimelinePointDTO(**dict(r)))

                evt_rows = conn.execute(
                    """
                    SELECT id, event_type, session_id, provider,
                           proxy_endpoint, detail, total_sessions_after, created_at
                    FROM pool_scaling_events
                    ORDER BY created_at DESC
                    LIMIT 15
                    """
                ).fetchall()
                for er in evt_rows:
                    recent_events.append(PoolScalingEventDTO(**dict(er)))

                autoscale_count = conn.execute(
                    "SELECT COUNT(1) FROM pool_scaling_events"
                ).fetchone()[0]
        except Exception as exc:
            gateway_logger.warning(f"POOL_DASHBOARD_READ_WARN | err={exc}")

        # Sağlayıcı bazlı dağılım
        provider_buckets: Dict[str, Dict[str, int]] = {}
        for s in sessions:
            prov = str(s.get("provider", "chatgpt-web"))
            b = provider_buckets.setdefault(
                prov,
                {
                    "total": 0,
                    "busy": 0,
                    "idle": 0,
                    "warm": 0,
                    "dynamic": 0,
                    "requests": 0,
                },
            )
            b["total"] += 1
            if s.get("status") == "idle":
                b["idle"] += 1
            else:
                b["busy"] += 1
            if s.get("is_dynamic"):
                b["dynamic"] += 1
            else:
                b["warm"] += 1
            b["requests"] += int(s.get("requests_served") or 0)

        provider_distribution: List[ProviderPoolStatDTO] = []
        for prov, stats in provider_buckets.items():
            share = round((stats["total"] / max(1, total_sessions)) * 100, 1)
            provider_distribution.append(
                ProviderPoolStatDTO(
                    provider=prov,
                    total_sessions=stats["total"],
                    busy_sessions=stats["busy"],
                    idle_sessions=stats["idle"],
                    warm_sessions=stats["warm"],
                    dynamic_sessions=stats["dynamic"],
                    requests_served=stats["requests"],
                    share_pct=share,
                )
            )

        # Ülke/bölge bazlı proxy dağılımı
        region_buckets: Dict[str, List[Dict[str, Any]]] = {}
        for p in proxies:
            country = str(p.get("country", "TR"))
            region_buckets.setdefault(country, []).append(p)

        proxy_region_distribution: List[ProxyRegionStatDTO] = []
        for country, plist in region_buckets.items():
            act = sum(1 for item in plist if item.get("status") == "active")
            avg_lat = round(
                sum(int(item.get("latency_ms") or 50) for item in plist) / max(1, len(plist))
            )
            proxy_region_distribution.append(
                ProxyRegionStatDTO(
                    country=country,
                    total_proxies=len(plist),
                    active_proxies=act,
                    avg_latency_ms=avg_lat,
                )
            )

        summary = PoolDashboardSummaryDTO(
            total_sessions=total_sessions,
            max_capacity=max_cap,
            utilization_pct=utilization_pct,
            busy_sessions=busy_sessions,
            idle_sessions=idle_sessions,
            warm_sessions=warm_sessions,
            dynamic_sessions=dynamic_sessions,
            total_requests_served=total_requests,
            active_proxies=active_proxies,
            cooldown_proxies=cooldown_proxies,
            avg_proxy_latency_ms=avg_latency,
            autoscale_events_24h=autoscale_count,
        )

        return PoolDashboardMetricsDTO(
            summary=summary,
            timeline=timeline,
            provider_distribution=provider_distribution,
            proxy_region_distribution=proxy_region_distribution,
            recent_events=recent_events,
        )

    def _resolve_proxy_label(self, requested_proxy_id: str = "") -> str:
        """İstenen proxy ID'sini veya havuzdaki en az kullanılan aktif proxy düğümünü seçer."""
        active_proxies = [p for p in self._store.proxies if p.get("status") == "active"]
        if not active_proxies:
            return "Direct / Gateway IP"

        if requested_proxy_id:
            matched = next(
                (p for p in self._store.proxies if p.get("id") == requested_proxy_id),
                None,
            )
            if matched:
                return self._format_proxy_display(matched)

        used_endpoints = [s.get("proxy", "") for s in self._store.browser_sessions]

        def _proxy_score(proxy_node: Dict[str, Any]) -> tuple:
            endpoint = proxy_node.get("endpoint", "")
            usage_count = sum(1 for u in used_endpoints if endpoint and endpoint in u)
            latency = int(proxy_node.get("latency_ms") or 50)
            return (usage_count, latency)

        best_proxy = min(active_proxies, key=_proxy_score)
        return self._format_proxy_display(best_proxy)

    @staticmethod
    def _format_proxy_display(proxy_node: Dict[str, Any]) -> str:
        endpoint = proxy_node.get("endpoint", "127.0.0.1:8080")
        country = proxy_node.get("country", "TR")
        ptype = str(proxy_node.get("proxy_type", "Res")).capitalize()[:6]
        return f"{endpoint} ({country}-{ptype})"
