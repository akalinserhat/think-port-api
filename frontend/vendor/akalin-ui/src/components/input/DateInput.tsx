/**
 * @file DateInput.tsx
 * @description Akalin UI - Tarih Giriş Bileşeni.
 * SpreadsheetGrid ve formlarda tabbing/odaklanma uyumlu, takvim seçicili ve formatlı tarih girişi sağlar.
 */

import React, { useRef, forwardRef } from 'react';

export interface DateInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
    value?: string | null;
    onChange?: (e: React.ChangeEvent<HTMLInputElement> | any) => void;
    className?: string;
    style?: React.CSSProperties;
    disabled?: boolean;
    id?: string;
    name?: string;
    autoFocus?: boolean;
}

const DateInput = forwardRef<HTMLInputElement, DateInputProps>(({ 
    value, 
    onChange, 
    className, 
    style, 
    disabled, 
    id,
    name,
    autoFocus,
    onKeyDown,
    onClick,
    ...props 
}, ref) => {
    const internalRef = useRef<HTMLInputElement>(null);
    const resolvedRef = (ref as React.RefObject<HTMLInputElement>) || internalRef;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Stop Tab propagation to prevent parent grids (like SpreadsheetGrid) 
        // from intercepting it before we finish tabbing through the date parts (DD, MM, YYYY).
        if (e.key === 'Tab') {
            e.stopPropagation();
        }
        if (onKeyDown) {
            onKeyDown(e);
        }
    };

    const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
        try {
            const target = e.target as HTMLInputElement;
            if (target && typeof (target as any).showPicker === 'function') {
                (target as any).showPicker();
            }
        } catch (err) {
            // Ignore if showPicker is not supported or throws
        }
        if (onClick) {
            onClick(e);
        }
    };

    return (
        <input
            id={id}
            name={name}
            ref={resolvedRef}
            type="date"
            className={className}
            style={{
                cursor: 'text',
                ...style
            }}
            value={value || ''}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            onClick={handleClick}
            disabled={disabled}
            autoFocus={autoFocus}
            {...props}
        />
    );
});

DateInput.displayName = 'DateInput';

export default DateInput;
