from typing import List, Optional
from pydantic import BaseModel, Field
from app.dtos.model_dto import ModelDefinitionDTO
from app.dtos.user_dto import UserResponseDTO
from app.dtos.api_key_dto import ApiKeyPublicDTO
from app.dtos.proxy_dto import ProxyNodeDTO
from app.dtos.conversation_dto import ConversationSummaryDTO


class BrowserSessionDTO(BaseModel):
    """Tarayıcı oturumu (warm veya dinamik auto-scaled session) durumu DTO'su."""

    id: str
    provider: str
    account: str
    proxy: str
    status: str
    requests_served: int
    is_dynamic: bool = False
    created_at: str = ""
    last_active_at: str = ""
    idle_ttl_sec: int = 300


class CreateBrowserSessionRequestDTO(BaseModel):
    """Dinamik tarayıcı oturumu başlatma isteği DTO'su."""

    provider: str = "chatgpt-web"
    account: str = ""
    proxy_id: str = ""
    is_dynamic: bool = True
    idle_ttl_sec: int = 300


class PoolTimelinePointDTO(BaseModel):
    """Bağlantı havuzu zaman serisi çizelgesi (aktif oturum & proxy gecikmesi) veri noktası DTO'su."""

    id: str
    timestamp_iso: str
    time_label: str
    total_sessions: int
    active_busy_sessions: int
    idle_sessions: int
    warm_sessions: int
    dynamic_sessions: int
    max_capacity: int = 16
    active_proxies: int = 0
    cooldown_proxies: int = 0
    avg_proxy_latency_ms: int = 0
    requests_per_min: int = 0


class PoolScalingEventDTO(BaseModel):
    """Bağlantı havuzu otomatik ölçeklenme (auto-scale) ve yaşam döngüsü olay kaydı DTO'su."""

    id: str
    event_type: str
    session_id: str = ""
    provider: str = ""
    proxy_endpoint: str = ""
    detail: str = ""
    total_sessions_after: int = 0
    created_at: str


class ProviderPoolStatDTO(BaseModel):
    """Sağlayıcı bazlı oturum ve iş yükü dağılımı DTO'su."""

    provider: str
    total_sessions: int
    busy_sessions: int
    idle_sessions: int
    warm_sessions: int
    dynamic_sessions: int
    requests_served: int
    share_pct: float = 0.0


class ProxyRegionStatDTO(BaseModel):
    """Ülke/bölge bazlı proxy düğümü sağlık ve gecikme dağılımı DTO'su."""

    country: str
    total_proxies: int
    active_proxies: int
    avg_latency_ms: int


class PoolDashboardSummaryDTO(BaseModel):
    """Bağlantı Havuzu Dashboard üst özet metrikleri DTO'su."""

    total_sessions: int
    max_capacity: int
    utilization_pct: float
    busy_sessions: int
    idle_sessions: int
    warm_sessions: int
    dynamic_sessions: int
    total_requests_served: int
    active_proxies: int
    cooldown_proxies: int
    avg_proxy_latency_ms: int
    autoscale_events_24h: int


class PoolDashboardMetricsDTO(BaseModel):
    """Bağlantı Havuzu Dashboard tam veri ve çizelge yanıtı DTO'su."""

    summary: PoolDashboardSummaryDTO
    timeline: List[PoolTimelinePointDTO] = Field(default_factory=list)
    provider_distribution: List[ProviderPoolStatDTO] = Field(default_factory=list)
    proxy_region_distribution: List[ProxyRegionStatDTO] = Field(default_factory=list)
    recent_events: List[PoolScalingEventDTO] = Field(default_factory=list)


class UsageLogDTO(BaseModel):
    """API kullanım, istem/yanıt önizleme ve performans telemetri kaydı DTO'su."""

    request_id: str
    conversation_id: str = ""
    user_email: str
    model: str
    session_id: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    is_stream: bool
    latency_ms: int
    ttft_ms: int = 0
    status: str = "success"
    upstream_provider: str = ""
    prompt_preview: str = ""
    response_preview: str = ""
    attachment_names: List[str] = Field(default_factory=list)
    error_detail: str = ""
    created_at: str


class RecordUsageInputDTO(BaseModel):
    """Yeni kullanım kaydı oluşturmak için kullanılan giriş DTO'su."""

    user_id: str
    request_id: str
    conversation_id: str = ""
    model: str
    prompt_tokens: int
    completion_tokens: int
    is_stream: bool
    latency_ms: int
    ttft_ms: int = 0
    status: str = "success"
    upstream_provider: str = ""
    prompt_preview: str = ""
    response_preview: str = ""
    attachment_names: List[str] = Field(default_factory=list)
    error_detail: str = ""
    session_id: str


class GatewaySettingsDTO(BaseModel):
    """Sistem genel ayarları DTO'su."""

    global_rpm: int = 600
    max_concurrent_browsers: int = 16
    keep_alive_interval_sec: int = 300
    enable_stealth: bool = True
    auto_rotate_proxy_on_403: bool = True


class AdminStateResponseDTO(BaseModel):
    """Admin yönetim konsolu tam durum yanıtı DTO'su."""

    models: List[ModelDefinitionDTO]
    users: List[UserResponseDTO]
    api_keys: List[ApiKeyPublicDTO]
    browser_sessions: List[BrowserSessionDTO]
    proxies: List[ProxyNodeDTO]
    usage_logs: List[UsageLogDTO]
    conversations: List[ConversationSummaryDTO] = Field(default_factory=list)
    system_logs: List[str] = Field(default_factory=list)
    settings: GatewaySettingsDTO
    pool_dashboard: Optional[PoolDashboardMetricsDTO] = None
