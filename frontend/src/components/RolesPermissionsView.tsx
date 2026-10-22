import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Users,
  CheckCircle2,
  Edit2,
  Trash2,
  CheckSquare,
  Square,
  Lock,
  Plus,
  RefreshCw,
} from 'lucide-react';
import {
  BaseListPage,
  BaseCardPage,
  BaseInput,
  BaseSwitch,
  PolicySettingCard,
  useBaseSystemPage,
  type DataTableColumn,
  type ActionMenuItem,
} from '@akalin/ui';
import { RolePermissionDTO } from '../dtos';
import {
  roleService,
  PERMISSION_CATALOG,
  ALL_PERMISSION_CODES,
  isProtectedAdminRole,
  type PermissionMeta,
} from '../services';

interface RolesPermissionsViewProps {
  onShowToast: (msg: string) => void;
  onRolesUpdated?: (roles: RolePermissionDTO[]) => void;
}

export const RolesPermissionsView: React.FC<RolesPermissionsViewProps> = ({
  onShowToast,
  onRolesUpdated,
}) => {
  const { filterItems } = useBaseSystemPage();

  const [roles, setRoles] = useState<RolePermissionDTO[]>([]);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // Card View (Create / Edit Role)
  const [isCardOpen, setIsCardOpen] = useState<boolean>(false);
  const [editingRole, setEditingRole] = useState<RolePermissionDTO | null>(null);
  const [roleName, setRoleName] = useState<string>('');
  const [roleDescription, setRoleDescription] = useState<string>('');
  const [isAdminPanelAllowed, setIsAdminPanelAllowed] = useState<boolean>(true);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [saving, setSaving] = useState<boolean>(false);

  const isEditingProtectedAdmin = useMemo(
    () => Boolean(editingRole && isProtectedAdminRole(editingRole)),
    [editingRole]
  );

  const loadRoles = useCallback(async (): Promise<RolePermissionDTO[]> => {
    try {
      const list = await roleService.listRoles();
      setRoles(list);
      onRolesUpdated?.(list);
      return list;
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : String(err));
      return [];
    }
  }, [onShowToast, onRolesUpdated]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const openCreateCard = useCallback(() => {
    setEditingRole(null);
    setRoleName('');
    setRoleDescription('');
    setIsAdminPanelAllowed(true);
    setSelectedPermissions(['overview.view', 'chat.use']);
    setIsCardOpen(true);
  }, []);

  const openEditCard = useCallback((role: RolePermissionDTO) => {
    const isAdmin = isProtectedAdminRole(role);
    setEditingRole(role);
    setRoleName(isAdmin ? 'Admin' : role.name);
    setRoleDescription(role.description || '');
    setIsAdminPanelAllowed(isAdmin ? true : role.is_admin_panel_allowed);
    setSelectedPermissions(
      isAdmin
        ? [...ALL_PERMISSION_CODES]
        : Array.isArray(role.permissions)
          ? [...role.permissions]
          : []
    );
    setIsCardOpen(true);
  }, []);

  const togglePermission = useCallback(
    (code: string, checked: boolean) => {
      if (isEditingProtectedAdmin) {
        onShowToast('Admin rolü tam yetkilidir, yetkileri kısıtlanamaz.');
        return;
      }
      setSelectedPermissions((prev) => {
        if (checked) {
          return prev.includes(code) ? prev : [...prev, code];
        }
        return prev.filter((item) => item !== code);
      });
    },
    [isEditingProtectedAdmin, onShowToast]
  );

  const handleSaveRole = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const cleanName = isEditingProtectedAdmin ? 'Admin' : roleName.trim();
    if (!cleanName) {
      onShowToast('Lütfen rol adını girin.');
      return;
    }

    setSaving(true);
    try {
      if (editingRole) {
        await roleService.updateRole(editingRole.id, {
          name: cleanName,
          description: roleDescription.trim(),
          is_admin_panel_allowed: isEditingProtectedAdmin ? true : isAdminPanelAllowed,
          permissions: isEditingProtectedAdmin
            ? [...ALL_PERMISSION_CODES]
            : selectedPermissions,
        });
        onShowToast(`"${cleanName}" rolü ve yetkileri güncellendi.`);
      } else {
        await roleService.createRole({
          name: cleanName,
          description: roleDescription.trim(),
          is_admin_panel_allowed: isAdminPanelAllowed,
          permissions: selectedPermissions,
        });
        onShowToast(`"${cleanName}" rolü oluşturuldu.`);
      }
      await loadRoles();
      setRefreshKey((prev) => prev + 1);
      setIsCardOpen(false);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = useCallback(
    async (role: RolePermissionDTO) => {
      if (isProtectedAdminRole(role)) {
        onShowToast('Admin rolü tam yetkili ana sistem rolüdür ve yanlışlıkla da olsa silinemez.');
        return;
      }
      if (role.is_system) {
        onShowToast('Varsayılan sistem rolleri silinemez.');
        return;
      }
      try {
        await roleService.deleteRole(role.id);
        onShowToast(`"${role.name}" rolü silindi.`);
        await loadRoles();
        setRefreshKey((prev) => prev + 1);
        if (editingRole?.id === role.id) {
          setIsCardOpen(false);
        }
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : String(err));
      }
    },
    [editingRole, loadRoles, onShowToast]
  );

  const handleCanDeleteRole = useCallback((role: RolePermissionDTO) => {
    if (isProtectedAdminRole(role)) {
      return {
        canDelete: false,
        message: 'Admin rolü tam yetkili ana sistem rolüdür ve yanlışlıkla da olsa silinemez.',
      };
    }
    if (role.is_system) {
      return {
        canDelete: false,
        message: `"${role.name}" varsayılan sistem rolüdür ve silinemez.`,
      };
    }
    return { canDelete: true };
  }, []);

  const handleDeleteRoleById = useCallback(
    async (id: string | number) => {
      const roleId = String(id);
      if (isProtectedAdminRole(roleId)) {
        throw new Error(
          'Admin rolü tam yetkili ana sistem rolüdür ve yanlışlıkla da olsa silinemez.'
        );
      }
      await roleService.deleteRole(roleId);
      await loadRoles();
      setRefreshKey((prev) => prev + 1);
    },
    [loadRoles]
  );

  const handleFetchRoles = useCallback(
    async (paramsObj?: Record<string, any>) => {
      const list = await roleService.listRoles();
      setRoles(list);
      onRolesUpdated?.(list);

      const qParams = paramsObj?.queryParams || {};
      const aramaData = paramsObj?.aramaData || {};
      const rawSearch =
        qParams.aramaKelimesi || qParams.arama || aramaData.value || '';
      const searchVal = String(rawSearch).trim().toLowerCase();
      const searchFieldVal =
        aramaData.searchType || qParams.aramaTipi || aramaData.type || 'Tumu';

      let filtered = filterItems(list, (r) => [
        r.name,
        r.description,
        ...(Array.isArray(r.permissions) ? r.permissions : []),
      ]);

      if (searchVal) {
        filtered = filtered.filter((r) => {
          if (searchFieldVal === 'name') {
            return r.name.toLowerCase().includes(searchVal);
          }
          if (searchFieldVal === 'description') {
            return (r.description || '').toLowerCase().includes(searchVal);
          }
          return (
            r.name.toLowerCase().includes(searchVal) ||
            (r.description || '').toLowerCase().includes(searchVal) ||
            (Array.isArray(r.permissions) &&
              r.permissions.some((p) => p.toLowerCase().includes(searchVal)))
          );
        });
      }

      return {
        data: filtered,
        totalCount: filtered.length,
      };
    },
    [filterItems, onRolesUpdated]
  );

  const permissionGroups = useMemo(() => {
    const map = new Map<string, PermissionMeta[]>();
    for (const item of PERMISSION_CATALOG) {
      const list = map.get(item.group) || [];
      list.push(item);
      map.set(item.group, list);
    }
    return Array.from(map.entries());
  }, []);

  const cardExtraActions = useMemo<ActionMenuItem[]>(() => {
    const items: ActionMenuItem[] = [
      {
        label: 'Admin Panel Giriş Yetkisi',
        icon: isAdminPanelAllowed ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />,
        closeOnClick: false,
        dividerAbove: true,
        badge: (
          <div
            onClick={(ev) => ev.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            <BaseSwitch
              checked={isEditingProtectedAdmin ? true : isAdminPanelAllowed}
              disabled={saving || isEditingProtectedAdmin}
              onChange={(ev) => {
                if (!isEditingProtectedAdmin) {
                  setIsAdminPanelAllowed(ev.target.checked);
                }
              }}
            />
          </div>
        ),
        onClick: () => {
          if (!saving && !isEditingProtectedAdmin) {
            setIsAdminPanelAllowed((prev) => !prev);
          }
        },
      },
    ];

    if (!isEditingProtectedAdmin) {
      items.push(
        {
          label: 'Tüm Yetkileri Seç',
          icon: <CheckSquare size={15} />,
          dividerAbove: true,
          disabled: saving,
          onClick: () => setSelectedPermissions([...ALL_PERMISSION_CODES]),
        },
        {
          label: 'Tüm Yetkileri Kaldır',
          icon: <Square size={15} />,
          disabled: saving,
          onClick: () => setSelectedPermissions([]),
        }
      );
    }

    if (editingRole && !editingRole.is_system && !isProtectedAdminRole(editingRole)) {
      items.push({
        label: 'Rolü Sil',
        icon: <Trash2 size={15} />,
        danger: true,
        dividerAbove: true,
        disabled: saving,
        onClick: () => void handleDeleteRole(editingRole),
      });
    }

    return items;
  }, [
    isAdminPanelAllowed,
    isEditingProtectedAdmin,
    saving,
    editingRole,
    handleDeleteRole,
  ]);

  const columns: DataTableColumn<RolePermissionDTO>[] = useMemo(
    () => [
      {
        id: 'name',
        header: 'Rol Adı & Açıklama',
        accessor: 'name',
        sortable: true,
        render: (r) => {
          const isAdmin = isProtectedAdminRole(r);
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: isAdmin
                    ? 'rgba(79, 70, 229, 0.18)'
                    : r.is_admin_panel_allowed
                      ? 'rgba(79, 70, 229, 0.12)'
                      : 'rgba(16, 185, 129, 0.14)',
                  color:
                    isAdmin || r.is_admin_panel_allowed
                      ? 'var(--primary)'
                      : 'var(--success)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {isAdmin || r.is_admin_panel_allowed ? (
                  <ShieldCheck size={18} />
                ) : (
                  <KeyRound size={18} />
                )}
              </div>
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: 700,
                    fontSize: '13.5px',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span>{isAdmin ? 'Admin' : r.name}</span>
                  {isAdmin ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '999px',
                        background: 'rgba(79, 70, 229, 0.14)',
                        border: '1px solid rgba(79, 70, 229, 0.3)',
                        color: 'var(--primary)',
                      }}
                    >
                      <Lock size={10} />
                      Tam Yetkili · Silinemez
                    </span>
                  ) : (
                    r.is_system && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '10.5px',
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: '999px',
                          background: 'var(--surface-secondary)',
                          border: '1px solid var(--glass-border)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <Lock size={10} />
                        Sistem Rolü
                      </span>
                    )
                  )}
                </div>
                <div
                  style={{
                    marginTop: '2px',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    maxWidth: '520px',
                  }}
                >
                  {r.description || 'Açıklama belirtilmedi'}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: 'is_admin_panel_allowed',
        header: 'Erişim Kapsamı',
        accessor: 'is_admin_panel_allowed',
        sortable: true,
        render: (r) => {
          const allowed = isProtectedAdminRole(r) ? true : r.is_admin_panel_allowed;
          return (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '999px',
                fontSize: '11.5px',
                fontWeight: 600,
                background: allowed
                  ? 'rgba(79, 70, 229, 0.12)'
                  : 'rgba(16, 185, 129, 0.12)',
                color: allowed ? 'var(--primary)' : 'var(--success)',
              }}
            >
              {allowed ? 'Admin Panel + API' : 'Sadece API & Stüdyo'}
            </span>
          );
        },
      },
      {
        id: 'permissions',
        header: 'Aktif Yetkiler',
        sortable: false,
        render: (r) => {
          const isAdmin = isProtectedAdminRole(r);
          const total = PERMISSION_CATALOG.length;
          const count = isAdmin
            ? total
            : Array.isArray(r.permissions)
              ? r.permissions.length
              : 0;
          return (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 10px',
                  borderRadius: '8px',
                  background: isAdmin
                    ? 'rgba(16, 185, 129, 0.12)'
                    : 'var(--surface-secondary)',
                  border: isAdmin
                    ? '1px solid rgba(16, 185, 129, 0.3)'
                    : '1px solid var(--glass-border)',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: isAdmin ? 'var(--success)' : 'var(--text-primary)',
                }}
              >
                <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
                {count} / {total} Yetki {isAdmin ? '(Tam Yetki)' : ''}
              </span>
            </div>
          );
        },
      },
      {
        id: 'assigned_user_count',
        header: 'Kullanıcı Sayısı',
        accessor: 'assigned_user_count',
        sortable: true,
        render: (r) => (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12.5px',
              fontWeight: 600,
              color: 'var(--text-secondary)',
            }}
          >
            <Users size={14} />
            {r.assigned_user_count || 0} Kullanıcı
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'İşlem',
        align: 'right',
        width: '100px',
        render: (r) => {
          const isProtected = isProtectedAdminRole(r) || r.is_system;
          return (
            <div
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => openEditCard(r)}
                title="Rol ve Yetkileri İncele / Düzenle"
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '8px',
                  border: '1px solid var(--glass-border)',
                  background: 'var(--surface-secondary)',
                  color: 'var(--text-primary)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <Edit2 size={13.5} />
              </button>
              {!isProtected && (
                <button
                  type="button"
                  onClick={() => void handleDeleteRole(r)}
                  title="Rolü Sil"
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '8px',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    background: 'rgba(239, 68, 68, 0.08)',
                    color: 'var(--danger)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={13.5} />
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [openEditCard, handleDeleteRole]
  );

  const searchableFields = useMemo(
    () => [
      { id: 'Tumu', label: 'Genel', iconName: 'Search', type: 'text' },
      { id: 'name', key: 'name', label: 'Rol Adı', iconName: 'Tag', type: 'text' },
      { id: 'description', key: 'description', label: 'Açıklama', iconName: 'FileText', type: 'text' },
    ],
    []
  );

  if (isCardOpen) {
    return (
      <BaseCardPage
        id="role-permissions-card"
        title={
          editingRole
            ? `${isEditingProtectedAdmin ? 'Admin' : editingRole.name} — Yetki Kartı`
            : 'Yeni Rol ve Yetki Tanımla'
        }
        subtitle={
          isEditingProtectedAdmin
            ? 'Admin rolü sistemin ana tam yetkili rolüdür. Yanlışlıkla silinmeye ve yetki kısıtlamasına karşı korumalıdır.'
            : 'Rol bilgilerini ve modül bazlı erişim yetkilerini yapılandırın.'
        }
        icon={<ShieldCheck size={22} />}
        asForm
        onSubmit={handleSaveRole}
        onSave={handleSaveRole}
        isSaving={saving}
        showBackButton={true}
        onBack={() => setIsCardOpen(false)}
        enableAiAssistant={false}
        actionMenuHeader="Rol İşlemleri"
        extraDropdownActions={cardExtraActions}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {isEditingProtectedAdmin && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 16px',
                borderRadius: '12px',
                background: 'rgba(79, 70, 229, 0.10)',
                border: '1px solid rgba(79, 70, 229, 0.28)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              <Lock size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <span>
                <strong>Admin</strong> rolü sistemdeki tüm modüller üzerinde tam yetkilidir ve
                güvenlik gereği <strong>silinemez</strong> veya yetkileri kapatılamaz.
              </span>
            </div>
          )}

          <div className="settings-section-card">
            <div className="form-grid">
              <div className="form-field">
                <label className="form-label">Rol Adı</label>
                <BaseInput
                  value={isEditingProtectedAdmin ? 'Admin' : roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder="Örn: Veri Analisti"
                  disabled={Boolean(editingRole?.is_system) || isEditingProtectedAdmin}
                  required
                />
              </div>
              <div className="form-field">
                <label className="form-label">Rol Açıklaması</label>
                <BaseInput
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                  placeholder="Bu rolün kapsamını ve yetki sınırlarını açıklayın"
                />
              </div>
            </div>
          </div>

          {permissionGroups.map(([groupTitle, groupItems]) => (
            <div key={groupTitle} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text-secondary)',
                  paddingLeft: '4px',
                }}
              >
                {groupTitle}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {groupItems.map((perm) => {
                  const isChecked = isEditingProtectedAdmin
                    ? true
                    : selectedPermissions.includes(perm.code);
                  return (
                    <PolicySettingCard
                      key={perm.code}
                      icon={<ShieldCheck size={18} />}
                      iconActive={isChecked}
                      title={perm.label}
                      description={perm.description}
                      action={
                        <BaseSwitch
                          checked={isChecked}
                          disabled={isEditingProtectedAdmin}
                          onChange={(e) => togglePermission(perm.code, e.target.checked)}
                        />
                      }
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </BaseCardPage>
    );
  }

  return (
    <BaseListPage<RolePermissionDTO>
      title="Rol ve Yetkiler"
      subtitle="Sistem yöneticileri ve API kullanıcıları için rol gruplarını ve modül bazlı erişim yetkilerini yönetin."
      subtitleLeft={`${roles.length || 5} Tanımlı Rol · Admin Rolü Tam Yetkili & Korumalı`}
      icon={<ShieldCheck size={22} />}
      baseRoute="/settings/roles"
      columns={columns}
      searchableFields={searchableFields}
      customFetchData={handleFetchRoles}
      customDeleteData={handleDeleteRoleById}
      canDelete={handleCanDeleteRole}
      extraDropdownActions={[
        {
          label: 'Yeni Rol Tanımla',
          icon: <Plus size={15} />,
          isDefault: true,
          variant: 'primary',
          onClick: openCreateCard,
        },
        {
          label: 'Listeyi Yenile',
          icon: <RefreshCw size={15} />,
          dividerAbove: true,
          onClick: () => {
            void loadRoles();
            setRefreshKey((prev) => prev + 1);
          },
        },
      ]}
      enableArchive={false}
      enableViewModeToggle={false}
      enableAi={false}
      disableEdit={false}
      disableDelete={false}
      stickyActionColumn={false}
      enableColumnManagement={true}
      itemNameResolver={(r) => r.name}
      addNewText="Yeni Rol Tanımla"
      emptyMessage="Tanımlı rol bulunamadı."
      refreshKey={refreshKey}
      onAddNew={openCreateCard}
      onEdit={(r) => openEditCard(r)}
    />
  );
};
