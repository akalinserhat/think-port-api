import {
  BrowserSessionDTO,
  BulkProxyImportRequestDTO,
  BulkProxyResponseDTO,
  CreateBrowserSessionRequestDTO,
  CreateProxyRequestDTO,
  FetchFreeProxyRequestDTO,
  PoolDashboardMetricsDTO,
  ProxyNodeDTO,
} from '../dtos/admin.dto';
import { deleteJson, getJson, patchJson, postJson } from './httpClient';

/**
 * Proxy ve Dinamik Tarayıcı Oturum Havuzu yönetim servisi.
 */
export const proxyService = {
  /** Bağlantı Havuzu Dashboard zaman serisi ve dağılım telemetrisini döner. */
  async getDashboardMetrics(): Promise<PoolDashboardMetricsDTO> {
    return getJson<PoolDashboardMetricsDTO>('/admin/proxies/dashboard');
  },

  /** Bağlantı Havuzu SQLite telemetri tablolarına yeni ölçeklenme olayı ve snapshot kaydeder. */
  async recordPoolEvent(payload: {
    event_type: string;
    provider?: string;
    session_id?: string;
    proxy_id?: string;
    reason?: string;
    total_sessions_after: number;
    dynamic_sessions_after?: number;
    warm_sessions_after?: number;
    busy_sessions_after?: number;
    max_capacity?: number;
    active_proxies?: number;
    cooldown_proxies?: number;
    avg_proxy_latency_ms?: number;
  }): Promise<{ timeline: PoolDashboardMetricsDTO['timeline']; scaling_events: PoolDashboardMetricsDTO['scaling_events'] }> {
    return postJson('/admin/proxies/dashboard', payload);
  },

  /** Havuza yeni bir tekil proxy düğümü ekler. */
  async createProxy(dto: CreateProxyRequestDTO): Promise<ProxyNodeDTO> {
    return postJson<CreateProxyRequestDTO, ProxyNodeDTO>('/admin/proxies', dto);
  },

  /** Metin listesinden toplu proxy içe aktarır. */
  async bulkImport(dto: BulkProxyImportRequestDTO): Promise<BulkProxyResponseDTO> {
    return postJson<BulkProxyImportRequestDTO, BulkProxyResponseDTO>('/admin/proxies/bulk', dto);
  },

  /** Açık kaynaklı canlı proxy sağlayıcılarından ücretsiz proxy düğümleri çeker. */
  async fetchFreeProxies(dto: FetchFreeProxyRequestDTO): Promise<BulkProxyResponseDTO> {
    return postJson<FetchFreeProxyRequestDTO, BulkProxyResponseDTO>(
      '/admin/proxies/fetch-free',
      dto
    );
  },

  /** Havuzdaki tüm proxy düğümlerinin gecikmelerini kontrol eder. */
  async checkAllProxies(): Promise<{ checked: number; proxies: ProxyNodeDTO[] }> {
    return postJson<undefined, { checked: number; proxies: ProxyNodeDTO[] }>(
      '/admin/proxies/check-all'
    );
  },

  /** Tek bir proxy düğümünün gecikmesini ölçer. */
  async checkSingleProxy(proxyId: string): Promise<ProxyNodeDTO> {
    return postJson<undefined, ProxyNodeDTO>(`/admin/proxies/${proxyId}/check`);
  },

  /** Proxy düğümünün durumunu (active <-> cooldown) değiştirir. */
  async toggleProxyStatus(proxyId: string): Promise<ProxyNodeDTO> {
    return patchJson<undefined, ProxyNodeDTO>(`/admin/proxies/${proxyId}/toggle`);
  },

  /** Proxy düğümünü havuzdan siler. */
  async deleteProxy(proxyId: string): Promise<{ deleted: boolean; proxy: ProxyNodeDTO }> {
    return deleteJson<{ deleted: boolean; proxy: ProxyNodeDTO }>(`/admin/proxies/${proxyId}`);
  },

  /** İlgili sağlayıcı için dinamik (auto-scaled) yeni bir tarayıcı oturumu başlatır. */
  async spawnDynamicSession(dto: CreateBrowserSessionRequestDTO): Promise<BrowserSessionDTO> {
    return postJson<CreateBrowserSessionRequestDTO, BrowserSessionDTO>(
      '/admin/proxies/sessions',
      dto
    );
  },

  /** Boşta (idle) olan tüm dinamik tarayıcı oturumlarını temizler (Scale-Down). */
  async pruneIdleDynamicSessions(): Promise<{
    removed_count: number;
    sessions: BrowserSessionDTO[];
  }> {
    return postJson<
      undefined,
      { removed_count: number; sessions: BrowserSessionDTO[] }
    >('/admin/proxies/sessions/prune');
  },

  /** Belirtilen tarayıcı oturumunu sonlandırır ve havuzdan kaldırır. */
  async terminateSession(
    sessionId: string
  ): Promise<{ terminated: boolean; session: BrowserSessionDTO }> {
    return deleteJson<{ terminated: boolean; session: BrowserSessionDTO }>(
      `/admin/proxies/sessions/${sessionId}`
    );
  },
};
