import {
  AdminStateResponseDTO,
  AIModelDTO,
  GatewaySettingsDTO,
} from '../dtos/admin.dto';
import { deleteJson, getJson, patchJson } from './httpClient';

/**
 * Admin durumu, sistem logları ve sistem genel ayarları servisi.
 */
export const adminService = {
  /** Sunucudan güncel yönetim konsolu durumunu ve SQLite veritabanı kayıtlarını çeker. */
  async fetchState(): Promise<AdminStateResponseDTO> {
    const [baseState, sqliteOverlay] = await Promise.all([
      getJson<AdminStateResponseDTO>('/admin/state').catch(() => null),
      getJson<Partial<AdminStateResponseDTO>>('/admin/sqlite-state').catch(() => null),
    ]);

    if (!baseState && !sqliteOverlay) {
      throw new Error('Yönetim durumu alınamadı.');
    }

    const base = baseState || ({} as Partial<AdminStateResponseDTO>);
    return {
      models: Array.isArray(base.models) ? base.models : [],
      browser_sessions: Array.isArray(base.browser_sessions) ? base.browser_sessions : [],
      proxies: Array.isArray(base.proxies) ? base.proxies : [],
      system_logs: Array.isArray(base.system_logs) ? base.system_logs : [],
      settings: base.settings || {
        global_rpm: 600,
        max_concurrent_browsers: 16,
        keep_alive_interval_sec: 300,
        enable_stealth: true,
        auto_rotate_proxy_on_403: true,
      },
      users: Array.isArray(sqliteOverlay?.users) ? sqliteOverlay.users : base.users || [],
      api_keys: Array.isArray(sqliteOverlay?.api_keys)
        ? sqliteOverlay.api_keys
        : base.api_keys || [],
      conversations: Array.isArray(sqliteOverlay?.conversations)
        ? sqliteOverlay.conversations
        : base.conversations || [],
      usage_logs: Array.isArray(sqliteOverlay?.usage_logs)
        ? sqliteOverlay.usage_logs
        : base.usage_logs || [],
      pool_dashboard: sqliteOverlay?.pool_dashboard || base.pool_dashboard,
    };
  },

  /** Sistem genel hız ve anti-bot ayarlarını günceller. */
  async updateSettings(dto: GatewaySettingsDTO): Promise<GatewaySettingsDTO> {
    return patchJson<GatewaySettingsDTO, GatewaySettingsDTO>('/admin/settings', dto);
  },

  /** Tüm telemetri ve sistem log kayıtlarını temizler. */
  async clearLogs(): Promise<void> {
    await deleteJson<{ status: string }>('/admin/logs');
  },

  /** Model listesi içinden geçerli veya varsayılan en uygun modeli seçer. */
  selectPreferredModelId(models: AIModelDTO[] | undefined, currentModelId: string): string {
    const safeModels = Array.isArray(models) ? models : [];
    if (currentModelId && safeModels.some((m) => m.id === currentModelId)) {
      return currentModelId;
    }
    const fastLocal =
      safeModels.find((m) => m.id.includes('7b') || m.id.includes('llama3')) || safeModels[0];
    return fastLocal ? fastLocal.id : currentModelId;
  },
};
