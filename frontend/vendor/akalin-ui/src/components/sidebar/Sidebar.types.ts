import React from 'react';

export interface SidebarBadge {
  text: string | number;
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';
}

export interface SidebarItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  path?: string;
  children?: SidebarItem[];
  badge?: SidebarBadge;
  disabled?: boolean;
  target?: string;
  onClick?: (item: SidebarItem, e: React.MouseEvent) => void;
  meta?: Record<string, any>;
}

export interface SidebarProps {
  items: SidebarItem[];
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  currentPath?: string;
  isItemActive?: (item: SidebarItem) => boolean;
  renderLink?: (props: {
    item: SidebarItem;
    className: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
  }) => React.ReactNode;

  // Üst & Alt Özelleştirme Alanları (Slots)
  header?: React.ReactNode;
  footer?: React.ReactNode;
  logo?: {
    src?: string;
    alt?: string;
    title?: string;
    subtitle?: string;
    onClick?: () => void;
  };

  // Arama / Hızlı Filtre (Opsiyonel)
  showSearch?: boolean;
  searchPlaceholder?: string;

  // Konfigürasyon
  collapseTogglePosition?: 'header' | 'footer' | 'none';
  className?: string;
}

export interface FlyoutState {
  item: SidebarItem;
  coords: {
    top: number;
    left: number;
  };
  isTooltipOnly?: boolean;
}
