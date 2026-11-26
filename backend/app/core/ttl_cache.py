"""
ThinkPort AI Gateway - Harici Bağımlılıksız Thread-Safe TTL Bellek Önbelleği (ttl_cache.py).
Sık okunan API anahtarı, kullanıcı ve ajan yapılandırmaları için kısa ömürlü (TTL) LRU önbellek sağlar.
"""
from __future__ import annotations
from collections import OrderedDict
from collections.abc import Hashable
import threading
import time
from typing import Any, Generic, Optional, Tuple, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")

_MISSING = object()


class TTLCache(Generic[K, V]):
    """Thread-safe, `time.monotonic()` tabanlı TTL + LRU önbelleği."""

    def __init__(self, ttl_seconds: float = 30.0, max_items: int = 512) -> None:
        self._ttl = max(0.1, float(ttl_seconds))
        self._max_items = max(1, max_items)
        self._lock = threading.RLock()
        self._data: OrderedDict[K, Tuple[float, V]] = OrderedDict()

    def get(self, key: K, default: Any = None) -> Any:
        """Geçerlilik süresi dolmamış değeri döner; yoksa veya süresi dolmuşsa `default` döner."""
        now = time.monotonic()
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return default
            expires_at, value = entry
            if now >= expires_at:
                self._data.pop(key, None)
                return default
            self._data.move_to_end(key)
            return value

    def get_or_missing(self, key: K) -> Any:
        """`None` değerini önbellek iskalamasından (miss) ayırt edebilmek için `_MISSING` döner."""
        return self.get(key, _MISSING)

    def set(self, key: K, value: V, ttl_seconds: Optional[float] = None) -> None:
        """Değeri belirtilen (veya varsayılan) TTL ile önbelleğe yazar."""
        ttl = self._ttl if ttl_seconds is None else max(0.1, float(ttl_seconds))
        expires_at = time.monotonic() + ttl
        with self._lock:
            self._data[key] = (expires_at, value)
            self._data.move_to_end(key)
            while len(self._data) > self._max_items:
                self._data.popitem(last=False)

    def invalidate(self, key: K) -> None:
        """Belirtilen anahtarı önbellekten siler."""
        with self._lock:
            self._data.pop(key, None)

    def clear(self) -> None:
        """Tüm önbelleği temizler."""
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)


MISSING = _MISSING
