/**
 * Akalin UI - Politika ve Ayar Kartı (PolicySettingCard)
 * 
 * BaseCard sınıfından türeyen; sistem, firma, güvenlik ve entegrasyon ayarlarında
 * her bir ayar parametresini Material Design 3 ilkelerine uygun olarak sunan kart bileşenidir.
 * 
 * Başlıca Özellikleri:
 * - BaseCard mimarisi üzerine inşa edilmiştir
 * - Bulunduğu katmana/layer'a tam genişlikte yatay olarak yayılır (width: 100%)
 * - Sol alanda: Vurgulu ikon kutusu, ayar başlığı ve açıklama/ipucu alt metni
 * - En sağ alanda: Kullanıcıdan veri alınacak kontrol (Switch, BasitInput, Select, Buton vb.)
 * - Sağdaki kontrolün altına entegre FieldError hata gösterim desteği
 * - Sıfır inline CSS & tam responsive MD3 uyumu
 */

import React from 'react';
import BaseCard, { BaseCardProps, CardVariant } from '../base/card/BaseCard';
import FieldError from '../common/FieldError';

export interface PolicySettingCardProps extends Omit<BaseCardProps, 'title'> {
  /**
   * İkon bileşeni (sol tarafta kutu içinde gösterilir)
   */
  icon?: React.ReactNode;

  /**
   * İkon aktiflik durumu (true ise yeşil/başarılı arka plan tonu alır)
   * @default false
   */
  iconActive?: boolean;

  /**
   * Kart ana başlığı
   */
  title: React.ReactNode;

  /**
   * Kart açıklama veya ipucu alt metni
   */
  description?: React.ReactNode;

  /**
   * Kartın en sağında yer alacak kontrol veya eylem (Switch, BasitInput, Select, Buton vb.)
   */
  action?: React.ReactNode;

  /**
   * En sağdaki kontrolün altında gösterilecek hata mesajı
   */
  error?: string;

  /**
   * MD3 Kart varyantı
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

const PolicySettingCard = React.forwardRef<HTMLElement, PolicySettingCardProps>(
  (
    {
      icon,
      iconActive = false,
      title,
      description,
      action,
      error,
      variant = 'outlined',
      interactive = false,
      className = '',
      children,
      ...rest
    },
    ref
  ) => {
    return (
      <BaseCard
        ref={ref}
        variant={variant}
        interactive={interactive}
        className={`policy-setting-card ${className}`.trim()}
        {...rest}
      >
        <div className="policy-setting-left">
          {icon && (
            <div className={`policy-setting-icon ${iconActive ? 'active' : ''}`}>
              {icon}
            </div>
          )}
          <div className="policy-setting-text">
            <div className="policy-setting-title">{title}</div>
            {description && <div className="policy-setting-desc">{description}</div>}
          </div>
        </div>

        {(action || error) && (
          <div className="policy-setting-right">
            {action}
            {error && <FieldError error={error} />}
          </div>
        )}

        {children}
      </BaseCard>
    );
  }
);

PolicySettingCard.displayName = 'PolicySettingCard';

export default PolicySettingCard;
