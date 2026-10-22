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
}
