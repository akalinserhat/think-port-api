/**
 * Akalin UI - BaseSystemCard (Sistem Modül ve Kart Temel Bileşeni)
 * BaseCard sınıfından türetilmiştir. Sistem Ayarları altındaki tüm modül ve alt sayfa
 * kartlarında (Banka Hesapları, POS Cihazları, Kasalar, Depolar, KDV, Para Birimleri, vb.)
 * birleşik, modern ve tutarlı bir Material Design 3 (MD3) kart deneyimi sunar.
 * 
 * Özellikleri:
 * - BaseCard mimarisi (elevated, filled, outlined, interactive) üzerine kuruludur.
 * - Başlık alanı: Sol tarafta vurgulu ikon/avatar kutusu, başlık, varsayılan hap rozeti, ek rozetler ve alt başlık.
 * - Sağ tarafta: 3 noktalı ActionMenu veya özel aksiyonlar.
 * - Orta kesim: İsteğe bağlı etiketler (chips/tags) ve ek içerikler (middleContent).
 * - Detay kutusu (Card-in-card): Modern iç kart yapısında anahtar-değer listesi (details) ve .status-dot destekli durum (Aktif/Pasif).
 * - Sıfır inline CSS & tam i18n entegrasyonu.
 */

import React from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BaseCard, { BaseCardProps } from '../base/card/BaseCard';
import ActionMenu, { ActionMenuItem } from '../menu/ActionMenu';

export interface BaseSystemCardDetailItem {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
  valueClassName?: string;
}

export interface BaseSystemCardStatus {
  active: boolean;
  label?: React.ReactNode;
  activeText?: string;
  passiveText?: string;
}

export type BaseSystemCardBorderHighlight = 
  | 'primary' 
  | 'success' 
  | 'danger' 
  | 'warning' 
  | 'border-l-success' 
  | 'border-l-danger' 
  | 'border-l-warning'
  | 'border-l-primary'
  | 'none';

export type BaseSystemCardIconBoxVariant = 'primary' | 'secondary' | 'warning' | 'success' | 'danger';

export interface BaseSystemCardProps extends Omit<BaseCardProps, 'title'> {
  /** Kartın sol üst ikon veya avatar öğesi */
  icon?: React.ReactNode;
  /** İkon kutusunun renk varyantı (primary, secondary, warning, success, danger) */
  iconBoxVariant?: BaseSystemCardIconBoxVariant;
  /** İkon kutusuna eklenecek özel sınıf */
  iconBoxClassName?: string;
  /** Kartın ana başlığı */
  title: React.ReactNode;
  /** Başlık için özel sınıf */
  titleClassName?: string;
  /** Alt başlık veya kod bilgisi */
  subtitle?: React.ReactNode;
  /** Alt başlık için özel sınıf */
  subtitleClassName?: string;
  /** Başlığın yanında veya altında gösterilecek rozet / etiket */
  badge?: React.ReactNode;
  /** Kartın varsayılan (default) olup olmadığı */
  isDefault?: boolean;
  /** Varsayılan hap rozeti metni (Varsayılan: VARSAYILAN) */
  defaultPillText?: string;
  /** 3 noktalı ActionMenu için aksiyonlar */
  actions?: ActionMenuItem[];
  /** Özel aksiyon alanı (ActionMenu yerine özel düğmeler vermek için) */
  actionMenu?: React.ReactNode;
  /** Kenarlık vurgusu ('primary', 'border-l-success', vb.) */
  borderHighlight?: BaseSystemCardBorderHighlight;
  /** Başlık ile detay kutusu arasına eklenebilecek orta içerik */
  middleContent?: React.ReactNode;
  extraContent?: React.ReactNode;
  /** Kart içi özet anahtar-değer listesi */
  details?: BaseSystemCardDetailItem[];
  /** Detay kutusu özel CSS sınıfı */
  detailsClassName?: string;
  /** Detay kutusunu tamamen gizlemek için */
  hideDetailsBox?: boolean;
  /** Kart durum bilgisi (Aktif / Pasif) */
  status?: BaseSystemCardStatus;
  /** Kartın alt kısmına eklenecek footer alanı */
  footer?: React.ReactNode;
}

