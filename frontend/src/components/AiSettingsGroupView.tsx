/**
 * @file AiSettingsGroupView.tsx
 * @description ThinkPort API Gateway - Sistem Ayarları > Yapay Zeka Grubu.
 * Modeller (IThinkPortModel tabanlı genişletilebilir mimari), Ajanlar (@akalin/ai_management_module)
 * ve API Protokolleri alt bölümlerini barındırır.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bot, Cpu, Code2, Sparkles, Database } from 'lucide-react';
import { BaseSystemPage, type SystemSettingModule } from '@akalin/ui';
import { AiAjanlar } from '@akalin/ai_management_module';
import { AIModelDTO, GatewaySettingsDTO } from '../dtos';
import { ModelRegistry } from '../models';
import { protocolService } from '../services';
import { AiModelsView } from './AiModelsView';
import { ApiProtocolsView } from './ApiProtocolsView';
import { RagEmbeddingSettingsView } from './RagEmbeddingSettingsView';

export interface AiSettingsGroupViewProps {
  models?: AIModelDTO[];
  settings: GatewaySettingsDTO;
  onSaveSettings: (updated: GatewaySettingsDTO) => Promise<void>;
  onSelectModelForChat?: (modelId: string) => void;
  onShowToast: (msg: string) => void;
  onProtocolsCountChange?: (count: number) => void;
  onModelsCountChange?: (count: number) => void;
  onAgentsCountChange?: (count: number) => void;
}

export const AiSettingsGroupView: React.FC<AiSettingsGroupViewProps> = ({
  models = [],
  settings,
  onSaveSettings,
  onSelectModelForChat,
  onShowToast,
  onProtocolsCountChange,
  onModelsCountChange,
  onAgentsCountChange,
}) => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const initialModelsCount = useMemo(
    () => ModelRegistry.getMergedModels(models).length,
    [models]
  );

  const [modelsCount, setModelsCount] = useState<number>(initialModelsCount);
  const [protocolsCount, setProtocolsCount] = useState<number>(4);
  const [agentsCount, setAgentsCount] = useState<number>(3);

  const refreshAgentsCount = useCallback(() => {
    axios
      .get('/api/AiAjanlar')
      .then((res) => {
        if (Array.isArray(res.data)) {
          setAgentsCount(res.data.length);
          onAgentsCountChange?.(res.data.length);
        }
      })
      .catch(() => {
        // Varsayılan ajan sayısı korunur
      });
  }, [onAgentsCountChange]);

  useEffect(() => {
    const mergedCount = ModelRegistry.getMergedModels(models).length;
    setModelsCount(mergedCount);
    onModelsCountChange?.(mergedCount);
  }, [models, onModelsCountChange]);

  useEffect(() => {
    protocolService
      .listProtocols()
      .then((list) => {
        if (Array.isArray(list)) {
          setProtocolsCount(list.length);
          onProtocolsCountChange?.(list.length);
        }
      })
      .catch(() => {
        // Varsayılan protokol sayısı korunur
      });
  }, [onProtocolsCountChange]);

  useEffect(() => {
    refreshAgentsCount();
    const handleAgentsUpdated = () => refreshAgentsCount();
    window.addEventListener('ai-agents-updated', handleAgentsUpdated);
    return () => {
      window.removeEventListener('ai-agents-updated', handleAgentsUpdated);
    };
  }, [refreshAgentsCount]);

  const selectedSubModuleId = useMemo(() => {
    const clean = location.pathname.replace(/^\/admin(?=\/|$)/, '');
    const nestedMatch = clean.match(/^\/settings\/ai\/([^/?#]+)/);
    if (nestedMatch) {
      const seg = decodeURIComponent(nestedMatch[1]);
      if (seg.toLowerCase() === 'aiajanlar' || seg.toLowerCase() === 'ai-ajanlar') {
        return 'agents';
      }
      return seg;
    }
    const directMatch = clean.match(/^\/settings\/(models|protocols|agents|embedding)(?:\/|$)/);
    if (directMatch) {
      return directMatch[1];
    }
    return null;
  }, [location.pathname]);

  const aiSubModules = useMemo<SystemSettingModule[]>(
    () => [
      {
        id: 'models',
        name: t('settings.modelsModuleTitle', 'Modeller'),
        desc: t(
          'settings.modelsModuleDesc',
          'ThinkPort API içerisinde kullanılan Web Oturum Köprüsü, Görsel Üretim ve Yerel/Harici yapay zeka modellerini (IThinkPortModel mimarisi) yönetin ve genişletin'
        ),
        icon: <Cpu size={22} />,
        badge: `${modelsCount} ${t('settings.modelsBadgeSuffix', 'Model')}`,
        keywords:
          'modeller yapay zeka ai llm gpt-4o claude deepseek gemini flux sdxl ollama qwen gemma ithinkportmodel interface model registry yeni model ekle',
        hasOwnLayout: true,
        component: (
          <AiModelsView
            runtimeModels={models}
            onSelectModelForChat={onSelectModelForChat}
            onShowToast={onShowToast}
            onModelsChanged={(count) => {
              setModelsCount(count);
              onModelsCountChange?.(count);
            }}
          />
        ),
      },
      {
        id: 'agents',
        name: t('settings.agentsModuleTitle', 'Ajanlar'),
        desc: t(
          'settings.agentsModuleDesc',
          'Sohbet & Yanıt Gözlemci Ajanı (Observer LLM), ThinkPort Genel Asistanı ve Webakus ERP uzman ajanlarını, madde bazlı kurallarını ve Flowchart görev akışlarını yapılandırın'
        ),
        icon: <Sparkles size={22} />,
        badge: `${agentsCount} ${t('settings.agentsBadgeSuffix', 'Ajan')}`,
        keywords:
          'ajanlar ai ajan gözlemci ajan observer llm webakus erp asistan sistem istemi kurallar mcp araçlar flowchart görev akışı token kesinti tamamlama',
        hasOwnLayout: true,
        component: (
          <AiAjanlar
            baseRoute="/settings/ai/agents"
            backRoute="/settings/ai"
            onBack={() =>
              navigate('/settings/ai', {
                state: { selectedModuleId: 'agents' },
              })
            }
          />
        ),
      },
      {
        id: 'protocols',
        name: t('settings.protocolsModuleTitle', 'API Protokolleri'),
        desc: t(
          'settings.protocolsModuleDesc',
          'OpenAI, Anthropic, Gemini, Ollama ve özel sağlayıcılar için dinamik JavaScript istek/yanıt/model dönüştürücü protokolleri ve canlı test konsolu'
        ),
        icon: <Code2 size={22} />,
        badge: `${protocolsCount} ${t('settings.protocolsBadgeSuffix', 'Protokol')}`,
        keywords:
          'api protokolleri openai anthropic claude gemini ollama rest javascript script buildrequest parseresponse parsemodels canlı test konsolu llm sağlayıcı',
        hasOwnLayout: true,
        component: (
          <ApiProtocolsView
            onShowToast={onShowToast}
            onProtocolsChanged={(count) => {
              setProtocolsCount(count);
              onProtocolsCountChange?.(count);
            }}
          />
        ),
      },
      {
        id: 'embedding',
        name: t('settings.embeddingModuleTitle', 'RAG & Embedding (BAAI/bge-m3)'),
        desc: t(
          'settings.embeddingModuleDesc',
          'Bulut dökümanlarını semantik olarak parçalayan (chunking) ve PostgreSQL pgvector (1024d) üzerinde indeksleyen sağlayıcı bağımsız online/yerel BAAI/bge-m3 yapılandırması'
        ),
        icon: <Database size={22} />,
        badge: t('settings.embeddingBadge', 'BAAI/bge-m3 · 1024d'),
        keywords:
          'rag embedding baai bge-m3 1024 pgvector semantik chunking siliconflow cloudflare huggingface openrouter deepinfra ollama vektör indeksleme',
        hasOwnLayout: true,
        component: (
          <RagEmbeddingSettingsView
            settings={settings}
            onSaveSettings={onSaveSettings}
            onShowToast={onShowToast}
          />
        ),
      },
    ],
    [
      t,
      modelsCount,
      agentsCount,
      protocolsCount,
      models,
      settings,
      onSaveSettings,
      onSelectModelForChat,
      onShowToast,
      onModelsCountChange,
      onProtocolsCountChange,
      navigate,
    ]
  );

  return (
    <BaseSystemPage
      title={t('settings.aiGroupTitle', 'Yapay Zeka')}
      subtitle={t(
        'settings.aiGroupDesc',
        'Gateway yapay zeka modellerini, sağlayıcı köprülerini ve dinamik REST API protokol dönüştürücülerini yapılandırın'
      )}
      icon={<Bot size={26} />}
      baseRoute="/settings/ai"
      backRoute="/settings"
      onBack={() =>
        navigate('/settings', {
          state: { selectedModuleId: 'ai' },
        })
      }
      modules={aiSubModules}
      selectedModuleId={selectedSubModuleId}
      onModuleClick={(subId) =>
        navigate(`/settings/ai/${subId}`, {
          state: { selectedModuleId: subId, returnUrl: '/settings/ai' },
        })
      }
    />
  );
};

export default AiSettingsGroupView;

