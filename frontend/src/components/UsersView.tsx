import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  Users,
  User,
  Clock,
  Lock,
  KeyRound,
  Coins,
  Calendar,
  ChevronDown,
  ChevronRight,
  Trash2,
  Edit3,
  Activity,
  Sparkles,
  Terminal,
  Mail,
  Plus,
  RefreshCw,
} from 'lucide-react';
import {
  BaseButton,
  BaseCardPage,
  BaseInput,
  BaseListPage,
  BaseProgressBar,
  BaseSwitch,
  DataTable,
  DateRangeInput,
  EkleFloatCircleButton,
  EmailInput,
  TamsayiInput,
  type DataTableColumn,
} from '@akalin/ui';
import {
  SystemUserRecordDTO,
  TokenAllocationInputDTO,
  UserRecordDTO,
  UserTokenAllocationDTO,
} from '../dtos';
import { DEFAULT_SYSTEM_USER, roleService, smtpService, systemUserService, userService } from '../services';

interface UsersViewProps {
  title?: string;
  subtitle?: string;
  users: UserRecordDTO[];
  systemUsers?: SystemUserRecordDTO[];
  currentAuthUser?: SystemUserRecordDTO | null;
  onRefreshState: () => Promise<void>;
  onRefreshSystemUsers?: () => Promise<void>;
  onGenerateKeyForUser: (userId: string) => Promise<void>;
  onShowToast: (msg: string) => void;
}

export interface UnifiedUserRow extends UserRecordDTO {
  isAdmin: boolean;
  roleLabel: string;
  password?: string;
  last_login_at?: string | null;
}

const SYSTEM_ROLE_OPTIONS = [
  'Admin',
  'Sistem Yöneticisi',
  'Operasyon Yöneticisi',
  'Güvenlik Yöneticisi',
  'Salt Okunur Yönetici',
];

function isSystemAdminRole(role?: string | null, id?: string): boolean {
  if (id && id.startsWith('sys_usr_')) return true;
  if (!role) return false;
  const r = role.toLowerCase();
  return r === 'admin' || r.includes('yönetici') || r.includes('yonetici');
}

function getRoleDisplayLabel(role?: string | null, id?: string): string {
  if (!role) {
    return id?.startsWith('sys_usr_') ? 'Sistem Yöneticisi' : 'API / Kota Kullanıcısı';
  }
  if (role === 'admin') return 'Sistem Yöneticisi';
  if (role === 'user') return 'API / Kota Kullanıcısı';
  return role;
}

