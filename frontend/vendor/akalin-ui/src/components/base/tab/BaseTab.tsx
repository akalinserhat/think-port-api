/**
 * Akalin UI - Material Design 3 Standartlarında Temel Sekme Bileşeni (BaseTab)
 * 
 * Başlıca Görevleri:
 * - MD3 standartlarına uygun kaydırılabilir sekme buton çubuğunu ve aktif sekme göstergesini (indicator) çizmek
 * - Ekran dışına taşan sekmeler için yatay kaydırma (horizontal scroll) ve kuyruksuz ok (Chevron) butonları sunmak
 * - Aktif sekme değiştiğinde veya tıklandığında ilgili sekmeyi otomatik görünür alana kaydırmak
 * - Hem kontrollü (controlled: activeId / activeTabId) hem de kontrolsüz (uncontrolled: defaultActiveId) modları desteklemek
 * - İsteğe bağlı olarak sekme öğelerindeki content alanını otomatik render etmek
 * - label, name ve title gibi farklı isimlendirmeleri esnekçe desteklemek ve i18n t() ile otomatik çevirmek
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import ActionMenu, { ActionMenuItem, ActionMenuProps } from '../../menu/ActionMenu';

export { type ActionMenuItem, type ActionMenuProps };

export interface BaseTabItem {
  id: string | number;
  label?: string;
  name?: string;
  title?: string;
  icon?: React.ReactNode;
  content?: React.ReactNode;
  disabled?: boolean;
  closable?: boolean;
  actions?: ActionMenuItem[];
  actionMenuProps?: Partial<ActionMenuProps>;
  [key: string]: any;
}

export interface BaseTabProps {
  tabs: BaseTabItem[];
  defaultActiveId?: string | number;
  activeId?: string | number;
  activeTabId?: string | number;
  onChange?: (id: string | number) => void;
  onTabChange?: (id: string | number) => void;
  className?: string;
  variant?: 'primary' | 'secondary';
  fullWidth?: boolean;
  rightContent?: React.ReactNode;
  hideIfSingleTab?: boolean;
  style?: React.CSSProperties;
  editable?: boolean;
  editableTabs?: boolean;
  onAddTab?: () => void;
  onTabAdd?: () => void;
  onCloseTab?: (id: string | number, e: React.MouseEvent) => void;
  onTabClose?: (id: string | number, e: React.MouseEvent) => void;
  addTabTooltip?: string;
  closeTabTooltip?: string;
  actions?: ActionMenuItem[];
  actionMenuProps?: Partial<ActionMenuProps>;
  actionMenu?: React.ReactNode;
}

const BaseTab: React.FC<BaseTabProps> = ({
  tabs,
  defaultActiveId,
  activeId: controlledActiveId,
  activeTabId,
  onChange,
  onTabChange,
  className = '',
  variant = 'primary',
  fullWidth = false,
  rightContent,
  hideIfSingleTab = false,
  style,
  editable,
  editableTabs,
  onAddTab,
  onTabAdd,
  onCloseTab,
  onTabClose,
  addTabTooltip,
  closeTabTooltip,
  actions,
  actionMenuProps,
  actionMenu,
}) => {
  const { t } = useTranslation();
  const tabListWrapperRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const isEditable = Boolean(editable || editableTabs);

  const handleAddTab = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onAddTab) {
      onAddTab();
    } else if (onTabAdd) {
      onTabAdd();
    }
  };

  const handleCloseTab = (tab: BaseTabItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (tab.disabled) return;
    if (onCloseTab) {
      onCloseTab(tab.id, e);
    } else if (onTabClose) {
      onTabClose(tab.id, e);
    }
  };

  const effectiveControlledId = controlledActiveId !== undefined ? controlledActiveId : activeTabId;
  const isControlled = effectiveControlledId !== undefined;
  const [uncontrolledActiveId, setUncontrolledActiveId] = useState(defaultActiveId ?? tabs[0]?.id);
  
  const currentActiveId = isControlled ? effectiveControlledId : uncontrolledActiveId;

  const checkScroll = useCallback(() => {
    const el = tabListWrapperRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = tabListWrapperRef.current;
    if (!el) return;

    checkScroll();

    el.addEventListener('scroll', checkScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        checkScroll();
      });
      resizeObserver.observe(el);
      if (el.firstElementChild) {
        resizeObserver.observe(el.firstElementChild);
      }
    }

    const handleWindowResize = () => checkScroll();
    window.addEventListener('resize', handleWindowResize);

    return () => {
      el.removeEventListener('scroll', checkScroll);
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [tabs, checkScroll]);

  // Aktif sekme değiştiğinde görünür alana kaydır
  useEffect(() => {
    const el = tabListWrapperRef.current;
    if (!el) return;
    const activeBtn = el.querySelector('.md3-tab-btn.active') as HTMLElement | null;
    if (activeBtn) {
      const elRect = el.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();

      if (btnRect.left < elRect.left || btnRect.right > elRect.right) {
        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [currentActiveId]);

  const handleScrollLeft = () => {
    if (tabListWrapperRef.current) {
      tabListWrapperRef.current.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };

  const handleScrollRight = () => {
    if (tabListWrapperRef.current) {
      tabListWrapperRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (tabListWrapperRef.current && (canScrollLeft || canScrollRight)) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.deltaY !== 0) {
        e.currentTarget.scrollLeft += e.deltaY;
      }
    }
  };

  if ((!tabs || tabs.length === 0) && !isEditable) return null;

  const handleTabClick = (tab: BaseTabItem) => {
    if (tab.disabled) return;
    
    if (!isControlled) {
      setUncontrolledActiveId(tab.id);
    }
    
    if (onChange) {
      onChange(tab.id);
    }
    if (onTabChange) {
      onTabChange(tab.id);
    }
  };

  const activeTab = tabs.find(tItem => tItem.id === currentActiveId) || tabs[0];
  const activeTabContent = activeTab?.content;
  const showHeader = isEditable ? true : !(hideIfSingleTab && tabs.length === 1);

  return (
    <div className={`md3-tab-container ${className}`} style={style}>
      {showHeader && (
        <div className="md3-tab-header-container">
          {canScrollLeft && (
            <button
              type="button"
              className="md3-tab-scroll-btn md3-tab-scroll-left"
              onClick={handleScrollLeft}
              aria-label={t('onceki_sekmeler', 'Önceki sekmeler')}
              title={t('onceki_sekmeler', 'Önceki sekmeler')}
            >
              <ChevronLeft size={18} />
            </button>
          )}

          <div 
            className="md3-tab-list-wrapper"
            ref={tabListWrapperRef}
            onWheel={handleWheel}
          >
            <div className={`md3-tab-list ${variant} ${fullWidth ? 'full-width' : ''} ${isEditable ? 'editable' : ''}`} role="tablist">
              {tabs.map((tab) => {
                const isActive = tab.id === currentActiveId;
                const rawLabel = tab.label || tab.name || tab.title;
                const displayLabel = typeof rawLabel === 'string' ? t(rawLabel) : rawLabel;
                const isTabClosable = isEditable && tab.closable !== false;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-disabled={tab.disabled}
                    disabled={tab.disabled}
                    className={`md3-tab-btn ${isActive ? 'active' : ''} ${isTabClosable ? 'has-close' : ''}`}
                    onClick={() => handleTabClick(tab)}
                  >
                    <div className="md3-tab-content">
                      {tab.icon && <span className="md3-tab-icon">{tab.icon}</span>}
                      <span className="md3-tab-label">{displayLabel}</span>
                      {tab.actions && tab.actions.length > 0 && (
                        <span
                          className="md3-tab-item-action-menu-wrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ActionMenu
                            actions={tab.actions}
                            className="md3-tab-item-action-menu"
                            {...tab.actionMenuProps}
                          />
                        </span>
                      )}
                      {isTabClosable && (
                        <span
                          role="button"
                          tabIndex={0}
                          className="md3-tab-close-btn"
                          onClick={(e) => handleCloseTab(tab, e)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleCloseTab(tab, e as any);
                            }
                          }}
                          aria-label={closeTabTooltip || t('sekmeyi_kapat', 'Sekmeyi kapat')}
                          title={closeTabTooltip || t('sekmeyi_kapat', 'Sekmeyi kapat')}
                        >
                          <X size={14} />
                        </span>
                      )}
                    </div>
                    {isActive && (
                      <span className="md3-tab-indicator-container">
                        <span className="md3-tab-indicator"></span>
                      </span>
                    )}
                  </button>
                );
              })}

              {isEditable && (
                <button
                  type="button"
                  className="md3-tab-add-btn"
                  onClick={handleAddTab}
                  aria-label={addTabTooltip || t('yeni_sekme_ekle', 'Yeni sekme ekle')}
                  title={addTabTooltip || t('yeni_sekme_ekle', 'Yeni sekme ekle')}
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
          </div>

          {canScrollRight && (
            <button
              type="button"
              className="md3-tab-scroll-btn md3-tab-scroll-right"
              onClick={handleScrollRight}
              aria-label={t('sonraki_sekmeler', 'Sonraki sekmeler')}
              title={t('sonraki_sekmeler', 'Sonraki sekmeler')}
            >
              <ChevronRight size={18} />
            </button>
          )}

          {(rightContent || actionMenu || (actions && actions.length > 0)) && (
            <div className="md3-tab-right-content">
              {rightContent}
              {actionMenu}
              {actions && actions.length > 0 && !actionMenu && (
                <ActionMenu
                  actions={actions}
                  showDefaultActionAsButton={true}
                  className={`tab-header-action-menu ${actionMenuProps?.className || ''}`.trim()}
                  {...actionMenuProps}
                />
              )}
            </div>
          )}
        </div>
      )}
      
      {activeTabContent && (
        <div className="md3-tab-panel" role="tabpanel">
          {activeTabContent}
        </div>
      )}
    </div>
  );
};

export default BaseTab;
