import React, { ReactNode } from 'react';
import { usePermission } from '../permissions/permissionUtils';
import { AccessDenied } from './AccessDenied';

export interface RoutePermissionGuardProps {
  requiredPermissions?: string[];
  children: ReactNode;
}

export const RoutePermissionGuard: React.FC<RoutePermissionGuardProps> = ({
  requiredPermissions,
  children,
}) => {
  const hasAccess = usePermission(requiredPermissions, { requireAll: true });

  if (requiredPermissions && requiredPermissions.length > 0 && !hasAccess) {
    return <AccessDenied requiredPermission={requiredPermissions} />;
  }

  return <>{children}</>;
};

export default RoutePermissionGuard;
