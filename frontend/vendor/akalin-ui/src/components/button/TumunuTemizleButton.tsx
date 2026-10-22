/**
 * Akalin UI - Tümünü Temizle Butonu (TumunuTemizleButton)
 * Tüm bildirimleri veya temizlenebilir ögeleri tek tıkla topluca temizlemek için
 * MD3 standartlarına uygun BaseButton tabanlı özel buton bileşenidir.
 */
import React from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BaseButton, { BaseButtonProps } from '../base/button/BaseButton';

export interface TumunuTemizleButtonProps extends Omit<BaseButtonProps, 'text'> {
  text?: string;
}

const TumunuTemizleButton: React.FC<TumunuTemizleButtonProps> = ({
  text,
  variant = 'outline-danger',
  icon = <Trash2 size={16} />,
  ...rest
}) => {
  const { t } = useTranslation();
  const buttonText = text ?? t('Tümünü Temizle');

  return (
    <BaseButton
      text={buttonText}
      variant={variant}
      icon={icon}
      {...rest}
    />
  );
};

export default TumunuTemizleButton;
