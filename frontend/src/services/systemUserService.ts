import {
  CreateSystemUserRequestDTO,
  SystemUserLoginRequestDTO,
  SystemUserLoginResponseDTO,
  SystemUserRecordDTO,
  UpdateSystemUserRequestDTO,
} from '../dtos/admin.dto';
import { deleteJson, getJson, patchJson, postJson } from './httpClient';

const STORAGE_USERS_KEY = 'gateway_system_users_v1';
const STORAGE_AUTH_USER_KEY = 'gateway_admin_auth_user_v1';

export const DEFAULT_SYSTEM_USER: SystemUserRecordDTO = {
  id: 'sys_usr_01',
  full_name: 'Serhat Akalın',
  email: 'akalinserhat@gmail.com',
  password: '190300',
  role: 'Sistem Yöneticisi',
  status: 'active',
  last_login_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

function readLocalUsers(): SystemUserRecordDTO[] {
  try {
    const raw = localStorage.getItem(STORAGE_USERS_KEY);
    if (!raw) {
      const initial = [DEFAULT_SYSTEM_USER];
      localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(initial));
      return initial;
    }
    const rawParsed = JSON.parse(raw) as SystemUserRecordDTO[];
    const removedEmails = new Set(['dev@company.com', 'dev@compy.com', 'test@startup.io']);
    const removedIds = new Set(['usr_01', 'usr_02']);
    const parsed = Array.isArray(rawParsed)
      ? rawParsed.filter(
          (u) =>
            !removedIds.has(u.id) &&
            !removedEmails.has((u.email || '').trim().toLowerCase())
        )
      : [];
    if (parsed.length === 0) {
      const initial = [DEFAULT_SYSTEM_USER];
      localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(initial));
      return initial;
    }
    const hasDefault = parsed.some(
      (u) => u.email.toLowerCase() === DEFAULT_SYSTEM_USER.email.toLowerCase()
    );
    const normalized = hasDefault ? parsed : [DEFAULT_SYSTEM_USER, ...parsed];
    localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return [DEFAULT_SYSTEM_USER];
  }
}

function writeLocalUsers(users: SystemUserRecordDTO[]): void {
  try {
    localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(users));
  } catch {}
}

/**
 * Admin panele giriş yapabilen Sistem Kullanıcıları ve Oturum (Auth) servisi.
 */
