/**
 * Akalin UI - Tümünü Okundu İşaretle Butonu (TumunuOkunduIsaretleButton)
 * Tüm bildirimleri veya okunmamış ögeleri tek tıkla okundu olarak işaretlemek için
 * MD3 standartlarına uygun BaseButton tabanlı özel buton bileşenidir.
 */
import React from 'react';
import { CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BaseButton, { BaseButtonProps } from '../base/button/BaseButton';

export interface TumunuOkunduIsaretleButtonProps extends Omit<BaseButtonProps, 'text'> {
  text?: string;
}

const TumunuOkunduIsaretleButton: React.FC<TumunuOkunduIsaretleButtonProps> = ({
  text,
  variant = 'outline',
  icon = <CheckCheck size={16} />,
  ...rest
}) => {
  const { t } = useTranslation();
  const buttonText = text ?? t('Tümünü Okundu İşaretle');

  return (
    <BaseButton
      text={buttonText}
      variant={variant}
      icon={icon}
      {...rest}
    />
  );
};

export default TumunuOkunduIsaretleButton;
