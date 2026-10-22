/**
 * Akalin UI - Basit Giriş Bileşeni (BasitInput)
 * BaseInput üzerine kurulu, formlarda doğrudan kullanılan pratik metin giriş bileşenidir.
 * Harf dönüşümü (casing / harfDonusumu: 'hepsiBuyuk' | 'hepsiKucuk' | 'basHarflerBuyuk') desteği sunar.
 */

import React, { forwardRef } from 'react';
import BaseInput, { BaseInputProps, HarfDonusumu, TextCasing, applyCasing } from '../base/input/BaseInput';

export { HarfDonusumu, type TextCasing, applyCasing };

export interface BasitInputProps extends BaseInputProps {
    /**
     * Harf formatlama / dönüştürme seçeneği:
     * - 'hepsiBuyuk' / 'Hepsi Büyük' / 'uppercase': Tüm harfleri BÜYÜK yapar.
     * - 'hepsiKucuk' / 'Hepsi Küçük' / 'lowercase': Tüm harfleri KÜÇÜK yapar.
     * - 'basHarflerBuyuk' / 'Sadece Baş Harfleri Büyük' / 'capitalize': Kelimelerin yalnızca Baş Harflerini Büyük yapar.
     */
    casing?: HarfDonusumu;
    harfDonusumu?: HarfDonusumu;
    harfFormati?: HarfDonusumu;
}

const BasitInput = forwardRef<HTMLInputElement, BasitInputProps>(({
    textTransform = 'basHarflerBuyuk',
    casing,
    harfDonusumu,
    harfFormati,
    ...props
}, ref) => {
    return (
        <BaseInput
            ref={ref}
            textTransform={textTransform}
            casing={casing}
            harfDonusumu={harfDonusumu}
            harfFormati={harfFormati}
            {...props}
        />
    );
});

BasitInput.displayName = 'BasitInput';

export default BasitInput;