export const UsersView: React.FC<UsersViewProps> = ({
  title,
  subtitle,
  users,
  systemUsers = [DEFAULT_SYSTEM_USER],
  currentAuthUser = null,
  onRefreshState,
  onRefreshSystemUsers,
  onGenerateKeyForUser,
  onShowToast,
}) => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'tr-TR';

  const [manualRefreshKey, setManualRefreshKey] = useState<number>(0);

  // BaseCardPage Form State (Yeni Ekle / Düzenle)
  const [editingUser, setEditingUser] = useState<UnifiedUserRow | null>(null);
  const [activeCardTabId, setActiveCardTabId] = useState<string>('general');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [accountType, setAccountType] = useState<'user' | 'admin'>('user');
  const [adminRoleTitle, setAdminRoleTitle] = useState('Sistem Yöneticisi');
  const [password, setPassword] = useState('190300');
  const [status, setStatus] = useState<'active' | 'suspended'>('active');
  const [tokenQuota, setTokenQuota] = useState(250000);
  const [rpmLimit, setRpmLimit] = useState(25);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Token Tanımlama Sekmesi State'leri
  const currentYear = new Date().getFullYear();
  const [tokenAllocations, setTokenAllocations] = useState<UserTokenAllocationDTO[]>([]);
  const [loadingAllocations, setLoadingAllocations] = useState<boolean>(false);
  const [expandedAllocIds, setExpandedAllocIds] = useState<Record<string, boolean>>({});
  const [isTokenCardPageOpen, setIsTokenCardPageOpen] = useState<boolean>(false);
  const [editingAllocId, setEditingAllocId] = useState<string | null>(null);
  const [allocStartDate, setAllocStartDate] = useState<string>(`${currentYear}-01-01`);
  const [allocEndDate, setAllocEndDate] = useState<string>(`${currentYear}-12-31`);
  const [allocTokenAmount, setAllocTokenAmount] = useState<number>(250000);
  const [allocDescription, setAllocDescription] = useState<string>('');
  const [allocSubmitting, setAllocSubmitting] = useState<boolean>(false);

  const effectiveSystemUsers = useMemo<SystemUserRecordDTO[]>(() => {
    const list = systemUsers.length > 0 ? [...systemUsers] : [DEFAULT_SYSTEM_USER];
    for (const u of users) {
      if (isSystemAdminRole(u.role, u.id)) {
        const exists = list.some(
          (su) => su.id === u.id || su.email.toLowerCase() === u.email.toLowerCase()
        );
        if (!exists) {
          list.push({
            id: u.id,
            full_name: u.full_name,
            email: u.email,
            password: '190300',
            role: getRoleDisplayLabel(u.role, u.id),
            status: u.status,
            last_login_at: u.created_at,
            created_at: u.created_at,
          });
        }
      }
    }
    return list;
  }, [systemUsers, users]);

  // Tekil 'users' tablosu verilerini (Sistem Yöneticileri + Kota Kullanıcıları) birleştirir ve mükerrerleri engeller
  const unifiedUsers = useMemo<UnifiedUserRow[]>(() => {
    const byId = new Map<string, UnifiedUserRow>();
    const seenEmails = new Set<string>();

    for (const su of effectiveSystemUsers) {
      const emailKey = su.email.trim().toLowerCase();
      if (seenEmails.has(emailKey)) continue;
      const matched = users.find(
        (u) => u.id === su.id || u.email.trim().toLowerCase() === emailKey
      );
      const rowId = matched?.id || su.id;
      const roleVal = su.role || matched?.role || 'Sistem Yöneticisi';
      seenEmails.add(emailKey);
      byId.set(rowId, {
        id: rowId,
        email: su.email,
        full_name: su.full_name,
        role: roleVal,
        roleLabel: getRoleDisplayLabel(roleVal, rowId),
        isAdmin: true,
        status: su.status,
        token_quota: matched?.token_quota ?? 1000000,
        tokens_used: matched?.tokens_used ?? 0,
        rpm_limit: matched?.rpm_limit ?? 60,
        concurrent_limit: matched?.concurrent_limit ?? 5,
        password: su.password || '190300',
        last_login_at: su.last_login_at ?? null,
        created_at: matched?.created_at || su.created_at,
      });
    }

    for (const u of users) {
      const emailKey = u.email.trim().toLowerCase();
      if (byId.has(u.id) || seenEmails.has(emailKey)) continue;
      const adminFlag = isSystemAdminRole(u.role, u.id);
      seenEmails.add(emailKey);
      byId.set(u.id, {
        ...u,
        isAdmin: adminFlag,
        roleLabel: getRoleDisplayLabel(u.role, u.id),
        password: adminFlag ? '190300' : undefined,
        last_login_at: null,
      });
    }

    return Array.from(byId.values());
  }, [effectiveSystemUsers, users]);

  const adminCount = useMemo(
    () => unifiedUsers.filter((u) => u.isAdmin).length,
    [unifiedUsers]
  );
  const regularUserCount = unifiedUsers.length - adminCount;

  // URL tabanlı mod tespiti: /users -> BaseListPage, /users/yeni veya /users/:id -> BaseCardPage
  const routeUserId = useMemo(() => {
    const clean = location.pathname.replace(/^\/admin(?=\/|$)/, '');
    const match = clean.match(/^\/users\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  const isCardPageOpen = Boolean(routeUserId);

  const loadUserTokenAllocations = useCallback(async (userId: string) => {
    setLoadingAllocations(true);
    try {
      const list = await userService.listUserTokens(userId);
      const safeList = Array.isArray(list) ? list : [];
      setTokenAllocations(safeList);
      if (safeList.length > 0) {
        const totalDefined = safeList.reduce((acc, item) => acc + (Number(item.token_amount) || 0), 0);
        if (totalDefined > 0) {
          setTokenQuota(totalDefined);
        }
      }
    } catch {
      setTokenAllocations([]);
    } finally {
      setLoadingAllocations(false);
    }
  }, []);

  const populateFormForNew = useCallback(() => {
    const yr = new Date().getFullYear();
    setEditingUser(null);
    setActiveCardTabId('general');
    setIsTokenCardPageOpen(false);
    setFullName('');
    setEmail('');
    setAccountType('user');
    setAdminRoleTitle('Sistem Yöneticisi');
    setPassword('190300');
    setStatus('active');
    setTokenQuota(250000);
    setRpmLimit(25);
    setFormError(null);
    setEditingAllocId(null);
    setAllocStartDate(`${yr}-01-01`);
    setAllocEndDate(`${yr}-12-31`);
    setAllocTokenAmount(250000);
    setAllocDescription('Başlangıç Token Tanımı');
    setExpandedAllocIds({ draft_init_1: true });
    setTokenAllocations([
      {
        id: 'draft_init_1',
        user_id: 'new',
        start_date: `${yr}-01-01`,
        end_date: `${yr}-12-31`,
        token_amount: 250000,
        used_tokens: 0,
        remaining_tokens: 250000,
        usage_percent: 0,
        description: 'Başlangıç Token Tanımı',
        date_groups: [],
      },
    ]);
  }, []);

  const populateFormForEdit = useCallback(
    (u: UnifiedUserRow) => {
      const yr = new Date().getFullYear();
      setEditingUser(u);
      setIsTokenCardPageOpen(false);
      setFullName(u.full_name);
      setEmail(u.email);
      setAccountType(u.isAdmin ? 'admin' : 'user');
      setAdminRoleTitle(u.isAdmin ? u.roleLabel : 'Sistem Yöneticisi');
      setPassword(u.password || '190300');
      setStatus(u.status);
      setTokenQuota(u.token_quota || (u.isAdmin ? 1000000 : 250000));
      setRpmLimit(u.rpm_limit || (u.isAdmin ? 60 : 25));
      setFormError(null);
      setEditingAllocId(null);
      setAllocStartDate(`${yr}-01-01`);
      setAllocEndDate(`${yr}-12-31`);
      setAllocTokenAmount(u.isAdmin ? 1000000 : 250000);
      setAllocDescription('');
      void loadUserTokenAllocations(u.id);
    },
    [loadUserTokenAllocations]
  );

  useEffect(() => {
    if (!routeUserId) return;
    if (routeUserId === 'yeni') {
      populateFormForNew();
      return;
    }
    const found = unifiedUsers.find((u) => u.id === routeUserId);
    if (found) {
      populateFormForEdit(found);
    }
  }, [routeUserId, unifiedUsers, populateFormForNew, populateFormForEdit]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      onRefreshState(),
      onRefreshSystemUsers ? onRefreshSystemUsers() : Promise.resolve(),
    ]);
    setManualRefreshKey((prev) => prev + 1);
  }, [onRefreshState, onRefreshSystemUsers]);

  const formatDateTime = useCallback(
    (iso?: string | null) => {
      if (!iso) return '—';
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

  const formatDateOnly = useCallback(
    (dateStr?: string | null) => {
      if (!dateStr) return '—';
      const clean = String(dateStr).slice(0, 10);
      const parts = clean.split('-');
      if (parts.length === 3) {
        return `${parts[2]}.${parts[1]}.${parts[0]}`;
      }
      return clean;
    },
    []
  );

  const handleOpenAddPage = useCallback(() => {
    setActiveCardTabId('general');
    setIsTokenCardPageOpen(false);
    populateFormForNew();
    navigate('/users/yeni');
  }, [populateFormForNew, navigate]);

  const handleOpenEditPage = useCallback(
    (u: UnifiedUserRow) => {
      setActiveCardTabId('general');
      setIsTokenCardPageOpen(false);
      setExpandedAllocIds({});
      populateFormForEdit(u);
      navigate(`/users/${encodeURIComponent(u.id)}`);
    },
    [populateFormForEdit, navigate]
  );

  const handleBackToList = useCallback(() => {
    setFormError(null);
    setIsTokenCardPageOpen(false);
    navigate('/users');
  }, [navigate]);

  const handleToggleActiveSwitch = useCallback(
    async (checked: boolean) => {
      const nextStatus: 'active' | 'suspended' = checked ? 'active' : 'suspended';
      setStatus(nextStatus);
      if (editingUser) {
        try {
          await systemUserService.updateSystemUser(editingUser.id, {
            status: nextStatus,
          });
          await refreshAll();
          onShowToast(
            nextStatus === 'active'
              ? 'Hesap durumu Aktif olarak güncellendi.'
              : 'Hesap durumu Askıda (Pasif) olarak güncellendi.'
          );
        } catch (err) {
          onShowToast(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [editingUser, refreshAll, onShowToast]
  );

  const toggleExpandAllocation = useCallback((allocId: string) => {
    setExpandedAllocIds((prev) => ({
      ...prev,
      [allocId]: !prev[allocId],
    }));
  }, []);

  const handleOpenAddTokenCardPage = useCallback(() => {
    const yr = new Date().getFullYear();
    setEditingAllocId(null);
    setAllocStartDate(`${yr}-01-01`);
    setAllocEndDate(`${yr}-12-31`);
    setAllocTokenAmount(accountType === 'admin' ? 1000000 : 250000);
    setAllocDescription('');
    setIsTokenCardPageOpen(true);
  }, [accountType]);

  const handleEditAllocationRow = useCallback(
    (row: UserTokenAllocationDTO) => {
      if ((Number(row.used_tokens) || 0) > 0) {
        onShowToast('Kullanılmış token tanımı üzerinde değişiklik yapılamaz.');
        return;
      }
      setEditingAllocId(row.id);
      setAllocStartDate(row.start_date);
      setAllocEndDate(row.end_date);
      setAllocTokenAmount(row.token_amount);
      setAllocDescription(row.description || '');
      setIsTokenCardPageOpen(true);
    },
    [onShowToast]
  );

  const handleCancelEditAllocation = useCallback(() => {
    const yr = new Date().getFullYear();
    setEditingAllocId(null);
    setAllocStartDate(`${yr}-01-01`);
    setAllocEndDate(`${yr}-12-31`);
    setAllocTokenAmount(accountType === 'admin' ? 1000000 : 250000);
    setAllocDescription('');
    setIsTokenCardPageOpen(false);
  }, [accountType]);

  const handleSaveTokenAllocation = useCallback(
    async (e?: React.FormEvent) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      const start = (allocStartDate || `${new Date().getFullYear()}-01-01`).slice(0, 10);
      const end = (allocEndDate || `${new Date().getFullYear()}-12-31`).slice(0, 10);
      const amount = Math.max(0, Number(allocTokenAmount) || 0);
      const desc = allocDescription.trim();

      if (!start || !end) {
        onShowToast('Lütfen geçerli bir tarih aralığı seçin.');
        return;
      }
      if (amount <= 0) {
        onShowToast('Tanımlanacak token miktarı 0’dan büyük olmalıdır.');
        return;
      }

      if (editingUser) {
        setAllocSubmitting(true);
        try {
          if (editingAllocId) {
            const res = await userService.updateUserToken(editingUser.id, editingAllocId, {
              start_date: start,
              end_date: end,
              token_amount: amount,
              description: desc,
            });
            const nextList = res.allocations || [];
            setTokenAllocations(nextList);
            const totalDefined = nextList.reduce((acc, i) => acc + (Number(i.token_amount) || 0), 0);
            setTokenQuota(totalDefined);
            onShowToast('Token tanımı güncellendi.');
          } else {
            const res = await userService.createUserToken(editingUser.id, {
              start_date: start,
              end_date: end,
              token_amount: amount,
              description: desc,
            });
            const nextList = res.allocations || [];
            setTokenAllocations(nextList);
            if (res.allocation?.id) {
              setExpandedAllocIds((prev) => ({ ...prev, [res.allocation.id]: true }));
            }
            const totalDefined = nextList.reduce((acc, i) => acc + (Number(i.token_amount) || 0), 0);
            setTokenQuota(totalDefined);
            onShowToast('Yeni token tanımı eklendi.');
          }
          handleCancelEditAllocation();
          await refreshAll();
        } catch (err) {
          onShowToast(err instanceof Error ? err.message : String(err));
        } finally {
          setAllocSubmitting(false);
        }
      } else {
        // Yeni kullanıcı oluşturma modunda yerel listeyi güncelle
        if (editingAllocId) {
          setTokenAllocations((prev) => {
            const next = prev.map((item) =>
              item.id === editingAllocId
                ? {
                    ...item,
                    start_date: start <= end ? start : end,
                    end_date: start <= end ? end : start,
                    token_amount: amount,
                    remaining_tokens: Math.max(0, amount - item.used_tokens),
                    description: desc,
                  }
                : item
            );
            setTokenQuota(next.reduce((acc, i) => acc + (Number(i.token_amount) || 0), 0));
            return next;
          });
          onShowToast('Token satırı güncellendi.');
        } else {
          const draftId = `draft_${Date.now()}`;
          const newRow: UserTokenAllocationDTO = {
            id: draftId,
            user_id: 'new',
            start_date: start <= end ? start : end,
            end_date: start <= end ? end : start,
            token_amount: amount,
            used_tokens: 0,
            remaining_tokens: amount,
            usage_percent: 0,
            description: desc || 'Token Tanımı',
            date_groups: [],
          };
          setTokenAllocations((prev) => {
            const next = [newRow, ...prev];
            setTokenQuota(next.reduce((acc, i) => acc + (Number(i.token_amount) || 0), 0));
            return next;
          });
          setExpandedAllocIds((prev) => ({ ...prev, [draftId]: true }));
          onShowToast('Token satırı listeye eklendi.');
        }
        handleCancelEditAllocation();
      }
    },
    [
      allocStartDate,
      allocEndDate,
      allocTokenAmount,
      allocDescription,
      editingUser,
      editingAllocId,
      handleCancelEditAllocation,
      onShowToast,
      refreshAll,
    ]
  );

  const handleDeleteTokenAllocation = useCallback(
    async (allocId: string) => {
      const targetRow = tokenAllocations.find((item) => item.id === allocId);
      if (targetRow && (Number(targetRow.used_tokens) || 0) > 0) {
        onShowToast('Kullanılmış token tanımı silinemez.');
        return;
      }
      if (editingUser) {
        setAllocSubmitting(true);
        try {
          const res = await userService.deleteUserToken(editingUser.id, allocId);
          const nextList = res.allocations || [];
          setTokenAllocations(nextList);
          const totalDefined = nextList.reduce((acc, i) => acc + (Number(i.token_amount) || 0), 0);
          setTokenQuota(totalDefined);
          if (editingAllocId === allocId) {
            handleCancelEditAllocation();
          }
          onShowToast('Token tanımı silindi.');
          await refreshAll();
        } catch (err) {
          onShowToast(err instanceof Error ? err.message : String(err));
        } finally {
          setAllocSubmitting(false);
        }
      } else {
        setTokenAllocations((prev) => {
          const next = prev.filter((item) => item.id !== allocId);
          setTokenQuota(next.reduce((acc, i) => acc + (Number(i.token_amount) || 0), 0));
          return next;
        });
        if (editingAllocId === allocId) {
          handleCancelEditAllocation();
        }
      }
    },
    [tokenAllocations, editingUser, editingAllocId, handleCancelEditAllocation, onShowToast, refreshAll]
  );

  const totalDefinedTokens = useMemo(
    () =>
      tokenAllocations.reduce((sum, item) => sum + (Number(item.token_amount) || 0), 0) ||
      Number(tokenQuota) ||
      0,
    [tokenAllocations, tokenQuota]
  );

  const totalUsedTokens = useMemo(
    () =>
      tokenAllocations.reduce((sum, item) => sum + (Number(item.used_tokens) || 0), 0) ||
      editingUser?.tokens_used ||
      0,
    [tokenAllocations, editingUser]
  );

  const totalRemainingTokens = useMemo(
    () => Math.max(0, totalDefinedTokens - totalUsedTokens),
    [totalDefinedTokens, totalUsedTokens]
  );

  const handleSaveUser = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    setFormError(null);
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = fullName.trim();

    if (!trimmedEmail) {
      setFormError('E-posta adresi zorunludur.');
      return;
    }

    // Mükerrer e-posta ön kontrolü
    const duplicate = unifiedUsers.find(
      (u) =>
        u.email.trim().toLowerCase() === trimmedEmail &&
        (!editingUser || u.id !== editingUser.id)
    );
    if (duplicate) {
      setFormError(`'${trimmedEmail}' e-posta adresiyle kayıtlı bir kullanıcı zaten mevcut.`);
      return;
    }

    const allocationsPayload: TokenAllocationInputDTO[] = tokenAllocations.map((a) => ({
      id: a.id,
      start_date: a.start_date,
      end_date: a.end_date,
      token_amount: Number(a.token_amount) || 0,
      description: a.description || '',
    }));

    const effectiveQuota =
      allocationsPayload.reduce((acc, a) => acc + a.token_amount, 0) ||
      Number(tokenQuota) ||
      (accountType === 'admin' ? 1000000 : 250000);

    setSubmitting(true);
    try {
      if (editingUser) {
        const nextRole = accountType === 'admin' ? adminRoleTitle : 'user';
        await systemUserService.updateSystemUser(editingUser.id, {
          full_name: trimmedName || editingUser.full_name,
          email: trimmedEmail,
          password: password.trim() || '190300',
          role: nextRole,
          status,
          token_quota: effectiveQuota,
          rpm_limit: Number(rpmLimit) || 25,
          token_allocations: allocationsPayload,
        });
        onShowToast('Kullanıcı bilgileri güncellendi.');
      } else if (accountType === 'admin') {
        await systemUserService.createSystemUser({
          full_name: trimmedName || 'Sistem Yöneticisi',
          email: trimmedEmail,
          password: password.trim() || '190300',
          role: adminRoleTitle || 'Sistem Yöneticisi',
          status,
          token_quota: effectiveQuota,
          rpm_limit: Number(rpmLimit) || 60,
          token_allocations: allocationsPayload,
        });
        onShowToast('Yeni sistem yöneticisi tanımlandı.');
      } else {
        await userService.createUser({
          email: trimmedEmail,
          full_name: trimmedName || 'Developer',
          role: 'user',
          status,
          token_quota: effectiveQuota,
          rpm_limit: Number(rpmLimit) || 25,
          token_allocations: allocationsPayload,
        });
        onShowToast(t('users.userCreatedToast'));
      }
      await refreshAll();
      navigate('/users');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCanDeleteUser = useCallback(
    (u: UnifiedUserRow) => {
      if (u.isAdmin && adminCount <= 1) {
        return {
          canDelete: false,
          message: 'Sistemde en az bir Sistem Yöneticisi kalmalıdır.',
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
    [adminCount, currentAuthUser]
  );

  const handleDeleteUser = useCallback(
    async (id: string | number) => {
      await systemUserService.deleteSystemUser(String(id));
      await refreshAll();
    },
    [refreshAll]
  );

  // BaseListPage arama alanları ve @akalin/global_search_module çoklu filtre tanımları
  const searchableFields = useMemo(
    () => [
      { id: 'Tumu', label: 'Genel', iconName: 'Search', type: 'text' },
      { id: 'full_name', label: 'Ad Soyad', iconName: 'Users', type: 'text' },
      { id: 'email', label: 'E-posta', iconName: 'Mail', type: 'text' },
      { id: 'roleLabel', label: 'Yetki Rolü', iconName: 'Tag', type: 'text' },
      { id: 'id', label: 'Kullanıcı ID', iconName: 'Hash', type: 'text' },
      {
        id: 'account_type_filter',
        label: 'Hesap Türü',
        iconName: 'Users',
        type: 'enum',
        isEnum: true,
        category: 'filter',
        options: [
          { id: 'type:admin', label: 'Sistem Yöneticisi' },
          { id: 'type:user', label: 'Kota Kullanıcısı' },
        ],
      },
      {
        id: 'status_filter',
        label: 'Hesap Durumu',
        iconName: 'CheckCircle',
        type: 'enum',
        isEnum: true,
        category: 'filter',
        options: [
          { id: 'status:active', label: 'Aktif' },
          { id: 'status:suspended', label: 'Askıda' },
        ],
      },
    ],
    []
  );

  // BaseListPage veri çekme, arama ve sıralama yöneticisi
  const handleFetchUsers = useCallback(
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

      let list = [...unifiedUsers];

      if (filterTypes.length > 0) {
        const typeFilters = filterTypes.filter((f) => f.startsWith('type:'));
        const statusFilters = filterTypes.filter((f) => f.startsWith('status:'));
        list = list.filter((u) => {
          if (typeFilters.length > 0) {
            const matchType =
              (typeFilters.includes('type:admin') && u.isAdmin) ||
              (typeFilters.includes('type:user') && !u.isAdmin);
            if (!matchType) return false;
          }
          if (statusFilters.length > 0) {
            const isAct = u.status === 'active';
            const matchStatus =
              (statusFilters.includes('status:active') && isAct) ||
              (statusFilters.includes('status:suspended') && !isAct);
            if (!matchStatus) return false;
          }
          return true;
        });
      }

      if (searchVal) {
        list = list.filter((u) => {
          if (searchFieldVal === 'full_name') {
            return u.full_name.toLowerCase().includes(searchVal);
          }
          if (searchFieldVal === 'email') {
            return u.email.toLowerCase().includes(searchVal);
          }
          if (searchFieldVal === 'roleLabel') {
            return (
              u.roleLabel.toLowerCase().includes(searchVal) ||
              u.role.toLowerCase().includes(searchVal)
            );
          }
          if (searchFieldVal === 'id') {
            return u.id.toLowerCase().includes(searchVal);
          }
          return (
            u.full_name.toLowerCase().includes(searchVal) ||
            u.email.toLowerCase().includes(searchVal) ||
            u.roleLabel.toLowerCase().includes(searchVal) ||
            u.id.toLowerCase().includes(searchVal)
          );
        });
      }

      if (sortFieldVal) {
        list.sort((a, b) => {
          const av = (a as any)[sortFieldVal];
          const bv = (b as any)[sortFieldVal];
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
        list.sort((a, b) => {
          if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
          return a.full_name.localeCompare(b.full_name, locale);
        });
      }

      return {
        data: list,
        totalCount: list.length,
      };
    },
    [unifiedUsers, locale]
  );

  // BaseListPage sütun tanımları
  const columns: DataTableColumn<UnifiedUserRow>[] = useMemo(
    () => [
      {
        id: 'full_name',
        header: t('users.colUser'),
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
                  background: u.isAdmin
                    ? 'var(--md-sys-color-primary-container, rgba(79, 70, 229, 0.14))'
                    : 'var(--surface-secondary)',
                  color: u.isAdmin
                    ? 'var(--md-sys-color-on-primary-container, var(--primary))'
                    : 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '13px',
                  flexShrink: 0,
                  border: '1px solid var(--glass-border)',
                }}
              >
                {initials || 'KU'}
              </div>
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                    {u.full_name}
                  </span>
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
                  <code style={{ fontSize: '11px', opacity: 0.8 }}>({u.id})</code>
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: 'roleLabel',
        header: 'Kullanıcı Tipi & Rol',
        accessor: 'roleLabel',
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
              background: u.isAdmin
                ? 'rgba(79, 70, 229, 0.12)'
                : 'var(--surface-secondary)',
              border: u.isAdmin
                ? '1px solid rgba(79, 70, 229, 0.28)'
                : '1px solid var(--glass-border)',
              color: u.isAdmin ? 'var(--primary)' : 'var(--text-secondary)',
            }}
          >
            {u.isAdmin ? <ShieldCheck size={13} /> : <User size={13} />}
            {u.roleLabel}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('users.colStatus'),
        accessor: 'status',
        sortable: true,
        render: (u) => {
          const isActive = u.status === 'active';
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  width: 'fit-content',
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
                {isActive ? t('status.active') : t('status.suspended')}
              </span>
              {u.isAdmin && u.last_login_at && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <Clock size={11} />
                  {formatDateTime(u.last_login_at)}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: 'tokens_used',
        header: t('users.colQuota'),
        accessor: 'tokens_used',
        sortable: true,
        render: (u) => {
          const pct = Math.min(
            100,
            Math.round((u.tokens_used / Math.max(1, u.token_quota)) * 100)
          );
          return (
            <div style={{ minWidth: '210px' }}>
              <BaseProgressBar
                progress={pct}
                height={7}
                colorClass={pct > 85 ? 'bg-danger' : 'bg-primary'}
                backgroundColorClass="bg-secondary"
                labelLeft={`${u.tokens_used.toLocaleString(locale)} / ${u.token_quota.toLocaleString(locale)}`}
                labelRight={`${pct}%`}
              />
            </div>
          );
        },
      },
      {
        id: 'rpm_limit',
        header: t('users.colRpm'),
        accessor: 'rpm_limit',
        sortable: true,
        render: (u) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '13px' }}>
              {u.rpm_limit} RPM
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Maks. {u.concurrent_limit || (u.isAdmin ? 5 : 2)} eşzamanlı
            </span>
          </div>
        ),
      },
    ],
    [t, locale, currentAuthUser, formatDateTime]
  );

  const combinedRefreshKey = useMemo(
    () => manualRefreshKey + unifiedUsers.length * 17,
    [manualRefreshKey, unifiedUsers.length]
  );

  // ─── "Ekle" veya "Düzenle" Seçildiğinde Açılan BaseCardPage Ekranı ─────────
  if (isCardPageOpen) {
    // 1. Token Ekleme / Düzenleme için açılan BaseCardPage
    if (isTokenCardPageOpen) {
      return (
        <BaseCardPage
          id="token-allocation-card-form"
          asForm={true}
          onSubmit={handleSaveTokenAllocation}
          onSave={handleSaveTokenAllocation}
          isSaving={allocSubmitting}
          saveButtonText="Kaydet"
          showBackButton={true}
          onBack={handleCancelEditAllocation}
          enableAiAssistant={false}
          cardType="TokenTanimlamaKart"
          recordTitle={
            editingAllocId
              ? 'Token Tanımını Düzenle'
              : 'Yeni Token Tanımlama Kartı'
          }
          icon={<Coins size={22} />}
          title={
            editingAllocId
              ? 'Token Tanımını Düzenle'
              : 'Yeni Token Tanımlama Kartı'
          }
          subtitle={
            editingUser
              ? `${editingUser.full_name} (${editingUser.email}) hesabı için tarih aralıklı token kotası`
              : 'Yeni kullanıcı hesabı için tarih aralıklı token kotası'
          }
          subtitleLeft={
            editingAllocId ? `Kayıt ID: ${editingAllocId}` : 'Yeni Token Tanımı'
          }
        >
          <div
            className="form-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '20px',
            }}
          >
            <div className="form-group">
              <label>Tarih Aralığı *</label>
              <DateRangeInput
                startDate={allocStartDate}
                endDate={allocEndDate}
                onChange={(s, e) => {
                  setAllocStartDate(s);
                  setAllocEndDate(e);
                }}
              />
            </div>

            <div className="form-group">
              <label>Token Miktarı *</label>
              <TamsayiInput
                value={allocTokenAmount}
                onChange={(e) => setAllocTokenAmount(Number(e.target.value))}
                suffix="Token"
              />
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Açıklama (Opsiyonel)</label>
              <BaseInput
                value={allocDescription}
                onChange={(e) => setAllocDescription(e.target.value)}
                placeholder="Örn: 2026 Yıllık Paket / Ek Token Kotası"
              />
            </div>
          </div>
        </BaseCardPage>
      );
    }

    const overallUsagePct = Math.min(
      100,
      Math.round((totalUsedTokens / Math.max(1, totalDefinedTokens)) * 100)
    );

    const tokenTableColumns: DataTableColumn<UserTokenAllocationDTO>[] = [
      {
        id: 'expand',
        header: '',
        width: '44px',
        align: 'center',
        render: (row) => {
          const isExpanded = Boolean(expandedAllocIds[row.id]);
          return (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '26px',
                height: '26px',
                borderRadius: '7px',
                background: 'var(--surface-secondary)',
                color: 'var(--text-primary)',
              }}
            >
              {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </span>
          );
        },
      },
      {
        id: 'start_date',
        header: 'Tarih Aralığı',
        accessor: 'start_date',
        sortable: true,
        render: (row) => (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 600,
              fontSize: '13.5px',
              color: 'var(--text-primary)',
            }}
          >
            <Calendar size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
            <span>
              {formatDateOnly(row.start_date)} — {formatDateOnly(row.end_date)}
            </span>
          </div>
        ),
      },
      {
        id: 'token_amount',
        header: 'Token',
        accessor: 'token_amount',
        sortable: true,
        render: (row) => (
          <span
            style={{
              fontFamily: 'monospace',
              fontWeight: 700,
              fontSize: '13.5px',
              color: 'var(--text-primary)',
            }}
          >
            {row.token_amount.toLocaleString(locale)} Token
          </span>
        ),
      },
      {
        id: 'used_tokens',
        header: 'Kullanılan Token',
        accessor: 'used_tokens',
        sortable: true,
        render: (row) => (
          <span
            style={{
              fontFamily: 'monospace',
              fontWeight: 700,
              fontSize: '13.5px',
              color: row.used_tokens > 0 ? 'var(--primary)' : 'var(--text-secondary)',
            }}
          >
            {row.used_tokens.toLocaleString(locale)} Token
          </span>
        ),
      },
      {
        id: 'remaining_tokens',
        header: 'Kalan Token',
        accessor: 'remaining_tokens',
        sortable: true,
        render: (row) => (
          <span
            style={{
              fontFamily: 'monospace',
              fontWeight: 700,
              fontSize: '13.5px',
              color: row.remaining_tokens > 0 ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {row.remaining_tokens.toLocaleString(locale)} Token
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'İşlem',
        align: 'right',
        width: '96px',
        render: (row) => {
          if ((Number(row.used_tokens) || 0) > 0) {
            return null;
          }
          return (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onClick={(ev) => ev.stopPropagation()}
            >
              <BaseButton
                variant="ghost"
                className="btn-sm"
                icon={<Edit3 size={14} />}
                title="Düzenle"
                onClick={() => handleEditAllocationRow(row)}
              />
              <BaseButton
                variant="ghost"
                className="btn-sm"
                icon={<Trash2 size={14} />}
                title="Sil"
                onClick={() => void handleDeleteTokenAllocation(row.id)}
              />
            </div>
          );
        },
      },
    ];

    const renderExpandedTokenRow = (row: UserTokenAllocationDTO) => {
      if (!expandedAllocIds[row.id]) return null;
      const dateGroups = row.date_groups || [];

      return (
        <div style={{ padding: '14px 20px 18px 46px' }}>
          <div
            style={{
              borderRadius: '10px',
              border: '1px solid var(--glass-border)',
              background: 'var(--surface-secondary)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '9px 14px',
                borderBottom: '1px solid var(--glass-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Activity size={13} style={{ color: 'var(--primary)' }} />
                Tarih Gruplaması ile Kullanılan Token Dökümü ({dateGroups.length} Gün)
              </span>
              <span>
                Toplam Harcanan:{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {row.used_tokens.toLocaleString(locale)} Token
                </strong>
              </span>
            </div>

            {dateGroups.length === 0 ? (
              <div
                style={{
                  padding: '16px',
                  fontSize: '12.5px',
                  color: 'var(--text-secondary)',
                  textAlign: 'center',
                }}
              >
                Bu tarih aralığında henüz API veya AI Chat Stüdyo üzerinden harcama kaydı
                bulunmuyor.
              </div>
            ) : (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '12.5px',
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid var(--glass-border)',
                      textAlign: 'left',
                      color: 'var(--text-secondary)',
                      fontSize: '11.5px',
                    }}
                  >
                    <th style={{ padding: '8px 14px' }}>Tarih</th>
                    <th style={{ padding: '8px 14px' }}>İşlem Sayısı</th>
                    <th style={{ padding: '8px 14px' }}>AI Chat Stüdyo</th>
                    <th style={{ padding: '8px 14px' }}>API</th>
                    <th style={{ padding: '8px 14px' }}>Girdi / Çıktı (Prompt / Yanıt)</th>
                    <th style={{ padding: '8px 14px', textAlign: 'right' }}>
                      Kullanılan Token
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dateGroups.map((grp) => (
                    <tr
                      key={grp.usage_date}
                      style={{
                        borderBottom: '1px solid var(--glass-border)',
                      }}
                    >
                      <td
                        style={{
                          padding: '9px 14px',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <Calendar size={12} />
                          {formatDateOnly(grp.usage_date)}
                        </span>
                      </td>
                      <td style={{ padding: '9px 14px' }}>{grp.request_count} istek</td>
                      <td style={{ padding: '9px 14px', fontFamily: 'monospace' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            color:
                              grp.studio_tokens > 0
                                ? 'var(--primary)'
                                : 'var(--text-secondary)',
                          }}
                        >
                          <Sparkles size={12} />
                          {grp.studio_tokens.toLocaleString(locale)}
                        </span>
                      </td>
                      <td style={{ padding: '9px 14px', fontFamily: 'monospace' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            color:
                              grp.api_tokens > 0
                                ? 'var(--success)'
                                : 'var(--text-secondary)',
                          }}
                        >
                          <Terminal size={12} />
                          {grp.api_tokens.toLocaleString(locale)}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '9px 14px',
                          fontFamily: 'monospace',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {grp.prompt_tokens.toLocaleString(locale)} /{' '}
                        {grp.completion_tokens.toLocaleString(locale)}
                      </td>
                      <td
                        style={{
                          padding: '9px 14px',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {grp.total_tokens.toLocaleString(locale)} Token
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      );
    };

    const generalTabContent = (
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

        <div
          className="form-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '20px',
          }}
        >
          {/* 1. Alan: Hesap Türü (İlk Alan) */}
          <div className="form-group">
            <label>Hesap Türü</label>
            <select
              value={accountType}
              onChange={(e) => {
                const nextType = e.target.value as 'user' | 'admin';
                setAccountType(nextType);
                if (!editingUser) {
                  const defaultQuota = nextType === 'admin' ? 1000000 : 250000;
                  setTokenQuota(defaultQuota);
                  setRpmLimit(nextType === 'admin' ? 60 : 25);
                  setAllocTokenAmount(defaultQuota);
                  setTokenAllocations((prev) =>
                    prev.length === 1 && prev[0].id.startsWith('draft_init_')
                      ? [
                          {
                            ...prev[0],
                            token_amount: defaultQuota,
                            remaining_tokens: defaultQuota,
                          },
                        ]
                      : prev
                  );
                }
              }}
              style={{
                height: '40px',
                padding: '0 12px',
                borderRadius: '10px',
                border: '1px solid var(--glass-border)',
                background: 'var(--surface-secondary)',
                color: 'var(--text-primary)',
                fontSize: '13.5px',
                outline: 'none',
                width: '100%',
              }}
            >
              <option value="user">API / Kota Kullanıcısı (Geliştirici / Müşteri)</option>
              <option value="admin">Sistem Yöneticisi (Admin Panel Giriş Yetkili)</option>
            </select>
          </div>

          {/* 2. Alan: Ad Soyad */}
          <div className="form-group">
            <label>{t('users.fieldFullName')} *</label>
            <BaseInput
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={
                accountType === 'admin' ? 'Örn: Serhat Akalın' : 'Örn: Ada Lovelace'
              }
              harfDonusumu="basHarflerBuyuk"
              required
            />
          </div>

          {/* 3. Alan: E-posta */}
          <div className="form-group">
            <label>{t('users.fieldEmail')} *</label>
            <EmailInput
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={
                accountType === 'admin' ? 'akalinserhat@gmail.com' : 'team@company.com'
              }
            />
          </div>

          {/* 4. Alan: RPM Limiti */}
          <div className="form-group">
            <label>{t('users.fieldRpm')}</label>
            <TamsayiInput
              value={rpmLimit}
              onChange={(e) => setRpmLimit(Number(e.target.value))}
              suffix="RPM"
            />
          </div>

          {accountType === 'admin' && (
            <div className="form-group">
              <label>Yönetici Rol Unvanı</label>
              <select
                value={adminRoleTitle}
                onChange={(e) => setAdminRoleTitle(e.target.value)}
                style={{
                  height: '40px',
                  padding: '0 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--glass-border)',
                  background: 'var(--surface-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '13.5px',
                  outline: 'none',
                  width: '100%',
                }}
              >
                {SYSTEM_ROLE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    );

    const tokensTabContent = (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          position: 'relative',
          minHeight: '340px',
          paddingBottom: '64px',
        }}
      >
        {/* @akalin/ui DataTable ile Token Listesi (Aşağıya doğru genişleyen satırlar) */}
        <DataTable<UserTokenAllocationDTO>
          columns={tokenTableColumns}
          data={tokenAllocations}
          loading={loadingAllocations}
          keyExtractor={(item) => item.id}
          onRowClick={(row) => toggleExpandAllocation(row.id)}
          expandedRowRender={renderExpandedTokenRow}
          stickyActionColumn={false}
          enableColumnManagement={true}
          emptyMessage="Henüz tanımlanmış bir token paketi bulunmuyor. Sağ alttaki (+) düğmesiyle yeni token tanımlayabilirsiniz."
        />

        {/* Sağ Alt Köşe Yüzen Yuvarlak Ekle Düğmesi (@akalin/ui EkleFloatCircleButton) */}
        <EkleFloatCircleButton
          position="fixed-bottom-right"
          title="Yeni Token Tanımla"
          onClick={handleOpenAddTokenCardPage}
        />
      </div>
    );

    const cardTabs = [
      {
        id: 'general',
        label: 'Kullanıcı Bilgileri',
        icon: <User size={15} />,
        content: generalTabContent,
      },
      {
        id: 'tokens',
        label: 'Token Tanımlama',
        icon: <Coins size={15} />,
        badge: tokenAllocations.length,
        content: tokensTabContent,
      },
    ];

    return (
      <BaseCardPage
        id="user-card-form"
        asForm={true}
        onSubmit={handleSaveUser}
        onSave={handleSaveUser}
        isSaving={submitting}
        saveButtonText="Kaydet"
        showBackButton={true}
        onBack={handleBackToList}
        enableAiAssistant={false}
        cardType="KullaniciKart"
        tabs={cardTabs}
        activeTabId={activeCardTabId}
        onTabChange={(tabId) => setActiveCardTabId(String(tabId))}
        extraDropdownActions={[
          {
            type: 'custom',
            content: (
              <BaseSwitch
                className="action-menu-switch-item"
                label="Aktif"
                checked={status === 'active'}
                onChange={(e) => void handleToggleActiveSwitch(e.target.checked)}
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
                      onShowToast(
                        `${res.full_name} (${res.email}) adresine şifre sıfırlama e-postası gönderildi.`
                      );
                      await refreshAll();
                    } catch (err) {
                      onShowToast(err instanceof Error ? err.message : String(err));
                    }
                  },
                },
              ]
            : []),
        ]}
        recordTitle={
          editingUser ? `${editingUser.full_name} (${editingUser.email})` : 'Yeni Kullanıcı Kartı'
        }
        icon={accountType === 'admin' ? <ShieldCheck size={22} /> : <User size={22} />}
        title={
          editingUser
            ? `${editingUser.full_name} — Kullanıcı ve Kota Kartı`
            : 'Yeni Kullanıcı ve Kota Kartı'
        }
        subtitle={
          accountType === 'admin'
            ? 'Sistem Yöneticisi — Admin yönetim paneli giriş yetkisi ve yüksek kota profili'
            : 'API / Kota Kullanıcısı — Standart geliştirici veya SaaS müşteri hesabı'
        }
        subtitleLeft={
          editingUser
            ? `Kullanıcı ID: ${editingUser.id} · Durum: ${status === 'active' ? 'Aktif' : 'Askıda'}`
            : `Yeni Kayıt · Durum: ${status === 'active' ? 'Aktif' : 'Askıda'}`
        }
      />
    );
  }

  // ─── Ana Liste Görünümü (BaseListPage) ─────────────────────────────────────
  return (
    <BaseListPage<UnifiedUserRow>
      title={title || t('users.title')}
      subtitle={subtitle || t('users.subtitle')}
      subtitleLeft={`${unifiedUsers.length} Toplam Hesap · ${adminCount} Sistem Yöneticisi · ${regularUserCount} Kota Kullanıcısı`}
      icon={<Users size={22} />}
      baseRoute="/users"
      columns={columns}
      searchableFields={searchableFields}
      customFetchData={handleFetchUsers}
      customDeleteData={handleDeleteUser}
      canDelete={handleCanDeleteUser}
      extraDropdownActions={[
        {
          label: t('users.newUserBtn'),
          icon: <Plus size={15} />,
          isDefault: true,
          variant: 'primary',
          onClick: handleOpenAddPage,
        },
        {
          label: 'Listeyi Yenile',
          icon: <RefreshCw size={15} />,
          dividerAbove: true,
          onClick: () => void refreshAll(),
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
      addNewText={t('users.newUserBtn')}
      emptyMessage="Kayıtlı kullanıcı bulunamadı."
      refreshKey={combinedRefreshKey}
      onAddNew={handleOpenAddPage}
      onEdit={(u) => handleOpenEditPage(u)}
    />
  );
};
