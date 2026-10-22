/**
 * ============================================================================
 * AGENT KNOWLEDGE & USAGE GUIDE
 * ============================================================================
 * `Card` bileşeni, sistemdeki tüm formların (özellikle BaseDocumentPage, 
 * modal içerikleri veya ayar sayfaları) standart yerleşim (layout) yapısını 
 * oluşturmak için kullanılan bir bileşik (compound) bileşendir.
 * 
 * Alt Bileşenler (Sub-components):
 * 1. `Card.Header`: Üst kısımdır. Genellikle form kontrollerini, başlıkları 
 *    ve `Card.Tabs` yapısını içerir. Yapısı gereği `border-bottom` içerir ve 
 *    sayfa kaydırıldığında sabit (sticky) kalabilir.
 * 2. `Card.Tabs`: Genelde `Card.Header` içerisinde render edilen sekme düğmeleri 
 *    (tabs) kapsayıcısıdır.
 * 3. `Card.Detail` (veya `Card.Body`): Esnek ve kaydırılabilir (scrollable) 
 *    ana içerik alanıdır. `flex: 1` özelliğine sahiptir, yani kalan tüm boşluğu 
 *    doldurur. Ayrıca iç kapsayıcısı da dikeyde esner (minHeight: 100%), böylece 
 *    SpreadsheetGrid gibi bileşenler tam olarak yayılır (seamless).
 * 4. `Card.Footer`: Alt kısımdır. Genellikle toplamları, özet bilgileri veya 
 *    "Kaydet", "İptal" gibi işlem butonlarını (Action Buttons) barındırır.
 * 
 * Kullanım Şekli:
 * ```tsx
 * <Card as="form" onSubmit={handleSubmit}>
 *   <Card.Header> ... </Card.Header>
 *   <Card.Detail> ... (SpreadsheetGrid vb.) </Card.Detail>
 *   <Card.Footer> ... </Card.Footer>
 * </Card>
 * ```
 * 
 * Geliştirici Notu: `Card.Detail` içindeki "maxWidth: 1400px" kapsayıcısı, çok 
 * geniş ekranlarda içeriğin aşırı dağılmasını önler. Eğer içerik tam ekran 
 * yayılacaksa (SpreadsheetGrid gibi) o alan `width: 100%` ile çalışır.
 * ============================================================================
 */
import React from 'react';
import BaseCard from '../base/card/BaseCard';

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  as?: React.ElementType;
  onSubmit?: React.FormEventHandler;
  id?: string;
  noValidate?: boolean;
}

export const Card = ({ children, className = '', as = 'div', onSubmit, id, noValidate, ...props }: CardProps) => {
  let header: any = null;
  let tabs: any = null;
  let detail: any = null;
  let footer: any = null;
  let others: React.ReactNode[] = [];

  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) {
      others.push(child);
      return;
    }
    if (child.type === CardHeader) header = child;
    else if (child.type === CardTabs) tabs = child;
    else if (child.type === CardDetail) detail = child;
    else if (child.type === CardFooter) footer = child;
    else others.push(child);
  });

  return (
    <BaseCard as={as} className={`form-card ${className}`} onSubmit={onSubmit} id={id} noValidate={noValidate} {...props as any}>
      {header && (
        <div className="form-header-wrapper">
          <div className={`form-header ${header.props.className || ''}`} {...header.props}>
            {header.props.children}
          </div>
          {tabs && (
            <div className="form-header-tabs">
              {tabs.props.children}
            </div>
          )}
        </div>
      )}
      {!header && tabs && (
        <div className="form-header-tabs">
          {tabs.props.children}
        </div>
      )}
      {detail}
      {footer && (
        <div className={`form-footer ${footer.props.className || ''}`} {...footer.props} style={footer.props.style}>
          {footer.props.children}
        </div>
      )}
      {others}
    </BaseCard>
  );
};

export const CardHeader = ({ children, className = '', ...props }: any) => {
  return <>{children}</>;
};

export const CardTabs = ({ children }: any) => {
  return <>{children}</>;
};

export const CardDetail = ({ children, className = '', ...props }: any) => {
  return (
    <div className={`form-detail ${className}`} {...props} style={props.style}>
      <div className="form-detail-inner">
        {children}
      </div>
    </div>
  );
};

export const CardFooter = ({ children, className = '', ...props }: any) => {
  return <>{children}</>;
};

Card.Header = CardHeader;
Card.Tabs = CardTabs;
Card.Detail = CardDetail;
Card.Body = CardDetail;
Card.Footer = CardFooter;

export default Card;
