/**
 * @file BaseNumericInput.tsx
 * @description Sayısal veri girişleri için formatlı (binlik ayracı, ondalık basamak, para/yüzde soneki) temel input bileşeni.
 * Türkçe sayı formatlaması (tr-TR), negatif sayı kontrolü ve dinamik ondalık ölçek desteği sunar.
 */

import React, { useState, useEffect } from 'react';
import BaseInput from './BaseInput';

export interface BaseNumericInputProps {
    value?: number;
    onChange?: (e: { target: { value: number } }) => void;
    className?: string;
    style?: React.CSSProperties;
    disabled?: boolean;
    decimalScale?: number;
    allowNegative?: boolean;
    suffix?: string;
    placeholder?: string;
}

const BaseNumericInput = ({ 
    value, 
    onChange, 
    className, 
    style, 
    disabled, 
    decimalScale = 2, 
    allowNegative = false,
    suffix = '',
    placeholder = '0'
}: BaseNumericInputProps) => {
    const [displayValue, setDisplayValue] = useState('');
    const [isFocused, setIsFocused] = useState(false);

    // Dışarıdan gelen ondalıklı değeri formatlı TR stringine çevir (örn: 1250.5 -> 1.250,50)
    const formatValueForDisplay = (val: any) => {
        if (val === null || val === undefined || isNaN(val)) return '';
        let formattedStr = new Intl.NumberFormat('tr-TR', { 
            minimumFractionDigits: decimalScale, 
            maximumFractionDigits: decimalScale 
        }).format(val);
        
        if (suffix && !isFocused) {
            formattedStr += ` ${suffix}`;
        }
        return formattedStr;
    };

    // Formatlı TR stringinden gerçek float değere dön
    const parseFormattedValue = (str: string) => {
        if (!str) return 0;
        let cleanStr = str;
        if (suffix) {
             cleanStr = cleanStr.replace(suffix, '').trim();
        }
        cleanStr = cleanStr.replace(/\./g, ''); // Noktaları (binlik ayraç) sil
        cleanStr = cleanStr.replace(/,/g, '.'); // Virgülü (ondalık ayraç) noktaya çevir
        
        let parsed = parseFloat(cleanStr);
        if (isNaN(parsed)) parsed = 0;
        if (!allowNegative && parsed < 0) parsed = Math.abs(parsed);
        
        return parsed;
    };

    // Kullanıcı yazarken anlık olarak formatla
    const formatWhileTyping = (str: string) => {
        // Sadece rakamlar, virgül ve (izin varsa) eksi kalsın
        let regex = allowNegative ? /[^0-9,-]/g : /[^0-9,]/g;
        let cleanStr = str.replace(regex, '');
        
        // Eksi işareti sadece en başta olabilir
        if (allowNegative) {
            const hasMinus = cleanStr.startsWith('-');
            cleanStr = cleanStr.replace(/-/g, '');
            if (hasMinus) cleanStr = '-' + cleanStr;
        }

        const parts = cleanStr.split(',');
        let integerPart = parts[0];
        let decimalPart = parts.length > 1 && decimalScale > 0 ? ',' + parts[1].slice(0, decimalScale) : '';

        if (integerPart && integerPart !== '-') {
            const isNegative = integerPart.startsWith('-');
            let absoluteInt = isNegative ? integerPart.substring(1) : integerPart;
            
            // Başındaki sıfırları at, değer boş kalırsa 0 yaz
            absoluteInt = parseInt(absoluteInt || '0', 10).toString();
            // Binlik ayraçları nokta olarak ekle
            absoluteInt = absoluteInt.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
            
            integerPart = (isNegative ? '-' : '') + absoluteInt;
        }

        return integerPart + decimalPart;
    };

    useEffect(() => {
        if (!isFocused) {
            setDisplayValue(formatValueForDisplay(value));
        }
    }, [value, isFocused, decimalScale, suffix]);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
        setIsFocused(true);
        // Odaklanınca suffix'i (örn: " KG") gizleyelim ki rahat yazsın
        if (value !== null && value !== undefined && !isNaN(value)) {
            let valStr = new Intl.NumberFormat('tr-TR', { 
                minimumFractionDigits: decimalScale, 
                maximumFractionDigits: decimalScale 
            }).format(value);
            setDisplayValue(valStr);
        } else {
            setDisplayValue('');
        }
        
        setTimeout(() => {
            e.target.select();
        }, 10);
    };

    const handleBlur = () => {
        setIsFocused(false);
        const parsedValue = parseFormattedValue(displayValue);
        setDisplayValue(formatValueForDisplay(parsedValue));
        if (onChange) {
            onChange({ target: { value: parsedValue } });
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const rawValue = e.target.value;
        const formatted = formatWhileTyping(rawValue);
        setDisplayValue(formatted);
        
        if (onChange) {
             onChange({ target: { value: parseFormattedValue(formatted) } });
        }
    };

    return (
        <BaseInput
            type="text"
            inputClassName={className ? `form-input ${className}` : "form-input"}
            style={style}
            inputStyle={{ cursor: 'text', textAlign: 'right' }}
            value={displayValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={placeholder}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                }
            }}
            disabled={disabled}
        />
    );
};

export default BaseNumericInput;
