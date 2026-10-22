/**
 * Akalin UI - Kullanıcı Kartı Bileşeni (UserCard)
 * BaseCard bileşeninden türetilmiş, kullanıcı bilgilerini (ad-soyad, e-posta,
 * telefon, rol, aktiflik durumu, şube/lokasyon yetkileri) Material Design 3
 * tasarım ilkelerine uygun olarak sunan kart bileşeni.
 */

import React from 'react';
import { User, Mail, Phone, ShieldCheck, MapPin, Calendar, Edit2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BaseCard, { BaseCardProps, CardVariant } from '../base/card/BaseCard';

export interface UserCardItem {
  id: string | number;
  adSoyad?: string;
  ad?: string;
  soyad?: string;
  email: string;
  telefon?: string;
  rolAd?: string;
  rolId?: number;
  aktifMi?: boolean;
  eklenmeTarihi?: string | Date;
  sonGiris?: string | Date;
  lokasyonAdlari?: string[];
  lokasyonIds?: (string | number)[];
  firmalar?: { firmaId: number; firmaAdi: string; rol?: string }[];
  [key: string]: any;
}

export interface UserCardProps extends Omit<BaseCardProps, 'onClick'> {
  /** Görüntülenecek kullanıcı nesnesi */
  user: UserCardItem;
  /** Düzenleme butonuna tıklandığında çalışır */
  onEdit?: (user: UserCardItem, e?: React.MouseEvent) => void;
  /** Silme butonuna tıklandığında çalışır */
  onDelete?: (user: UserCardItem, e?: React.MouseEvent) => void;
  /** Karta tıklandığında çalışır */
  onClick?: (user: UserCardItem, e?: React.MouseEvent) => void;
  /** Kartın sağ üst veya aksiyon alanına özel bileşenler ekler */
  actions?: React.ReactNode;
  /** İlave durum rozeti */
  extraBadge?: React.ReactNode;
  /** Şube / lokasyon bilgilerini göster/gizle (varsayılan: true) */
  showLocations?: boolean;
  /** Kartın MD3 görsel varyantı ('elevated' | 'filled' | 'outlined') */
  variant?: CardVariant;
  /** Kart tıklanabilir / etkileşimli mi? */
  interactive?: boolean;
  /** Ekstra CSS sınıfları */
  className?: string;
}

const UserCard = React.forwardRef<HTMLElement, UserCardProps>(
  (
    {
      user,
      onEdit,
      onDelete,
      onClick,
      actions,
      extraBadge,
      showLocations = true,
      variant = 'elevated',
      interactive = false,
      className = '',
      children,
      ...rest
    },
    ref
  ) => {
    const { t } = useTranslation();

    const isInteractive = interactive || Boolean(onClick);

    const displayName = user.adSoyad || 
      (user.ad || user.soyad ? `${user.ad || ''} ${user.soyad || ''}`.trim() : user.email?.split('@')[0]) || 
      t('isimsiz_kullanici', 'İsimsiz Kullanıcı');

    const getInitials = (name?: string, email?: string) => {
      if (name && name.trim()) {
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
          return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return parts[0].slice(0, 2).toUpperCase();
      }
      if (email) {
        return email.slice(0, 2).toUpperCase();
      }
      return 'U';
    };

    const formatDate = (dateVal?: string | Date) => {
      if (!dateVal) return null;
      try {
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return null;
        return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      } catch {
        return null;
      }
    };

    const formattedDate = formatDate(user.eklenmeTarihi);

    const handleCardClick = (e: React.MouseEvent) => {
      if (onClick) {
        onClick(user, e);
      }
    };

    return (
      <BaseCard
        ref={ref}
        variant={variant}
        interactive={isInteractive}
        onClick={isInteractive ? handleCardClick : undefined}
        className={`user-card ${user.aktifMi ? 'user-card-active' : 'user-card-inactive'} ${className}`}
        {...rest}
      >
        <div className="user-card-header">
          <div className="user-card-header-left">
            <div className="user-card-avatar-wrapper">
              <div className="user-card-avatar">
                {displayName ? getInitials(displayName, user.email) : <User size={20} />}
              </div>
              <span
                className={`user-card-status-dot ${user.aktifMi ? 'is-active' : 'is-passive'}`}
                title={user.aktifMi ? t('durum_aktif', 'Aktif') : t('durum_pasif', 'Pasif')}
              />
            </div>
            <div className="user-card-main-info">
              <h4 className="user-card-name" title={displayName}>
                {displayName}
              </h4>
              <div className="user-card-email" title={user.email}>
                <Mail size={13} className="user-card-meta-icon" />
                <span>{user.email}</span>
              </div>
            </div>
          </div>

          <div className="user-card-header-actions">
            {actions}
            {onEdit && (
              <button
                type="button"
                className="user-card-action-btn edit"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(user, e);
                }}
                title={t('duzenle', 'Düzenle')}
              >
                <Edit2 size={15} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="user-card-action-btn delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(user, e);
                }}
                title={t('sil', 'Sil')}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>

        <div className="user-card-body">
          <div className="user-card-badges">
            <span className="user-card-role-badge">
              <ShieldCheck size={13} />
              <span>{user.rolAd || t('kullanici', 'Kullanıcı')}</span>
            </span>

            <span className={`user-status-chip ${user.aktifMi ? 'active' : 'passive'}`}>
              {user.aktifMi ? t('durum_aktif', 'Aktif') : t('durum_pasif', 'Pasif')}
            </span>

            {extraBadge}
          </div>

          <div className="user-card-details">
            {user.telefon && (
              <div className="user-card-detail-item">
                <Phone size={13} className="user-card-detail-icon" />
                <span>{user.telefon}</span>
              </div>
            )}

            {showLocations && user.lokasyonAdlari && user.lokasyonAdlari.length > 0 && (
              <div className="user-card-detail-item" title={user.lokasyonAdlari.join(', ')}>
                <MapPin size={13} className="user-card-detail-icon" />
                <span className="truncate">{user.lokasyonAdlari.join(', ')}</span>
              </div>
            )}

            {formattedDate && (
              <div className="user-card-detail-item">
                <Calendar size={13} className="user-card-detail-icon" />
                <span>{formattedDate}</span>
              </div>
            )}
          </div>

          {children && <div className="user-card-extra-content">{children}</div>}
        </div>
      </BaseCard>
    );
  }
);

UserCard.displayName = 'UserCard';

export default UserCard;
