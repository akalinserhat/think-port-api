/**
 * @file IbanView.tsx
 * @description 
 * Akalin UI - IBAN Görüntüleme Bileşeni (IbanView)
 * 
 * Başlıca Görevleri:
 * - IBAN metnini 4'erli bloklar halinde formatlayarak görüntüler.
 * - BaseFormatterView altyapısını kullanır.
 */

import React from 'react';
import { CreditCard } from 'lucide-react';
import BaseFormatterView, { BaseFormatterViewProps } from '../../base/customs/view/BaseFormatterView';

export class IbanView extends BaseFormatterView<BaseFormatterViewProps> {
    
    static defaultProps = {
        ...BaseFormatterView.defaultProps,
        icon: <CreditCard size={16} />
    };

    protected formatValue(val: string | number): string {
        if (!val) return '';
        
        let clean = String(val).replace(/[^\w\d]/gi, '').toUpperCase();
        let formatted = '';
        for (let i = 0; i < clean.length; i++) {
            if (i > 0 && i % 4 === 0) {
                formatted += ' ';
            }
            formatted += clean[i];
        }
        return formatted;
    }
}

export interface IbanViewProps { [key: string]: any }

export default IbanView;
