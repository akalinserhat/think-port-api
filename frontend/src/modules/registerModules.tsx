/**
 * think-port-api - Merkezi Modül Kayıtları (registerModules.tsx)
 * @akalin/module_core, @akalin/email_module ve @akalin/global_search_module kütüphanelerini kullanarak
 * uygulamanın özellik modüllerini ve Sistem Ayarları kartlarını kaydeder.
 */

import { toast } from 'react-hot-toast';
import { ModuleRegistry } from '@akalin/module_core';
import {
  createEmailModule,
  createRestEmailAdapter,
  createDefaultEmailTemplates,
} from '@akalin/email_module';
import { createGlobalSearchModule } from '@akalin/global_search_module';

let isInitialized = false;

export const DEFAULT_GATEWAY_EMAIL_TEMPLATES = createDefaultEmailTemplates('ThinkPort API');

export const gatewayEmailAdapter = createRestEmailAdapter({
  baseUrl: '/admin/smtp',
  appName: 'ThinkPort API',
  smtpStorageKey: 'gateway_smtp_settings_v1',
  templatesStorageKey: 'gateway_email_templates_v1',
  defaultTemplates: DEFAULT_GATEWAY_EMAIL_TEMPLATES,
});

export function initializeGatewayModules(): void {
  if (isInitialized) return;
  isInitialized = true;

  // 1) @akalin/global_search_module — Global Arama ve Çoklu Filtreleme Modülü
  const globalSearchModule = createGlobalSearchModule({
    id: 'global-search',
    allowMultipleFilterTypes: true,
  });
  ModuleRegistry.register(globalSearchModule as any);

  // 2) @akalin/email_module — E-Posta, SMTP & Şablon Yönetimi Modülü
  const emailModule = createEmailModule({
    id: 'email-module',
    appName: 'ThinkPort API',
    baseRoute: '/email',
    settingsModuleId: 'smtp',
    settingsModuleName: 'E-Posta & SMTP Ayarları',
    settingsModuleDesc:
      'Sistem genelindeki giden e-posta (SMTP) sunucu yapılandırması, gönderim testleri ve e-posta şablon yönetimi',
    settingsModuleBadge: 'SMTP & Şablonlar',
    settingsOrder: 40,
    adapter: gatewayEmailAdapter,
    defaultTemplates: DEFAULT_GATEWAY_EMAIL_TEMPLATES,
    onNotify: (msg, type) => {
      if (type === 'error') toast.error(msg);
      else toast.success(msg);
    },
  });

  ModuleRegistry.register(emailModule);

  // 3) Yapay Zeka & Gözlemci Ajan Yönetimi Modülü (MCP Ağacı ve Form Seçicileri için)
  ModuleRegistry.register({
    id: 'ai_yonetimi',
    title: 'Yapay Zeka & Gözlemci Ajan Yönetimi',
    name: 'Yapay Zeka & Gözlemci Ajan Yönetimi',
    description:
      'Sohbet & Yanıt Gözlemci Ajanı (Observer LLM), uzman AI ajanları, model sağlayıcıları ve dinamik REST API protokolleri modülü.',
    order: 10,
    lists: [
      {
        id: 'ai-ajanlar-liste',
        category: 'liste',
        titleKey: 'menu_ai_ajanlar_liste',
        title: 'Yapay Zeka Ajanları Listesi',
        description: 'Sohbet & Yanıt Gözlemci Ajanı (GOZLEMCI_AJAN) ve uzman yapay zeka ajanları listesi.',
        route: '/settings/ai/agents',
        listRoute: '/settings/ai/agents',
        formRoute: '/settings/ai/agents/yeni',
        customActions: [
          {
            action: 'observer_detect_truncation',
            labelKey: 'Kesik Yanıt & Token Sınırı Denetçisi',
            description: 'LLM yanıtlarında finish_reason=length ve yarım kalan blokları tespit eder.',
          },
          {
            action: 'observer_continue_generation',
            labelKey: 'Otomatik Tamamlama İstemi & Yanıt Birleştirici',
            description: 'Kesilen yanıtlar için devam istemi üretir ve parçaları tek yanıt olarak birleştirir.',
          },
        ],
        children: [
          {
            id: 'ai-ajan-karti',
            category: 'kart',
            titleKey: 'ai_ajan_karti',
            title: 'Yapay Zeka Ajanı Kartı',
            description: 'Ajan sistem istemi, madde bazlı kuralları, Flowchart görev akışı ve MCP yetkileri kartı.',
            route: '/settings/ai/agents/yeni',
            formRoute: '/settings/ai/agents/yeni',
          },
        ],
      },
      {
        id: 'ai-modeller-liste',
        category: 'liste',
        titleKey: 'menu_ai_modeller_liste',
        title: 'Yapay Zeka Modelleri Listesi',
        description: 'ThinkPort Gateway üzerinde aktif olan yerel (Ollama) ve Web AI modelleri listesi.',
        route: '/settings/ai/models',
        listRoute: '/settings/ai/models',
        formRoute: '/settings/ai/models/new',
        children: [
          {
            id: 'ai-model-karti',
            category: 'kart',
            titleKey: 'ai_model_karti',
            title: 'Yapay Zeka Modeli Kartı',
            description: 'Model sağlayıcı, protokol ve parametre yapılandırma kartı.',
            route: '/settings/ai/models/new',
            formRoute: '/settings/ai/models/new',
          },
        ],
      },
      {
        id: 'ai-protokoller-liste',
        category: 'liste',
        titleKey: 'menu_ai_protokoller_liste',
        title: 'API Protokolleri Listesi',
        description: 'OpenAI, Anthropic, Gemini ve Ollama REST API dönüştürücü protokolleri listesi.',
        route: '/settings/ai/protocols',
        listRoute: '/settings/ai/protocols',
        formRoute: '/settings/ai/protocols/new',
        children: [
          {
            id: 'ai-protokol-karti',
            category: 'kart',
            titleKey: 'ai_protokol_karti',
            title: 'API Protokolü Kartı',
            description: 'JavaScript buildRequest ve parseResponse protokol betiği kartı.',
            route: '/settings/ai/protocols/new',
            formRoute: '/settings/ai/protocols/new',
          },
        ],
      },
    ],
  });
}
