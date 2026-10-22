import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X
} from 'lucide-react';
import { SidebarProps, SidebarItem, SidebarBadge, FlyoutState } from './Sidebar.types';
import { SidebarFlyout } from './SidebarFlyout';
import './Sidebar.css';

const renderBadgeElement = (badge?: SidebarBadge) => {
  if (!badge || badge.text === undefined || badge.text === null || badge.text === '') {
    return null;
  }
  const variantClass = badge.variant ? `akalin-sidebar-badge--${badge.variant}` : 'akalin-sidebar-badge--primary';
  return (
    <span className={`akalin-sidebar-badge ${variantClass}`}>
      {badge.text}
    </span>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  items,
  isCollapsed = false,
  onToggleCollapse,
  isOpenMobile = false,
  onCloseMobile,
  currentPath,
  isItemActive,
  renderLink,
  header,
  footer,
  logo,
  showSearch = false,
  searchPlaceholder = 'Menüde ara...',
  collapseTogglePosition = 'header',
  className = ''
}) => {
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});
  const [flyoutState, setFlyoutState] = useState<FlyoutState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  // Active Route Detection
  const checkIsItemActive = useCallback(
    (item: SidebarItem): boolean => {
      if (isItemActive) {
        return isItemActive(item);
      }
      if (!item.path || !currentPath) {
        return false;
      }
      if (item.path === '/') {
        return currentPath === '/';
      }
      return (
        currentPath === item.path ||
        currentPath.startsWith(item.path + '/') ||
        currentPath.startsWith(item.path + '?')
      );
    },
    [isItemActive, currentPath]
  );

  // Recursive Active Child Detection
  const hasActiveChild = useCallback(
    (item: SidebarItem): boolean => {
      if (!item.children || item.children.length === 0) return false;
      return item.children.some(
        (child) => checkIsItemActive(child) || hasActiveChild(child)
      );
    },
    [checkIsItemActive]
  );

  // Automatically expand groups that contain an active route
  useEffect(() => {
    if (!currentPath && !isItemActive) return;

    setExpandedGroupIds((prev) => {
      let changed = false;
      const next = { ...prev };

      const checkAndExpand = (itemList: SidebarItem[]) => {
        for (const item of itemList) {
          if (item.children && item.children.length > 0) {
            if (hasActiveChild(item) && !next[item.id]) {
              next[item.id] = true;
              changed = true;
            }
            checkAndExpand(item.children);
          }
        }
      };

      checkAndExpand(items);
      return changed ? next : prev;
    });
  }, [items, currentPath, isItemActive, hasActiveChild]);

  // Safe Hover Bridge Helpers for Flyout
  const cancelCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const startCloseTimer = useCallback(() => {
    cancelCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setFlyoutState(null);
    }, 180);
  }, [cancelCloseTimer]);

  const handleItemMouseEnter = (item: SidebarItem, e: React.MouseEvent<HTMLElement>) => {
    if (!isCollapsed) return;

    cancelCloseTimer();
    const rect = e.currentTarget.getBoundingClientRect();
    const isTooltipOnly = !item.children || item.children.length === 0;

    setFlyoutState({
      item,
      coords: {
        top: rect.top,
        left: rect.right + 10
      },
      isTooltipOnly
    });
  };

  const handleItemMouseLeave = () => {
    if (!isCollapsed) return;
    startCloseTimer();
  };

  const closeFlyout = useCallback(() => {
    cancelCloseTimer();
    setFlyoutState(null);
  }, [cancelCloseTimer]);

  // Close flyout on collapse toggle
  useEffect(() => {
    closeFlyout();
  }, [isCollapsed, closeFlyout]);

  // Mobile Drawer ESC key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isOpenMobile && onCloseMobile) {
          onCloseMobile();
        }
        closeFlyout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpenMobile, onCloseMobile, closeFlyout]);

  // Toggle Accordion Group in Expanded Mode
  const toggleGroup = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedGroupIds((prev) => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // Search Filter Logic
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('tr');
    if (!query) {
      return items;
    }

    const filterRecursive = (itemList: SidebarItem[]): SidebarItem[] => {
      const results: SidebarItem[] = [];

      for (const item of itemList) {
        const itemLabelMatches = item.label.toLocaleLowerCase('tr').includes(query);

        if (item.children && item.children.length > 0) {
          const matchingChildren = filterRecursive(item.children);

          if (itemLabelMatches) {
            // Parent matched; include parent and all its children
            results.push(item);
          } else if (matchingChildren.length > 0) {
            // Children matched; include parent with only matching children
            results.push({
              ...item,
              children: matchingChildren
            });
          }
        } else if (itemLabelMatches) {
          results.push(item);
        }
      }

      return results;
    };

    return filterRecursive(items);
  }, [items, searchQuery]);

  // When filtering via search, automatically expand all parent groups
  useEffect(() => {
    if (!searchQuery.trim()) return;

    setExpandedGroupIds((prev) => {
      const next = { ...prev };
      const expandAll = (list: SidebarItem[]) => {
        for (const it of list) {
          if (it.children && it.children.length > 0) {
            next[it.id] = true;
            expandAll(it.children);
          }
        }
      };
      expandAll(filteredItems);
      return next;
    });
  }, [searchQuery, filteredItems]);

  // Collapse Toggle Button Renderer
  const renderCollapseToggle = () => {
    if (collapseTogglePosition === 'none' || !onToggleCollapse) {
      return null;
    }

    return (
      <button
        type="button"
        className="akalin-sidebar-toggle-btn"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? 'Menüyü Genişlet' : 'Menüyü Daralt'}
        title={isCollapsed ? 'Menüyü Genişlet' : 'Menüyü Daralt'}
      >
        {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
    );
  };

  // Render an individual sidebar item
  const renderSidebarItem = (item: SidebarItem, isChild = false) => {
    const hasChildren = Boolean(item.children && item.children.length > 0);
    const active = checkIsItemActive(item);
    const childActive = hasActiveChild(item);
    const isExpanded = Boolean(expandedGroupIds[item.id]);

    const itemContainerClass = [
      'akalin-sidebar-item',
      hasChildren ? 'akalin-sidebar-item--parent' : '',
      childActive ? 'is-child-active' : ''
    ]
      .filter(Boolean)
      .join(' ');

    const linkClassName = [
      'akalin-sidebar-link',
      active ? 'is-active' : '',
      item.disabled ? 'is-disabled' : ''
    ]
      .filter(Boolean)
      .join(' ');

    const handleClick = (e: React.MouseEvent) => {
      if (item.disabled) return;

      if (hasChildren) {
        if (isCollapsed) {
          // In collapsed rail mode, clicking toggles the flyout
          const rect = e.currentTarget.getBoundingClientRect();
          setFlyoutState((prev) =>
            prev?.item.id === item.id
              ? null
              : {
                  item,
                  coords: {
                    top: rect.top,
                    left: rect.right + 10
                  },
                  isTooltipOnly: false
                }
          );
        } else {
          toggleGroup(item.id, e);
        }
      } else {
        if (isOpenMobile && onCloseMobile) {
          onCloseMobile();
        }
      }

      if (item.onClick) {
        item.onClick(item, e);
      }
    };

    const linkContent = (
      <>
        {item.icon && <span className="akalin-sidebar-icon">{item.icon}</span>}
        <span className="akalin-sidebar-label">{item.label}</span>
        {renderBadgeElement(item.badge)}
        {hasChildren && !isCollapsed && (
          <span
            className={`akalin-sidebar-arrow ${isExpanded ? 'is-expanded' : ''}`}
            aria-hidden="true"
          >
            <ChevronRight size={16} />
          </span>
        )}
      </>
    );

    return (
      <li
        key={item.id}
        className={itemContainerClass}
        onMouseEnter={(e) => handleItemMouseEnter(item, e)}
        onMouseLeave={handleItemMouseLeave}
      >
        {renderLink && !hasChildren ? (
          renderLink({
            item,
            className: linkClassName,
            children: linkContent,
            onClick: handleClick
          })
        ) : item.path && !hasChildren ? (
          <a
            href={item.path}
            target={item.target}
            className={linkClassName}
            onClick={handleClick}
            aria-current={active ? 'page' : undefined}
          >
            {linkContent}
          </a>
        ) : (
          <button
            type="button"
            disabled={item.disabled}
            className={linkClassName}
            onClick={handleClick}
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {linkContent}
          </button>
        )}

        {/* Accordion Submenu (when expanded and not collapsed) */}
        {hasChildren && !isCollapsed && (
          <div className={`akalin-sidebar-submenu ${isExpanded ? 'is-expanded' : ''}`}>
            <div className="akalin-sidebar-submenu-inner">
              <ul className="akalin-sidebar-list">
                {item.children!.map((child) => renderSidebarItem(child, true))}
              </ul>
            </div>
          </div>
        )}
      </li>
    );
  };

  const containerClasses = [
    'akalin-sidebar',
    isCollapsed ? 'akalin-sidebar--collapsed' : '',
    isOpenMobile ? 'akalin-sidebar--mobile-open' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      <div
        className={`akalin-sidebar-overlay ${isOpenMobile ? 'is-visible' : ''}`}
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      {/* Main Sidebar Element */}
      <aside ref={sidebarRef} className={containerClasses} role="navigation" aria-label="Ana Menü">
        {/* Header Slot */}
        {(header || logo || collapseTogglePosition === 'header') && (
          <div className="akalin-sidebar-header">
            {header ? (
              header
            ) : logo ? (
              <div
                className={`akalin-sidebar-logo-container ${logo.onClick ? 'is-interactive' : ''}`}
                onClick={logo.onClick}
                role={logo.onClick ? 'button' : undefined}
                tabIndex={logo.onClick ? 0 : undefined}
              >
                {logo.src && (
                  <img
                    src={logo.src}
                    alt={logo.alt || logo.title || 'Logo'}
                    className="akalin-sidebar-logo"
                  />
                )}
                {(logo.title || logo.subtitle) && (
                  <div className="akalin-sidebar-logo-text">
                    {logo.title && <span className="akalin-sidebar-logo-title">{logo.title}</span>}
                    {logo.subtitle && (
                      <span className="akalin-sidebar-logo-subtitle">{logo.subtitle}</span>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            {collapseTogglePosition === 'header' && renderCollapseToggle()}
          </div>
        )}

        {/* Optional Search / Quick Filter Bar */}
        {showSearch && (
          <div className="akalin-sidebar-search-container">
            {isCollapsed ? (
              <button
                type="button"
                className="akalin-sidebar-search-rail-btn"
                onClick={onToggleCollapse}
                title="Menüde Ara"
                aria-label="Menüde Ara"
              >
                <Search size={18} />
              </button>
            ) : (
              <div className="akalin-sidebar-search-wrapper">
                <span className="akalin-sidebar-search-icon" aria-hidden="true">
                  <Search size={16} />
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="akalin-sidebar-search-input"
                  aria-label={searchPlaceholder}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="akalin-sidebar-search-clear"
                    aria-label="Aramayı Temizle"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Navigation List */}
        <nav className="akalin-sidebar-nav">
          {filteredItems.length === 0 ? (
            <div className="akalin-sidebar-empty-search">
              <span>Sonuç bulunamadı</span>
            </div>
          ) : (
            <ul className="akalin-sidebar-list">
              {filteredItems.map((item) => renderSidebarItem(item))}
            </ul>
          )}
        </nav>

        {/* Footer Slot */}
        {(footer || collapseTogglePosition === 'footer') && (
          <div className="akalin-sidebar-footer">
            {footer && <div className="akalin-sidebar-footer-custom">{footer}</div>}
            {collapseTogglePosition === 'footer' && renderCollapseToggle()}
          </div>
        )}
      </aside>

      {/* Floating Submenu Portal (Flyout when collapsed) */}
      {isCollapsed && flyoutState && (
        <SidebarFlyout
          item={flyoutState.item}
          coords={flyoutState.coords}
          isTooltipOnly={flyoutState.isTooltipOnly}
          onMouseEnter={cancelCloseTimer}
          onMouseLeave={startCloseTimer}
          onClose={closeFlyout}
          isItemActive={checkIsItemActive}
          renderLink={renderLink}
        />
      )}
    </>
  );
};

export default Sidebar;
