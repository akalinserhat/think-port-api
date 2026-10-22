import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Tag,
  Edit2,
  Trash2,
  ChevronRight,
  ChevronDown,
  Plus,
  ShoppingBag,
  Utensils,
  UtensilsCrossed,
  Store,
  Croissant,
  Beef,
  Factory,
  Briefcase,
  Building2,
  Globe,
  Truck,
  HeartPulse,
  Car,
  Wrench,
  Tv,
  Shirt,
  BookOpen,
  Gamepad2,
  Home,
  Sparkles,
  Calculator,
  Scale,
  Code,
  Compass,
  LucideIcon
} from 'lucide-react';
import ActionMenu, { ActionMenuItem } from '../menu/ActionMenu';
import BaseTreeTableView, { BaseTreeTableItem } from '../base/treeview/BaseTreeTableView';

// Varsayılan ikon havuzu
const DEFAULT_ICON_MAP: Record<string, LucideIcon | React.ComponentType<any>> = {
  ShoppingBag,
  Utensils,
  UtensilsCrossed,
  Store,
  Croissant,
  Beef,
  Factory,
  Briefcase,
  Building2,
  Globe,
  Truck,
  HeartPulse,
  Car,
  Wrench,
  Tv,
  Shirt,
  BookOpen,
  Gamepad2,
  Home,
  Sparkles,
  Calculator,
  Scale,
  Code,
  Compass,
  Tag
};

// Sektörel / Kategori varsayılan özellik seçenekleri
export const DEFAULT_FEATURE_PRESETS = [
  { key: 'seriNo', label: 'Seri No & IMEI Takibi', desc: 'Elektronik ve beyaz eşya ürünleri' },
  { key: 'garanti', label: 'Garanti Süresi & Takibi', desc: 'Cihaz garanti bitiş süreleri' },
  { key: 'varyant', label: 'Beden & Renk Varyantı', desc: 'Tekstil, giyim ve ayakkabı' },
  { key: 'skt', label: 'Son Kullanma Tarihi (SKT)', desc: 'Gıda, market ve kozmetik' },
  { key: 'partiLot', label: 'Parti & Lot Numarası', desc: 'Üretim ve sevkiyat partileri' },
  { key: 'recete', label: 'Üretim Reçeteleri', desc: 'Restoran menüleri ve imalat' },
  { key: 'desi', label: 'Kargo Desi & Paketleme', desc: 'E-Ticaret kargo hesaplamaları' },
  { key: 'tevkifat', label: 'Tevkifat & Stopaj', desc: 'Hizmet ve danışmanlık faturaları' },
  { key: 'oemKodu', label: 'OEM / Muadil Parça Kodu', desc: 'Otomotiv yedek parça' },
  { key: 'isEmri', label: 'Servis İş Emri / Plaka', desc: 'Oto servis ve teknik servisler' }
];

export interface TreeTableItem extends BaseTreeTableItem {
  id: number | string;
  parentId?: number | string | null;
  ustFaaliyetAlaniId?: number | string | null;
  ad: string;
  kod?: string | null;
  aciklama?: string | null;
  ikon?: string | null;
  sira?: number | null;
  aktifMi?: boolean;
  varsayilanOzelliklerJson?: string | null;
  [key: string]: any;
}

export type FaaliyetAlaniItem = TreeTableItem;

export interface FeaturePresetOption {
  key: string;
  label: string;
  desc?: string;
}

export interface TreeTableViewProps {
  items: TreeTableItem[];
  loading?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  showSearch?: boolean;
  searchPlaceholder?: string;
  expandedParents?: Set<number | string>;
  onToggleExpand?: (parentId: number | string) => void;
  onAddChild?: (parent: TreeTableItem) => void;
  onEdit?: (item: TreeTableItem) => void;
  onDelete?: (item: TreeTableItem) => void;
  featurePresets?: FeaturePresetOption[];
  availableIcons?: Array<{ name: string; component: LucideIcon | React.ComponentType<any> }>;
  emptyMessage?: string;
  noSearchResultMessage?: string;
  titleHeader?: string;
  codeHeader?: string;
  featuresHeader?: string;
  orderHeader?: string;
  statusHeader?: string;
  actionsHeader?: string;
  addChildLabel?: string;
  subItemCountLabel?: string;
}

