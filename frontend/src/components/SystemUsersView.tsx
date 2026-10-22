import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldAlert,
  ShieldCheck,
  Users,
  Eye,
  EyeOff,
  Copy,
  Clock,
  Mail,
  Plus,
  RefreshCw,
} from 'lucide-react';
import {
  BaseCardPage,
  BaseInput,
  BaseListPage,
  BaseSwitch,
  EmailInput,
  useBaseSystemPage,
  type DataTableColumn,
  type ActionMenuItem,
} from '@akalin/ui';
import { SystemUserRecordDTO } from '../dtos';
import { smtpService, systemUserService } from '../services';

interface SystemUsersViewProps {
  title?: string;
  subtitle?: string;
  systemUsers: SystemUserRecordDTO[];
  currentAuthUser?: SystemUserRecordDTO | null;
  onRefreshSystemUsers: () => Promise<void>;
  onShowToast: (msg: string) => void;
}

const ROLE_OPTIONS = [
  'Admin',
  'Sistem Yöneticisi',
  'Operasyon Yöneticisi',
  'Güvenlik Yöneticisi',
  'Salt Okunur Yönetici',
];

export const SystemUsersView: React.FC<SystemUsersViewProps> = ({
  title,
  subtitle,
  systemUsers = [],
  currentAuthUser,
  onRefreshSystemUsers,
  onShowToast,
}) => {
  const { i18n } = useTranslation();
  const { filterItems } = useBaseSystemPage();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'tr-TR';

  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [manualRefreshKey, setManualRefreshKey] = useState<number>(0);

  // BaseCardPage state (Create & Edit)
  const [isCardOpen, setIsCardOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<SystemUserRecordDTO | null>(null);
  const [fullName, setFullName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [role, setRole] = useState<string>('Admin');
  const [status, setStatus] = useState<'active' | 'suspended'>('active');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setManualRefreshKey((prev) => prev + 1);
  }, [systemUsers]);

  const togglePasswordVisibility = useCallback((userId: string) => {
    setVisiblePasswords((prev) => ({
      ...prev,
      [userId]: !prev[userId],
    }));
  }, []);

  const openCreateCard = useCallback(() => {
    setEditingUser(null);
    setFullName('');
    setEmail('');
    setPassword('190300');
    setRole('Admin');
    setStatus('active');
    setFormError(null);
    setIsCardOpen(true);
  }, []);

  const openEditCard = useCallback((u: SystemUserRecordDTO) => {
    setEditingUser(u);
    setFullName(u.full_name);
    setEmail(u.email);
    setPassword(u.password || '190300');
    setRole(u.role || 'Admin');
    setStatus(u.status || 'active');
    setFormError(null);
    setIsCardOpen(true);
  }, []);

  const handleSaveUser = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    setFormError(null);
    if (!fullName.trim()) {
      setFormError('Ad Soyad alanı zorunludur.');
      return;
    }
    if (!email.trim()) {
      setFormError('E-posta adresi zorunludur.');
      return;
    }
    if (!password.trim()) {
      setFormError('Giriş şifresi zorunludur.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingUser) {
        await systemUserService.updateSystemUser(editingUser.id, {
          full_name: fullName.trim(),
          email: email.trim(),
          password: password.trim(),
          role,
          status,
        });
        onShowToast('Sistem kullanıcısı bilgileri güncellendi.');
      } else {
        await systemUserService.createSystemUser({
          full_name: fullName.trim(),
          email: email.trim(),
          password: password.trim(),
          role,
          status,
        });
        onShowToast('Yeni sistem kullanıcısı tanımlandı.');
      }
      setIsCardOpen(false);
      await onRefreshSystemUsers();
      setManualRefreshKey((prev) => prev + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = useCallback(
    async (u: SystemUserRecordDTO) => {
      try {
        await systemUserService.toggleStatus(u.id);
        onShowToast(
          u.status === 'active'
            ? `${u.full_name} kullanıcısının Admin panel giriş yetkisi pasife alındı.`
            : `${u.full_name} kullanıcısının Admin panel giriş yetkisi aktifleştirildi.`
        );
        await onRefreshSystemUsers();
        setManualRefreshKey((prev) => prev + 1);
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : String(err));
      }
    },
    [onRefreshSystemUsers, onShowToast]
  );

  const handleCanDeleteUser = useCallback(
    (u: SystemUserRecordDTO) => {
      if (systemUsers.length <= 1) {
        return {
          canDelete: false,
          message: 'Sistemde en az bir yönetici kullanıcısı kalmalıdır.',
        };
      }
      if (
        currentAuthUser &&
        (currentAuthUser.id === u.id ||
          currentAuthUser.email.toLowerCase() === u.email.toLowerCase())
      ) {
        return {
          canDelete: false,
          message: 'Aktif oturum açmış olduğunuz yönetici hesabını silemezsiniz.',
        };
      }
      return { canDelete: true };
    },
    [systemUsers.length, currentAuthUser]
  );

  const handleDeleteUserById = useCallback(
    async (id: string | number) => {
      await systemUserService.deleteSystemUser(String(id));
      await onRefreshSystemUsers();
      setManualRefreshKey((prev) => prev + 1);
    },
    [onRefreshSystemUsers]
  );

  const handleCopyCredentials = useCallback(
    (u: SystemUserRecordDTO) => {
      const text = `${u.email} / ${u.password || '190300'}`;
      navigator.clipboard.writeText(text);
      onShowToast('Giriş bilgileri panoya kopyalandı.');
    },
    [onShowToast]
  );

  const formatDateTime = useCallback(
    (iso?: string | null) => {
      if (!iso) return 'Henüz giriş yapılmadı';
      try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleString(locale, {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        return '—';
      }
    },
    [locale]
  );

  const searchableFields = useMemo(
    () => [
      { id: 'Tumu', label: 'Genel', iconName: 'Search', type: 'text' },
      { id: 'full_name', label: 'Ad Soyad', iconName: 'Users', type: 'text' },
      { id: 'email', label: 'E-posta', iconName: 'Mail', type: 'text' },
      { id: 'role', label: 'Yetki Rolü', iconName: 'Tag', type: 'text' },
      {
        id: 'status_filter',
        label: 'Hesap Durumu',
        iconName: 'CheckCircle',
        type: 'enum',
        isEnum: true,
        category: 'filter',
        options: [
          { id: 'status:active', label: 'Aktif (Giriş Açık)' },
          { id: 'status:suspended', label: 'Pasif (Engelli)' },
        ],
      },
    ],
    []
  );

  const handleFetchSystemUsers = useCallback(
    async (paramsObj?: Record<string, any>) => {
      const qParams = paramsObj?.queryParams || {};
      const aramaData = paramsObj?.aramaData || {};
      const rawSearch =
        qParams.aramaKelimesi || qParams.arama || aramaData.value || '';
      const searchVal = String(rawSearch).trim().toLowerCase();
      const searchFieldVal =
        aramaData.searchType || qParams.aramaTipi || aramaData.type || 'Tumu';
      const filterTypes: string[] = Array.isArray(aramaData.filterTypes)
        ? aramaData.filterTypes
        : [];
      const sortFieldVal = qParams.sortField || paramsObj?.sortField || '';
      const sortOrderVal =
        (qParams.sortOrder || paramsObj?.sortOrder || 'asc').toLowerCase() === 'desc'
          ? 'desc'
          : 'asc';

      let list = filterItems(systemUsers, (u) => [
        u.full_name,
        u.email,
        u.id,
        u.role,
        u.status,
      ]);

      if (filterTypes.length > 0) {
        const statusFilters = filterTypes.filter((f) => f.startsWith('status:'));
        if (statusFilters.length > 0) {
          list = list.filter((u) => {
            const isAct = u.status === 'active';
            return (
              (statusFilters.includes('status:active') && isAct) ||
              (statusFilters.includes('status:suspended') && !isAct)
            );
          });
        }
      }

      if (searchVal) {
        list = list.filter((u) => {
          if (searchFieldVal === 'full_name') {
            return u.full_name.toLowerCase().includes(searchVal);
          }
          if (searchFieldVal === 'email') {
            return u.email.toLowerCase().includes(searchVal);
          }
          if (searchFieldVal === 'role') {
            return (u.role || '').toLowerCase().includes(searchVal);
          }
          return (
            u.full_name.toLowerCase().includes(searchVal) ||
            u.email.toLowerCase().includes(searchVal) ||
            (u.role || '').toLowerCase().includes(searchVal)
          );
        });
      }

      if (sortFieldVal) {
        list = [...list].sort((a, b) => {
          const av = String((a as any)[sortFieldVal] ?? '').toLowerCase();
          const bv = String((b as any)[sortFieldVal] ?? '').toLowerCase();
          return sortOrderVal === 'asc'
            ? av.localeCompare(bv, locale)
            : bv.localeCompare(av, locale);
        });
      }

      return {
        data: list,
        totalCount: list.length,
      };
    },
    [systemUsers, filterItems, locale]
  );

  const customRowActions = useCallback(
    (u: SystemUserRecordDTO): ActionMenuItem[] => {
      const isActive = u.status === 'active';
      return [
        {
          label: isActive ? 'Giriş Yetkisini Pasife Al' : 'Giriş Yetkisini Aktifleştir',
          icon: isActive ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />,
          onClick: () => void handleToggleStatus(u),
        },
        {
          label: 'Şifre Sıfırlama E-postası Gönder',
          icon: <Mail size={15} />,
          onClick: async () => {
            try {
              const res = await smtpService.sendPasswordResetEmail({
                email: u.email,
                user_id: u.id,
                apply_temporary_password: true,
              });
              onShowToast(
                `${res.full_name} (${res.email}) adresine şifre sıfırlama e-postası gönderildi.`
              );
              await onRefreshSystemUsers();
              setManualRefreshKey((prev) => prev + 1);
            } catch (err) {
              onShowToast(err instanceof Error ? err.message : String(err));
            }
          },
        },
        {
          label: 'E-posta ve Şifreyi Kopyala',
          icon: <Copy size={15} />,
          onClick: () => handleCopyCredentials(u),
        },
      ];
    },
    [handleToggleStatus, handleCopyCredentials, onRefreshSystemUsers, onShowToast]
  );

  const columns: DataTableColumn<SystemUserRecordDTO>[] = useMemo(
    () => [
      {
        id: 'full_name',
        header: 'Sistem Kullanıcısı',
        accessor: 'full_name',
        sortable: true,
        render: (u) => {
          const isCurrentSession =
            currentAuthUser &&
            (currentAuthUser.id === u.id ||
              currentAuthUser.email.toLowerCase() === u.email.toLowerCase());
          const initials = u.full_name
            .trim()
            .split(/\s+/)
            .map((p) => p[0])
            .slice(0, 2)
            .join('')
            .toUpperCase();

          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'var(--md-sys-color-primary-container, rgba(79, 70, 229, 0.14))',
                  color: 'var(--md-sys-color-on-primary-container, var(--primary))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '13px',
                  flexShrink: 0,
                }}
              >
                {initials || 'AD'}
              </div>
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: 600,
                    fontSize: '13.5px',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span>{u.full_name}</span>
                  {isCurrentSession && (
                    <span
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: '999px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: 'var(--success)',
                      }}
                    >
                      Aktif Oturum
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '2px',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span>{u.email}</span>
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: 'role',
        header: 'Yetki Rolü',
        accessor: 'role',
        sortable: true,
        render: (u) => (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 600,
              background: 'var(--surface-secondary)',
              border: '1px solid var(--glass-border)',
              color: 'var(--text-primary)',
            }}
          >
            <ShieldCheck size={13} style={{ color: 'var(--primary)' }} />
            {u.role || 'Admin'}
          </span>
        ),
      },
      {
        id: 'password',
        header: 'Giriş Şifresi',
        accessor: 'password',
        sortable: false,
        render: (u) => {
          const isShown = Boolean(visiblePasswords[u.id]);
          const pwd = u.password || '190300';
          return (
            <div
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <code
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: 'var(--surface-secondary)',
                  border: '1px solid var(--glass-border)',
                  fontFamily: 'monospace',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  letterSpacing: isShown ? '0.5px' : '2px',
                  color: 'var(--text-primary)',
                }}
              >
                {isShown ? pwd : '••••••'}
              </code>
              <button
                type="button"
                onClick={() => togglePasswordVisibility(u.id)}
                title={isShown ? 'Şifreyi Gizle' : 'Şifreyi Göster'}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {isShown ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                type="button"
                onClick={() => handleCopyCredentials(u)}
                title="E-posta ve Şifreyi Kopyala"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <Copy size={13} />
              </button>
            </div>
          );
        },
      },
      {
        id: 'status',
        header: 'Giriş Yetkisi',
        accessor: 'status',
        sortable: true,
        render: (u) => {
          const isActive = u.status === 'active';
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
                background: isActive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                color: isActive ? 'var(--success)' : 'var(--danger)',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: isActive ? 'var(--success)' : 'var(--danger)',
                }}
              />
              {isActive ? 'Aktif (Giriş Açık)' : 'Pasif (Engelli)'}
            </span>
          );
        },
      },
      {
        id: 'last_login_at',
        header: 'Son Giriş',
        accessor: 'last_login_at',
        sortable: true,
        render: (u) => (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
            }}
          >
            <Clock size={13} />
            {formatDateTime(u.last_login_at)}
          </span>
        ),
      },
    ],
    [
      currentAuthUser,
      visiblePasswords,
      togglePasswordVisibility,
      handleCopyCredentials,
      formatDateTime,
    ]
  );

  const activeCount = useMemo(
    () => systemUsers.filter((u) => u.status === 'active').length,
    [systemUsers]
  );

  if (isCardOpen) {
    return (
      <BaseCardPage
        id="system-user-card-form"
        title={
          editingUser
            ? `${editingUser.full_name} — Sistem Kullanıcısı Kartı`
            : 'Yeni Sistem Kullanıcısı Tanımla'
        }
        subtitle="Admin yönetim paneline giriş yapabilen sistem yöneticisinin kimlik ve yetki bilgilerini yapılandırın."
        icon={<Users size={22} />}
        asForm={true}
        onSubmit={handleSaveUser}
        onSave={handleSaveUser}
        isSaving={submitting}
        showBackButton={true}
        onBack={() => setIsCardOpen(false)}
        enableAiAssistant={false}
        actionMenuHeader="Kullanıcı İşlemleri"
        extraDropdownActions={[
          {
            type: 'custom',
            content: (
              <BaseSwitch
                className="action-menu-switch-item"
                label="Aktif"
                checked={status === 'active'}
                onChange={(e) => setStatus(e.target.checked ? 'active' : 'suspended')}
              />
            ),
          },
          ...(editingUser || email.trim()
            ? [
                {
                  label: 'Şifre Sıfırlama E-postası Gönder',
                  icon: <Mail size={15} />,
                  dividerAbove: true,
                  onClick: async () => {
                    const targetEmail = (email || editingUser?.email || '').trim();
                    if (!targetEmail) {
                      onShowToast('Lütfen önce kullanıcının e-posta adresini girin.');
                      return;
                    }
                    try {
                      const res = await smtpService.sendPasswordResetEmail({
                        email: targetEmail,
                        user_id: editingUser?.id,
                        apply_temporary_password: true,
                      });
                      if (res.temporary_password) {
                        setPassword(res.temporary_password);
                      }
                      onShowToast(
                        `${res.full_name} (${res.email}) adresine şifre sıfırlama e-postası gönderildi.`
                      );
                      await onRefreshSystemUsers();
                    } catch (err) {
                      onShowToast(err instanceof Error ? err.message : String(err));
                    }
                  },
                },
              ]
            : []),
        ]}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {formError && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: 'var(--danger)',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              {formError}
            </div>
          )}

          <div className="settings-section-card">
            <div className="form-grid max-w-680">
              <div className="form-field">
                <label className="form-label">Ad Soyad</label>
                <BaseInput
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Örn: Serhat Akalın"
                  required
                />
              </div>

              <div className="form-field">
                <label className="form-label">E-posta Adresi (Kullanıcı Adı)</label>
                <EmailInput
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Örn: akalinserhat@gmail.com"
                  required
                />
              </div>

              <div className="form-field">
                <label className="form-label">Admin Panel Giriş Şifresi</label>
                <BaseInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Örn: 190300"
                  required
                />
              </div>

              <div className="form-field">
                <label className="form-label">Yetki Rolü</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="form-input"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </BaseCardPage>
    );
  }

  return (
    <BaseListPage<SystemUserRecordDTO>
      title={title || 'Sistem Kullanıcıları'}
      subtitle={
        subtitle ||
        'Admin yönetim paneline giriş yapma yetkisine sahip sistem yöneticilerini ve erişim bilgilerini yönetin.'
      }
      subtitleLeft={`${systemUsers.length} Sistem Kullanıcısı · ${activeCount} Aktif Giriş Yetkili`}
      icon={<Users size={22} />}
      baseRoute="/settings/users"
      columns={columns}
      searchableFields={searchableFields}
      customFetchData={handleFetchSystemUsers}
      customDeleteData={handleDeleteUserById}
      canDelete={handleCanDeleteUser}
      customRowActions={customRowActions}
      extraDropdownActions={[
        {
          label: 'Yeni Sistem Kullanıcısı',
          icon: <Plus size={15} />,
          isDefault: true,
          variant: 'primary',
          onClick: openCreateCard,
        },
        {
          label: 'Listeyi Yenile',
          icon: <RefreshCw size={15} />,
          dividerAbove: true,
          onClick: () => void onRefreshSystemUsers(),
        },
      ]}
      enableArchive={false}
      enableViewModeToggle={false}
      enableAi={false}
      disableEdit={false}
      disableDelete={false}
      stickyActionColumn={false}
      enableColumnManagement={true}
      itemNameResolver={(u) => `${u.full_name} (${u.email})`}
      addNewText="Yeni Sistem Kullanıcısı"
      emptyMessage="Kayıtlı sistem kullanıcısı bulunamadı."
      refreshKey={manualRefreshKey}
      onAddNew={openCreateCard}
      onEdit={(u) => openEditCard(u)}
    />
  );
};
