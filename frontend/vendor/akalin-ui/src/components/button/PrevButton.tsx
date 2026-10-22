/**
 * ============================================================================
 * Akalin UI - PrevButton (Geri / Önceki Butonu)
 * ============================================================================
 * Sihirbaz (Wizard) ve çok adımlı akışlarda bir önceki adıma dönmek için
 * kullanılan standart geri butonu.
 * BaseButton altyapısını kullanır.
 * ============================================================================
 */
import React from 'react';
import { ChevronLeft } from 'lucide-react';
import BaseButton, { BaseButtonProps } from '../base/button/BaseButton';

export interface PrevButtonProps extends Omit<BaseButtonProps, 'icon'> {
  icon?: React.ReactNode;
}

const PrevButton: React.FC<PrevButtonProps> = ({
  text = 'Geri',
  variant = 'secondary',
  icon = <ChevronLeft size={18} />,
  iconPosition = 'left',
  ...rest
}) => {
  return (
    <BaseButton
      text={text}
      variant={variant}
      icon={icon}
      iconPosition={iconPosition}
      {...rest}
    />
  );
};

export default PrevButton;
