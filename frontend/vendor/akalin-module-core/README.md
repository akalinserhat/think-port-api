# @akalin/module_core

Kurumsal React uygulamaları (`Webakus.UI`, `Webakus.AdminUI`, `OpenAiApi` vb.) için merkezi **Özellik Modülü Kayıt Sistemi (ModuleRegistry)**, **RBAC Yetki Matrisi Üreticisi**, **Dinamik Rota / Menü / Sistem Ayarları Orkestratörü**.

## Kurulum

```json
{
  "dependencies": {
    "@akalin/module_core": "github:akalinserhat/akalin-module-core#main"
  }
}
```

## Temel Özellikler

- **`ModuleRegistry`**: Singleton (`globalThis.__AKALIN_MODULE_REGISTRY__`) tabanlı merkezi modül kayıt ve abonelik yöneticisi.
- **`IModuleDefinition`**: Rotalar (`routes`, `popupRoutes`), sol menü (`menuItems`), **Sistem Ayarları Kartları (`settingsModules`)**, RBAC varlıkları (`cards`, `documents`, `reports`, `operations`, `permissions`), aksiyonlar (`actions`) ve paylaşımlı bileşenler (`components`).
- **RBAC Yetki Matrisi**: `getPermissionMatrix()` ve `getAllPermissions()` ile modüllerden otomatik CRUD ve özel yetki ağacı üretimi.
- **Sistem Ayarları (`BaseSystemPage`) Entegrasyonu**: `getSettingsModules()` ve `useSystemSettingModules()` ile kayıtlı modüllerin ayar kartlarını otomatik derleme.
- **Yetki Kalkanları**: `PermissionGuard`, `RoutePermissionGuard`, `usePermission`, `checkUserPermission`, `matchesPermission`.
