import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  CloudDownload,
  Globe,
  MonitorCheck,
  Plus,
  RefreshCw,
  Server,
  ServerCog,
  ShieldCheck,
  Trash2,
  Wifi,
  Zap,
} from 'lucide-react';
import {
  BaseButton,
  BaseInput,
  BasePage,
  BasePopup,
  BaseSystemCard,
  DashboardActivityFeedView,
  DashboardDistributionView,
  DashboardStatCard,
  DashboardTimelineChartView,
  TabLayout,
  useAlertDialog,
  type DashboardActivityEvent,
  type DashboardDistributionItem,
} from '@akalin/ui';
import {
  useGlobalSearch,
  useSearchFieldsRegister,
  type SearchType,
} from '@akalin/global_search_module';
import {
  BrowserSessionDTO,
  CreateBrowserSessionRequestDTO,
  PoolDashboardMetricsDTO,
  ProxyNodeDTO,
} from '../dtos';
import { proxyService } from '../services';

interface NodesPoolViewProps {
  activeSection?: 'dashboard' | 'sessions' | 'proxies';
  sessions: BrowserSessionDTO[];
  proxies: ProxyNodeDTO[];
  poolDashboard?: PoolDashboardMetricsDTO;
  maxConcurrentBrowsers?: number;
  onNavigateSection?: (sub: 'dashboard' | 'sessions' | 'proxies') => void;
  onToggleProxy: (proxyId: string) => Promise<void>;
  onSpawnDynamicSession?: (req: CreateBrowserSessionRequestDTO) => Promise<void>;
  onPruneDynamicSessions?: () => Promise<void>;
  onTerminateSession?: (sessionId: string) => Promise<void>;
  onRefreshState: () => Promise<void>;
  onShowToast: (msg: string) => void;
}

function resolveProtocolFilterParam(selectedIds: string[]): string {
  if (selectedIds.includes('proto:socks5')) return 'socks5';
  if (selectedIds.includes('proto:socks4')) return 'socks4';
  if (selectedIds.includes('proto:http')) return 'http';
  return 'all';
}