const BaseSystemCard = React.forwardRef<HTMLElement, BaseSystemCardProps>(
  (
    {
      icon,
      iconBoxVariant = 'secondary',
      iconBoxClassName = '',
      title,
      titleClassName = '',
      subtitle,
      subtitleClassName = '',
      badge,
      isDefault = false,
      defaultPillText,
      actions,
      actionMenu,
      borderHighlight = 'none',
      middleContent,
      extraContent,
      details,
      detailsClassName = '',
      hideDetailsBox = false,
      status,
      footer,
      variant = 'elevated',
      interactive,
      className = '',
      children,
      onClick,
      ...rest
    },
    ref
  ) => {
    const { t } = useTranslation();

    const isInteractive = interactive !== undefined ? interactive : Boolean(onClick);

    // Kenarlık vurgusu
    let highlightClass = '';
    if (isDefault || borderHighlight === 'primary') {
      highlightClass = 'currency-card is-default border-primary';
    } else if (borderHighlight === 'border-l-success' || borderHighlight === 'success') {
      highlightClass = 'border-l-success';
    } else if (borderHighlight === 'border-l-danger' || borderHighlight === 'danger') {
      highlightClass = 'border-l-danger';
    } else if (borderHighlight === 'border-l-warning' || borderHighlight === 'warning') {
      highlightClass = 'border-l-warning';
    } else if (borderHighlight === 'border-l-primary') {
      highlightClass = 'border-l-primary';
    }

    // İkon kutusu renk sınıfı
    let iconVariantClass = 'bg-secondary text-primary';
    if (iconBoxVariant === 'primary' || (isDefault && iconBoxVariant === 'secondary')) {
      iconVariantClass = 'bg-accent-primary text-white shadow-primary-sm';
    } else if (iconBoxVariant === 'warning') {
      iconVariantClass = 'bg-warning-light text-warning';
    } else if (iconBoxVariant === 'success') {
      iconVariantClass = 'bg-success-light text-success';
    } else if (iconBoxVariant === 'danger') {
      iconVariantClass = 'bg-danger-light text-danger';
    }

    const cardClasses = [
      'base-system-card',
      'border-glass',
      isInteractive ? 'cursor-pointer hover-elevate' : '',
      'transition-all',
      highlightClass,
      className
    ]
      .filter(Boolean)
      .join(' ');

    const hasDetailsBox = !hideDetailsBox && (
      (details && details.length > 0) || 
      status !== undefined || 
      children !== undefined
    );

    return (
      <BaseCard
        ref={ref}
        variant={variant}
        interactive={isInteractive}
        onClick={onClick}
        className={cardClasses}
        {...rest}
      >
        {/* Top Section: Header, Subtitle, Badges, Middle Content */}
        <div className="flex flex-col gap-12 min-w-0 w-full">
          {/* Header: Icon, Title, Subtitle, Badges, ActionMenu */}
          <div className="base-system-card-header">
            <div className="flex-row items-center gap-16 min-w-0 flex-1">
              {icon && (
                <div
                  className={`icon-box-large rounded-16 ${iconVariantClass} font-bold text-22 flex items-center justify-center flex-shrink-0 ${iconBoxClassName}`}
                >
                  {icon}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-8 mb-4 flex-wrap">
                  {typeof title === 'string' ? (
                    <h3 className={`m-0 text-16 font-bold text-primary tracking-tight truncate ${titleClassName}`}>
                      {title}
                    </h3>
                  ) : (
                    title
                  )}
                  {isDefault && (
                    <span className="default-pill">
                      <Star size={10} fill="#fff" />{' '}
                      {defaultPillText || t('ParaBirimleri_varsayilan', 'VARSAYILAN')}
                    </span>
                  )}
                  {badge}
                </div>
                {subtitle && (
                  typeof subtitle === 'string' ? (
                    <div className={`text-13 text-secondary font-medium truncate ${subtitleClassName}`}>
                      {subtitle}
                    </div>
                  ) : (
                    subtitle
                  )
                )}
              </div>
            </div>

            {actions && actions.length > 0 && (
              <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
                <ActionMenu actions={actions} />
              </div>
            )}
            {actionMenu && (
              <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
                {actionMenu}
              </div>
            )}
          </div>

          {/* Middle / Extra content (Tags, chips, etc.) */}
          {(middleContent || extraContent) && (
            <div className="flex flex-col gap-8">
              {middleContent}
              {extraContent}
            </div>
          )}
        </div>

        {/* Details Box (Card-in-Card) */}
        {hasDetailsBox && (
          <div className={`base-system-card-details ${detailsClassName}`}>
            {details && details.map((d, idx) => (
              <div key={idx} className={`base-system-card-detail-row ${d.className || ''}`}>
                <span className="base-system-card-detail-label">{d.label}</span>
                <span className={`base-system-card-detail-value ${d.valueClassName || ''}`}>
                  {d.value}
                </span>
              </div>
            ))}

            {children}

            {status && (
              <div className="base-system-card-status-row">
                <span className="base-system-card-detail-label">{status.label || t('durum', 'Durum')}</span>
                <div className="flex items-center gap-6 font-medium text-13">
                  <div className={`status-dot ${status.active ? 'active' : 'inactive'}`} />
                  <span className={status.active ? 'text-success' : 'text-secondary'}>
                    {status.active 
                      ? (status.activeText || t('Aktif', 'Aktif')) 
                      : (status.passiveText || t('Pasif', 'Pasif'))}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {footer && (
          <div className="pt-12 border-t-glass mt-auto flex items-center justify-between">
            {footer}
          </div>
        )}
      </BaseCard>
    );
  }
);

BaseSystemCard.displayName = 'BaseSystemCard';

export default BaseSystemCard;
