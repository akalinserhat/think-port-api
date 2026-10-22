// @ts-nocheck
/**
 * ============================================================================
 * AGENT KNOWLEDGE & USAGE GUIDE
 * ============================================================================
 * BaseListPage, sistemdeki tüm tam sayfa listeleme (Liste) ekranlarının
 * (Cariler Listesi, Siparişler Listesi, Kullanıcılar, API Anahtarları vb.) ana altyapısıdır.
 *
 * Yetenekleri:
 * - Sayfa üstünde Başlık, Alt Başlık ve ActionMenu bileşenini standartlaştırır.
 * - Kendisine verilen `apiEndpoint` veya `customFetchData` üzerinden DataTable aracılığıyla verileri çeker.
 * - Arama, Sayfalama, Sıralama parametrelerini otomatik yönetir (`handleFetchData`).
 * - Listede "Sil" (Delete) işlemine tıklandığında otomatik olarak bir onay dialogu 
 *   (AlertDialog) çıkarır ve onaylanınca API'ye DELETE isteği atıp listeyi yeniler.
 * - "Yeni Ekle" veya satıra çift tıklama/düzenle işlemlerinde `baseRoute` yönlendirmesini yapar.
 * - DataTable'ın sağ tarafına standart satır içi üç noktalı işlem menüsünü (`ActionMenu`)
 *   otomatik ekler (Düzenle, Sil ve özel ek eylemler).
 *
 * ACTIONMENU VE HEADER AKSİYONLARI MİMARİSİ (STANDART KURAL):
 * 1. BaseListPage ve bu sınıftan türeyen tüm liste sayfalarının başlık (Header / BaseCardPageHeader)
 *    bölümünde harici/bağımsız düğmeler (`BaseButton`, `<button>` vb. `customHeaderActions`) KULLANILMAMALIDIR.
 * 2. Bunun yerine BaseListPage içerisinde yerleşik bulunan `ActionMenu` bileşeni (`extraDropdownActions`,
 *    `actionMenuTrigger`, `actionMenuDropdownHeader`, `onActionMenuTriggerClick`) kullanılmalıdır.
 * 3. `extraDropdownActions` içerisindeki varsayılan birincil eylem (`isDefault: true, variant: 'primary'`,
 *    veya otomatik olarak "Yeni Ekle" / `onAddNew` eylemi) başlıkta split-button olarak gösterilir;
 *    filtreleme, yenileme, dışa aktarma ve özel kontroller (`type: 'custom'`) ise aynı `ActionMenu`
 *    açılır menüsü (dropdown) içerisinden sunulur.
 *
 * Ne Zaman Kullanılmaz?
 * - Ekleme ve Düzenleme işlemleri ayrı bir sayfada DEĞİL DE Modal (Popup) içinde 
 *   yapılacaksa `BaseListPage` yerine `BaseModalCrud` kullanılmalıdır!
 * ============================================================================
 */
import React, { useState, useEffect, useRef, useMemo, useCallback, ReactNode } from 'react';
import { Plus, Edit2, Trash2, Layers, Archive, RotateCcw, FileEdit } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import DataTable from '../../components/grid/DataTable';
import AlertDialog from '../../components/dialog/AlertDialog';
import ActionMenu, { ActionMenuItem } from '../../components/menu/ActionMenu';
import { useInternalTableNavigation, useInternalTableAction } from '../../utils/tableUtils';
import BaseFloatCircleButton from '../../components/base/button/BaseFloatCircleButton';
import EkleFloatCircleButton from '../../components/button/EkleFloatCircleButton';
import { MenuButtonItem } from '../../components/base/button/BaseMenuButton';
import BackButton from '../../components/button/BackButton';
import { useHeaderApi } from '../../context/HeaderContext';
import BaseCardPageHeader, { BaseCardPageHeaderProps } from '../../components/card/BaseCardPageHeader';
import UndoDeleteBar from '../../components/notification/UndoDeleteBar';
import { updateDocumentTitle } from '../../utils/domUtils';

export interface BaseListPageProps<T = any> {
    title?: string;
    subtitle?: string;
    icon?: ReactNode;
    defaultIcon?: ReactNode;
    headerSync?: boolean;
    showBackButton?: boolean;
    backRoute?: string;
    onBack?: () => void;
    apiEndpoint?: string;
    baseRoute?: string;
    columns?: any[]; // DataTable columns definition
    searchableFields?: any[]; // DataTable searchable fields
    itemNameResolver?: (item: T) => string;
    addNewText?: string;
    emptyMessage?: string;
    customAddButton?: ReactNode;
    customHeaderActions?: ReactNode;
    customRenderContent?: (props: any) => ReactNode;
    fetchParams?: Record<string, any>;
    pageSize?: number;
    mobileCardRender?: (item: T, index: number, tableActions: any) => React.ReactNode;
    disableAdd?: boolean;
    disableEdit?: boolean;
    disableDelete?: boolean;
    hideDefaultActions?: boolean;
    customRowActions?: (item: T, tableActions?: any) => ActionMenuItem[];
    onAddNew?: () => void;
    onEdit?: (item: T, e?: any) => void;
    canDelete?: (item: T) => Promise<{ canDelete: boolean; message?: string } | boolean> | { canDelete: boolean; message?: string } | boolean;
    enableArchive?: boolean;
    onArchive?: (item: T) => Promise<void> | void;
    onUnarchive?: (item: T) => Promise<void> | void;
    enableViewModeToggle?: boolean;
    defaultViewMode?: 'active' | 'archive' | 'trash';
    onViewModeChange?: (viewMode: 'active' | 'archive' | 'trash') => void;
    enableUndoDelete?: boolean;
    undoDurationMs?: number;
    service?: { getAll: (params?: any) => Promise<any>; delete?: (id: any) => Promise<any>; canDelete?: (id: any) => Promise<any>; restore?: (id: any) => Promise<any>; archive?: (id: any) => Promise<any>; unarchive?: (id: any) => Promise<any> } | any;
    customFetchData?: (paramsObj?: any) => Promise<{ data: T[]; totalCount?: number } | T[]>;
    customDeleteData?: (id: string | number) => Promise<void>;
    enableColumnManagement?: boolean;
    stickyActionColumn?: boolean;
    addMenuItems?: MenuButtonItem[];
    refreshKey?: number;
    useAddButtonShadow?: boolean;
    // ✨ Yapay Zeka (AI) Yetenekleri
    enableAi?: boolean;
    aiDocumentType?: string;
    aiPromptSuggestions?: string[];
    onAiSuccess?: (data: any) => void;
    containerClassName?: string;
    // ✨ Header & Breadcrumb Özelleştirme
    breadcrumb?: ReactNode;
    subtitleLeft?: ReactNode;
    subtitleRight?: ReactNode;
    headerProps?: Partial<BaseCardPageHeaderProps>;
    hideHeader?: boolean;
    defaultSortField?: string;
    defaultSortOrder?: 'asc' | 'desc';
    // ✨ Header ActionMenu Desteği
    extraDropdownActions?: ActionMenuItem[];
    actionMenuTrigger?: ReactNode;
    actionMenuDropdownHeader?: ReactNode;
    onActionMenuTriggerClick?: (e: React.MouseEvent) => void;
    customActionMenu?: ReactNode;
}

