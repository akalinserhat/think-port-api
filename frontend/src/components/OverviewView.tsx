import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cpu,
  Coins,
  KeyRound,
  ShieldCheck,
  Activity,
  LayoutDashboard,
  FileTerminal,
  Eye,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import {
  BaseButton,
  BaseCard,
  BaseDashboardView,
  BasePage,
  BasePopup,
  DataTable,
  useAlertDialog,
  type DataTableColumn,
} from '@akalin/ui';
import {
  useGlobalSearch,
  useSearchFieldsRegister,
  type SearchType,
} from '@akalin/global_search_module';
import { AdminStateResponseDTO, UsageLogDTO } from '../dtos';
import { adminService } from '../services';

interface OverviewViewProps {
  state: AdminStateResponseDTO;
  onRefreshState?: () => Promise<void>;
  onShowToast?: (msg: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  state,
  onRefreshState,
  onShowToast,
}) => {
  const { t, i18n } = useTranslation();
  const { showAlert } = useAlertDialog();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'tr-TR';

  const [activeTabId, setActiveTabId] = useState<number>(1);
  const [selectedLog, setSelectedLog] = useState<UsageLogDTO | null>(null);
  const [clearing, setClearing] = useState<boolean>(false);

  const { state: globalSearchState, activeSearchType, selectedFilterTypes } = useGlobalSearch();

  const overviewSearchFields = useMemo<SearchType[]>(
    () => [
      {
        id: 'Tumu',
        label: 'Genel',
        iconName: 'Search',
        type: 'text',
        placeholder: 'Model, kullanıcı, istem veya log satırlarında ara...',
      },
      {
        id: 'model',
        label: 'Model / Sağlayıcı',
        iconName: 'Layers',
        type: 'text',
        placeholder: 'Model veya sağlayıcı ara...',
      },
      {
        id: 'user_email',
        label: 'Kullanıcı',
        iconName: 'Users',
        type: 'text',
        placeholder: 'Kullanıcı e-postası ile ara...',
      },
      {
        id: 'prompt_preview',
        label: 'İstem & Yanıt',
        iconName: 'FileText',
        type: 'text',
        placeholder: 'İstem veya yanıt içeriğinde ara...',
      },
      {
        id: 'status_filter',
        label: 'Kayıt Durumu',
        iconName: 'Filter',
        type: 'enum',
        isEnum: true,
        category: 'filter',
        options: [
          { id: 'status:success', label: 'Başarılı (INFO)' },
          { id: 'status:error', label: 'Hatalı (ERROR)' },
          { id: 'status:warning', label: 'Uyarı (WARNING)' },
        ],
      },
    ],
    []
  );

  useSearchFieldsRegister(overviewSearchFields);

  const idleBrowsers = state.browser_sessions.filter((s) => s.status === 'idle').length;
  const totalBrowsers = state.browser_sessions.length;
  const totalTokens = state.users.reduce((acc, u) => acc + u.tokens_used, 0);
  const activeKeys = state.api_keys.filter((k) => k.is_active).length;
  const activeProxies = state.proxies.filter((p) => p.status === 'active').length;

  const filteredUsageLogs = useMemo(() => {
    const raw = state.usage_logs || [];
    const q = (globalSearchState.searchTerm || '').trim().toLowerCase();
    const activeField = activeSearchType?.id || 'Tumu';
    const selectedIds = selectedFilterTypes.map((f) => f.id);

    return raw.filter((item) => {
      if (selectedIds.length > 0) {
        const wantSuccess = selectedIds.includes('status:success');
        const wantError = selectedIds.includes('status:error');
        if ((wantSuccess || wantError) && !(wantSuccess && wantError)) {
          if (wantError && item.status !== 'error') return false;
          if (wantSuccess && item.status === 'error') return false;
        }
      }
      if (!q) return true;
      if (activeField === 'model') {
        return (
          (item.model || '').toLowerCase().includes(q) ||
          (item.upstream_provider || '').toLowerCase().includes(q)
        );
      }
      if (activeField === 'user_email') {
        return (item.user_email || '').toLowerCase().includes(q);
      }
      if (activeField === 'prompt_preview') {
        return (
          (item.prompt_preview || '').toLowerCase().includes(q) ||
          (item.response_preview || '').toLowerCase().includes(q) ||
          (item.error_detail || '').toLowerCase().includes(q)
        );
      }
      return (
        (item.model || '').toLowerCase().includes(q) ||
        (item.upstream_provider || '').toLowerCase().includes(q) ||
        (item.user_email || '').toLowerCase().includes(q) ||
        (item.prompt_preview || '').toLowerCase().includes(q) ||
        (item.response_preview || '').toLowerCase().includes(q) ||
        (item.request_id || '').toLowerCase().includes(q)
      );
    });
  }, [state.usage_logs, globalSearchState.searchTerm, activeSearchType, selectedFilterTypes]);

  const filteredSystemLogs = useMemo(() => {
    const raw = state.system_logs || [];
    const q = (globalSearchState.searchTerm || '').trim().toLowerCase();
    const selectedIds = selectedFilterTypes.map((f) => f.id);

    return raw.filter((line) => {
      if (selectedIds.length > 0) {
        const isErr = line.includes('| ERROR');
        const isWarn = line.includes('| WARNING');
        const isInfo = !isErr && !isWarn;
        const matchStatus =
          (selectedIds.includes('status:error') && isErr) ||
          (selectedIds.includes('status:warning') && isWarn) ||
          (selectedIds.includes('status:success') && isInfo);
        if (!matchStatus) return false;
      }
      if (!q) return true;
      return line.toLowerCase().includes(q);
    });
  }, [state.system_logs, globalSearchState.searchTerm, selectedFilterTypes]);

  const handleClearLogs = () => {
    showAlert(
      'confirm',
      'Log Kayıtlarını Temizle',
      'Tüm telemetri kayıtlarını ve gateway.log dosyasını temizlemek istediğinize emin misiniz?',
      async () => {
        setClearing(true);
        try {
          await adminService.clearLogs();
          onShowToast?.('Tüm log ve telemetri kayıtları temizlendi');
          await onRefreshState?.();
        } finally {
          setClearing(false);
        }
      }
    );
  };

  const columns: DataTableColumn<UsageLogDTO>[] = useMemo(
    () => [
      {
        id: 'created_at',
        header: t('overview.colTime'),
        accessor: 'created_at',
        sortable: true,
        render: (row) => (
          <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>
            {row.created_at}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Durum',
        accessor: 'status',
        sortable: true,
        render: (row) => {
          const isError = row.status === 'error';
          return (
            <span
              style={{
                padding: '3px 10px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 700,
                background: isError ? 'rgba(239, 68, 68, 0.14)' : 'rgba(16, 185, 129, 0.14)',
                color: isError ? 'var(--danger)' : 'var(--success)',
              }}
            >
              {isError ? 'HATA' : 'BAŞARILI'}
            </span>
          );
        },
      },
      {
        id: 'model',
        header: t('overview.colModel'),
        accessor: 'model',
        sortable: true,
        render: (row) => (
          <div>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: '999px',
                background: 'var(--accent-light)',
                color: 'var(--accent-primary)',
                fontSize: '11px',
                fontWeight: 700,
                fontFamily: 'monospace',
              }}
            >
              {row.model}
            </span>
            {row.upstream_provider && (
              <div
                style={{
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: 'var(--text-secondary)',
                  marginTop: '3px',
                }}
              >
                {row.upstream_provider}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'user_email',
        header: t('overview.colUser'),
        accessor: 'user_email',
        sortable: true,
        render: (row) => (
          <span style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: 600 }}>
            {row.user_email}
          </span>
        ),
      },
      {
        id: 'prompt_preview',
        header: 'İstem, Dosyalar & Yanıt Önizleme',
        accessor: 'prompt_preview',
        render: (row) => (
          <div style={{ maxWidth: '300px' }}>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={row.prompt_preview}
            >
              {row.prompt_preview || '—'}
            </div>
            {row.attachment_names && row.attachment_names.length > 0 && (
              <div
                style={{
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  color: 'var(--accent-primary)',
                  marginTop: '2px',
                }}
              >
                📎 {row.attachment_names.join(', ')}
              </div>
            )}
            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginTop: '2px',
              }}
              title={row.response_preview}
            >
              {row.response_preview || row.error_detail || '—'}
            </div>
          </div>
        ),
      },
      {
        id: 'total_tokens',
        header: t('overview.colTokens'),
        accessor: 'total_tokens',
        align: 'right',
        sortable: true,
        render: (row) => (
          <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>
            {row.prompt_tokens} / {row.completion_tokens} /{' '}
            <strong style={{ color: 'var(--accent-primary)' }}>{row.total_tokens}</strong>
          </span>
        ),
      },
      {
        id: 'latency_ms',
        header: 'TTFT / Toplam Süre',
        accessor: 'latency_ms',
        align: 'right',
        sortable: true,
        render: (row) => (
          <div style={{ fontFamily: 'monospace', fontSize: '12px' }}>
            {row.ttft_ms ? (
              <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                TTFT {row.ttft_ms} ms
              </span>
            ) : null}
            <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
              Toplam: {row.latency_ms} ms
            </div>
          </div>
        ),
      },
      {
        id: 'actions',
        header: 'İncele',
        align: 'right',
        render: (row) => (
          <BaseButton
            type="button"
            variant="outline"
            className="btn-sm"
            icon={<Eye size={14} />}
            text="Detay"
            onClick={() => setSelectedLog(row)}
          />
        ),
      },
    ],
    [t]
  );

  return (
    <BasePage
      title={t('nav.overview')}
      subtitle={t('overview.subtitle')}
      icon={<LayoutDashboard size={22} />}
      asForm={false}
      hideSaveButton={true}
      showBackButton={false}
      tabs={[
        { id: 1, title: 'İstek & Yanıt Telemetrisi', icon: <Activity size={15} /> },
        {
          id: 2,
          title: `Sistem Log Dosyası (gateway.log · ${(state.system_logs || []).length})`,
          icon: <FileTerminal size={15} />,
        },
      ]}
      activeTabId={activeTabId}
      onTabChange={(id) => setActiveTabId(Number(id))}
      headerExtra={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onRefreshState && (
            <BaseButton
              type="button"
              variant="outline"
              className="btn-sm"
              icon={<RefreshCw size={14} />}
              text="Yenile"
              onClick={onRefreshState}
            />
          )}
          <BaseButton
            type="button"
            variant="danger"
            className="btn-sm"
            icon={<Trash2 size={14} />}
            isSaving={clearing}
            text="Logları Temizle"
            onClick={handleClearLogs}
          />
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* @akalin/ui BaseDashboardView Stat Widgets */}
        <div className="stats-grid">
          <BaseDashboardView
            title={t('overview.metricReadyBrowsers')}
            value={`${idleBrowsers} / ${totalBrowsers}`}
            subtitle={t('overview.metricReadyBrowsersSub', { total: totalBrowsers })}
            subtitleColor="var(--success)"
            icon={<Cpu size={22} style={{ color: 'var(--accent-primary)' }} />}
          />
          <BaseDashboardView
            title={t('overview.metricTotalTokens')}
            value={totalTokens.toLocaleString(locale)}
            subtitle={t('overview.metricTotalTokensSub')}
            icon={<Coins size={22} style={{ color: 'var(--warning)' }} />}
          />
          <BaseDashboardView
            title={t('overview.metricActiveKeys')}
            value={String(activeKeys)}
            subtitle={t('overview.metricActiveKeysSub')}
            subtitleColor="var(--accent-primary)"
            icon={<KeyRound size={22} style={{ color: 'var(--accent-primary)' }} />}
          />
          <BaseDashboardView
            title={t('overview.metricHealthyProxies')}
            value={`${activeProxies} / ${state.proxies.length}`}
            subtitle={t('overview.metricHealthyProxiesSub')}
            subtitleColor="var(--success)"
            icon={<ShieldCheck size={22} style={{ color: 'var(--success)' }} />}
          />
        </div>

        {activeTabId === 1 ? (
          <BaseCard variant="elevated">
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
                {t('overview.recentLogsTitle')}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                Her isteğin TTFT (ilk token süresi), toplam yanıt süresi, kullanılan sağlayıcı ve istem/yanıt detayları
              </p>
            </div>
            <DataTable<UsageLogDTO>
              columns={columns}
              data={filteredUsageLogs}
              keyExtractor={(item) => item.request_id}
              emptyMessage={t('overview.emptyLogs')}
              pageSize={15}
            />
          </BaseCard>
        ) : (
          <BaseCard variant="elevated">
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
                Sunucu Log Kayıtları (backend/logs/gateway.log)
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                Web AI ve yerel sağlayıcı çağrıları, HTTP durum kodları, süreler ve hata izleri
              </p>
            </div>

            <div
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--glass-border)',
                borderRadius: '10px',
                padding: '14px',
                maxHeight: '460px',
                overflowY: 'auto',
                fontFamily: 'monospace',
                fontSize: '12px',
                lineHeight: 1.65,
              }}
            >
              {filteredSystemLogs.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px' }}>
                  Henüz sistem log kaydı bulunmuyor.
                </div>
              ) : (
                filteredSystemLogs.map((line, idx) => {
                  const isError = line.includes('| ERROR');
                  const isWarn = line.includes('| WARNING');
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: '4px 8px',
                        borderBottom: '1px solid var(--glass-border)',
                        color: isError
                          ? 'var(--danger)'
                          : isWarn
                          ? 'var(--warning)'
                          : 'var(--text-primary)',
                        wordBreak: 'break-all',
                      }}
                    >
                      {line}
                    </div>
                  );
                })
              )}
            </div>
          </BaseCard>
        )}
      </div>

      {/* İstek & Yanıt Detay İnceleme Popup (@akalin/ui BasePopup) */}
      <BasePopup
        isOpen={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title={`Telemetri & Log Detayı — ${selectedLog?.request_id || ''}`}
        modalSize="lg"
        hideFooter
      >
        {selectedLog && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '12px',
              }}
            >
              <div className="p-3 rounded-lg bg-surface-container">
                <div className="text-xs text-secondary">Model / Sağlayıcı</div>
                <div className="text-xs font-mono font-semibold mt-1">
                  {selectedLog.model}
                  <div className="text-[11px] text-secondary">{selectedLog.upstream_provider || '—'}</div>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface-container">
                <div className="text-xs text-secondary">İlk Token (TTFT) / Toplam Süre</div>
                <div className="text-xs font-mono font-semibold mt-1">
                  {selectedLog.ttft_ms || selectedLog.latency_ms} ms / {selectedLog.latency_ms} ms
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface-container">
                <div className="text-xs text-secondary">Token Kullanımı</div>
                <div className="text-xs font-mono font-semibold mt-1">
                  {selectedLog.prompt_tokens} + {selectedLog.completion_tokens} ={' '}
                  {selectedLog.total_tokens}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface-container">
                <div className="text-xs text-secondary">Oturum / Zaman</div>
                <div className="text-xs font-mono font-semibold mt-1">
                  {selectedLog.session_id} · {selectedLog.created_at}
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>
                Kullanıcı İstemi (Prompt)
              </div>
              <pre
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--glass-border)',
                  fontSize: '12px',
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                }}
              >
                {selectedLog.prompt_preview || '—'}
              </pre>
            </div>

            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>
                Model Yanıtı (Response)
              </div>
              <pre
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--glass-border)',
                  fontSize: '12px',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  margin: 0,
                }}
              >
                {selectedLog.response_preview || '—'}
              </pre>
            </div>

            {selectedLog.error_detail && (
              <div>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--danger)',
                    marginBottom: '6px',
                  }}
                >
                  Hata Detayı
                </div>
                <pre
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    color: 'var(--danger)',
                    fontSize: '12px',
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                  }}
                >
                  {selectedLog.error_detail}
                </pre>
              </div>
            )}
          </div>
        )}
      </BasePopup>
    </BasePage>
  );
};
