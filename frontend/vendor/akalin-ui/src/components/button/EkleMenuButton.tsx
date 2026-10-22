/**
 * @file EkleMenuButton.tsx
 * @description BaseMenuButton üzerine kurulu, kullanıcının son seçtiği veya sabitlediği (pin) ekleme eylemini LocalStorage ile hatırlayan açılır menülü ekleme butonu.
 */

import React from 'react';
import BaseMenuButton, { BaseMenuButtonProps } from '../base/button/BaseMenuButton';

export interface EkleMenuButtonProps extends Omit<BaseMenuButtonProps, 'defaultPinnedId' | 'onPinChange'> {
    /** LocalStorage key for persisting the pinned selection */
    storageKey?: string;
}

const EkleMenuButton: React.FC<EkleMenuButtonProps> = ({ storageKey, items, ...rest }) => {
    
    const getInitialPin = () => {
        if (!storageKey) return items[0]?.id;
        const stored = localStorage.getItem(storageKey);
        if (stored && items.some(i => i.id === stored)) {
            return stored;
        }
        return items[0]?.id; // Default fallback to the first item
    };

    const handlePinChange = (pinnedId: string) => {
        if (storageKey) {
            localStorage.setItem(storageKey, pinnedId);
        }
    };

    if (!items || items.length === 0) return null;

    return (
        <BaseMenuButton 
            items={items}
            defaultPinnedId={getInitialPin()}
            onPinChange={handlePinChange}
            {...rest}
        />
    );
};

export default EkleMenuButton;
