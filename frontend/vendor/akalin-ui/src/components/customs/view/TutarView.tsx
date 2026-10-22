/**
 * @file TutarView.tsx
 * @description 
 * Akalin UI - Tutar Görüntüleme Bileşeni (TutarView)
 * 
 * Başlıca Görevleri:
 * - Sayısal tutar verilerini Türkçe para formatında (virgüllü kuruş vb.) gösterir.
 * - Opsiyonel olarak ParaBirimiView entegrasyonu ile para birimi sembolünü iliştirir.
 * - BaseFormatterView altyapısını kullanır.
 */

import React from 'react';
import BaseFormatterView, { BaseFormatterViewProps } from '../../base/customs/view/BaseFormatterView';
import ParaBirimiView from './ParaBirimiView';

export interface TutarViewProps extends BaseFormatterViewProps {
    paraBirimi?: any; // Para birimi objesi veya metni (sembolü)
}

export class TutarView extends BaseFormatterView<TutarViewProps> {
    
    protected formatValue(val: any): React.ReactNode {
        if (val === null || val === undefined || isNaN(Number(val))) return '-';
        
        const numericVal = Number(val);
        
        // Sadece sayıyı Türkçe standartlarına göre formatlıyoruz (sembolsüz)
        const formattedNum = new Intl.NumberFormat('tr-TR', { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
        }).format(numericVal);

        return (
            <span className="inline-flex items-baseline gap-1">
                <span>{formattedNum}</span>
                {this.props.paraBirimi && (
                    <ParaBirimiView 
                        value={this.props.paraBirimi} 
                        format="symbol" 
                        className="tutar-para-birimi"
                    />
                )}
            </span>
        );
    }
}

export default TutarView;
