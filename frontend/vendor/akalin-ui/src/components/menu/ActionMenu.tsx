import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type ActionMenuButtonVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

export interface ActionMenuItem {
  label?: string | React.ReactNode;
  icon?: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  title?: string;
  isDefault?: boolean;
  default?: boolean;
  variant?: ActionMenuButtonVariant;
  badge?: React.ReactNode;
  dividerAbove?: boolean;
  custom?: React.ReactNode;
  type?: string;
  content?: React.ReactNode;
}

export interface ActionMenuProps {
  actions?: ActionMenuItem[];
  /**
   * @deprecated 'actions' yerine 'items' kullanımı geriye dönük uyumluluk için desteklenmektedir.
   * @see actions
   */
  items?: ActionMenuItem[];
  triggerIcon?: React.ReactNode;
  triggerLabel?: React.ReactNode;
  triggerBadge?: React.ReactNode;
  triggerVariant?: ActionMenuButtonVariant;
  /**
   * @deprecated 'triggerVariant' yerine 'buttonVariant' kullanımı geriye dönük uyumluluk için desteklenmektedir.
   * @see triggerVariant
   */
  buttonVariant?: ActionMenuButtonVariant;
  onTriggerLabelClick?: (e: React.MouseEvent) => void;
  triggerDisabled?: boolean;
  triggerClassName?: string;
  /**
   * Menüdeki varsayılan seçeneği (isDefault veya fallback 'Düzenle') menünün yanında
   * harici bir aksiyon butonu (split button) olarak gösterme özelliği.
   * Bu özellik varsayılan olarak KAPALIDIR (false).
   */
  showDefaultActionAsButton?: boolean;
  showDefaultButton?: boolean;
  splitButton?: boolean;
  /**
   * @deprecated 'showDefaultActionAsButton' yerine 'showSplitButton' kullanımı geriye dönük uyumluluk için desteklenmektedir.
   * @see showDefaultActionAsButton
   */
  showSplitButton?: boolean;
  dropdownHeader?: React.ReactNode;
  dropdownFooter?: React.ReactNode;
  title?: string;
  className?: string;
}

