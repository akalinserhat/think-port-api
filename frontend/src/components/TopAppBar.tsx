import React, { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, RefreshCw, Sparkles, Home, Users } from 'lucide-react';
import {
  BaseButton,
  Breadcrumb,
  type BreadcrumbItem,
  DrawerMenu,
  useHeader,
} from '@akalin/ui';
import { GlobalSearch } from '@akalin/global_search_module';
import { useTheme } from '../context/ThemeContext';
import { ActiveTab, SupportedLanguage, SystemUserRecordDTO } from '../dtos';

interface TopAppBarProps {
  activeTab: ActiveTab;
  onSelectTab?: (tab: ActiveTab) => void;
  modelCount: number;
  isBusy: boolean;
  onRefresh: () => void;
  currentAuthUser?: SystemUserRecordDTO | null;
  onLogout?: () => void;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  activeTab,
  onSelectTab,
  modelCount,
  isBusy,
  onRefresh,
  currentAuthUser,
  onLogout,
}) => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { headerContent, headerBreadcrumbOptions } = useHeader();

  const currentLang = (i18n.language?.startsWith('en') ? 'en' : 'tr') as SupportedLanguage;

  const handleLanguageToggle = () => {
    const nextLang: SupportedLanguage = currentLang === 'tr' ? 'en' : 'tr';
    i18n.changeLanguage(nextLang);
    localStorage.setItem('gateway_lang', nextLang);
  };

  const tabTitles: Record<ActiveTab, string> = {
    chat: t('nav.chat'),
    overview: t('nav.overview'),
    users: t('nav.users'),
    keys: t('nav.keys'),
    nodes: t('nav.nodes'),
    settings: t('nav.settings'),
  };

  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
    const clean = location.pathname.replace(/^\/admin(?=\/|$)/, '');
    const settingsMatch = clean.match(/^\/settings\/([^/?#]+)/);
    const settingsModuleId = settingsMatch ? decodeURIComponent(settingsMatch[1]) : null;
    const usersMatch = clean.match(/^\/users\/([^/?#]+)/);
    const usersSubId = usersMatch ? decodeURIComponent(usersMatch[1]) : null;
    const emailTemplateMatch = clean.match(/^\/email\/templates\/([^/?#]+)/);

    const baseItems: BreadcrumbItem[] = [
      {
        label: t('brand.title'),
        icon: <Home size={14} />,
        onClick: () => onSelectTab?.('overview'),
      },
    ];

    if (activeTab === 'users' && usersSubId) {
      baseItems.push({
        label: tabTitles.users,
        onClick: () => navigate('/users'),
      });
      baseItems.push({
        label:
          headerBreadcrumbOptions?.recordTitle ||
          (usersSubId === 'yeni' ? 'Yeni Kullanıcı Kartı' : 'Kullanıcı Kartı'),
        active: true,
      });
      return baseItems;
    }

    if (emailTemplateMatch) {
      baseItems.push({
        label: tabTitles.settings,
        onClick: () => navigate('/settings'),
      });
      baseItems.push({
        label: t('settings.smtpModuleTitle', 'E-Posta & SMTP Ayarları'),
        onClick: () => navigate('/settings/smtp'),
      });
      baseItems.push({
        label: headerBreadcrumbOptions?.recordTitle || 'E-Posta Şablon Editörü',
        active: true,
      });
      return baseItems;
    }

    if (activeTab === 'settings' && settingsModuleId) {
      const moduleLabel =
        settingsModuleId === 'gateway'
          ? t('settings.gatewayModuleTitle', 'Gateway Sistem Ayarları')
          : settingsModuleId === 'users'
            ? t('settings.usersModuleTitle', 'Sistem Kullanıcıları')
            : settingsModuleId === 'roles'
              ? t('settings.rolesModuleTitle', 'Rol ve Yetkiler')
              : settingsModuleId === 'smtp'
                ? t('settings.smtpModuleTitle', 'E-Posta & SMTP Ayarları')
                : settingsModuleId;

      baseItems.push({
        label: tabTitles.settings,
        onClick: () => navigate('/settings'),
      });
      baseItems.push({
        label: moduleLabel,
        active: true,
      });
      return baseItems;
    }

    baseItems.push({
      label: tabTitles[activeTab],
      active: true,
    });
    return baseItems;
  }, [
    location.pathname,
    activeTab,
    t,
    tabTitles,
    onSelectTab,
    navigate,
    headerBreadcrumbOptions,
  ]);

  return (
    <header className="header header-stacked">
      <div className="header-top-row">
        {headerContent && <div className="header-custom-actions">{headerContent}</div>}

        <div className="header-search-container" style={{ maxWidth: '560px', flex: 1 }}>
          <GlobalSearch allowMultipleFilterTypes={true} />
        </div>

        <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Active Models / Busy Status Pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 12px',
              borderRadius: '999px',
              background: 'var(--surface-secondary)',
              border: '1px solid var(--glass-border)',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-secondary)',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: isBusy ? 'var(--warning)' : 'var(--success)',
              }}
            />
            <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
              {isBusy ? t('status.generating') : t('status.activeModels', { count: modelCount })}
            </span>
          </div>

          {/* Chat Studio Shortcut Button */}
          {activeTab !== 'chat' && onSelectTab && (
            <button
              type="button"
              className="btn-header-ai"
              onClick={() => onSelectTab('chat')}
              title={t('nav.chat')}
            >
              <Sparkles size={15} />
              <span>{t('nav.chat')}</span>
            </button>
          )}

          {/* Refresh State Button */}
          <BaseButton
            variant="outline"
            className="btn-sm"
            icon={<RefreshCw size={15} />}
            text=""
            title="Yenile / Refresh"
            onClick={onRefresh}
            style={{ padding: '0 10px', minWidth: '36px' }}
          />

          {/* OpenAPI Docs Button */}
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            className="btn btn-outline btn-sm"
            style={{ textDecoration: 'none' }}
          >
            <span>OpenAPI</span>
            <ExternalLink size={14} />
          </a>

          {/* @akalin/ui DrawerMenu for User Profile, Theme & Language */}
          <DrawerMenu
            user={{
              adSoyad: currentAuthUser?.full_name || 'Serhat Akalın',
              email: currentAuthUser?.email || 'akalinserhat@gmail.com',
              rol: currentAuthUser?.role || 'Sistem Yöneticisi',
            }}
            theme={theme}
            onThemeToggle={toggleTheme}
            language={currentLang}
            onLanguageToggle={handleLanguageToggle}
            onLogout={onLogout}
            logoutLabel="Oturumu Kapat"
            customItems={[
              {
                label: 'Sistem Kullanıcıları',
                icon: <Users size={16} />,
                onClick: () => navigate('/settings/users'),
              },
              {
                label: 'OpenAPI Swagger (/docs)',
                icon: <ExternalLink size={16} />,
                onClick: () => window.open('/docs', '_blank'),
              },
            ]}
            themeLightLabel={t('theme.light')}
            themeDarkLabel={t('theme.dark')}
          />
        </div>
      </div>

      <div className="header-bottom-row">
        <Breadcrumb items={breadcrumbItems} size="sm" className="header-main-breadcrumb" />
      </div>
    </header>
  );
};
