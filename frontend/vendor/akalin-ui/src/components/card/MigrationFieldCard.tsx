/**
 * Akalin UI - Aktarım Alanı Kartı (MigrationFieldCard)
 * 
 * BaseCard sınıfından türeyen; veri aktarım sihirbazında (MigrationHubPage vb.)
 * aktarılacak varlık ve veri alanlarını (Cari, Adres, Stok, Marka vb.) sunan kart bileşenidir.
 * 
 * Başlıca Özellikleri:
 * - BaseCard mimarisi üzerine inşa edilmiştir.
 * - Bulunduğu katmana/layer'a tam genişlikte yatay olarak yayılır (width: 100%).
 * - Sol tarafında: Dairesel (circular) vurgulu ikon kutusu.
 * - Orta kesimde: Başlık, opsiyonel alt etiket/tablo adı, açıklama ve ilave detaylar/istatistikler.
 * - Sağ tarafında: BaseSwitch bileşeni ve opsiyonel kayıt adedi rozeti (badge).
 * - Tıklanabilir (interactive) yapı: Kartın geneline veya switch'e tıklandığında seçim durumu değişir.
 * - Sıfır inline CSS & tam responsive Material Design 3 (MD3) uyumu.
 */

import React from 'react';
import BaseCard, { BaseCardProps, CardVariant } from '../base/card/BaseCard';
import BaseSwitch from '../base/switch/BaseSwitch';

export interface MigrationFieldCardProps extends Omit<BaseCardProps, 'title' | 'onChange'> {
  /**
   * Sol tarafta dairesel (circular) kutuda gösterilecek ikon
   */
  icon: React.ReactNode;

  /**
   * İkonun renk tonu veya stili (primary, success, warning, info, secondary)
   * @default 'primary'
   */
  iconVariant?: 'primary' | 'success' | 'warning' | 'info' | 'secondary';

  /**
   * Kart ana başlığı (ör. 'Temel Cari Kartları')
   */
  title: React.ReactNode;

  /**
   * Başlığın yanında opsiyonel gösterilebilecek etiket / tablo adı (ör. 'TBLCARI Tablosu')
   */
  subtitle?: React.ReactNode;

  /**
   * Orta kesimde yer alan açıklama metni
   */
  description?: React.ReactNode;

  /**
   * Opsiyonel kayıt sayısı veya istatistik rozeti / bilgisi (ör. '3.375 Cari')
   */
  badge?: React.ReactNode;

  /**
   * Rozetin renk stili
   */
  badgeVariant?: 'primary' | 'success' | 'warning' | 'info' | 'secondary';

  /**
   * Kartın altında yer alacak ekstra istatistik/kırılım bilgileri (ör. 'Müşteri: 1.200 • Satıcı: 800')
   */
  extra?: React.ReactNode;

  /**
   * Sağ taraftaki BaseSwitch aktiflik durumu (checked)
   */
  checked: boolean;

  /**
   * BaseSwitch değeri veya kart seçimi değiştiğinde tetiklenecek fonksiyon
   */
  onChange?: (checked: boolean) => void;

  /**
   * Kart ve anahtarın devre dışı olma durumu
   * @default false
   */
  disabled?: boolean;

  /**
   * BaseCard varyantı ('outlined' | 'elevated' | 'filled')
   * @default 'outlined'
   */
  variant?: CardVariant;

  /**
   * Ekstra CSS sınıfları
   */
  className?: string;

  /**
   * Kart içi ilave içerik
   */
  children?: React.ReactNode;
}

const MigrationFieldCard = React.forwardRef<HTMLElement, MigrationFieldCardProps>(
  (
    {
      icon,
      iconVariant = 'primary',
      title,
      subtitle,
      description,
      badge,
      badgeVariant = 'primary',
      extra,
      checked,
      onChange,
      disabled = false,
      variant = 'outlined',
      interactive = true,
      className = '',
      children,
      ...rest
    },
    ref
  ) => {
    const handleCardClick = (e: React.MouseEvent<HTMLElement>) => {
      if (disabled) return;
      // Eğer tıklanan element doğrudan input checkbox ise switch kendi event'ini tetikler
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (onChange) {
        onChange(!checked);
      }
    };

    const cardClasses = [
      'migration-field-card',
      checked ? 'is-active' : '',
      disabled ? 'is-disabled' : '',
      className
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <BaseCard
        ref={ref}
        variant={variant}
        interactive={interactive && !disabled}
        onClick={handleCardClick}
        className={cardClasses}
        {...rest}
      >
        {/* 1. Sol: Dairesel (Circular) İkon Kutusu */}
        <div className={`migration-field-icon-circle ${iconVariant}`} aria-hidden="true">
          {icon}
        </div>

        {/* 2. Orta: Başlık, Tablo Adı, Açıklama ve Alt Bilgiler */}
        <div className="migration-field-center">
          <div className="migration-field-header">
            <h4 className="migration-field-title">{title}</h4>
            {subtitle && (
              <span className="migration-field-subtitle">{subtitle}</span>
            )}
            {badge && (
              <span className={`migration-field-badge ${badgeVariant}`}>
                {badge}
              </span>
            )}
          </div>

          {description && (
            <p className="migration-field-desc">{description}</p>
          )}

          {extra && (
            <div className="migration-field-extra">
              {extra}
            </div>
          )}

          {children}
        </div>

        {/* 3. Sağ: BaseSwitch Anahtarı */}
        <div 
          className="migration-field-right"
          onClick={(e) => e.stopPropagation()}
        >
          <BaseSwitch
            checked={checked}
            disabled={disabled}
            onChange={(e) => {
              if (onChange) {
                onChange(e.target.checked);
              }
            }}
          />
        </div>
      </BaseCard>
    );
  }
);

MigrationFieldCard.displayName = 'MigrationFieldCard';

export type MigrationOptionCardProps = MigrationFieldCardProps;
export default MigrationFieldCard;
