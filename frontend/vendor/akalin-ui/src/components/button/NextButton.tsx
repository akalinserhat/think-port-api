/**
 * ============================================================================
 * Akalin UI - NextButton (İleri Butonu)
 * ============================================================================
 * Sihirbaz (Wizard), adım adım formlar ve onboarding akışlarında sonraki adıma
 * geçmek için kullanılan standart "İleri" butonu.
 * BaseButton altyapısını kullanarak Material Design 3 tasarım token'larıyla çalışır.
 * ============================================================================
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';
import BaseButton, { BaseButtonProps } from '../base/button/BaseButton';

export interface NextButtonProps extends Omit<BaseButtonProps, 'icon'> {
  icon?: React.ReactNode;
}

const NextButton: React.FC<NextButtonProps> = ({
  text = 'İleri',
  variant = 'primary',
  icon = <ChevronRight size={18} />,
  iconPosition = 'right',
  loadingText = 'İlerleniyor...',
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

export default NextButton;