export type FaaliyetAlanlariTreeViewProps = TreeTableViewProps;

export const TreeTableView: React.FC<TreeTableViewProps> = ({
  items = [],
  loading = false,
  searchQuery,
  onSearchQueryChange,
  showSearch = true,
  searchPlaceholder,
  expandedParents,
  onToggleExpand,
  onAddChild,
  onEdit,
  onDelete,
  featurePresets = DEFAULT_FEATURE_PRESETS,
  availableIcons,
  emptyMessage,
  noSearchResultMessage,
  titleHeader,
  codeHeader,
  featuresHeader,
  orderHeader,
  statusHeader,
  actionsHeader,
  addChildLabel,
  subItemCountLabel
}) => {
  const { t } = useTranslation();

  // İkon çözümleme
  const renderIcon = (iconName?: string | null, size: number | string = 16) => {
    if (availableIcons && iconName) {
      const customFound = availableIcons.find(i => i.name === iconName);
      if (customFound) {
        const CustomComp = customFound.component;
        return <CustomComp size={size} />;
      }
    }
    const Comp = (iconName && DEFAULT_ICON_MAP[iconName]) ? DEFAULT_ICON_MAP[iconName] : Tag;
    return <Comp size={size} />;
  };

  // Tablo başlık satırı
  const headerContent = (
    <div className="tree-table-header">
      <div></div>
      <div>{titleHeader || t('sektor_faaliyet_alani', 'Sektör / Faaliyet Alanı')}</div>
      <div>{codeHeader || t('kod_nace', 'Kod / NACE')}</div>
      <div>{featuresHeader || t('ozellik_profili_alt_alan', 'Özellik Profili / Alt Alan')}</div>
      <div>{orderHeader || t('sira', 'Sıra')}</div>
      <div>{statusHeader || t('durum', 'Durum')}</div>
      <div className="tree-cell-actions">{actionsHeader || t('islemler', 'İşlemler')}</div>
    </div>
  );

  // 1. Seviye Ana Satır Render Fonksiyonu
  const renderParentRow = (
    parent: TreeTableItem,
    children: TreeTableItem[],
    isExpanded: boolean,
    toggleExpand: () => void
  ) => {
    const subCount = children.length;

    const parentActions: ActionMenuItem[] = [
      ...(onAddChild ? [{
        label: addChildLabel || t('alt_faaliyet_ekle', 'Alt Faaliyet Ekle'),
        icon: <Plus size={16} />,
        onClick: () => onAddChild(parent)
      }] : []),
      ...(onEdit ? [{
        label: t('Düzenle', 'Düzenle'),
        icon: <Edit2 size={16} />,
        onClick: () => onEdit(parent)
      }] : []),
      ...(onDelete ? [{
        label: t('Sil', 'Sil'),
        icon: <Trash2 size={16} />,
        onClick: () => onDelete(parent),
        danger: true
      }] : [])
    ];

    return (
      <div 
        className="tree-row-parent"
        onClick={toggleExpand}
      >
        <div>
          <button
            type="button"
            className="tree-toggle-btn"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand();
            }}
            aria-label={t('genislet_daralt', 'Genişlet / Daralt')}
          >
            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>

        <div className="flex-row items-center gap-12 min-w-0">
          <div className="tree-icon-badge">
            {renderIcon(parent.ikon, 18)}
          </div>
          <div className="tree-name-wrapper" title={parent.ad}>
            <span className="tree-name-title tree-name-parent-title">
              {parent.ad}
            </span>
            {parent.aciklama && (
              <div className="tree-name-desc" title={parent.aciklama}>
                {parent.aciklama}
              </div>
            )}
          </div>
        </div>

        <div>
          {parent.kod ? (
            <span className="tree-badge-code">{parent.kod}</span>
          ) : (
            <span className="tree-code-empty">—</span>
          )}
        </div>

        <div>
          <span className="tree-badge-count">
            {subCount} {subItemCountLabel || t('alt_sektor', 'Alt Sektör')}
          </span>
        </div>

        <div className="tree-sira-cell">
          #{parent.sira}
        </div>

        <div>
          {parent.aktifMi ? (
            <span className="status-badge status-badge--success">{t('Aktif', 'Aktif')}</span>
          ) : (
            <span className="status-badge status-badge--passive">{t('Pasif', 'Pasif')}</span>
          )}
        </div>

        <div className="tree-cell-actions" onClick={(e) => e.stopPropagation()}>
          {parentActions.length > 0 && (
            <ActionMenu actions={parentActions} />
          )}
        </div>
      </div>
    );
  };

  // 2. Seviye Alt Satır Render Fonksiyonu
  const renderChildRow = (child: TreeTableItem) => {
    let parsedFeatures: Record<string, boolean> = {};
    if (child.varsayilanOzelliklerJson) {
      try {
        parsedFeatures = JSON.parse(child.varsayilanOzelliklerJson);
      } catch (e) {
        // JSON ayrıştırma hatası durumunda sessiz kal
      }
    }
    const activeFeatures = Object.keys(parsedFeatures).filter(k => parsedFeatures[k]);

    const childActions: ActionMenuItem[] = [
      ...(onEdit ? [{
        label: t('Düzenle', 'Düzenle'),
        icon: <Edit2 size={16} />,
        onClick: () => onEdit(child)
      }] : []),
      ...(onDelete ? [{
        label: t('Sil', 'Sil'),
        icon: <Trash2 size={16} />,
        onClick: () => onDelete(child),
        danger: true
      }] : [])
    ];

    return (
      <div key={child.id} className="tree-row-child">
        <div></div>
        <div className="flex-row items-center gap-10 tree-child-name-cell">
          <div className="tree-child-icon">
            {renderIcon(child.ikon, 15)}
          </div>
          <div className="tree-name-wrapper" title={child.ad}>
            <span className="tree-name-title font-medium">
              {child.ad}
            </span>
            {child.aciklama && (
              <div className="tree-name-desc" title={child.aciklama}>
                {child.aciklama}
              </div>
            )}
          </div>
        </div>

        <div>
          {child.kod ? (
            <span className="tree-badge-code">{child.kod}</span>
          ) : (
            <span className="tree-code-empty">—</span>
          )}
        </div>

        <div>
          <div className="tree-features-list">
            {activeFeatures.length > 0 ? (
              activeFeatures.slice(0, 2).map((featKey) => {
                const feat = featurePresets.find(f => f.key === featKey);
                return (
                  <span key={featKey} className="tree-feature-chip">
                    {feat ? feat.label.split(' ')[0] : featKey}
                  </span>
                );
              })
            ) : (
              <span className="tree-feature-chip-empty">{t('Standart', 'Standart')}</span>
            )}
            {activeFeatures.length > 2 && (
              <span className="tree-feature-chip">+{activeFeatures.length - 2}</span>
            )}
          </div>
        </div>

        <div className="tree-sira-cell">
          #{child.sira}
        </div>

        <div>
          {child.aktifMi ? (
            <span className="status-badge status-badge--success">{t('Aktif', 'Aktif')}</span>
          ) : (
            <span className="status-badge status-badge--passive">{t('Pasif', 'Pasif')}</span>
          )}
        </div>

        <div className="tree-cell-actions">
          {childActions.length > 0 && (
            <ActionMenu actions={childActions} />
          )}
        </div>
      </div>
    );
  };

  return (
    <BaseTreeTableView<TreeTableItem>
      items={items}
      loading={loading}
      showSearch={showSearch}
      searchQuery={searchQuery}
      onSearchQueryChange={onSearchQueryChange}
      searchPlaceholder={searchPlaceholder}
      expandedParents={expandedParents}
      onToggleExpand={onToggleExpand}
      emptyMessage={emptyMessage}
      noSearchResultMessage={noSearchResultMessage}
      sortItems={(a, b) => (a.sira || 0) - (b.sira || 0) || a.ad.localeCompare(b.ad, 'tr')}
      headerContent={headerContent}
      renderParentRow={renderParentRow}
      renderChildRow={renderChildRow}
    />
  );
};

export const FaaliyetAlanlariTreeView = TreeTableView;
export default TreeTableView;
