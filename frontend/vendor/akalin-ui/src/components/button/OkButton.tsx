import React from 'react';
import BaseButton, { BaseButtonProps } from '../base/button/BaseButton';
import { Check } from 'lucide-react';

export interface OkButtonProps extends Omit<BaseButtonProps, 'text'> {
  text?: string;
}

const OkButton: React.FC<OkButtonProps> = ({ 
  text = 'Tamam', 
  variant = 'primary',
  icon = <Check size={18} />,
  ...rest 
}) => {
  return (
    <BaseButton 
      text={text} 
      variant={variant}
      icon={icon}
      {...rest}
      style={{ justifyContent: 'center', ...(rest.style || {}) }}
    />
  );
};

export default OkButton;
