import React from 'react';
import { ShieldAlert } from 'lucide-react';

export interface AccessDeniedProps {
  requiredPermission?: string | string[];
  title?: string;
  description?: string;
}

export const AccessDenied: React.FC<AccessDeniedProps> = ({
  requiredPermission,
  title = 'Bu Sayfaya Erişim Yetkiniz Bulunmuyor',
  description = 'Bu modülü veya işlemi görüntülemek için gerekli sistem yetkisine sahip değilsiniz. Lütfen sistem yöneticinizle iletişime geçin.',
}) => {
  const permText = Array.isArray(requiredPermission)
    ? requiredPermission.join(', ')
    : requiredPermission;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
        borderRadius: '16px',
        border: '1px solid var(--glass-border, rgba(148, 163, 184, 0.2))',
        background: 'var(--bg-secondary, #f8fafc)',
        margin: '24px',
        gap: '12px',
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          background: 'rgba(239, 68, 68, 0.12)',
          color: 'var(--danger, #ef4444)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ShieldAlert size={28} />
      </div>
      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
        {title}
      </h3>
      <p
        style={{
          margin: 0,
          maxWidth: '480px',
          fontSize: '13.5px',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
      {permText && (
        <code
          style={{
            marginTop: '6px',
            padding: '4px 10px',
            borderRadius: '8px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--glass-border)',
            fontSize: '12px',
            color: 'var(--text-secondary)',
          }}
        >
          Gerekli Yetki: {permText}
        </code>
      )}
    </div>
  );
};

export default AccessDenied;
