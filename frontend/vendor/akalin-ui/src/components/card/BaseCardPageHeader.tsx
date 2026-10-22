/**
 * Akalin UI - Kart Sayfası Başlık Bileşeni (BaseCardPageHeader)
 * 
 * BaseCard altyapısı üzerine inşa edilmiş, BaseCardPage ve BasePage sayfalarının
 * en üstünde konumlanan başlık (ikon, sayfa başlığı, alt başlık, ekmek kırıntısı ve sağ aksiyonlar)
 * alanını Material Design 3 tasarım ilkelerine uygun olarak sunan kart bileşeni.
 */

import React from 'react';
import { Edit2 } from 'lucide-react';
import BaseCard, { BaseCardProps, CardVariant } from '../base/card/BaseCard';

export interface BaseCardPageHeaderProps extends Omit<BaseCardProps, 'title'> {
  /**
   * Kart sayfasının ana başlığı
   */
  title?: React.ReactNode;

  /**
   * Başlığın solunda gösterilecek büyük ikon
   */
  icon?: React.ReactNode;

  /**
   * Genel alt başlık veya açıklama metni
   */
  subtitle?: React.ReactNode;

  /**
   * Sol alt başlık / etiket (örn: VKN veya özel tanımlayıcı)
   */
  subtitleLeft?: React.ReactNode;

  /**
   * Sağ alt başlık rozeti (örn: Demo kalan gün, Lisans durumu)
   */
  subtitleRight?: React.ReactNode;

  /**
   * Başlık alanının sağ tarafında konumlandırılacak aksiyon butonları
   */
  headerExtra?: React.ReactNode;

  /**
   * headerExtra ile eşanlamlı alternatif aksiyon alanı
   */
  actions?: React.ReactNode;

  /**
   * Sayfa ekmek kırıntısı (Breadcrumb) gezinti bileşeni
   */
  breadcrumb?: React.ReactNode;

  /**
   * Kartın Material Design 3 varyantı ('elevated' | 'filled' | 'outlined')
   * @default 'elevated'
   */
  variant?: CardVariant;

  /**
   * İlave CSS sınıfları
   */
  className?: string;

  /**
   * İlave özel içerik
   */
  children?: React.ReactNode;

  /**
   * Başlık yanında düzenleme ikonu (kalem) tıklandığında çalışacak callback
   */
  onTitleEdit?: () => void;

  /**
   * Başlık düzenleme ikonunun ipucu (tooltip) metni
   */
  titleEditTooltip?: string;

  /**
   * Alt başlık yanında düzenleme ikonu (kalem) tıklandığında çalışacak callback
   */
  onSubtitleEdit?: () => void;

  /**
   * Alt başlık düzenleme ikonunun ipucu (tooltip) metni
   */
  subtitleEditTooltip?: string;
}

const BaseCardPageHeader = React.forwardRef<HTMLElement, BaseCardPageHeaderProps>(
  (
    {
      title,
      icon,
      subtitle,
      subtitleLeft,
      subtitleRight,
      headerExtra,
      actions,
      breadcrumb,
      variant = 'elevated',
      className = '',
      children,
      onTitleEdit,
      titleEditTooltip,
      onSubtitleEdit,
      subtitleEditTooltip,
      ...rest
    },
    ref
  ) => {
    const actionContent = headerExtra || actions;
    const subLeft = subtitleLeft || subtitle;

    // Herhangi bir başlık veya aksiyon içeriği verilmemişse render etme
    if (
      !title &&
      !icon &&
      !subLeft &&
      !subtitleRight &&
      !actionContent &&
      !breadcrumb &&
      !children
    ) {
      return null;
    }

    const headerClasses = [
      'w-full',
      'base-page-header',
      'base-card-page-header',
      className
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <BaseCard
        ref={ref}
        variant={variant}
        className={headerClasses}
        {...rest}
      >
        <div className="flex items-center gap-16 flex-1 min-w-0">
          {icon && (
            <div className={`icon-box-large ${React.isValidElement(icon) && ((icon.props as any)?.imageUrl !== undefined || (icon.props as any)?.gostergeUst !== undefined || (icon.props as any)?.title !== undefined) ? 'avatar-box-transparent' : ''}`}>
              {icon}
            </div>
          )}

          <div className="flex-1 min-w-0 flex flex-col gap-4">
            {title && (
              <div className="flex items-center gap-8 group/header-title min-w-0">
                {typeof title === 'string' ? (
                  <h1 className="m-0 text-20 font-700 tracking-tight text-primary break-words leading-tight">
                    {title}
                  </h1>
                ) : (
                  title
                )}

                {onTitleEdit && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTitleEdit();
                    }}
                    className="title-edit-btn"
                    title={titleEditTooltip || 'Düzenle'}
                    aria-label={titleEditTooltip || 'Düzenle'}
                  >
                    <Edit2 size={16} />
                  </button>
                )}
              </div>
            )}

            {breadcrumb && (
              <div className="base-page-breadcrumb">
                {breadcrumb}
              </div>
            )}

            {(subLeft || subtitleRight) && (
              <div className="flex items-center gap-8 text-secondary text-13 min-w-0">
                {subLeft && (
                  <div className="flex items-center gap-6 text-13 text-secondary min-w-0">
                    <span className="flex items-center gap-6 text-13 text-secondary min-w-0">
                      {subLeft}
                    </span>
                    {onSubtitleEdit && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onSubtitleEdit();
                        }}
                        className="title-edit-btn subtitle-edit-btn"
                        title={subtitleEditTooltip || 'Düzenle'}
                        aria-label={subtitleEditTooltip || 'Düzenle'}
                      >
                        <Edit2 size={13} />
                      </button>
                    )}
                  </div>
                )}
                {subLeft && subtitleRight && <span className="text-muted opacity-50">•</span>}
                {subtitleRight && (
                  <span className="chip-primary px-6 py-2 text-11">
                    {subtitleRight}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {actionContent && (
          <div className="base-card-header-actions flex items-center gap-8 flex-shrink-0">
            {actionContent}
          </div>
        )}

        {children}
      </BaseCard>
    );
  }
);

BaseCardPageHeader.displayName = 'BaseCardPageHeader';

export default BaseCardPageHeader;
