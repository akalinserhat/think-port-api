/**
 * @file TamsayiInput.tsx
 * @description BaseNumericInput üzerine kurulu, yalnızca tam sayı (ondalıksız) girişine izin veren sayısal giriş bileşeni.
 */

import React from 'react';
import BaseNumericInput from '../base/input/BaseNumericInput';

export interface TamsayiInputProps {
    value?: number;
    onChange?: (e: { target: { value: number } }) => void;
    className?: string;
    style?: React.CSSProperties;
    disabled?: boolean;
    placeholder?: string;
    allowNegative?: boolean;
    suffix?: string;
}

const TamsayiInput: React.FC<TamsayiInputProps> = ({
    value,
    onChange,
    className,
    style,
    disabled,
    placeholder = '0',
    allowNegative = false,
    suffix = '',
}) => {
    return (
        <BaseNumericInput
            value={value}
            onChange={onChange}
            className={className}
            style={style}
            disabled={disabled}
            decimalScale={0}
            allowNegative={allowNegative}
            suffix={suffix}
            placeholder={placeholder}
        />
    );
};

export default TamsayiInput;
