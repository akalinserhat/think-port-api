import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';

export interface BaseTreeTableItem {
  id: string | number;
  parentId?: string | number | null;
  [key: string]: any;
}

export interface BaseTreeTableViewProps<T extends BaseTreeTableItem = BaseTreeTableItem> {
  items: T[];
  loading?: boolean;
  loadingContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  emptyMessage?: string;
  noSearchResultMessage?: string;

  // Arama ayarları
  showSearch?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  searchPlaceholder?: string;
  filterItem?: (item: T, query: string) => boolean;

  // Genişletme / Daraltma kontrolleri
  expandedParents?: Set<string | number>;
  onToggleExpand?: (parentId: string | number) => void;
  defaultExpandedAll?: boolean;

  // Hiyerarşi ve Sıralama
  getParentId?: (item: T) => string | number | null;
  sortItems?: (a: T, b: T) => number;

  // Başlık ve Konteyner
  headerContent?: React.ReactNode;
  containerClassName?: string;
  tableClassName?: string;

  // Satır Render Fonksiyonları (Render Props)
  renderParentRow: (
    parent: T,
    children: T[],
    isExpanded: boolean,
    onToggleExpand: () => void
  ) => React.ReactNode;
  renderChildRow?: (child: T, parent: T, index: number) => React.ReactNode;
  renderChildrenContainer?: (children: T[], parent: T) => React.ReactNode;
}

