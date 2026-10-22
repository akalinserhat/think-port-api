import {
  CreateRolePermissionRequestDTO,
  RolePermissionDTO,
  UpdateRolePermissionRequestDTO,
} from '../dtos/admin.dto';
import { ModuleRegistry } from '@akalin/module_core';
import { initializeGatewayModules } from '../modules/registerModules';
import { deleteJson, getJson, patchJson, postJson } from './httpClient';

const STORAGE_ROLES_KEY = 'gateway_roles_permissions_v1';

export interface PermissionMeta {
  code: string;
  label: string;
  description: string;
  group: string;
}

const BASE_PERMISSION_CATALOG: PermissionMeta[] = [
  {
    code: 'overview.view',
    label: 'Genel Bakış & Telemetri Görüntüleme',
    description: 'Sistem metriklerini, canlı aktivite akışını ve log kayıtlarını görüntüleme yetkisi.',
    group: 'İzleme ve Raporlama',
  },
  {
    code: 'chat.use',
    label: 'AI Sohbet Stüdyosu Kullanımı',
    description: 'AI Sohbet Stüdyosu üzerinden yerel ve bulut dil modelleriyle sohbet başlatma yetkisi.',
    group: 'Yapay Zeka & API',
  },
  {
    code: 'chat.manage_all',
    label: 'Tüm Sohbet Kayıtlarını Yönetme',
    description: 'Tüm kullanıcılara ait sohbet geçmişlerini ve token tüketim detaylarını inceleme yetkisi.',
    group: 'Yapay Zeka & API',
  },
  {
    code: 'users.view',
    label: 'Kullanıcıları ve Kotaları Görüntüleme',
    description: 'Kullanıcı listesini, hesap türlerini ve token tahsislerini inceleme yetkisi.',
    group: 'Kullanıcı ve Kota Yönetimi',
  },
  {
    code: 'users.manage',
    label: 'Kullanıcı Ekleme, Düzenleme ve Şifre Sıfırlama',
    description: 'Yeni kullanıcı açma, bilgileri güncelleme ve şifre sıfırlama e-postası gönderme yetkisi.',
    group: 'Kullanıcı ve Kota Yönetimi',
  },
  {
    code: 'tokens.manage',
    label: 'Token Paketleri Tanımlama ve Düzenleme',
    description: 'Kullanıcılara tarih aralıklı token paketi tanımlama, düzenleme ve silme yetkisi.',
    group: 'Kullanıcı ve Kota Yönetimi',
  },
  {
    code: 'apikeys.view',
    label: 'API Anahtarlarını Görüntüleme',
    description: 'Kullanıcılara ait API anahtarlarını ve geçerlilik tarihlerini listeleme yetkisi.',
    group: 'Güvenlik ve Erişim',
  },
  {
    code: 'apikeys.manage',
    label: 'API Anahtarı Üretme ve İptal Etme',
    description: 'Yeni `sk-live` API anahtarı oluşturma ve mevcut anahtarları iptal etme yetkisi.',
    group: 'Güvenlik ve Erişim',
  },
  {
    code: 'nodes.view',
    label: 'Tarayıcı Havuzu ve Proxy İzleme',
    description: 'Oturum havuzu grafiklerini ve proxy düğümlerini izleme yetkisi.',
    group: 'Altyapı ve Ağ',
  },
  {
    code: 'nodes.manage',
    label: 'Oturum ve Proxy Havuzu Yönetimi',
    description: 'Yeni tarayıcı oturumu başlatma, sonlandırma ve proxy ekleme/silme yetkisi.',
    group: 'Altyapı ve Ağ',
  },
  {
    code: 'settings.manage',
    label: 'Sistem Ayarları ve Rol Yönetimi',
    description: 'Gateway hız limitlerini ve rol-yetki matrisini yapılandırma yetkisi.',
    group: 'Sistem Yönetimi',
  },
];

export function getMergedPermissionCatalog(): PermissionMeta[] {
  initializeGatewayModules();
  const merged = [...BASE_PERMISSION_CATALOG];
  const existingCodes = new Set(merged.map((p) => p.code));
  try {
    const modulePerms = ModuleRegistry.getAllPermissions();
    modulePerms.forEach((mp) => {
      const anyPerm = mp as unknown as Record<string, string | undefined>;
      if (!existingCodes.has(mp.key)) {
        existingCodes.add(mp.key);
        merged.push({
          code: mp.key,
          label: anyPerm.name || mp.labelKey || mp.key,
          description: mp.description || anyPerm.name || mp.labelKey || mp.key,
          group: anyPerm.group || mp.entityTitleKey || mp.moduleTitle || 'Modül Yetkileri',
        });
      }
    });
  } catch {}
  return merged;
}

export const PERMISSION_CATALOG: PermissionMeta[] = getMergedPermissionCatalog();

