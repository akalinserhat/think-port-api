import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Shield,
  SlidersHorizontal,
  Gauge,
  Monitor,
  Clock,
  RefreshCw,
  Save,
  Loader2,
  RotateCcw,
  Zap,
  Users,
  ShieldCheck,
} from 'lucide-react';
import {
  ActionMenu,
  type ActionMenuItem,
  BaseCardPage,
  BaseSystemPage,
  type SystemSettingModule,
  PolicySettingCard,
  TamsayiInput,
  BaseSwitch,
  useBaseSystemPage,
} from '@akalin/ui';
import { useSystemSettingModules } from '@akalin/module_core';
import { GatewaySettingsDTO, SystemUserRecordDTO, UserRecordDTO } from '../dtos';
import { SystemUsersView } from './SystemUsersView';
import { RolesPermissionsView } from './RolesPermissionsView';
import { initializeGatewayModules } from '../modules';

initializeGatewayModules();

interface GatewaySettingsModuleProps {
  settings: GatewaySettingsDTO;
  onSaveSettings: (updated: GatewaySettingsDTO) => Promise<void>;
}

interface SettingsViewProps {
  settings: GatewaySettingsDTO;
  users?: UserRecordDTO[];
  systemUsers?: SystemUserRecordDTO[];
  currentAuthUser?: SystemUserRecordDTO | null;
  onSaveSettings: (updated: GatewaySettingsDTO) => Promise<void>;
  onRefreshState: () => Promise<void>;
  onRefreshSystemUsers?: () => Promise<void>;
  onGenerateKeyForUser?: (userId: string) => Promise<void>;
  onShowToast: (msg: string) => void;
}

const DEFAULT_GATEWAY_SETTINGS: GatewaySettingsDTO = {
  global_rpm: 600,
  max_concurrent_browsers: 16,
  keep_alive_interval_sec: 300,
  enable_stealth: true,
  auto_rotate_proxy_on_403: true,
};

