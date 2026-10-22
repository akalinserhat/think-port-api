/**
 * Akalin UI - Temel Nesne Listeleme Motoru (BaseObjectList)
 * 
 * Başlıca Görevleri:
 * - Herhangi bir veri dizisini (T[]) grid, dikey veya yatay yerleşimde standartlaştırmak
 * - Yüklenme (loading) ve boş durum (empty state) görünümlerini merkezi yönetmek
 * - Responsive ızgara (CSS Grid auto-fill/minmax) veya dikey/yatay flex akışı sunmak
 * - Tıklama eylemlerini ve dinamik anahtar (keyExtractor) üretimini sağlamak
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Inbox, Loader2 } from 'lucide-react';

export type ObjectListLayout = 'grid' | 'vertical' | 'horizontal';

export interface BaseObjectListProps<T = any> {
  /**
   * Listelenecek nesnelerin dizisi
   */
  items: T[];

  /**
   * Her bir öğeyi ekrana basan render fonksiyonu
   */
  renderItem: (item: T, index: number) => React.ReactNode;

  /**
   * Her öğe için benzersiz React anahtarı üreten fonksiyon
   * @default (item, index) => item?.id ?? item?.key ?? index
   */
  keyExtractor?: (item: T, index: number) => string | number;

  /**
   * Liste yerleşim düzeni
   * @default 'grid'
   */
  layout?: ObjectListLayout;

  /**
   * Grid modunda her bir öğenin alabileceği minimum genişlik (örn: '280px', 300)
   * @default '280px'
   */
  minItemWidth?: number | string;

  /**
   * Grid modunda sabit sütun sayısı verilmek istenirse (örn: 3)
   */
  columns?: number;

  /**
   * Öğeler arasındaki boşluk (örn: '16px', 16)
   * @default '16px'
   */
  gap?: number | string;

  /**
   * Yüklenme durumu aktif mi?
   * @default false
   */
  loading?: boolean;

  /**
   * Özel yükleme göstergesi
   */
  loadingComponent?: React.ReactNode;

  /**
   * Özel boş durum bileşeni
   */
  emptyState?: React.ReactNode;

  /**
   * Boş durum başlığı / mesajı
   * @default 'Kayıt bulunamadı.'
   */
  emptyMessage?: string;

  /**
   * Boş durum ikonu
   */
  emptyIcon?: React.ReactNode;

  /**
   * Listenin üstünde yer alacak başlık veya filtre alanı
   */
  headerContent?: React.ReactNode;

  /**
   * Listenin altında yer alacak özet veya sayfalama alanı
   */
  footerContent?: React.ReactNode;

  /**
   * Kapsayıcıya eklenecek ek CSS sınıfları
   */
  className?: string;

  /**
   * Kapsayıcıya eklenecek inline stiller
   */
  style?: React.CSSProperties;

  /**
   * Her bir öğe kapsayıcısına eklenecek sınıf veya fonksiyon
   */
  itemClassName?: string | ((item: T, index: number) => string);

  /**
   * Her bir öğe kapsayıcısına eklenecek stil veya fonksiyon
   */
  itemStyle?: React.CSSProperties | ((item: T, index: number) => React.CSSProperties);

  /**
   * Bir öğeye tıklandığında tetiklenecek fonksiyon
   */
  onItemClick?: (item: T, index: number, e: React.MouseEvent) => void;

  /**
   * Kapsayıcı HTML öğesi türü
   * @default 'div'
   */
  as?: React.ElementType;
}

export const BaseObjectList = <T extends any = any>({
  items = [],
  renderItem,
  keyExtractor = (item: T, index: number) => (item as any)?.id ?? (item as any)?.key ?? index,
  layout = 'grid',
  minItemWidth = '280px',
  columns,
  gap = '16px',
  loading = false,
  loadingComponent,
  emptyState,
  emptyMessage,
  emptyIcon,
  headerContent,
  footerContent,
  className = '',
  style,
  itemClassName,
  itemStyle,
  onItemClick,
  as: Component = 'div'
}: BaseObjectListProps<T>) => {
  const { t } = useTranslation();

  const formattedGap = typeof gap === 'number' ? `${gap}px` : gap;
  const formattedMinWidth = typeof minItemWidth === 'number' ? `${minItemWidth}px` : minItemWidth;

  const getContainerStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      gap: formattedGap,
      ...style
    };

    if (layout === 'grid') {
      return {
        display: 'grid',
        gridTemplateColumns: columns
          ? `repeat(${columns}, minmax(0, 1fr))`
          : `repeat(auto-fill, minmax(${formattedMinWidth}, 1fr))`,
        alignContent: 'start',
        ...base
      };
    }

    if (layout === 'vertical') {
      return {
        display: 'flex',
        flexDirection: 'column',
        ...base
      };
    }

    if (layout === 'horizontal') {
      return {
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        ...base
      };
    }

    return base;
  };

  const defaultEmptyMessage = emptyMessage || t('auto_kayit_bulunamadi_472b', 'Kayıt bulunamadı.');

  if (loading) {
    if (loadingComponent) return <>{loadingComponent}</>;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-32 text-secondary" style={{ minHeight: '180px' }}>
        <Loader2 className="animate-spin mb-12 text-primary" size={28} />
        <span className="text-13 font-medium">{t('auto_yukleniyor_dot_7553', 'Yükleniyor...')}</span>
      </div>
    );
  }

  return (
    <div className={`base-object-list-wrapper flex-col flex-1 w-full ${className}`}>
      {headerContent && (
        <div className="base-object-list-header mb-16">
          {headerContent}
        </div>
      )}

      {(!items || items.length === 0) ? (
        emptyState ? (
          emptyState
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-32 text-secondary" style={{ minHeight: '180px' }}>
            <div className="mb-8 opacity-60">
              {emptyIcon || <Inbox size={32} />}
            </div>
            <p className="text-13 text-center font-medium m-0">
              {defaultEmptyMessage}
            </p>
          </div>
        )
      ) : (
        <Component className="base-object-list-container" style={getContainerStyle()}>
          {items.map((item, index) => {
            const key = keyExtractor(item, index);
            const resolvedClassName = typeof itemClassName === 'function' ? itemClassName(item, index) : (itemClassName || '');
            const resolvedStyle = typeof itemStyle === 'function' ? itemStyle(item, index) : (itemStyle || {});

            if (onItemClick) {
              return (
                <div
                  key={key}
                  className={`base-object-list-item cursor-pointer ${resolvedClassName}`}
                  style={resolvedStyle}
                  onClick={(e) => onItemClick(item, index, e)}
                >
                  {renderItem(item, index)}
                </div>
              );
            }

            return (
              <React.Fragment key={key}>
                {renderItem(item, index)}
              </React.Fragment>
            );
          })}
        </Component>
      )}

      {footerContent && (
        <div className="base-object-list-footer mt-16">
          {footerContent}
        </div>
      )}
    </div>
  );
};

export default BaseObjectList;
