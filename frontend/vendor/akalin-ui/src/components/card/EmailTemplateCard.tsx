/**
 * Akalin UI - E-Posta Şablon Kartı (EmailTemplateCard)
 * BaseCard bileşeninden türetilmiş, e-posta şablonlarını, bildirim taslaklarını
 * ve dinamik etiketleri (tags) modern Material Design 3 kart hiyerarşisiyle sunan bileşen.
 * 
 * Yetenekleri:
 * - BaseCard (elevated, filled, outlined) varyantlarını ve etkileşim durumlarını destekler.
 * - Başlık, ikon, durum rozeti (badge) ve açıklama hiyerarşisi sunar.
 * - Şablon içeriği için özel stilize edilmiş monospace önizleme alanı (preview) barındırır.
 * - Dinamik etiket ve şablon değişkenlerini (tags: {{KullaniciAdi}} vb.) chip olarak listeler.
 * - Opsiyonel aksiyon butonları (actions) ve çocuk elemanlar (children) kabul eder.
 */

import React from 'react';
import { FileText, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BaseCard, { BaseCardProps, CardVariant } from '../base/card/BaseCard';

export interface EmailTemplateCardProps extends Omit<BaseCardProps, 'title'> {
  /** Şablon tekil kimliği */
  id?: string;
  /** Şablon kart başlığı */
  title: React.ReactNode;
  /** Şablon teknik kimlik kodu */
  code?: React.ReactNode;
  /** Şablon açıklaması veya kullanım amacı */
  description?: React.ReactNode;
  /** Sol üst ikon (belirtilmezse FileText kullanılır) */
  icon?: React.ReactNode;
  /** Sağ üst köşede durum etiketi veya rozet (örn: Varsayılan Şablon) */
  badge?: React.ReactNode;
  /** E-posta içeriği gövde önizleme metni */
  preview?: React.ReactNode;
  /** Şablon içinde kullanılan dinamik değişken etiketleri */
  tags?: string[];
  /** Sağ alt aksiyon butonları veya bağlantılar */
  actions?: React.ReactNode;
  /** Kart varyantı (elevated, filled, outlined) */
  variant?: CardVariant;
  /** Kart tıklanabilir / etkileşimli mi? */
  interactive?: boolean;
}

const EmailTemplateCard = React.forwardRef<HTMLElement, EmailTemplateCardProps>(
  (
    {
      id,
      title,
      code,
      description,
      icon,
      badge,
      preview,
      tags = [],
      actions,
      variant = 'outlined',
      interactive = false,
      className = '',
      children,
      onClick,
      ...rest
    },
    ref
  ) => {
    const { t } = useTranslation();
    const isInteractive = interactive || Boolean(onClick);

    return (
      <BaseCard
        ref={ref}
        variant={variant}
        interactive={isInteractive}
        onClick={onClick}
        className={`email-template-card w-full ${className}`}
        {...rest}
      >
        <div className="email-template-card-header">
          <div className="email-template-card-header-left">
            <div className="email-template-card-icon-box">
              {icon || <FileText size={18} />}
            </div>
            <div>
              <h4 className="email-template-card-title">
                {title}
              </h4>
              {code && (
                <div className="text-11 text-secondary font-mono mt-2 opacity-75">
                  {code}
                </div>
              )}
            </div>
          </div>
          <div className="email-template-card-header-right flex items-center gap-8">
            {badge && (
              <div className="email-template-card-badge">
                {typeof badge === 'string' ? (
                  <span className="chip-primary email-chip-sm">
                    {badge}
                  </span>
                ) : (
                  badge
                )}
              </div>
            )}
            {isInteractive && (
              <div className="email-template-card-arrow flex items-center text-secondary">
                <ChevronRight size={18} />
              </div>
            )}
          </div>
        </div>

        {description && (
          <p className="email-template-card-desc">
            {description}
          </p>
        )}

        {preview && (
          <div className="email-template-card-preview">
            {preview}
          </div>
        )}

        {tags && tags.length > 0 && (
          <div className="email-template-card-tags">
            {tags.map((tag, idx) => (
              <span key={`${tag}-${idx}`} className="email-template-card-tag">
                {tag}
              </span>
            ))}
          </div>
        )}

        {children}

        {actions && (
          <div className="email-template-card-footer">
            {actions}
          </div>
        )}
      </BaseCard>
    );
  }
);

EmailTemplateCard.displayName = 'EmailTemplateCard';

export default EmailTemplateCard;
