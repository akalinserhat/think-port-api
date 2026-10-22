import React, { forwardRef } from 'react';
import './BaseSwitch.css';

export interface BaseSwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
  error?: boolean;
}

const BaseSwitch = forwardRef<HTMLInputElement, BaseSwitchProps>(({
  label,
  error,
  className = '',
  disabled,
  style,
  ...rest
}, ref) => {
  return (
    <label 
      className={`base-switch-wrapper ${disabled ? 'is-disabled' : ''} ${className}`} 
      style={style}
    >
      <div className="base-switch-container">
        <input 
          type="checkbox" 
          ref={ref}
          disabled={disabled}
          className="base-switch-input"
          {...rest}
        />
        <div className={`base-switch-track ${error ? 'is-error' : ''}`}>
           <div className="base-switch-thumb" />
        </div>
      </div>
      {label && <span className="base-switch-label">{label}</span>}
    </label>
  );
});

BaseSwitch.displayName = 'BaseSwitch';

export default BaseSwitch;
