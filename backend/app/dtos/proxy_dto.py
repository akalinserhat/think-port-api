from typing import List, Optional
from pydantic import BaseModel, Field


class CreateProxyRequestDTO(BaseModel):
    """Tekil proxy düğümü oluşturma isteği DTO'su."""

    protocol: str = "http"
    endpoint: str
    country: str = "TR"
    city: str = "Istanbul"
    proxy_type: str = "residential"
    provider: str = "Custom Node"


class BulkProxyImportRequestDTO(BaseModel):
    """Toplu proxy içe aktarma isteği DTO'su."""

    raw_list: str
    default_protocol: str = "http"
    default_country: str = "EU"
    default_type: str = "datacenter"
    default_provider: str = "Bulk Import"


class FetchFreeProxyRequestDTO(BaseModel):
    """Canlı açık kaynak proxy çekme isteği DTO'su."""

    protocol: str = "all"
    limit: int = Field(default=8, ge=1, le=25)


class ProxyNodeDTO(BaseModel):
    """Proxy düğümü durum ve metrik DTO'su."""

    id: str
    protocol: str
    endpoint: str
    country: str
    city: Optional[str] = None
    proxy_type: Optional[str] = "residential"
    provider: Optional[str] = "Custom Node"
    latency_ms: int = 45
    status: str = "active"
    fails: int = 0


class BulkProxyImportResponseDTO(BaseModel):
    """Toplu proxy ekleme veya çekme işlemi yanıt DTO'su."""

    added_count: int
    added: List[ProxyNodeDTO]


class ProxyCheckAllResponseDTO(BaseModel):
    """Tüm proxy'lerin sağlık kontrolü yanıt DTO'su."""

    checked: int
    proxies: List[ProxyNodeDTO]


class DeleteProxyResponseDTO(BaseModel):
    """Proxy silme işlemi yanıt DTO'su."""

    deleted: bool
    proxy: ProxyNodeDTO