export const BaseTreeTableView = <T extends BaseTreeTableItem = BaseTreeTableItem>({
  items = [],
  loading = false,
  loadingContent,
  emptyContent,
  emptyMessage,
  noSearchResultMessage,
  showSearch = true,
  searchQuery,
  onSearchQueryChange,
  searchPlaceholder,
  filterItem,
  expandedParents,
  onToggleExpand,
  defaultExpandedAll = true,
  getParentId,
  sortItems,
  headerContent,
  containerClassName = 'tree-container',
  tableClassName = 'tree-table-card',
  renderParentRow,
  renderChildRow,
  renderChildrenContainer
}: BaseTreeTableViewProps<T>): React.ReactElement => {
  const { t } = useTranslation();

  // Canlı arama yönetimi (Controlled veya Uncontrolled)
  const isControlledSearch = searchQuery !== undefined;
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const activeSearchQuery = isControlledSearch ? searchQuery : internalSearchQuery;

  const handleSearchChange = (val: string) => {
    if (!isControlledSearch) {
      setInternalSearchQuery(val);
    }
    onSearchQueryChange?.(val);
  };

  // Üst öğe ID çözümleme
  const resolveParentId = (item: T): string | number | null => {
    if (getParentId) return getParentId(item);
    return item.parentId ?? (item as any).ustFaaliyetAlaniId ?? null;
  };

  const isRoot = (item: T): boolean => resolveParentId(item) === null;

  // Genişletme durumu yönetimi (Controlled veya Uncontrolled)
  const isControlledExpanded = expandedParents !== undefined;
  const [internalExpandedParents, setInternalExpandedParents] = useState<Set<string | number>>(new Set());

  useEffect(() => {
    if (!isControlledExpanded && defaultExpandedAll && items.length > 0) {
      const parentIds = items.filter(isRoot).map(i => i.id);
      setInternalExpandedParents(new Set(parentIds));
    }
  }, [items, isControlledExpanded, defaultExpandedAll]);

  const activeExpanded = isControlledExpanded ? expandedParents : internalExpandedParents;

  const handleToggle = (parentId: string | number) => {
    if (onToggleExpand) {
      onToggleExpand(parentId);
    }
    if (!isControlledExpanded) {
      setInternalExpandedParents(prev => {
        const next = new Set(prev);
        if (next.has(parentId)) {
          next.delete(parentId);
        } else {
          next.add(parentId);
        }
        return next;
      });
    }
  };

  // 1. Seviye Ana Kayıtlar
  const rootItems = useMemo(() => {
    const roots = items.filter(isRoot);
    if (sortItems) {
      return [...roots].sort(sortItems);
    }
    return roots;
  }, [items, sortItems]);

  // Varsayılan arama filtresi
  const defaultFilter = (item: T, q: string): boolean => {
    const ad = (item as any).ad;
    const kod = (item as any).kod;
    const aciklama = (item as any).aciklama;
    return (
      (typeof ad === 'string' && ad.toLocaleLowerCase('tr-TR').includes(q)) ||
      (typeof kod === 'string' && kod.toLocaleLowerCase('tr-TR').includes(q)) ||
      (typeof aciklama === 'string' && aciklama.toLocaleLowerCase('tr-TR').includes(q))
    );
  };

  const activeFilter = filterItem || defaultFilter;

  // Ağaç Hiyerarşisi ve Arama Filtreleme
  const treeData = useMemo(() => {
    const q = activeSearchQuery.trim().toLocaleLowerCase('tr-TR');

    return rootItems.map(parent => {
      let children = items.filter(i => resolveParentId(i) === parent.id);
      if (sortItems) {
        children = [...children].sort(sortItems);
      }

      if (!q) {
        return { parent, children };
      }

      const parentMatch = activeFilter(parent, q);
      const filteredChildren = children.filter(c => activeFilter(c, q));

      if (parentMatch || filteredChildren.length > 0) {
        return {
          parent,
          children: filteredChildren.length > 0 ? filteredChildren : children
        };
      }

      return null;
    }).filter(Boolean) as Array<{ parent: T; children: T[] }>;
  }, [rootItems, items, activeSearchQuery, activeFilter, sortItems]);

  return (
    <div className={containerClassName}>
      {/* Canlı Arama Çubuğu */}
      {showSearch && (
        <div className="tree-toolbar-left">
          <div className="tree-search-wrapper">
            <Search size={18} className="tree-search-icon" />
            <input
              type="text"
              className="tree-search-input"
              placeholder={searchPlaceholder || t('sektor_arama_placeholder', 'Sektör, alt faaliyet veya NACE kodu ara (Örn: Perakende, 47.62, Kırtasiye)...')}
              value={activeSearchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            {activeSearchQuery && (
              <button
                type="button"
                className="btn-icon tree-search-clear-btn"
                onClick={() => handleSearchChange('')}
                aria-label={t('temizle', 'Temizle')}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Ağaç Tablosu */}
      <div className={tableClassName}>
        {headerContent}

        {loading ? (
          loadingContent || (
            <div className="page-loading-state">
              {t('faaliyet_alanlari_yukleniyor', 'Faaliyet alanları yükleniyor...')}
            </div>
          )
        ) : treeData.length === 0 ? (
          emptyContent || (
            <div className="tree-empty-state">
              {activeSearchQuery 
                ? (noSearchResultMessage || t('arama_sonucu_bulunamadi', 'Aramanızla eşleşen sektör veya faaliyet alanı bulunamadı.')) 
                : (emptyMessage || t('henuz_tanimli_faaliyet_alani_yok', 'Henüz tanımlı bir faaliyet alanı bulunmuyor.'))}
            </div>
          )
        ) : (
          treeData.map(({ parent, children }) => {
            const isExpanded = activeExpanded.has(parent.id);

            return (
              <div key={parent.id} className="tree-node-group">
                {/* 1. Seviye: Ana Satır */}
                {renderParentRow(parent, children, isExpanded, () => handleToggle(parent.id))}

                {/* 2. Seviye: Alt Satırlar */}
                {isExpanded && children.length > 0 && (
                  renderChildrenContainer ? (
                    renderChildrenContainer(children, parent)
                  ) : (
                    <div className="tree-children-container">
                      {children.map((child, idx) => (
                        renderChildRow ? renderChildRow(child, parent, idx) : null
                      ))}
                    </div>
                  )
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default BaseTreeTableView;