export const NodesPoolView: React.FC<NodesPoolViewProps> = ({
  activeSection = 'dashboard',
  sessions,
  proxies,
  poolDashboard,
  maxConcurrentBrowsers = 16,
  onNavigateSection,
  onToggleProxy,
  onSpawnDynamicSession,
  onPruneDynamicSessions,
  onTerminateSession,
  onRefreshState,
  onShowToast,
}) => {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const { state: globalSearchState, activeSearchType, selectedFilterTypes } = useGlobalSearch();

  const [isFetchingFree, setIsFetchingFree] = useState(false);
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [checkingProxyId, setCheckingProxyId] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTabId, setModalTabId] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);

  const [isSpawnModalOpen, setIsSpawnModalOpen] = useState(false);
  const [spawningSession, setSpawningSession] = useState(false);
  const [pruningSessions, setPruningSessions] = useState(false);
  const [spawnProvider, setSpawnProvider] = useState('chatgpt-web');
  const [spawnAccount, setSpawnAccount] = useState('');
  const [spawnProxyId, setSpawnProxyId] = useState('');
  const [spawnIdleTtl, setSpawnIdleTtl] = useState('300');

  const [protocol, setProtocol] = useState('socks5');
  const [endpoint, setEndpoint] = useState('');
  const [country, setCountry] = useState('TR');
  const [city, setCity] = useState('Istanbul');
  const [proxyType, setProxyType] = useState('residential');
  const [provider, setProvider] = useState('Custom Residential');

  const [bulkList, setBulkList] = useState('');
  const [bulkProtocol, setBulkProtocol] = useState('socks5');
  const [bulkCountry, setBulkCountry] = useState('EU');
  const [bulkType, setBulkType] = useState('residential');

  const warmSessionCount = useMemo(
    () => sessions.filter((s) => !s.is_dynamic).length,
    [sessions]
  );

  const dynamicSessionCount = useMemo(
    () => sessions.filter((s) => Boolean(s.is_dynamic)).length,
    [sessions]
  );

  const idleDynamicCount = useMemo(
    () => sessions.filter((s) => Boolean(s.is_dynamic) && s.status === 'idle').length,
    [sessions]
  );

  const nodesSearchFields = useMemo<SearchType[]>(() => {
    if (activeSection === 'sessions') {
      return [
        {
          id: 'Tumu',
          label: 'Genel',
          iconName: 'Search',
          type: 'text',
          placeholder: 'Oturum ID, sağlayıcı, hesap veya proxy ara...',
        },
        {
          id: 'provider',
          label: 'Sağlayıcı',
          iconName: 'Cloud',
          type: 'text',
          placeholder: 'Sağlayıcı adı ile ara (chatgpt-web, claude-web...)',
        },
        {
          id: 'account',
          label: 'Hesap',
          iconName: 'Users',
          type: 'text',
          placeholder: 'Hesap etiketi ile ara...',
        },
        {
          id: 'proxy',
          label: 'Atanan Proxy',
          iconName: 'Layers',
          type: 'text',
          placeholder: 'Atanan proxy ile ara...',
        },
        {
          id: 'session_mode',
          label: 'Oturum Modu',
          iconName: 'Filter',
          type: 'enum',
          isEnum: true,
          category: 'filter',
          options: [
            { id: 'mode:warm', label: 'Sabit (Warm)' },
            { id: 'mode:dynamic', label: 'Dinamik (Auto-Scale)' },
          ],
        },
        {
          id: 'session_status',
          label: 'Oturum Durumu',
          iconName: 'CheckCircle',
          type: 'enum',
          isEnum: true,
          category: 'filter',
          options: [
            { id: 'status:idle', label: t('status.idle') },
            { id: 'status:busy', label: t('status.busy') },
          ],
        },
      ];
    }

    return [
      {
        id: 'Tumu',
        label: 'Genel',
        iconName: 'Search',
        type: 'text',
        placeholder: t('nodes.searchPlaceholder'),
      },
      {
        id: 'endpoint',
        label: 'Sunucu Adresi',
        iconName: 'Hash',
        type: 'text',
        placeholder: 'IP:Port adresi ile ara...',
      },
      {
        id: 'country',
        label: 'Ülke / Şehir',
        iconName: 'MapPin',
        type: 'text',
        placeholder: 'Ülke kodu veya şehir ile ara...',
      },
      {
        id: 'provider',
        label: 'Sağlayıcı',
        iconName: 'Building2',
        type: 'text',
        placeholder: 'Sağlayıcı veya etiket ile ara...',
      },
      {
        id: 'protocol_filter',
        label: t('nodes.fieldProtocol'),
        iconName: 'Filter',
        type: 'enum',
        isEnum: true,
        category: 'filter',
        options: [
          { id: 'proto:http', label: t('nodes.filterHttp') },
          { id: 'proto:socks5', label: t('nodes.filterSocks5') },
          { id: 'proto:socks4', label: t('nodes.filterSocks4') },
        ],
      },
      {
        id: 'proxy_type_filter',
        label: t('nodes.fieldType'),
        iconName: 'Layers',
        type: 'enum',
        isEnum: true,
        category: 'filter',
        options: [
          { id: 'type:residential', label: t('nodes.typeResidential') },
          { id: 'type:mobile', label: t('nodes.typeMobile') },
          { id: 'type:isp', label: t('nodes.typeIsp') },
          { id: 'type:datacenter', label: t('nodes.typeDatacenter') },
        ],
      },
      {
        id: 'proxy_status_filter',
        label: 'Düğüm Durumu',
        iconName: 'CheckCircle',
        type: 'enum',
        isEnum: true,
        category: 'filter',
        options: [
          { id: 'status:active', label: t('status.active') },
          { id: 'status:cooldown', label: t('status.cooldown') },
        ],
      },
    ];
  }, [activeSection, t]);

  useSearchFieldsRegister(nodesSearchFields);

  const filteredSessions = useMemo(() => {
    const q = (globalSearchState.searchTerm || '').trim().toLowerCase();
    const activeField = activeSearchType?.id || 'Tumu';
    const selectedIds = selectedFilterTypes.map((f) => f.id);
    const modeFilters = selectedIds.filter((id) => id.startsWith('mode:'));
    const statusFilters = selectedIds.filter((id) => id.startsWith('status:'));

    return sessions.filter((s) => {
      if (modeFilters.length > 0) {
        const isDyn = Boolean(s.is_dynamic);
        const matchMode =
          (modeFilters.includes('mode:dynamic') && isDyn) ||
          (modeFilters.includes('mode:warm') && !isDyn);
        if (!matchMode) return false;
      }
      if (statusFilters.length > 0) {
        const isIdle = s.status === 'idle';
        const matchStatus =
          (statusFilters.includes('status:idle') && isIdle) ||
          (statusFilters.includes('status:busy') && !isIdle);
        if (!matchStatus) return false;
      }
      if (!q) return true;
      if (activeField === 'provider') return (s.provider || '').toLowerCase().includes(q);
      if (activeField === 'account') return (s.account || '').toLowerCase().includes(q);
      if (activeField === 'proxy') return (s.proxy || '').toLowerCase().includes(q);
      return (
        (s.id || '').toLowerCase().includes(q) ||
        (s.provider || '').toLowerCase().includes(q) ||
        (s.account || '').toLowerCase().includes(q) ||
        (s.proxy || '').toLowerCase().includes(q)
      );
    });
  }, [sessions, globalSearchState.searchTerm, activeSearchType, selectedFilterTypes]);

  const filteredProxies = useMemo(() => {
    const q = (globalSearchState.searchTerm || '').trim().toLowerCase();
    const activeField = activeSearchType?.id || 'Tumu';
    const selectedIds = selectedFilterTypes.map((f) => f.id);
    const protoFilters = selectedIds.filter((id) => id.startsWith('proto:'));
    const typeFilters = selectedIds.filter((id) => id.startsWith('type:'));
    const statusFilters = selectedIds.filter((id) => id.startsWith('status:'));

    return proxies.filter((p) => {
      const proto = (p.protocol || '').toLowerCase();
      const ptype = (p.proxy_type || 'residential').toLowerCase();

      if (protoFilters.length > 0) {
        const matchProto =
          (protoFilters.includes('proto:http') && (proto === 'http' || proto === 'https')) ||
          (protoFilters.includes('proto:socks5') && proto === 'socks5') ||
          (protoFilters.includes('proto:socks4') && proto === 'socks4');
        if (!matchProto) return false;
      }

      if (typeFilters.length > 0) {
        if (!typeFilters.includes(`type:${ptype}`)) return false;
      }

      if (statusFilters.length > 0) {
        const isActive = p.status === 'active';
        const matchStatus =
          (statusFilters.includes('status:active') && isActive) ||
          (statusFilters.includes('status:cooldown') && !isActive);
        if (!matchStatus) return false;
      }

      if (!q) return true;
      if (activeField === 'endpoint') return p.endpoint.toLowerCase().includes(q);
      if (activeField === 'country') {
        return (
          p.country.toLowerCase().includes(q) ||
          (p.city || '').toLowerCase().includes(q)
        );
      }
      if (activeField === 'provider') return (p.provider || '').toLowerCase().includes(q);

      return (
        p.endpoint.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q) ||
        (p.city || '').toLowerCase().includes(q) ||
        (p.provider || '').toLowerCase().includes(q) ||
        proto.includes(q)
      );
    });
  }, [proxies, globalSearchState.searchTerm, activeSearchType, selectedFilterTypes]);

  const activeCount = useMemo(
    () => proxies.filter((p) => p.status === 'active').length,
    [proxies]
  );

  const avgLatency = useMemo(() => {
    const withLatency = proxies.filter((p) => typeof p.latency_ms === 'number');
    if (withLatency.length === 0) return 48;
    const sum = withLatency.reduce((acc, p) => acc + (p.latency_ms || 50), 0);
    return Math.round(sum / withLatency.length);
  }, [proxies]);

  const getProxyTypeLabel = (type?: string) => {
    switch ((type || 'residential').toLowerCase()) {
      case 'mobile':
        return t('nodes.typeMobile');
      case 'isp':
        return t('nodes.typeIsp');
      case 'datacenter':
        return t('nodes.typeDatacenter');
      default:
        return t('nodes.typeResidential');
    }
  };

  const handleFetchFreeProxies = async () => {
    setIsFetchingFree(true);
    try {
      const selectedIds = selectedFilterTypes.map((f) => f.id);
      const data = await proxyService.fetchFreeProxies({
        protocol: resolveProtocolFilterParam(selectedIds),
        limit: 6,
      });
      onShowToast(t('nodes.proxyFetchedToast', { count: data.added_count || 6 }));
      await onRefreshState();
    } finally {
      setIsFetchingFree(false);
    }
  };

  const handleCheckAllProxies = async () => {
    setIsCheckingAll(true);
    try {
      await proxyService.checkAllProxies();
      onShowToast(t('nodes.proxyCheckedToast'));
      await onRefreshState();
    } finally {
      setIsCheckingAll(false);
    }
  };

  const handleCheckSingleProxy = async (proxyId: string) => {
    setCheckingProxyId(proxyId);
    try {
      await proxyService.checkSingleProxy(proxyId);
      onShowToast(t('nodes.proxyCheckedToast'));
      await onRefreshState();
    } finally {
      setCheckingProxyId(null);
    }
  };

  const handleDeleteProxy = (proxy: ProxyNodeDTO) => {
    const doDelete = async () => {
      await proxyService.deleteProxy(proxy.id);
      onShowToast(t('nodes.proxyDeletedToast'));
      await onRefreshState();
    };
    showAlert(
      'confirm',
      t('nodes.deleteProxy'),
      `${proxy.endpoint} (${proxy.country}) proxy düğümünü silmek istediğinize emin misiniz?`,
      doDelete
    );
  };

  const handleSaveModal = async () => {
    setSubmitting(true);
    try {
      if (modalTabId === 1) {
        if (!endpoint.trim()) return;
        await proxyService.createProxy({
          protocol,
          endpoint: endpoint.trim(),
          country: country.trim() || 'TR',
          city: city.trim() || 'Istanbul',
          proxy_type: proxyType,
          provider: provider.trim() || 'Custom Node',
        });
        setEndpoint('');
        setIsModalOpen(false);
        onShowToast(t('nodes.proxyAddedToast'));
        await onRefreshState();
      } else {
        if (!bulkList.trim()) return;
        const data = await proxyService.bulkImport({
          raw_list: bulkList,
          default_protocol: bulkProtocol,
          default_country: bulkCountry,
          default_type: bulkType,
          default_provider: 'Bulk Pool',
        });
        setBulkList('');
        setIsModalOpen(false);
        onShowToast(t('nodes.proxyBulkToast', { count: data.added_count || 0 }));
        await onRefreshState();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const [sqliteTelemetry, setSqliteTelemetry] = useState<{
    timeline: PoolDashboardMetricsDTO['timeline'];
    scaling_events: PoolDashboardMetricsDTO['scaling_events'];
  } | null>(null);

  const loadSqlitePoolDashboard = useCallback(async () => {
    try {
      const data = await proxyService.getDashboardMetrics();
      if (data && (data.timeline?.length || data.scaling_events?.length)) {
        setSqliteTelemetry({
          timeline: data.timeline || [],
          scaling_events: data.scaling_events || [],
        });
      }
    } catch {
      // Fallback to prop or computed defaults
    }
  }, []);

  useEffect(() => {
    loadSqlitePoolDashboard();
  }, [loadSqlitePoolDashboard]);

  const busySessionCount = useMemo(
    () => sessions.filter((s) => s.status !== 'idle').length,
    [sessions]
  );

  const totalRequestsServed = useMemo(
    () => sessions.reduce((acc, s) => acc + (s.requests_served || 0), 0),
    [sessions]
  );

  const utilizationPct = useMemo(
    () => Math.round((sessions.length / Math.max(1, maxConcurrentBrowsers)) * 100),
    [sessions.length, maxConcurrentBrowsers]
  );

  const handleSpawnSessionModal = async () => {
    if (!onSpawnDynamicSession) return;
    setSpawningSession(true);
    try {
      const ttlNum = Math.max(30, parseInt(spawnIdleTtl, 10) || 300);
      await onSpawnDynamicSession({
        provider: spawnProvider,
        account: spawnAccount.trim() || undefined,
        proxy_id: spawnProxyId || undefined,
        idle_ttl_sec: ttlNum,
      });
      try {
        const nextTotal = sessions.length + 1;
        const nextDynamic = dynamicSessionCount + 1;
        const updated = await proxyService.recordPoolEvent({
          event_type: 'scale_up',
          provider: spawnProvider,
          proxy_id: spawnProxyId || proxies[0]?.id || 'px-01',
          reason: `${spawnProvider} için yeni dinamik tarayıcı oturumu (TTL: ${ttlNum}sn) başlatıldı`,
          total_sessions_after: nextTotal,
          dynamic_sessions_after: nextDynamic,
          warm_sessions_after: warmSessionCount,
          busy_sessions_after: busySessionCount,
          max_capacity: maxConcurrentBrowsers,
          active_proxies: activeCount,
          cooldown_proxies: proxies.length - activeCount,
          avg_proxy_latency_ms: avgLatency,
        });
        if (updated?.timeline) {
          setSqliteTelemetry(updated);
        }
      } catch {
        // Ignore bridge error
      }
      setSpawnAccount('');
      setSpawnProxyId('');
      setIsSpawnModalOpen(false);
    } finally {
      setSpawningSession(false);
    }
  };

  const handlePruneDynamic = async () => {
    if (!onPruneDynamicSessions) return;
    setPruningSessions(true);
    try {
      const prunedCount = idleDynamicCount;
      await onPruneDynamicSessions();
      try {
        const nextTotal = Math.max(warmSessionCount, sessions.length - prunedCount);
        const nextDynamic = Math.max(0, dynamicSessionCount - prunedCount);
        const updated = await proxyService.recordPoolEvent({
          event_type: 'scale_down',
          provider: 'pool-gc',
          reason: `Boşta (idle) bekleyen ${prunedCount} dinamik tarayıcı oturumu otomatik temizlendi (Scale-Down)`,
          total_sessions_after: nextTotal,
          dynamic_sessions_after: nextDynamic,
          warm_sessions_after: warmSessionCount,
          busy_sessions_after: busySessionCount,
          max_capacity: maxConcurrentBrowsers,
          active_proxies: activeCount,
          cooldown_proxies: proxies.length - activeCount,
          avg_proxy_latency_ms: avgLatency,
        });
        if (updated?.timeline) {
          setSqliteTelemetry(updated);
        }
      } catch {
        // Ignore bridge error
      }
    } finally {
      setPruningSessions(false);
    }
  };

  const handleConfirmTerminateSession = (session: BrowserSessionDTO) => {
    if (!onTerminateSession) return;
    showAlert(
      'confirm',
      'Tarayıcı Oturumunu Sonlandır',
      `${session.id} (${session.provider}) tarayıcı oturumunu kapatıp havuzdan kaldırmak istediğinize emin misiniz?`,
      async () => {
        await onTerminateSession(session.id);
        try {
          const nextTotal = Math.max(0, sessions.length - 1);
          const nextDynamic = session.is_dynamic
            ? Math.max(0, dynamicSessionCount - 1)
            : dynamicSessionCount;
          const nextWarm = !session.is_dynamic
            ? Math.max(0, warmSessionCount - 1)
            : warmSessionCount;
          const updated = await proxyService.recordPoolEvent({
            event_type: 'scale_down',
            provider: session.provider,
            session_id: session.id,
            proxy_id: session.proxy,
            reason: `${session.id} (${session.provider}) tarayıcı oturumu yönetici tarafından sonlandırıldı`,
            total_sessions_after: nextTotal,
            dynamic_sessions_after: nextDynamic,
            warm_sessions_after: nextWarm,
            busy_sessions_after: busySessionCount,
            max_capacity: maxConcurrentBrowsers,
            active_proxies: activeCount,
            cooldown_proxies: proxies.length - activeCount,
            avg_proxy_latency_ms: avgLatency,
          });
          if (updated?.timeline) {
            setSqliteTelemetry(updated);
          }
        } catch {
          // Ignore bridge error
        }
      }
    );
  };

  const isDashboardView = activeSection === 'dashboard';
  const isSessionsView = activeSection === 'sessions';
  const isProxiesView = activeSection === 'proxies';

  const timelinePoints = useMemo(() => {
    const baseTimeline =
      sqliteTelemetry?.timeline?.length
        ? sqliteTelemetry.timeline
        : poolDashboard?.timeline?.length
          ? poolDashboard.timeline
          : [
              { id: '1', time_label: '19:35', total_sessions: 9, active_busy_sessions: 2, idle_sessions: 7, warm_sessions: 9, dynamic_sessions: 0, max_capacity: maxConcurrentBrowsers, active_proxies: activeCount, cooldown_proxies: proxies.length - activeCount, avg_proxy_latency_ms: 74, requests_per_min: 18, timestamp_iso: '' },
              { id: '2', time_label: '19:45', total_sessions: 11, active_busy_sessions: 6, idle_sessions: 5, warm_sessions: 9, dynamic_sessions: 2, max_capacity: maxConcurrentBrowsers, active_proxies: activeCount, cooldown_proxies: proxies.length - activeCount, avg_proxy_latency_ms: 78, requests_per_min: 42, timestamp_iso: '' },
              { id: '3', time_label: '19:55', total_sessions: 14, active_busy_sessions: 10, idle_sessions: 4, warm_sessions: 9, dynamic_sessions: 5, max_capacity: maxConcurrentBrowsers, active_proxies: activeCount, cooldown_proxies: proxies.length - activeCount, avg_proxy_latency_ms: 84, requests_per_min: 61, timestamp_iso: '' },
              { id: '4', time_label: '20:05', total_sessions: 12, active_busy_sessions: 7, idle_sessions: 5, warm_sessions: 9, dynamic_sessions: 3, max_capacity: maxConcurrentBrowsers, active_proxies: activeCount, cooldown_proxies: proxies.length - activeCount, avg_proxy_latency_ms: 76, requests_per_min: 45, timestamp_iso: '' },
              { id: '5', time_label: '20:15', total_sessions: 10, active_busy_sessions: 4, idle_sessions: 6, warm_sessions: 9, dynamic_sessions: 1, max_capacity: maxConcurrentBrowsers, active_proxies: activeCount, cooldown_proxies: proxies.length - activeCount, avg_proxy_latency_ms: 73, requests_per_min: 30, timestamp_iso: '' },
            ];

    const livePoint = {
      id: 'live-now',
      time_label: 'Şimdi',
      total_sessions: sessions.length,
      active_busy_sessions: busySessionCount,
      idle_sessions: Math.max(0, sessions.length - busySessionCount),
      warm_sessions: warmSessionCount,
      dynamic_sessions: dynamicSessionCount,
      max_capacity: maxConcurrentBrowsers,
      active_proxies: activeCount,
      cooldown_proxies: Math.max(0, proxies.length - activeCount),
      avg_proxy_latency_ms: avgLatency,
      requests_per_min: Math.max(12, busySessionCount * 7 + sessions.length * 2),
      timestamp_iso: new Date().toISOString(),
    };

    return [...baseTimeline.slice(-11), livePoint];
  }, [
    sqliteTelemetry,
    poolDashboard,
    maxConcurrentBrowsers,
    activeCount,
    proxies.length,
    sessions.length,
    busySessionCount,
    warmSessionCount,
    dynamicSessionCount,
    avgLatency,
  ]);

  const providerDistributionItems = useMemo<DashboardDistributionItem[]>(() => {
    const providerColors: Record<
      string,
      'primary' | 'success' | 'warning' | 'danger' | 'info'
    > = {
      'chatgpt-web': 'success',
      'claude-web': 'warning',
      'deepseek-web': 'info',
      'gemini-web': 'primary',
      'pollinations-image': 'danger',
    };

    const grouped: Record<
      string,
      {
        total: number;
        busy: number;
        idle: number;
        warm: number;
        dynamic: number;
        requests: number;
      }
    > = {};

    sessions.forEach((s) => {
      const prov = s.provider || 'chatgpt-web';
      if (!grouped[prov]) {
        grouped[prov] = { total: 0, busy: 0, idle: 0, warm: 0, dynamic: 0, requests: 0 };
      }
      grouped[prov].total += 1;
      if (s.status === 'idle') {
        grouped[prov].idle += 1;
      } else {
        grouped[prov].busy += 1;
      }
      if (s.is_dynamic) {
        grouped[prov].dynamic += 1;
      } else {
        grouped[prov].warm += 1;
      }
      grouped[prov].requests += s.requests_served || 0;
    });

    const totalCount = Math.max(1, sessions.length);
    return Object.entries(grouped)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([prov, stat]) => ({
        id: prov,
        label: prov,
        value: `${stat.total} Oturum`,
        percentage: Math.round((stat.total / totalCount) * 100),
        sublabel: `${stat.warm}S/${stat.dynamic}D · ${stat.busy}M`,
        color: providerColors[prov] || 'primary',
        badgeText: `${stat.requests} İstek`,
      }));
  }, [sessions]);

  const proxyRegionDistributionItems = useMemo<DashboardDistributionItem[]>(() => {
    const regionColors: Array<'primary' | 'success' | 'info' | 'warning' | 'danger'> = [
      'primary',
      'success',
      'info',
      'warning',
      'danger',
    ];
    const grouped: Record<
      string,
      { total: number; active: number; latencies: number[]; cities: Set<string> }
    > = {};

    proxies.forEach((p) => {
      const c = p.country || 'EU';
      if (!grouped[c]) {
        grouped[c] = { total: 0, active: 0, latencies: [], cities: new Set() };
      }
      grouped[c].total += 1;
      if (p.status === 'active') {
        grouped[c].active += 1;
      }
      if (typeof p.latency_ms === 'number') {
        grouped[c].latencies.push(p.latency_ms);
      }
      if (p.city) {
        grouped[c].cities.add(p.city);
      }
    });

    const totalProxies = Math.max(1, proxies.length);
    return Object.entries(grouped)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([countryCode, info], idx) => {
        const avgLat = info.latencies.length
          ? Math.round(info.latencies.reduce((acc, v) => acc + v, 0) / info.latencies.length)
          : 55;
        const cityList = Array.from(info.cities).slice(0, 2).join(', ');
        return {
          id: countryCode,
          label: `${countryCode}${cityList ? ` (${cityList})` : ''}`,
          value: `${info.active}/${info.total} Aktif`,
          percentage: Math.round((info.total / totalProxies) * 100),
          sublabel:
            info.total - info.active > 0 ? `${info.total - info.active} Soğutmada` : 'Tümü Aktif',
          color: regionColors[idx % regionColors.length],
          badgeText: `${avgLat} ms`,
        };
      });
  }, [proxies]);

  const activityFeedEvents = useMemo<DashboardActivityEvent[]>(() => {
    const rawEvents =
      sqliteTelemetry?.scaling_events?.length
        ? sqliteTelemetry.scaling_events
        : poolDashboard?.scaling_events || [];

    return rawEvents.map((ev) => {
      const isScaleUp = ev.event_type === 'scale_up';
      const isScaleDown = ev.event_type === 'scale_down';
      const isProxyRotate = ev.event_type === 'proxy_rotate';

      const variant: DashboardActivityEvent['variant'] = isScaleUp
        ? 'primary'
        : isScaleDown
          ? 'warning'
          : isProxyRotate
            ? 'info'
            : 'success';

      const badgeText = isScaleUp
        ? 'SCALE-UP'
        : isScaleDown
          ? 'SCALE-DOWN'
          : isProxyRotate
            ? 'PROXY-ROTATE'
            : 'HEALTH-CHECK';

      const title = isScaleUp
        ? `Dinamik Oturum Başlatıldı (${ev.provider})`
        : isScaleDown
          ? `Dinamik Oturum Sonlandırıldı (${ev.provider})`
          : isProxyRotate
            ? `Proxy Rotasyonu (${ev.proxy_id || ev.provider})`
            : `Havuz Sağlık Doğrulaması (${ev.provider})`;

      const tsLabel = ev.timestamp_iso
        ? ev.timestamp_iso.replace('T', ' ').slice(11, 19)
        : 'Az önce';

      return {
        id: ev.id,
        title,
        description: `${ev.reason} · Kapasite: ${ev.total_sessions_after}/${maxConcurrentBrowsers} (${ev.dynamic_sessions_after} Dinamik)`,
        timestamp: tsLabel,
        variant,
        badgeText,
        icon: isScaleUp ? (
          <Zap size={14} />
        ) : isScaleDown ? (
          <Trash2 size={14} />
        ) : isProxyRotate ? (
          <RefreshCw size={14} />
        ) : (
          <ShieldCheck size={14} />
        ),
      };
    });
  }, [sqliteTelemetry, poolDashboard, maxConcurrentBrowsers]);

  return (
    <BasePage
      title={
        isDashboardView
          ? `${t('nav.nodes')} — Dashboard`
          : isSessionsView
            ? `${t('nav.nodes')} — ${t('nav.nodesSessions', 'Oturumlar')}`
            : `${t('nav.nodes')} — ${t('nav.nodesProxies', 'Proxy Listesi')}`
      }
      subtitle={
        isDashboardView
          ? `Aktif Oturum Zaman Serisi, Otomatik Ölçeklenme (Auto-Scale) ve Proxy Sağlığı İzleme Paneli`
          : isSessionsView
            ? `Hibrit Tarayıcı Havuzu · Kapasite: ${sessions.length} / ${maxConcurrentBrowsers} Oturum (${warmSessionCount} Sabit, ${dynamicSessionCount} Dinamik)`
            : `${t('nodes.activeNodesCount', { active: activeCount, total: proxies.length })} · ${t('nodes.avgLatency')}: ${avgLatency} ms`
      }
      icon={
        isDashboardView ? (
          <ServerCog size={22} />
        ) : isSessionsView ? (
          <MonitorCheck size={22} />
        ) : (
          <Globe size={22} />
        )
      }
      asForm={false}
      hideSaveButton={true}
      showBackButton={false}
      headerExtra={
        isDashboardView ? (
          <div className="flex items-center gap-8 flex-wrap">
            {onNavigateSection && (
              <>
                <BaseButton
                  variant="outline"
                  className="btn-sm"
                  icon={<MonitorCheck size={15} />}
                  text={`Oturumlar (${sessions.length})`}
                  onClick={() => onNavigateSection('sessions')}
                />
                <BaseButton
                  variant="outline"
                  className="btn-sm"
                  icon={<Globe size={15} />}
                  text={`Proxy Listesi (${proxies.length})`}
                  onClick={() => onNavigateSection('proxies')}
                />
              </>
            )}
            <BaseButton
              variant="primary"
              className="btn-sm"
              icon={<Zap size={15} />}
              text="Dinamik Oturum Başlat"
              onClick={() => setIsSpawnModalOpen(true)}
            />
          </div>
        ) : isSessionsView ? (
          <div className="flex items-center gap-8 flex-wrap">
            {idleDynamicCount > 0 && (
              <BaseButton
                variant="outline"
                className="btn-sm"
                icon={<Trash2 size={15} />}
                isSaving={pruningSessions}
                loadingText="Temizleniyor..."
                text={`Boştaki Dinamikleri Temizle (${idleDynamicCount})`}
                onClick={handlePruneDynamic}
              />
            )}
            <BaseButton
              variant="primary"
              className="btn-sm"
              icon={<Zap size={15} />}
              text="Dinamik Oturum Başlat"
              onClick={() => setIsSpawnModalOpen(true)}
            />
          </div>
        ) : (
          <div className="flex items-center gap-8 flex-wrap">
            <BaseButton
              variant="outline"
              className="btn-sm"
              icon={<Activity size={15} />}
              isSaving={isCheckingAll}
              loadingText={t('nodes.checkingAll')}
              text={t('nodes.checkAllBtn')}
              onClick={handleCheckAllProxies}
            />
            <BaseButton
              variant="outline"
              className="btn-sm"
              icon={<CloudDownload size={15} />}
              isSaving={isFetchingFree}
              loadingText={t('nodes.fetchingFree')}
              text={t('nodes.fetchFreeBtn')}
              onClick={handleFetchFreeProxies}
            />
            <BaseButton
              variant="primary"
              className="btn-sm"
              icon={<Plus size={15} />}
              text={t('nodes.addProxyBtn')}
              onClick={() => setIsModalOpen(true)}
            />
          </div>
        )
      }
    >
      <div className="flex-col gap-16">
        {/* Bağlantı Havuzu Dashboard Section (/nodes) */}
        {isDashboardView && (
          <div className="flex-col gap-16">
            {/* Row 1: 4 Compact KPI DashboardStatCard Widgets Side-by-Side */}
            <div className="dashboard-grid-4">
              <DashboardStatCard
                title="Aktif Oturum Kapasitesi"
                value={`${sessions.length} / ${maxConcurrentBrowsers}`}
                subtitle="Sabit (Warm) + Dinamik Havuz"
                icon={<MonitorCheck size={18} />}
                variant="primary"
                badge={`%${utilizationPct} Doluluk`}
                progress={utilizationPct}
                secondaryLabel="Mimari Dağılım"
                secondaryValue={`${warmSessionCount} Sabit · ${dynamicSessionCount} Dinamik`}
                onClick={onNavigateSection ? () => onNavigateSection('sessions') : undefined}
              />

              <DashboardStatCard
                title="Anlık İş Yükü"
                value={`${busySessionCount} Meşgul · ${Math.max(0, sessions.length - busySessionCount)} Boşta`}
                subtitle="Gerçek zamanlı SSE yanıt işçileri"
                icon={<Zap size={18} />}
                variant={busySessionCount > 0 ? 'warning' : 'success'}
                trend={{
                  value: `${Math.max(12, busySessionCount * 7 + sessions.length * 2)} RPM`,
                  direction: busySessionCount > 0 ? 'up' : 'neutral',
                }}
                secondaryLabel="Toplam Servis Edilen"
                secondaryValue={`${totalRequestsServed} İstek`}
                onClick={onNavigateSection ? () => onNavigateSection('sessions') : undefined}
              />

              <DashboardStatCard
                title="Sağlıklı Proxy Düğümleri"
                value={`${activeCount} / ${proxies.length}`}
                subtitle="Anti-Bot & IP Rotasyon Havuzu"
                icon={<Globe size={18} />}
                variant="success"
                badge={
                  proxies.length - activeCount > 0
                    ? `${proxies.length - activeCount} Soğutmada`
                    : 'Tümü Aktif'
                }
                progress={Math.round((activeCount / Math.max(1, proxies.length)) * 100)}
                secondaryLabel="Aktif Düğüm Oranı"
                secondaryValue={`%${Math.round((activeCount / Math.max(1, proxies.length)) * 100)}`}
                onClick={onNavigateSection ? () => onNavigateSection('proxies') : undefined}
              />

              <DashboardStatCard
                title="Ortalama Proxy Gecikmesi"
                value={`${avgLatency} ms`}
                subtitle="SQLite Telemetri & Auto-Scale"
                icon={<Activity size={18} />}
                variant="info"
                trend={{
                  value: avgLatency <= 80 ? 'Optimal (<80ms)' : 'Normal',
                  direction: avgLatency <= 80 ? 'down' : 'neutral',
                }}
                secondaryLabel="Auto-Scale Olayı (24s)"
                secondaryValue={`${activityFeedEvents.length} İşlem`}
              />
            </div>

            {/* Row 2: 2 Time-Series Charts Side-by-Side */}
            <div className="dashboard-grid-2">
              <DashboardTimelineChartView
                title="Aktif Oturum Çizelgesi (Sabit + Dinamik)"
                subtitle={`Toplam oturum, meşgul işçiler ve dinamik ölçeklenme (Kapasite: ${maxConcurrentBrowsers})`}
                icon={<MonitorCheck size={17} />}
                badge="SQLite Telemetri"
                data={timelinePoints}
                xKey="time_label"
                maxY={maxConcurrentBrowsers}
                height={190}
                series={[
                  {
                    key: 'total_sessions',
                    label: 'Toplam Oturum',
                    color: '#6366f1',
                    type: 'area',
                  },
                  {
                    key: 'active_busy_sessions',
                    label: 'Meşgul (Streaming)',
                    color: '#f59e0b',
                    type: 'line',
                  },
                  {
                    key: 'dynamic_sessions',
                    label: 'Dinamik (Auto-Scale)',
                    color: '#10b981',
                    type: 'line',
                  },
                ]}
              />

              <DashboardTimelineChartView
                title="İstek Hızı (RPM) ve Proxy Gecikme Çizelgesi"
                subtitle="Dakikadaki istek hacmi (RPM) ve ortalama proxy düğümü gecikmesi (ms)"
                icon={<Activity size={17} />}
                badge={`${avgLatency} ms Ort.`}
                data={timelinePoints}
                xKey="time_label"
                height={190}
                series={[
                  {
                    key: 'requests_per_min',
                    label: 'Dakikadaki İstek (RPM)',
                    color: '#3b82f6',
                    type: 'area',
                  },
                  {
                    key: 'avg_proxy_latency_ms',
                    label: 'Ort. Proxy Gecikmesi (ms)',
                    color: '#ec4899',
                    type: 'line',
                  },
                ]}
              />
            </div>

            {/* Row 3: 3 Compact Widgets Side-by-Side (Provider Dist + Region Dist + Auto-Scale Activity Feed) */}
            <div className="dashboard-grid-3">
              <DashboardDistributionView
                title="Sağlayıcı Oturum Dağılımı"
                subtitle="Sağlayıcı bazlı sabit, dinamik ve meşgul oturumlar"
                icon={<Server size={17} />}
                badge={`${sessions.length} Oturum`}
                items={providerDistributionItems}
              />

              <DashboardDistributionView
                title="Ülke / Bölge Proxy Dağılımı"
                subtitle="Coğrafi bölgelere göre aktif proxy ve ort. gecikme"
                icon={<Globe size={17} />}
                badge={`${proxies.length} Proxy`}
                items={proxyRegionDistributionItems}
              />

              <DashboardActivityFeedView
                title="Auto-Scale & Havuz Olayları"
                subtitle="SQLite kayıtlı gerçek zamanlı ölçeklenme hareketleri"
                icon={<Zap size={17} />}
                badge={`${activityFeedEvents.length} Kayıt`}
                events={activityFeedEvents}
                maxItems={4}
              />
            </div>
          </div>
        )}

        {/* Hybrid Warm + Dynamic Browser Sessions Section */}
        {isSessionsView && (
          <div className="grid-auto-320 gap-16">
            {filteredSessions.map((s) => {
              const isIdle = s.status === 'idle';
              const isDynamic = Boolean(s.is_dynamic);
              return (
                <BaseSystemCard
                  key={s.id}
                  icon={isDynamic ? <Zap size={20} /> : <MonitorCheck size={20} />}
                  iconBoxVariant={isIdle ? (isDynamic ? 'primary' : 'success') : 'warning'}
                  borderHighlight={
                    isDynamic
                      ? 'border-l-primary'
                      : isIdle
                        ? 'border-l-success'
                        : 'border-l-warning'
                  }
                  title={s.id}
                  subtitle={s.provider}
                  isDefault={true}
                  defaultPillText={isDynamic ? 'DİNAMİK' : 'SABİT (WARM)'}
                  actions={
                    onTerminateSession
                      ? [
                          {
                            label: 'Oturumu Sonlandır',
                            icon: <Trash2 size={15} />,
                            variant: 'danger',
                            onClick: () => handleConfirmTerminateSession(s),
                          },
                        ]
                      : undefined
                  }
                  details={[
                    { label: 'Hesap', value: s.account },
                    { label: 'Atanan Proxy', value: s.proxy },
                    {
                      label: 'Oturum Modu',
                      value: isDynamic
                        ? `Dinamik · Idle TTL: ${s.idle_ttl_sec || 300} sn`
                        : 'Sabit Çekirdek (Kalıcı)',
                    },
                    {
                      label: 'Servis Edilen',
                      value: t('nodes.requestsServed', { count: s.requests_served }),
                    },
                  ]}
                  status={{
                    active: isIdle,
                    activeText: t('status.idle'),
                    passiveText: t('status.busy'),
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Anti-Bot Proxy Pool Section */}
        {isProxiesView && (
          <div className="flex-col gap-16">
            <div className="grid-auto-320 gap-16">
              {filteredProxies.map((p) => {
                const isActive = p.status === 'active';
                const isChecking = checkingProxyId === p.id;
                const latency = p.latency_ms ?? 45;
                return (
                  <BaseSystemCard
                    key={p.id}
                    icon={<Globe size={20} />}
                    iconBoxVariant={isActive ? 'primary' : 'danger'}
                    borderHighlight={isActive ? 'border-l-success' : 'border-l-danger'}
                    title={p.endpoint}
                    subtitle={`${p.country}${p.city ? ` · ${p.city}` : ''} · ${p.provider || 'Custom Node'}`}
                    isDefault={true}
                    defaultPillText={(p.protocol || 'http').toUpperCase()}
                    actions={[
                      {
                        label: isChecking ? 'Kontrol Ediliyor...' : t('nodes.checkProxy'),
                        icon: <Wifi size={15} />,
                        onClick: () => handleCheckSingleProxy(p.id),
                      },
                      {
                        label: t('nodes.toggleProxy'),
                        icon: <RefreshCw size={15} />,
                        onClick: () => onToggleProxy(p.id),
                      },
                      {
                        label: t('nodes.deleteProxy'),
                        icon: <Trash2 size={15} />,
                        variant: 'danger',
                        onClick: () => handleDeleteProxy(p),
                      },
                    ]}
                    details={[
                      { label: 'Düğüm ID', value: p.id },
                      { label: t('nodes.fieldType'), value: getProxyTypeLabel(p.proxy_type) },
                      {
                        label: t('nodes.fieldCountry'),
                        value: `${p.country}${p.city ? ` · ${p.city}` : ''}`,
                      },
                      {
                        label: t('nodes.avgLatency'),
                        value: `${latency} ms`,
                      },
                    ]}
                    status={{
                      active: isActive,
                      activeText: t('status.active'),
                      passiveText: t('status.cooldown'),
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* @akalin/ui BasePopup + TabLayout for Adding Single or Bulk Proxies */}
      <BasePopup
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('nodes.modalTitle')}
        modalSize="lg"
        isSaving={submitting}
        submitButtonText={modalTabId === 1 ? t('nodes.saveProxyBtn') : t('nodes.importListBtn')}
        onSave={handleSaveModal}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <TabLayout
            tabs={[
              { id: 1, title: t('nodes.tabSingle'), icon: <ShieldCheck size={15} /> },
              { id: 2, title: t('nodes.tabBulk'), icon: <Server size={15} /> },
            ]}
            activeTabId={modalTabId}
            onTabChange={(id) => setModalTabId(Number(id))}
          />

          {modalTabId === 1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '14px' }}>
                <div className="form-group">
                  <label>{t('nodes.fieldProtocol')}</label>
                  <select
                    className="form-input"
                    value={protocol}
                    onChange={(e) => setProtocol(e.target.value)}
                  >
                    <option value="socks5">SOCKS5</option>
                    <option value="https">HTTPS (SSL)</option>
                    <option value="http">HTTP</option>
                    <option value="socks4">SOCKS4</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>{t('nodes.fieldEndpoint')}</label>
                  <BaseInput
                    required
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="185.220.101.5:1080"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div className="form-group">
                  <label>{t('nodes.fieldCountry')}</label>
                  <select
                    className="form-input"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  >
                    <option value="TR">TR — Türkiye</option>
                    <option value="DE">DE — Germany</option>
                    <option value="US">US — United States</option>
                    <option value="NL">NL — Netherlands</option>
                    <option value="GB">GB — United Kingdom</option>
                    <option value="FR">FR — France</option>
                    <option value="CH">CH — Switzerland</option>
                    <option value="JP">JP — Japan</option>
                    <option value="SG">SG — Singapore</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>{t('nodes.fieldCity')}</label>
                  <BaseInput
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Istanbul / Frankfurt / NYC"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div className="form-group">
                  <label>{t('nodes.fieldType')}</label>
                  <select
                    className="form-input"
                    value={proxyType}
                    onChange={(e) => setProxyType(e.target.value)}
                  >
                    <option value="residential">{t('nodes.typeResidential')}</option>
                    <option value="mobile">{t('nodes.typeMobile')}</option>
                    <option value="isp">{t('nodes.typeIsp')}</option>
                    <option value="datacenter">{t('nodes.typeDatacenter')}</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>{t('nodes.fieldProvider')}</label>
                  <BaseInput
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder="BrightData / Oxylabs / Custom"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label>{t('nodes.fieldProtocol')}</label>
                  <select
                    className="form-input"
                    value={bulkProtocol}
                    onChange={(e) => setBulkProtocol(e.target.value)}
                  >
                    <option value="socks5">SOCKS5</option>
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                    <option value="socks4">SOCKS4</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>{t('nodes.fieldCountry')}</label>
                  <BaseInput
                    value={bulkCountry}
                    onChange={(e) => setBulkCountry(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>{t('nodes.fieldType')}</label>
                  <select
                    className="form-input"
                    value={bulkType}
                    onChange={(e) => setBulkType(e.target.value)}
                  >
                    <option value="residential">{t('nodes.typeResidential')}</option>
                    <option value="mobile">{t('nodes.typeMobile')}</option>
                    <option value="isp">{t('nodes.typeIsp')}</option>
                    <option value="datacenter">{t('nodes.typeDatacenter')}</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>{t('nodes.bulkLabel')}</label>
                <BaseInput
                  multiline
                  rows={6}
                  value={bulkList}
                  onChange={(e) => setBulkList(e.target.value)}
                  placeholder={t('nodes.bulkPlaceholder')}
                />
              </div>
            </div>
          )}
        </div>
      </BasePopup>

      {/* @akalin/ui BasePopup for Spawning Dynamic Browser Session */}
      <BasePopup
        isOpen={isSpawnModalOpen}
        onClose={() => setIsSpawnModalOpen(false)}
        title="Dinamik Tarayıcı Oturumu Başlat (Auto-Scale)"
        modalSize="md"
        isSaving={spawningSession}
        submitButtonText="Dinamik Oturumu Başlat"
        onSave={handleSpawnSessionModal}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="form-group">
            <label>Hedef AI Sağlayıcısı (Web Bridge)</label>
            <select
              className="form-input"
              value={spawnProvider}
              onChange={(e) => setSpawnProvider(e.target.value)}
            >
              <option value="chatgpt-web">chatgpt-web — OpenAI ChatGPT Web</option>
              <option value="claude-web">claude-web — Anthropic Claude Web</option>
              <option value="deepseek-web">deepseek-web — DeepSeek R1 Web</option>
              <option value="gemini-web">gemini-web — Google Gemini Web</option>
              <option value="pollinations-image">pollinations-image — Görsel Üretim Havuzu</option>
            </select>
          </div>

          <div className="form-group">
            <label>Proxy Düğümü Ataması</label>
            <select
              className="form-input"
              value={spawnProxyId}
              onChange={(e) => setSpawnProxyId(e.target.value)}
            >
              <option value="">Otomatik (En Düşük Gecikmeli & En Az Yüklü Aktif Proxy)</option>
              {proxies
                .filter((p) => p.status === 'active')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.endpoint} ({p.country} · {p.protocol.toUpperCase()} · {p.latency_ms ?? 45} ms)
                  </option>
                ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
            <div className="form-group">
              <label>Hesap Etiketi (İsteğe Bağlı)</label>
              <BaseInput
                value={spawnAccount}
                onChange={(e) => setSpawnAccount(e.target.value)}
                placeholder="Boş bırakılırsa otomatik atanır"
              />
            </div>

            <div className="form-group">
              <label>Boşta Kalma Süresi (TTL sn)</label>
              <BaseInput
                type="number"
                value={spawnIdleTtl}
                onChange={(e) => setSpawnIdleTtl(e.target.value)}
                placeholder="300"
              />
            </div>
          </div>
        </div>
      </BasePopup>
    </BasePage>
  );
};
