/**
 * Akalin UI - SistemKart (Sistem Ayarları Modül Kartı)
 * BaseCard temel bileşeni üzerine inşa edilmiş, Sistem Ayarları hub sayfasında
 * ayar modüllerini (Logo, EVDS, SMTP, vb.) görsel ve etkileşimli kartlar olarak sunan bileşen.
 * 
 * Başlıca Görevleri:
 * - BaseCard üzerinden MD3 elevation, outlined veya filled varyantlarını ve etkileşim durumlarını yönetmek
 * - Vurgulu ikon kutusu, modül başlığı ve açıklama metnini görsel hiyerarşiyle sunmak
 * - Rozet (badge), etiket veya ek içerik alanlarını desteklemek
 * - Sistem ayarları sayfalarında tutarlı ve modüler kart deneyimi sağlamak
 */

import React from 'react';
import { BaseCard, BaseCardProps, CardVariant } from '../base/card';

export interface SistemKartProps extends Omit<BaseCardProps, 'children' | 'title'> {
  /** Modül veya ayar grubu tekil kimliği */
  id?: string;
  /** Kartın ana başlığı */
  title: string | React.ReactNode;
  /** Kartın açıklama metni */
  description?: string | React.ReactNode;
  /** Kartın sol üst/orta ikon öğesi */
  icon?: React.ReactNode;
  /** Kartın sağ üst köşesinde gösterilecek opsiyonel rozet/etiket */
  badge?: React.ReactNode | string;
  /** Tıklanma olayı callback'i */
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  /** Ekstra alt veya orta içerik */
  extraContent?: React.ReactNode;
  /** İkon taşıyıcı kutusunun özel CSS sınıfı */
  iconWrapperClassName?: string;
  /** İkon taşıyıcı kutusunun özel stilleri */
  iconWrapperStyle?: React.CSSProperties;
  /** Kart varyantı (elevated, filled, outlined) */
  variant?: CardVariant;
  /** Kart seçili / aktif olarak vurgulanmış mı? */
  isSelected?: boolean;
}

const SistemKart = React.forwardRef<HTMLElement, SistemKartProps>(
  (
    {
      id,
      title,
      description,
      icon,
      badge,
      onClick,
      extraContent,
      iconWrapperClassName = '',
      iconWrapperStyle,
      variant = 'elevated',
      className = '',
      isSelected = false,
      style,
      ...rest
    },
    ref
  ) => {
    return (
      <BaseCard
        ref={ref}
        id={id ? `system-card-${id}` : undefined}
        data-module-id={id}
        variant={variant}
        interactive={true}
        onClick={onClick}
        className={`settings-card ${isSelected ? 'is-selected' : ''} ${className}`}
        style={style}
        {...rest}
      >
        {badge && (
          <div className="settings-card-badge">
            {badge}
          </div>
        )}

        {icon && (
          <div
            className={`settings-card-icon-wrapper ${iconWrapperClassName}`}
            style={iconWrapperStyle}
          >
            {icon}
          </div>
        )}

        <div className="settings-card-text-wrapper">
          <h3 className="settings-card-title">
            {title}
          </h3>
          {description && (
            <p className="settings-card-desc">
              {description}
            </p>
          )}
        </div>

        {extraContent && (
          <div className="settings-card-extra">
            {extraContent}
          </div>
        )}
      </BaseCard>
    );
  }
);

SistemKart.displayName = 'SistemKart';

export default SistemKart;
