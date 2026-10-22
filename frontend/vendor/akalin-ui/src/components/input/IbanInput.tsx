/**
 * @file IbanInput.tsx
 * @description 
 * Akalin UI - IBAN Giriş ve Formatlama Bileşeni (IbanInput)
 * 
 * Başlıca Görevleri:
 * - IBAN metnini 4'erli bloklar halinde formatlayarak kullanıcıya gösterir.
 * - Uluslararası standart MOD-97 algoritması ile anlık IBAN doğrulaması yapar.
 * - Geçerlilik durumunu görsel hata mesajı ile anlık bildirir.
 */

import React, { useState, useEffect, forwardRef } from 'react';
import { CreditCard } from 'lucide-react';
import BaseInput from '../base/input/BaseInput';

export interface IbanInputProps {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onValidityChange?: (isValid: boolean) => void;
    name?: string;
    placeholder?: string;
    required?: boolean;
    className?: string;
    style?: React.CSSProperties;
    autoFocus?: boolean;
    disabled?: boolean;
}

/**
 * IBAN MOD-97 algoritması ile matematiksel doğrulama
 */
export const validateIBAN = (iban: string): boolean => {
    const sanitizedIBAN = iban.replace(/\s+/g, '').toUpperCase();
    if (sanitizedIBAN.length < 15) return false; // Minimum length for any IBAN is 15
    
    // 1. İlk 4 karakteri sona taşı
    const rearranged = sanitizedIBAN.substr(4) + sanitizedIBAN.substr(0, 4);
    
    // 2. Harfleri sayılara çevir (A=10, B=11 ... Z=35)
    let numericIBAN = '';
    for (let i = 0; i < rearranged.length; i++) {
        const code = rearranged.charCodeAt(i);
        if (code >= 65 && code <= 90) { 
            numericIBAN += (code - 55).toString();
        } else {
            numericIBAN += rearranged[i];
        }
    }

    // 3. Mod 97 işlemi (JavaScript'te büyük sayılar için parça parça mod alma)
    let remainder = numericIBAN;
    let block;
    while (remainder.length > 2) {
        block = remainder.slice(0, 9);
        remainder = (parseInt(block, 10) % 97) + remainder.slice(block.length);
    }
    
    return parseInt(remainder, 10) % 97 === 1;
};

/**
 * IBAN'ı 4'erli bloklar halinde formatlar (örn: TR00 0000 0000 ...)
 */
export const formatIBAN = (iban: string): string => {
    let clean = iban.replace(/[^\w\d]/gi, '').toUpperCase();
    let formatted = '';
    for (let i = 0; i < clean.length; i++) {
        if (i > 0 && i % 4 === 0) {
            formatted += ' ';
        }
        formatted += clean[i];
    }
    return formatted;
};

export const IbanInput = forwardRef<HTMLInputElement, IbanInputProps>(({
    value,
    onChange,
    onValidityChange,
    name,
    placeholder = "TR00 0000 0000 0000 0000 0000 00",
    required = false,
    className = "form-input",
    style,
    autoFocus,
    disabled
}, ref) => {
    const [displayValue, setDisplayValue] = useState('');
    const [isValid, setIsValid] = useState(true);

    useEffect(() => {
        const cleanVal = (value || '').replace(/\s+/g, '');
        if (cleanVal) {
            setDisplayValue(formatIBAN(cleanVal));
            const valid = validateIBAN(cleanVal);
            setIsValid(valid);
            if (onValidityChange) onValidityChange(valid);
        } else {
            setDisplayValue('');
            setIsValid(true);
            if (onValidityChange) onValidityChange(false);
        }
    }, [value, onValidityChange]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const rawValue = e.target.value.replace(/[^\w\d]/gi, '').toUpperCase();
        if (rawValue.length > 34) return;
        
        const formatted = formatIBAN(rawValue);
        setDisplayValue(formatted);
        
        const valid = validateIBAN(rawValue);
        setIsValid(rawValue.length === 0 ? true : valid);

        if (onChange) {
            // Değeri geri gönderirken formatlanmış halini değil, temiz halini gönderiyoruz
            // Ancak sahte bir event objesiyle value'yu override ediyoruz
            const fakeEvent = {
                ...e,
                target: {
                    ...e.target,
                    name: e.target.name,
                    value: rawValue
                }
            };
            onChange(fakeEvent as any);
        }
    };

    return (
        <div style={style} className={`w-full relative ${className || ''}`}>
            <BaseInput
                ref={ref}
                icon={<CreditCard size={16} />}
                type="text"
                name={name}
                value={displayValue}
                onChange={handleChange}
                placeholder={placeholder}
                required={required}
                inputClassName="w-full"
                autoFocus={autoFocus}
                disabled={disabled}
                error={displayValue.length > 0 && !isValid}
                maxLength={42} 
            />
            {displayValue.length > 0 && !isValid && (
                <span className="text-xs text-danger mt-1 block">
                    Geçersiz IBAN formatı
                </span>
            )}
        </div>
    );
});

IbanInput.displayName = 'IbanInput';

export default IbanInput;
