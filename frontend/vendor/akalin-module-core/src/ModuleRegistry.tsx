/**
 * @akalin/module_core - Merkezi Modül Yöneticisi (ModuleRegistry.tsx)
 * Tüm uygulamalarda (Webakus.UI, Webakus.AdminUI, OpenAiApi vb.) özellik modüllerini kaydeder,
 * aktif modül filtrelemesini yönetir, dinamik uygulama rotalarını (routes), popup rotalarını (popupRoutes),
 * sol menü ağacını (menuItems), Sistem Ayarları kartlarını (settingsModules) ve RBAC Yetki Matrisini derler.
 */

import React, { Suspense, ReactNode } from 'react';
import { Route } from 'react-router-dom';
import {
  IModuleDefinition,
  IMenuItemDefinition,
  IRouteDefinition,
  IModuleSettingDefinition,
  IModuleActionItem,
  ModuleActionType,
  ModuleItemCategory,
  IModuleEntityDefinition,
  IModulePermissionAction,
  IModulePermission,
  IPermissionItem,
  IModulePermissionMatrixGroup,
} from './types';
import { checkUserPermission } from './permissions/permissionUtils';
import { RoutePermissionGuard } from './guards/RoutePermissionGuard';

/**
 * Varlık kategorilerine göre varsayılan standart izin eylemleri (CRUD)
 */
export const STANDARD_ACTIONS: Record<ModuleItemCategory, IModulePermissionAction[]> = {
  kart: [
    { action: 'goruntule', labelKey: 'Yetki: Görüntüleme', description: 'Kayıtları ve listeleri görüntüleme' },
    { action: 'olustur', labelKey: 'Yetki: Oluşturma', description: 'Yeni kart kaydı ekleme' },
    { action: 'duzenle', labelKey: 'Yetki: Düzenleme', description: 'Mevcut kartı güncelleme' },
    { action: 'sil', labelKey: 'Yetki: Silme', description: 'Kart kaydını silme', danger: true },
  ],
  belge: [
    { action: 'goruntule', labelKey: 'Yetki: Görüntüleme', description: 'Belgeleri ve dökümleri görüntüleme' },
    { action: 'olustur', labelKey: 'Yetki: Oluşturma', description: 'Yeni belge düzenleme' },
    { action: 'duzenle', labelKey: 'Yetki: Düzenleme', description: 'Belge bilgilerini değiştirme' },
    { action: 'sil', labelKey: 'Yetki: Silme', description: 'Belgeyi silme / ters kayıt', danger: true },
    { action: 'yazdir', labelKey: 'Yetki: Yazdırma', description: 'Belge çıktısı ve PDF alma' },
  ],
  rapor: [
    { action: 'goruntule', labelKey: 'Yetki: Görüntüleme', description: 'Raporu görüntüleme ve çalıştırma' },
    { action: 'disa-aktar', labelKey: 'Yetki: Dışa Aktarma', description: 'Excel/PDF dışa aktarım' },
  ],
  islem: [
    { action: 'calistir', labelKey: 'Yetki: İşlemi Çalıştırma', description: 'Özel süreci veya işlemi tetikleme' },
  ],
};

const CORE_MODULE_IDS = new Set([
  'dashboard',
  'auth',
  'sistem-ayarlari',
  'yardim',
  'bildirimler',
  'email-module',
  'EmailModulu',
]);

export class ModuleRegistryClass {
  private modules: Map<string, IModuleDefinition> = new Map();
  private activeModuleCodes: Set<string> | null = null;
  private listeners: Array<() => void> = [];

  /**
   * Yeni bir modülü sisteme kaydeder
   */
  public register(module: IModuleDefinition): void {
    if (!module || !module.id) {
      console.warn('[ModuleRegistry] Geçersiz modül tanımı:', module);
      return;
    }

    const normalizedModule: IModuleDefinition = {
      ...module,
      title: module.title || module.name || module.id,
      name: module.name || module.title || module.id,
      routes: module.routes || [],
      menuItems: module.menuItems || [],
      settingsModules: module.settingsModules || [],
    };

    this.modules.set(normalizedModule.id, normalizedModule);

    if (Array.isArray(normalizedModule.subModules)) {
      normalizedModule.subModules.forEach((sub) => this.register(sub));
    }

    const initFn = normalizedModule.onInitialize || normalizedModule.initialize;
    if (typeof initFn === 'function') {
      try {
        initFn();
      } catch (err) {
        console.error(`[ModuleRegistry] '${normalizedModule.id}' initialize hatası:`, err);
      }
    }

    this.notify();
  }

