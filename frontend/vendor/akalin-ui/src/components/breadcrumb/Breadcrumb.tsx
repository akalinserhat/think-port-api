/**
 * ============================================================================
 * AGENT KNOWLEDGE & USAGE GUIDE
 * ============================================================================
 * `Breadcrumb` bileşeni, kullanıcının uygulama içindeki hiyerarşik konumunu 
 * ve üst/alt sayfa adımlarını gösteren navigasyon bileşenidir.
 * 
 * Özellikler:
 * 1. MD3 tasarım diline uygun yumuşak hover efektleri ve ayrıcı (separator) desteği.
 * 2. İsteğe bağlı ikon (`icon`) ve tıklama (`onClick`, `to`, `href`) yönetimi.
 * 3. Son aktif öğeyi otomatik vurgulama (`active: true` veya son eleman).
 * 4. Boyut varyasyonları (`sm`, `md`, `lg`).
 * 
 * Kullanım Şekli:
 * ```tsx
 * import { Breadcrumb } from '@akalin/ui';
 * 
 * <Breadcrumb 
 *   items={[
 *     { label: 'Cariler', onClick: () => navigate('/cariler') },
 *     { label: 'Ahmet Ticaret', onClick: () => handleBackToCari() },
 *     { label: 'Nakliye Adresleri', onClick: () => handleBackToTab() },
 *     { label: 'Adresi Düzenle', active: true }
 *   ]} 
 * />
 * ```
 * ============================================================================
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface BreadcrumbItem {
  /**
   * Ekranda görüntülenecek metin veya çeviri anahtarı.
   */
  label: string;
  /**
   * Metnin solunda yer alacak opsiyonel ikon.
   */
  icon?: React.ReactNode;
  /**
   * Tıklama olayı. Tanımlandığında öğe etkileşimli (button) olarak davranır.
   */
  onClick?: (e: React.MouseEvent) => void;
  /**
   * Dış bağlantı linki.
   */
  href?: string;
  /**
   * Öğenin aktif (son/seçili) olup olmadığını belirtir.
   */
  active?: boolean;
  /**
   * İsteğe bağlı özel CSS sınıfı.
   */
  className?: string;
}

export interface BreadcrumbProps {
  /**
   * Navigasyon adımları listesi.
   */
  items: BreadcrumbItem[];
  /**
   * Öğeler arasındaki ayraç simgesi (Varsayılan: ChevronRight).
   */
  separator?: React.ReactNode;
  /**
   * Kapsayıcı CSS sınıfı.
   */
  className?: string;
  /**
   * Boyutlandırma ('sm' | 'md' | 'lg', Varsayılan: 'sm').
   */
  size?: 'sm' | 'md' | 'lg';
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({
  items = [],
  separator,
  className = '',
  size = 'sm'
}) => {
  const { t } = useTranslation();

  if (!items || items.length === 0) return null;

  const defaultSeparator = <ChevronRight size={size === 'lg' ? 16 : 13} className="breadcrumb-separator" />;
  const activeSeparator = separator !== undefined ? separator : defaultSeparator;

  return (
    <nav aria-label="Breadcrumb" className={`breadcrumb-container size-${size} ${className}`}>
      <ol className="breadcrumb-list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isActive = item.active !== undefined ? item.active : isLast;
          const displayLabel = typeof item.label === 'string' ? t(item.label) : item.label;

          return (
            <li key={index} className="breadcrumb-list-item">
              {isActive ? (
                <span 
                  className={`breadcrumb-item active ${item.className || ''}`}
                  aria-current="page"
                  title={typeof item.label === 'string' ? item.label : undefined}
                >
                  {item.icon && <span className="breadcrumb-icon">{item.icon}</span>}
                  <span className="breadcrumb-label">{displayLabel}</span>
                </span>
              ) : item.onClick ? (
                <button
                  type="button"
                  onClick={item.onClick}
                  className={`breadcrumb-item clickable ${item.className || ''}`}
                  title={typeof item.label === 'string' ? item.label : undefined}
                >
                  {item.icon && <span className="breadcrumb-icon">{item.icon}</span>}
                  <span className="breadcrumb-label">{displayLabel}</span>
                </button>
              ) : item.href ? (
                <a
                  href={item.href}
                  className={`breadcrumb-item clickable ${item.className || ''}`}
                  title={typeof item.label === 'string' ? item.label : undefined}
                >
                  {item.icon && <span className="breadcrumb-icon">{item.icon}</span>}
                  <span className="breadcrumb-label">{displayLabel}</span>
                </a>
              ) : (
                <span 
                  className={`breadcrumb-item ${item.className || ''}`}
                  title={typeof item.label === 'string' ? item.label : undefined}
                >
                  {item.icon && <span className="breadcrumb-icon">{item.icon}</span>}
                  <span className="breadcrumb-label">{displayLabel}</span>
                </span>
              )}

              {!isLast && (
                <span className="breadcrumb-separator-wrapper" aria-hidden="true">
                  {activeSeparator}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default Breadcrumb;
