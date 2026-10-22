import React, { ButtonHTMLAttributes } from 'react';
import { LucideIcon } from 'lucide-react';

export interface BaseFloatCircleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    icon: LucideIcon;
    position?: 'fixed-bottom-right' | 'fixed-bottom-left' | 'absolute-bottom-right' | 'absolute-top-right' | 'relative';
    color?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning';
    size?: number; // Icon size
    buttonSize?: number | string; // Numeric value for width/height (default: 56)
    useShadow?: boolean; // Whether to render elevation shadow (default: true)
}

export const BaseFloatCircleButton: React.FC<BaseFloatCircleButtonProps> = ({
    icon: Icon,
    position = 'absolute-bottom-right',
    color = 'primary',
    size = 24, // Material FAB default icon size
    buttonSize = 56, // Material standard FAB size (56x56)
    useShadow = true,
    className = '',
    style,
    ...props
}) => {
    const positionStyles: Record<string, React.CSSProperties> = {
        'fixed-bottom-right': { position: 'fixed', bottom: '48px', right: '48px', zIndex: 50 },
        'fixed-bottom-left': { position: 'fixed', bottom: '48px', left: '48px', zIndex: 50 },
        'absolute-bottom-right': { position: 'absolute', bottom: '36px', right: '36px', zIndex: 10 },
        'absolute-top-right': { position: 'absolute', top: '36px', right: '36px', zIndex: 10 },
        'relative': { position: 'relative' }
    };

    const colorStyles: Record<string, React.CSSProperties> = {
        primary: { backgroundColor: 'var(--accent-primary)', color: 'white' },
        secondary: { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)' },
        danger: { backgroundColor: 'var(--danger)', color: 'white' },
        success: { backgroundColor: 'var(--success)', color: 'white' },
        warning: { backgroundColor: 'var(--warning)', color: 'white' }
    };

    const defaultShadow = useShadow ? '0 6px 16px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.15)' : 'none';
    const hoverShadow = useShadow ? '0 10px 28px rgba(0, 0, 0, 0.35), 0 4px 10px rgba(0, 0, 0, 0.2)' : 'none';
    const activeShadow = useShadow ? '0 3px 8px rgba(0, 0, 0, 0.2)' : 'none';

    const baseStyles: React.CSSProperties = {
        width: buttonSize,
        height: buttonSize,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: defaultShadow,
        border: 'none',
        padding: 0,
        flexShrink: 0,
        transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        ...positionStyles[position],
        ...colorStyles[color],
        ...style
    };

    return (
        <button
            type="button"
            style={baseStyles}
            className={`fab-button ${className}`}
            onMouseOver={(e) => {
                e.currentTarget.style.transform = 'scale(1.06)';
                if (useShadow) e.currentTarget.style.boxShadow = hoverShadow;
            }}
            onMouseOut={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                if (useShadow) e.currentTarget.style.boxShadow = defaultShadow;
            }}
            onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.94)';
                if (useShadow) e.currentTarget.style.boxShadow = activeShadow;
            }}
            onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1.06)';
                if (useShadow) e.currentTarget.style.boxShadow = hoverShadow;
            }}
            {...props}
        >
            <Icon size={size} />
        </button>
    );
};

export default BaseFloatCircleButton;
