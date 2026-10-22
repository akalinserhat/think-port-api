/**
 * @file CurrencyInput.tsx
 * @description BaseNumericInput üzerine kurulu, döviz ve para tutarı girişi için standart ondalık ve negatif değer desteği sunan giriş bileşeni.
 */

import React from 'react';
import BaseNumericInput from '../base/input/BaseNumericInput';

export interface CurrencyInputProps {
    value?: number;
    onChange?: (e: { target: { value: number } }) => void;
    className?: string;
    style?: React.CSSProperties;
    disabled?: boolean;
    suffix?: string;
    decimalScale?: number;
    placeholder?: string;
}

const CurrencyInput: React.FC<CurrencyInputProps> = ({ 
    value, 
    onChange, 
    className, 
    style, 
    disabled, 
    suffix, 
    decimalScale = 2,
    placeholder
}) => {
    return (
        <BaseNumericInput
            value={value}
            onChange={onChange}
            className={className}
            style={style}
            disabled={disabled}
            decimalScale={decimalScale}
            allowNegative={true}
            suffix={suffix}
            placeholder={placeholder}
        />
    );
};

export default CurrencyInput;
