import React, { useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Mail, User as UserIcon, ShieldCheck } from 'lucide-react';
import {
  BaseSelectionList,
  type DataTableColumn,
  type FetchDataArgs,
} from '@akalin/ui';
import { UserRecordDTO } from '../dtos';

export interface UserSelectionListPageProps {
  users: UserRecordDTO[];
  initialSearchText?: string;
  selectedUserId?: string | null;
  onSelect: (user: UserRecordDTO) => void;
  onCancel: () => void;
}

function getRoleLabel(role?: string | null, id?: string): string {
  if (!role) {
    return id?.startsWith('sys_usr_') ? 'Sistem Yöneticisi' : 'API Kullanıcısı';
  }
  if (role === 'admin') return 'Sistem Yöneticisi';
  if (role === 'user') return 'API Kullanıcısı';
  return role;
}

export const UserSelectionListPage: React.FC<UserSelectionListPageProps> = ({
  users,
  initialSearchText = '',
  selectedUserId = null,
  onSelect,
  onCancel,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'tr-TR';

  const hasConsumedInitialSearchRef = useRef<boolean>(false);

  useEffect(() => {
    hasConsumedInitialSearchRef.current = false;
  }, [initialSearchText]);

  const searchableFields = useMemo(
    () => [
      { id: 'email', label: 'E-Posta Adresi' },
      { id: 'full_name', label: 'Ad Soyad' },
      { id: 'role', label: 'Rol' },
    ],
    []
  );

  const columns = useMemo<DataTableColumn<UserRecordDTO>[]>(
    () => [
      {
        id: 'email',
        header: 'E-Posta Adresi',
        accessor: 'email',
        sortable: true,
        render: (u) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(59, 130, 246, 0.12)',
                color: 'var(--accent-primary)',
                flexShrink: 0,
              }}
            >
              <Mail size={15} />
            </div>
            <span
              style={{
                fontWeight: 600,
                fontSize: '13.5px',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
              }}
            >
              {u.email}
            </span>
          </div>
        ),
      },
      {
        id: 'full_name',
        header: 'Ad Soyad',
        accessor: 'full_name',
        sortable: true,
        render: (u) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserIcon size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
              {u.full_name}
            </span>
          </div>
        ),
      },
      {
        id: 'role',
        header: 'Rol',
        accessor: 'role',
        sortable: true,
        render: (u) => (
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>
            {getRoleLabel(u.role, u.id)}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('users.colStatus', 'Durum'),
        accessor: 'status',
        sortable: true,
        render: (u) => {
          const isActive = u.status === 'active';
          return (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '999px',
                fontSize: '11.5px',
                fontWeight: 600,
                background: isActive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                color: isActive ? 'var(--success)' : 'var(--danger)',
              }}
            >
              <ShieldCheck size={13} />
              {isActive ? 'Aktif' : 'Askıda'}
            </span>
          );
        },
      },
    ],
    [t]
  );

  const handleFetchUsers = useCallback(
    async (args: FetchDataArgs) => {
      const rawSearch =
        args?.aramaData?.value !== undefined && args?.aramaData?.value !== ''
          ? String(args.aramaData.value)
          : !hasConsumedInitialSearchRef.current
            ? String(initialSearchText || '')
            : '';

      if (args?.aramaData?.value !== undefined) {
        hasConsumedInitialSearchRef.current = true;
      }

      const searchVal = rawSearch.trim().toLocaleLowerCase(locale);
      const searchType = args?.aramaData?.type || 'Tumu';
      const sortField = args?.sortField || '';
      const sortOrder = (args?.sortOrder || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';

      let list = [...users];

      if (searchVal) {
        list = list.filter((u) => {
          const emailStr = (u.email || '').toLocaleLowerCase(locale);
          const nameStr = (u.full_name || '').toLocaleLowerCase(locale);
          const roleStr = getRoleLabel(u.role, u.id).toLocaleLowerCase(locale);

          if (searchType === 'email') return emailStr.includes(searchVal);
          if (searchType === 'full_name') return nameStr.includes(searchVal);
          if (searchType === 'role') return roleStr.includes(searchVal);

          return (
            emailStr.includes(searchVal) ||
            nameStr.includes(searchVal) ||
            roleStr.includes(searchVal)
          );
        });
      }

      if (sortField) {
        list.sort((a, b) => {
          const av = String((a as any)[sortField] ?? '').toLocaleLowerCase(locale);
          const bv = String((b as any)[sortField] ?? '').toLocaleLowerCase(locale);
          return sortOrder === 'asc'
            ? av.localeCompare(bv, locale)
            : bv.localeCompare(av, locale);
        });
      } else {
        list.sort((a, b) => {
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
          return (a.email || '').localeCompare(b.email || '', locale);
        });
      }

      return {
        data: list,
        totalCount: list.length,
      };
    },
    [users, initialSearchText, locale]
  );

  return (
    <BaseSelectionList<UserRecordDTO>
      inModal={true}
      icon={<Users size={22} />}
      title="Kullanıcı Seçimi"
      subtitle="API anahtarı tanımlanacak kullanıcıyı e-posta veya adına göre arayıp seçin."
      columns={columns}
      fetchData={handleFetchUsers}
      searchableFields={searchableFields}
      initialSearchText={initialSearchText}
      initialSelectedId={selectedUserId}
      keyExtractor={(u) => u.id}
      isMultiSelect={false}
      onSelect={(item) => onSelect(item as UserRecordDTO)}
      onCancel={onCancel}
      onClose={onCancel}
      emptyMessage="Arama kriterlerine uygun kullanıcı bulunamadı."
    />
  );
};

export default UserSelectionListPage;
