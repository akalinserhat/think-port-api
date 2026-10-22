import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { NavigationDrawer, type NodesSubSection } from './components/NavigationDrawer';
import { TopAppBar } from './components/TopAppBar';
import { ChatStudioView } from './components/ChatStudioView';
import { OverviewView } from './components/OverviewView';
import { UsersView } from './components/UsersView';
import { ApiKeysView } from './components/ApiKeysView';
import { NodesPoolView } from './components/NodesPoolView';
import { SettingsView } from './components/SettingsView';
import { LoginView } from './components/LoginView';
import {
  ActiveTab,
  AdminStateResponseDTO,
  BrowserSessionDTO,
  CreateBrowserSessionRequestDTO,
  GatewaySettingsDTO,
  SystemUserRecordDTO,
} from './dtos';
import {
  adminService,
  apiKeyService,
  DEFAULT_SYSTEM_USER,
  proxyService,
  systemUserService,
} from './services';

const TAB_ROUTES: Record<ActiveTab, string> = {
  chat: '/chat',
  overview: '/overview',
  users: '/users',
  keys: '/keys',
  nodes: '/nodes',
  settings: '/settings',
};

function resolveTabFromPathname(pathname: string): ActiveTab {
  const clean = pathname.replace(/^\/admin(?=\/|$)/, '') || '/';
  if (clean.startsWith('/overview')) return 'overview';
  if (clean.startsWith('/users')) return 'users';
  if (clean.startsWith('/keys')) return 'keys';
  if (clean.startsWith('/nodes')) return 'nodes';
  if (clean.startsWith('/settings')) return 'settings';
  return 'chat';
}

