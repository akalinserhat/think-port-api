/**
 * @file EmailInput.tsx
 * @description 
 * Projede standart e-posta girişi için kullanılan özel input bileşeni.
 * 
 * Başlıca Görevleri:
 * - Kullanıcı yazarken anlık regex ile e-posta format doğrulaması yapar ve hata mesajı gösterir.
 * - Geçerli bir e-posta girildiğinde doğrudan 'mailto:' bağlantısı ile hızlı e-posta gönderme aksiyonu sunar.
 * - Dışarıdan iletilen form seviyesi `error` prop'unu destekler ve görsel hata durumunu yönetir.
 */

import React, { useState, forwardRef } from 'react';
import { Mail, ExternalLink, AlertCircle } from 'lucide-react';

export interface EmailInputProps {
  name?: string;
  value?: string;
  onChange?: (e: any) => void;
  onBlur?: (e: any) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}

const EmailInput = forwardRef<HTMLInputElement, EmailInputProps>(({
  name,
  value = '',
  onChange,
  onBlur,
  placeholder = 'ornek@sirket.com',
  required = false,
  disabled = false,
  error,
  className = '',
  style = {},
  autoFocus = false
}, ref) => {
  const [isFocused, setIsFocused] = useState(false);
  const [localError, setLocalError] = useState('');

  const validateEmail = (email: string) => {
    if (!email) return true;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;

    if (val && !validateEmail(val)) {
      setLocalError('Geçersiz e-posta formatı');
    } else {
      setLocalError('');
    }

    if (onChange) {
      onChange(e);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    if (onBlur) onBlur(e);
  };

  const isValid = value && validateEmail(value);
  const hasError = error || localError;

  return (
    <div style={{ position: 'relative', width: '100%', ...style }} className={className}>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'stretch',
          border: `1px solid ${hasError ? 'var(--danger)' : isFocused ? 'var(--accent-primary)' : 'var(--glass-border)'}`,
          borderRadius: '10px',
          background: disabled ? 'var(--bg-secondary)' : 'var(--input-bg)',
          transition: 'all 0.2s ease',
          boxShadow: isFocused && !hasError ? '0 0 0 3px var(--accent-light)' : 'none',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            padding: '0 0 0 14px',
            display: 'flex',
            alignItems: 'center',
            color: hasError ? 'var(--danger)' : isFocused ? 'var(--accent-primary)' : 'var(--text-secondary)'
          }}
        >
          <Mail size={18} />
        </div>

        <input
          ref={ref}
          type="email"
          name={name}
          value={value || ''}
          onChange={handleChange}
          onFocus={() => setIsFocused(true)}
          onBlur={handleBlur}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            padding: '10px 14px',
            outline: 'none',
            color: 'var(--text-primary)',
            width: '100%',
            fontSize: '14px'
          }}
        />

        {isValid && !disabled && (
          <a
            href={`mailto:${value}`}
            title="E-posta gönder"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 14px',
              color: 'var(--accent-primary)',
              cursor: 'pointer',
              borderLeft: '1px solid var(--glass-border)',
              background: 'transparent',
              transition: 'all 0.2s',
              textDecoration: 'none'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'var(--accent-primary)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--accent-primary)';
            }}
          >
            <ExternalLink size={16} />
          </a>
        )}

        {hasError && !isValid && (
          <div
            style={{
              padding: '0 14px',
              color: 'var(--danger)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <AlertCircle size={16} />
          </div>
        )}
      </div>
      {localError && !error && (
        <div style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '4px', fontWeight: '500' }}>
          {localError}
        </div>
      )}
    </div>
  );
});

EmailInput.displayName = 'EmailInput';

export default EmailInput;
