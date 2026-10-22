import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseCard, BaseCardProps } from '../base/card';
import BaseButton from '../base/button/BaseButton';
import { 
  CheckCircle, 
  Info, 
  AlertTriangle, 
  XCircle, 
  X,
  Bell,
  Check
} from 'lucide-react';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationAction {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  variant?: 'primary' | 'outline' | 'text';
}

export interface NotificationCardProps extends Omit<BaseCardProps, 'children'> {
  /** Uniquely identifies the notification */
  id?: string;
  /** Main title of the notification */
  title: string;
  /** Main content or message of the notification */
  message: string;
  /** Type of notification to determine styling and default icon */
  type?: NotificationType;
  /** Timestamp or formatted date string */
  date?: string | Date;
  /** Whether the notification has been read */
  isRead?: boolean;
  /** Optional custom icon */
  icon?: React.ReactNode;
  /** Action buttons for the notification */
  actions?: NotificationAction[];
  /** Callback when the dismiss (X) button is clicked */
  onDismiss?: (id?: string) => void;
  /** Callback when the entire card is clicked */
  onClick?: () => void;
}

/**
 * NotificationCard
 * 
 * Standard notification card component built on top of BaseCard.
 * Designed for user-facing notifications.
 */
const NotificationCard = React.forwardRef<HTMLDivElement, NotificationCardProps>(
  (
    {
      id,
      title,
      message,
      type = 'info',
      date,
      isRead = false,
      icon,
      actions,
      onDismiss,
      className = '',
      variant = 'elevated',
      isDark = false,
      onClick,
      ...rest
    },
    ref
  ) => {
    const { t } = useTranslation();
    
    const getDefaultIcon = () => {
      switch (type) {
        case 'success': return <CheckCircle size={20} />;
        case 'warning': return <AlertTriangle size={20} />;
        case 'error': return <XCircle size={20} />;
        case 'info':
        default: 
          return <Info size={20} />;
      }
    };

    const displayIcon = icon || getDefaultIcon();
    
    const formattedDate = date instanceof Date 
      ? date.toLocaleString() 
      : date;

    const baseClasses = `admin-notification-card severity-${type} ${!isRead ? 'unread' : 'read'} ${className}`;

    const handleDismiss = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onDismiss) {
        onDismiss(id);
      }
    };

    return (
      <BaseCard 
        ref={ref} 
        variant={variant} 
        isDark={isDark} 
        className={baseClasses}
        onClick={onClick}
        interactive={!!onClick}
        {...rest}
      >
        <div className={`admin-notification-icon ${type}`}>
          {displayIcon}
        </div>
        
        <div className="admin-notification-content">
          <div className="admin-notification-header">
            <div className="flex items-center gap-8 flex-wrap">
              <h4 className="admin-notification-title">{title}</h4>
              <span 
                className={`notification-status-badge ${!isRead ? 'unread' : 'read'}`}
                title={!isRead ? (t('Tıklayarak okundu yapabilirsiniz') || 'Tıklayarak okundu yapabilirsiniz') : (t('Tıklayarak okunmadı yapabilirsiniz') || 'Tıklayarak okunmadı yapabilirsiniz')}
              >
                {!isRead ? (
                  <>
                    <span className="notification-unread-dot" />
                    <span>{t('Okunmadı')}</span>
                  </>
                ) : (
                  <>
                    <Check size={12} />
                    <span>{t('Okundu')}</span>
                  </>
                )}
              </span>
            </div>
            {onDismiss && (
              <button 
                type="button" 
                className="admin-notification-close" 
                onClick={handleDismiss}
                aria-label="Dismiss notification"
              >
                <X size={18} />
              </button>
            )}
          </div>
          
          {formattedDate && (
             <div className="admin-notification-meta">
               <span className="admin-notification-timestamp">
                 {formattedDate}
               </span>
             </div>
          )}
          
          <p className="admin-notification-desc">
            {message}
          </p>
          
          {actions && actions.length > 0 && (
            <div className="admin-notification-actions">
              {actions.map((action, index) => (
                <BaseButton
                  key={index}
                  variant={action.variant || 'outline'}
                  text={action.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    action.onClick(e);
                  }}
                  className="admin-notification-action-btn"
                />
              ))}
            </div>
          )}
        </div>
      </BaseCard>
    );
  }
);

NotificationCard.displayName = 'NotificationCard';

export default NotificationCard;
