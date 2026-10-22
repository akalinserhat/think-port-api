import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseCard, BaseCardProps } from '../base/card';
import BaseButton from '../base/button/BaseButton';
import { 
  AlertCircle, 
  AlertTriangle, 
  CheckCircle, 
  Info, 
  ShieldAlert, 
  Clock, 
  X,
  Settings,
  Bell,
  Check
} from 'lucide-react';

export type AdminNotificationSeverity = 'info' | 'success' | 'warning' | 'error' | 'critical';
export type AdminNotificationCategory = 'system' | 'security' | 'database' | 'integration' | 'user' | 'billing' | 'performance' | string;

export interface AdminNotificationAction {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  variant?: 'primary' | 'outline' | 'danger' | 'success' | 'warning';
  icon?: React.ReactNode;
}

export interface AdminNotificationCardProps extends Omit<BaseCardProps, 'children'> {
  /** Uniquely identifies the notification */
  id?: string;
  /** Main title of the notification */
  title: string;
  /** Detailed description or payload of the notification */
  description: string;
  /** Severity level which drives the icon and color accents */
  severity?: AdminNotificationSeverity;
  /** Categorization of the alert (e.g. Database, Security) */
  category?: AdminNotificationCategory;
  /** Timestamp when the event occurred */
  timestamp?: Date | string;
  /** Has the admin acknowledged or read this notification? */
  isRead?: boolean;
  /** Actions available for this notification (e.g. 'View Logs', 'Dismiss') */
  actions?: AdminNotificationAction[];
  /** Optional custom icon to override the severity default */
  customIcon?: React.ReactNode;
  /** The module, server, or process that originated the notification */
  source?: string;
  /** Callback when the user clicks the dismiss/close button */
  onDismiss?: (id?: string) => void;
}

/**
 * AdminNotificationCard
 * 
 * Specifically designed for ERP and System Administration dashboards.
 * Displays system alerts, background job statuses, security warnings,
 * and infrastructure events with a clear hierarchy and actionable buttons.
 */
const AdminNotificationCard = React.forwardRef<HTMLDivElement, AdminNotificationCardProps>(
  (
    {
      id,
      title,
      description,
      severity = 'info',
      category,
      timestamp,
      isRead = false,
      actions = [],
      customIcon,
      source,
      onDismiss,
      className = '',
      isDark = false,
      variant = 'elevated',
      ...rest
    },
    ref
  ) => {
    const { t } = useTranslation();
    
    const getSeverityIcon = () => {
      if (customIcon) return customIcon;
      switch (severity) {
        case 'info': return <Info size={24} />;
        case 'success': return <CheckCircle size={24} />;
        case 'warning': return <AlertTriangle size={24} />;
        case 'error': return <AlertCircle size={24} />;
        case 'critical': return <ShieldAlert size={24} />;
        default: return <Bell size={24} />;
      }
    };

    const getCategoryIcon = () => {
      switch (category?.toLowerCase()) {
        case 'system': return <Settings size={14} />;
        case 'security': return <ShieldAlert size={14} />;
        // ... more mappings if needed
        default: return null;
      }
    };

    const formattedTimestamp = timestamp instanceof Date 
      ? timestamp.toLocaleString() 
      : timestamp;

    const baseClasses = `admin-notification-card severity-${severity} ${!isRead ? 'unread' : 'read'} ${className}`;

    return (
      <BaseCard 
        ref={ref} 
        variant={variant} 
        isDark={isDark} 
        className={baseClasses}
        {...rest}
      >
        <div className={`admin-notification-icon ${severity}`}>
          {getSeverityIcon()}
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
                onClick={() => onDismiss(id)}
                aria-label="Dismiss notification"
              >
                <X size={18} />
              </button>
            )}
          </div>

          <div className="admin-notification-meta">
            {category && (
              <span className="admin-notification-badge" title="Category">
                {category}
              </span>
            )}
            {source && (
              <span title="Source / Module">
                <strong>Source:</strong> {source}
              </span>
            )}
            {formattedTimestamp && (
              <span className="admin-notification-timestamp" title="Timestamp">
                <Clock size={14} /> {formattedTimestamp}
              </span>
            )}
          </div>

          <p className="admin-notification-desc">
            {description}
          </p>

          {actions && actions.length > 0 && (
            <div className="admin-notification-actions">
              {actions.map((action, idx) => (
                <BaseButton 
                  key={idx}
                  variant={action.variant || 'outline'}
                  onClick={action.onClick}
                  icon={action.icon}
                  text={action.label}
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

AdminNotificationCard.displayName = 'AdminNotificationCard';

export default AdminNotificationCard;
