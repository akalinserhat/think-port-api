/**
 * @file PhoneView.tsx
 * @description 
 * Akalin UI - Telefon Numarası Görüntüleme Bileşeni (PhoneView)
 * 
 * Başlıca Görevleri:
 * - Telefon numaralarını standart ülke/alan kodu formatında kullanıcıya sunar.
 * - BaseFormatterView altyapısını kullanır.
 */

import React from 'react';
import { Phone } from 'lucide-react';
import BaseFormatterView, { BaseFormatterViewProps } from '../../base/customs/view/BaseFormatterView';

export interface PhoneViewProps extends BaseFormatterViewProps { [key: string]: any }

export class PhoneView extends BaseFormatterView<PhoneViewProps> {
    
    static defaultProps = {
        ...BaseFormatterView.defaultProps,
        icon: <Phone size={16} />
    };

    protected formatValue(val: string | number): string {
        if (!val) return '';
        
        const formatted = String(val).replace(/[^\d]/g, '');
        if (formatted.length < 2) return formatted;
        if (formatted.length < 5) return `${formatted.slice(0, 1)} (${formatted.slice(1)}`;
        if (formatted.length < 8) return `${formatted.slice(0, 1)} (${formatted.slice(1, 4)}) ${formatted.slice(4)}`;
        if (formatted.length < 10) return `${formatted.slice(0, 1)} (${formatted.slice(1, 4)}) ${formatted.slice(4, 7)} ${formatted.slice(7)}`;
        
        return `${formatted.slice(0, 1)} (${formatted.slice(1, 4)}) ${formatted.slice(4, 7)} ${formatted.slice(7, 9)} ${formatted.slice(9, 11)}`;
    }
}

export default PhoneView;
