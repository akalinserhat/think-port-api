import React, { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  MessageSquareCode,
  LayoutDashboard,
  Users,
  KeyRound,
  SlidersHorizontal,
  Sparkles,
  Compass,
} from 'lucide-react';
import { Sidebar, type SidebarItem } from '@akalin/ui';
import { ActiveTab, AdminStateResponseDTO } from '../dtos';

interface NavigationDrawerProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  state: AdminStateResponseDTO;
  isGenerating: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  activeTab,
  onSelectTab,
  state,
  isGenerating,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const { t } = useTranslation();

  const idleSessions = state.browser_sessions.filter((s) => s.status === 'idle').length;
  const busyAny = isGenerating || idleSessions < state.browser_sessions.length;
  const activeKeyCount = state.api_keys.filter((k) => k.is_active).length;

  const sidebarItems: SidebarItem[] = useMemo(
    () => [
      {
        id: 'overview',
        label: t('nav.overview'),
        path: '/overview',
        icon: <LayoutDashboard size={20} />,
        onClick: (_item, e) => {
          e.preventDefault();
          onSelectTab('overview');
        },
      },
      {
        id: 'chat',
        label: t('nav.chat'),
        path: '/chat',
        icon: <MessageSquareCode size={20} />,
        badge: state.models.length
          ? { text: state.models.length, variant: 'info' }
          : undefined,
        onClick: (_item, e) => {
          e.preventDefault();
          onSelectTab('chat');
        },
      },
      {
        id: 'users',
        label: t('nav.users'),
        path: '/users',
        icon: <Users size={20} />,
        badge: state.users.length
          ? { text: state.users.length, variant: 'secondary' }
          : undefined,
        onClick: (_item, e) => {
          e.preventDefault();
          onSelectTab('users');
        },
      },
      {
        id: 'keys',
        label: t('nav.keys'),
        path: '/keys',
        icon: <KeyRound size={20} />,
        badge: activeKeyCount
          ? { text: activeKeyCount, variant: 'primary' }
          : undefined,
        onClick: (_item, e) => {
          e.preventDefault();
          onSelectTab('keys');
        },
      },
      {
        id: 'browser',
        label: t('nav.browser', 'Sanal Tarayıcı'),
        path: '/browser/sessions',
        icon: <Compass size={20} />,
        onClick: (_item, e) => {
          e.preventDefault();
          onSelectTab('browser');
        },
      },
      {
        id: 'settings',
        label: t('nav.settings'),
        path: '/settings',
        icon: <SlidersHorizontal size={20} />,
        onClick: (_item, e) => {
          e.preventDefault();
          onSelectTab('settings');
        },
      },
    ],
    [
      t,
      state.models.length,
      state.users.length,
      activeKeyCount,
      onSelectTab,
    ]
  );

  const handleIsItemActive = useCallback(
    (item: SidebarItem) => {
      if (item.id === 'browser') {
        return activeTab === 'browser';
      }
      return item.id === activeTab;
    },
    [activeTab]
  );

  const headerSlot = !isCollapsed ? (
    <div
      onClick={() => onSelectTab('overview')}
      title={t('brand.title')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        cursor: 'pointer',
        minWidth: 0,
        flex: 1,
      }}
    >
      <div
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: 'var(--accent-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)',
          flexShrink: 0,
        }}
      >
        <Sparkles size={19} color="white" />
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '15px',
            fontWeight: 800,
            color: 'var(--text-primary)',
            letterSpacing: '-0.3px',
          }}
        >
          <span className="truncate">{t('brand.title')}</span>
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'monospace',
              padding: '2px 6px',
              borderRadius: '6px',
              background: 'var(--accent-light)',
              color: 'var(--accent-primary)',
              fontWeight: 700,
            }}
          >
            {t('brand.endpoint')}
          </span>
        </div>
        <div
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            marginTop: '2px',
          }}
          className="truncate"
        >
          {t('brand.subtitle')}
        </div>
      </div>
    </div>
  ) : undefined;

  const footerSlot = (
    <div
      style={{
        padding: '12px',
        borderRadius: '12px',
        background: 'var(--surface-secondary)',
        border: '1px solid var(--glass-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Activity size={14} style={{ color: 'var(--accent-primary)' }} />
          {busyAny ? t('status.generating') : t('status.ready')}
        </span>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: busyAny ? 'var(--warning)' : 'var(--success)',
            boxShadow: busyAny ? '0 0 8px var(--warning)' : '0 0 8px var(--success)',
          }}
        />
      </div>
      <div
        style={{
          fontSize: '11px',
          fontFamily: 'monospace',
          padding: '6px 10px',
          borderRadius: '8px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--glass-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>Ollama / Web AI</span>
        <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>
          {t('status.activeModels', { count: state.models.length })}
        </span>
      </div>
    </div>
  );

  return (
    <Sidebar
      items={sidebarItems}
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
      isItemActive={handleIsItemActive}
      header={headerSlot}
      footer={footerSlot}
      showSearch={false}
      collapseTogglePosition="header"
    />
  );
};

