/**
 * Akalin UI - Yüzen Ekleme Butonu (EkleFloatCircleButton)
 * Izgaralarda, kart listelerinde ve formlarda hızlı yeni kayıt eklemeyi sağlayan
 * yuvarlak, yüzen (floating) buton bileşeni.
 */
import React from 'react';
import { Plus } from 'lucide-react';
import BaseFloatCircleButton from '../base/button/BaseFloatCircleButton';

export interface EkleFloatCircleButtonProps {
    onClick: (e?: React.MouseEvent<HTMLButtonElement>) => void;
    position?: 'fixed-bottom-right' | 'fixed-bottom-left' | 'absolute-bottom-right' | 'absolute-top-right' | 'relative';
    className?: string;
    disabled?: boolean;
    title?: string;
    useShadow?: boolean;
}

export const EkleFloatCircleButton: React.FC<EkleFloatCircleButtonProps> = ({
    onClick,
    position = 'absolute-bottom-right',
    className = '',
    disabled = false,
    title = 'Yeni Ekle',
    useShadow = true
}) => {
    return (
        <BaseFloatCircleButton
            icon={Plus}
            position={position}
            color="primary"
            onClick={onClick}
            className={className}
            disabled={disabled}
            title={title}
            aria-label={title}
            useShadow={useShadow}
        />
    );
};

export default EkleFloatCircleButton;
