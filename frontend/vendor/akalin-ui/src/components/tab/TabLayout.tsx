/**
 * Akalin UI - Sekmeli Sayfa ve Bileşen Düzeni (TabLayout)
 * 
 * Başlıca Görevleri:
 * - BaseTab bileşenini sarmalayarak sekmeli sayfa yerleşimlerini (layout) yönetmek
 * - Sekme başlıklarını ve seçili sekmeye ait gövde içeriğini (content) birlikte ekrana basmak
 * - Opsiyonel olarak üst başlık alanı (headerContent) desteği sağlamak
 * - editable / editableTabs özelliği ile dinamik sekme ekleme (+) ve kapatma (x) aksiyonları sunmak
 * - ActionMenu entegrasyonu ile tab başlık çubuğunda zengin açılır aksiyon ve bölünmüş düğme menüsü sunmak
 */
import React from 'react';
import BaseTab, { BaseTabItem, BaseTabProps } from '../base/tab/BaseTab';
import ActionMenu, { ActionMenuItem, ActionMenuProps } from '../menu/ActionMenu';

export { type BaseTabItem, type ActionMenuItem, type ActionMenuProps };

export interface TabLayoutProps extends Omit<BaseTabProps, 'tabs'> {
  tabs: BaseTabItem[];
  className?: string;
  headerContent?: React.ReactNode;
  hideIfSingleTab?: boolean;
  /** Dinamik sekme yönetimi: Başlıkların sağında yeni sekme (+) butonu ve sekmelerde kapatma (x) butonu sunar */
  editable?: boolean;
  /** `editable` için alternatif/takma ad */
  editableTabs?: boolean;
  /** Yeni sekme (+) butonuna tıklandığında tetiklenir */
  onAddTab?: () => void;
  onTabAdd?: () => void;
  /** Sekme kapatma (x) butonuna tıklandığında tetiklenir */
  onCloseTab?: (id: string | number, e: React.MouseEvent) => void;
  onTabClose?: (id: string | number, e: React.MouseEvent) => void;
  /** Yeni sekme butonu için özel ipucu metni */
  addTabTooltip?: string;
  /** Sekme kapatma butonu için özel ipucu metni */
  closeTabTooltip?: string;
  /**
   * Tab başlık alanında gösterilecek ActionMenu aksiyon listesi.
   */
  actions?: ActionMenuItem[];
  /**
   * ActionMenu bileşenine aktarılacak yapılandırma ayarları (triggerVariant, splitButton vb.).
   */
  actionMenuProps?: Partial<ActionMenuProps>;
  /**
   * Doğrudan aktarılmak istenen ActionMenu bileşeni.
   */
  actionMenu?: React.ReactNode;
  [key: string]: any;
}

/**
 * TabLayout - Uygulama genelinde sekmeli sayfa veya bileşen düzenleri (layout) için kullanılır.
 * BaseTab bileşenini sarmalar ve ek yerleşim kolaylıkları sağlar.
 */
const TabLayout: React.FC<TabLayoutProps> = ({ 
  tabs, 
  className = '', 
  headerContent,
  hideIfSingleTab = true,
  editable,
  editableTabs,
  onAddTab,
  onTabAdd,
  onCloseTab,
  onTabClose,
  addTabTooltip,
  closeTabTooltip,
  actions,
  actionMenuProps,
  actionMenu,
  ...baseTabProps 
}) => {
  const isEditable = Boolean(editable || editableTabs);

  return (
    <div className={`tab-layout-wrapper ${className}`}>
      {headerContent && (
        <div className="tab-layout-header">
          {headerContent}
        </div>
      )}
      
      <BaseTab 
        tabs={tabs} 
        hideIfSingleTab={hideIfSingleTab}
        editable={isEditable}
        onAddTab={onAddTab}
        onTabAdd={onTabAdd}
        onCloseTab={onCloseTab}
        onTabClose={onTabClose}
        addTabTooltip={addTabTooltip}
        closeTabTooltip={closeTabTooltip}
        actions={actions}
        actionMenuProps={actionMenuProps}
        actionMenu={actionMenu}
        {...baseTabProps} 
      />
    </div>
  );
};

export default TabLayout;