export const systemUserService = {
  /** Aktif oturum açmış sistem kullanıcısını döner. */
  getAuthenticatedUser(): SystemUserRecordDTO | null {
    try {
      const raw = localStorage.getItem(STORAGE_AUTH_USER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SystemUserRecordDTO;
      if (parsed && parsed.email) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  },

  /** Oturum açmış sistem kullanıcısını kaydeder. */
  setAuthenticatedUser(user: SystemUserRecordDTO): void {
    try {
      localStorage.setItem(STORAGE_AUTH_USER_KEY, JSON.stringify(user));
    } catch {}
  },

  /** Aktif oturumu sonlandırır. */
  logout(): void {
    try {
      localStorage.removeItem(STORAGE_AUTH_USER_KEY);
    } catch {}
  },

  /** Tüm sistem kullanıcılarını listeler. */
  async listSystemUsers(): Promise<SystemUserRecordDTO[]> {
    try {
      const list = await getJson<SystemUserRecordDTO[]>('/admin/users/system');
      if (Array.isArray(list) && list.length > 0) {
        writeLocalUsers(list);
        return list;
      }
    } catch {}
    return readLocalUsers();
  },

  /** Yeni bir sistem kullanıcısı oluşturur. */
  async createSystemUser(dto: CreateSystemUserRequestDTO): Promise<SystemUserRecordDTO> {
    try {
      const created = await postJson<CreateSystemUserRequestDTO, SystemUserRecordDTO>(
        '/admin/users/system',
        dto
      );
      const current = readLocalUsers().filter(
        (u) => u.email.toLowerCase() !== created.email.toLowerCase()
      );
      writeLocalUsers([...current, created]);
      return created;
    } catch (err) {
      const current = readLocalUsers();
      const emailClean = dto.email.trim().toLowerCase();
      if (current.some((u) => u.email.toLowerCase() === emailClean)) {
        throw new Error('Bu e-posta adresi ile kayıtlı bir sistem kullanıcısı zaten mevcut.');
      }
      const fallback: SystemUserRecordDTO = {
        id: `sys_usr_${Math.random().toString(16).slice(2, 8)}`,
        full_name: dto.full_name.trim() || 'Sistem Kullanıcısı',
        email: emailClean,
        password: dto.password.trim() || '123456',
        role: dto.role || 'Sistem Yöneticisi',
        status: dto.status || 'active',
        last_login_at: null,
        created_at: new Date().toISOString(),
      };
      writeLocalUsers([...current, fallback]);
      return fallback;
    }
  },

  /** Mevcut bir sistem kullanıcısını günceller. */
  async updateSystemUser(
    userId: string,
    dto: UpdateSystemUserRequestDTO
  ): Promise<SystemUserRecordDTO> {
    try {
      const updated = await patchJson<UpdateSystemUserRequestDTO, SystemUserRecordDTO>(
        `/admin/users/system/${encodeURIComponent(userId)}`,
        dto
      );
      const next = readLocalUsers().map((u) => (u.id === userId ? updated : u));
      writeLocalUsers(next);
      const authUser = this.getAuthenticatedUser();
      if (authUser && authUser.id === userId) {
        this.setAuthenticatedUser(updated);
      }
      return updated;
    } catch {
      const current = readLocalUsers();
      const target = current.find((u) => u.id === userId);
      if (!target) {
        throw new Error('Sistem kullanıcısı bulunamadı.');
      }
      const updated: SystemUserRecordDTO = {
        ...target,
        full_name: dto.full_name?.trim() || target.full_name,
        email: dto.email?.trim().toLowerCase() || target.email,
        password: dto.password?.trim() || target.password,
        role: dto.role || target.role,
        status: dto.status || target.status,
      };
      writeLocalUsers(current.map((u) => (u.id === userId ? updated : u)));
      const authUser = this.getAuthenticatedUser();
      if (authUser && authUser.id === userId) {
        this.setAuthenticatedUser(updated);
      }
      return updated;
    }
  },

  /** Sistem kullanıcısının aktif/pasif durumunu değiştirir. */
  async toggleStatus(userId: string): Promise<SystemUserRecordDTO> {
    try {
      const updated = await patchJson<undefined, SystemUserRecordDTO>(
        `/admin/users/system/${encodeURIComponent(userId)}/toggle-status`
      );
      const next = readLocalUsers().map((u) => (u.id === userId ? updated : u));
      writeLocalUsers(next);
      return updated;
    } catch {
      const current = readLocalUsers();
      const target = current.find((u) => u.id === userId);
      if (!target) {
        throw new Error('Sistem kullanıcısı bulunamadı.');
      }
      const updated: SystemUserRecordDTO = {
        ...target,
        status: target.status === 'active' ? 'suspended' : 'active',
      };
      writeLocalUsers(current.map((u) => (u.id === userId ? updated : u)));
      return updated;
    }
  },

  /** Sistem veya kota kullanıcısını siler. */
  async deleteSystemUser(userId: string): Promise<void> {
    const current = readLocalUsers();
    const isLocalAdmin = current.some((u) => u.id === userId);
    if (isLocalAdmin && current.length <= 1) {
      throw new Error('Sistemde en az bir yönetici kullanıcısı kalmalıdır.');
    }
    await deleteJson<{ status: string; id: string }>(
      `/admin/users/system/${encodeURIComponent(userId)}`
    );
    if (isLocalAdmin) {
      writeLocalUsers(current.filter((u) => u.id !== userId));
    }
  },

  /** E-posta ve şifre ile Admin Panel girişi yapar. */
  async login(dto: SystemUserLoginRequestDTO): Promise<SystemUserLoginResponseDTO> {
    const emailClean = dto.email.trim().toLowerCase();
    const passwordClean = dto.password.trim();

    try {
      const res = await postJson<SystemUserLoginRequestDTO, SystemUserLoginResponseDTO>(
        '/admin/users/auth/login',
        { email: emailClean, password: passwordClean }
      );
      if (res && res.authenticated && res.user) {
        this.setAuthenticatedUser(res.user);
        return res;
      }
    } catch (err) {
      // Fallback to local users if backend route unreachable, or rethrow if explicit auth error
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('hatalı') ||
        msg.includes('pasif') ||
        msg.includes('bulunmuyor')
      ) {
        throw new Error(msg);
      }
    }

    const users = readLocalUsers();
    const matched = users.find((u) => u.email.toLowerCase() === emailClean);
    if (!matched || (matched.password || '190300') !== passwordClean) {
      throw new Error('E-posta adresi veya şifre hatalı.');
    }
    if (matched.status !== 'active') {
      throw new Error('Bu kullanıcı hesabı pasif durumdadır. Giriş yetkisi bulunmuyor.');
    }
    const updatedUser: SystemUserRecordDTO = {
      ...matched,
      last_login_at: new Date().toISOString(),
    };
    writeLocalUsers(users.map((u) => (u.id === matched.id ? updatedUser : u)));
    this.setAuthenticatedUser(updatedUser);
    return {
      authenticated: true,
      user: updatedUser,
      token: `adm_tok_local_${Date.now()}`,
    };
  },
};
