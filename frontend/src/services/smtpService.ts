import {
  ConfirmPasswordResetRequestDTO,
  PasswordResetLogDTO,
  SendPasswordResetRequestDTO,
  SendPasswordResetResponseDTO,
} from '../dtos/admin.dto';
import { getJson, postJson } from './httpClient';

const STORAGE_RESET_LOGS_KEY = 'gateway_password_reset_logs_v1';

function readLocalResetLogs(): PasswordResetLogDTO[] {
  try {
    const raw = localStorage.getItem(STORAGE_RESET_LOGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PasswordResetLogDTO[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalResetLogs(logs: PasswordResetLogDTO[]): void {
  try {
    localStorage.setItem(STORAGE_RESET_LOGS_KEY, JSON.stringify(logs));
  } catch {}
}

export const smtpService = {
  /** Kullanıcıya şifre sıfırlama e-postası gönderir ve log kaydı oluşturur. */
  async sendPasswordResetEmail(
    dto: SendPasswordResetRequestDTO
  ): Promise<SendPasswordResetResponseDTO> {
    const response = await postJson<
      SendPasswordResetRequestDTO,
      SendPasswordResetResponseDTO
    >('/admin/smtp/send-password-reset', dto);

    // Ayrıca localStorage'daki kullanıcı şifresini de senkronize et (eğer geçici şifre atandıysa)
    if (response && response.temporary_password && response.email) {
      try {
        const rawUsers = localStorage.getItem('gateway_system_users_v1');
        if (rawUsers) {
          const parsedUsers = JSON.parse(rawUsers) as Array<Record<string, unknown>>;
          if (Array.isArray(parsedUsers)) {
            const updatedUsers = parsedUsers.map((u) =>
              String(u.email || '').toLowerCase() === response.email.toLowerCase()
                ? { ...u, password: response.temporary_password }
                : u
            );
            localStorage.setItem('gateway_system_users_v1', JSON.stringify(updatedUsers));
          }
        }
      } catch {}
    }

    return response;
  },

  /** Sıfırlama kodu (token) veya e-posta ile kullanıcının yeni şifresini onaylar. */
  async confirmPasswordReset(
    dto: ConfirmPasswordResetRequestDTO
  ): Promise<{ ok: boolean; email: string; detail: string }> {
    const res = await postJson<
      ConfirmPasswordResetRequestDTO,
      { ok: boolean; email: string; detail: string }
    >('/admin/smtp/confirm-password-reset', dto);

    if (res && res.ok && res.email && dto.new_password) {
      try {
        const rawUsers = localStorage.getItem('gateway_system_users_v1');
        if (rawUsers) {
          const parsedUsers = JSON.parse(rawUsers) as Array<Record<string, unknown>>;
          if (Array.isArray(parsedUsers)) {
            const updatedUsers = parsedUsers.map((u) =>
              String(u.email || '').toLowerCase() === res.email.toLowerCase()
                ? { ...u, password: dto.new_password.trim() }
                : u
            );
            localStorage.setItem('gateway_system_users_v1', JSON.stringify(updatedUsers));
          }
        }
      } catch {}
    }

    return res;
  },

  /** Gönderilen şifre sıfırlama e-postalarının geçmiş kayıtlarını listeler. */
  async listPasswordResetLogs(): Promise<PasswordResetLogDTO[]> {
    try {
      const list = await getJson<PasswordResetLogDTO[]>('/admin/smtp/logs');
      if (Array.isArray(list)) {
        writeLocalResetLogs(list);
        return list;
      }
    } catch {}
    return readLocalResetLogs();
  },
};