  /**
   * Birden fazla modülü topluca sisteme kaydeder
   */
  public registerAll(modules: IModuleDefinition[]): void {
    if (!Array.isArray(modules)) return;
    modules.forEach((mod) => this.register(mod));
  }

  /**
   * Aktif / lisanslı modül kodlarını belirler ve dinleyicileri tetikler
   */
  public setActiveModules(codes: string[] | null): void {
    if (codes === null) {
      this.activeModuleCodes = null;
    } else {
      this.activeModuleCodes = new Set(codes.map((c) => this.normalizeCode(c)));
    }
    this.notify();
  }

  /**
   * Bir modülün aktif olup olmadığını belirler
   */
  public isModuleActive(module: IModuleDefinition): boolean {
    if (!module) return false;

    if (module.isCore || CORE_MODULE_IDS.has(module.id)) {
      return true;
    }

    if (this.activeModuleCodes === null) {
      return module.defaultActive !== false;
    }

    const modIdNorm = this.normalizeCode(module.id);

    for (const activeCode of this.activeModuleCodes) {
      if (!activeCode) continue;
      if (activeCode === modIdNorm) return true;

      const cleanActive = activeCode.replace(/^mod_?/, '');
      const cleanModId = modIdNorm.replace(/^mod_?/, '');

      if (cleanActive === cleanModId) return true;
      if (cleanActive.length >= 3 && cleanModId.includes(cleanActive)) return true;
      if (cleanModId.length >= 3 && cleanActive.includes(cleanModId)) return true;
    }

    return false;
  }

