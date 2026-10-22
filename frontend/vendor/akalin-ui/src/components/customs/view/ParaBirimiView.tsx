/**
 * @file ParaBirimiView.tsx
 * @description 
 * Akalin UI - Para Birimi Görüntüleme Bileşeni (ParaBirimiView)
 * 
 * Başlıca Görevleri:
 * - Para birimi objesini veya metnini formatlayarak kullanıcıya sunar.
 * - 'name' | 'code' | 'symbol' | 'symbol-code' formatlama modlarını destekler.
 * - BaseFormatterView altyapısını kullanır.
 */

import React from 'react';
import BaseFormatterView, { BaseFormatterViewProps } from '../../base/customs/view/BaseFormatterView';

export interface ParaBirimiViewProps extends BaseFormatterViewProps {
    format?: 'name' | 'code' | 'symbol' | 'symbol-code';
}

export class ParaBirimiView extends BaseFormatterView<ParaBirimiViewProps> {
    
    protected formatValue(val: any): React.ReactNode {
        if (!val) return '';
        
        const ad = val?.ad || '';
        let kod = val?.kod || '';
        let sembol = val?.sembol || '';

        if (typeof val === 'string') {
            kod = val;
        }

        // Sembol verilmemişse veya string olarak kod gönderilmişse, standart kodlardan sembol bul
        if (!sembol && kod) {
            const currencySymbols: Record<string, string> = {
                'TRY': '₺',
                'TL': '₺',
                'USD': '$',
                'EUR': '€',
                'GBP': '£'
            };
            sembol = currencySymbols[kod.toUpperCase()] || '';
        }
        
        if (!sembol && typeof val === 'string') {
             sembol = val;
        }

        const format = this.props.format || 'symbol-code';

        if (format === 'name') {
            return ad || kod || sembol;
        }
        
        if (format === 'code') {
            return kod || sembol;
        }

        if (format === 'symbol') {
            return sembol || kod;
        }
        
        // Default: symbol-code ("₺ TRY" şeklinde)
        if (kod && sembol && kod !== sembol) {
            return `${sembol} ${kod}`;
        }
        return sembol || kod || ad;
    }
}

export default ParaBirimiView;
