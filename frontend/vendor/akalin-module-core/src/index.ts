/**
 * @akalin/module_core - Ortak Modül Sistemi Kütüphanesi Ana Giriş Noktası
 */

export * from './types';
export {
  ModuleRegistry,
  moduleRegistry,
  ModuleRegistryClass,
  STANDARD_ACTIONS,
} from './ModuleRegistry';
export {
  matchesPermission,
  checkUserPermission,
  ModulePermissionContext,
  ModulePermissionProvider,
  usePermission,
  type ModulePermissionContextValue,
  type ModulePermissionProviderProps,
} from './permissions/permissionUtils';
export {
  AccessDenied,
  type AccessDeniedProps,
} from './guards/AccessDenied';
export {
  RoutePermissionGuard,
  type RoutePermissionGuardProps,
} from './guards/RoutePermissionGuard';
export {
  PermissionGuard,
  type PermissionGuardProps,
} from './guards/PermissionGuard';
export {
  useModuleRegistry,
  useSystemSettingModules,
  useModuleMenuItems,
  registerModule,
} from './hooks/useModuleRegistry';
