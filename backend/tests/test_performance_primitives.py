"""
ThinkPort AI Gateway - Performans Altyapısı Birim Testleri (test_performance_primitives.py).
PgWireConnectionPool (eşzamanlılık, soket geri dönüşümü, bozuk bağlantı yenileme)
ve TTLCache (süre dolumu, LRU, thread-safety, invalidation) davranışlarını doğrular.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import time
import unittest
from app.core.ttl_cache import MISSING, TTLCache
from app.repositories.postgres_driver import PgWireConnectionPool


class _FakePgConn:
    def __init__(self, conn_id: int) -> None:
        self.conn_id = conn_id
        self._closed = False
        self._broken = False
        self._in_tx = False
        self._last_used_at = time.monotonic()
        self.reset_calls = 0
        self.close_calls = 0

    @property
    def last_used_at(self) -> float:
        return self._last_used_at

    def is_closed(self) -> bool:
        return self._closed or self._broken

    def reset_for_pool(self) -> bool:
        self.reset_calls += 1
        if self.is_closed():
            return False
        self._in_tx = False
        self._last_used_at = time.monotonic()
        return True

    def close(self) -> None:
        self._closed = True
        self.close_calls += 1


class TestPgWireConnectionPool(unittest.TestCase):
    def test_reuse_and_warmup(self) -> None:
        created = []

        def factory():
            c = _FakePgConn(len(created) + 1)
            created.append(c)
            return c

        pool = PgWireConnectionPool(factory=factory, min_size=2, max_size=5)
        warmed = pool.warm_up()
        self.assertEqual(warmed, 2)
        self.assertEqual(len(created), 2)
        self.assertEqual(pool.stats()["idle"], 2)

        c1 = pool.acquire()
        pool.release(c1)
        c2 = pool.acquire()
        # LIFO yeniden kullanımı: yeni soket açılmamalı
        self.assertIs(c1, c2)
        self.assertEqual(len(created), 2)
        pool.release(c2)
        pool.close_all()
        self.assertTrue(all(c._closed for c in created))

    def test_broken_connection_is_discarded_and_replaced(self) -> None:
        counter = [0]

        def factory():
            counter[0] += 1
            return _FakePgConn(counter[0])

        pool = PgWireConnectionPool(factory=factory, min_size=0, max_size=2)
        c1 = pool.acquire()
        pool.release(c1, broken=True)
        self.assertTrue(c1._closed)

        c2 = pool.acquire()
        self.assertNotEqual(c1.conn_id, c2.conn_id)
        pool.release(c2)
        pool.close_all()

    def test_parallel_workers_share_bounded_pool(self) -> None:
        counter = [0]

        def factory():
            counter[0] += 1
            return _FakePgConn(counter[0])

        pool = PgWireConnectionPool(factory=factory, min_size=1, max_size=4)

        def worker(_: int) -> int:
            c = pool.acquire()
            try:
                time.sleep(0.01)
                return c.conn_id
            finally:
                pool.release(c)

        with ThreadPoolExecutor(max_workers=12) as ex:
            results = list(ex.map(worker, range(24)))

        self.assertEqual(len(results), 24)
        self.assertLessEqual(counter[0], 4)
        pool.close_all()


class TestTTLCache(unittest.TestCase):
    def test_expiry_missing_and_invalidation(self) -> None:
        cache: TTLCache[str, object] = TTLCache(ttl_seconds=0.15, max_items=3)
        self.assertIs(cache.get_or_missing("k1"), MISSING)

        cache.set("k1", None)
        self.assertIsNone(cache.get_or_missing("k1"))

        cache.set("k2", {"v": 2})
        self.assertEqual(cache.get("k2"), {"v": 2})
        cache.invalidate("k2")
        self.assertIs(cache.get_or_missing("k2"), MISSING)

        time.sleep(0.18)
        self.assertIs(cache.get_or_missing("k1"), MISSING)

    def test_lru_eviction(self) -> None:
        cache: TTLCache[str, int] = TTLCache(ttl_seconds=10.0, max_items=2)
        cache.set("a", 1)
        cache.set("b", 2)
        _ = cache.get("a")  # 'a' en yeni oldu, 'b' çıkarılmalı
        cache.set("c", 3)
        self.assertEqual(cache.get("a"), 1)
        self.assertIs(cache.get_or_missing("b"), MISSING)
        self.assertEqual(cache.get("c"), 3)


if __name__ == "__main__":
    unittest.main()
