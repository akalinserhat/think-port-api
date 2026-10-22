/**
 * @akalin/module_core - Modül Sözleşme Tipleri (types.ts)
 * Tüm uygulamalarda (Webakus.UI, Webakus.AdminUI, OpenAiApi vb.) ortak çalışan
 * özellik modülü (Feature Module), rota, menü, sistem ayarları ve RBAC yetki sözleşmeleri.
 */

import { ReactNode, ComponentType, MouseEvent } from 'react';

/**
 * Modüle ait rota tanımı
 */
export interface IRouteDefinition {
  /** Rota URL yolu (örn: '/cariler', '/settings/smtp') */
  path: string;
  /** Render edilecek React bileşeni */
  element: ReactNode;
  /** Sayfa başlığı */
  title?: string;
  /** Giriş yapmadan erişilebilir mi? (Varsayılan: false) */
  isPublic?: boolean;
  /** Bağımsız popup penceresi olarak mı açılacak? (Varsayılan: false) */
  isPopup?: boolean;
  /** Sayfa için gerekli yetki(ler) */
  requiredPermission?: string;
  requiredPermissions?: string[];
  /** Tam eşleşme mi? */
  exact?: boolean;
}

/**
 * Sol menü (Sidebar) öğe tanımı
 */
export interface IMenuItemDefinition {
  /** Benzersiz menü öğesi kimliği */
  id?: string;
  /** Menüde görüntülenecek metin/başlık */
  label: string;
  /** Tıklandığında gidilecek URL yolu */
  path?: string;
  /** Menü simgesi */
  icon?: ReactNode;
  /** Menü sıralama ağırlığı (küçükten büyüğe) */
  order?: number;
  /** Eğer alt menü ise üst menünün ID'si */
  parentId?: string;
  /** Açılır/kapanır (dropdown/accordion) menü grubu mu? */
  isDropdown?: boolean;
  /** Menü yanındaki rozet */
  badge?: string | number;
  /** Görüntülemek için gerekli yetki(ler) */
  requiredPermission?: string;
  requiredPermissions?: string[];
  /** Alt menü öğeleri */
  children?: IMenuItemDefinition[];
}

/**
 * Sistem Ayarları (BaseSystemPage) Modül Kartı Tanımı
 * Modüller kendi ayar ekranlarını doğrudan Sistem Ayarları sayfasına enjekte edebilir.
 */
export interface IModuleSettingDefinition {
  /** Ayar modülü benzersiz kimliği (örn: 'smtp', 'gateway', 'users', 'roles') */
  id: string;
  /** Kart başlığı */
  name: string;
  /** Alternatif başlık */
  title?: string;
  /** Kart açıklaması */
  desc: string;
  /** Alternatif açıklama */
  subtitle?: string;
  /** Kart ikonu */
  icon?: ReactNode;
  /** Sağ üst rozet metni */
  badge?: string;
  /** Arama anahtar kelimeleri */
  keywords?: string;
  /** Sıralama önceliği (küçükten büyüğe) */
  order?: number;
  /** Kendi iç başlığı/layout'u var mı? (BaseCardPage, BaseListPage vb. kullananlar için true) */
  hasOwnLayout?: boolean;
  /** Liste görünümü mü? */
  isList?: boolean;
  /** Başlığı gizle */
  hideHeader?: boolean;
  /** Görüntülemek için gerekli yetki(ler) */
  requiredPermissions?: string[];
  /** Alternatif URL takma adları */
  aliases?: string[];
  /** Render edilecek React bileşeni */
  component: ReactNode | ComponentType<any>;
  /** Ek özellikler */
  [key: string]: any;
}

/**
 * Modül Eylem/Bileşen Tipi
 */
export type ModuleActionType = 'button' | 'action-menu' | 'menu-item' | 'widget' | 'custom';

/**
 * Modülün dışarı sunduğu Eylem Öğesi (Action Item / Button / ActionMenu / MenuItem)
 */
export interface IModuleActionItem {
  id: string;
  label: string;
  type?: ModuleActionType;
  placement?:
    | 'header'
    | 'header-right'
    | 'drawer'
    | 'document-dropdown'
    | 'table-row'
    | 'quick-actions'
    | 'dashboard'
    | 'custom'
    | string;
  targetContext?: string;
  icon?: ReactNode;
  onClick?: (e?: MouseEvent<any>, contextData?: any) => void;
  component?: ReactNode | ComponentType<any>;
  actions?: IModuleActionItem[];
  children?: IModuleActionItem[];
  danger?: boolean;
  order?: number;
  badge?: ReactNode | string | number;
  title?: string;
  dividerBefore?: boolean;
  dividerAfter?: boolean;
  requiredPermissions?: string[];
  isAllowed?: (permissions: string[], user?: any, contextData?: any) => boolean;
}

/**
 * Modülün dışarı sunduğu genel React bileşenleri sözlüğü
 */
export interface IModuleExportedComponents {
  [componentName: string]: ComponentType<any>;
}

/**
 * Modül tanıtım/kampanya sözleşmesi
 */
