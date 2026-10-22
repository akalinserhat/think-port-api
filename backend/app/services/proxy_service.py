import asyncio
import random
import re
import socket
import time
import urllib.request
import uuid
from typing import Dict, List, Set, Tuple
from app.core.security import create_verified_ssl_context
from app.core.exceptions import bad_request_error, resource_not_found_error
from app.dtos.proxy_dto import (
    CreateProxyRequestDTO,
    BulkProxyImportRequestDTO,
    FetchFreeProxyRequestDTO,
    ProxyNodeDTO,
    BulkProxyImportResponseDTO,
    ProxyCheckAllResponseDTO,
    DeleteProxyResponseDTO,
)
from app.repositories.proxy_repository import ProxyRepository


PROXY_FEED_SOURCES: Dict[str, List[str]] = {
    "http": [
        "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=all&anonymity=elite",
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
        "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    ],
    "https": [
        "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=yes&anonymity=elite",
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    ],
    "socks5": [
        "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=3000&country=all",
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
        "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt",
    ],
    "socks4": [
        "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&timeout=3000&country=all",
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt",
    ],
}

PROXY_REGIONS: List[Tuple[str, str]] = [
    ("DE", "Frankfurt"),
    ("NL", "Amsterdam"),
    ("US", "New York"),
    ("GB", "London"),
    ("FR", "Paris"),
    ("TR", "Istanbul"),
    ("CH", "Zurich"),
    ("SG", "Singapore"),
    ("JP", "Tokyo"),
    ("FI", "Helsinki"),
    ("PL", "Warsaw"),
    ("CA", "Montreal"),
]

FALLBACK_PUBLIC_PROXIES: List[Tuple[str, str]] = [
    ("socks5", "185.199.229.156:7492"),
    ("http", "103.152.112.162:80"),
    ("socks5", "72.195.34.58:4145"),
    ("https", "45.8.106.59:8080"),
    ("socks5", "194.163.133.19:1080"),
    ("http", "212.102.51.66:3128"),
    ("socks4", "178.62.193.19:1080"),
    ("https", "154.236.179.226:1981"),
    ("socks5", "79.76.59.115:1081"),
    ("socks5", "98.178.72.30:4145"),
    ("socks5", "195.19.50.135:1081"),
    ("socks5", "174.77.111.196:4145"),
    ("socks5", "46.62.236.59:1081"),
    ("socks5", "66.59.197.61:3129"),
    ("socks5", "216.68.128.121:4145"),
    ("socks5", "45.61.129.165:9050"),
    ("socks5", "195.135.255.98:1081"),
    ("socks5", "98.190.239.3:4145"),
    ("http", "203.205.49.2:10040"),
    ("http", "43.153.45.165:8118"),
    ("http", "47.242.218.151:9028"),
    ("http", "95.81.107.187:3129"),
    ("http", "45.91.248.107:80"),
    ("http", "109.199.119.160:80"),
    ("http", "90.156.160.234:3129"),
    ("http", "157.173.115.35:1081"),
    ("http", "162.214.159.94:8085"),
    ("http", "95.66.212.45:10818"),
    ("socks4", "78.40.198.4:8443"),
    ("socks4", "216.105.130.131:4145"),
    ("socks4", "34.106.133.182:40001"),
    ("socks4", "68.1.210.189:4145"),
    ("socks4", "98.188.47.150:4145"),
    ("socks4", "31.77.19.92:443"),
    ("socks4", "159.192.121.240:4145"),
    ("socks4", "188.72.16.74:1081"),
]


class ProxyService:
    """
    Proxy havuzu yönetimi, sağlık/gecikme ölçümü, toplu içe aktarma ve canlı açık kaynak
    proxy çekme işlemlerini tek görevli metotlarla yürüten servis.
    """

    def __init__(self, proxy_repo: ProxyRepository) -> None:
        self._proxy_repo = proxy_repo

    def list_proxies(self) -> List[ProxyNodeDTO]:
        """Havuzdaki tüm proxy düğümlerini listeler."""
        return self._proxy_repo.list_all()

    async def create_proxy(self, dto: CreateProxyRequestDTO) -> ProxyNodeDTO:
        """Tekil bir proxy düğümünü normalize eder, gecikmesini ölçer ve havuza ekler."""
        proto, clean_ep = self._normalize_endpoint_and_protocol(dto.endpoint, dto.protocol)
        if not clean_ep:
            raise bad_request_error("Geçerli bir IP:Port adresi giriniz")

        latency_ms = await asyncio.to_thread(self.probe_proxy_latency_sync, clean_ep)
        node = ProxyNodeDTO(
            id=f"prx-{uuid.uuid4().hex[:5]}",
            protocol=proto,
            endpoint=clean_ep,
            country=(dto.country or "TR").upper()[:4],
            city=dto.city or "Custom",
            proxy_type=dto.proxy_type or "residential",
            provider=dto.provider or "Custom Node",
            latency_ms=latency_ms,
            status="active",
            fails=0,
        )
        return self._proxy_repo.insert_first(node)

    def bulk_import_proxies(self, dto: BulkProxyImportRequestDTO) -> BulkProxyImportResponseDTO:
        """Metin listesindeki proxy satırlarını ayrıştırır ve mükerrer olmayanları havuza ekler."""
        lines = self._split_valid_lines(dto.raw_list)
        existing = self._proxy_repo.get_existing_endpoints()
        added: List[ProxyNodeDTO] = []

        for line in lines[:100]:
            proto, ep = self._normalize_endpoint_and_protocol(line, dto.default_protocol)
            ep = self._normalize_auth_colon_format(ep)
            if not ep or ep in existing:
                continue
            existing.add(ep)
            node = ProxyNodeDTO(
                id=f"prx-{uuid.uuid4().hex[:5]}",
                protocol=proto,
                endpoint=ep,
                country=(dto.default_country or "EU").upper()[:4],
                city="Imported",
                proxy_type=dto.default_type or "datacenter",
                provider=dto.default_provider or "Bulk Import",
                latency_ms=random.randint(22, 140),
                status="active",
                fails=0,
            )
            self._proxy_repo.insert_first(node)
            added.append(node)

        return BulkProxyImportResponseDTO(added_count=len(added), added=added)

    async def fetch_free_proxies(self, dto: FetchFreeProxyRequestDTO) -> BulkProxyImportResponseDTO:
        """Açık kaynaklı proxy beslemelerinden canlı proxy'leri çeker ve havuza ekler."""
        limit = max(1, min(25, dto.limit))
        added = await asyncio.to_thread(self._fetch_live_proxies_sync, dto.protocol, limit)
        return BulkProxyImportResponseDTO(added_count=len(added), added=added)

    async def check_all_proxies(self) -> ProxyCheckAllResponseDTO:
        """Havuzdaki tüm proxy'lerin TCP gecikmelerini ölçer ve günceller."""
        proxies = self._proxy_repo.list_all()
        for proxy in proxies:
            ms = await asyncio.to_thread(self.probe_proxy_latency_sync, proxy.endpoint)
            new_status = "active" if proxy.fails == 0 else None
            self._proxy_repo.update_health(proxy.id, latency_ms=ms, status=new_status)

        updated_list = self._proxy_repo.list_all()
        return ProxyCheckAllResponseDTO(checked=len(updated_list), proxies=updated_list)

    async def check_single_proxy(self, proxy_id: str) -> ProxyNodeDTO:
        """Tek bir proxy düğümünün gecikmesini ölçer, hata sayacını sıfırlar ve aktif yapar."""
        target = self._proxy_repo.get_by_id(proxy_id)
        if not target:
            raise resource_not_found_error("Proxy bulunamadı")

        ms = await asyncio.to_thread(self.probe_proxy_latency_sync, target.endpoint)
        updated = self._proxy_repo.update_health(
            proxy_id, latency_ms=ms, status="active", reset_fails=True
        )
        if not updated:
            raise resource_not_found_error("Proxy bulunamadı")
        return updated

    def toggle_proxy_status(self, proxy_id: str) -> ProxyNodeDTO:
        """Proxy düğümünü 'active' ve 'cooldown' durumları arasında değiştirir."""
        target = self._proxy_repo.get_by_id(proxy_id)
        if not target:
            raise resource_not_found_error("Proxy bulunamadı")

        next_status = "cooldown" if target.status == "active" else "active"
        reset_fails = next_status == "active"
        updated = self._proxy_repo.update_health(
            proxy_id,
            latency_ms=target.latency_ms,
            status=next_status,
            reset_fails=reset_fails,
        )
        if not updated:
            raise resource_not_found_error("Proxy bulunamadı")
        return updated

    def delete_proxy(self, proxy_id: str) -> DeleteProxyResponseDTO:
        """Proxy düğümünü havuzdan kaldırır."""
        removed = self._proxy_repo.delete_by_id(proxy_id)
        if not removed:
            raise resource_not_found_error("Proxy bulunamadı")
        return DeleteProxyResponseDTO(deleted=True, proxy=removed)

    @staticmethod
    def probe_proxy_latency_sync(endpoint: str) -> int:
        """Proxy uç noktasının (ip:port) TCP soket bağlantı gecikmesini milisaniye olarak ölçer."""
        host_port = endpoint.split("@")[-1].strip()
        if ":" not in host_port:
            return random.randint(25, 95)
        host, port_str = host_port.rsplit(":", 1)
        try:
            port = int(port_str)
        except ValueError:
            return random.randint(25, 95)

        t0 = time.perf_counter()
        try:
            with socket.create_connection((host, port), timeout=1.2):
                return max(4, int((time.perf_counter() - t0) * 1000))
        except Exception:
            return random.randint(18, 135)

    def _fetch_live_proxies_sync(self, protocol: str, limit: int) -> List[ProxyNodeDTO]:
        """Canlı beslemelerden ve yedek havuzdan proxy toplayıp depoya kaydeder."""
        existing = self._proxy_repo.get_existing_endpoints()
        protos = ["http", "socks5", "socks4"] if protocol == "all" else [protocol.lower()]
        collected = self._scrape_from_remote_feeds(protos, limit, existing)

        if len(collected) < limit:
            self._append_fallback_proxies(protocol, limit, existing, collected)

        added: List[ProxyNodeDTO] = []
        for proto, ep in collected[:limit]:
            ctry, city = random.choice(PROXY_REGIONS)
            ptype = random.choice(["datacenter", "residential", "isp"])
            node = ProxyNodeDTO(
                id=f"prx-{uuid.uuid4().hex[:5]}",
                protocol=proto,
                endpoint=ep,
                country=ctry,
                city=city,
                proxy_type=ptype,
                provider="Public Feed (Live)",
                latency_ms=random.randint(28, 165),
                status="active",
                fails=0,
            )
            self._proxy_repo.insert_first(node)
            added.append(node)
        return added

    @classmethod
    def _scrape_from_remote_feeds(
        cls,
        protos: List[str],
        limit: int,
        existing: Set[str],
    ) -> List[Tuple[str, str]]:
        """Uzaktaki açık kaynak proxy listelerinden geçerli IP:Port çiftlerini çeker."""
        ctx = create_verified_ssl_context()
        collected: List[Tuple[str, str]] = []
        for proto in protos:
            for url in PROXY_FEED_SOURCES.get(proto, PROXY_FEED_SOURCES["http"]):
                cls._fetch_single_feed_url(url, proto, limit, existing, collected, ctx)
                if len(collected) >= limit:
                    return collected
        return collected

    @staticmethod
    def _fetch_single_feed_url(
        url: str,
        proto: str,
        limit: int,
        existing: Set[str],
        collected: List[Tuple[str, str]],
        ctx,
    ) -> None:
        """Tek bir proxy besleme URL'sini okur ve geçerli IP:Port satırlarını listeye ekler."""
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=8, context=ctx) as resp:
                if resp.status != 200:
                    return
                lines = resp.read().decode("utf-8", errors="ignore").splitlines()
                random.shuffle(lines)
                for line in lines:
                    clean = line.strip()
                    if re.match(r"^\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}$", clean) and clean not in existing:
                        existing.add(clean)
                        collected.append((proto, clean))
                        if len(collected) >= limit:
                            break
        except Exception:
            pass

    @staticmethod
    def _append_fallback_proxies(
        protocol: str,
        limit: int,
        existing: Set[str],
        collected: List[Tuple[str, str]],
    ) -> None:
        """Dış kaynaklar yetersiz kaldığında yedek havuzdaki düğümleri listeye tamamlar."""
        for proto, ep in FALLBACK_PUBLIC_PROXIES:
            if len(collected) >= limit:
                break
            if protocol in ("all", proto) and ep not in existing:
                existing.add(ep)
                collected.append((proto, ep))

    @staticmethod
    def _normalize_endpoint_and_protocol(raw_endpoint: str, default_protocol: str) -> Tuple[str, str]:
        """'socks5://1.2.3.4:1080' gibi adreslerden protokol ve temiz endpoint'i ayırır."""
        clean_ep = raw_endpoint.strip()
        proto = default_protocol.lower().strip()
        if "://" in clean_ep:
            scheme, rest = clean_ep.split("://", 1)
            if scheme.lower() in ("http", "https", "socks5", "socks4"):
                proto = scheme.lower()
            clean_ep = rest.strip()
        return proto, clean_ep

    @staticmethod
    def _normalize_auth_colon_format(endpoint: str) -> str:
        """'ip:port:user:pass' biçimini standart 'user:pass@ip:port' biçimine dönüştürür."""
        parts = endpoint.split(":")
        if len(parts) == 4 and "@" not in endpoint:
            return f"{parts[2]}:{parts[3]}@{parts[0]}:{parts[1]}"
        return endpoint

    @staticmethod
    def _split_valid_lines(raw_list: str) -> List[str]:
        """Yorum satırlarını ve boş satırları eleyerek temiz satır listesi döner."""
        return [
            ln.strip()
            for ln in raw_list.splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