const normalizeListResponse = <T,>(res: any): { data: T[]; totalCount?: number } => {
    if (!res) return { data: [] };
    if (Array.isArray(res)) return { data: res, totalCount: res.length };
    const items = res.data || res.items || res.veriler || res.Items || [];
    const totalCount = res.totalCount ?? res.total ?? res.toplam ?? res.TotalCount;
    return { data: Array.isArray(items) ? items : [], totalCount };
};

/**
 * BaseListPage
 * Merkezi listeleme sayfası iskeleti.
 */
const getStoredDraft = (route?: string, docType?: string) => {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    try {
        const key = route ? `akalin_draft_${route.replace(/^\/+|\/+$/g, '').replace(/\//g, '_').toLowerCase()}` : (docType ? `akalin_draft_${docType.toLowerCase()}` : null);
        if (!key) return null;
        const raw = sessionStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
};

const clearStoredDraft = (route?: string, docType?: string) => {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
        const key = route ? `akalin_draft_${route.replace(/^\/+|\/+$/g, '').replace(/\//g, '_').toLowerCase()}` : (docType ? `akalin_draft_${docType.toLowerCase()}` : null);
        if (key) sessionStorage.removeItem(key);
    } catch (e) {}
};

const BaseListPage = <T extends any = any>({
    title,
    subtitle,
    icon,
    defaultIcon,
    headerSync = false,
    showBackButton = false,
    backRoute,
    onBack,
    apiEndpoint,
    service,
    baseRoute,
    columns,
    searchableFields,
    itemNameResolver: externalItemNameResolver,
    addNewText: externalAddNewText,
    emptyMessage: externalEmptyMessage,
    customAddButton,
    customHeaderActions,
    customRenderContent,
    fetchParams = {},
    pageSize = 50,
    mobileCardRender,
    disableAdd = false,
    disableEdit = false,
    disableDelete = false,
    hideDefaultActions = false,
    customRowActions,
    onAddNew,
    onEdit,
    onDelete,
    canDelete: externalCanDelete,
    enableArchive = true,
    onArchive,
    onUnarchive,
    enableViewModeToggle = false,
    defaultViewMode = 'active',
    onViewModeChange,
    enableUndoDelete = true,
    undoDurationMs = 4000,
    customFetchData,
    customDeleteData,
    enableColumnManagement = false,
    stickyActionColumn = false,
    addMenuItems,
    refreshKey: externalRefreshKey = 0,
    useAddButtonShadow = true,
    enableAi = true,
    aiDocumentType,
    aiPromptSuggestions,
    onAiSuccess,
    containerClassName = "fade-in flex flex-col flex-1 min-h-0 overflow-hidden",
    breadcrumb,
    subtitleLeft,
    subtitleRight,
    headerProps,
    hideHeader = false,
    defaultSortField,
    defaultSortOrder = 'desc',
    extraDropdownActions,
    actionMenuTrigger,
    actionMenuDropdownHeader,
    onActionMenuTriggerClick,
    customActionMenu,
}: BaseListPageProps<T>) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (title) updateDocumentTitle(title);
    }, [title]);
    const { setHeader, clearHeader } = useHeaderApi();
    const headerIdRef = useRef(Math.random().toString(36).substr(2, 9));
    const listStorageKey = `akalin_active_row_${baseRoute || location.pathname}`;

    const [viewMode, setViewMode] = useState<'active' | 'archive' | 'trash'>(defaultViewMode);

    useEffect(() => {
        if ((headerSync || showBackButton) && setHeader) {
            setHeader(
                headerIdRef.current,
                <BackButton 
                    onClick={() => {
                        if (onBack) return onBack();
                        if (backRoute) return navigate(backRoute);
                        if (window.history.state && window.history.state.idx > 0) {
                            navigate(-1);
                        } else if (baseRoute) {
                            navigate(baseRoute);
                        }
                    }} 
                    title={t('auto_geri_don', 'Geri Dön')} 
                />
            );

            return () => clearHeader && clearHeader(headerIdRef.current);
        }
    }, [headerSync, showBackButton, backRoute, onBack, baseRoute, setHeader, clearHeader, navigate, t]);

    const headerIconToRender = useMemo(() => {
        if (enableViewModeToggle) {
            if (viewMode === 'trash') return <Trash2 size={22} />;
            if (viewMode === 'archive') return <Archive size={22} />;
        }
        return icon !== undefined ? icon : (defaultIcon || (title ? <Layers size={22} /> : undefined));
    }, [enableViewModeToggle, viewMode, icon, defaultIcon, title]);

    const headerSubtitleToRender = useMemo(() => {
        if (enableViewModeToggle) {
            if (viewMode === 'trash') {
                return (
                    <span className="flex items-center gap-6">
                        {subtitle && <span>{subtitle}</span>}
                        <span className="chip chip-danger text-12 font-medium">{t('auto_cop_kutusu', 'Çöp Kutusu')}</span>
                    </span>
                );
            }
            if (viewMode === 'archive') {
                return (
                    <span className="flex items-center gap-6">
                        {subtitle && <span>{subtitle}</span>}
                        <span className="chip chip-warning text-12 font-medium">{t('auto_arsiv', 'Arşiv')}</span>
                    </span>
                );
            }
        }
        return subtitle;
    }, [enableViewModeToggle, viewMode, subtitle, t]);
    const addNewText = externalAddNewText || t('auto_yeni_ekle', 'Yeni Ekle');
    const emptyMessage = useMemo(() => {
        if (enableViewModeToggle) {
            if (viewMode === 'trash') {
                return t('auto_cop_kutusu_bos_genel', 'Çöp kutusunda silinmiş kayıt bulunamadı.');
            }
            if (viewMode === 'archive') {
                return t('auto_cop_kutusu_bos_arsiv', 'Arşivde kayıt bulunamadı.');
            }
        }
        return externalEmptyMessage || t('auto_kayit_bulunamadi', 'Kayıt bulunamadı.');
    }, [enableViewModeToggle, viewMode, externalEmptyMessage, t]);
    const itemNameResolver = externalItemNameResolver || ((item: T) => (item as any)?.ad || (item as any)?.unvan || (item as any)?.isim || (item as any)?.firmaAdi || (item as any)?.kod || t('auto_kayit', 'Kayıt'));
    const listRef = useRef<HTMLDivElement>(null);
    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(false);
    const [internalRefreshKey, setInternalRefreshKey] = useState(0);
    const refreshKey = externalRefreshKey + internalRefreshKey;
    const setRefreshKey = useCallback((updater: number | ((prev: number) => number)) => {
        setInternalRefreshKey(updater);
    }, []);

    const handleViewModeChange = useCallback((mode: 'active' | 'archive' | 'trash') => {
        setViewMode(mode);
        if (onViewModeChange) {
            onViewModeChange(mode);
        }
        setRefreshKey(prev => prev + 1);
    }, [onViewModeChange, setRefreshKey]);
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [alertDialog, setAlertDialog] = useState<{
        isOpen: boolean;
        type: 'info' | 'confirm' | 'error' | 'warning' | 'success';
        title: string;
        message: string;
        onConfirm: (() => void) | null;
        confirmText: string;
        showCancel?: boolean;
        cancelText?: string;
    }>({ isOpen: false, type: 'info', title: '', message: '', onConfirm: null, confirmText: 'Tamam', showCancel: false, cancelText: 'İptal' });

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [menuCoords, setMenuCoords] = useState<{ bottom: number, right: number }>({ bottom: 80, right: 24 });
    const fabContainerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const updateMenuCoords = useCallback(() => {
        if (fabContainerRef.current) {
            const rect = fabContainerRef.current.getBoundingClientRect();
            setMenuCoords({
                bottom: window.innerHeight - rect.top + 8,
                right: window.innerWidth - rect.right
            });
        }
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const isOutsideContainer = fabContainerRef.current && !fabContainerRef.current.contains(event.target as Node);
            const isOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(event.target as Node);
            if (isOutsideContainer && isOutsideDropdown) {
                setIsMenuOpen(false);
            }
        };

        const handleScrollOrResize = () => {
            if (isMenuOpen) {
                setIsMenuOpen(false);
            }
        };

        if (isMenuOpen) {
            updateMenuCoords();
            document.addEventListener('mousedown', handleClickOutside);
            window.addEventListener('scroll', handleScrollOrResize, true);
            window.addEventListener('resize', handleScrollOrResize);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [isMenuOpen, updateMenuCoords]);

    const fetchParamsStr = JSON.stringify(fetchParams);

    const getInitialGlobalSearchData = useCallback(() => {
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
    }, []);

    const [globalSearchData, setGlobalSearchData] = useState(getInitialGlobalSearchData);
    const globalSearchDataRef = useRef(globalSearchData);
    const getInitialGlobalSearchDataRef = useRef(getInitialGlobalSearchData);

    useEffect(() => {
        getInitialGlobalSearchDataRef.current = getInitialGlobalSearchData;
    }, [getInitialGlobalSearchData]);

    useEffect(() => {
        globalSearchDataRef.current = globalSearchData;
    }, [globalSearchData]);

    const handleFetchData = useCallback(async (paramsObj = {}) => {
        const page = paramsObj.page || 1;
        const size = paramsObj.pageSize || pageSize || 50;

        let parsedFetchParams: Record<string, any> = {};
        try {
            parsedFetchParams = JSON.parse(fetchParamsStr);
        } catch (e) {
            parsedFetchParams = {};
        }

        const queryParams: Record<string, any> = {
            page,
            pageSize: size,
            sayfa: page,
            sayfaBoyutu: size,
            ...parsedFetchParams
        };

        if (enableViewModeToggle) {
            queryParams.silinmisleriGetir = viewMode === 'trash';
            queryParams.silinenler = viewMode === 'trash';
            queryParams.arsivdekiler = viewMode === 'archive';
        }

        const effectiveSortField = paramsObj.sortField || defaultSortField;
        const effectiveSortOrder = paramsObj.sortOrder || defaultSortOrder || 'desc';

        if (effectiveSortField) {
            queryParams.sortField = effectiveSortField;
            queryParams.sortOrder = effectiveSortOrder;
            queryParams.sirala = effectiveSortField;
            queryParams.yon = effectiveSortOrder;
        } else {
            queryParams.sortOrder = effectiveSortOrder;
            queryParams.yon = effectiveSortOrder;
        }

        const effectiveArama = paramsObj.aramaData || globalSearchDataRef.current || (getInitialGlobalSearchDataRef.current ? getInitialGlobalSearchDataRef.current() : { type: 'Tumu', value: '', startDate: '', endDate: '' });

        if (effectiveArama && effectiveArama.value) {
            queryParams.aramaKelimesi = effectiveArama.value;
            queryParams.arama = effectiveArama.value;
            if (effectiveArama.type && effectiveArama.type !== 'Tumu') {
                queryParams.aramaTipi = effectiveArama.type;
                queryParams.tip = effectiveArama.type;
                const typeKey = effectiveArama.type.charAt(0).toLowerCase() + effectiveArama.type.slice(1);
                queryParams[typeKey] = effectiveArama.value;
                if (typeKey === 'grup') {
                    queryParams.grupAdi = effectiveArama.value;
                }
            }
        }

        if (effectiveArama?.startDate) {
            queryParams.baslangicTarihi = effectiveArama.startDate;
            queryParams.startDate = effectiveArama.startDate;
        }
        if (effectiveArama?.endDate) {
            queryParams.bitisTarihi = effectiveArama.endDate;
            queryParams.endDate = effectiveArama.endDate;
        }

        const injectDraftTemplateIfApplicable = (result: { data: T[]; totalCount?: number }) => {
            if (page === 1 && (!enableViewModeToggle || viewMode === 'active')) {
                const draft = getStoredDraft(baseRoute, aiDocumentType);
                if (draft) {
                    const rawData = draft.formData || draft;
                    const draftRow: any = {
                        ...rawData,
                        id: '__draft_template__',
                        _isDraftTemplate: true,
                        _draftData: draft
                    };
                    const currentItems = result.data || [];
                    if (!currentItems.some((x: any) => (x as any)?._isDraftTemplate)) {
                        result.data = [draftRow, ...currentItems];
                        if (typeof result.totalCount === 'number') {
                            result.totalCount += 1;
                        }
                    }
                }
            }
            return result;
        };

        // 1. customFetchData verildiyse (öncelikli: geliştirici özel getirme mantığı tanımlamış)
        if (customFetchData) {
            setLoading(true);
            try {
                const res = await customFetchData({ ...paramsObj, page, pageSize: size, queryParams });
                setLoading(false);
                return injectDraftTemplateIfApplicable(normalizeListResponse<T>(res));
            } catch (err) {
                setLoading(false);
                toast.error(t('auto_kayitlar_yuklenemedi', 'Kayıtlar yüklenemedi.'));
                return { data: [] };
            }
        }

        // 2. service prop'u verildiyse
        if (service && typeof service.getAll === 'function') {
            setLoading(true);
            try {
                const res = await service.getAll(queryParams);
                setLoading(false);
                return injectDraftTemplateIfApplicable(normalizeListResponse<T>(res));
            } catch (err) {
                setLoading(false);
                toast.error(t('auto_kayitlar_yuklenemedi', 'Kayıtlar yüklenemedi.'));
                return { data: [] };
            }
        }

        // 3. apiEndpoint verildiyse
        if (!apiEndpoint) return { data: [] };

        const params = new URLSearchParams();
        Object.entries(queryParams).forEach(([key, val]) => {
            if (val !== undefined && val !== null && val !== '') {
                params.append(key, String(val));
            }
        });

        try {
            setLoading(true);
            const res = await axios.get(`${apiEndpoint}?${params.toString()}`);
            setLoading(false);
            return injectDraftTemplateIfApplicable(normalizeListResponse<T>(res.data));
        } catch (err) {
            setLoading(false);
            if (apiEndpoint) toast.error(t('auto_kayitlar_yuklenemedi', 'Kayıtlar yüklenemedi.'));
            return { data: [] };
        }
    }, [apiEndpoint, fetchParamsStr, customFetchData, service, pageSize, enableViewModeToggle, viewMode, baseRoute, aiDocumentType, t]);

    useEffect(() => {
        if (customRenderContent && (apiEndpoint || customFetchData || service)) {
            handleFetchData().then(res => setData(res?.data || []));
        }
    }, [customRenderContent, handleFetchData, refreshKey, apiEndpoint, customFetchData, service]);

    useEffect(() => {
        const handleRefresh = () => setRefreshKey(prev => prev + 1);
        window.addEventListener('refresh-list', handleRefresh);
        window.addEventListener('document-draft-updated', handleRefresh);
        window.addEventListener('document-draft-cleared', handleRefresh);
        return () => {
            window.removeEventListener('refresh-list', handleRefresh);
            window.removeEventListener('document-draft-updated', handleRefresh);
            window.removeEventListener('document-draft-cleared', handleRefresh);
        };
    }, []);

    useEffect(() => {
        if (!customRenderContent) return;

        const handleGlobalSearch = (e: any) => {
            const searchData = e.detail || { type: 'Tumu', value: '', startDate: '', endDate: '' };
            setGlobalSearchData(searchData);
            if (apiEndpoint || customFetchData || service) {
                handleFetchData({ aramaData: searchData }).then(res => setData(res?.data || []));
            }
        };

        window.addEventListener('global-search', handleGlobalSearch);
        return () => window.removeEventListener('global-search', handleGlobalSearch);
    }, [Boolean(customRenderContent), apiEndpoint, customFetchData, service, handleFetchData]);

    const searchableFieldsJson = JSON.stringify(searchableFields || []);
    useEffect(() => {
        if (!customRenderContent) return;

        if (searchableFields && searchableFields.length > 0) {
            window.dispatchEvent(new CustomEvent('register-search-fields', { detail: searchableFields }));
        }
        return () => {
            if (searchableFields && searchableFields.length > 0) {
                window.dispatchEvent(new CustomEvent('register-search-fields', { detail: [] }));
            }
        };
    }, [Boolean(customRenderContent), searchableFieldsJson]);

    const { highlightedId, triggerAction } = useInternalTableAction();

    const handleEdit = useCallback((item: T, e?: React.MouseEvent) => {
        if ((item as any)?._isDraftTemplate) {
            const draftData = (item as any)._draftData || item;
            const targetUrl = `${baseRoute || ''}/yeni`;
            if (e && e.shiftKey) {
                window.open(targetUrl, '_blank');
            } else {
                navigate(targetUrl, {
                    state: {
                        isDraftTemplate: true,
                        currentFormData: draftData,
                        returnUrl: baseRoute
                    }
                });
            }
            return;
        }

        const itemId = (item as any)?.id ?? (item as any)?.Id ?? (item as any)?.kod;
        if (itemId) {
            try {
                sessionStorage.setItem(listStorageKey, String(itemId));
            } catch (err) {}
        }
        if (onEdit) return onEdit(item, e);
        if (baseRoute) navigate(`${baseRoute}/${(item as any).id}`, { state: { item } });
    }, [onEdit, baseRoute, navigate, listStorageKey]);

    const handleAddNew = useCallback(() => {
        if (onAddNew) return onAddNew();
        if (baseRoute) navigate(`${baseRoute}/yeni`, { state: { isNewFresh: true } });
    }, [onAddNew, baseRoute, navigate]);

    const handleAiSuccess = useCallback((aiData: any) => {
        if (onAiSuccess) {
            onAiSuccess(aiData);
        } else if (baseRoute) {
            navigate(`${baseRoute}/yeni`, { state: { initialAiData: aiData } });
        }
    }, [onAiSuccess, baseRoute, navigate]);

    // ✨ Undoable Optimistic Deletion Architecture
    const [hiddenRowIds, setHiddenRowIds] = useState<(string | number)[]>([]);
    const [pendingDeletion, setPendingDeletion] = useState<{
        item: T;
        id: string | number;
        name: string;
        timerId: any;
    } | null>(null);
    const pendingDeletionRef = useRef(pendingDeletion);
    pendingDeletionRef.current = pendingDeletion;

    const commitPendingDeletion = useCallback(async (deletionToCommit = pendingDeletionRef.current) => {
        if (!deletionToCommit) return;
        const { id, timerId } = deletionToCommit;
        if (timerId) {
            clearTimeout(timerId);
        }
        setPendingDeletion(null);

        try {
            if (customDeleteData) {
                await customDeleteData(id);
            } else if (service && typeof service.delete === 'function') {
                await service.delete(id);
            } else if (apiEndpoint) {
                await axios.delete(`${apiEndpoint}/${id}`);
            }
            // Başarılı olduğunda hiddenRowIds'den kaldır ve listeyi yenile
            setHiddenRowIds(prev => prev.filter(x => String(x) !== String(id)));
            setRefreshKey(prev => prev + 1);
        } catch (err: any) {
            // Hata olursa: Rollback yap! Kaydı geri listeye getir ve hatayı bildir
            setHiddenRowIds(prev => prev.filter(x => String(x) !== String(id)));
            setAlertDialog({
                isOpen: true,
                type: 'error',
                title: t('auto_hata', 'Hata'),
                message: err?.response?.data?.message || err?.response?.data?.mesaj || err?.message || t('auto_silme_islemi_basarisiz_oldu', 'Silme işlemi başarısız oldu.'),
                onConfirm: null,
                confirmText: t('auto_tamam', 'Tamam')
            });
        }
    }, [customDeleteData, service, apiEndpoint, setRefreshKey, t]);

    const handleUndoDelete = useCallback(() => {
        const active = pendingDeletionRef.current;
        if (!active) return;
        if (active.timerId) {
            clearTimeout(active.timerId);
        }
        setPendingDeletion(null);
        setHiddenRowIds(prev => prev.filter(x => String(x) !== String(active.id)));
        toast.success(t('auto_silme_islemi_geri_alindi', 'Silme işlemi geri alındı.'));
    }, [t]);

    const handleDismissUndo = useCallback(() => {
        commitPendingDeletion();
    }, [commitPendingDeletion]);

    useEffect(() => {
        return () => {
            if (pendingDeletionRef.current) {
                commitPendingDeletion(pendingDeletionRef.current);
            }
        };
    }, [commitPendingDeletion]);

    const handleRestore = useCallback(async (item: T) => {
        const itemId = (item as any)?.id ?? (item as any)?.Id ?? (item as any)?.kod;
        if (itemId === undefined || itemId === null) return;
        try {
            if (service && typeof service.restore === 'function') {
                await service.restore(itemId);
            } else if (apiEndpoint) {
                await axios.put(`${apiEndpoint}/${itemId}/restore`);
            }
            toast.success(t('auto_kayit_geri_yuklendi', 'Kayıt başarıyla geri yüklendi.'));
            setRefreshKey(prev => prev + 1);
            window.dispatchEvent(new CustomEvent('refresh-list'));
        } catch (err: any) {
            toast.error(err?.response?.data?.message || err?.message || t('auto_hata_olustu', 'Geri yüklenirken hata oluştu.'));
        }
    }, [service, apiEndpoint, t, setRefreshKey]);

    const handleArchive = useCallback(async (item: T) => {
        const itemId = (item as any)?.id ?? (item as any)?.Id ?? (item as any)?.kod;
        if (itemId === undefined || itemId === null) return;
        try {
            if (onArchive) {
                await onArchive(item);
            } else if (service && typeof service.archive === 'function') {
                await service.archive(itemId);
            } else if (apiEndpoint) {
                await axios.put(`${apiEndpoint}/${itemId}/archive`);
            }
            toast.success(t('auto_kayit_arsivlendi', 'Kayıt başarıyla arşive alındı.'));
            setRefreshKey(prev => prev + 1);
            window.dispatchEvent(new CustomEvent('refresh-list'));
        } catch (err: any) {
            toast.error(err?.response?.data?.message || err?.message || t('auto_hata_olustu', 'Arşive alınırken hata oluştu.'));
        }
    }, [onArchive, service, apiEndpoint, t, setRefreshKey]);

    const handleUnarchive = useCallback(async (item: T) => {
        const itemId = (item as any)?.id ?? (item as any)?.Id ?? (item as any)?.kod;
        if (itemId === undefined || itemId === null) return;
        try {
            if (onUnarchive) {
                await onUnarchive(item);
            } else if (service && typeof service.unarchive === 'function') {
                await service.unarchive(itemId);
            } else if (apiEndpoint) {
                await axios.put(`${apiEndpoint}/${itemId}/unarchive`);
            }
            toast.success(t('auto_kayit_arsivden_cikarildi', 'Kayıt arşivden çıkarıldı.'));
            setRefreshKey(prev => prev + 1);
            window.dispatchEvent(new CustomEvent('refresh-list'));
        } catch (err: any) {
            toast.error(err?.response?.data?.message || err?.message || t('auto_hata_olustu', 'Arşivden çıkarılırken hata oluştu.'));
        }
    }, [onUnarchive, service, apiEndpoint, t, setRefreshKey]);

    const handleDelete = useCallback(async (item: T) => {
        if ((item as any)?._isDraftTemplate) {
            clearStoredDraft(baseRoute, aiDocumentType);
            setRefreshKey(prev => prev + 1);
            toast.success(t('auto_sablon_silindi', 'Şablon başarıyla temizlendi.'));
            return;
        }

        if (onDelete) return onDelete(item);
        const itemId = (item as any)?.id ?? (item as any)?.Id ?? (item as any)?.kod;
        if (itemId === undefined || itemId === null) return;

        // 1. Önceki bekleyen silme varsa hemen commit et
        if (pendingDeletionRef.current) {
            await commitPendingDeletion(pendingDeletionRef.current);
        }

        // 2. Pre-Deletion Validation (Ön Doğrulama Fonksiyonu)
        let validationResult: any = true;
        try {
            if (typeof externalCanDelete === 'function') {
                validationResult = await externalCanDelete(item);
            } else if (service && typeof service.canDelete === 'function') {
                validationResult = await service.canDelete(itemId);
            }
        } catch (valErr: any) {
            validationResult = {
                canDelete: false,
                message: valErr?.response?.data?.message || valErr?.message || t('auto_bu_kayit_silinemez', 'Bu kayıt silinmeye uygun değil.')
            };
        }

        const isAllowed = typeof validationResult === 'boolean'
            ? validationResult
            : (validationResult?.canDelete ?? true);

        if (!isAllowed) {
            const failMsg = typeof validationResult === 'object' && validationResult?.message
                ? validationResult.message
                : t('auto_bu_kayit_silinemez', 'Bu kayıt sistem kuralları gereği silinemez.');

            const canArchive = enableArchive !== false && (typeof onArchive === 'function' || (service && typeof service.archive === 'function') || Boolean(apiEndpoint));

            if (canArchive) {
                setAlertDialog({
                    isOpen: true,
                    type: 'warning',
                    title: t('auto_silme_engellendi', 'Silme İşlemi Engellendi'),
                    message: `${failMsg}\n\n${t('auto_arsive_alinsin_mi_soru', 'Bu kayıt sistem kuralları gereği (hareket gördüğü için) silinemez. Bunun yerine kaydı arşive almak ister misiniz?')}`,
                    showCancel: true,
                    cancelText: t('auto_vazgec', 'Vazgeç'),
                    confirmText: t('auto_arsive_al', 'Arşive Al'),
                    onConfirm: async () => {
                        setAlertDialog(prev => ({ ...prev, isOpen: false }));
                        await handleArchive(item);
                    }
                });
            } else {
                setAlertDialog({
                    isOpen: true,
                    type: 'warning',
                    title: t('auto_silme_engellendi', 'Silme İşlemi Engellendi'),
                    message: failMsg,
                    showCancel: false,
                    confirmText: t('auto_tamam', 'Tamam'),
                    onConfirm: null
                });
            }
            return;
        }

        const name = itemNameResolver(item);

        // 3. Undo devre dışı bırakılmışsa klasik diyalog
        if (enableUndoDelete === false) {
            setAlertDialog({
                isOpen: true,
                type: 'confirm',
                title: t('auto_kayit_silinecek', 'Kayıt Silinecek'),
                message: t('auto_kaydini_silmek_istediginize_emin_misiniz', `'${name}' kaydını silmek istediğinize emin misiniz? Bu işlem kalıcıdır.`, { name }),
                confirmText: t('auto_evet_sil', 'Evet, Sil'),
                onConfirm: async () => {
                    setAlertDialog(prev => ({ ...prev, isOpen: false }));
                    try {
                        if (customDeleteData) {
                            await customDeleteData(itemId);
                        } else if (service && typeof service.delete === 'function') {
                            await service.delete(itemId);
                        } else if (apiEndpoint) {
                            await axios.delete(`${apiEndpoint}/${itemId}`);
                        }
                        setRefreshKey(prev => prev + 1);
                        toast.success(t('auto_kayit_silindi', 'Kayıt silindi.'));
                    } catch (err: any) {
                        setAlertDialog({
                            isOpen: true,
                            type: 'error',
                            title: t('auto_hata', 'Hata'),
                            message: err?.response?.data?.message || err?.response?.data?.mesaj || err?.message || t('auto_silme_islemi_basarisiz_oldu', 'Silme işlemi başarısız oldu.'),
                            onConfirm: null,
                            confirmText: t('auto_tamam', 'Tamam')
                        });
                    }
                }
            });
            return;
        }

        // 4. Undoable Optimistic Deletion: Kaydı anında listeden gizle!
        setHiddenRowIds(prev => [...prev, itemId]);

        const duration = undoDurationMs || 4000;
        const timerId = setTimeout(() => {
            commitPendingDeletion();
        }, duration);

        setPendingDeletion({
            item,
            id: itemId,
            name,
            timerId
        });
    }, [onDelete, externalCanDelete, service, itemNameResolver, enableUndoDelete, undoDurationMs, commitPendingDeletion, customDeleteData, apiEndpoint, t, setRefreshKey]);

    const effectiveDisableAdd = disableAdd || (enableViewModeToggle && viewMode !== 'active');
    const effectiveDisableEdit = disableEdit || (enableViewModeToggle && viewMode !== 'active');
    const effectiveDisableDelete = disableDelete || (enableViewModeToggle && viewMode === 'trash');

    /**
     * Sütunların en sağına otomatik olarak ActionMenu (Düzenle/Sil/Özel işlemler) kolonunu ekler.
     */
    const finalColumns = useMemo(() => {
        if (!columns || columns.length === 0) return columns;

        // Taslak / Şablon rozetinin gösterileceği birincil kimlik kolonunu tespit et
        const identifierColIndex = columns.findIndex((col: any) => {
            const key = String(col.accessor || col.id || '').toLowerCase();
            return ['belgeno', 'kod', 'no', 'fisno', 'unvan', 'ad', 'baslik'].includes(key);
        });
        const targetBadgeIndex = identifierColIndex !== -1 ? identifierColIndex : 0;

        const wrappedColumns = columns.map((col: any, index: number) => {
            if (index !== targetBadgeIndex) return col;

            return {
                ...col,
                render: (row: T, rowIndex: number, tableActions: any) => {
                    const originalContent = col.render 
                        ? col.render(row, rowIndex, tableActions) 
                        : (row as any)?.[col.accessor || col.id || ''];

                    if ((row as any)?._isDraftTemplate) {
                        return (
                            <div className="flex items-center gap-8">
                                <span className="chip chip-warning draft-template-badge" title={t('auto_kaydedilmemis_sablon', 'Kaydedilmemiş Şablon')}>
                                    <FileEdit size={12} />
                                    <span>{t('auto_sablon', 'Şablon')}</span>
                                </span>
                                <span>{originalContent || (row as any)?.belgeNo || (row as any)?.kod || ''}</span>
                            </div>
                        );
                    }

                    return originalContent;
                }
            };
        });

        // Kullanıcı varsayılan eylemlerin eklenmesini istemediyse
        if (hideDefaultActions) return wrappedColumns;

        // Zaten actions kolonu elle tanımlanmışsa mükerrer ekleme
        const hasActionsCol = wrappedColumns.some((col: any) => 
            col.id === 'actions' || col.id === 'action' || col.id === 'islemler' || col.id === 'islem' ||
            col.accessor === 'actions' || col.accessor === 'action' || col.accessor === 'islemler' || col.accessor === 'islem'
        );
        if (hasActionsCol) return wrappedColumns;

        const actionsColumn = {
            id: 'actions',
            header: '',
            width: '60px',
            align: 'center' as const,
            sortable: false,
            render: (row: T, index: number, tableActions: any) => {
                if ((row as any)?._isDraftTemplate) {
                    return (
                        <ActionMenu
                            actions={[
                                {
                                    label: t('auto_duzenle', 'Düzenle'),
                                    icon: <Edit2 size={16} />,
                                    isDefault: true,
                                    default: true,
                                    onClick: (e: any) => {
                                        if (tableActions?.handleEdit) {
                                            tableActions.handleEdit(row, e);
                                        } else {
                                            handleEdit(row, e);
                                        }
                                    }
                                },
                                {
                                    label: t('auto_sil', 'Sil'),
                                    icon: <Trash2 size={16} />,
                                    danger: true,
                                    onClick: () => {
                                        if (tableActions?.handleDelete) {
                                            tableActions.handleDelete(row);
                                        } else {
                                            handleDelete(row);
                                        }
                                    }
                                }
                            ]}
                        />
                    );
                }

                const isDeleted = Boolean((row as any)?.silindiMi) || (enableViewModeToggle && viewMode === 'trash');
                const isArchived = Boolean((row as any)?.arsivlendiMi) || (enableViewModeToggle && viewMode === 'archive');

                if (isDeleted) {
                    return (
                        <ActionMenu
                            actions={[
                                {
                                    label: t('auto_geri_yukle', 'Geri Yükle'),
                                    icon: <RotateCcw size={16} />,
                                    isDefault: true,
                                    default: true,
                                    onClick: () => handleRestore(row)
                                }
                            ]}
                        />
                    );
                }

                if (isArchived) {
                    return (
                        <ActionMenu
                            actions={[
                                {
                                    label: t('auto_arsivden_cikar', 'Arşivden Çıkar'),
                                    icon: <RotateCcw size={16} />,
                                    isDefault: true,
                                    default: true,
                                    onClick: () => handleUnarchive(row)
                                },
                                ...(!effectiveDisableDelete ? [{
                                    label: t('auto_sil', 'Sil'),
                                    icon: <Trash2 size={16} />,
                                    danger: true,
                                    onClick: () => {
                                        if (tableActions?.handleDelete) {
                                            tableActions.handleDelete(row);
                                        } else {
                                            handleDelete(row);
                                        }
                                    }
                                }] : [])
                            ]}
                        />
                    );
                }

                const rowActions: ActionMenuItem[] = [];

                // Özel satır aksiyonları varsa önce onları ekle
                if (customRowActions) {
                    const extra = customRowActions(row, tableActions);
                    if (extra && extra.length > 0) {
                        rowActions.push(...extra);
                    }
                }

                // Düzenleme aksiyonu
                if (!effectiveDisableEdit) {
                    rowActions.push({
                        label: t('auto_duzenle', 'Düzenle'),
                        icon: <Edit2 size={16} />,
                        isDefault: true,
                        default: true,
                        onClick: (e: any) => {
                            if (tableActions?.handleEdit) {
                                tableActions.handleEdit(row, e);
                            } else {
                                handleEdit(row, e);
                            }
                        }
                    });
                }

                // Arşive Alma aksiyonu
                const canArchive = enableArchive !== false && (typeof onArchive === 'function' || (service && typeof service.archive === 'function') || Boolean(apiEndpoint));
                if (canArchive) {
                    rowActions.push({
                        label: t('auto_arsive_al', 'Arşive Al'),
                        icon: <Archive size={16} />,
                        onClick: () => handleArchive(row)
                    });
                }

                // Silme aksiyonu
                if (!effectiveDisableDelete) {
                    rowActions.push({
                        label: t('auto_sil', 'Sil'),
                        icon: <Trash2 size={16} />,
                        onClick: () => {
                            if (tableActions?.handleDelete) {
                                tableActions.handleDelete(row);
                            } else {
                                handleDelete(row);
                            }
                        },
                        danger: true
                    });
                }

                if (rowActions.length === 0) return null;

                return <ActionMenu actions={rowActions} />;
            }
        };

        return [...wrappedColumns, actionsColumn];
    }, [columns, hideDefaultActions, effectiveDisableEdit, effectiveDisableDelete, enableViewModeToggle, viewMode, customRowActions, handleEdit, handleDelete, handleArchive, handleUnarchive, handleRestore, enableArchive, onArchive, service, apiEndpoint, t]);

    const handleRowDoubleClickRef = useRef<(item: T, e?: any) => void>();

    const { selectedIndex, setSelectedIndex } = useInternalTableNavigation({
        data,
        isActive: true,
        highlightedId,
        storageKey: listStorageKey,
        initialSelectedId: (location.state as any)?.selectedId || null,
        onEdit: (item: T, e?: any) => handleRowDoubleClickRef.current && handleRowDoubleClickRef.current(item, e),
        onAddNew: !disableAdd ? handleAddNew : undefined,
        onDelete: handleDelete
    });

    const handleRowDoubleClick = useCallback((item: T, e?: any) => {
        // 1. Liste öğesine çift tıklandığında hem seçilsin:
        const targetIndex = data.findIndex(i => ((i as any)?.id ?? (i as any)?.Id ?? (i as any)?.kod) === ((item as any)?.id ?? (item as any)?.Id ?? (item as any)?.kod));
        if (targetIndex !== -1) {
            setSelectedIndex(targetIndex);
        }

        const itemId = (item as any)?.id ?? (item as any)?.Id ?? (item as any)?.kod;
        if (itemId && listStorageKey) {
            try {
                sessionStorage.setItem(listStorageKey, String(itemId));
            } catch (err) {}
        }

        // 2. Action menü üzerinde bulunan seçeneklerden varsayılan seçenek çalıştırılsın:
        const actionsCol = finalColumns.find((col: any) => 
            col.id === 'actions' || col.id === 'action' || col.id === 'islemler' || col.id === 'islem' ||
            col.accessor === 'actions' || col.accessor === 'action' || col.accessor === 'islemler' || col.accessor === 'islem'
        );

        let executed = false;
        if (actionsCol && typeof actionsCol.render === 'function') {
            try {
                const rendered = actionsCol.render(item, targetIndex !== -1 ? targetIndex : 0, { handleEdit, handleDelete });
                let actions: ActionMenuItem[] | undefined = rendered?.props?.actions;
                if (!actions && rendered?.props?.children) {
                    React.Children.forEach(rendered.props.children, (child: any) => {
                        if (child?.props?.actions) {
                            actions = child.props.actions;
                        }
                    });
                }

                if (Array.isArray(actions) && actions.length > 0) {
                    // Varsayılan seçenek önceliği:
                    // 1. isDefault: true veya default: true olan seçenek
                    // 2. 'Düzenle' veya 'Edit' etiketli seçenek
                    // 3. Tehlikeli (danger) olmayan ilk seçenek
                    const defaultAction = actions.find(a => a && (a.isDefault || a.default))
                        || actions.find(a => a && !a.danger && (
                            a.label === t('Düzenle') || 
                            a.label === t('auto_duzenle', 'Düzenle') || 
                            String(a.label).toLowerCase().includes('düzenle') || 
                            String(a.label).toLowerCase().includes('edit')
                        ))
                        || actions.find(a => a && !a.danger);

                    if (defaultAction && typeof defaultAction.onClick === 'function') {
                        defaultAction.onClick(e);
                        executed = true;
                    }
                }
            } catch (err) {
                console.error('BaseListPage default action resolution error:', err);
            }
        }

        // Eğer aksiyon menüsünden bir şey çalıştırılamadıysa standart handleEdit fallback
        if (!executed) {
            handleEdit(item, e);
        }
    }, [data, finalColumns, listStorageKey, setSelectedIndex, handleEdit, handleDelete, t]);

    const handleRowClick = useCallback((item: T) => {
        setSelectedIndex(data.findIndex(i => ((i as any)?.id ?? (i as any)?.Id ?? (i as any)?.kod) === ((item as any)?.id ?? (item as any)?.Id ?? (item as any)?.kod)));
    }, [data, setSelectedIndex]);

    const getRowClassName = useCallback((item: T, index: number) => {
        const isSelected = index === selectedIndex;
        const isHighlighted = ((item as any)?.id ?? (item as any)?.Id ?? (item as any)?.kod) === highlightedId;
        const isDraft = Boolean((item as any)?._isDraftTemplate);
        return `${isSelected ? 'row-selected' : ''} ${isHighlighted ? 'row-highlighted' : ''} ${isDraft ? 'row-draft-template' : ''}`.trim();
    }, [selectedIndex, highlightedId]);

    const tableActions = useMemo(() => ({
        handleEdit,
        handleDelete,
        handleDefaultAction: handleRowDoubleClick
    }), [handleEdit, handleDelete, handleRowDoubleClick]);

    const listHeaderActionMenu = useMemo(() => {
        if (customActionMenu !== undefined) return customActionMenu;
        const visibleExtra = (extraDropdownActions || []).filter(a => a && !a.hidden);
        if (visibleExtra.length > 0 || onActionMenuTriggerClick) {
            return (
                <ActionMenu
                    showDefaultActionAsButton={true}
                    triggerLabel={actionMenuTrigger}
                    onTriggerLabelClick={onActionMenuTriggerClick}
                    dropdownHeader={actionMenuDropdownHeader}
                    actions={visibleExtra}
                />
            );
        }
        return null;
    }, [customActionMenu, extraDropdownActions, actionMenuTrigger, onActionMenuTriggerClick, actionMenuDropdownHeader]);

    const headerActionsToRender = useMemo(() => {
        if (!enableViewModeToggle && !customHeaderActions && !listHeaderActionMenu) return undefined;

        return (
            <div className="base-list-header-actions flex items-center gap-8">
                {enableViewModeToggle && (
                    <div className="view-mode-segmented-track" role="group" aria-label={t('auto_gorunum_modu', 'Görünüm Modu')}>
                        <button
                            type="button"
                            className={`view-mode-segment-btn ${viewMode === 'active' ? 'active mode-active' : ''}`}
                            onClick={() => handleViewModeChange('active')}
                            title={t('auto_aktif_kayitlar', 'Aktif Kayıtlar')}
                            aria-label={t('auto_aktif_kayitlar', 'Aktif Kayıtlar')}
                            aria-pressed={viewMode === 'active'}
                        >
                            <Layers size={14} />
                            <span className="segment-label">{t('auto_aktif_18de', 'Aktif')}</span>
                        </button>
                        {enableArchive !== false && (
                            <button
                                type="button"
                                className={`view-mode-segment-btn ${viewMode === 'archive' ? 'active mode-archive' : ''}`}
                                onClick={() => handleViewModeChange('archive')}
                                title={t('auto_arsivdekileri_goster', 'Arşivdekileri Göster')}
                                aria-label={t('auto_arsivdekileri_goster', 'Arşivdekileri Göster')}
                                aria-pressed={viewMode === 'archive'}
                            >
                                <Archive size={14} />
                                <span className="segment-label">{t('auto_arsiv', 'Arşiv')}</span>
                            </button>
                        )}
                        <button
                            type="button"
                            className={`view-mode-segment-btn ${viewMode === 'trash' ? 'active mode-trash' : ''}`}
                            onClick={() => handleViewModeChange('trash')}
                            title={t('auto_cop_kutusu', 'Çöp Kutusu')}
                            aria-label={t('auto_cop_kutusu', 'Çöp Kutusu')}
                            aria-pressed={viewMode === 'trash'}
                        >
                            <Trash2 size={14} />
                            <span className="segment-label">{t('auto_cop_kutusu', 'Çöp Kutusu')}</span>
                        </button>
                    </div>
                )}
                {customHeaderActions}
                {listHeaderActionMenu}
            </div>
        );
    }, [enableViewModeToggle, customHeaderActions, listHeaderActionMenu, viewMode, enableArchive, handleViewModeChange, t]);

    return (
        <div 
            className={`base-list-page ${containerClassName}`} 
            ref={listRef}
        >
            {!hideHeader && (
                <BaseCardPageHeader
                    title={title}
                    subtitle={headerSubtitleToRender}
                    subtitleLeft={subtitleLeft}
                    subtitleRight={subtitleRight}
                    icon={headerIconToRender}
                    actions={headerActionsToRender}
                    breadcrumb={breadcrumb}
                    className="w-full"
                    {...headerProps}
                />
            )}

            <div className="table-container">
                {customRenderContent ? (
                    customRenderContent({ 
                        data, 
                        loading, 
                        refreshKey, 
                        setRefreshKey, 
                        handleEdit, 
                        handleDelete,
                        handleDefaultAction: handleRowDoubleClick,
                        searchData: globalSearchData,
                        searchTerm: globalSearchData.value,
                        searchType: globalSearchData.type
                    })
                ) : (
                    <DataTable 
                        columns={finalColumns}
                        fetchData={handleFetchData}
                        searchableFields={searchableFields}
                        pageSize={pageSize}
                        onDataChange={setData}
                        refreshKey={refreshKey}
                        hiddenRowIds={hiddenRowIds}
                        onRowClick={handleRowClick}
                        onRowDoubleClick={handleRowDoubleClick}
                        rowClassName={getRowClassName}
                        emptyMessage={emptyMessage}
                        mobileCardRender={mobileCardRender}
                        tableActions={tableActions}
                        enableColumnManagement={enableColumnManagement}
                        stickyActionColumn={stickyActionColumn}
                        defaultSortField={defaultSortField}
                        defaultSortOrder={defaultSortOrder}
                    />
                )}
            </div>

            {!effectiveDisableAdd && (
                customAddButton ? (
                    customAddButton
                ) : addMenuItems && addMenuItems.length > 1 ? (
                    <div ref={fabContainerRef} style={{ position: 'fixed', bottom: '48px', right: '48px', zIndex: 50 }}>
                        <BaseFloatCircleButton
                            icon={Plus}
                            position="relative"
                            useShadow={useAddButtonShadow}
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsMenuOpen(prev => !prev);
                            }}
                            title={addNewText}
                            aria-label={addNewText}
                        />
                        {isMenuOpen && createPortal(
                            <div
                                ref={dropdownRef}
                                className="custom-card shadow-lg animate-in"
                                style={{
                                    position: 'fixed',
                                    bottom: menuCoords.bottom,
                                    right: menuCoords.right,
                                    zIndex: 9999,
                                    minWidth: '200px',
                                    padding: '6px',
                                    borderRadius: 'var(--border-radius-md, 8px)',
                                    backgroundColor: 'var(--bg-primary, #ffffff)',
                                    border: '1px solid var(--border-glass, #e2e8f0)',
                                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '2px'
                                }}
                            >
                                {addMenuItems.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="btn btn-ghost"
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            width: '100%',
                                            textAlign: 'left',
                                            padding: '8px 12px',
                                            borderRadius: '6px',
                                            fontSize: '13px',
                                            fontWeight: 500,
                                            color: 'var(--text-primary)',
                                            border: 'none',
                                            background: 'transparent',
                                            cursor: 'pointer',
                                            justifyContent: 'flex-start'
                                        }}
                                        onClick={(e) => {
                                            setIsMenuOpen(false);
                                            item.onClick(e);
                                        }}
                                    >
                                        {item.icon && <span style={{ display: 'flex', alignItems: 'center' }}>{item.icon}</span>}
                                        <span>{item.label}</span>
                                    </button>
                                ))}
                            </div>,
                            document.body
                        )}
                    </div>
                ) : (
                    <EkleFloatCircleButton
                        position="fixed-bottom-right"
                        useShadow={useAddButtonShadow}
                        onClick={handleAddNew}
                        title={addNewText}
                    />
                )
            )}

            <AlertDialog 
                isOpen={alertDialog.isOpen}
                onClose={() => setAlertDialog(prev => ({ ...prev, isOpen: false }))}
                type={alertDialog.type}
                title={alertDialog.title}
                message={alertDialog.message}
                onConfirm={alertDialog.onConfirm}
                confirmText={alertDialog.confirmText}
                showCancel={alertDialog.showCancel}
                cancelText={alertDialog.cancelText}
            />

            {pendingDeletion && (
                <UndoDeleteBar
                    itemName={pendingDeletion.name}
                    duration={undoDurationMs || 4000}
                    onUndo={handleUndoDelete}
                    onDismiss={handleDismissUndo}
                />
            )}
        </div>
    );
};

export default BaseListPage;
