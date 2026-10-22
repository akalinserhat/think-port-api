import React from 'react';

export type CardVariant = 'elevated' | 'filled' | 'outlined';

export interface BaseCardProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * The visual variant of the card based on Material Design 3.
   * @default 'elevated'
   */
  variant?: CardVariant;
  
  /**
   * Whether the card is interactive (e.g., has hover and active states).
   * Automatically true if onClick is provided.
   * @default false
   */
  interactive?: boolean;
  
  /**
   * Child content to render inside the card.
   */
  children?: React.ReactNode;
  
  /**
   * Additional CSS classes.
   */
  className?: string;
  
  /**
   * Theme mode. Can be useful if CSS variables aren't strictly used for dark mode.
   */
  isDark?: boolean;
  
  /**
   * Element to render as (e.g., 'form', 'div')
   */
  as?: React.ElementType;
}

const BaseCard = React.forwardRef<HTMLElement, BaseCardProps>(
  (
    {
      variant = 'elevated',
      interactive = false,
      children,
      className = '',
      isDark = false,
      onClick,
      as: Component = 'div',
      ...rest
    },
    ref
  ) => {
    const isInteractive = interactive || !!onClick;
    
    const cardClasses = [
      'base-card',
      `base-card-${variant}`,
      isInteractive ? 'base-card-interactive' : '',
      isDark ? 'dark' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <Component 
        ref={ref} 
        className={cardClasses} 
        onClick={onClick}
        {...rest as any}
      >
        {children}
      </Component>
    );
  }
);

BaseCard.displayName = 'BaseCard';

export default BaseCard;
