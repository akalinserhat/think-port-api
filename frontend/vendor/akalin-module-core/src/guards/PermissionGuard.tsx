import React, { ReactNode } from 'react';
import { usePermission } from '../permissions/permissionUtils';

export interface PermissionGuardProps {
  permission?: string | string[];
  requireAll?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
}

export const PermissionGuard: React.FC<PermissionGuardProps> = ({
  permission,
  requireAll = false,
  fallback = null,
  children,
}) => {
  const allowed = usePermission(permission, { requireAll });
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
};

export default PermissionGuard;
