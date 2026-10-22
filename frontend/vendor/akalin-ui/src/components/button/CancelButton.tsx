import React from 'react';
import { X } from 'lucide-react';
import BaseButton, { BaseButtonProps } from '../base/button/BaseButton';

export interface CancelButtonProps extends Omit<BaseButtonProps, 'text'> {
  text?: string;
}

const CancelButton: React.FC<CancelButtonProps> = ({ 
  text = 'İptal', 
  variant = 'outline',
  icon = <X size={18} />,
  ...rest 
}) => {
  return (
    <BaseButton 
      text={text} 
      variant={variant}
      icon={icon}
      {...rest}
    />
  );
};

export default CancelButton;
