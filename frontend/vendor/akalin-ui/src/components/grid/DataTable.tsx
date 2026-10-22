/**
 * Akalin UI - Premium & Responsive DataTable Bileşeni
 * Gelişmiş veri listeleme, sıralama, arama, sayfalama, sütun yönetimi (Drag & Drop)
 * ve dar ekranlarda kırılmayı / alt satıra kaymayı önleyen korumalı yatay kaydırma ile akıllı mobil kart görünümü sunar.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, ChevronDown, Loader2, Search, Settings, X, GripVertical, MoreVertical } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export interface Column<T = any> {
  id?: string;
  header?: React.ReactNode;
  accessor?: string;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string | number;
  minWidth?: string | number;
  maxWidth?: string | number;
  style?: React.CSSProperties;
  cellStyle?: React.CSSProperties;
  render?: (item: T, index: number, tableActions: any) => React.ReactNode;
}

export interface FetchDataArgs {
  page: number;
  pageSize: number;
  sortField: string | null;
  sortOrder: string;
  aramaData: any;
}

export interface DataTableProps<T> {
  columns?: Column<T>[];
  fetchData?: (args: FetchDataArgs) => Promise<{ data?: T[]; items?: T[]; veriler?: T[]; totalCount?: number; total?: number; toplam?: number } | T[]>;
  data?: T[];
  loading?: boolean;
  pageSize?: number;
  keyExtractor?: (item: T) => string | number;
  onRowClick?: (item: T, e: React.MouseEvent) => void;
  onRowDoubleClick?: (item: T, e: React.MouseEvent) => void;
  onDataChange?: (data: T[]) => void;
  refreshKey?: number;
  emptyMessage?: string;
  searchableFields?: any[];
  searchState?: any;
  rowClassName?: (item: T, index: number) => string;
  mobileCardRender?: (item: T, index: number, tableActions: any) => React.ReactNode;
  tableActions?: any;
  enableColumnManagement?: boolean;
  totalCount?: number;
  stickyActionColumn?: boolean;
  hiddenRowIds?: (string | number)[];
  defaultSortField?: string;
  defaultSortOrder?: 'asc' | 'desc';
  expandedRowRender?: (item: T, index: number) => React.ReactNode;
}

const extractItemsAndTotal = <T,>(res: any): { items: T[]; totalCount?: number } => {
  if (!res) return { items: [] };
  if (Array.isArray(res)) return { items: res, totalCount: res.length };
  const items = res.data || res.items || res.veriler || res.Items || [];
  const totalCount = res.totalCount ?? res.total ?? res.toplam ?? res.TotalCount;
  return { items: Array.isArray(items) ? items : [], totalCount };
};

const DataTable = <T extends Record<string, any>>({
  columns = [],
  fetchData,
  data: propData,
  loading: propLoading,
  pageSize = 50,
  keyExtractor = (item: T) => item.id || '',
  onRowClick,
  onRowDoubleClick,
  onDataChange,
  refreshKey = 0,
  emptyMessage = 'Kayıt bulunamadı.',
  searchableFields = [],
  searchState,
  rowClassName = () => '',
  mobileCardRender,
  tableActions = {},
  enableColumnManagement = false,
  totalCount: propTotalCount,
  stickyActionColumn = false,
  hiddenRowIds = [],
  defaultSortField,
  defaultSortOrder,
  expandedRowRender
}: DataTableProps<T>) => {
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const getInitialAramaData = useCallback(() => {
    if (searchState) return searchState;
    const globalSearchState = typeof window !== 'undefined' ? (window as any).__GLOBAL_SEARCH_STATE__ : null;
    if (!globalSearchState || (!globalSearchState.searchTerm && (!globalSearchState.selectedFilterTypes || globalSearchState.selectedFilterTypes.length === 0) && !globalSearchState.startDate && !globalSearchState.endDate && !globalSearchState.value)) {
      return { type: 'Tumu', value: '', startDate: '', endDate: '' };
    }

    if (globalSearchState.value !== undefined && globalSearchState.type !== undefined) {
      return globalSearchState;
    }

    const filterIds = globalSearchState.selectedFilterTypes && globalSearchState.selectedFilterTypes.length > 0
      ? globalSearchState.selectedFilterTypes.filter((f: any) => f.id !== 'Tumu' && f.id !== 'All').map((f: any) => f.id)
      : [];

    const typeIds = filterIds.length > 0 ? filterIds : [(globalSearchState.activeSearchType?.id || 'Tumu')];
    const primaryType = filterIds.length > 0
      ? (filterIds.length === 1 ? filterIds[0] : filterIds.join(','))
      : (globalSearchState.activeSearchType?.id || 'Tumu');

    return {
      type: primaryType,
      types: typeIds,
      searchType: globalSearchState.activeSearchType?.id || 'Tumu',
      activeSearchType: globalSearchState.activeSearchType,
      filterTypes: filterIds,
      selectedFilterTypes: globalSearchState.selectedFilterTypes || [],
      selectedTypes: globalSearchState.selectedTypes || [],
      value: globalSearchState.searchTerm || '',
      displayValue: globalSearchState.displayValue || globalSearchState.searchTerm || '',
      startDate: globalSearchState.startDate || '',
      endDate: globalSearchState.endDate || ''
    };
  }, [searchState]);

  const [aramaData, setAramaData] = useState(getInitialAramaData);

  useEffect(() => {
    const handleGlobalSearch = (e: any) => {
      setAramaData(e.detail || { type: 'Tumu', value: '', startDate: '', endDate: '' });
    };
    const handleResize = () => setIsMobile(window.innerWidth <= 768);

    window.addEventListener('global-search', handleGlobalSearch);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('global-search', handleGlobalSearch);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (searchState) {
      setAramaData(searchState);
    }
  }, [searchState]);

  const searchableFieldsJson = JSON.stringify(searchableFields || []);
  useEffect(() => {
    if (searchableFields && searchableFields.length > 0) {
      window.dispatchEvent(new CustomEvent('register-search-fields', { detail: searchableFields }));
    }
    return () => {
      window.dispatchEvent(new CustomEvent('register-search-fields', { detail: [] }));
    };
  }, [searchableFieldsJson]);

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalCountState, setTotalCountState] = useState<number | undefined>(propTotalCount);
  const [clientRenderCount, setClientRenderCount] = useState<number>(pageSize);

  const autoDateCol = columns.find(col => {
    const key = (col.accessor || col.id || '').toLowerCase();
    return col.sortable && ['tarih', 'vadetarihi', 'harekettarihi', 'olusturulmatarihi', 'kayittarihi'].includes(key);
  });
  const initialSortField = defaultSortField || (autoDateCol ? (autoDateCol.accessor || autoDateCol.id || null) : null);
  const initialSortOrder = defaultSortOrder || 'desc';

  const [sortField, setSortField] = useState<string | null>(initialSortField);
  const [sortOrder, setSortOrder] = useState<string>(initialSortOrder);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const pageRef = useRef(1);
  const activeFetchIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Column Management States
  const allColumnIds = useMemo(() => 
    columns.map((col, idx) => col.id || col.accessor || idx.toString()),
    [columns]
  );

  const [visibleColumns, setVisibleColumns] = useState<string[]>(allColumnIds);
  const [columnOrder, setColumnOrder] = useState<string[]>(allColumnIds);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [draggedColId, setDraggedColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  useEffect(() => {
    const currentIds = columns.map((col, idx) => col.id || col.accessor || idx.toString());
    if (currentIds.length === 0) return;

    setColumnOrder(prev => {
      if (!prev || prev.length === 0) return currentIds;
      const validPrev = prev.filter(id => currentIds.includes(id));
      const added = currentIds.filter(id => !prev.includes(id));
      const next = [...validPrev, ...added];
      return next.length > 0 ? next : currentIds;
    });

    setVisibleColumns(prev => {
      if (!prev || prev.length === 0) return currentIds;
      const validPrev = prev.filter(id => currentIds.includes(id));
      const added = currentIds.filter(id => !prev.includes(id));
      const next = [...validPrev, ...added];
      return next.length > 0 ? next : currentIds;
    });
  }, [columns]);

  const activeColumns = useMemo(() => {
    if (!enableColumnManagement) {
      return columns.map((col, idx) => ({ col, id: col.id || col.accessor || idx.toString() }));
    }

    const currentIds = columns.map((col, idx) => col.id || col.accessor || idx.toString());
    if (currentIds.length === 0) return [];

    // Columns that were never in columnOrder are newly added / missing from state -> keep them visible by default
    const unconfiguredIds = currentIds.filter(id => !columnOrder.includes(id));
    
    const effectiveOrder = [
      ...columnOrder.filter(id => currentIds.includes(id)),
      ...unconfiguredIds
    ];

    // An action column (three-dot menu) is operational and must NEVER be hidden by column management
    const isActionCol = (c: Column<T>, id: string) => {
      return id === 'actions' || id === 'action' || id === 'islemler' || id === 'islem' || 
             c.id === 'actions' || c.id === 'action' || c.accessor === 'actions' || c.accessor === 'action' || 
             c.id === 'islemler' || c.id === 'islem' || !c.header;
    };

    const effectiveVisible = new Set([
      ...visibleColumns.filter(id => currentIds.includes(id)),
      ...unconfiguredIds,
      ...columns.filter((c, idx) => isActionCol(c, c.id || c.accessor || idx.toString())).map((c, idx) => c.id || c.accessor || idx.toString())
    ]);

    const ordered = effectiveOrder
      .filter(id => effectiveVisible.has(id))
      .map(id => {
        const col = columns.find((c, idx) => (c.id || c.accessor || idx.toString()) === id);
        return col ? { col, id } : null;
      })
      .filter((item): item is { col: Column<T>; id: string } => item !== null);

    // If for any reason ordered is empty or dropped all columns, safely fallback to all columns
    if (ordered.length === 0) {
      return columns.map((col, idx) => ({ col, id: col.id || col.accessor || idx.toString() }));
    }

    return ordered;
  }, [enableColumnManagement, columns, columnOrder, visibleColumns]);

  // Calculate total minimum width from columns so table can scroll horizontally on narrow screens without shrinking below minWidth
  const tableMinWidth = useMemo(() => {
    let total = 0;
    let hasExplicitWidth = false;
    for (const { col, id } of activeColumns) {
      const isAction = id === 'actions' || id === 'action' || id === 'islemler' || id === 'islem' || col.id === 'actions';
      const mw = col.style?.minWidth || col.minWidth;
      const w = col.style?.width || col.width;

      if (typeof mw === 'number') {
        total += mw;
        hasExplicitWidth = true;
      } else if (typeof mw === 'string' && mw.endsWith('px')) {
        total += parseFloat(mw) || 0;
        hasExplicitWidth = true;
      } else if (typeof w === 'number') {
        total += w;
        hasExplicitWidth = true;
      } else if (typeof w === 'string' && w.endsWith('px')) {
        total += parseFloat(w) || 0;
        hasExplicitWidth = true;
      } else if (isAction) {
        total += 60;
        hasExplicitWidth = true;
      } else {
        total += 100;
      }
    }
    return hasExplicitWidth && total > 0 ? `${total}px` : '100%';
  }, [activeColumns]);


  const toggleColumn = (id: string) => {
    setVisibleColumns(prev => 
      prev.includes(id) 
        ? (prev.length > 1 ? prev.filter(c => c !== id) : prev) 
        : [...prev, id]
    );
  };

  // Initial Fetch & Reset on Dependency Changes
  useEffect(() => {
    if (propData !== undefined) {
      setData(propData);
      setLoading(propLoading ?? false);
      setClientRenderCount(pageSize);
      setHasMore(propData.length > pageSize);
      setTotalCountState(propData.length);
      return;
    }

    if (!fetchData) return;

    const fetchId = ++activeFetchIdRef.current;
    setLoading(true);
    setPage(1);
    pageRef.current = 1;
    setHasMore(true);

    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }

    fetchData({ page: 1, pageSize, sortField, sortOrder, aramaData })
      .then(res => {
        if (!isMountedRef.current || fetchId !== activeFetchIdRef.current) return;
        const { items: newItems, totalCount: total } = extractItemsAndTotal<T>(res);
        setData(newItems);
        setTotalCountState(total);
        if (onDataChange) onDataChange(newItems);
        if (newItems.length === 0 || newItems.length < pageSize) {
          setHasMore(false);
        } else if (total !== undefined) {
          setHasMore(newItems.length < total);
        } else {
          setHasMore(true);
        }
      })
      .catch(err => {
        if (!isMountedRef.current || fetchId !== activeFetchIdRef.current) return;
        console.error('DataTable fetch error:', err);
      })
      .finally(() => {
        if (isMountedRef.current && fetchId === activeFetchIdRef.current) {
          setLoading(false);
        }
      });
  }, [fetchData, propData, propLoading, pageSize, sortField, sortOrder, aramaData, refreshKey]);

  // Infinite Scroll Trigger
  const loadMoreData = useCallback(() => {
    if (loading || loadingMore || !hasMore || loadingRef.current) return;

    if (propData !== undefined) {
      if (clientRenderCount < propData.length) {
        const nextCount = clientRenderCount + pageSize;
        setClientRenderCount(nextCount);
        setHasMore(nextCount < propData.length);
      } else {
        setHasMore(false);
      }
      return;
    }

    if (!fetchData) return;

    loadingRef.current = true;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;

    fetchData({ page: nextPage, pageSize, sortField, sortOrder, aramaData })
      .then(res => {
        const { items: newItems, totalCount: total } = extractItemsAndTotal<T>(res);
        if (total !== undefined) {
          setTotalCountState(total);
        }
        setData(prev => {
          const updated = [...prev, ...newItems];
          if (onDataChange) onDataChange(updated);
          const effectiveTotal = total ?? totalCountState;
          if (newItems.length === 0 || newItems.length < pageSize) {
            setHasMore(false);
          } else if (effectiveTotal !== undefined) {
            setHasMore(updated.length < effectiveTotal);
          } else {
            setHasMore(true);
          }
          return updated;
        });
        pageRef.current = nextPage;
        setPage(nextPage);
      })
      .catch(err => {
        console.error('DataTable load more error:', err);
      })
      .finally(() => {
        setLoadingMore(false);
        loadingRef.current = false;
      });
  }, [loading, loadingMore, hasMore, pageSize, sortField, sortOrder, aramaData, fetchData, onDataChange, propData, clientRenderCount, totalCountState]);

  const loadMoreDataRef = useRef(loadMoreData);
  useEffect(() => {
    loadMoreDataRef.current = loadMoreData;
  });

  // Scroll Container Detection & IntersectionObserver
  useEffect(() => {
    if (loading || !hasMore) return;

    const getScrollParent = (node: HTMLElement | null): HTMLElement | Window => {
      let current = node?.parentElement;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return current;
        }
        current = current.parentElement;
      }
      return window;
    };

    const scrollParent = getScrollParent(observerRef.current);

    const checkAndLoadMore = () => {
      if (loading || loadingMore || !hasMore || loadingRef.current) return;
      if (scrollParent === window) {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = window.innerHeight;
        if (scrollHeight - scrollTop - clientHeight < 300) {
          loadMoreDataRef.current();
        }
      } else {
        const el = scrollParent as HTMLElement;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
          loadMoreDataRef.current();
        }
      }
    };

    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          checkAndLoadMore();
          ticking = false;
        });
        ticking = true;
      }
    };

    const target = scrollParent === window ? window : scrollParent;
    target.addEventListener('scroll', handleScroll, { passive: true });

    let observer: IntersectionObserver | null = null;
    if (observerRef.current) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            loadMoreDataRef.current();
          }
        },
        {
          root: scrollParent === window ? null : (scrollParent as Element),
          threshold: 0.05,
          rootMargin: '200px'
        }
      );
      observer.observe(observerRef.current);
    }

    return () => {
      target.removeEventListener('scroll', handleScroll);
      if (observer) observer.disconnect();
    };
  }, [loading, hasMore, isMobile, data.length]);

  const renderSentinel = () => {
    if (loading || displayData.length === 0) return null;
    return (
      <div
        ref={observerRef}
        style={{
          minHeight: '56px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          position: 'sticky',
          left: 0,
          width: '100%'
        }}
      >
        {loadingMore && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--bg-secondary)', padding: '8px 16px', borderRadius: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
            <Loader2 className="spinner" size={18} color="var(--accent-primary)" />
            <span style={{ fontSize: '13px', fontWeight: '500' }}>{t('auto_daha_fazla_yukleniyo_935c', 'Daha fazla yükleniyor...')}</span>
          </div>
        )}
        {!hasMore && !loadingMore && (
          <span style={{ fontSize: '13px', opacity: 0.6, fontWeight: '500' }}>
            {totalCountState !== undefined
              ? t('auto_toplam_kayit_gosterildi', 'Toplam {{count}} kayıt listelendi.', { count: Math.max(0, totalCountState - (hiddenRowIds?.length || 0)) })
              : t('auto_tum_kayitlar_yuklend_ad5e', 'Tüm kayıtlar yüklendi.')}
          </span>
        )}
      </div>
    );
  };

  const filteredData = useMemo(() => {
    if (!hiddenRowIds || hiddenRowIds.length === 0) return data;
    const hiddenSet = new Set(hiddenRowIds.map(String));
    return data.filter(item => !hiddenSet.has(String(keyExtractor(item))));
  }, [data, hiddenRowIds, keyExtractor]);

  const sortedData = useMemo(() => {
    if (!sortField) return filteredData;

    return [...filteredData].sort((a: any, b: any) => {
      const getVal = (item: any, field: string) => {
        if (!item || !field) return null;
        if (field.includes('.')) {
          return field.split('.').reduce((acc, part) => {
            if (!acc) return null;
            if (acc[part] !== undefined) return acc[part];
            const pascal = part.charAt(0).toUpperCase() + part.slice(1);
            if (acc[pascal] !== undefined) return acc[pascal];
            const lower = part.charAt(0).toLowerCase() + part.slice(1);
            return acc[lower];
          }, item);
        }
        if (item[field] !== undefined) return item[field];
        const pascal = field.charAt(0).toUpperCase() + field.slice(1);
        if (item[pascal] !== undefined) return item[pascal];
        const lower = field.charAt(0).toLowerCase() + field.slice(1);
        if (item[lower] !== undefined) return item[lower];
        return null;
      };

      const valA = getVal(a, sortField);
      const valB = getVal(b, sortField);

      if (valA === valB) return 0;
      if (valA === null || valA === undefined || valA === '') return 1;
      if (valB === null || valB === undefined || valB === '') return -1;

      let comparison = 0;
      if (typeof valA === 'boolean' || typeof valB === 'boolean') {
        const boolA = Boolean(valA);
        const boolB = Boolean(valB);
        comparison = boolA === boolB ? 0 : (boolA ? -1 : 1);
      } else {
        const numA = Number(valA);
        const numB = Number(valB);
        const isNumA = !isNaN(numA) && typeof valA !== 'boolean' && String(valA).trim() !== '';
        const isNumB = !isNaN(numB) && typeof valB !== 'boolean' && String(valB).trim() !== '';

        if (isNumA && isNumB) {
          comparison = numA - numB;
        } else if (valA instanceof Date && valB instanceof Date) {
          comparison = valA.getTime() - valB.getTime();
        } else {
          comparison = String(valA).localeCompare(String(valB), 'tr', { numeric: true, sensitivity: 'base' });
        }
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }, [filteredData, sortField, sortOrder]);

  const displayData = propData !== undefined ? sortedData.slice(0, clientRenderCount) : sortedData;

  const onDataChangeRef = useRef(onDataChange);
  useEffect(() => {
    onDataChangeRef.current = onDataChange;
  }, [onDataChange]);

  const prevSortedDataRef = useRef<T[]>();
  useEffect(() => {
    if (onDataChangeRef.current && sortedData !== prevSortedDataRef.current) {
      prevSortedDataRef.current = sortedData;
      onDataChangeRef.current(sortedData);
    }
  }, [sortedData]);

  const handleSort = (column: Column<T>, e: React.MouseEvent) => {
    const targetField = column.accessor || column.id;
    if (!column.sortable || !targetField) return;

    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSortField(null);
      setSortOrder('asc');
      return;
    }

    if (sortField === targetField) {
      setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(targetField);
      const isDateCol = ['tarih', 'vadetarihi', 'harekettarihi', 'olusturulmatarihi', 'kayittarihi'].includes(targetField.toLowerCase());
      setSortOrder(isDateCol ? 'desc' : 'asc');
    }
  };

  return (
    <div ref={containerRef} className="data-table-container flex flex-col flex-1 min-h-0" style={{ padding: 0, overflow: 'hidden', width: '100%', position: 'relative' }}>
      {isMobile && mobileCardRender ? (
        <div 
          ref={scrollContainerRef}
          style={{ display: 'flex', flexDirection: 'column', padding: '8px', gap: '8px', overflowY: 'auto', flex: 1, minHeight: 0 }}
        >
          {loading && page === 1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '40px', color: 'var(--text-secondary)' }}>
              <div className="premium-spinner">
                <Loader2 size={40} color="var(--accent-primary)" />
              </div>
              <span style={{ fontWeight: '500', fontSize: '15px' }}>{t('auto_veriler_yukleniyor_2714')}</span>
            </div>
          ) : displayData.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '40px', color: 'var(--text-secondary)' }}>
              <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '50%', marginBottom: '8px' }}>
                <Search size={32} color="var(--text-muted)" opacity={0.5} />
              </div>
              <span style={{ fontWeight: '500', fontSize: '15px' }}>{emptyMessage}</span>
            </div>
          ) : (
            <>
              {displayData.map((item: T, index: number) => (
                <div
                  key={keyExtractor(item) || index}
                  onClick={(e) => {
                    if (onRowClick) onRowClick(item, e);
                  }}
                  onDoubleClick={(e) => onRowDoubleClick && onRowDoubleClick(item, e)}
                  className={`table-row-hover ${rowClassName(item, index)}`}
                  style={{
                    background: 'var(--bg-secondary)',
                    borderRadius: '12px',
                    border: '1px solid var(--glass-border)',
                    overflow: 'hidden'
                  }}
                >
                  {mobileCardRender(item, index, tableActions)}
                </div>
              ))}
              {renderSentinel()}
            </>
          )}
        </div>
      ) : (
        <div 
          ref={scrollContainerRef}
          style={{ overflow: 'auto', width: '100%', flex: 1, minHeight: 0, borderRadius: 'inherit' }}
        >
          <table 
            className="premium-table" 
            style={{ 
              width: '100%', 
              borderCollapse: 'separate', 
              borderSpacing: 0, 
              textAlign: 'left', 
              minWidth: tableMinWidth
            }}
          >
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-primary)', backdropFilter: 'blur(8px)' }}>
              <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                {activeColumns.map(({ col, id }, idx) => {
                  const isActionCol = col.id === 'actions' || col.id === 'action' || col.accessor === 'actions' || col.id === 'islemler' || col.id === 'islem' || col.accessor === 'islemler' || col.accessor === 'islem';
                  const shouldStick = stickyActionColumn && isActionCol;
                  return (
                    <th
                      key={id}
                      onDragOver={enableColumnManagement ? (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverColId !== id) setDragOverColId(id);
                      } : undefined}
                      onDrop={enableColumnManagement ? (e) => {
                        e.preventDefault();
                        setDragOverColId(null);
                        const droppedId = e.dataTransfer.getData('text/plain') || draggedColId;
                        if (!droppedId || droppedId === id) return;
                        setColumnOrder(prev => {
                          const newOrder = [...prev];
                          const dragIndex = newOrder.indexOf(droppedId);
                          const dropIndex = newOrder.indexOf(id);
                          if (dragIndex !== -1 && dropIndex !== -1) {
                            newOrder.splice(dragIndex, 1);
                            newOrder.splice(dropIndex, 0, droppedId);
                          }
                          return newOrder;
                        });
                        setDraggedColId(null);
                      } : undefined}
                      onClick={(e) => handleSort(col, e)}
                      title={
                        col.sortable
                          ? (sortField === (col.accessor || col.id)
                              ? t('auto_siralamayi_iptal_et_ipucu', 'Sıralamayı değiştirmek için tıklayın, iptal etmek için Ctrl ile tıklayın')
                              : t('auto_siralamak_icin_tiklayin', 'Sıralamak için tıklayın'))
                          : undefined
                      }
                      style={{
                        padding: isActionCol ? '8px 12px' : '12px 16px',
                        cursor: col.sortable ? 'pointer' : 'default',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                        opacity: draggedColId === id ? 0.5 : 1,
                        background: dragOverColId === id ? 'rgba(99, 102, 241, 0.05)' : 'var(--bg-primary)',
                        boxShadow: dragOverColId === id ? 'inset 4px 0 0 var(--accent-primary)' : (shouldStick ? '-4px 0 8px rgba(0,0,0,0.03)' : 'none'),
                        position: shouldStick ? 'sticky' : 'relative',
                        right: shouldStick ? 0 : undefined,
                        zIndex: shouldStick ? 12 : undefined,
                        transition: 'background 0.2s, boxShadow 0.2s',
                        borderBottom: '1px solid var(--glass-border)',
                        width: col.style?.width || col.width,
                        minWidth: col.style?.minWidth || col.minWidth || (col.width && typeof col.width === 'string' && !col.width.includes('%') ? col.width : undefined) || (isActionCol ? '60px' : undefined),
                        maxWidth: col.style?.maxWidth || col.maxWidth,
                        ...col.style
                      }}
                      className={col.sortable ? 'sortable-header' : ''}
                    >
                      {isActionCol ? (
                        <div className="table-action-cell-container">
                          {enableColumnManagement && idx === activeColumns.length - 1 && (
                            <button 
                              type="button" 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                if (!showColumnMenu) {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setMenuPosition({ 
                                    top: rect.bottom + 4, 
                                    left: Math.max(8, rect.right - 200)
                                  });
                                }
                                setShowColumnMenu(!showColumnMenu); 
                              }} 
                              title={t('auto_sutun_gorunumu_ff99', 'Sütun Görünümü')}
                              className="table-column-settings-btn"
                            >
                              <Settings size={16} />
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start', whiteSpace: 'nowrap' }}>
                            {enableColumnManagement && Boolean(col.header) && (
                              <div 
                                draggable={true}
                                onDragStart={(e) => {
                                  setDraggedColId(id);
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('text/plain', id);
                                }}
                                onDragEnd={() => {
                                  setDraggedColId(null);
                                  setDragOverColId(null);
                                }}
                                style={{ cursor: 'grab', color: 'var(--text-tertiary)', flexShrink: 0, display: 'flex', padding: '2px' }} 
                                onClick={e => e.stopPropagation()}
                              >
                                <GripVertical size={14} />
                              </div>
                            )}
                            <span style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '12.5px', textTransform: 'capitalize', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                              {col.header}
                            </span>
                            {col.sortable && sortField === (col.accessor || col.id) && (
                              <span style={{ display: 'flex', flexDirection: 'column', color: 'var(--accent-primary)', transition: 'transform 0.2s' }}>
                                {sortOrder === 'asc' ? <ChevronUp size={15} strokeWidth={3} /> : <ChevronDown size={15} strokeWidth={3} />}
                              </span>
                            )}
                            {col.sortable && sortField !== (col.accessor || col.id) && (
                              <span style={{ color: 'var(--text-muted)' }}>
                                <ChevronDown size={15} opacity={0.4} />
                              </span>
                            )}
                          </div>

                          {enableColumnManagement && idx === activeColumns.length - 1 && (
                            <button 
                              type="button" 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                if (!showColumnMenu) {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setMenuPosition({ 
                                    top: rect.bottom + 4, 
                                    left: Math.max(8, rect.right - 200)
                                  });
                                }
                                setShowColumnMenu(!showColumnMenu); 
                              }} 
                              title={t('auto_sutun_gorunumu_ff99', 'Sütun Görünümü')}
                              className="table-column-settings-btn"
                              style={{ 
                                position: 'absolute', 
                                right: '12px', 
                                top: '50%', 
                                transform: 'translateY(-50%)', 
                                zIndex: 2
                              }}
                            >
                              <Settings size={16} />
                            </button>
                          )}
                        </>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading && page === 1 ? (
                <tr>
                  <td colSpan={activeColumns.length} style={{ padding: '64px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--text-secondary)' }}>
                      <div className="premium-spinner">
                        <Loader2 size={40} color="var(--accent-primary)" />
                      </div>
                      <span style={{ fontWeight: '500', fontSize: '15px' }}>{t('auto_veriler_yukleniyor_2714')}</span>
                    </div>
                  </td>
                </tr>
              ) : displayData.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length} style={{ padding: '64px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                      <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '50%', marginBottom: '8px' }}>
                        <Search size={32} color="var(--text-muted)" opacity={0.5} />
                      </div>
                      <span style={{ fontWeight: '500', fontSize: '15px' }}>{emptyMessage}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                displayData.map((item: T, index: number) => {
                  const rowKey = keyExtractor(item) || index;
                  const expandedContent = expandedRowRender ? expandedRowRender(item, index) : null;
                  return (
                    <React.Fragment key={rowKey}>
                      <tr
                        style={{ borderBottom: '1px solid var(--glass-border)' }}
                        className={`table-row-hover ${rowClassName(item, index)}`}
                        onClick={(e) => onRowClick && onRowClick(item, e)}
                        onDoubleClick={(e) => onRowDoubleClick && onRowDoubleClick(item, e)}
                      >
                        {activeColumns.map(({ col }, idx) => {
                          const isActionCol = col.id === 'actions' || col.id === 'action' || col.accessor === 'actions' || col.id === 'islemler' || col.id === 'islem' || col.accessor === 'islemler' || col.accessor === 'islem';
                          const shouldStick = stickyActionColumn && isActionCol;
                          const cellValue = col.render ? col.render(item, index, tableActions) : item[col.accessor || ''];
                          const tooltipText = typeof cellValue === 'string' ? cellValue : undefined;

                          return (
                            <td
                              key={idx}
                              title={tooltipText}
                              style={{
                                padding: isActionCol ? '8px 12px' : '12px 16px',
                                textAlign: isActionCol ? 'right' : (col.align || 'left'),
                                verticalAlign: 'middle',
                                whiteSpace: 'nowrap',
                                fontSize: '13.5px',
                                position: shouldStick ? 'sticky' : undefined,
                                right: shouldStick ? 0 : undefined,
                                background: shouldStick ? 'var(--bg-primary)' : undefined,
                                boxShadow: shouldStick ? '-4px 0 8px rgba(0,0,0,0.03)' : undefined,
                                zIndex: shouldStick ? 2 : undefined,
                                width: col.style?.width || col.width,
                                minWidth: col.style?.minWidth || col.minWidth || (col.width && typeof col.width === 'string' && !col.width.includes('%') ? col.width : undefined) || (isActionCol ? '60px' : undefined),
                                maxWidth: col.style?.maxWidth || col.maxWidth,
                                ...col.cellStyle
                              }}
                            >
                              {isActionCol ? (
                                <div className="table-action-cell-container">
                                  {cellValue}
                                </div>
                              ) : (
                                cellValue
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      {expandedContent && (
                        <tr
                          className="datatable-expanded-row"
                          style={{
                            borderBottom: '1px solid var(--glass-border)',
                            background: 'rgba(15, 23, 42, 0.02)',
                          }}
                        >
                          <td colSpan={activeColumns.length} style={{ padding: 0 }}>
                            {expandedContent}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
          {renderSentinel()}
        </div>
      )}

      <style>{`
        .premium-table-wrapper {
          box-shadow: 0 4px 20px rgba(0,0,0,0.03);
          border-radius: 14px;
          border: 1px solid var(--glass-border);
          transition: box-shadow 0.3s ease;
          background: var(--bg-primary);
        }
        .premium-table-wrapper:hover {
          box-shadow: 0 8px 30px rgba(0,0,0,0.06);
        }
        .premium-table {
          letter-spacing: normal;
        }
        .premium-table th {
          border-top: none;
          font-weight: 600;
        }
        .premium-table td {
          color: var(--text-primary);
        }
        .sortable-header {
          transition: background 0.2s ease;
        }
        .sortable-header:hover {
          background: var(--hover-bg) !important;
        }
        .spinner {
          animation: spin 1s linear infinite;
        }
        .premium-spinner {
          animation: spin 1.5s cubic-bezier(0.5, 0.1, 0.4, 0.9) infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .table-action-cell-container {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          width: 100%;
        }
        .table-column-settings-btn {
          width: 36px;
          height: 36px;
          background: var(--bg-primary);
          border: 1px solid var(--glass-border);
          border-radius: var(--md3-shape-small, 10px);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .table-column-settings-btn:hover {
          background: var(--hover-bg, rgba(99, 102, 241, 0.06));
          border-color: var(--accent-light, rgba(99, 102, 241, 0.3));
          color: var(--accent-primary);
        }
        .table-row-hover {
          transition: background-color 0.15s ease;
          cursor: pointer;
        }
        .table-row-hover:hover { 
          background-color: var(--hover-bg); 
        }
        .table-row-hover:hover td {
          background-color: var(--hover-bg);
        }
        /* Custom Ultra-Sleek Scrollbar for DataTable */
        .data-table-container::-webkit-scrollbar {
          height: 6px;
          width: 6px;
        }
        .data-table-container::-webkit-scrollbar-track {
          background: transparent;
        }
        .data-table-container::-webkit-scrollbar-thumb {
          background: var(--glass-border);
          border-radius: 10px;
        }
        .data-table-container::-webkit-scrollbar-thumb:hover {
          background: var(--text-tertiary);
        }
      `}</style>
      
      {showColumnMenu && enableColumnManagement && createPortal(
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 9999 }}>
          <div 
            style={{ position: 'fixed', inset: 0 }} 
            onClick={(e) => { e.stopPropagation(); setShowColumnMenu(false); }}
          />
          <div style={{
            position: 'fixed',
            top: menuPosition.top,
            left: menuPosition.left,
            background: 'var(--bg-primary)',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            borderRadius: '6px',
            padding: '8px',
            minWidth: '200px',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{t('auto_sutun_gorunumu_ff99')}</span>
              <button onClick={() => setShowColumnMenu(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex' }}><X size={14} /></button>
            </div>
            {columns.filter(col => col.header).map((col, idx) => {
              const colId = col.id || col.accessor || idx.toString();
              return (
                <label key={colId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '13px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={visibleColumns.includes(colId)} 
                    onChange={() => toggleColumn(colId)} 
                  />
                  {col.header}
                </label>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default DataTable;
