import importlib.util
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from app.dtos.proxy_dto import ProxyNodeDTO
from app.repositories.state_store import InMemoryStateStore


def _load_proxy_module_db() -> Any:
    """
    @akalin/proxy_module paketinin kendine özel PostgreSQL veritabanı yöneticisini
    (`akalin_proxy_db`) dinamik olarak yükler.
    """
    candidate = (
        Path(__file__).resolve().parents[4]
        / "akalin-proxy-module"
        / "database"
        / "proxy_postgres_db.py"
    )
    spec = importlib.util.spec_from_file_location("akalin_proxy_postgres_db", str(candidate))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"akalin-proxy-module database module not found: {candidate}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.proxy_db


proxy_module_db = _load_proxy_module_db()


class ProxyRepository:
    """
    Proxy havuzu veri erişim katmanı (Repository).
    Tüm okuma ve yazma işlemlerini @akalin/proxy_module'e ait bağımsız PostgreSQL
    veritabanı (`akalin_proxy_db`) üzerinde yürütür ve bellek içi önbellekle senkronize tutar.
    """

    def __init__(self, state_store: InMemoryStateStore) -> None:
        self._store = state_store
        self._sync_store_from_db()

    def _sync_store_from_db(self) -> List[Dict[str, Any]]:
        try:
            rows = proxy_module_db.list_proxies()
            self._store.proxies = rows
            return rows
        except Exception:
            return self._store.proxies

    def list_all(self) -> List[ProxyNodeDTO]:
        """`akalin_proxy_db` veritabanındaki tüm proxy düğümlerini döner."""
        rows = self._sync_store_from_db()
        return [ProxyNodeDTO(**p) for p in rows]

    def get_by_id(self, proxy_id: str) -> Optional[ProxyNodeDTO]:
        """ID değerine göre proxy düğümünü `akalin_proxy_db`'den döner."""
        row = proxy_module_db.get_proxy_by_id(proxy_id)
        if row:
            return ProxyNodeDTO(**row)
        return None

    def get_existing_endpoints(self) -> Set[str]:
        """Mükerrer kaydı önlemek için `akalin_proxy_db` içindeki tüm endpoint kümesini döner."""
        return proxy_module_db.get_existing_endpoints()

    def insert_first(self, node: ProxyNodeDTO) -> ProxyNodeDTO:
        """Yeni proxy düğümünü `akalin_proxy_db` veritabanına ekler."""
        now_iso = datetime.now(timezone.utc).isoformat()
        with proxy_module_db.connection() as conn:
            conn.execute(
                """
                INSERT INTO proxy_nodes (
                    id, protocol, endpoint, country, city, proxy_type,
                    provider, latency_ms, status, fails, last_checked_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (endpoint) DO UPDATE SET
                    protocol = EXCLUDED.protocol,
                    country = EXCLUDED.country,
                    city = EXCLUDED.city,
                    proxy_type = EXCLUDED.proxy_type,
                    provider = EXCLUDED.provider,
                    latency_ms = EXCLUDED.latency_ms,
                    status = EXCLUDED.status,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    node.id,
                    node.protocol,
                    node.endpoint,
                    node.country,
                    node.city,
                    node.proxy_type,
                    node.provider,
                    node.latency_ms,
                    node.status,
                    node.fails,
                    now_iso,
                    now_iso,
                    now_iso,
                ),
            )
        self._sync_store_from_db()
        return node

    def update_health(
        self,
        proxy_id: str,
        latency_ms: int,
        status: Optional[str] = None,
        reset_fails: bool = False,
    ) -> Optional[ProxyNodeDTO]:
        """Proxy düğümünün gecikme ve sağlık durumunu `akalin_proxy_db` üzerinde günceller."""
        now_iso = datetime.now(timezone.utc).isoformat()
        target = proxy_module_db.get_proxy_by_id(proxy_id)
        if not target:
            return None
        next_status = status if status is not None else target["status"]
        next_fails = 0 if reset_fails else int(target.get("fails") or 0)
        with proxy_module_db.connection() as conn:
            conn.execute(
                """
                UPDATE proxy_nodes
                SET latency_ms = ?, status = ?, fails = ?, last_checked_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (latency_ms, next_status, next_fails, now_iso, now_iso, proxy_id),
            )
        self._sync_store_from_db()
        updated = proxy_module_db.get_proxy_by_id(proxy_id)
        return ProxyNodeDTO(**updated) if updated else None

    def delete_by_id(self, proxy_id: str) -> Optional[ProxyNodeDTO]:
        """Proxy düğümünü `akalin_proxy_db` havuzundan siler ve silinen düğümü döner."""
        removed = proxy_module_db.delete_proxy(proxy_id)
        self._sync_store_from_db()
        if removed:
            return ProxyNodeDTO(**removed)
        return None
