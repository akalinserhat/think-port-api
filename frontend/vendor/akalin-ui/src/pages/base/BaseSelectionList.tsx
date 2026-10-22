/**
 * Akalin UI - Seçim Listeleri İçin Temel Soyut İskelet Bileşeni (BaseSelectionList)
 * 
 * BasePage temel sınıfından türetilmiştir. Sistem genelindeki tüm seçim listeleri
 * için içerik alanında DataTable bileşenini barındıran soyut (abstract/generic) temel şablondur.
 * 
 * Tasarım ve Davranış Standartları:
 * 1. Başlık (Header): Başlık alanında yalnızca ActionMenu yer alır (Geri, Kaydet vb. butonlar bulunmaz).
 * 2. Alt Bilgi (Footer): Sayfanın en altında "İptal" ve "Tamam" aksiyon butonları yer alır.
 * 3. Satır Seçimi: Satırlarda ad-hoc buton/checkbox bulunmaz; satırın tamamı seçilir.
 *    Çoklu seçim modunda klavyeden CTRL / CONTROL (macOS için CMD) tuşuna basılarak birden fazla kayıt seçilebilir.
 *    Çift tıklama hızlı onay ve seçim tamamlama işlevi görür.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import BasePage, { BasePageProps } from './BasePage';
import DataTable, { Column, FetchDataArgs, DataTableProps } from '../../components/grid/DataTable';
import ActionMenu, { ActionMenuItem, ActionMenuProps } from '../../components/menu/ActionMenu';

export interface BaseSelectionListProps<T extends Record<string, any> = any> 
  extends Omit<BasePageProps, 'onSubmit' | 'isSaving' | 'onSave' | 'hideSaveButton'> {
  // Arama & GlobalSearch Entegrasyon Özellikleri
  initialSearchText?: string;
  initialSearchTerm?: string;
  searchText?: string;
  searchTerm?: string;
  syncWithGlobalSearch?: boolean;

  // Tablo & Veri Özellikleri
  columns?: Column<T>[] | any[];
  data?: T[];
  fetchData?: (args: FetchDataArgs) => Promise<{ data?: T[]; items?: T[]; veriler?: T[]; totalCount?: number; total?: number; toplam?: number } | T[]>;
  loading?: boolean;
  pageSize?: number;
  keyExtractor?: (item: T) => string | number;

  // Header & ActionMenu Özellikleri
  actionMenuItems?: ActionMenuItem[];
  actionMenuProps?: Partial<ActionMenuProps>;

  // Çoklu Seçim (Multi-Select) Özellikleri
  isMultiSelect?: boolean;
  multiSelect?: boolean;
  selectedItems?: T[];
  selectedIds?: (string | number)[];
  onSelectionChange?: (selectedItems: T[], selectedIds: (string | number)[]) => void;
  onMultiSelect?: (items: T[]) => void;
  selectionKey?: string | ((item: T) => string | number);

  // Seçim Davranışları & Footer Aksiyonları
  onSelect?: ((item: T, e?: React.MouseEvent) => void) | ((items: T[]) => void);
  onCancel?: () => void;
  cancelButtonText?: string;
  confirmButtonText?: string;
  hideFooter?: boolean;

  // Satır & Aksiyon Olayları
  onRowClick?: (item: T, e: React.MouseEvent) => void;
  onRowDoubleClick?: (item: T, e: React.MouseEvent) => void;
  onDataChange?: (data: T[]) => void;
  refreshKey?: number;
  emptyMessage?: string;
  searchableFields?: any[];
  rowClassName?: (item: T, index: number) => string;
  mobileCardRender?: (item: T, index: number, tableActions: any) => React.ReactNode;
  tableActions?: any;
  enableColumnManagement?: boolean;
  totalCount?: number;
  stickyActionColumn?: boolean;
  hiddenRowIds?: (string | number)[];
  defaultSortField?: string;
  defaultSortOrder?: 'asc' | 'desc';

  // Otomatik Seçim ve Klavye Gezinimi
  autoSelectFirstRow?: boolean;
  enableKeyboardNavigation?: boolean;
  initialSelectedId?: string | number | null;

  // Ekstra Render Alanları
  renderAboveTable?: React.ReactNode;
  renderBelowTable?: React.ReactNode;
  tableContainerClassName?: string;
  dataTableProps?: Partial<DataTableProps<T>>;
}

const BaseSelectionList = <T extends Record<string, any> = any>({
  // BasePage props
  inModal = true,
  className,
  children,
  headerExtra,
  showBackButton = true,

  // Header ActionMenu props
  actionMenuItems,
  actionMenuProps,

  // Çoklu Seçim Props
  isMultiSelect = false,
  multiSelect = false,
  selectedItems,
  selectedIds,
  onSelectionChange,
  onMultiSelect,
  selectionKey,

  // Footer & Aksiyon Props
  onSelect,
  onCancel,
  cancelButtonText,
  confirmButtonText,
  hideFooter = false,

  // Arama & GlobalSearch Entegrasyon Props
  initialSearchText,
  initialSearchTerm,
  searchText,
  searchTerm,
  syncWithGlobalSearch = true,

  // DataTable props
  columns = [],
  data,
  fetchData,
  loading,
  pageSize = 50,
  keyExtractor,
  onRowClick,
  onRowDoubleClick,
  onDataChange,
  refreshKey = 0,
  emptyMessage,
  searchableFields,
  rowClassName,
  mobileCardRender,
  tableActions,
  enableColumnManagement = false,
  totalCount,
  stickyActionColumn = false,
  hiddenRowIds,
  defaultSortField,
  defaultSortOrder,

  // Otomatik Seçim ve Klavye Gezinimi
  autoSelectFirstRow = true,
  enableKeyboardNavigation = true,
  initialSelectedId,

  // Ekstra render alanları
  renderAboveTable,
  renderBelowTable,
  tableContainerClassName,
  dataTableProps,

  ...restProps
}: BaseSelectionListProps<T>) => {
  const { t } = useTranslation();
  const location = useLocation();
  const effectiveIsMultiSelect = Boolean(isMultiSelect || multiSelect);
  const lastClickedIndexRef = useRef<number>(-1);
  const tableWrapperRef = useRef<HTMLDivElement>(null);

  // Başlangıç arama metnini (prop veya router state üzerinden) çözümleme
  const effectiveInitialSearch = useMemo(() => {
    if (initialSearchText !== undefined && initialSearchText !== null) return String(initialSearchText);
    if (initialSearchTerm !== undefined && initialSearchTerm !== null) return String(initialSearchTerm);
    if (searchText !== undefined && searchText !== null) return String(searchText);
    if (searchTerm !== undefined && searchTerm !== null) return String(searchTerm);
    const locState = (location?.state || {}) as Record<string, any>;
    if (locState.initialSearchText) return String(locState.initialSearchText);
    if (locState.searchText) return String(locState.searchText);
    if (locState.initialSearchTerm) return String(locState.initialSearchTerm);
    if (locState.searchTerm) return String(locState.searchTerm);
    if (locState.arama) return String(locState.arama);
    if (locState.aramaKelimesi) return String(locState.aramaKelimesi);
    return '';
  }, [initialSearchText, initialSearchTerm, searchText, searchTerm, location]);

  const effectiveInitialSearchRef = useRef(effectiveInitialSearch);
  useEffect(() => {
    effectiveInitialSearchRef.current = effectiveInitialSearch;
  }, [effectiveInitialSearch]);

  // GlobalSearch ile senkronizasyon (Açılışta metni aktarma ve çıkışta temizleme)
  useEffect(() => {
    if (!syncWithGlobalSearch) return;

    const initialText = effectiveInitialSearchRef.current;
    if (initialText && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('set-global-search-term', { detail: initialText }));
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('clear-global-search-term'));
      }
    };
  }, [syncWithGlobalSearch]);

  // Sayfa açıldığında DataTable konteynerine odaklan
  useEffect(() => {
    const timer = setTimeout(() => {
      if (tableWrapperRef.current) {
        tableWrapperRef.current.focus();
      }
    }, 80);
    return () => clearTimeout(timer);
  }, []);

  // Anahtar Çözümleme
  const resolveItemKey = useCallback((item: T): string | number => {
    if (keyExtractor) return keyExtractor(item);
    if (selectionKey) {
      if (typeof selectionKey === 'function') return selectionKey(item);
      return item[selectionKey];
    }
    return item?.id ?? item?.Id ?? item?.kod ?? item?.key ?? JSON.stringify(item);
  }, [keyExtractor, selectionKey]);

  // Tabloda O an Yüklü Veri Takibi
  const [currentData, setCurrentData] = useState<T[]>(data || []);
  useEffect(() => {
    if (data) setCurrentData(data);
  }, [data]);

  const handleDataChange = useCallback((newData: T[]) => {
    setCurrentData(newData);
    if (onDataChange) {
      onDataChange(newData);
    }
  }, [onDataChange]);

  // Seçili Kayıtlar Map'i
  const [internalSelectedMap, setInternalSelectedMap] = useState<Map<string | number, T>>(() => {
    const map = new Map<string | number, T>();
    if (selectedItems && Array.isArray(selectedItems)) {
      selectedItems.forEach(item => {
        map.set(resolveItemKey(item), item);
      });
    }
    return map;
  });

  // Dışarıdan selectedItems güncellemesi geldiğinde senkronize et
  useEffect(() => {
    if (selectedItems && Array.isArray(selectedItems)) {
      const map = new Map<string | number, T>();
      selectedItems.forEach(item => {
        map.set(resolveItemKey(item), item);
      });
      setInternalSelectedMap(map);
    }
  }, [selectedItems, resolveItemKey]);

  // Dışarıdan selectedIds güncellemesi geldiğinde senkronize et
  useEffect(() => {
    if (selectedIds && Array.isArray(selectedIds) && !selectedItems) {
      setInternalSelectedMap(prev => {
        const next = new Map<string | number, T>();
        selectedIds.forEach(id => {
          const existingItem = prev.get(id) || currentData.find(d => resolveItemKey(d) === id) || ({ id } as any);
          next.set(id, existingItem);
        });
        return next;
      });
    }
  }, [selectedIds, selectedItems, currentData, resolveItemKey]);

  // Seçim Değişikliğini Dışarı Bildirme
  const notifySelectionChange = useCallback((newMap: Map<string | number, T>) => {
    if (onSelectionChange) {
      onSelectionChange(Array.from(newMap.values()), Array.from(newMap.keys()));
    }
  }, [onSelectionChange]);

  // Açılışta veya veri yüklendiğinde ilk satırı (veya hedeflenen satırı) otomatik seç
  useEffect(() => {
    if (!autoSelectFirstRow) return;
    if (!currentData || currentData.length === 0) return;

    // Eğer halihazırda geçerli bir seçim varsa ve currentData içinde mevcutsa bozma
    const hasValidSelection = Array.from(internalSelectedMap.keys()).some(k => 
      currentData.some(d => String(resolveItemKey(d)) === String(k))
    );

    if (!hasValidSelection) {
      // Hedef ID var mı kontrol et (initialSelectedId, selectedIds, router state)
      const targetId = initialSelectedId ?? (selectedIds && selectedIds[0]) ?? (location?.state as any)?.selectedId ?? (location?.state as any)?.initialSelectedId;
      const targetItem = targetId !== undefined && targetId !== null
        ? currentData.find(d => String(resolveItemKey(d)) === String(targetId))
        : currentData[0];

      const itemToSelect = targetItem || currentData[0];
      if (itemToSelect) {
        const next = new Map<string | number, T>();
        next.set(resolveItemKey(itemToSelect), itemToSelect);
        setInternalSelectedMap(next);
        notifySelectionChange(next);
        lastClickedIndexRef.current = targetItem ? currentData.indexOf(targetItem) : 0;
      }
    }
  }, [currentData, autoSelectFirstRow, initialSelectedId, selectedIds, location?.state, resolveItemKey, notifySelectionChange]);

  // Satır Tıklama (Tekil Tıklama & CTRL ile Çoklu Seçim)
  const handleRowClick = useCallback((item: T, e: React.MouseEvent) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const currentIndex = currentData.findIndex(d => resolveItemKey(d) === resolveItemKey(item));

    if (effectiveIsMultiSelect) {
      setInternalSelectedMap(prev => {
        const next = new Map(isCtrlOrCmd ? prev : undefined);
        const key = resolveItemKey(item);

        if (isCtrlOrCmd) {
          // CTRL basılıyken: Tıklandıkça seçim eklenir / kaldırılır
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.set(key, item);
          }
        } else if (e.shiftKey && lastClickedIndexRef.current !== -1 && currentIndex !== -1) {
          // Shift basılıyken: Son tıklanan satır ile mevcut satır arasındaki tüm satırları seç
          const start = Math.min(lastClickedIndexRef.current, currentIndex);
          const end = Math.max(lastClickedIndexRef.current, currentIndex);
          const rangeItems = currentData.slice(start, end + 1);
          rangeItems.forEach(ri => {
            next.set(resolveItemKey(ri), ri);
          });
        } else {
          // CTRL basılı değilse: Yalnızca tıklanan satırı seç (öncekileri temizle)
          next.clear();
          next.set(key, item);
        }

        notifySelectionChange(next);
        return next;
      });
    } else {
      // Tekli Seçim Modu: Sadece tıklanan satırı seç
      setInternalSelectedMap(prev => {
        const next = new Map<string | number, T>();
        next.set(resolveItemKey(item), item);
        notifySelectionChange(next);
        return next;
      });
    }

    if (currentIndex !== -1) {
      lastClickedIndexRef.current = currentIndex;
    }

    if (onRowClick) {
      onRowClick(item, e);
    }
  }, [effectiveIsMultiSelect, currentData, resolveItemKey, notifySelectionChange, onRowClick]);

  // Çift Tıklama (Hızlı Seçim ve Onaylama)
  const handleRowDoubleClick = useCallback((item: T, e: React.MouseEvent) => {
    if (onRowDoubleClick) {
      onRowDoubleClick(item, e);
      return;
    }

    if (effectiveIsMultiSelect) {
      const next = new Map<string | number, T>(internalSelectedMap);
      next.set(resolveItemKey(item), item);
      const itemsArray = Array.from(next.values()) as T[];
      if (onMultiSelect) {
        onMultiSelect(itemsArray);
      } else if (onSelect) {
        (onSelect as any)(itemsArray);
      }
    } else {
      if (onSelect) {
        (onSelect as any)(item, e);
      }
    }

    if (restProps.onClose) {
      restProps.onClose();
    }
  }, [onRowDoubleClick, effectiveIsMultiSelect, internalSelectedMap, resolveItemKey, onMultiSelect, onSelect, restProps.onClose]);

  // Seçili Satır CSS Sınıfı (Satırın tamamını vurgular)
  const combinedRowClassName = useCallback((item: T, index: number) => {
    const custom = rowClassName ? rowClassName(item, index) : '';
    const isSelected = internalSelectedMap.has(resolveItemKey(item));
    return `${custom} ${isSelected ? 'row-selected' : ''}`.trim();
  }, [rowClassName, internalSelectedMap, resolveItemKey]);

  // "Tamam" Butonuna Basıldığında Seçimi Onaylama
  const handleConfirmSelection = useCallback((e?: React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const selectedItemsArray = Array.from(internalSelectedMap.values()) as T[];
    if (effectiveIsMultiSelect) {
      if (onMultiSelect) {
        onMultiSelect(selectedItemsArray);
      } else if (onSelect) {
        (onSelect as any)(selectedItemsArray);
      }
    } else {
      const singleItem = selectedItemsArray[0];
      if (singleItem && onSelect) {
        (onSelect as any)(singleItem);
      }
    }
    if (restProps.onClose) {
      restProps.onClose();
    }
  }, [internalSelectedMap, effectiveIsMultiSelect, onMultiSelect, onSelect, restProps.onClose]);

  // "İptal" Butonuna Basıldığında İptal Etme
  const handleCancel = useCallback((e?: React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    if (onCancel) {
      onCancel();
    }
    if (restProps.onClose) {
      restProps.onClose();
    }
  }, [onCancel, restProps.onClose]);

  // Klavye Gezinimi (ArrowUp / ArrowDown ile satır değiştirme, Enter ile onaylama, Esc ile çıkış)
  useEffect(() => {
    if (!enableKeyboardNavigation) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentData || currentData.length === 0) return;

      const currentSelectedKey = Array.from(internalSelectedMap.keys())[0];
      const currentIndex = currentSelectedKey !== undefined
        ? currentData.findIndex(d => String(resolveItemKey(d)) === String(currentSelectedKey))
        : -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = currentIndex < currentData.length - 1 ? currentIndex + 1 : 0;
        const nextItem = currentData[nextIndex];
        if (nextItem) {
          const next = new Map<string | number, T>();
          next.set(resolveItemKey(nextItem), nextItem);
          setInternalSelectedMap(next);
          notifySelectionChange(next);
          lastClickedIndexRef.current = nextIndex;
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : currentData.length - 1;
        const prevItem = currentData[prevIndex];
        if (prevItem) {
          const next = new Map<string | number, T>();
          next.set(resolveItemKey(prevItem), prevItem);
          setInternalSelectedMap(next);
          notifySelectionChange(next);
          lastClickedIndexRef.current = prevIndex;
        }
      } else if (e.key === 'Enter') {
        const target = e.target as HTMLElement;
        const isButton = target && (target.tagName === 'BUTTON' || target.closest('button'));
        if (!isButton && internalSelectedMap.size > 0) {
          e.preventDefault();
          handleConfirmSelection();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboardNavigation, currentData, internalSelectedMap, resolveItemKey, notifySelectionChange, handleConfirmSelection, handleCancel]);

  // Seçili satırı ekranda (scroll içinde) görünür tut (Auto-Scroll)
  useEffect(() => {
    const timer = setTimeout(() => {
      const selectedEl = document.querySelector('.base-selection-list-page .row-selected');
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [internalSelectedMap]);

  // Header Alanı: Başlık bölümünde yalnızca ActionMenu yer alır
  const finalHeaderExtra = useMemo(() => {
    if (actionMenuItems && actionMenuItems.length > 0) {
      return (
        <ActionMenu 
          actions={actionMenuItems} 
          {...actionMenuProps} 
        />
      );
    }
    return headerExtra;
  }, [actionMenuItems, actionMenuProps, headerExtra]);

  const selectedCount = internalSelectedMap.size;

  return (
    <BasePage
      inModal={inModal}
      asForm={false}
      hideSaveButton={true}
      showBackButton={showBackButton}
      onClose={restProps.onClose || onCancel}
      headerExtra={finalHeaderExtra}
      className={`base-selection-list-page ${className || ''}`}
      {...restProps}
    >
      {renderAboveTable}
      {children}
      <div 
        ref={tableWrapperRef}
        tabIndex={0}
        className={`table-container flex-1 min-h-0 ${tableContainerClassName || ''}`}
        style={{ outline: 'none' }}
      >
        <DataTable<T>
          columns={columns}
          data={data}
          fetchData={fetchData}
          loading={loading}
          pageSize={pageSize}
          keyExtractor={resolveItemKey}
          onRowClick={handleRowClick}
          onRowDoubleClick={handleRowDoubleClick}
          onDataChange={handleDataChange}
          refreshKey={refreshKey}
          emptyMessage={emptyMessage}
          searchableFields={searchableFields}
          rowClassName={combinedRowClassName}
          mobileCardRender={mobileCardRender}
          tableActions={tableActions}
          enableColumnManagement={enableColumnManagement}
          totalCount={totalCount}
          stickyActionColumn={stickyActionColumn}
          hiddenRowIds={hiddenRowIds}
          defaultSortField={defaultSortField}
          defaultSortOrder={defaultSortOrder}
          {...dataTableProps}
        />
      </div>

      {renderBelowTable}

      {/* Sayfa Alt Bilgi ve Buton Alanı (Footer: İptal ve Tamam) */}
      {!hideFooter && (
        <div className="base-selection-list-footer flex items-center justify-between p-12 mt-auto border-t border-subtle bg-surface">
          <div className="flex items-center gap-12 text-13 text-secondary">
            {effectiveIsMultiSelect && selectedCount > 0 ? (
              <span className="font-medium text-primary">
                {t('auto_secili_kayit_sayisi', '{{count}} kayıt seçildi', { count: selectedCount })}
              </span>
            ) : (
              effectiveIsMultiSelect && (
                <span className="text-secondary text-12">
                  {t('auto_coklu_secim_ipucu', 'Çoklu seçim için CTRL / CONTROL tuşunu kullanabilirsiniz.')}
                </span>
              )
            )}
          </div>
          <div className="flex items-center gap-8 ml-auto">
            <button
              type="button"
              onClick={handleCancel}
              className="btn btn-secondary px-16 py-8 flex items-center gap-6 text-14"
            >
              <X size={16} />
              <span>{cancelButtonText || t('auto_iptal', 'İptal')}</span>
            </button>
            <button
              type="button"
              onClick={handleConfirmSelection}
              disabled={selectedCount === 0}
              className="btn btn-primary px-20 py-8 flex items-center gap-6 text-14"
            >
              <Check size={16} />
              <span>{confirmButtonText || t('common.ok', 'Tamam')}</span>
            </button>
          </div>
        </div>
      )}
    </BasePage>
  );
};

export default BaseSelectionList;
