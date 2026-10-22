import React, { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { SidebarItem, SidebarBadge } from './Sidebar.types';

export interface SidebarFlyoutProps {
  item: SidebarItem;
  coords: {
    top: number;
    left: number;
  };
  isTooltipOnly?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClose: () => void;
  isItemActive: (item: SidebarItem) => boolean;
  renderLink?: (props: {
    item: SidebarItem;
    className: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
  }) => React.ReactNode;
}

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

export const SidebarFlyout: React.FC<SidebarFlyoutProps> = ({
  item,
  coords,
  isTooltipOnly = false,
  onMouseEnter,
  onMouseLeave,
  onClose,
  isItemActive,
  renderLink
}) => {
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [clampedCoords, setClampedCoords] = useState<{ top: number; left: number }>(coords);

  // Viewport Boundary Clamping
  useLayoutEffect(() => {
    if (!flyoutRef.current || typeof window === 'undefined') return;

    const rect = flyoutRef.current.getBoundingClientRect();
    const padding = 16;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    let adjustedTop = coords.top;
    let adjustedLeft = coords.left;

    // Vertical boundary clamping
    if (adjustedTop + rect.height > viewportHeight - padding) {
      adjustedTop = Math.max(padding, viewportHeight - rect.height - padding);
    }
    if (adjustedTop < padding) {
      adjustedTop = padding;
    }

    // Horizontal boundary clamping (if window is narrow)
    if (adjustedLeft + rect.width > viewportWidth - padding) {
      adjustedLeft = Math.max(padding, viewportWidth - rect.width - padding);
    }

    if (adjustedTop !== clampedCoords.top || adjustedLeft !== clampedCoords.left) {
      setClampedCoords({ top: adjustedTop, left: adjustedLeft });
    }
  }, [coords.top, coords.left]);

  // Close on outside click or escape key
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (typeof document === 'undefined') {
    return null;
  }

  // Mini Tooltip for single rail items without children
  if (isTooltipOnly || !item.children || item.children.length === 0) {
    return createPortal(
      <div
        ref={flyoutRef}
        role="tooltip"
        className="akalin-sidebar-flyout akalin-sidebar-flyout--tooltip"
        style={{
          position: 'fixed',
          top: `${clampedCoords.top}px`,
          left: `${clampedCoords.left}px`
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <span>{item.label}</span>
        {renderBadgeElement(item.badge)}
      </div>,
      document.body
    );
  }

  // Full Flyout Submenu Panel
  return createPortal(
    <div
      ref={flyoutRef}
      role="menu"
      aria-label={item.label}
      className="akalin-sidebar-flyout"
      style={{
        position: 'fixed',
        top: `${clampedCoords.top}px`,
        left: `${clampedCoords.left}px`
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Header with Parent Title & Badge */}
      <div className="akalin-sidebar-flyout-header">
        <div className="akalin-sidebar-flyout-header-info">
          {item.icon && <span className="akalin-sidebar-icon">{item.icon}</span>}
          <span className="akalin-sidebar-flyout-title">{item.label}</span>
        </div>
        {renderBadgeElement(item.badge)}
      </div>

      {/* Children Links */}
      <ul className="akalin-sidebar-flyout-list">
        {item.children.map((child) => {
          const active = isItemActive(child);
          const childClassName = `akalin-sidebar-flyout-link ${active ? 'is-active' : ''} ${child.disabled ? 'is-disabled' : ''}`.trim();

          const handleChildClick = (e: React.MouseEvent) => {
            if (child.disabled) return;
            if (child.onClick) {
              child.onClick(child, e);
            }
            onClose();
          };

          const childContent = (
            <>
              {child.icon && <span className="akalin-sidebar-icon">{child.icon}</span>}
              <span className="akalin-sidebar-label">{child.label}</span>
              {renderBadgeElement(child.badge)}
            </>
          );

          return (
            <li key={child.id} className="akalin-sidebar-flyout-item" role="none">
              {renderLink ? (
                renderLink({
                  item: child,
                  className: childClassName,
                  children: childContent,
                  onClick: handleChildClick
                })
              ) : child.path ? (
                <a
                  href={child.path}
                  target={child.target}
                  className={childClassName}
                  onClick={handleChildClick}
                  aria-current={active ? 'page' : undefined}
                >
                  {childContent}
                </a>
              ) : (
                <button
                  type="button"
                  disabled={child.disabled}
                  className={childClassName}
                  onClick={handleChildClick}
                  aria-current={active ? 'page' : undefined}
                >
                  {childContent}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>,
    document.body
  );
};

export default SidebarFlyout;
