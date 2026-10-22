import React from 'react';
import { Loader2 } from 'lucide-react';

export interface BaseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  disabled?: boolean;
  text?: string;
  loadingText?: string;
  isSaving?: boolean;
  type?: 'button' | 'submit' | 'reset';
  style?: React.CSSProperties;
  className?: string;
  variant?: 'primary' | 'outline' | 'danger' | 'success' | 'warning' | string;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  form?: string;
  title?: string;
}

const BaseButton = ({ 
  onClick, 
  disabled, 
  text = '', 
  loadingText = 'İşleniyor...', 
  isSaving = false, 
  type = 'button', 
  style, 
  className = '', 
  variant = 'primary', 
  icon, 
  iconPosition = 'left',
  form, 
  ...rest 
}: BaseButtonProps) => {
  return (
    <button 
      type={type} 
      className={`btn btn-${variant} ${className}`} 
      onClick={onClick} 
      disabled={disabled || isSaving}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', ...style }}
      form={form}
      {...rest}
    >
      {isSaving ? (
        <Loader2 size={18} className="spinner" style={{ animation: 'spin 1s linear infinite' }} />
      ) : (
        iconPosition === 'left' ? icon : null
      )}
      {isSaving ? loadingText : text}
      {!isSaving && iconPosition === 'right' ? icon : null}
    </button>
  );
};

export default BaseButton;
