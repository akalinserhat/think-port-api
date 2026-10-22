/**
 * Akalin UI - Kart Listeleme Bileşeni (CardList)
 * 
 * Başlıca Görevleri:
 * - BaseObjectList motoru üzerine kurulu olarak BaseCard (veya BaseCard türevi) kartları listelemek
 * - Kart odaklı responsive ızgara (CSS Grid auto-fill/minmax) yerleşimi sunmak
 * - renderCard (özel kart bileşeni) veya renderCardContent (otomatik BaseCard sarmalayıcı) desteği sağlamak
 * - Kart varyantı (outlined, elevated, filled), interaktiflik, boş durum ve yüklenme durumlarını yönetmek
 */

import React from 'react';
import BaseObjectList, { BaseObjectListProps, ObjectListLayout } from '../base/list/BaseObjectList';
import BaseCard, { BaseCardProps, CardVariant } from '../base/card/BaseCard';

export interface CardListProps<T = any> extends Omit<BaseObjectListProps<T>, 'renderItem'> {
  /**
   * Kartın tamamını render eden fonksiyon (Örn: <AdresCard adres={item} /> veya <CustomCard item={item} />)
   */
  renderCard?: (item: T, index: number) => React.ReactNode;

  /**
   * Kartın iç içeriğini render eden fonksiyon. 
   * Belirtilirse içerik otomatik olarak BaseCard ile sarmalanır.
   */
  renderCardContent?: (item: T, index: number) => React.ReactNode;

  /**
   * renderCardContent kullanıldığında BaseCard'a aktarılacak props'lar
   */
  cardProps?: BaseCardProps | ((item: T, index: number) => BaseCardProps);

  /**
   * Kart görsel varyantı (BaseCard standartı)
   * @default 'outlined'
   */
  cardVariant?: CardVariant;

  /**
   * Kartların üzerine gelindiğinde/tıklandığında interaktif efekt alması
   * @default false
   */
  interactiveCards?: boolean;

  /**
   * Grid modunda her bir kartın alabileceği minimum genişlik
   * @default '280px'
   */
  minCardWidth?: number | string;

  /**
   * Her bir karta eklenecek özel sınıf
   */
  cardClassName?: string | ((item: T, index: number) => string);

  /**
   * Karta tıklandığında tetiklenecek fonksiyon
   */
  onCardClick?: (item: T, index: number, e: React.MouseEvent) => void;
}

export const CardList = <T extends any = any>({
  items = [],
  renderCard,
  renderCardContent,
  cardProps,
  cardVariant = 'outlined',
  interactiveCards = false,
  minCardWidth = '280px',
  gap = '16px',
  layout = 'grid',
  cardClassName,
  onCardClick,
  className = '',
  ...rest
}: CardListProps<T>) => {
  const handleRenderItem = (item: T, index: number) => {
    if (renderCard) {
      return renderCard(item, index);
    }

    if (renderCardContent) {
      const resolvedCardProps = typeof cardProps === 'function' ? cardProps(item, index) : (cardProps || {});
      const resolvedCardClassName = typeof cardClassName === 'function' ? cardClassName(item, index) : (cardClassName || '');

      return (
        <BaseCard
          variant={cardVariant}
          interactive={interactiveCards || !!onCardClick}
          className={`card-list-item-card ${resolvedCardClassName}`}
          onClick={onCardClick ? (e) => onCardClick(item, index, e) : undefined}
          {...resolvedCardProps}
        >
          {renderCardContent(item, index)}
        </BaseCard>
      );
    }

    return null;
  };

  return (
    <BaseObjectList<T>
      items={items}
      renderItem={handleRenderItem}
      layout={layout}
      minItemWidth={minCardWidth}
      gap={gap}
      className={`card-list ${className}`}
      onItemClick={renderCard && onCardClick ? onCardClick : undefined}
      {...rest}
    />
  );
};

export default CardList;