export const ALL_PERMISSION_CODES = PERMISSION_CATALOG.map((p) => p.code);

export function isProtectedAdminRole(roleOrId?: Partial<RolePermissionDTO> | string | null): boolean {
  if (!roleOrId) return false;
  if (typeof roleOrId === 'string') {
    const clean = roleOrId.trim().toLowerCase();
    return clean === 'role_admin' || clean === 'admin';
  }
  const idClean = (roleOrId.id || '').trim().toLowerCase();
  const nameClean = (roleOrId.name || '').trim().toLowerCase();
  return idClean === 'role_admin' || nameClean === 'admin';
}

const DEFAULT_ADMIN_ROLE: RolePermissionDTO = {
  id: 'role_admin',
  name: 'Admin',
  description:
    'Tüm modüllere, kullanıcılara, kota tanımlarına, bağlantı havuzuna, SMTP ve sistem ayarlarına tam yönetim yetkisi (Tam Yetkili - Silinemez).',
  is_system: true,
  is_admin_panel_allowed: true,
  permissions: ALL_PERMISSION_CODES,
  assigned_user_count: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const DEFAULT_ROLES: RolePermissionDTO[] = [
  DEFAULT_ADMIN_ROLE,
  {
    id: 'role_ops_admin',
    name: 'Operasyon Yöneticisi',
    description: 'Tarayıcı oturum havuzu, proxy düğümleri, kota tanımlamaları ve canlı telemetri yönetimi.',
    is_system: true,
    is_admin_panel_allowed: true,
    permissions: [
      'overview.view',
      'chat.use',
      'chat.manage_all',
      'users.view',
      'users.manage',
      'tokens.manage',
      'apikeys.view',
      'nodes.view',
      'nodes.manage',
    ],
    assigned_user_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'role_sec_admin',
    name: 'Güvenlik Yöneticisi',
    description: 'API anahtarları, erişim denetimi, anti-bot kuralları, roller ve güvenlik logları yönetimi.',
    is_system: true,
    is_admin_panel_allowed: true,
    permissions: [
      'overview.view',
      'chat.use',
      'users.view',
      'apikeys.view',
      'apikeys.manage',
      'nodes.view',
      'settings.manage',
    ],
    assigned_user_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'role_readonly',
    name: 'Salt Okunur Yönetici',
    description: 'Yönetim paneli metriklerini, kullanıcı ve log kayıtlarını değişiklik yapmadan izleme yetkisi.',
    is_system: true,
    is_admin_panel_allowed: true,
    permissions: ['overview.view', 'chat.use', 'users.view', 'apikeys.view', 'nodes.view'],
    assigned_user_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'role_api_user',
    name: 'API / Kota Kullanıcısı',
    description: 'Sadece AI Sohbet Stüdyosu ve tanımlanan token kotası dahilinde API uç noktalarını kullanabilir.',
    is_system: true,
    is_admin_panel_allowed: false,
    permissions: ['chat.use'],
    assigned_user_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

function ensureAdminRoleFirstAndFull(list: RolePermissionDTO[]): RolePermissionDTO[] {
  const existingAdmin = list.find((r) => isProtectedAdminRole(r));
  const enforcedAdmin: RolePermissionDTO = {
    ...(existingAdmin || DEFAULT_ADMIN_ROLE),
    id: existingAdmin?.id || 'role_admin',
    name: 'Admin',
    description:
      existingAdmin?.description ||
      DEFAULT_ADMIN_ROLE.description,
    is_system: true,
    is_admin_panel_allowed: true,
    permissions: [...ALL_PERMISSION_CODES],
    assigned_user_count: existingAdmin?.assigned_user_count ?? 1,
  };
  const others = list.filter((r) => !isProtectedAdminRole(r));
  return [enforcedAdmin, ...others];
}

function readLocalRoles(): RolePermissionDTO[] {
  try {
    const raw = localStorage.getItem(STORAGE_ROLES_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_ROLES_KEY, JSON.stringify(DEFAULT_ROLES));
      return DEFAULT_ROLES;
    }
    const parsed = JSON.parse(raw) as RolePermissionDTO[];
    const valid = Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_ROLES;
    const normalized = ensureAdminRoleFirstAndFull(valid);
    localStorage.setItem(STORAGE_ROLES_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return DEFAULT_ROLES;
  }
}

function writeLocalRoles(roles: RolePermissionDTO[]): void {
  try {
    const normalized = ensureAdminRoleFirstAndFull(roles);
    localStorage.setItem(STORAGE_ROLES_KEY, JSON.stringify(normalized));
  } catch {}
}

export const roleService = {
  /** Tüm rol ve yetki tanımlarını listeler (Admin rolü her zaman en üstte ve tam yetkilidir). */
  async listRoles(): Promise<RolePermissionDTO[]> {
    try {
      const list = await getJson<RolePermissionDTO[]>('/admin/roles');
      if (Array.isArray(list) && list.length > 0) {
        const normalized = ensureAdminRoleFirstAndFull(list);
        writeLocalRoles(normalized);
        return normalized;
      }
    } catch {}
    return readLocalRoles();
  },

  /** Yeni bir rol ve yetki grubu oluşturur. */
  async createRole(dto: CreateRolePermissionRequestDTO): Promise<RolePermissionDTO> {
    if (dto.name.trim().toLowerCase() === 'admin') {
      throw new Error("'Admin' rolü sistemde zaten tam yetkili olarak mevcuttur.");
    }
    try {
      const created = await postJson<CreateRolePermissionRequestDTO, RolePermissionDTO>(
        '/admin/roles',
        dto
      );
      const current = readLocalRoles().filter((r) => r.id !== created.id);
      writeLocalRoles([...current, created]);
      return created;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('zaten mevcut') || msg.includes('boş olamaz') || msg.includes('zorunlu')) {
        throw err;
      }
      const current = readLocalRoles();
      const now = new Date().toISOString();
      const fallback: RolePermissionDTO = {
        id: `role_${Math.random().toString(16).slice(2, 10)}`,
        name: dto.name.trim(),
        description: (dto.description || '').trim(),
        is_system: false,
        is_admin_panel_allowed: dto.is_admin_panel_allowed ?? true,
        permissions: Array.isArray(dto.permissions) ? dto.permissions : ['overview.view'],
        assigned_user_count: 0,
        created_at: now,
        updated_at: now,
      };
      writeLocalRoles([...current, fallback]);
      return fallback;
    }
  },

  /** Mevcut bir rolün adı, açıklaması ve yetki listesini günceller. */
  async updateRole(roleId: string, dto: UpdateRolePermissionRequestDTO): Promise<RolePermissionDTO> {
    const isAdmin = isProtectedAdminRole(roleId) || isProtectedAdminRole(dto.name);
    const safePayload: UpdateRolePermissionRequestDTO = isAdmin
      ? {
          name: 'Admin',
          description: dto.description,
          is_admin_panel_allowed: true,
          permissions: [...ALL_PERMISSION_CODES],
        }
      : dto;

    try {
      const updated = await patchJson<UpdateRolePermissionRequestDTO, RolePermissionDTO>(
        `/admin/roles/${encodeURIComponent(roleId)}`,
        safePayload
      );
      const next = readLocalRoles().map((r) =>
        r.id === roleId || (isAdmin && isProtectedAdminRole(r)) ? updated : r
      );
      writeLocalRoles(next);
      return updated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('zaten mevcut') || msg.includes('bulunamadı')) {
        throw err;
      }
      const current = readLocalRoles();
      const target = current.find(
        (r) => r.id === roleId || (isAdmin && isProtectedAdminRole(r))
      );
      if (!target) {
        throw new Error('Rol bulunamadı.');
      }
      const updated: RolePermissionDTO = {
        ...target,
        name: isAdmin ? 'Admin' : safePayload.name !== undefined ? safePayload.name.trim() : target.name,
        description:
          safePayload.description !== undefined
            ? safePayload.description.trim()
            : target.description,
        is_admin_panel_allowed: isAdmin
          ? true
          : safePayload.is_admin_panel_allowed !== undefined
            ? safePayload.is_admin_panel_allowed
            : target.is_admin_panel_allowed,
        permissions: isAdmin
          ? [...ALL_PERMISSION_CODES]
          : Array.isArray(safePayload.permissions)
            ? safePayload.permissions
            : target.permissions,
        updated_at: new Date().toISOString(),
      };
      writeLocalRoles(current.map((r) => (r.id === target.id ? updated : r)));
      return updated;
    }
  },

  /** Özel tanımlanmış bir rolü siler (Admin ve sistem rolleri kesinlikle silinemez). */
  async deleteRole(roleId: string): Promise<void> {
    if (isProtectedAdminRole(roleId)) {
      throw new Error('Admin rolü tam yetkili ana sistem rolüdür ve yanlışlıkla da olsa silinemez.');
    }
    const current = readLocalRoles();
    const target = current.find((r) => r.id === roleId);
    if (target && (isProtectedAdminRole(target) || target.is_system)) {
      throw new Error(
        isProtectedAdminRole(target)
          ? 'Admin rolü tam yetkili ana sistem rolüdür ve yanlışlıkla da olsa silinemez.'
          : `'${target.name}' varsayılan sistem rolüdür ve silinemez.`
      );
    }
    await deleteJson<{ status: string; id: string }>(
      `/admin/roles/${encodeURIComponent(roleId)}`
    );
    writeLocalRoles(current.filter((r) => r.id !== roleId));
  },
};