const ActionMenu: React.FC<ActionMenuProps> = ({ 
  actions,
  items,
  triggerIcon,
  triggerLabel,
  triggerBadge,
  triggerVariant,
  buttonVariant,
  onTriggerLabelClick,
  triggerDisabled,
  triggerClassName = '',
  showDefaultActionAsButton,
  showDefaultButton,
  splitButton,
  showSplitButton,
  dropdownHeader,
  dropdownFooter,
  title,
  className = ''
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, right: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updateCoords = useCallback(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right)
      });
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const isOutsideButton = menuRef.current && !menuRef.current.contains(event.target as Node);
      const isOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(event.target as Node);
      
      if (isOutsideButton && isOutsideDropdown) {
        setIsOpen(false);
      }
    };

    const handleScrollOrResize = () => {
      if (isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Close on scroll to prevent the fixed menu from detaching
      window.addEventListener('scroll', handleScrollOrResize, true);
      window.addEventListener('resize', handleScrollOrResize);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const handleActionClick = (e: React.MouseEvent<HTMLButtonElement>, onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void) => {
    e.stopPropagation();
    setIsOpen(false);
    if (onClick) {
      onClick(e);
    }
  };

  const handleToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!isOpen) {
      updateCoords();
    }
    setIsOpen(!isOpen);
  };

  // Defensive programming: fallback to safeActions
  const safeActions = actions || items || [];

  // Sadece tek bir menü öğesi varsayılan olabilir (Strict Single Default Rule)
  // 1. Explicit olarak isDefault veya default olan İLK görünür öğeyi bul
  const explicitDefaultIndex = safeActions.findIndex(a => !a.hidden && (a.isDefault || a.default));

  // 2. Explicit yoksa fallback (Düzenle/Edit) öğesini bul
  const fallbackDefaultIndex = explicitDefaultIndex === -1
    ? safeActions.findIndex(a => !a.hidden && !a.danger && (
        a.label === t('auto_duzenle', 'Düzenle') ||
        a.label === t('Düzenle') ||
        (typeof a.label === 'string' && (
          a.label.toLowerCase() === 'düzenle' ||
          a.label.toLowerCase() === 'duzenle' ||
          a.label.toLowerCase() === 'edit'
        ))
      ))
    : -1;

  const singleDefaultIndex = explicitDefaultIndex !== -1 ? explicitDefaultIndex : fallbackDefaultIndex;
  const singleDefaultAction = singleDefaultIndex !== -1 ? safeActions[singleDefaultIndex] : undefined;

  // Custom trigger tespiti: Caller açıkça triggerLabel veya onTriggerLabelClick vermişse,
  // bu tetikleyici bağımsız bir düğmedir ve dropdown'daki varsayılan aksiyonla BİRLEŞTİRİLMEZ!
  const hasCustomTrigger = triggerLabel !== undefined || onTriggerLabelClick !== undefined;

  // Varsayılan seçeneğin harici bir düğme (split button) olarak gösterilme özelliği.
  // Bu özellik varsayılan olarak KAPALIDIR (false). Caller açıkça açmadıkça normal 3-nokta menü gösterilir.
  const isDefaultButtonEnabled = Boolean(
    showDefaultActionAsButton ?? showDefaultButton ?? splitButton ?? showSplitButton ?? false
  );

  // Split-Button modunun tespiti:
  // 1. onTriggerLabelClick fonksiyonu verilmişse (bağlamsal split trigger, örn: [ 📍 Adres Seçimi | ⋮ ])
  // 2. VEYA custom trigger yokken, varsayılan seçenek düğme olarak gösterilme özelliği açıkken (isDefaultButtonEnabled),
  //    singleDefaultAction mevcut ve bir label'a sahipse
  const isSplitButton = Boolean(
    onTriggerLabelClick !== undefined ||
    (!hasCustomTrigger && isDefaultButtonEnabled && singleDefaultAction && singleDefaultAction.label !== undefined)
  );

  // Split-button aksiyonu: SADECE custom trigger YOKKEN default aksiyondan beslenir
  const splitDefaultAction = (!hasCustomTrigger && isSplitButton) ? singleDefaultAction : undefined;

  const hasSplitClickHandler = Boolean(onTriggerLabelClick || splitDefaultAction?.onClick);

  const effectiveOnClick = onTriggerLabelClick || (splitDefaultAction?.onClick ? (e: React.MouseEvent) => {
    e.stopPropagation();
    if (splitDefaultAction.onClick) splitDefaultAction.onClick(e as any);
  } : undefined);

  const effectiveLabel = triggerLabel !== undefined
    ? triggerLabel
    : splitDefaultAction?.label;

  const effectiveIcon = triggerIcon !== undefined
    ? triggerIcon
    : splitDefaultAction?.icon;

  const effectiveBadge = triggerBadge !== undefined
    ? triggerBadge
    : splitDefaultAction?.badge;

  const effectiveDisabled = triggerDisabled !== undefined
    ? triggerDisabled
    : Boolean(splitDefaultAction?.disabled);

  const effectiveVariant: ActionMenuButtonVariant = triggerVariant ||
    buttonVariant ||
    splitDefaultAction?.variant ||
    (splitDefaultAction?.isDefault ? 'primary' : 'default');

  const effectiveTitle = title ||
    splitDefaultAction?.title ||
    (typeof effectiveLabel === 'string' ? effectiveLabel : undefined);

  const visibleActions = safeActions.filter(a => !a.hidden);
  const hasContent = Boolean(dropdownHeader || visibleActions.length > 0 || dropdownFooter);

  // Görünür hiçbir menü öğesi ve bağımsız tetikleyici aksiyonu yoksa bileşeni gizle (render etme)
  if (visibleActions.length === 0 && !onTriggerLabelClick && !dropdownFooter) {
    return null;
  }

  return (
    <div className={`action-menu-wrapper ${className}`.trim()} ref={menuRef}>
      {isSplitButton ? (
        <div className={`action-menu-btn-group variant-${effectiveVariant} ${isOpen ? 'open' : ''} ${triggerClassName}`.trim()}>
          {hasSplitClickHandler ? (
            <button
              type="button"
              disabled={effectiveDisabled}
              className={`action-menu-action-btn ${effectiveDisabled ? 'disabled' : ''}`.trim()}
              style={{ position: 'relative' }}
              onClick={(e) => {
                if (effectiveDisabled) return;
                e.stopPropagation();
                if (effectiveOnClick) effectiveOnClick(e);
              }}
              title={effectiveTitle}
              aria-label={typeof effectiveLabel === 'string' ? effectiveLabel : undefined}
            >
              {effectiveIcon && (
                <span className="action-menu-btn-icon" aria-hidden="true">
                  {effectiveIcon}
                </span>
              )}
              {effectiveLabel && (
                <span className="action-menu-btn-label">
                  {effectiveLabel}
                </span>
              )}
              {effectiveBadge && (
                <span className="action-menu-btn-badge">
                  {effectiveBadge}
                </span>
              )}
            </button>
          ) : (
            <div
              className={`action-menu-action-btn ${effectiveDisabled ? 'disabled' : ''}`.trim()}
              style={{ position: 'relative' }}
              title={effectiveTitle}
              aria-label={typeof effectiveLabel === 'string' ? effectiveLabel : undefined}
            >
              {effectiveIcon && (
                <span className="action-menu-btn-icon" aria-hidden="true">
                  {effectiveIcon}
                </span>
              )}
              {effectiveLabel && (
                <span className="action-menu-btn-label">
                  {effectiveLabel}
                </span>
              )}
              {effectiveBadge && (
                <span className="action-menu-btn-badge">
                  {effectiveBadge}
                </span>
              )}
            </div>
          )}
          <div className="action-menu-btn-divider" />
          <button
            type="button"
            className="action-menu-toggle-btn"
            onClick={handleToggle}
            title={title || t('islemler', 'İşlemler')}
            aria-label={title || t('islemler', 'İşlemler')}
            aria-expanded={isOpen}
          >
            <MoreVertical size={16} />
          </button>
        </div>
      ) : (
        <button 
          type="button"
          className={`action-menu-btn ${triggerLabel ? 'has-label' : ''} ${isOpen ? 'open' : ''} ${triggerClassName}`.trim()}
          onClick={handleToggle}
          title={title || t('islemler', 'İşlemler')}
          aria-label={title || t('islemler', 'İşlemler')}
          aria-expanded={isOpen}
        >
          {effectiveIcon && <span className="action-menu-btn-icon">{effectiveIcon}</span>}
          {effectiveLabel && <span className="action-menu-trigger-label">{effectiveLabel}</span>}
          {triggerIcon !== undefined && !effectiveIcon ? triggerIcon : <MoreVertical size={18} />}
        </button>
      )}

      {isOpen && hasContent && createPortal(
        <div 
          ref={dropdownRef}
          className="action-menu-dropdown fade-in-fast"
          style={{
            position: 'fixed',
            top: coords.top,
            right: coords.right,
            zIndex: 9999
          }}
        >
          {dropdownHeader && (
            <div className="action-menu-dropdown-header">
              {dropdownHeader}
            </div>
          )}

          {visibleActions.map((action: ActionMenuItem, idx: number) => {
            const customNode = action.custom ?? (action.type === 'custom' ? action.content : undefined);
            if (customNode) {
              return (
                <React.Fragment key={idx}>
                  {action.dividerAbove && <div className="action-menu-divider" />}
                  <div 
                    className="action-menu-custom-item" 
                    onClick={(e) => e.stopPropagation()}
                  >
                    {customNode}
                  </div>
                </React.Fragment>
              );
            }

            // Sadece TEK BİR menü öğesi varsayılan (default) olabilir
            const isDefault = action === singleDefaultAction;

            return (
              <React.Fragment key={idx}>
                {action.dividerAbove && <div className="action-menu-divider" />}
                <button
                  type="button"
                  disabled={action.disabled}
                  className={`action-menu-item ${action.danger ? 'danger' : ''} ${isDefault ? 'default-action' : ''} ${action.disabled ? 'disabled' : ''}`.trim()}
                  onClick={(e) => {
                    if (action.disabled) return;
                    handleActionClick(e, action.onClick);
                  }}
                  title={action.title || (typeof action.label === 'string' ? action.label : undefined)}
                >
                  {action.icon && <span className="action-menu-item-icon">{action.icon}</span>}
                  <span className="action-menu-item-label">{action.label}</span>
                  {action.badge && <span className="action-menu-item-badge">{action.badge}</span>}
                </button>
              </React.Fragment>
            );
          })}

          {dropdownFooter && (
            <div className="action-menu-dropdown-footer">
              {dropdownFooter}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

export default ActionMenu;
