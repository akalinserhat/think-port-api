import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyRound,
  Copy,
  Ban,
  RotateCcw,
} from 'lucide-react';
import {
  AnahtarOlusturucuInput,
  BaseCard,
  BaseCardPage,
  EpostaSeciciInput,
  TarihAraligiSecici,
  type ActionMenuItem,
  type BaseTabItem,
} from '@akalin/ui';
import { ApiKeyRecordDTO, UserRecordDTO } from '../dtos';
import { UserSelectionListPage } from './UserSelectionListPage';

export interface ApiKeyCardPageProps {
  users: UserRecordDTO[];
  apiKeys?: ApiKeyRecordDTO[];
  editingKey?: ApiKeyRecordDTO | null;
  newlyCreatedKey?: string | null;
  onBack: () => void;
  onCreateKey: (
    userId: string,
    name: string,
    expiresDays: number,
    customApiKey?: string
  ) => Promise<void>;
  onRevokeKey: (keyId: string) => void;
  onCopyAndUseKey: (rawKey: string) => void;
}

function formatLocalIsoDate(dt: Date): string {
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getTodayIso(): string {
  return formatLocalIsoDate(new Date());
}

function addDaysToIso(baseDateStr: string, days: number): string {
  const safeDays = Math.max(1, Number(days) || 30);
  const parts = (baseDateStr || getTodayIso()).slice(0, 10).split('-').map(Number);
  const baseDate =
    parts.length === 3 && parts[0] && parts[1] && parts[2]
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : new Date();
  baseDate.setDate(baseDate.getDate() + safeDays);
  return formatLocalIsoDate(baseDate);
}

function computeDaysBetweenDates(startStr: string, endStr: string): number {
  if (!endStr) return 30;
  const sParts = (startStr || getTodayIso()).slice(0, 10).split('-').map(Number);
  const eParts = endStr.slice(0, 10).split('-').map(Number);
  if (sParts.length !== 3 || eParts.length !== 3) return 30;
  const startDt = new Date(sParts[0], sParts[1] - 1, sParts[2]);
  const endDt = new Date(eParts[0], eParts[1] - 1, eParts[2]);
  if (isNaN(startDt.getTime()) || isNaN(endDt.getTime())) return 30;
  const diff = Math.round((endDt.getTime() - startDt.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, diff);
}

export const ApiKeyCardPage: React.FC<ApiKeyCardPageProps> = ({
  users,
  editingKey = null,
  onBack,
  onCreateKey,
  onRevokeKey,
  onCopyAndUseKey,
}) => {
  const { t } = useTranslation();

  const isViewMode = Boolean(editingKey);

  const [activeTabId, setActiveTabId] = useState<string>('general');
  const [selectedUserId, setSelectedUserId] = useState<string>(editingKey?.user_id || '');
  const [userSearchText, setUserSearchText] = useState<string>('');
  const [apiKeyValue, setApiKeyValue] = useState<string>(
    editingKey ? editingKey.raw_preview || editingKey.key_prefix : ''
  );
  const [expiresDays, setExpiresDays] = useState<number>(30);
  const [startDateStr, setStartDateStr] = useState<string>(() => getTodayIso());
  const [endDateStr, setEndDateStr] = useState<string>(() => addDaysToIso(getTodayIso(), 30));
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (editingKey) {
      setSelectedUserId(editingKey.user_id);
      setUserSearchText('');
      setApiKeyValue(editingKey.raw_preview || editingKey.key_prefix);
      const startIso = editingKey.created_at ? editingKey.created_at.slice(0, 10) : getTodayIso();
      setStartDateStr(startIso);
      if (editingKey.expires_at) {
        const cleanEndDate = editingKey.expires_at.slice(0, 10);
        const computedDays = computeDaysBetweenDates(startIso, cleanEndDate);
        setEndDateStr(cleanEndDate);
        setExpiresDays(computedDays);
      } else {
        setEndDateStr(addDaysToIso(startIso, 30));
      }
      setFormError(null);
    } else {
      const todayIso = getTodayIso();
      setSelectedUserId('');
      setUserSearchText('');
      setApiKeyValue('');
      setExpiresDays(30);
      setStartDateStr(todayIso);
      setEndDateStr(addDaysToIso(todayIso, 30));
      setFormError(null);
    }
  }, [editingKey]);

  const selectedUser = useMemo<UserRecordDTO | undefined>(
    () => users.find((u) => u.id === selectedUserId),
    [users, selectedUserId]
  );

  const handleDateRangeChange = useCallback((nextStart: string, nextEnd: string) => {
    setStartDateStr(nextStart);
    setEndDateStr(nextEnd);
    setFormError(null);
    if (nextStart && nextEnd) {
      const nextDays = computeDaysBetweenDates(nextStart, nextEnd);
      setExpiresDays(nextDays);
    }
  }, []);

  const handleResetForm = useCallback(() => {
    const todayIso = getTodayIso();
    setSelectedUserId('');
    setUserSearchText('');
    setApiKeyValue('');
    setExpiresDays(30);
    setStartDateStr(todayIso);
    setEndDateStr(addDaysToIso(todayIso, 30));
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      if (isViewMode) return;

      let resolvedUserId = selectedUserId;
      if (!resolvedUserId && userSearchText.trim()) {
        const matched = users.find(
          (u) => u.email.toLowerCase() === userSearchText.trim().toLowerCase()
        );
        if (matched) {
          resolvedUserId = matched.id;
          setSelectedUserId(matched.id);
          setUserSearchText('');
        }
      }

      if (!startDateStr || !endDateStr) {
        setFormError('Lütfen geçerlilik tarih aralığı için başlangıç ve bitiş tarihlerini seçin.');
        return;
      }
      if (!expiresDays || expiresDays < 1) {
        setFormError('Geçerlilik süresi en az 1 gün olmalıdır.');
        return;
      }
      if (!resolvedUserId) {
        setFormError(
          'Lütfen API anahtarının tanımlanacağı kullanıcıyı e-posta ile arayarak seçin.'
        );
        return;
      }
      const trimmedKey = apiKeyValue.trim();
      if (!trimmedKey) {
        setFormError("Lütfen sağdaki 'Oluştur' düğmesini kullanarak bir API anahtarı üretin.");
        return;
      }

      const resolvedUser = users.find((u) => u.id === resolvedUserId);
      const generatedKeyName = resolvedUser
        ? `${resolvedUser.full_name} API Anahtarı`
        : 'Production API Key';

      setFormError(null);
      setSubmitting(true);
      try {
        await onCreateKey(resolvedUserId, generatedKeyName, expiresDays, trimmedKey);
        onBack();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [
      isViewMode,
      selectedUserId,
      userSearchText,
      users,
      startDateStr,
      endDateStr,
      expiresDays,
      apiKeyValue,
      onCreateKey,
      onBack,
    ]
  );

  const extraDropdownActions = useMemo<ActionMenuItem[]>(() => {
    if (isViewMode && editingKey) {
      const items: ActionMenuItem[] = [];
      if (editingKey.raw_preview && editingKey.is_active) {
        items.push({
          label: t('keys.useInChatBtn'),
          icon: <Copy size={15} />,
          isDefault: true,
          variant: 'primary',
          onClick: () => onCopyAndUseKey(editingKey.raw_preview!),
        });
      }
      if (editingKey.is_active) {
        items.push({
          label: t('keys.revokeBtn'),
          icon: <Ban size={15} />,
          danger: true,
          dividerAbove: items.length > 0,
          onClick: () => onRevokeKey(editingKey.id),
        });
      }
      return items;
    }

    return [
      {
        label: 'Formu Sıfırla',
        icon: <RotateCcw size={15} />,
        dividerAbove: true,
        onClick: handleResetForm,
      },
    ];
  }, [isViewMode, editingKey, t, onCopyAndUseKey, onRevokeKey, handleResetForm]);

  const generalTabContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {formError && (
        <BaseCard
          variant="filled"
          style={{
            borderLeft: '4px solid var(--danger)',
            background: 'rgba(239, 68, 68, 0.10)',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--danger)' }}>
            {formError}
          </div>
        </BaseCard>
      )}

      {/* Ana Form Alanları (@akalin/ui Bileşenleri) */}
      <div
        className="form-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '20px',
        }}
      >
        {/* 1. Alan: Geçerlilik Tarih Aralığı (@akalin/ui TarihAraligiSecici / DateRangeInput) */}
        <div className="form-group">
          <label>Geçerlilik Tarih Aralığı (Başlangıç - Bitiş) *</label>
          <TarihAraligiSecici
            id="api-key-date-range-input"
            startDate={startDateStr}
            endDate={endDateStr}
            onChange={handleDateRangeChange}
            disabled={isViewMode}
            placeholderStart="Başlangıç Tarihi"
            placeholderEnd="Bitiş Tarihi"
          />
        </div>

        {/* 2. Alan: Kullanıcı E-Posta Seçimi (@akalin/ui EpostaSeciciInput + BaseSelectionList) */}
        <div className="form-group">
          <label>{t('keys.fieldUser')} (E-Posta) *</label>
          <EpostaSeciciInput
            id="api-key-user-email-selector"
            value={userSearchText}
            selectedItem={selectedUser}
            formatDisplayValue={(item: UserRecordDTO) => `${item.email} (${item.full_name})`}
            disabled={isViewMode}
            placeholder="E-posta adresi yazıp Enter'a basın veya listeden seçin..."
            onChange={(val) => {
              setUserSearchText(val);
              if (selectedUserId) {
                setSelectedUserId('');
              }
              setFormError(null);
            }}
            onClear={() => {
              setSelectedUserId('');
              setUserSearchText('');
              setFormError(null);
            }}
            renderSelectionModal={({ isOpen, searchText, onClose }) =>
              isOpen ? (
                <UserSelectionListPage
                  users={users}
                  initialSearchText={searchText}
                  selectedUserId={selectedUserId || null}
                  onSelect={(u) => {
                    setSelectedUserId(u.id);
                    setUserSearchText('');
                    setFormError(null);
                    onClose();
                  }}
                  onCancel={onClose}
                />
              ) : null
            }
          />
        </div>

        {/* 3. Alan: API Anahtar Oluşturucu (@akalin/ui AnahtarOlusturucuInput / ApiKeyInput) */}
        <div className="form-group">
          <label>API Anahtarı *</label>
          <AnahtarOlusturucuInput
            id="api-key-generator-input"
            value={apiKeyValue}
            onValueChange={(nextKey) => {
              setApiKeyValue(nextKey);
              setFormError(null);
            }}
            onCopy={(copiedVal) => onCopyAndUseKey(copiedVal)}
            keyPrefix="sk-gw-"
            keyLength={32}
            readOnly={true}
            showGenerateButton={!isViewMode}
            showCopyButton={true}
            placeholder="Sağdaki 'Oluştur' düğmesi ile API anahtarı üretin..."
          />
        </div>
      </div>
    </div>
  );

  const cardTabs: BaseTabItem[] = [
    {
      id: 'general',
      label: 'Anahtar Bilgileri',
      icon: <KeyRound size={15} />,
      content: generalTabContent,
    },
  ];

  return (
    <BaseCardPage
      id="api-key-card-form"
      asForm={true}
      onSubmit={handleSubmit}
      onSave={isViewMode ? undefined : handleSubmit}
      hideSaveButton={isViewMode}
      isSaving={submitting}
      showBackButton={true}
      onBack={onBack}
      enableAiAssistant={false}
      cardType="ApiKeyKart"
      tabs={cardTabs}
      activeTabId={activeTabId}
      onTabChange={(tabId) => setActiveTabId(String(tabId))}
      extraDropdownActions={extraDropdownActions}
      recordTitle={
        editingKey ? `${editingKey.name} (${editingKey.key_prefix})` : 'Yeni API Anahtarı Kartı'
      }
      icon={<KeyRound size={22} />}
      title={
        editingKey
          ? `${editingKey.name} — API Anahtarı Kartı`
          : t('keys.modalTitle', 'Yeni API Anahtarı Oluştur')
      }
      subtitle={
        selectedUser
          ? `${selectedUser.full_name} (${selectedUser.email}) kullanıcısı için uygulama erişim anahtarı`
          : t('keys.subtitle')
      }
      subtitleLeft={
        editingKey
          ? `Anahtar ID: ${editingKey.id} · Durum: ${editingKey.is_active ? t('status.valid') : t('status.revoked')}`
          : `Yeni Kayıt · Geçerlilik: ${expiresDays} Gün`
      }
    />
  );
};

export default ApiKeyCardPage;