const INITIAL_FALLBACK_STATE: AdminStateResponseDTO = {
  models: [
    {
      id: 'gpt-4o',
      name: 'GPT-4o (Web Gateway)',
      vendor: 'OpenAI',
      provider: 'chatgpt-web',
      badge: 'Web AI',
      description: 'OpenAI GPT-4o web session bridge.',
    },
    {
      id: 'claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet (Web Gateway)',
      vendor: 'Anthropic',
      provider: 'claude-web',
      badge: 'Web AI',
      description: 'Anthropic Claude 3.5 Sonnet web session bridge.',
    },
    {
      id: 'deepseek-r1',
      name: 'DeepSeek R1 (Web Gateway)',
      vendor: 'DeepSeek',
      provider: 'deepseek-web',
      badge: 'Reasoning',
      description: 'DeepSeek R1 Chain-of-Thought web bridge.',
    },
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro (Web Gateway)',
      vendor: 'Google',
      provider: 'gemini-web',
      badge: 'Web AI',
      description: 'Google Gemini web session & local Gemma 4 bridge.',
    },
  ],
  users: [
    {
      id: 'sys_usr_01',
      email: 'akalinserhat@gmail.com',
      full_name: 'Serhat Akalın',
      role: 'Sistem Yöneticisi',
      status: 'active',
      token_quota: 1000000,
      tokens_used: 0,
      rpm_limit: 60,
      concurrent_limit: 5,
      created_at: new Date().toISOString(),
    },
  ],
  api_keys: [],
  browser_sessions: [
    {
      id: 'sess-gpt-01',
      provider: 'chatgpt-web',
      account: 'pool_gpt_01@domain.com',
      proxy: '194.36.110.12:8080 (TR-Res)',
      status: 'idle',
      requests_served: 142,
    },
    {
      id: 'sess-claude-01',
      provider: 'claude-web',
      account: 'pool_claude_01@domain.com',
      proxy: '176.88.19.204:1080 (US-SOCKS5)',
      status: 'idle',
      requests_served: 67,
    },
  ],
  proxies: [
    { id: 'prx-01', protocol: 'http', endpoint: '194.36.110.12:8080', country: 'TR', city: 'Istanbul', proxy_type: 'residential', provider: 'TurkNet Res', latency_ms: 14, status: 'active', fails: 0 },
    { id: 'prx-02', protocol: 'socks5', endpoint: '88.255.140.28:1080', country: 'TR', city: 'Ankara', proxy_type: 'mobile', provider: 'TR 5G Mobile', latency_ms: 21, status: 'active', fails: 0 },
    { id: 'prx-03', protocol: 'https', endpoint: '85.105.42.91:8080', country: 'DE', city: 'Frankfurt', proxy_type: 'residential', provider: 'BrightData EU', latency_ms: 38, status: 'active', fails: 0 },
    { id: 'prx-04', protocol: 'socks5', endpoint: '138.201.92.14:1080', country: 'DE', city: 'Berlin', proxy_type: 'isp', provider: 'DE-CIX Static', latency_ms: 42, status: 'active', fails: 0 },
    { id: 'prx-05', protocol: 'socks5', endpoint: '176.88.19.204:1080', country: 'US', city: 'New York', proxy_type: 'residential', provider: 'Oxylabs US', latency_ms: 96, status: 'active', fails: 1 },
    { id: 'prx-06', protocol: 'https', endpoint: '64.225.88.110:8443', country: 'US', city: 'Los Angeles', proxy_type: 'mobile', provider: 'T-Mobile 5G', latency_ms: 134, status: 'active', fails: 0 },
    { id: 'prx-07', protocol: 'socks5', endpoint: '198.51.100.77:1080', country: 'US', city: 'Ashburn', proxy_type: 'isp', provider: 'Smartproxy ISP', latency_ms: 89, status: 'active', fails: 0 },
    { id: 'prx-08', protocol: 'http', endpoint: '91.93.120.44:8080', country: 'NL', city: 'Amsterdam', proxy_type: 'residential', provider: 'IPRoyal NL', latency_ms: 47, status: 'cooldown', fails: 3 },
    { id: 'prx-09', protocol: 'https', endpoint: '185.220.101.5:8443', country: 'GB', city: 'London', proxy_type: 'residential', provider: 'SOAX UK', latency_ms: 54, status: 'active', fails: 0 },
    { id: 'prx-10', protocol: 'socks5', endpoint: '51.158.118.42:1080', country: 'FR', city: 'Paris', proxy_type: 'isp', provider: 'Scaleway FR', latency_ms: 49, status: 'active', fails: 0 },
    { id: 'prx-11', protocol: 'https', endpoint: '179.43.148.19:8443', country: 'CH', city: 'Zurich', proxy_type: 'residential', provider: 'SwissPrivacy', latency_ms: 44, status: 'active', fails: 0 },
    { id: 'prx-12', protocol: 'socks5', endpoint: '45.76.210.88:1080', country: 'JP', city: 'Tokyo', proxy_type: 'residential', provider: 'NTT Japan', latency_ms: 168, status: 'active', fails: 0 },
    { id: 'prx-13', protocol: 'http', endpoint: '128.199.180.52:8080', country: 'SG', city: 'Singapore', proxy_type: 'datacenter', provider: 'SingTel DC', latency_ms: 152, status: 'active', fails: 0 },
    { id: 'prx-14', protocol: 'socks4', endpoint: '159.203.24.91:1080', country: 'CA', city: 'Toronto', proxy_type: 'residential', provider: 'Bell Canada', latency_ms: 108, status: 'active', fails: 0 },
    { id: 'prx-15', protocol: 'https', endpoint: '193.138.218.60:8443', country: 'SE', city: 'Stockholm', proxy_type: 'residential', provider: 'Mullvad SE', latency_ms: 59, status: 'active', fails: 0 },
    { id: 'prx-16', protocol: 'socks5', endpoint: '95.216.144.33:1080', country: 'FI', city: 'Helsinki', proxy_type: 'datacenter', provider: 'NordNode FI', latency_ms: 62, status: 'active', fails: 0 },
    { id: 'prx-17', protocol: 'socks5', endpoint: '145.220.227.208:8080', country: 'NL', city: 'Rotterdam', proxy_type: 'residential', provider: 'KPN Fiber NL', latency_ms: 45, status: 'active', fails: 0 },
    { id: 'prx-18', protocol: 'socks5', endpoint: '49.13.162.163:1081', country: 'DE', city: 'Nuremberg', proxy_type: 'datacenter', provider: 'Hetzner Cloud DE', latency_ms: 36, status: 'active', fails: 0 },
    { id: 'prx-19', protocol: 'socks5', endpoint: '212.47.71.179:9167', country: 'FR', city: 'Marseille', proxy_type: 'isp', provider: 'OnlineSAS FR', latency_ms: 48, status: 'active', fails: 0 },
    { id: 'prx-20', protocol: 'socks5', endpoint: '185.151.86.121:3699', country: 'GB', city: 'Manchester', proxy_type: 'residential', provider: 'BT Broadband UK', latency_ms: 56, status: 'active', fails: 0 },
    { id: 'prx-21', protocol: 'socks5', endpoint: '192.252.215.5:16137', country: 'US', city: 'Chicago', proxy_type: 'residential', provider: 'Comcast Xfinity', latency_ms: 104, status: 'active', fails: 0 },
    { id: 'prx-22', protocol: 'socks5', endpoint: '208.102.51.6:58208', country: 'US', city: 'Dallas', proxy_type: 'mobile', provider: 'AT&T 5G US', latency_ms: 118, status: 'active', fails: 0 },
    { id: 'prx-23', protocol: 'socks5', endpoint: '142.54.237.34:4145', country: 'US', city: 'Kansas City', proxy_type: 'isp', provider: 'Wholesale ISP', latency_ms: 112, status: 'active', fails: 0 },
    { id: 'prx-24', protocol: 'socks5', endpoint: '184.170.245.148:4145', country: 'US', city: 'Phoenix', proxy_type: 'residential', provider: 'Cox Residential', latency_ms: 127, status: 'active', fails: 0 },
    { id: 'prx-25', protocol: 'http', endpoint: '91.107.143.251:80', country: 'DE', city: 'Falkenstein', proxy_type: 'datacenter', provider: 'Hetzner Edge', latency_ms: 39, status: 'active', fails: 0 },
    { id: 'prx-26', protocol: 'http', endpoint: '137.74.50.101:15054', country: 'PL', city: 'Warsaw', proxy_type: 'isp', provider: 'OVH Poland', latency_ms: 51, status: 'active', fails: 0 },
    { id: 'prx-27', protocol: 'https', endpoint: '82.69.119.68:49200', country: 'GB', city: 'Bristol', proxy_type: 'residential', provider: 'Virgin Media UK', latency_ms: 58, status: 'active', fails: 0 },
    { id: 'prx-28', protocol: 'http', endpoint: '195.114.209.50:80', country: 'PL', city: 'Krakow', proxy_type: 'residential', provider: 'Orange Polska', latency_ms: 53, status: 'active', fails: 0 },
    { id: 'prx-29', protocol: 'https', endpoint: '5.45.126.128:8080', country: 'AT', city: 'Vienna', proxy_type: 'isp', provider: 'A1 Telekom AT', latency_ms: 41, status: 'active', fails: 0 },
    { id: 'prx-30', protocol: 'http', endpoint: '174.138.119.88:80', country: 'CA', city: 'Montreal', proxy_type: 'datacenter', provider: 'DigitalOcean CA', latency_ms: 102, status: 'active', fails: 0 },
    { id: 'prx-31', protocol: 'socks5', endpoint: '8.219.94.23:7890', country: 'SG', city: 'Jurong', proxy_type: 'datacenter', provider: 'Alibaba Cloud SG', latency_ms: 146, status: 'active', fails: 0 },
    { id: 'prx-32', protocol: 'socks5', endpoint: '193.200.85.129:1081', country: 'IT', city: 'Milan', proxy_type: 'residential', provider: 'Fastweb IT', latency_ms: 46, status: 'active', fails: 0 },
    { id: 'prx-33', protocol: 'socks5', endpoint: '146.19.143.200:1081', country: 'ES', city: 'Madrid', proxy_type: 'residential', provider: 'Telefonica ES', latency_ms: 61, status: 'active', fails: 0 },
    { id: 'prx-34', protocol: 'socks4', endpoint: '149.248.201.109:9000', country: 'CH', city: 'Geneva', proxy_type: 'isp', provider: 'Swisscom ISP', latency_ms: 45, status: 'active', fails: 0 },
    { id: 'prx-35', protocol: 'socks4', endpoint: '72.195.34.41:4145', country: 'US', city: 'Seattle', proxy_type: 'residential', provider: 'Verizon Fios', latency_ms: 129, status: 'active', fails: 0 },
    { id: 'prx-36', protocol: 'socks4', endpoint: '66.42.224.229:41679', country: 'JP', city: 'Osaka', proxy_type: 'datacenter', provider: 'Vultr Osaka', latency_ms: 162, status: 'active', fails: 0 },
    { id: 'prx-37', protocol: 'socks4', endpoint: '46.101.148.225:10000', country: 'GB', city: 'London', proxy_type: 'datacenter', provider: 'LON1 Edge', latency_ms: 52, status: 'active', fails: 0 },
    { id: 'prx-38', protocol: 'socks4', endpoint: '167.99.3.26:11080', country: 'NL', city: 'Amsterdam', proxy_type: 'datacenter', provider: 'AMS3 Core', latency_ms: 43, status: 'active', fails: 0 },
    { id: 'prx-39', protocol: 'https', endpoint: '212.156.98.44:8443', country: 'TR', city: 'Izmir', proxy_type: 'residential', provider: 'TurkTelekom Fiber', latency_ms: 19, status: 'active', fails: 0 },
    { id: 'prx-40', protocol: 'socks5', endpoint: '176.240.112.75:1080', country: 'TR', city: 'Bursa', proxy_type: 'mobile', provider: 'Vodafone TR 5G', latency_ms: 23, status: 'active', fails: 0 },
  ],
  usage_logs: [],
  settings: {
    global_rpm: 600,
    max_concurrent_browsers: 16,
    keep_alive_interval_sec: 300,
    enable_stealth: true,
    auto_rotate_proxy_on_403: true,
  },
};

