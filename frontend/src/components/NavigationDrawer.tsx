import React, { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquareCode,
  LayoutDashboard,
  Users,
  KeyRound,
  ServerCog,
  SlidersHorizontal,
  Sparkles,
  Activity,
  MonitorCheck,
  Globe,
} from 'lucide-react';
import { Sidebar, type SidebarItem } from '@akalin/ui';
import { ActiveTab, AdminStateResponseDTO } from '../dtos';

export type NodesSubSection = 'dashboard' | 'sessions' | 'proxies';

interface NavigationDrawerProps {
  activeTab: ActiveTab;
  nodesSubSection?: NodesSubSection;
  onSelectTab: (tab: ActiveTab) => void;
  onSelectNodesSubSection?: (sub: NodesSubSection) => void;
  state: AdminStateResponseDTO;
  isGenerating: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  activeTab,
  nodesSubSection = 'dashboard',
  onSelectTab,
  onSelectNodesSubSection,
  state,
  isGenerating,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const { t } = useTranslation();

  const idleSessions = state.browser_sessions.filter((s) => s.status === 'idle').length;
  const busyAny = isGenerating || idleSessions < state.browser_sessions.length;
  const activeKeyCount = state.api_keys.filter((k) => k.is_active).length;
  const activeProxyCount = state.proxies.filter((p) => p.status === 'active').length;

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
        id: 'nodes',
        label: t('nav.nodes'),
        path: '/nodes',
        icon: <ServerCog size={20} />,
        onClick: (_item, e) => {
          e.preventDefault();
          if (onSelectNodesSubSection) {
            onSelectNodesSubSection('dashboard');
          } else {
            onSelectTab('nodes');
          }
        },
        children: [
          {
            id: 'nodes-sessions',
            label: t('nav.nodesSessions', 'Oturumlar'),
            path: '/nodes/sessions',
            icon: <MonitorCheck size={17} />,
            badge: {
              text: `${idleSessions}/${state.browser_sessions.length}`,
              variant: idleSessions > 0 ? 'success' : 'warning',
            },
            onClick: (_item, e) => {
              e.preventDefault();
              if (onSelectNodesSubSection) {
                onSelectNodesSubSection('sessions');
              } else {
                onSelectTab('nodes');
              }
            },
          },
          {
            id: 'nodes-proxies',
            label: t('nav.nodesProxies', 'Proxy Listesi'),
            path: '/nodes/proxies',
            icon: <Globe size={17} />,
            badge: {
              text: `${activeProxyCount}/${state.proxies.length}`,
              variant: activeProxyCount > 0 ? 'info' : 'secondary',
            },
            onClick: (_item, e) => {
              e.preventDefault();
              if (onSelectNodesSubSection) {
                onSelectNodesSubSection('proxies');
              } else {
                onSelectTab('nodes');
              }
            },
          },
        ],
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
      idleSessions,
      state.browser_sessions.length,
      activeProxyCount,
      state.proxies.length,
      onSelectTab,
      onSelectNodesSubSection,
    ]
  );

  const handleIsItemActive = useCallback(
    (item: SidebarItem) => {
      if (item.id === 'nodes-sessions') {
        return activeTab === 'nodes' && nodesSubSection === 'sessions';
      }
      if (item.id === 'nodes-proxies') {
        return activeTab === 'nodes' && nodesSubSection === 'proxies';
      }
      if (item.id === 'nodes') {
        return activeTab === 'nodes' && nodesSubSection === 'dashboard';
      }
      return item.id === activeTab;
    },
    [activeTab, nodesSubSection]
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

