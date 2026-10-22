from typing import List, Optional, Set
from app.dtos.proxy_dto import ProxyNodeDTO
from app.repositories.state_store import InMemoryStateStore


class ProxyRepository:
    """Proxy havuzu veri erişim katmanı (Repository)."""

    def __init__(self, state_store: InMemoryStateStore) -> None:
        self._store = state_store

    def list_all(self) -> List[ProxyNodeDTO]:
        """Havuzdaki tüm proxy düğümlerini döner."""
        return [ProxyNodeDTO(**p) for p in self._store.proxies]

    def get_by_id(self, proxy_id: str) -> Optional[ProxyNodeDTO]:
        """ID değerine göre proxy düğümünü döner."""
        for p in self._store.proxies:
            if p["id"] == proxy_id:
                return ProxyNodeDTO(**p)
        return None

    def get_existing_endpoints(self) -> Set[str]:
        """Mükerrer kaydı önlemek için mevcut tüm endpoint kümesini döner."""
        return {p["endpoint"] for p in self._store.proxies}

    def insert_first(self, node: ProxyNodeDTO) -> ProxyNodeDTO:
        """Yeni proxy düğümünü listenin başına ekler."""
        self._store.proxies.insert(0, node.model_dump())
        return node

    def update_health(
        self,
        proxy_id: str,
        latency_ms: int,
        status: Optional[str] = None,
        reset_fails: bool = False,
    ) -> Optional[ProxyNodeDTO]:
        """Proxy düğümünün gecikme ve sağlık durumunu günceller."""
        for p in self._store.proxies:
            if p["id"] == proxy_id:
                p["latency_ms"] = latency_ms
                if status is not None:
                    p["status"] = status
                if reset_fails:
                    p["fails"] = 0
                return ProxyNodeDTO(**p)
        return None

    def delete_by_id(self, proxy_id: str) -> Optional[ProxyNodeDTO]:
        """Proxy düğümünü havuzdan siler ve silinen düğümü döner."""
        for idx, p in enumerate(self._store.proxies):
            if p["id"] == proxy_id:
                removed = self._store.proxies.pop(idx)
                return ProxyNodeDTO(**removed)
        return None