  private normalizeCode(str: string): string {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Kayıtlı tüm modülleri liste olarak döner (sıralı)
   */
  public getModules(): IModuleDefinition[] {
    return Array.from(this.modules.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  /**
   * Yalnızca aktif olan modülleri döner (sıralı)
   */
  public getActiveModules(): IModuleDefinition[] {
    return this.getModules().filter((mod) => this.isModuleActive(mod));
  }

  /**
   * Tekil modül döner
   */
  public getModule(id: string): IModuleDefinition | undefined {
    return this.modules.get(id);
  }

  /**
   * Yalnızca aktif modüllerin ana sayfa rotalarını React Router `<Route>` JSX elemanları dizisi olarak döner
   */
  public getRoutes(): ReactNode[] {
    const routeElements: ReactNode[] = [];
    const activeModules = this.getActiveModules();

    activeModules.forEach((mod) => {
      if (Array.isArray(mod.routes)) {
        mod.routes.forEach((route) => {
          const perms =
            route.requiredPermissions ||
            (route.requiredPermission ? [route.requiredPermission] : undefined);

          routeElements.push(
            <Route
              key={route.path}
              path={route.path}
              element={this.wrapRouteElement(route.element, perms)}
            />
          );

          if (
            !route.path.endsWith('/bulut-dosyalari') &&
            !route.path.endsWith('/excel-import') &&
            !route.path.endsWith('/cari-secim') &&
            (route.path.endsWith('/yeni') ||
              route.path.includes('/:id') ||
              route.path.includes('/duzenle/'))
          ) {
            const subPaths = ['bulut-dosyalari', 'excel-import', 'cari-secim'];
            subPaths.forEach((sub) => {
              const fullSubPath = `${route.path}/${sub}`;
              if (!mod.routes?.some((r) => r.path === fullSubPath)) {
                routeElements.push(
                  <Route
                    key={fullSubPath}
                    path={fullSubPath}
                    element={this.wrapRouteElement(route.element, perms)}
                  />
                );
              }
            });
          }
        });
      }
    });

    return routeElements;
  }

  /**
   * Bağımsız popup rotalarını (/popup/*) React Router `<Route>` JSX elemanları dizisi olarak döner
   */
  public getPopupRoutes(): ReactNode[] {
    const popupRouteElements: ReactNode[] = [];
    const activeModules = this.getActiveModules();

    activeModules.forEach((mod) => {
      if (Array.isArray(mod.popupRoutes)) {
        mod.popupRoutes.forEach((route) => {
          const perms =
            route.requiredPermissions ||
            (route.requiredPermission ? [route.requiredPermission] : undefined);
          popupRouteElements.push(
            <Route
              key={route.path}
              path={route.path}
              element={this.wrapRouteElement(route.element, perms)}
            />
          );
        });
      }
    });

    return popupRouteElements;
  }

  /**
   * Aktif modüllerin ham rota tanımlarını döner
   */
  public getRouteDefinitions(): IRouteDefinition[] {
    const allRoutes: IRouteDefinition[] = [];
    const activeModules = this.getActiveModules();

    activeModules.forEach((mod) => {
      if (Array.isArray(mod.routes)) {
        mod.routes.forEach((route) => {
          allRoutes.push({ ...route });
        });
      }
    });

    return allRoutes;
  }

  private wrapRouteElement(element: ReactNode, requiredPermissions?: string[]): ReactNode {
    return (
      <Suspense fallback={null}>
        {requiredPermissions && requiredPermissions.length > 0 ? (
          <RoutePermissionGuard requiredPermissions={requiredPermissions}>
            {element}
          </RoutePermissionGuard>
        ) : (
          element
        )}
      </Suspense>
    );
  }

  /**
   * Sistem Ayarları (BaseSystemPage) için kayıtlı modüllerin ayar kartlarını döner.
   * Dışarıdan yüklenen modüller (ör. @akalin/email_module) kendi settingsModules tanımlarını
   * bu metot üzerinden otomatik olarak Sistem Ayarları sayfasına enjekte eder.
   */
  public getSettingsModules(options?: {
    activeOnly?: boolean;
    permissions?: string[];
    user?: any;
  }): IModuleSettingDefinition[] {
    const activeOnly = options?.activeOnly ?? true;
    const targetModules = activeOnly ? this.getActiveModules() : this.getModules();
    const settingMap = new Map<string, IModuleSettingDefinition>();

    targetModules.forEach((mod) => {
      if (Array.isArray(mod.settingsModules)) {
        mod.settingsModules.forEach((setting) => {
          if (
            setting.requiredPermissions &&
            setting.requiredPermissions.length > 0 &&
            options?.permissions
          ) {
            if (
              !this.hasPermission(
                setting.requiredPermissions,
                options.permissions,
                options.user
              )
            ) {
              return;
            }
          }
          settingMap.set(setting.id, {
            ...setting,
            order: setting.order ?? mod.order ?? 100,
          });
        });
      }
    });

    return Array.from(settingMap.values()).sort(
      (a, b) => (a.order ?? 100) - (b.order ?? 100)
    );
  }

  public getNavHierarchy(): IMenuItemDefinition[] {
    return this.getMenuItems();
  }

  public getMenuItems(): IMenuItemDefinition[] {
    const rawItems: IMenuItemDefinition[] = [];
    const activeModules = this.getActiveModules();

    activeModules.forEach((mod) => {
      if (Array.isArray(mod.menuItems)) {
        mod.menuItems.forEach((item) => {
          rawItems.push({ ...item, id: item.id || item.path || item.label });
        });
      }
    });

    const rootItems: IMenuItemDefinition[] = [];
    const childrenMap = new Map<string, IMenuItemDefinition[]>();

    rawItems.forEach((item) => {
      if (item.parentId) {
        if (!childrenMap.has(item.parentId)) {
          childrenMap.set(item.parentId, []);
        }
        childrenMap.get(item.parentId)!.push(item);
      } else {
        rootItems.push(item);
      }
    });

    const buildTree = (items: IMenuItemDefinition[]): IMenuItemDefinition[] => {
      return items
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((item) => {
          const directChildren = item.children || [];
          const parentLinkedChildren = item.id ? childrenMap.get(item.id) || [] : [];
          const combinedChildren = [...directChildren, ...parentLinkedChildren];

          if (combinedChildren.length > 0) {
            return {
              ...item,
              children: buildTree(combinedChildren),
            };
          }
          return item;
        });
    };

    return buildTree(rootItems);
  }

  public getModulePermissionPrefix(module: IModuleDefinition): string {
    if (!module) return '';
    if (module.permissionPrefix) return module.permissionPrefix;
    return module.id
      .toLowerCase()
      .replace(/^mod_?/, '')
      .replace(/-yonetimi$/, '')
      .replace(/-ve-irsaliye$/, '')
      .replace(/-ve-stok$/, '')
      .replace(/-modulu$/, '')
      .replace(/-module$/, '')
      .replace(/[^a-z0-9]/g, '');
  }

  public getAllEntities(
    activeOnly = false
  ): Array<IModuleEntityDefinition & { moduleId: string; permissionPrefix: string; moduleTitle: string }> {
    const targetModules = activeOnly ? this.getActiveModules() : this.getModules();
    const entities: Array<
      IModuleEntityDefinition & { moduleId: string; permissionPrefix: string; moduleTitle: string }
    > = [];

    targetModules.forEach((mod) => {
      const prefix = this.getModulePermissionPrefix(mod);
      const modTitle = mod.title || mod.name || mod.id;
      const addEntities = (list?: IModuleEntityDefinition[]) => {
        if (Array.isArray(list)) {
          list.forEach((ent) => {
            entities.push({
              ...ent,
              moduleId: mod.id,
              permissionPrefix: prefix,
              moduleTitle: modTitle,
            });
          });
        }
      };

      addEntities(mod.cards);
      addEntities(mod.documents);
      addEntities(mod.reports);
      addEntities(mod.operations);
    });

    return entities;
  }

  public getAllPermissions(activeOnly = false): IPermissionItem[] {
    const permissions: IPermissionItem[] = [];
    const targetModules = activeOnly ? this.getActiveModules() : this.getModules();

    targetModules.forEach((mod) => {
      const prefix = this.getModulePermissionPrefix(mod);
      const modTitle = mod.title || mod.name || mod.id;

      const processEntityList = (list?: IModuleEntityDefinition[]) => {
        if (!Array.isArray(list)) return;

        list.forEach((entity) => {
          const actionMap = new Map<string, IModulePermissionAction>();

          if (entity.useStandardCrud !== false) {
            const standardList = STANDARD_ACTIONS[entity.category] || [];
            standardList.forEach((act) => actionMap.set(act.action, act));
          }

          if (Array.isArray(entity.customActions)) {
            entity.customActions.forEach((act) => actionMap.set(act.action, act));
          }

          actionMap.forEach((act) => {
            const permissionKey = `${prefix}.${entity.category}.${entity.id}.${act.action}`;
            permissions.push({
              key: permissionKey,
              moduleId: mod.id,
              permissionPrefix: prefix,
              category: entity.category,
              entityId: entity.id,
              action: act.action,
              labelKey: act.labelKey,
              description: act.description,
              danger: act.danger,
              entityTitleKey: entity.titleKey,
              moduleTitle: modTitle,
              route: entity.route,
            });
          });
        });
      };

      processEntityList(mod.cards);
      processEntityList(mod.documents);
      processEntityList(mod.reports);
      processEntityList(mod.operations);

      // Doğrudan tanımlanan permissions dizisi (AdminUI / OpenAiApi uyumluluğu)
      if (Array.isArray(mod.permissions)) {
        mod.permissions.forEach((perm: IModulePermission) => {
          if (!permissions.some((p) => p.key === perm.key)) {
            permissions.push({
              key: perm.key,
              moduleId: mod.id,
              permissionPrefix: prefix,
              category: 'islem',
              entityId: perm.key,
              action: perm.key,
              labelKey: perm.name,
              description: perm.description,
              danger: perm.danger,
              entityTitleKey: perm.group || modTitle,
              moduleTitle: modTitle,
            });
          }
        });
      }
    });

    return permissions;
  }

  public getPermissionMatrix(activeOnly = false): IModulePermissionMatrixGroup[] {
    const targetModules = activeOnly ? this.getActiveModules() : this.getModules();
    const matrix: IModulePermissionMatrixGroup[] = [];

    targetModules.forEach((mod) => {
      const prefix = this.getModulePermissionPrefix(mod);
      const modTitle = mod.title || mod.name || mod.id;
      const allModEntities: IModuleEntityDefinition[] = [
        ...(mod.cards || []),
        ...(mod.documents || []),
        ...(mod.reports || []),
        ...(mod.operations || []),
      ];

      const groupEntities: IModulePermissionMatrixGroup['entities'] = allModEntities.map((entity) => {
        const actionMap = new Map<string, IModulePermissionAction>();

        if (entity.useStandardCrud !== false) {
          const standardList = STANDARD_ACTIONS[entity.category] || [];
          standardList.forEach((act) => actionMap.set(act.action, act));
        }

        if (Array.isArray(entity.customActions)) {
          entity.customActions.forEach((act) => actionMap.set(act.action, act));
        }

        const actions: IPermissionItem[] = [];
        actionMap.forEach((act) => {
          actions.push({
            key: `${prefix}.${entity.category}.${entity.id}.${act.action}`,
            moduleId: mod.id,
            permissionPrefix: prefix,
            category: entity.category,
            entityId: entity.id,
            action: act.action,
            labelKey: act.labelKey,
            description: act.description,
            danger: act.danger,
            entityTitleKey: entity.titleKey,
            moduleTitle: modTitle,
            route: entity.route,
          });
        });

        return {
          id: entity.id,
          category: entity.category,
          titleKey: entity.titleKey,
          route: entity.route,
          actions,
        };
      });

      if (Array.isArray(mod.permissions) && mod.permissions.length > 0) {
        groupEntities.push({
          id: `${mod.id}-direct-permissions`,
          category: 'islem',
          titleKey: modTitle,
          route: undefined,
          actions: mod.permissions.map((perm) => ({
            key: perm.key,
            moduleId: mod.id,
            permissionPrefix: prefix,
            category: 'islem',
            entityId: perm.key,
            action: perm.key,
            labelKey: perm.name,
            description: perm.description,
            danger: perm.danger,
            entityTitleKey: perm.group || modTitle,
            moduleTitle: modTitle,
          })),
        });
      }

      if (groupEntities.length === 0) return;

      matrix.push({
        moduleId: mod.id,
        moduleTitle: modTitle,
        permissionPrefix: prefix,
        entities: groupEntities,
      });
    });

    return matrix;
  }

  public hasPermission(
    permission?: string | string[],
    userPermissions?: string[],
    user?: any,
    requireAll = false
  ): boolean {
    return checkUserPermission(permission, userPermissions, user, requireAll);
  }

  public getFilteredMenuItems(permissions?: string[], user?: any): IMenuItemDefinition[] {
    const rawItems: IMenuItemDefinition[] = [];
    const activeModules = this.getActiveModules();

    activeModules.forEach((mod) => {
      if (mod.requiredPermissions && mod.requiredPermissions.length > 0) {
        if (!this.hasPermission(mod.requiredPermissions, permissions, user)) {
          return;
        }
      }

      if (Array.isArray(mod.menuItems)) {
        mod.menuItems.forEach((item) => {
          rawItems.push({ ...item, id: item.id || item.path || item.label });
        });
      }
    });

    const rootItems: IMenuItemDefinition[] = [];
    const childrenMap = new Map<string, IMenuItemDefinition[]>();

    rawItems.forEach((item) => {
      if (item.parentId) {
        if (!childrenMap.has(item.parentId)) {
          childrenMap.set(item.parentId, []);
        }
        childrenMap.get(item.parentId)!.push(item);
      } else {
        rootItems.push(item);
      }
    });

    const buildFilteredTree = (items: IMenuItemDefinition[]): IMenuItemDefinition[] => {
      const allowedItems: IMenuItemDefinition[] = [];

      items
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .forEach((item) => {
          const itemPerms =
            item.requiredPermissions ||
            (item.requiredPermission ? [item.requiredPermission] : undefined);
          if (itemPerms && itemPerms.length > 0) {
            if (!this.hasPermission(itemPerms, permissions, user)) {
              return;
            }
          }

          const directChildren = item.children || [];
          const parentLinkedChildren = item.id ? childrenMap.get(item.id) || [] : [];
          const combinedChildren = [...directChildren, ...parentLinkedChildren];

          if (combinedChildren.length > 0) {
            const filteredChildren = buildFilteredTree(combinedChildren);
            if (filteredChildren.length === 0 && !item.path) {
              return;
            }
            allowedItems.push({
              ...item,
              children: filteredChildren,
            });
          } else {
            allowedItems.push(item);
          }
        });

      return allowedItems;
    };

    return buildFilteredTree(rootItems);
  }

  public getFilteredNavHierarchy(permissions?: string[], user?: any): IMenuItemDefinition[] {
    return this.getFilteredMenuItems(permissions, user);
  }

  public isActionAllowed(
    action: IModuleActionItem,
    permissions?: string[],
    user?: any,
    contextData?: any
  ): boolean {
    if (!action) return false;

    if (Array.isArray(action.requiredPermissions) && action.requiredPermissions.length > 0) {
      if (!this.hasPermission(action.requiredPermissions, permissions, user, true)) {
        return false;
      }
    }

    if (typeof action.isAllowed === 'function') {
      try {
        return action.isAllowed(permissions || [], user, contextData);
      } catch (err) {
        console.error(`[ModuleRegistry] Action '${action.id}' isAllowed hatası:`, err);
        return false;
      }
    }

    return true;
  }

  public getActions(options?: {
    placement?: string;
    targetContext?: string;
    type?: ModuleActionType;
    permissions?: string[];
    user?: any;
    contextData?: any;
  }): IModuleActionItem[] {
    const rawActions: IModuleActionItem[] = [];
    const activeModules = this.getActiveModules();

    activeModules.forEach((mod) => {
      if (Array.isArray(mod.actions)) {
        mod.actions.forEach((act) => {
          rawActions.push(act);
        });
      }
    });

    const filterAction = (act: IModuleActionItem): IModuleActionItem | null => {
      if (
        options?.placement &&
        act.placement &&
        act.placement !== options.placement &&
        act.placement !== 'global'
      ) {
        return null;
      }

      if (
        options?.targetContext &&
        act.targetContext &&
        act.targetContext !== options.targetContext
      ) {
        return null;
      }

      if (options?.type && act.type && act.type !== options.type) {
        return null;
      }

      if (
        !this.isActionAllowed(act, options?.permissions, options?.user, options?.contextData)
      ) {
        return null;
      }

      let filteredActions: IModuleActionItem[] | undefined = undefined;
      if (Array.isArray(act.actions)) {
        filteredActions = act.actions
          .map((subAct) => filterAction(subAct))
          .filter((subAct): subAct is IModuleActionItem => subAct !== null)
          .sort((a, b) => (a.order || 0) - (b.order || 0));
      }

      let filteredChildren: IModuleActionItem[] | undefined = undefined;
      if (Array.isArray(act.children)) {
        filteredChildren = act.children
          .map((subAct) => filterAction(subAct))
          .filter((subAct): subAct is IModuleActionItem => subAct !== null)
          .sort((a, b) => (a.order || 0) - (b.order || 0));
      }

      return {
        ...act,
        actions: filteredActions,
        children: filteredChildren,
      };
    };

    return rawActions
      .map((act) => filterAction(act))
      .filter((act): act is IModuleActionItem => act !== null)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  public getActionMenuItems(
    placement: string,
    options?: {
      targetContext?: string;
      permissions?: string[];
      user?: any;
      contextData?: any;
    }
  ) {
    const actions = this.getActions({
      placement,
      targetContext: options?.targetContext,
      permissions: options?.permissions,
      user: options?.user,
      contextData: options?.contextData,
    });

    return actions.map((act) => ({
      id: act.id,
      label: act.label,
      icon: act.icon,
      onClick: (e?: any) => {
        if (typeof act.onClick === 'function') {
          act.onClick(e, options?.contextData);
        }
      },
      danger: act.danger,
      title: act.title || act.label,
      badge: act.badge,
      dividerBefore: act.dividerBefore,
      dividerAfter: act.dividerAfter,
      component: act.component,
      actions: act.actions,
    }));
  }

  public getComponent<T = React.ComponentType<any>>(
    moduleId: string,
    componentName: string
  ): T | undefined {
    const mod = this.getActiveModules().find((m) => m.id === moduleId);
    if (!mod || !mod.components) return undefined;
    return mod.components[componentName] as unknown as T;
  }

  public getAllComponents<T = React.ComponentType<any>>(
    componentName: string
  ): Array<{ moduleId: string; component: T }> {
    const result: Array<{ moduleId: string; component: T }> = [];
    this.getActiveModules().forEach((mod) => {
      if (mod.components && mod.components[componentName]) {
        result.push({
          moduleId: mod.id,
          component: mod.components[componentName] as unknown as T,
        });
      }
    });
    return result;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('[ModuleRegistry] Dinleyici hata verdi:', err);
      }
    });
  }

  public clear(): void {
    this.modules.clear();
    this.activeModuleCodes = null;
    this.notify();
  }
}

const GLOBAL_REGISTRY_KEY = '__AKALIN_MODULE_REGISTRY_SINGLETON__';
const globalScope = globalThis as unknown as Record<string, ModuleRegistryClass>;
if (!globalScope[GLOBAL_REGISTRY_KEY]) {
  globalScope[GLOBAL_REGISTRY_KEY] = new ModuleRegistryClass();
}

export const ModuleRegistry: ModuleRegistryClass = globalScope[GLOBAL_REGISTRY_KEY];
export const moduleRegistry: ModuleRegistryClass = ModuleRegistry;
export default ModuleRegistry;
