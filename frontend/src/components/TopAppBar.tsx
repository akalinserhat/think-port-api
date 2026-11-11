import React, { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Home, Users } from 'lucide-react';
import {
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
  currentAuthUser?: SystemUserRecordDTO | null;
  onLogout?: () => void;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  activeTab,
  onSelectTab,
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
    const chatMatch = clean.match(/^\/chat\/([^/?#]+)/);
    const chatSubId = chatMatch ? decodeURIComponent(chatMatch[1]) : null;
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

    if (
      activeTab === 'chat' &&
      (chatSubId ||
        headerBreadcrumbOptions?.recordTitle ||
        (headerBreadcrumbOptions?.subTrail && headerBreadcrumbOptions.subTrail.length > 0))
    ) {
      baseItems.push({
        label: tabTitles.chat,
        onClick: () => navigate('/chat'),
      });
      if (headerBreadcrumbOptions?.subTrail && headerBreadcrumbOptions.subTrail.length > 0) {
        headerBreadcrumbOptions.subTrail.forEach((sub, idx, arr) => {
          baseItems.push({
            label: sub.label,
            onClick: sub.onClick,
            active: sub.active ?? idx === arr.length - 1,
          });
        });
      } else {
        baseItems.push({
          label:
            headerBreadcrumbOptions?.recordTitle ||
            (chatSubId === 'new' || chatSubId === 'yeni' ? 'Yeni Sohbet' : 'Sohbet Oturumu'),
          active: true,
        });
      }
      return baseItems;
    }

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
      const aiNestedMatch = clean.match(/^\/settings\/ai\/([^/?#]+)/);
      const aiSubId = aiNestedMatch
        ? decodeURIComponent(aiNestedMatch[1])
        : settingsModuleId === 'models' || settingsModuleId === 'protocols'
          ? settingsModuleId
          : null;

      if (settingsModuleId === 'ai' || aiSubId) {
        baseItems.push({
          label: tabTitles.settings,
          onClick: () => navigate('/settings'),
        });

        if (aiSubId) {
          baseItems.push({
            label: t('settings.aiGroupTitle', 'Yapay Zeka'),
            onClick: () => navigate('/settings/ai'),
          });
          baseItems.push({
            label:
              aiSubId === 'models'
                ? t('settings.modelsModuleTitle', 'Modeller')
                : aiSubId === 'protocols'
                  ? t('settings.protocolsModuleTitle', 'API Protokolleri')
                  : aiSubId,
            active: true,
          });
        } else {
          baseItems.push({
            label: t('settings.aiGroupTitle', 'Yapay Zeka'),
            active: true,
          });
        }

        return baseItems;
      }

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

        <div className="header-search-container">
          <GlobalSearch className="header-main-search" allowMultipleFilterTypes={true} />
        </div>

        <div className="header-right">
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
