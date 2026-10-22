/**
 * ============================================================================
 * Akalin UI - FinishButton (Tamamla / Bitti Butonu)
 * ============================================================================
 * Sihirbaz (Wizard) ve onay süreçlerinin son adımında kullanılan tamamlayıcı
 * aksiyon butonu.
 * BaseButton altyapısını kullanır.
 * ============================================================================
 */
import React from 'react';
import { Check } from 'lucide-react';
import BaseButton, { BaseButtonProps } from '../base/button/BaseButton';

export interface FinishButtonProps extends Omit<BaseButtonProps, 'icon'> {
  icon?: React.ReactNode;
}

const FinishButton: React.FC<FinishButtonProps> = ({
  text = 'Tamamla',
  variant = 'primary',
  icon = <Check size={18} />,
  iconPosition = 'left',
  loadingText = 'Tamamlanıyor...',
  ...rest
}) => {
  return (
    <BaseButton
      text={text}
      variant={variant}
      icon={icon}
      iconPosition={iconPosition}
      loadingText={loadingText}
      {...rest}
    />
  );
};

export default FinishButton;
