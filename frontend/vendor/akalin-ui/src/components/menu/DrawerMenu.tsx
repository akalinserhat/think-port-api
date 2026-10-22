import React, { useState, useRef, useEffect, ReactNode } from 'react';
import { Bell, Moon, Sun, Globe, LogOut, Shield, Building } from 'lucide-react';

export interface DrawerUser {
  ad?: string;
  soyad?: string;
  adSoyad?: string;
  email?: string;
  firmaAdi?: string;
  subeAdi?: string;
  rol?: string;
  [key: string]: any;
}

export interface DrawerMenuItem {
  id?: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  badge?: ReactNode;
  danger?: boolean;
  dividerBefore?: boolean;
  dividerAfter?: boolean;
  hidden?: boolean;
}

export interface DrawerMenuProps {
  user?: DrawerUser | null;
  unreadNotificationCount?: number;
  onNotificationClick?: () => void;
  theme?: 'light' | 'dark' | string;
  onThemeToggle?: () => void;
  language?: string;
  onLanguageToggle?: () => void;
  onLogout?: () => void;
  customItems?: DrawerMenuItem[];
  customHeader?: ReactNode;
  customTrigger?: (props: { isOpen: boolean; toggle: () => void; user?: DrawerUser | null; unreadCount: number }) => ReactNode;
  notificationLabel?: string;
  themeLightLabel?: string;
  themeDarkLabel?: string;
  languageLabel?: string;
  logoutLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

const DrawerMenu: React.FC<DrawerMenuProps> = ({
  user,
  unreadNotificationCount = 0,
  onNotificationClick,
  theme = 'light',
  onThemeToggle,
  language,
  onLanguageToggle,
  onLogout,
  customItems = [],
  customHeader,
  customTrigger,
  notificationLabel = 'Bildirimler',
  themeLightLabel = 'Aydınlık Tema',
  themeDarkLabel = 'Karanlık Tema',
  languageLabel,
  logoutLabel = 'Çıkış Yap',
  className = '',
  style
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggle = () => setIsOpen((prev) => !prev);
  const close = () => setIsOpen(false);

  // Initials calculation
  const getInitials = () => {
    if (user?.adSoyad) {
      const parts = user.adSoyad.trim().split(' ').filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
      }
      return parts[0]?.substring(0, 2).toUpperCase() || 'AD';
    }
    if (user?.ad) {
      return `${user.ad[0]}${user.soyad ? user.soyad[0] : ''}`.toUpperCase();
    }
    return 'AD';
  };

  const displayName = user?.adSoyad || (user?.ad ? `${user.ad} ${user.soyad || ''}`.trim() : 'Kullanıcı');

  return (
    <div className={`drawer-menu-container ${className}`} ref={menuRef} style={style}>
      {/* Trigger Button */}
      {customTrigger ? (
        customTrigger({ isOpen, toggle, user, unreadCount: unreadNotificationCount })
      ) : (
        <button
          type="button"
          onClick={toggle}
          aria-label="Kullanıcı Menüsü"
          aria-expanded={isOpen}
          className={`drawer-menu-trigger-btn ${isOpen ? 'open' : ''}`}
        >
          {getInitials()}
          {unreadNotificationCount > 0 && (
            <span className="drawer-menu-badge-dot" />
          )}
        </button>
      )}

      {/* Dropdown / Drawer Popup Menu */}
      {isOpen && (
        <div className="drawer-menu-dropdown fade-in-fast">
          {/* User Header Section */}
          {customHeader ? (
            customHeader
          ) : (
            <div className="drawer-menu-header">
              <div className="drawer-menu-user-name">{displayName}</div>
              <div className="drawer-menu-user-sub">
                {user?.firmaAdi ? (
                  <>
                    <Building size={12} /> {user.firmaAdi} {user.subeAdi ? `- ${user.subeAdi}` : ''}
                  </>
                ) : (
                  <>
                    <Shield size={12} /> {user?.email || user?.rol || 'Sistem Yöneticisi'}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Notifications Item */}
          {onNotificationClick && (
            <button
              type="button"
              className="drawer-menu-item"
              onClick={() => {
                close();
                onNotificationClick();
              }}
            >
              <Bell size={18} />
              <span className="drawer-menu-item-text">{notificationLabel}</span>
              {unreadNotificationCount > 0 && (
                <span className="drawer-menu-count-badge">
                  {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                </span>
              )}
            </button>
          )}

          {/* Theme Toggle Item */}
          {onThemeToggle && (
            <button
              type="button"
              className="drawer-menu-item"
              onClick={() => {
                onThemeToggle();
              }}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              <span className="drawer-menu-item-text">{theme === 'light' ? themeDarkLabel : themeLightLabel}</span>
            </button>
          )}

          {/* Language Toggle Item */}
          {onLanguageToggle && (
            <button
              type="button"
              className="drawer-menu-item"
              onClick={() => {
                onLanguageToggle();
              }}
            >
              <Globe size={18} />
              <span className="drawer-menu-item-text">
                {languageLabel || `Dil: ${language ? language.toUpperCase() : 'TR'}`}
              </span>
            </button>
          )}

          {/* Custom Items */}
          {customItems.map((item, idx) => {
            if (item.hidden) return null;
            return (
              <React.Fragment key={item.id || idx}>
                {item.dividerBefore && <div className="drawer-menu-divider small" />}
                <button
                  type="button"
                  className={`drawer-menu-item ${item.danger ? 'danger' : ''}`}
                  onClick={() => {
                    close();
                    if (item.onClick) item.onClick();
                  }}
                >
                  {item.icon}
                  <span className="drawer-menu-item-text">{item.label}</span>
                  {item.badge}
                </button>
                {item.dividerAfter && <div className="drawer-menu-divider small" />}
              </React.Fragment>
            );
          })}

          {/* Divider */}
          {onLogout && <div className="drawer-menu-divider" />}

          {/* Logout Item */}
          {onLogout && (
            <button
              type="button"
              className="drawer-menu-item danger"
              onClick={() => {
                close();
                onLogout();
              }}
            >
              <LogOut size={18} />
              <span className="drawer-menu-item-text">{logoutLabel}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DrawerMenu;
