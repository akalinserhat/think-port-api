/**
 * Akalin UI - Bulut Depolama Sağlayıcı Kartı (BulutDepolamaCard)
 * BaseCard altyapısı üzerine inşa edilmiş, Google Drive, Microsoft OneDrive vb.
 * bulut depolama entegrasyonlarını Material Design 3 ilkelerine uygun olarak
 * sunan kart bileşeni.
 */

import React from 'react';
import { Cloud, CheckCircle2, AlertCircle, Edit2, ChevronRight, Key } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BaseCard, { BaseCardProps, CardVariant } from '../base/card/BaseCard';

export interface BulutDepolamaItem {
  id: string;
  provider: 'google_drive' | 'onedrive' | string;
  title: string;
  description?: string;
  isConfigured?: boolean;
  clientIdMasked?: string;
  icon?: React.ReactNode;
  docsUrl?: string;
  [key: string]: any;
}

export interface BulutDepolamaCardProps extends Omit<BaseCardProps, 'title' | 'onClick'> {
  /** Bulut sağlayıcı kimliği veya sağlayıcı nesnesi */
  item?: BulutDepolamaItem;
  /** Sağlayıcı kodu/adı (örn: 'google_drive', 'onedrive') */
  provider?: string;
  /** Kart başlığı (örn: 'Google Drive API') */
  title?: React.ReactNode;
  /** Açıklama metni */
  description?: React.ReactNode;
  /** Özel sağlayıcı ikonu */
  icon?: React.ReactNode;
  /** Sağlayıcının yapılandırılıp yapılandırılmadığı */
  isConfigured?: boolean;
  /** Maskelenmiş Client ID veya özet durum bilgisi */
  clientIdMasked?: string;
  /** Özel durum rozeti */
  badge?: React.ReactNode;
  /** Düzenle butonuna veya aksiyona tıklandığında */
  onEdit?: (item?: BulutDepolamaItem, e?: React.MouseEvent) => void;
  /** Karta tıklandığında */
  onClick?: (item?: BulutDepolamaItem, e?: React.MouseEvent) => void;
  /** Özel aksiyonlar */
  actions?: React.ReactNode;
  /** MD3 Kart varyantı */
  variant?: CardVariant;
  /** Kart etkileşimli mi */
  interactive?: boolean;
  /** Ekstra CSS sınıfları */
  className?: string;
}

const BulutDepolamaCard = React.forwardRef<HTMLElement, BulutDepolamaCardProps>(
  (
    {
      item,
      provider: providerProp,
      title: titleProp,
      description: descProp,
      icon: iconProp,
      isConfigured: isConfiguredProp,
      clientIdMasked: clientIdMaskedProp,
      badge,
      onEdit,
      onClick,
      actions,
      variant = 'elevated',
      interactive = true,
      className = '',
      children,
      ...rest
    },
    ref
  ) => {
    const { t } = useTranslation();

    const provider = providerProp || item?.provider || item?.id || 'bulut';
    const title = titleProp || item?.title || t('bulut_saglayici', 'Bulut Depolama Sağlayıcısı');
    const description = descProp || item?.description;
    const isConfigured = isConfiguredProp !== undefined ? isConfiguredProp : Boolean(item?.isConfigured);
    const clientIdMasked = clientIdMaskedProp || item?.clientIdMasked;

    const isInteractive = interactive || Boolean(onClick);

    const handleClick = (e: React.MouseEvent) => {
      if (onClick) {
        onClick(item, e);
      } else if (onEdit) {
        onEdit(item, e);
      }
    };

    const handleEditClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onEdit) {
        onEdit(item, e);
      } else if (onClick) {
        onClick(item, e);
      }
    };

    return (
      <BaseCard
        ref={ref}
        variant={variant}
        interactive={isInteractive}
        onClick={handleClick}
        className={`bulut-depolama-card ${className}`.trim()}
        {...rest}
      >
        <div className="bulut-card-content">
          {/* Sol Avatar / İkon */}
          <div className={`bulut-card-icon-box bulut-provider-${provider}`}>
            {iconProp || item?.icon || <Cloud size={24} />}
          </div>

          {/* Orta Bilgi Alanı */}
          <div className="bulut-card-info">
            <div className="bulut-card-header-line">
              <h4 className="bulut-card-title">{title}</h4>
              <div className="bulut-card-status-wrapper">
                {badge ? (
                  badge
                ) : isConfigured ? (
                  <span className="bulut-badge bulut-badge-active">
                    <CheckCircle2 size={12} />
                    <span>{t('yapilandirildi', 'Yapılandırıldı')}</span>
                  </span>
                ) : (
                  <span className="bulut-badge bulut-badge-pending">
                    <AlertCircle size={12} />
                    <span>{t('yapilandirma_bekleniyor', 'Yapılandırma Bekleniyor')}</span>
                  </span>
                )}
              </div>
            </div>

            {description && <p className="bulut-card-desc">{description}</p>}

            <div className="bulut-card-details">
              <span className="bulut-card-client-id">
                <Key size={13} className="bulut-key-icon" />
                <span className="bulut-client-label">{t('client_id', 'Client ID')}:</span>
                <span className="bulut-client-value font-mono">
                  {clientIdMasked || t('tanimlanmadi', 'Tanımlanmadı')}
                </span>
              </span>
            </div>
          </div>

          {/* Sağ Aksiyon Alanı */}
          <div className="bulut-card-actions" onClick={(e) => e.stopPropagation()}>
            {actions}
            {(onEdit || isInteractive) && (
              <button
                type="button"
                className="bulut-card-action-btn"
                onClick={handleEditClick}
                title={t('yapilandir_veya_duzenle', 'Yapılandır / Düzenle')}
              >
                <Edit2 size={15} />
                <span className="bulut-card-edit-text">{t('duzenle', 'Düzenle')}</span>
                <ChevronRight size={15} className="bulut-chevron-icon" />
              </button>
            )}
          </div>

          {children}
        </div>
      </BaseCard>
    );
  }
);

BulutDepolamaCard.displayName = 'BulutDepolamaCard';

export default BulutDepolamaCard;
