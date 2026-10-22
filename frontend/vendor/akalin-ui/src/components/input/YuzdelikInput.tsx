/**
 * Akalin UI - Yüzdelik Oran Giriş Alanı (YuzdelikInput.tsx)
 * 
 * Başlıca Görevleri:
 * - Sayısal yüzde değerlerinin (% formatında, basamak sınırlandırması ve negatif kontrolü ile) girilmesini sağlamak
 * - BaseNumericInput bileşeni üzerinden formatlı veri girişini yönetmek
 */

import React from 'react';
import BaseNumericInput from '../base/input/BaseNumericInput';

export interface YuzdelikInputProps {
    value?: number;
    onChange?: (e: { target: { value: number } }) => void;
    className?: string;
    style?: React.CSSProperties;
    disabled?: boolean;
    /** Virgülden sonraki basamak sayısı (0-6). Varsayılan: 2 */
    decimalPlaces?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    placeholder?: string;
    allowNegative?: boolean;
}

const YuzdelikInput: React.FC<YuzdelikInputProps> = ({
    value,
    onChange,
    className,
    style,
    disabled,
    decimalPlaces = 2,
    placeholder = '0',
    allowNegative = false,
}) => {
    const clampedScale = Math.min(6, Math.max(0, decimalPlaces)) as 0 | 1 | 2 | 3 | 4 | 5 | 6;

    return (
        <BaseNumericInput
            value={value}
            onChange={onChange}
            className={className}
            style={style}
            disabled={disabled}
            decimalScale={clampedScale}
            allowNegative={allowNegative}
            suffix="%"
            placeholder={placeholder}
        />
    );
};

export default YuzdelikInput;
