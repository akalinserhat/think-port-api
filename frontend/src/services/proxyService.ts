/**
 * @file proxyService.ts
 * @description Proxy ve Dinamik Tarayıcı Oturum Havuzu yönetim servisi.
 * Doğrudan bağımsız `@akalin/proxy_module` kütüphanesi üzerinden dışa aktarılır.
 */

export {
  proxyService,
  createRestProxyAdapter,
  createLocalStorageProxyAdapter,
  useProxyModule,
  ProxyModuleProvider,
} from '@akalin/proxy_module';