export interface IModulePromotionDefinition {
  title?: string;
  subtitle?: string;
  description?: string;
  badge?: string;
  buttonText?: string;
  purchaseUrl?: string;
  icon?: ReactNode | string;
  imageUrl?: string;
  benefits?: string[];
}

/**
 * Modül Varlık Kategorisi
 */
export type ModuleItemCategory = 'kart' | 'belge' | 'rapor' | 'islem';

/**
 * Modül İzin Eylem Sözleşmesi
 */
export interface IModulePermissionAction {
  action: string;
  labelKey: string;
  description?: string;
  danger?: boolean;
}

/**
 * Basit Modül İzin Tanımı (AdminUI uyumluluğu için)
 */
export interface IModulePermission {
  key: string;
  name: string;
  description?: string;
  group?: string;
  danger?: boolean;
}

/**
 * Modül Varlık Tanımı (Entity Definition - Kart, Belge, Rapor veya İşlem Manifestosu)
 */
export interface IModuleEntityDefinition {
  id: string;
  category: ModuleItemCategory;
  titleKey: string;
  customActions?: IModulePermissionAction[];
  useStandardCrud?: boolean;
  route?: string;
}

/**
 * Sistem Genelinde Üretilen Standart Yetki Anahtarı Öğesi
 * Şablon: [modulId].[varlikTipi].[varlikKodu].[eylem]
 */
export interface IPermissionItem {
  key: string;
  moduleId: string;
  permissionPrefix: string;
  category: ModuleItemCategory;
  entityId: string;
  action: string;
  labelKey: string;
  description?: string;
  danger?: boolean;
  entityTitleKey: string;
  moduleTitle: string;
  route?: string;
}

/**
 * Rol & Yetki Matrisi için Modül Bazlı Hiyerarşik Grup Yapısı
 */
export interface IModulePermissionMatrixGroup {
  moduleId: string;
  moduleTitle: string;
  permissionPrefix: string;
  entities: {
    id: string;
    category: ModuleItemCategory;
    titleKey: string;
    route?: string;
    actions: IPermissionItem[];
  }[];
}

/**
 * Özellik Modülü Ana Sözleşmesi (Feature Module Definition)
 * Hem Webakus.UI ('title', 'onInitialize') hem Webakus.AdminUI ('name', 'initialize', 'subModules')
 * hem de BaseSystemPage ('settingsModules') ile %100 uyumludur.
 */
export interface IModuleDefinition {
  /** Benzersiz modül kimliği (örn: 'email-module', 'cari-yonetimi') */
  id: string;
  /** Modül başlığı (Webakus.UI standardı) */
  title?: string;
  /** Modül adı (Webakus.AdminUI standardı) */
  name?: string;
  /** Modül açıklaması */
  description?: string;
  /** Modül versiyonu */
  version?: string;
  /** Yetki anahtarlarında kullanılacak kısa ön ek (örn: 'smtp', 'cari') */
  permissionPrefix?: string;
  /** Modül simgesi (React bileşeni) */
  icon?: ReactNode;
  /** Standart Lucide ikon adı */
  iconName?: string;
  /** Modül sıralama ağırlığı (küçükten büyüğe) */
  order?: number;
  /** Çekirdek/Kritik modül mü? */
  isCore?: boolean;
  /** Varsayılan olarak aktif mi? */
  defaultActive?: boolean;
  /** Modülü kullanmak için gerekli yetkiler */
  requiredPermissions?: string[];
  /** Modüle ait standart sayfa rotaları */
  routes?: IRouteDefinition[];
  /** Modüle ait bağımsız popup rotaları (/popup/*) */
  popupRoutes?: IRouteDefinition[];
  /** Modüle ait sol menü öğeleri */
  menuItems?: IMenuItemDefinition[];
  /** Sistem Ayarları (BaseSystemPage) içerisine eklenecek ayar kartları */
  settingsModules?: IModuleSettingDefinition[];
  /** Modüle ait dışa açılan butonlar, ActionMenu eylemleri ve widget'lar */
  actions?: IModuleActionItem[];
  /** Modülün diğer modüllerin kullanımına sunduğu ortak React bileşenleri */
  components?: IModuleExportedComponents;
  /** Modül tanıtım sözleşmesi */
  promotion?: IModulePromotionDefinition;
  /** Modülün barındırdığı ana veri kartları */
  cards?: IModuleEntityDefinition[];
  /** Modülün ürettiği belgeler */
  documents?: IModuleEntityDefinition[];
  /** Modüle ait rapor tanımları */
  reports?: IModuleEntityDefinition[];
  /** Modüle ait özel operasyonlar / süreçler */
  operations?: IModuleEntityDefinition[];
  /** Doğrudan izin tanımları */
  permissions?: IModulePermission[];
  /** Alt modüller */
  subModules?: IModuleDefinition[];
  /** Modül yüklendiğinde çalışacak başlatma fonksiyonu */
  onInitialize?: () => void | Promise<void>;
  initialize?: () => void | Promise<void>;
}