const GatewaySettingsModule: React.FC<GatewaySettingsModuleProps> = ({
  settings,
  onSaveSettings,
}) => {
  const { t } = useTranslation();
  const { filterItems } = useBaseSystemPage();
  const [formState, setFormState] = useState<GatewaySettingsDTO>(settings);
  const [saving, setSaving] = useState(false);

  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || ''),
    []
  );

  useEffect(() => {
    setFormState(settings);
  }, [settings]);

  const isDirty = useMemo(() => {
    return (
      formState.global_rpm !== settings.global_rpm ||
      formState.max_concurrent_browsers !== settings.max_concurrent_browsers ||
      formState.keep_alive_interval_sec !== settings.keep_alive_interval_sec ||
      formState.enable_stealth !== settings.enable_stealth ||
      formState.auto_rotate_proxy_on_403 !== settings.auto_rotate_proxy_on_403
    );
  }, [formState, settings]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent | React.MouseEvent) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      setSaving(true);
      try {
        await onSaveSettings(formState);
      } finally {
        setSaving(false);
      }
    },
    [formState, onSaveSettings]
  );

  const actionMenuItems = useMemo<ActionMenuItem[]>(
    () => [
      {
        label: saving ? t('Kaydediliyor', 'Kaydediliyor...') : t('Kaydet', 'Kaydet'),
        icon: saving ? (
          <Loader2 size={15} className="document-save-spinner animate-spin" />
        ) : (
          <Save size={15} />
        ),
        badge: <kbd className="document-save-hotkey">{isMac ? '⌘S' : 'Ctrl+S'}</kbd>,
        isDefault: true,
        variant: 'primary',
        disabled: saving,
        onClick: (e) => handleSubmit(e),
      },
      {
        label: 'Değişiklikleri Geri Al',
        icon: <RotateCcw size={15} />,
        disabled: !isDirty || saving,
        dividerAbove: true,
        onClick: () => setFormState(settings),
      },
      {
        label: 'Yüksek Güvenlik Profili Uygula',
        icon: <Shield size={15} />,
        disabled: saving,
        onClick: () =>
          setFormState((prev) => ({
            ...prev,
            enable_stealth: true,
            auto_rotate_proxy_on_403: true,
            keep_alive_interval_sec: 180,
          })),
      },
      {
        label: 'Yüksek Kapasite Profili (24 Oturum / 1200 RPM)',
        icon: <Zap size={15} />,
        disabled: saving,
        onClick: () =>
          setFormState((prev) => ({
            ...prev,
            global_rpm: 1200,
            max_concurrent_browsers: 24,
          })),
      },
      {
        label: 'Varsayılan Ayarlara Sıfırla',
        icon: <RefreshCw size={15} />,
        danger: true,
        disabled: saving,
        dividerAbove: true,
        onClick: () => setFormState(DEFAULT_GATEWAY_SETTINGS),
      },
    ],
    [saving, t, isMac, isDirty, settings, handleSubmit]
  );

  const policyItems = useMemo(
    () => [
      {
        id: 'global_rpm',
        icon: <Gauge size={20} />,
        iconActive: true,
        title: t('settings.globalRpmLabel'),
        description: t('settings.globalRpmDesc'),
        action: (
          <div className="w-160">
            <TamsayiInput
              value={formState.global_rpm}
              suffix="RPM"
              onChange={(e) =>
                setFormState((s) => ({ ...s, global_rpm: Number(e.target.value) || 600 }))
              }
            />
          </div>
        ),
      },
      {
        id: 'max_concurrent_browsers',
        icon: <Monitor size={20} />,
        iconActive: true,
        title: t('settings.maxBrowsersLabel'),
        description: t('settings.maxBrowsersDesc'),
        action: (
          <div className="w-160">
            <TamsayiInput
              value={formState.max_concurrent_browsers}
              onChange={(e) =>
                setFormState((s) => ({
                  ...s,
                  max_concurrent_browsers: Number(e.target.value) || 16,
                }))
              }
            />
          </div>
        ),
      },
      {
        id: 'keep_alive_interval_sec',
        icon: <Clock size={20} />,
        iconActive: true,
        title: t('settings.keepAliveLabel'),
        description: t('settings.keepAliveDesc'),
        action: (
          <div className="w-160">
            <TamsayiInput
              value={formState.keep_alive_interval_sec}
              suffix="sn"
              onChange={(e) =>
                setFormState((s) => ({
                  ...s,
                  keep_alive_interval_sec: Number(e.target.value) || 300,
                }))
              }
            />
          </div>
        ),
      },
      {
        id: 'enable_stealth',
        icon: <Shield size={20} />,
        iconActive: formState.enable_stealth,
        title: t('settings.stealthModeLabel'),
        description: t('settings.stealthModeDesc'),
        action: (
          <BaseSwitch
            checked={formState.enable_stealth}
            onChange={(e) =>
              setFormState((s) => ({ ...s, enable_stealth: e.target.checked }))
            }
          />
        ),
      },
      {
        id: 'auto_rotate_proxy_on_403',
        icon: <RefreshCw size={20} />,
        iconActive: formState.auto_rotate_proxy_on_403,
        title: t('settings.autoRotateLabel'),
        description: t('settings.autoRotateDesc'),
        action: (
          <BaseSwitch
            checked={formState.auto_rotate_proxy_on_403}
            onChange={(e) =>
              setFormState((s) => ({
                ...s,
                auto_rotate_proxy_on_403: e.target.checked,
              }))
            }
          />
        ),
      },
    ],
    [t, formState]
  );

  const visiblePolicyItems = useMemo(
    () => filterItems(policyItems, (item) => [item.title, item.description]),
    [policyItems, filterItems]
  );

  return (
    <BaseCardPage
      id="gateway-settings-form"
      asForm
      onSubmit={handleSubmit}
      onSave={handleSubmit}
      isSaving={saving}
      showBackButton={false}
      enableAiAssistant={false}
      icon={<SlidersHorizontal size={22} />}
      title={t('settings.gatewayModuleTitle', 'Gateway Sistem Ayarları')}
      subtitle={t('settings.subtitle')}
      customActionMenu={
        <ActionMenu
          showDefaultActionAsButton={true}
          actions={actionMenuItems}
          dropdownHeader="Politika & Havuz İşlemleri"
        />
      }
    >
      <div className="flex-col gap-16">
        {visiblePolicyItems.map((item) => (
          <PolicySettingCard
            key={item.id}
            icon={item.icon}
            iconActive={item.iconActive}
            title={item.title}
            description={item.description}
            action={item.action}
          />
        ))}
      </div>
    </BaseCardPage>
  );
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  systemUsers = [],
  currentAuthUser = null,
  onSaveSettings,
  onRefreshState,
  onRefreshSystemUsers = async () => {},
  onShowToast,
}) => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const registeredSettingModules = useSystemSettingModules();

  const selectedModuleId = useMemo(() => {
    const clean = location.pathname.replace(/^\/admin(?=\/|$)/, '');
    const match = clean.match(/^\/settings\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);

  const modules = useMemo<SystemSettingModule[]>(() => {
    const coreModules: SystemSettingModule[] = [
      {
        id: 'gateway',
        name: t('settings.gatewayModuleTitle', 'Gateway Sistem Ayarları'),
        desc: t(
          'settings.subtitle',
          'Global hız sınırları, tarayıcı havuzu kapasitesi ve anti-bot koruma parametreleri'
        ),
        icon: <SlidersHorizontal size={22} />,
        badge: `${settings.global_rpm} RPM · ${settings.max_concurrent_browsers} ${t('settings.sessionsBadgeSuffix', 'Oturum')}`,
        keywords:
          'gateway sistem ayarları hız sınırı global rpm tarayıcı browser havuz stealth anti-bot proxy rotasyon keep alive',
        hasOwnLayout: true,
        component: (
          <GatewaySettingsModule
            settings={settings}
            onSaveSettings={onSaveSettings}
          />
        ),
      },
      {
        id: 'users',
        name: t('settings.usersModuleTitle', 'Sistem Kullanıcıları'),
        desc: t(
          'settings.usersModuleDesc',
          'Admin yönetim paneline giriş yapabilen sistem yöneticileri, şifreleri ve erişim yetkileri'
        ),
        icon: <Users size={22} />,
        badge: `${systemUsers.length} ${t('settings.usersBadgeSuffix', 'Kullanıcı')}`,
        keywords:
          'sistem kullanıcıları admin panel giriş login şifre yönetici serhat akalın yetki durum',
        hasOwnLayout: true,
        component: (
          <SystemUsersView
            title={t('settings.usersModuleTitle', 'Sistem Kullanıcıları')}
            systemUsers={systemUsers}
            currentAuthUser={currentAuthUser}
            onRefreshSystemUsers={onRefreshSystemUsers}
            onShowToast={onShowToast}
          />
        ),
      },
      {
        id: 'roles',
        name: t('settings.rolesModuleTitle', 'Rol ve Yetkiler'),
        desc: t(
          'settings.rolesModuleDesc',
          'Sistem yöneticileri ve API kullanıcıları için rol grupları ve modül bazlı erişim yetki matrisi'
        ),
        icon: <ShieldCheck size={22} />,
        badge: '5 Rol · 16 Yetki',
        keywords:
          'rol ve yetkiler yetki matrisi izinler sistem yöneticisi operasyon güvenlik salt okunur rbac erişim',
        hasOwnLayout: true,
        component: <RolesPermissionsView onShowToast={onShowToast} />,
      },
    ];

    const existingIds = new Set(coreModules.map((m) => m.id));
    for (const regMod of registeredSettingModules) {
      if (!existingIds.has(regMod.id)) {
        coreModules.push(regMod as SystemSettingModule);
        existingIds.add(regMod.id);
      }
    }

    return coreModules;
  }, [
    t,
    settings,
    onSaveSettings,
    systemUsers,
    currentAuthUser,
    onRefreshSystemUsers,
    onShowToast,
    registeredSettingModules,
  ]);

  return (
    <BaseSystemPage
      title={t('settings.hubTitle', 'Sistem Ayarları')}
      subtitle={t(
        'settings.hubSubtitle',
        'Gateway yapılandırma parametrelerini, hız sınırlarını ve sistem kullanıcılarını buradan yönetin.'
      )}
      baseRoute="/settings"
      modules={modules}
      selectedModuleId={selectedModuleId}
      onModuleClick={(modId) =>
        navigate(`/settings/${modId}`, {
          state: { selectedModuleId: modId, returnUrl: '/settings' },
        })
      }
      onBack={() =>
        navigate('/settings', {
          state: { selectedModuleId },
        })
      }
      onRefresh={async () => {
        await Promise.all([onRefreshState(), onRefreshSystemUsers()]);
      }}
    />
  );
};