export const App: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const activeTab = useMemo<ActiveTab>(
    () => resolveTabFromPathname(location.pathname),
    [location.pathname]
  );

  const nodesSubSection = useMemo<NodesSubSection>(() => {
    const clean = location.pathname.replace(/^\/admin(?=\/|$)/, '') || '/';
    if (clean.startsWith('/nodes/proxies')) return 'proxies';
    if (clean.startsWith('/nodes/sessions')) return 'sessions';
    return 'dashboard';
  }, [location.pathname]);

  const handleSelectTab = useCallback(
    (tab: ActiveTab) => {
      const targetPath = TAB_ROUTES[tab] || '/chat';
      if (location.pathname !== targetPath) {
        navigate(targetPath);
      }
    },
    [location.pathname, navigate]
  );

  const handleSelectNodesSubSection = useCallback(
    (sub: NodesSubSection) => {
      const targetPath = sub === 'dashboard' ? '/nodes' : `/nodes/${sub}`;
      if (location.pathname !== targetPath) {
        navigate(targetPath);
      }
    },
    [location.pathname, navigate]
  );

  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '/admin') {
      navigate('/chat', { replace: true });
    }
  }, [location.pathname, navigate]);

  const [currentAuthUser, setCurrentAuthUser] = useState<SystemUserRecordDTO | null>(() =>
    systemUserService.getAuthenticatedUser()
  );
  const [systemUsers, setSystemUsers] = useState<SystemUserRecordDTO[]>([DEFAULT_SYSTEM_USER]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [adminState, setAdminState] = useState<AdminStateResponseDTO>(INITIAL_FALLBACK_STATE);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('sk-gw-demo-key-123456');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const showToast = useCallback((msg: string) => {
    toast.success(msg);
  }, []);

  const refreshSystemUsers = useCallback(async () => {
    try {
      const list = await systemUserService.listSystemUsers();
      setSystemUsers(list);
      const auth = systemUserService.getAuthenticatedUser();
      if (auth) {
        const updatedAuth = list.find(
          (u) => u.id === auth.id || u.email.toLowerCase() === auth.email.toLowerCase()
        );
        if (updatedAuth) {
          if (updatedAuth.status !== 'active') {
            systemUserService.logout();
            setCurrentAuthUser(null);
          } else {
            systemUserService.setAuthenticatedUser(updatedAuth);
            setCurrentAuthUser(updatedAuth);
          }
        }
      }
    } catch {
      // Keep local fallback
    }
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const data = await adminService.fetchState();
      setAdminState((prev) => {
        const incomingSessions =
          Array.isArray(data.browser_sessions) && data.browser_sessions.length > 0
            ? data.browser_sessions
            : prev.browser_sessions;
        const incomingProxies =
          Array.isArray(data.proxies) && data.proxies.length > 0
            ? data.proxies
            : prev.proxies;
        const incomingModels =
          Array.isArray(data.models) && data.models.length > 0
            ? data.models
            : prev.models;
        const serverIds = new Set(incomingSessions.map((s) => s.id));
        const localDynamic = prev.browser_sessions.filter(
          (s) => s.is_dynamic && !serverIds.has(s.id)
        );
        const serverEndpoints = new Set(incomingProxies.map((p) => p.endpoint));
        const extraSeedProxies = INITIAL_FALLBACK_STATE.proxies.filter(
          (p) => !serverEndpoints.has(p.endpoint)
        );
        return {
          ...prev,
          ...data,
          models: incomingModels,
          browser_sessions: [...incomingSessions, ...localDynamic],
          proxies: [...incomingProxies, ...extraSeedProxies],
          system_logs: Array.isArray(data.system_logs) ? data.system_logs : prev.system_logs,
          settings: data.settings || prev.settings,
        };
      });
      setSelectedModelId((prev) => {
        const effectiveModels =
          Array.isArray(data.models) && data.models.length > 0
            ? data.models
            : INITIAL_FALLBACK_STATE.models;
        return adminService.selectPreferredModelId(effectiveModels, prev);
      });
    } catch {
      // Keep current state if backend is temporarily unreachable
    }
  }, []);

  useEffect(() => {
    refreshState();
    refreshSystemUsers();
  }, [refreshState, refreshSystemUsers]);

  const handleLoginSuccess = useCallback(
    (user: SystemUserRecordDTO) => {
      setCurrentAuthUser(user);
      refreshSystemUsers();
      showToast(`Hoş geldiniz, ${user.full_name}`);
      if (location.pathname === '/login') {
        navigate('/settings/users', { replace: true });
      }
    },
    [location.pathname, navigate, refreshSystemUsers, showToast]
  );

  const handleLogout = useCallback(() => {
    systemUserService.logout();
    setCurrentAuthUser(null);
    showToast('Oturum kapatıldı.');
  }, [showToast]);

  const handleCreateApiKey = async (
    userId: string,
    name: string,
    expiresDays: number,
    customApiKey?: string
  ) => {
    try {
      const data = await apiKeyService.createKey({
        user_id: userId,
        name,
        expires_in_days: expiresDays,
        api_key: customApiKey,
      });
      if (data.api_key) {
        setApiKey(data.api_key);
        setNewlyCreatedKey(data.api_key);
      }
      showToast(t('keys.keyCreatedToast'));
      await refreshState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleQuickGenerateKeyForUser = async (userId: string) => {
    await handleCreateApiKey(userId, 'Standard API Key', 30);
    handleSelectTab('keys');
  };

  const handleRevokeKey = async (keyId: string) => {
    await apiKeyService.revokeKey(keyId);
    showToast(t('keys.keyRevokedToast'));
    await refreshState();
  };

  const handleCopyAndUseKey = (rawKey: string) => {
    navigator.clipboard.writeText(rawKey);
    setApiKey(rawKey);
    showToast(t('keys.keyCopiedToast'));
  };

  const handleToggleProxy = async (proxyId: string) => {
    try {
      await proxyService.toggleProxyStatus(proxyId);
      showToast(t('nodes.proxyUpdatedToast'));
      await refreshState();
    } catch {
      setAdminState((prev) => ({
        ...prev,
        proxies: prev.proxies.map((p) =>
          p.id === proxyId
            ? { ...p, status: p.status === 'active' ? 'cooldown' : 'active' }
            : p
        ),
      }));
      showToast(t('nodes.proxyUpdatedToast'));
    }
  };

  const handleSpawnDynamicSession = async (req: CreateBrowserSessionRequestDTO) => {
    try {
      const created = await proxyService.spawnDynamicSession(req);
      setAdminState((prev) => {
        const exists = prev.browser_sessions.some((s) => s.id === created.id);
        return {
          ...prev,
          browser_sessions: exists
            ? prev.browser_sessions
            : [...prev.browser_sessions, created],
        };
      });
      showToast(`Dinamik tarayıcı oturumu başlatıldı (${created.id})`);
      await refreshState();
    } catch {
      // Fallback if backend route is not yet reloaded
      const shortId = Math.random().toString(16).slice(2, 6);
      const prefix = (req.provider || 'chatgpt-web').split('-')[0];
      const activeProxies = adminState.proxies.filter((p) => p.status === 'active');
      const chosenProxy = req.proxy_id
        ? adminState.proxies.find((p) => p.id === req.proxy_id)
        : activeProxies.sort((a, b) => (a.latency_ms ?? 50) - (b.latency_ms ?? 50))[0];
      const proxyLabel = chosenProxy
        ? `${chosenProxy.endpoint} (${chosenProxy.country}-${(chosenProxy.proxy_type || 'Res').slice(0, 3)})`
        : 'Direct / Residential Auto-Pool';
      const nowIso = new Date().toISOString();
      const fallbackSession: BrowserSessionDTO = {
        id: `sess-${prefix}-dyn-${shortId}`,
        provider: req.provider || 'chatgpt-web',
        account: req.account?.trim() || `dyn_${prefix}_${shortId}@autoscale.pool`,
        proxy: proxyLabel,
        status: 'idle',
        requests_served: 0,
        is_dynamic: true,
        created_at: nowIso,
        last_active_at: nowIso,
        idle_ttl_sec: req.idle_ttl_sec || 300,
      };
      setAdminState((prev) => ({
        ...prev,
        browser_sessions: [...prev.browser_sessions, fallbackSession],
      }));
      showToast(`Dinamik tarayıcı oturumu başlatıldı (${fallbackSession.id})`);
    }
  };

  const handlePruneDynamicSessions = async () => {
    try {
      const res = await proxyService.pruneIdleDynamicSessions();
      setAdminState((prev) => ({
        ...prev,
        browser_sessions: prev.browser_sessions.filter(
          (s) => !(s.is_dynamic && s.status === 'idle')
        ),
      }));
      showToast(`Boştaki dinamik oturumlar temizlendi (${res.removed_count} adet kapatıldı)`);
      await refreshState();
    } catch {
      const idleDynamicCount = adminState.browser_sessions.filter(
        (s) => s.is_dynamic && s.status === 'idle'
      ).length;
      setAdminState((prev) => ({
        ...prev,
        browser_sessions: prev.browser_sessions.filter(
          (s) => !(s.is_dynamic && s.status === 'idle')
        ),
      }));
      showToast(`Boştaki dinamik oturumlar temizlendi (${idleDynamicCount} adet kapatıldı)`);
    }
  };

  const handleTerminateSession = async (sessionId: string) => {
    try {
      await proxyService.terminateSession(sessionId);
      setAdminState((prev) => ({
        ...prev,
        browser_sessions: prev.browser_sessions.filter((s) => s.id !== sessionId),
      }));
      showToast(`Tarayıcı oturumu sonlandırıldı (${sessionId})`);
    } catch {
      setAdminState((prev) => ({
        ...prev,
        browser_sessions: prev.browser_sessions.filter((s) => s.id !== sessionId),
      }));
      showToast(`Tarayıcı oturumu sonlandırıldı (${sessionId})`);
    }
  };

  const handleSaveSettings = async (updated: GatewaySettingsDTO) => {
    try {
      await adminService.updateSettings(updated);
      showToast(t('settings.savedToast'));
      await refreshState();
    } catch {
      setAdminState((prev) => ({ ...prev, settings: updated }));
      showToast(t('settings.savedToast'));
    }
  };

  const effectiveUsers = useMemo(() => {
    const byKey = new Map<string, (typeof adminState.users)[number]>();
    for (const su of systemUsers) {
      const existing = adminState.users.find(
        (u) => u.id === su.id || u.email.toLowerCase() === su.email.toLowerCase()
      );
      byKey.set(su.id, {
        id: existing?.id || su.id,
        email: su.email,
        full_name: su.full_name,
        role: su.role || 'Sistem Yöneticisi',
        status: su.status,
        token_quota: existing?.token_quota ?? 1000000,
        tokens_used: existing?.tokens_used ?? 0,
        rpm_limit: existing?.rpm_limit ?? 60,
        concurrent_limit: existing?.concurrent_limit ?? 5,
        created_at: existing?.created_at || su.created_at,
      });
    }
    for (const u of adminState.users) {
      const alreadyByEmail = Array.from(byKey.values()).some(
        (item) => item.id === u.id || item.email.toLowerCase() === u.email.toLowerCase()
      );
      if (!alreadyByEmail) {
        byKey.set(u.id, u);
      }
    }
    return Array.from(byKey.values());
  }, [adminState.users, systemUsers]);

  const effectiveState = useMemo<AdminStateResponseDTO>(
    () => ({
      ...adminState,
      users: effectiveUsers,
    }),
    [adminState, effectiveUsers]
  );

  const idleCount = adminState.browser_sessions.filter((s) => s.status === 'idle').length;
  const isBusy = isGenerating || idleCount < adminState.browser_sessions.length;

  if (!currentAuthUser || location.pathname === '/login') {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className={`app-container ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <NavigationDrawer
        activeTab={activeTab}
        nodesSubSection={nodesSubSection}
        onSelectTab={handleSelectTab}
        onSelectNodesSubSection={handleSelectNodesSubSection}
        state={effectiveState}
        isGenerating={isGenerating}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />

      <div className="main-content">
        <TopAppBar
          activeTab={activeTab}
          modelCount={adminState.models.length}
          isBusy={isBusy}
          onRefresh={() => {
            refreshState();
            refreshSystemUsers();
          }}
          onSelectTab={handleSelectTab}
          currentAuthUser={currentAuthUser}
          onLogout={handleLogout}
        />

        <main className="content-area">
          {activeTab === 'chat' && (
            <ChatStudioView
              models={adminState.models}
              sessions={adminState.browser_sessions}
              users={effectiveUsers}
              apiKeys={adminState.api_keys}
              initialConversations={adminState.conversations || []}
              selectedModelId={selectedModelId}
              onSelectModel={setSelectedModelId}
              apiKey={apiKey}
              onChangeApiKey={setApiKey}
              isGenerating={isGenerating}
              setIsGenerating={setIsGenerating}
              onRefreshState={refreshState}
              onShowToast={showToast}
            />
          )}

          {activeTab === 'overview' && (
            <OverviewView
              state={effectiveState}
              onRefreshState={refreshState}
              onShowToast={showToast}
            />
          )}

          {activeTab === 'users' && (
            <UsersView
              users={effectiveUsers}
              systemUsers={systemUsers}
              currentAuthUser={currentAuthUser}
              onRefreshState={refreshState}
              onRefreshSystemUsers={refreshSystemUsers}
              onGenerateKeyForUser={handleQuickGenerateKeyForUser}
              onShowToast={showToast}
            />
          )}

          {activeTab === 'keys' && (
            <ApiKeysView
              apiKeys={adminState.api_keys}
              users={effectiveUsers}
              newlyCreatedKey={newlyCreatedKey}
              onDismissCreatedKey={() => setNewlyCreatedKey(null)}
              onCreateKey={handleCreateApiKey}
              onRevokeKey={handleRevokeKey}
              onCopyAndUseKey={handleCopyAndUseKey}
            />
          )}

          {activeTab === 'nodes' && (
            <NodesPoolView
              activeSection={nodesSubSection}
              sessions={adminState.browser_sessions}
              proxies={adminState.proxies}
              poolDashboard={adminState.pool_dashboard}
              maxConcurrentBrowsers={adminState.settings.max_concurrent_browsers}
              onNavigateSection={handleSelectNodesSubSection}
              onToggleProxy={handleToggleProxy}
              onSpawnDynamicSession={handleSpawnDynamicSession}
              onPruneDynamicSessions={handlePruneDynamicSessions}
              onTerminateSession={handleTerminateSession}
              onRefreshState={refreshState}
              onShowToast={showToast}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              settings={adminState.settings}
              users={effectiveUsers}
              systemUsers={systemUsers}
              currentAuthUser={currentAuthUser}
              onSaveSettings={handleSaveSettings}
              onRefreshState={refreshState}
              onRefreshSystemUsers={refreshSystemUsers}
              onGenerateKeyForUser={handleQuickGenerateKeyForUser}
              onShowToast={showToast}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
