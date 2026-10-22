import React, { useState, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  KeyRound,
  Copy,
  Edit2,
  Ban,
  CheckCircle2,
  X,
  Calendar,
  User as UserIcon,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import {
  BaseButton,
  BaseCard,
  BaseListPage,
  useAlertDialog,
  type ActionMenuItem,
  type DataTableColumn,
} from '@akalin/ui';
import { ApiKeyRecordDTO, UserRecordDTO } from '../dtos';
import { ApiKeyCardPage } from './ApiKeyCardPage';

interface ApiKeysViewProps {
  apiKeys: ApiKeyRecordDTO[];
  users: UserRecordDTO[];
  newlyCreatedKey: string | null;
  onDismissCreatedKey: () => void;
  onCreateKey: (
    userId: string,
    name: string,
    expiresDays: number,
    customApiKey?: string
  ) => Promise<void>;
  onRevokeKey: (keyId: string) => Promise<void>;
  onCopyAndUseKey: (rawKey: string) => void;
}

interface EnrichedApiKeyRow extends ApiKeyRecordDTO {
  owner_name: string;
  owner_email: string;
  status_label: string;
}

export const ApiKeysView: React.FC<ApiKeysViewProps> = ({
  apiKeys,
  users,
  newlyCreatedKey,
  onDismissCreatedKey,
  onCreateKey,
  onRevokeKey,
  onCopyAndUseKey,
}) => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { showAlert } = useAlertDialog();
  const locale = i18n.language?.startsWith('tr') ? 'tr-TR' : 'en-US';

  const [manualRefreshKey, setManualRefreshKey] = useState<number>(0);

  // URL üzerinden alt rota çözümü: /keys/yeni veya /keys/:id
  const routeKeyId = useMemo(() => {
    const clean = location.pathname.replace(/^\/admin(?=\/|$)/, '') || '/';
    const match = clean.match(/^\/keys\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  const enrichedKeys = useMemo<EnrichedApiKeyRow[]>(() => {
    return apiKeys.map((k) => {
      const owner = users.find((u) => u.id === k.user_id);
      return {
        ...k,
        owner_name: owner?.full_name || k.user_id,
        owner_email: owner?.email || '—',
        status_label: k.is_active ? t('status.valid') : t('status.revoked'),
      };
    });
  }, [apiKeys, users, t]);

  const activeCount = useMemo(
    () => enrichedKeys.filter((k) => k.is_active).length,
    [enrichedKeys]
  );
  const revokedCount = useMemo(
    () => enrichedKeys.length - activeCount,
    [enrichedKeys.length, activeCount]
  );

  const combinedRefreshKey = useMemo(
    () => manualRefreshKey + apiKeys.length * 31 + activeCount * 17,
    [manualRefreshKey, apiKeys.length, activeCount]
  );

  const handleOpenAddPage = useCallback(() => {
    navigate('/keys/yeni');
  }, [navigate]);

  const handleOpenDetailPage = useCallback(
    (k: ApiKeyRecordDTO) => {
      navigate(`/keys/${encodeURIComponent(k.id)}`);
    },
    [navigate]
  );

  const handleBackToList = useCallback(() => {
    navigate('/keys');
  }, [navigate]);

  const handleCreateAndRefresh = useCallback(
    async (userId: string, name: string, expiresDays: number, customApiKey?: string) => {
      await onCreateKey(userId, name, expiresDays, customApiKey);
      setManualRefreshKey((prev) => prev + 1);
    },
    [onCreateKey]
  );

  const confirmAndRevoke = useCallback(
    (key: ApiKeyRecordDTO) => {
      showAlert(
        'confirm',
        t('keys.revokeBtn'),
        `"${key.name}" (${key.key_prefix}) anahtarını iptal etmek istediğinize emin misiniz?`,
        async () => {
          await onRevokeKey(key.id);
          setManualRefreshKey((prev) => prev + 1);
        }
      );
    },
    [showAlert, t, onRevokeKey]
  );

  const handleCanDeleteKey = useCallback((k: EnrichedApiKeyRow) => {
    if (!k.is_active) {
      return {
        canDelete: false,
        message: 'Bu API anahtarı zaten iptal edilmiş durumda.',
      };
    }
    return { canDelete: true };
  }, []);

  const handleDeleteKeyById = useCallback(
    async (id: string | number) => {
      await onRevokeKey(String(id));
      setManualRefreshKey((prev) => prev + 1);
    },
    [onRevokeKey]
  );

  // BaseListPage arama alanları ve @akalin/global_search_module filtreleri
  const searchableFields = useMemo(
    () => [
      { id: 'Tumu', label: 'Genel', iconName: 'Search', type: 'text' },
      { id: 'name', label: t('keys.fieldKeyName'), iconName: 'Tag', type: 'text' },
      { id: 'owner_name', label: t('keys.fieldUser'), iconName: 'Users', type: 'text' },
      { id: 'key_prefix', label: 'API Key (sk-gw-...)', iconName: 'Hash', type: 'text' },
      { id: 'id', label: 'Anahtar ID', iconName: 'Hash', type: 'text' },
      {
        id: 'key_status_filter',
        label: 'Anahtar Durumu',
        iconName: 'CheckCircle',
        type: 'enum',
        isEnum: true,
        category: 'filter',
        options: [
          { id: 'status:valid', label: t('status.valid') },
          { id: 'status:revoked', label: t('status.revoked') },
        ],
      },
    ],
    [t]
  );

  // BaseListPage veri çekme, arama ve sıralama yöneticisi
  const handleFetchApiKeys = useCallback(
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

      let list = [...enrichedKeys];

      if (filterTypes.length > 0) {
        const statusFilters = filterTypes.filter((f) => f.startsWith('status:'));
        if (statusFilters.length > 0) {
          list = list.filter((k) => {
            const match =
              (statusFilters.includes('status:valid') && k.is_active) ||
              (statusFilters.includes('status:revoked') && !k.is_active);
            return match;
          });
        }
      }

      if (searchVal) {
        list = list.filter((k) => {
          const previewOrPrefix = (k.raw_preview || k.key_prefix || '').toLowerCase();
          if (searchFieldVal === 'name') {
            return k.name.toLowerCase().includes(searchVal);
          }
          if (searchFieldVal === 'owner_name') {
            return (
              k.owner_name.toLowerCase().includes(searchVal) ||
              k.owner_email.toLowerCase().includes(searchVal) ||
              k.user_id.toLowerCase().includes(searchVal)
            );
          }
          if (searchFieldVal === 'key_prefix') {
            return previewOrPrefix.includes(searchVal);
          }
          if (searchFieldVal === 'id') {
            return k.id.toLowerCase().includes(searchVal);
          }
          return (
            k.name.toLowerCase().includes(searchVal) ||
            k.owner_name.toLowerCase().includes(searchVal) ||
            k.owner_email.toLowerCase().includes(searchVal) ||
            k.user_id.toLowerCase().includes(searchVal) ||
            previewOrPrefix.includes(searchVal) ||
            k.id.toLowerCase().includes(searchVal)
          );
        });
      }

      if (sortFieldVal) {
        list.sort((a, b) => {
          const av = (a as any)[sortFieldVal];
          const bv = (b as any)[sortFieldVal];
          if (typeof av === 'boolean' && typeof bv === 'boolean') {
            return sortOrderVal === 'asc'
              ? Number(av) - Number(bv)
              : Number(bv) - Number(av);
          }
          if (typeof av === 'number' && typeof bv === 'number') {
            return sortOrderVal === 'asc' ? av - bv : bv - av;
          }
          const as = String(av ?? '').toLowerCase();
          const bs = String(bv ?? '').toLowerCase();
          return sortOrderVal === 'asc'
            ? as.localeCompare(bs, locale)
            : bs.localeCompare(as, locale);
        });
      } else {
        // Varsayılan: Aktif anahtarlar üstte, ardından bitiş tarihine göre azalan
        list.sort((a, b) => {
          if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
          return String(b.expires_at || '').localeCompare(String(a.expires_at || ''));
        });
      }

      return {
        data: list,
        totalCount: list.length,
      };
    },
    [enrichedKeys, locale]
  );

  // BaseListPage sütun tanımları
  const columns: DataTableColumn<EnrichedApiKeyRow>[] = useMemo(
    () => [
      {
        id: 'name',
        header: t('keys.fieldKeyName'),
        accessor: 'name',
        sortable: true,
        render: (k) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: k.is_active
                  ? 'var(--md-sys-color-primary-container, rgba(79, 70, 229, 0.14))'
                  : 'rgba(239, 68, 68, 0.12)',
                color: k.is_active
                  ? 'var(--md-sys-color-on-primary-container, var(--primary))'
                  : 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                border: '1px solid var(--glass-border)',
              }}
            >
              <KeyRound size={17} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                {k.name}
              </span>
              <code style={{ fontSize: '11px', color: 'var(--text-secondary)', opacity: 0.85 }}>
                ID: {k.id}
              </code>
            </div>
          </div>
        ),
      },
      {
        id: 'owner_name',
        header: t('keys.fieldUser'),
        accessor: 'owner_name',
        sortable: true,
        render: (k) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <UserIcon size={13} style={{ color: 'var(--text-secondary)' }} />
              <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                {k.owner_name}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
              }}
            >
              <span>{k.owner_email}</span>
              <code style={{ fontSize: '11px', opacity: 0.8 }}>({k.user_id})</code>
            </div>
          </div>
        ),
      },
      {
        id: 'key_prefix',
        header: 'API Key (sk-gw-...)',
        accessor: 'key_prefix',
        sortable: true,
        render: (k) => (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <code
              style={{
                fontFamily: 'monospace',
                fontSize: '12px',
                padding: '4px 9px',
                borderRadius: '6px',
                background: 'var(--surface-secondary)',
                border: '1px solid var(--glass-border)',
                color: k.is_active ? 'var(--text-primary)' : 'var(--text-secondary)',
                textDecoration: k.is_active ? 'none' : 'line-through',
              }}
            >
              {k.raw_preview || k.key_prefix}
            </code>
            {k.raw_preview && k.is_active && (
              <button
                type="button"
                className="btn-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyAndUseKey(k.raw_preview!);
                }}
                title={t('keys.useInChatBtn')}
                style={{
                  padding: '4px',
                  borderRadius: '6px',
                  color: 'var(--accent-primary)',
                }}
              >
                <Copy size={14} />
              </button>
            )}
          </div>
        ),
      },
      {
        id: 'expires_at',
        header: t('keys.expiresLabel'),
        accessor: 'expires_at',
        sortable: true,
        render: (k) => {
          if (!k.expires_at) {
            return <span style={{ color: 'var(--text-secondary)' }}>—</span>;
          }
          const expDate = new Date(k.expires_at);
          const diffDays = Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          const isExpired = diffDays <= 0;

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontFamily: 'monospace',
                  fontSize: '12.5px',
                  color: 'var(--text-primary)',
                }}
              >
                <Calendar size={13} style={{ color: 'var(--text-secondary)' }} />
                <span>{expDate.toLocaleDateString(locale)}</span>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  color: isExpired ? 'var(--danger)' : 'var(--text-secondary)',
                  fontWeight: isExpired ? 600 : 400,
                }}
              >
                {isExpired ? 'Süresi Doldu' : `${diffDays} gün kaldı`}
              </span>
            </div>
          );
        },
      },
      {
        id: 'is_active',
        header: t('users.colStatus'),
        accessor: 'is_active',
        sortable: true,
        render: (k) => (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '999px',
              fontSize: '11.5px',
              fontWeight: 600,
              background: k.is_active ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              color: k.is_active ? 'var(--success)' : 'var(--danger)',
              textDecoration: k.is_active ? 'none' : 'line-through',
            }}
          >
            {k.is_active ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
            {k.is_active ? t('status.valid') : t('status.revoked')}
          </span>
        ),
      },
    ],
    [t, locale, onCopyAndUseKey]
  );

  // Satır içi üç nokta menüsü (ActionMenu) özel aksiyonları
  const customRowActions = useCallback(
    (k: EnrichedApiKeyRow): ActionMenuItem[] => {
      const actions: ActionMenuItem[] = [
        {
          label: 'Düzenle',
          icon: <Edit2 size={16} />,
          isDefault: true,
          default: true,
          onClick: () => handleOpenDetailPage(k),
        },
      ];

      if (k.raw_preview && k.is_active) {
        actions.push({
          label: 'Kopyala',
          icon: <Copy size={16} />,
          onClick: () => onCopyAndUseKey(k.raw_preview!),
        });
      }

      if (k.is_active) {
        actions.push({
          label: t('keys.revokeBtn'),
          icon: <Ban size={16} />,
          danger: true,
          onClick: () => confirmAndRevoke(k),
        });
      }

      return actions;
    },
    [t, onCopyAndUseKey, handleOpenDetailPage, confirmAndRevoke]
  );

  // ─── "Ekle" (/keys/yeni) veya "Detay" (/keys/:id) Seçildiğinde Açılan BaseCardPage Ekranı ───
  if (routeKeyId) {
    const editingKey =
      routeKeyId === 'yeni' ? null : apiKeys.find((k) => k.id === routeKeyId) || null;

    return (
      <ApiKeyCardPage
        users={users}
        apiKeys={apiKeys}
        editingKey={editingKey}
        newlyCreatedKey={newlyCreatedKey}
        onBack={handleBackToList}
        onCreateKey={handleCreateAndRefresh}
        onRevokeKey={(keyId) => {
          const target = apiKeys.find((k) => k.id === keyId);
          if (target) {
            confirmAndRevoke(target);
          }
        }}
        onCopyAndUseKey={onCopyAndUseKey}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '14px' }}>
      {newlyCreatedKey && (
        <BaseCard variant="filled" style={{ borderLeft: '4px solid var(--success)' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--success)',
                }}
              >
                <CheckCircle2 size={18} />
                <span>{t('keys.createdKeyBannerTitle')}</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                {t('keys.createdKeyBannerSub')}
              </p>
              <code
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--glass-border)',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--accent-primary)',
                }}
              >
                {newlyCreatedKey}
              </code>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BaseButton
                variant="primary"
                className="btn-sm"
                icon={<Copy size={14} />}
                text={t('keys.useInChatBtn')}
                onClick={() => onCopyAndUseKey(newlyCreatedKey)}
              />
              <button
                type="button"
                className="btn-icon"
                onClick={onDismissCreatedKey}
                title="Kapat"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </BaseCard>
      )}

      <BaseListPage<EnrichedApiKeyRow>
        title={t('keys.title')}
        subtitle={t('keys.subtitle')}
        subtitleLeft={`${enrichedKeys.length} Toplam Anahtar · ${activeCount} Geçerli · ${revokedCount} İptal Edildi`}
        icon={<KeyRound size={22} />}
        baseRoute="/keys"
        columns={columns}
        searchableFields={searchableFields}
        customFetchData={handleFetchApiKeys}
        customDeleteData={handleDeleteKeyById}
        canDelete={handleCanDeleteKey}
        customRowActions={customRowActions}
        enableArchive={false}
        enableViewModeToggle={false}
        enableAi={false}
        enableUndoDelete={false}
        disableEdit={true}
        disableDelete={true}
        stickyActionColumn={false}
        enableColumnManagement={true}
        itemNameResolver={(k) => `${k.name} (${k.key_prefix})`}
        addNewText={t('keys.newKeyBtn')}
        emptyMessage="Kayıtlı API anahtarı bulunamadı."
        refreshKey={combinedRefreshKey}
        onAddNew={handleOpenAddPage}
        onEdit={(k) => handleOpenDetailPage(k)}
      />
    </div>
  );
};
