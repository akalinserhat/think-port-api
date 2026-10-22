import { useState, useEffect, useMemo } from 'react';
import { ModuleRegistry } from '../ModuleRegistry';
import {
  IModuleDefinition,
  IMenuItemDefinition,
  IModuleSettingDefinition,
} from '../types';

/**
 * ModuleRegistry üzerindeki değişikliklere reaktif olarak abone olan temel hook.
 */
export function useModuleRegistry() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    return ModuleRegistry.subscribe(() => {
      setVersion((v) => v + 1);
    });
  }, []);

  return useMemo(
    () => ({
      registry: ModuleRegistry,
      modules: ModuleRegistry.getModules(),
      activeModules: ModuleRegistry.getActiveModules(),
      routes: ModuleRegistry.getRoutes(),
      popupRoutes: ModuleRegistry.getPopupRoutes(),
      menuItems: ModuleRegistry.getMenuItems(),
      settingsModules: ModuleRegistry.getSettingsModules(),
      permissionMatrix: ModuleRegistry.getPermissionMatrix(),
      allPermissions: ModuleRegistry.getAllPermissions(),
    }),
    [version]
  );
}

/**
 * BaseSystemPage (Sistem Ayarları) içerisine enjekte edilen tüm modül ayar kartlarını reaktif döner.
 */
export function useSystemSettingModules(options?: {
  activeOnly?: boolean;
  permissions?: string[];
  user?: any;
}): IModuleSettingDefinition[] {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    return ModuleRegistry.subscribe(() => {
      setVersion((v) => v + 1);
    });
  }, []);

  return useMemo(
    () => ModuleRegistry.getSettingsModules(options),
    [version, options?.activeOnly, options?.permissions, options?.user]
  );
}

/**
 * Sol menü öğelerini yetkilere göre filtrelenmiş olarak reaktif döner.
 */
export function useModuleMenuItems(
  permissions?: string[],
  user?: any
): IMenuItemDefinition[] {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    return ModuleRegistry.subscribe(() => {
      setVersion((v) => v + 1);
    });
  }, []);

  return useMemo(
    () => ModuleRegistry.getFilteredMenuItems(permissions, user),
    [version, permissions, user]
  );
}

export function registerModule(module: IModuleDefinition): void {
  ModuleRegistry.register(module);
}
