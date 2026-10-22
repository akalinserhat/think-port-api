import React, { createContext, useContext, ReactNode } from 'react';

/**
 * İki izin anahtarının eşleşip eşleşmediğini (tam eşleşme ve hiyerarşik joker/wildcard) doğrular.
 */
export const matchesPermission = (requiredKey: string, grantedKey: string): boolean => {
  if (!requiredKey || !grantedKey) return false;
  if (grantedKey === '*' || grantedKey === 'ALL') return true;

  const req = requiredKey.toLowerCase().trim();
  const grant = grantedKey.toLowerCase().trim();

  if (req === grant) return true;

  if (grant.endsWith('.*')) {
    const prefix = grant.slice(0, -2);
    if (req === prefix || req.startsWith(prefix + '.')) {
      return true;
    }
  }

  if (grant.endsWith('*')) {
    const prefix = grant.slice(0, -1);
    if (req.startsWith(prefix)) {
      return true;
    }
  }

  return false;
};

/**
 * Kullanıcı nesnesi ve izin listesine göre belirtilen gereksinimlerin karşılanıp karşılanmadığını denetler.
 */
export const checkUserPermission = (
  required?: string | string[],
  userPermissions?: string[],
  user?: any,
  requireAll = false
): boolean => {
  if (!required) return true;
  if (Array.isArray(required) && required.length === 0) return true;

  const roleStr = String(user?.role || '').toLowerCase().trim();
  if (
    user?.isSuperAdmin ||
    user?.isAdmin ||
    roleStr === 'admin' ||
    roleStr === 'superadmin' ||
    roleStr === 'sistem yöneticisi' ||
    user?.roller?.includes('SuperAdmin') ||
    user?.roller?.includes('Admin') ||
    user?.roles?.includes('SuperAdmin') ||
    user?.roles?.includes('Admin')
  ) {
    return true;
  }

  if (!userPermissions || userPermissions.length === 0) {
    return false;
  }

  if (userPermissions.includes('*') || userPermissions.includes('ALL')) {
    return true;
  }

  const reqList = Array.isArray(required) ? required : [required];

  if (requireAll) {
    return reqList.every((req) =>
      userPermissions.some((granted) => matchesPermission(req, granted))
    );
  }

  return reqList.some((req) =>
    userPermissions.some((granted) => matchesPermission(req, granted))
  );
};

export interface ModulePermissionContextValue {
  permissions: string[];
  user?: any;
}

const GLOBAL_PERMISSION_CTX_KEY = '__AKALIN_MODULE_PERMISSION_CONTEXT__';
const g = globalThis as unknown as Record<string, React.Context<ModulePermissionContextValue>>;
if (!g[GLOBAL_PERMISSION_CTX_KEY]) {
  g[GLOBAL_PERMISSION_CTX_KEY] = createContext<ModulePermissionContextValue>({
    permissions: ['*'],
    user: null,
  });
}

export const ModulePermissionContext = g[GLOBAL_PERMISSION_CTX_KEY];

export interface ModulePermissionProviderProps {
  permissions?: string[];
  user?: any;
  children: ReactNode;
}

export const ModulePermissionProvider: React.FC<ModulePermissionProviderProps> = ({
  permissions = ['*'],
  user = null,
  children,
}) => {
  return (
    <ModulePermissionContext.Provider value={{ permissions, user }}>
      {children}
    </ModulePermissionContext.Provider>
  );
};

export const usePermission = (
  permission?: string | string[],
  options?: { requireAll?: boolean }
): boolean => {
  const { permissions, user } = useContext(ModulePermissionContext);
  return checkUserPermission(permission, permissions, user, options?.requireAll ?? false);
};
