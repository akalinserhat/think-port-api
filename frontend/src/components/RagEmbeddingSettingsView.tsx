/**
 * @file RagEmbeddingSettingsView.tsx
 * @description ThinkPort API Gateway - Sistem Ayarları > Yapay Zeka > RAG & Embedding (BAAI/bge-m3).
 * Sağlayıcı bağımsız 1024 boyutlu BAAI/bge-m3 semantik parçalama (chunking), online sağlayıcı
 * (SiliconFlow, Cloudflare Workers AI, Hugging Face, OpenRouter, DeepInfra) ve yerel Ollama (bge-m3:latest)
 * yapılandırmasını BaseCardPage mimarisiyle yönetir.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Database,
  Layers,
  Sparkles,
  KeyRound,
  Activity,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import {
  BaseCardPage,
  type BaseTabItem,
  type ActionMenuItem,
  PolicySettingCard,
  BasitInput,
  BaseDropdownSecici,
  BaseSwitch,
  NotificationCard,
  useBaseSystemPage,
} from '@akalin/ui';
import {
  GatewaySettingsDTO,
  RagEmbeddingStatusDTO,
  RagEmbeddingTestResponseDTO,
} from '../dtos';
import { ragEmbeddingService } from '../services';

export interface RagEmbeddingSettingsViewProps {
  settings: GatewaySettingsDTO;
  onSaveSettings: (updated: GatewaySettingsDTO) => Promise<void>;
  onShowToast?: (msg: string) => void;
}

export const RagEmbeddingSettingsView: React.FC<RagEmbeddingSettingsViewProps> = ({
  settings,
  onSaveSettings,
  onShowToast,
}) => {
  const { t } = useTranslation();
  const { filterItems } = useBaseSystemPage();

  const [activeTab, setActiveTab] = useState<string>('strategy');
  const [formState, setFormState] = useState<GatewaySettingsDTO>(settings);
  const [saving, setSaving] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [reindexing, setReindexing] = useState<boolean>(false);
  const [statusSummary, setStatusSummary] = useState<RagEmbeddingStatusDTO | null>(null);
  const [lastTestResult, setLastTestResult] = useState<RagEmbeddingTestResponseDTO | null>(null);

  useEffect(() => {
    setFormState(settings);
  }, [settings]);

  const loadStatusSummary = useCallback(async () => {
    try {
      const status = await ragEmbeddingService.getStatus();
      setStatusSummary(status);
    } catch {
      // Sunucu erişilemezse sessizce geçilir
    }
  }, []);

  useEffect(() => {
    loadStatusSummary();
  }, [loadStatusSummary]);

  const isDirty = useMemo(() => {
    return (
      (formState.embedding_primary_provider || 'auto') !==
        (settings.embedding_primary_provider || 'auto') ||
      (formState.enable_semantic_chunking ?? true) !==
        (settings.enable_semantic_chunking ?? true) ||
      (formState.siliconflow_api_key || '') !== (settings.siliconflow_api_key || '') ||
      (formState.hf_api_key || '') !== (settings.hf_api_key || '') ||
      (formState.cloudflare_account_id || '') !== (settings.cloudflare_account_id || '') ||
      (formState.cloudflare_api_token || '') !== (settings.cloudflare_api_token || '') ||
      (formState.openrouter_api_key || '') !== (settings.openrouter_api_key || '') ||
      (formState.deepinfra_api_key || '') !== (settings.deepinfra_api_key || '')
    );
  }, [formState, settings]);

  const providerOptions = useMemo(
    () => [
      { id: 'auto', label: t('ragEmbedding.optAuto') },
      { id: 'hf-space', label: t('ragEmbedding.optHfSpace') },
      { id: 'siliconflow', label: t('ragEmbedding.optSiliconFlow') },
      { id: 'cloudflare', label: t('ragEmbedding.optCloudflare') },
      { id: 'huggingface', label: t('ragEmbedding.optHuggingFace') },
      { id: 'openrouter', label: t('ragEmbedding.optOpenRouter') },
      { id: 'deepinfra', label: t('ragEmbedding.optDeepInfra') },
      { id: 'ollama', label: t('ragEmbedding.optOllama') },
    ],
    [t]
  );

  const handleSubmit = useCallback(
    async (e?: React.FormEvent | React.MouseEvent) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      setSaving(true);
      try {
        await onSaveSettings({
          ...settings,
          ...formState,
          embedding_model: 'BAAI/bge-m3',
          embedding_primary_provider: formState.embedding_primary_provider || 'auto',
          enable_semantic_chunking: formState.enable_semantic_chunking ?? true,
        });
        await loadStatusSummary();
      } finally {
        setSaving(false);
      }
    },
    [formState, loadStatusSummary, onSaveSettings, settings]
  );

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    try {
      if (isDirty) {
        await onSaveSettings({
          ...settings,
          ...formState,
          embedding_model: 'BAAI/bge-m3',
          embedding_primary_provider: formState.embedding_primary_provider || 'auto',
          enable_semantic_chunking: formState.enable_semantic_chunking ?? true,
        });
      }
      const res = await ragEmbeddingService.testConnection(
        formState.embedding_primary_provider || 'auto'
      );
      setLastTestResult(res);
      await loadStatusSummary();
      onShowToast?.(res.message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('ragEmbedding.testErrorTitle');
      onShowToast?.(msg);
    } finally {
      setTesting(false);
    }
  }, [formState, isDirty, loadStatusSummary, onSaveSettings, onShowToast, settings, t]);

  const handleReindex = useCallback(
    async (onlyFallback: boolean) => {
      setReindexing(true);
      try {
        if (isDirty) {
          await onSaveSettings({
            ...settings,
            ...formState,
            embedding_model: 'BAAI/bge-m3',
            embedding_primary_provider: formState.embedding_primary_provider || 'auto',
            enable_semantic_chunking: formState.enable_semantic_chunking ?? true,
          });
        }
        const res = await ragEmbeddingService.reindexDocuments(onlyFallback);
        await loadStatusSummary();
        const docsCount = res.reindexed_documents ?? res.updated_documents ?? 0;
        const chunksCount = res.reindexed_chunks ?? res.updated_chunks ?? 0;
        const providerUsed = res.embedding_provider || res.provider || 'BAAI/bge-m3';
        onShowToast?.(
          res.message ||
            t('ragEmbedding.reindexSuccessToast', {
              docs: docsCount,
              chunks: chunksCount,
              provider: providerUsed,
            })
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('ragEmbedding.reindexErrorToast');
        onShowToast?.(msg);
      } finally {
        setReindexing(false);
      }
    },
    [formState, isDirty, loadStatusSummary, onSaveSettings, onShowToast, settings, t]
  );

  const extraDropdownActions = useMemo<ActionMenuItem[]>(
    () => [
      {
        label: testing
          ? t('ragEmbedding.actionTestingConnection')
          : t('ragEmbedding.actionTestConnection'),
        icon: <Activity size={15} />,
        disabled: saving || testing || reindexing,
        dividerAbove: true,
        onClick: () => handleTestConnection(),
      },
      {
        label: reindexing
          ? t('ragEmbedding.actionReindexing')
          : t('ragEmbedding.actionReindexAll'),
        icon: <RefreshCw size={15} />,
        disabled: saving || testing || reindexing,
        onClick: () => handleReindex(false),
      },
      {
        label: t('ragEmbedding.actionReindexFallbackOnly'),
        icon: <Layers size={15} />,
        disabled: saving || testing || reindexing,
        onClick: () => handleReindex(true),
      },
      {
        label: t('ragEmbedding.actionResetChanges'),
        icon: <RotateCcw size={15} />,
        disabled: !isDirty || saving,
        dividerAbove: true,
        onClick: () => setFormState(settings),
      },
    ],
    [handleReindex, handleTestConnection, isDirty, reindexing, saving, settings, t, testing]
  );

  const strategyPolicies = useMemo(
    () => [
      {
        id: 'embedding_primary_provider',
        icon: <Layers size={20} />,
        iconActive: true,
        title: t('ragEmbedding.primaryProviderTitle'),
        description: t('ragEmbedding.primaryProviderDesc'),
        action: (
          <div className="w-350">
            <BaseDropdownSecici
              options={providerOptions}
              value={formState.embedding_primary_provider || 'auto'}
              onChange={(val) =>
                setFormState((prev) => ({
                  ...prev,
                  embedding_primary_provider: String(val || 'auto'),
                }))
              }
            />
          </div>
        ),
      },
      {
        id: 'enable_semantic_chunking',
        icon: <Sparkles size={20} />,
        iconActive: formState.enable_semantic_chunking ?? true,
        title: t('ragEmbedding.semanticChunkingTitle'),
        description: t('ragEmbedding.semanticChunkingDesc'),
        action: (
          <BaseSwitch
            checked={formState.enable_semantic_chunking ?? true}
            onChange={(e) =>
              setFormState((prev) => ({
                ...prev,
                enable_semantic_chunking: e.target.checked,
              }))
            }
          />
        ),
      },
    ],
    [formState.embedding_primary_provider, formState.enable_semantic_chunking, providerOptions, t]
  );

  const visibleStrategyPolicies = useMemo(
    () => filterItems(strategyPolicies, (item) => [String(item.title), String(item.description)]),
    [filterItems, strategyPolicies]
  );

  const statusNotification = useMemo(() => {
    if (lastTestResult) {
      return (
        <NotificationCard
          id="rag-bge-m3-test-banner"
          type={lastTestResult.ok ? 'success' : 'warning'}
          isRead={true}
          title={
            lastTestResult.ok
              ? t('ragEmbedding.testSuccessTitle')
              : t('ragEmbedding.testErrorTitle')
          }
          message={
            lastTestResult.ok
              ? t('ragEmbedding.testSuccessDetail', {
                  provider: lastTestResult.provider,
                  dims: lastTestResult.dimensions,
                  latency: lastTestResult.latency_ms,
                  sim: lastTestResult.sample_similarity ?? '-',
                })
              : lastTestResult.message
          }
          onDismiss={() => setLastTestResult(null)}
        />
      );
    }

    if (!statusSummary) {
      return null;
    }

    const onlineList =
      statusSummary.configured_online_providers.length > 0
        ? statusSummary.configured_online_providers.join(', ')
        : t('ragEmbedding.noneConfiguredText');

    const ollamaStatus = statusSummary.local_ollama_bge_m3_ready
      ? t('ragEmbedding.ollamaReadyText')
      : t('ragEmbedding.ollamaOfflineText');

    return (
      <NotificationCard
        id="rag-bge-m3-status-banner"
        type={statusSummary.neural_ready ? 'success' : 'info'}
        isRead={true}
        title={
          statusSummary.neural_ready
            ? t('ragEmbedding.statusNeuralReadyTitle')
            : t('ragEmbedding.statusFallbackTitle')
        }
        message={
          statusSummary.neural_ready
            ? t('ragEmbedding.statusNeuralReadyDesc', {
                provider: statusSummary.last_active_provider,
                online: onlineList,
                ollama: ollamaStatus,
              })
            : t('ragEmbedding.statusFallbackDesc')
        }
      />
    );
  }, [lastTestResult, statusSummary, t]);

  const cardTabs = useMemo<BaseTabItem[]>(
    () => [
      {
        id: 'strategy',
        label: t('ragEmbedding.tabStrategy'),
        icon: <Database size={16} />,
        content: (
          <div className="py-20 flex-col gap-16">
            {statusNotification}
            {visibleStrategyPolicies.map((item) => (
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
        ),
      },
      {
        id: 'providers',
        label: t('ragEmbedding.tabProviders'),
        icon: <KeyRound size={16} />,
        content: (
          <div className="py-20 flex-col gap-20">
            <PolicySettingCard
              icon={<ShieldCheck size={20} />}
              iconActive={true}
              title={t('ragEmbedding.providersNoteTitle')}
              description={t('ragEmbedding.providersNoteDesc')}
            />

            <div className="grid-2-col gap-16">
              <div className="form-group">
                <label className="form-label">{t('ragEmbedding.siliconflowLabel')}</label>
                <BasitInput
                  type="password"
                  textTransform="none"
                  value={formState.siliconflow_api_key || ''}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      siliconflow_api_key: e.target.value,
                    }))
                  }
                  placeholder={t('ragEmbedding.siliconflowPlaceholder')}
                />
              </div>

              <div className="form-group">
                <label className="form-label">{t('ragEmbedding.hfLabel')}</label>
                <BasitInput
                  type="password"
                  textTransform="none"
                  value={formState.hf_api_key || ''}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      hf_api_key: e.target.value,
                    }))
                  }
                  placeholder={t('ragEmbedding.hfPlaceholder')}
                />
              </div>
            </div>

            <div className="grid-2-col gap-16">
              <div className="form-group">
                <label className="form-label">{t('ragEmbedding.cloudflareAccountLabel')}</label>
                <BasitInput
                  type="text"
                  textTransform="none"
                  value={formState.cloudflare_account_id || ''}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      cloudflare_account_id: e.target.value,
                    }))
                  }
                  placeholder={t('ragEmbedding.cloudflareAccountPlaceholder')}
                />
              </div>

              <div className="form-group">
                <label className="form-label">{t('ragEmbedding.cloudflareTokenLabel')}</label>
                <BasitInput
                  type="password"
                  textTransform="none"
                  value={formState.cloudflare_api_token || ''}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      cloudflare_api_token: e.target.value,
                    }))
                  }
                  placeholder={t('ragEmbedding.cloudflareTokenPlaceholder')}
                />
              </div>
            </div>

            <div className="grid-2-col gap-16">
              <div className="form-group">
                <label className="form-label">{t('ragEmbedding.openrouterLabel')}</label>
                <BasitInput
                  type="password"
                  textTransform="none"
                  value={formState.openrouter_api_key || ''}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      openrouter_api_key: e.target.value,
                    }))
                  }
                  placeholder={t('ragEmbedding.openrouterPlaceholder')}
                />
              </div>

              <div className="form-group">
                <label className="form-label">{t('ragEmbedding.deepinfraLabel')}</label>
                <BasitInput
                  type="password"
                  textTransform="none"
                  value={formState.deepinfra_api_key || ''}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      deepinfra_api_key: e.target.value,
                    }))
                  }
                  placeholder={t('ragEmbedding.deepinfraPlaceholder')}
                />
              </div>
            </div>
          </div>
        ),
      },
    ],
    [formState, statusNotification, t, visibleStrategyPolicies]
  );

  return (
    <BaseCardPage
      id="rag-embedding-settings-form"
      asForm={true}
      onSubmit={handleSubmit}
      onSave={handleSubmit}
      isSaving={saving}
      showBackButton={false}
      enableAiAssistant={false}
      icon={<Database size={22} />}
      title={t('ragEmbedding.title')}
      subtitle={t('ragEmbedding.subtitle')}
      tabs={cardTabs}
      activeTabId={activeTab}
      onTabChange={(tabId) => setActiveTab(String(tabId))}
      extraDropdownActions={extraDropdownActions}
      actionMenuDropdownHeader={t('ragEmbedding.dropdownHeader')}
    />
  );
};

export default RagEmbeddingSettingsView;
