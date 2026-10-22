/**
 * Akalin UI - Çok Satırlı Not / Açıklama Giriş Bileşeni (NotInput)
 * BaseInput bileşenini multiline modda ve standart AlignLeft ikonuyla sarmalar.
 */
import React, { forwardRef } from 'react';
import BaseInput, { BaseInputProps } from '../base/input/BaseInput';
import { AlignLeft } from 'lucide-react';

export interface NotInputProps extends Omit<BaseInputProps, 'multiline'> {
    // We can add specific props for NotInput if needed
}

const NotInput = forwardRef<HTMLTextAreaElement, NotInputProps>((props, ref) => {
    return (
        <BaseInput
            ref={ref as any}
            multiline={true}
            icon={<AlignLeft size={16} />}
            {...props}
        />
    );
});

NotInput.displayName = 'NotInput';

export default NotInput;
