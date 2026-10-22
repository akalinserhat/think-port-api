/**
 * Akalin UI - BaseSystemPage (Sistem Ayarları Temel Sayfa İskeleti)
 * Sistem ayarları sayfaları (UI ve Admin UI) için standartlaştırılmış kart ızgarası ve modül detay altyapısı.
 * 
 * Yetenekleri:
 * - Ayar modüllerini modern, duyarlı ve hover animasyonlu kart ızgarasında (Grid) listeler.
 * - URL parametresi (:moduleId) veya seçili modül durumuna göre ilgili ayar formunu detay sayfası olarak render eder.
 * - Detay sayfasına geçildiğinde üst başlığı (useHeader) otomatik senkronize ederek Geri Butonu (BackButton) ve modül başlığını ekler.
 * - Genel arama (global-search event veya arama parametresi) filtrelemesini otomatik yönetir.
 * - Dinamik modül kayıtlarını ve özel render fonksiyonlarını (renderModuleContent / module.component) destekler.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Sliders, AlertCircle, RefreshCw } from 'lucide-react';
import { createSingletonContext } from '../../utils/createSingletonContext';
import { useTranslation } from 'react-i18next';
import BackButton from '../../components/button/BackButton';
import EkleFloatCircleButton from '../../components/button/EkleFloatCircleButton';
import { useHeaderApi } from '../../context/HeaderContext';
import SistemKart from '../../components/card/SistemKart';
import TabLayout, { BaseTabItem } from '../../components/tab/TabLayout';
import ActionMenu, { ActionMenuItem } from '../../components/menu/ActionMenu';
import { updateDocumentTitle } from '../../utils/domUtils';

export { type BaseTabItem, type ActionMenuItem };

export interface SystemSettingModule {
  id: string;
  name?: string;
  title?: string;
  desc?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  keywords?: string;
  hideHeader?: boolean;
  isList?: boolean;
  hasOwnLayout?: boolean;
  headerActions?: React.ReactNode;
  actions?: React.ReactNode;
  component?: React.ReactNode | React.ComponentType<any>;
  bilesenId?: string;
  tabs?: BaseTabItem[];
  activeTabId?: string | number;
  onTabChange?: (tabId: string | number) => void;
  // ActionMenu ve Başlık Aksiyonları
  onRefresh?: () => void;
  refreshLoading?: boolean;
  extraDropdownActions?: ActionMenuItem[];
  actionMenuTrigger?: React.ReactNode;
  actionMenuDropdownHeader?: React.ReactNode;
  onActionMenuTriggerClick?: (e: React.MouseEvent) => void;
  customActionMenu?: React.ReactNode;
  hideActionMenu?: boolean;
  [key: string]: any;
}

export interface BaseSystemPageSearchField {
  id: string;
  label: string;
  type?: string;
  placeholder?: string;
  iconName?: string;
}

export interface BaseSystemPageContextValue {
  /** Aktif genel arama terimi */
  searchTerm: string;
  /** Arama terimini manuel değiştirme/temizleme */
  setSearchTerm: (term: string) => void;
  /** Kullanıcı arama yapıyor mu? */
  isSearching: boolean;
  /** Aktif arama kriteri ('Tumu', 'Ad', 'Kod' vb.) */
  searchType: string;
  /** Aktif arama yer tutucu metni */
  searchPlaceholder: string;
  /** Verilen dizi öğelerini arama terimine göre Türkçe duyarlı filtreleyen yardımcı metot */
  filterItems: <T>(items: T[], getSearchableFields: (item: T) => (string | undefined | null)[]) => T[];
  /** Sekmeler */
  tabs?: BaseTabItem[];
  /** Sekmeleri dinamik olarak ayarlama */
  setTabs?: (tabs: BaseTabItem[] | null) => void;
  /** Aktif sekme ID'si */
  activeTabId?: string | number;
  /** Aktif sekmeyi değiştirme */
  setActiveTabId?: (id: string | number) => void;
}

export const BaseSystemPageContext = createSingletonContext<BaseSystemPageContextValue>(
  '__AKALIN_UI_BASE_SYSTEM_PAGE_CONTEXT__',
  {
    searchTerm: '',
    setSearchTerm: () => {},
    isSearching: false,
    searchType: 'Tumu',
    searchPlaceholder: '',
    filterItems: (items) => items,
    tabs: undefined,
    setTabs: () => {},
    activeTabId: undefined,
    setActiveTabId: () => {}
  },
  'BaseSystemPageContext'
);

/**
 * BaseSystemPage içerisindeki alt bileşenlerin Global Search arama durumuna ve
 * filtreleme metoduna reaktif olarak erişmesini sağlayan standart hook.
 */
export const useBaseSystemPage = () => useContext(BaseSystemPageContext);

export interface BaseSystemPageProps {
  title?: string;
  pageTitle?: string;
  subtitle?: string;
  description?: string;
  breadcrumb?: any;
  icon?: React.ReactNode;
  baseRoute?: string;
  modules?: SystemSettingModule[];
  selectedModuleId?: string | null;
  renderModuleContent?: (module: SystemSettingModule) => React.ReactNode;
  onModuleClick?: (moduleId: string) => void;
  searchTerm?: string;
  onSearchChange?: (term: string, type?: string) => void;
  searchPlaceholder?: string;
  searchableFields?: BaseSystemPageSearchField[];
  emptyMessage?: string;
  gridColumns?: string;
  hideHeader?: boolean;
  headerSync?: boolean;
  showBackButton?: boolean;
  backRoute?: string;
  onBack?: () => void;
  backTitle?: string;
  cardWrapperClassName?: string;
  detailWrapperClassName?: string;
  customHeaderActions?: React.ReactNode;
  headerActions?: React.ReactNode;
  // ActionMenu ve Başlık Aksiyonları
  onRefresh?: () => void;
  refreshLoading?: boolean;
  extraDropdownActions?: ActionMenuItem[];
  actionMenuTrigger?: React.ReactNode;
  actionMenuDropdownHeader?: React.ReactNode;
  onActionMenuTriggerClick?: (e: React.MouseEvent) => void;
  customActionMenu?: React.ReactNode;
  hideActionMenu?: boolean;
  renderContent?: (context: BaseSystemPageContextValue) => React.ReactNode;
  children?: React.ReactNode | ((context: BaseSystemPageContextValue) => React.ReactNode);

  // Hızlı Yeni Ekle Butonu Props
  onAdd?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  hideAddButton?: boolean;
  addButtonTitle?: string;
  addButtonPosition?: 'absolute-bottom-right' | 'fixed-bottom-right';

  // TabLayout Props
  tabs?: BaseTabItem[];
  activeTabId?: string | number;
  activeId?: string | number;
  defaultActiveTabId?: string | number;
  defaultActiveId?: string | number;
  onTabChange?: (tabId: string | number) => void;
  onChange?: (tabId: string | number) => void;
  hideIfSingleTab?: boolean;
  tabHeaderContent?: React.ReactNode;
  tabVariant?: 'primary' | 'secondary';
  tabClassName?: string;
  rightContent?: React.ReactNode;
}

const BaseSystemPage: React.FC<BaseSystemPageProps> = ({
  title = "Sistem Ayarları",
  subtitle = "Sistemin genel ayarlarını, entegrasyonlarını ve yapılandırmalarını buradan yönetin.",
  description,
  breadcrumb,
  icon,
  hideHeader = false,
  baseRoute = "/ayarlar/sistem-ayarlari",
  modules = [],
  selectedModuleId,
  renderModuleContent,
  onModuleClick,
  searchTerm: externalSearchTerm,
  searchPlaceholder = "Ayarlarda ara...",
  searchableFields,
  onSearchChange,
  emptyMessage = "Aramaya uygun ayar grubu bulunamadı.",
  gridColumns = "repeat(auto-fill, minmax(280px, 1fr))",
  headerSync = true,
  showBackButton = true,
  backRoute,
  onBack,
  backTitle,
  cardWrapperClassName = "fade-in flex flex-col flex-1 min-h-0 overflow-y-auto",
  detailWrapperClassName = "fade-in flex flex-col flex-1 min-h-0 overflow-y-auto",
  customHeaderActions,
  headerActions,
  onRefresh,
  refreshLoading,
  extraDropdownActions,
  actionMenuTrigger,
  actionMenuDropdownHeader,
  onActionMenuTriggerClick,
  customActionMenu,
  hideActionMenu = false,
  renderContent,
  children,
  onAdd,
  hideAddButton = false,
  addButtonTitle,
  addButtonPosition = 'absolute-bottom-right',
  tabs: propsTabs,
  activeTabId,
  activeId,
  defaultActiveTabId,
  defaultActiveId,
  onTabChange,
  onChange,
  hideIfSingleTab = true,
  tabHeaderContent,
  pageTitle,
  tabVariant = 'primary',
  tabClassName,
  rightContent
}) => {
  const { t } = useTranslation();
  const { moduleId } = useParams<{ moduleId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const effectiveModuleId = selectedModuleId !== undefined ? (selectedModuleId || null) : (moduleId || null);

  const systemModuleStorageKey = useMemo(() => `akalin_active_system_module_${baseRoute || ''}`, [baseRoute]);
  const systemScrollStorageKey = useMemo(() => `akalin_system_scroll_${baseRoute || ''}`, [baseRoute]);
  const cardContainerRef = useRef<HTMLDivElement>(null);

  const activeModule = useMemo(() => {
    if (effectiveModuleId) {
      const lower = effectiveModuleId.toLowerCase();
      const normalized = lower.replace(/-/g, '');
      return modules.find(m => 
        m.id === effectiveModuleId || 
        m.id.toLowerCase() === lower || 
        m.id.toLowerCase().replace(/-/g, '') === normalized ||
        (Array.isArray(m.aliases) && m.aliases.some((a: string) => 
          a.toLowerCase() === lower || a.toLowerCase().replace(/-/g, '') === normalized
        ))
      ) || null;
    }
    if (modules.length === 1 && selectedModuleId === undefined && !moduleId) {
      return modules[0];
    }
    return null;
  }, [effectiveModuleId, selectedModuleId, moduleId, modules]);

  // Dinamik sekme başlığı (Aktif modül seçiliyse modül adı, bulunamadıysa uyarı, aksi halde ana başlık)
  const effectivePageTitle = useMemo(() => {
    if (pageTitle) {
      return typeof pageTitle === 'string' ? t(pageTitle) : pageTitle;
    }
    if (activeModule) {
      const raw = activeModule.name || activeModule.title;
      return raw ? (typeof raw === 'string' ? t(raw) : raw) : title;
    }
    if (modules.length === 1 && selectedModuleId === undefined && !moduleId) {
      const raw = modules[0].name || modules[0].title;
      return raw ? (typeof raw === 'string' ? t(raw) : raw) : title;
    }
    if (effectiveModuleId && modules.length > 1) {
      return t('auto_ayar_grubu_bulunamadi', 'Ayar Grubu Bulunamadı');
    }
    return title ? (typeof title === 'string' ? t(title) : title) : t('auto_sistem_ayarlari_93b5', 'Sistem Ayarları');
  }, [pageTitle, activeModule, modules, selectedModuleId, moduleId, effectiveModuleId, title, t]);

  useEffect(() => {
    updateDocumentTitle(effectivePageTitle);
  }, [effectivePageTitle]);
  const { setHeader, clearHeader } = useHeaderApi();
  const headerIdRef = useRef(Math.random().toString(36).substr(2, 9));
  
  const canShowAddButton = Boolean(onAdd && !hideAddButton);
  const effectiveAddButtonTitle = addButtonTitle || t('auto_yeni_ekle', 'Yeni Ekle');

  const [internalSearchTerm, setInternalSearchTerm] = useState('');
  const [searchType, setSearchType] = useState('Tumu');
  const activeSearchTerm = externalSearchTerm !== undefined ? externalSearchTerm : internalSearchTerm;

  // Türkçe duyarlı genel arama filtreleyici yardımcı fonksiyon
  const filterItems = useCallback(<T,>(items: T[], getSearchableFields: (item: T) => (string | undefined | null)[]): T[] => {
    const q = (activeSearchTerm || '').toLocaleLowerCase('tr-TR').trim();
    if (!q) return items;
    return items.filter(item => {
      const fields = getSearchableFields(item);
      return fields.some(f => f && f.toLocaleLowerCase('tr-TR').includes(q));
    });
  }, [activeSearchTerm]);

  // Global search event dinleyicisi & Header arama alanları kaydı
  const searchableFieldsJson = JSON.stringify(searchableFields || []);
  useEffect(() => {
    const handleGlobalSearch = (e: any) => {
      if (e.detail) {
        const val = e.detail.value !== undefined ? (e.detail.value || '') : '';
        const type = e.detail.type || 'Tumu';
        setInternalSearchTerm(val);
        setSearchType(type);
        if (onSearchChange) {
          onSearchChange(val, type);
        }
      }
    };

    window.addEventListener('global-search', handleGlobalSearch);

    const fieldsToRegister = searchableFields && searchableFields.length > 0
      ? searchableFields
      : [{ id: 'Tumu', label: t('Tümü', 'Tümü'), type: 'text', placeholder: t(searchPlaceholder, searchPlaceholder) }];

    window.dispatchEvent(new CustomEvent('register-search-fields', {
      detail: fieldsToRegister
    }));

    return () => {
      window.removeEventListener('global-search', handleGlobalSearch);
      window.dispatchEvent(new CustomEvent('register-search-fields', { detail: [] }));
    };
  }, [searchPlaceholder, searchableFieldsJson]);

  const getTargetModuleId = useCallback(() => {
    try {
      const stored = sessionStorage.getItem(systemModuleStorageKey);
      if (stored) return stored;
    } catch (e) {}
    return (location.state as any)?.selectedModuleId || (location.state as any)?.selectedId || null;
  }, [systemModuleStorageKey, location.state]);

  const [highlightedModuleId, setHighlightedModuleId] = useState<string | null>(() => getTargetModuleId());

  // location.state veya storage değişirse highlightedModuleId senkronize et
  useEffect(() => {
    const target = getTargetModuleId();
    if (target) {
      setHighlightedModuleId(target);
    }
  }, [getTargetModuleId]);

  // Aktif modül değiştiğinde sessionStorage'ı güncel tut (derin sayfaya geçiş ve geri dönüşler için)
  useEffect(() => {
    const currentId = activeModule?.id || effectiveModuleId;
    if (currentId) {
      try {
        sessionStorage.setItem(systemModuleStorageKey, currentId);
      } catch (err) {}
      setHighlightedModuleId(currentId);
    }
  }, [activeModule?.id, effectiveModuleId, systemModuleStorageKey]);

  // Ana kart ızgarasına dönüldüğünde veya sayfa açıldığında son konuma scroll yap
  useEffect(() => {
    // Sadece ana kart ızgarası görünümündeyken çalışsın (detay sayfasında değil)
    if (activeModule || effectiveModuleId) {
      return;
    }

    const restorePosition = () => {
      const targetId = getTargetModuleId();

      // 1. Önce kaydedilmiş container scrollTop değerini geri yükle
      try {
        const savedScroll = sessionStorage.getItem(systemScrollStorageKey);
        if (savedScroll && cardContainerRef.current) {
          const scrollVal = Number(savedScroll);
          if (!isNaN(scrollVal) && scrollVal > 0) {
            cardContainerRef.current.scrollTop = scrollVal;
          }
        }
      } catch (err) {}

      // 2. Ardından hedeflenen kartı bularak ekran içine hizala
      if (targetId) {
        setHighlightedModuleId(String(targetId));
        const targetElement = document.getElementById(`system-card-${targetId}`) || 
                              document.querySelector(`[data-module-id="${targetId}"]`);
        if (targetElement && cardContainerRef.current) {
          const targetRect = targetElement.getBoundingClientRect();
          const containerRect = cardContainerRef.current.getBoundingClientRect();

          const isFullyVisible = (
            targetRect.top >= containerRect.top + 20 &&
            targetRect.bottom <= containerRect.bottom - 20
          );

          if (!isFullyVisible) {
            targetElement.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          }
        }
      }
    };

    // DOM ve grid yerleşiminin oturması için hem RAF hem kısa timeout
    const rafId = requestAnimationFrame(restorePosition);
    const timer = setTimeout(restorePosition, 60);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
    };
  }, [activeModule, effectiveModuleId, systemModuleStorageKey, systemScrollStorageKey, getTargetModuleId, modules.length]);

  // Scroll konumu değiştikçe sessionStorage'a kaydet
  const handleScroll = useCallback(() => {
    if (cardContainerRef.current) {
      try {
        sessionStorage.setItem(systemScrollStorageKey, String(cardContainerRef.current.scrollTop));
      } catch (err) {}
    }
  }, [systemScrollStorageKey]);

  // Header senkronizasyonu
  useEffect(() => {
    const shouldShow = (headerSync || showBackButton) && showBackButton !== false && (activeModule || children || renderContent || Boolean(backRoute) || Boolean(onBack));
    if (shouldShow && setHeader) {
      const currentModId = activeModule?.id || effectiveModuleId;
      setHeader(
        headerIdRef.current,
        <BackButton 
          onClick={() => {
            if (currentModId) {
              try {
                sessionStorage.setItem(systemModuleStorageKey, currentModId);
              } catch (err) {}
            }
            if (onBack) return onBack();
            if (backRoute) return navigate(backRoute, { state: { selectedModuleId: currentModId } });
            if (window.history.state && window.history.state.idx > 0) {
              navigate(-1);
            } else if (baseRoute) {
              navigate(baseRoute, { replace: true, state: { selectedModuleId: currentModId } });
            }
          }} 
          title={backTitle || t('auto_geri_don', 'Geri Dön')} 
        />
      );

      return () => clearHeader && clearHeader(headerIdRef.current);
    }
  }, [activeModule, effectiveModuleId, children, renderContent, baseRoute, backRoute, onBack, backTitle, showBackButton, headerSync, setHeader, clearHeader, navigate, systemModuleStorageKey, t]);

  const handleCardClick = (modId: string) => {
    try {
      sessionStorage.setItem(systemModuleStorageKey, modId);
      if (cardContainerRef.current) {
        sessionStorage.setItem(systemScrollStorageKey, String(cardContainerRef.current.scrollTop));
      }
      if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
        const currentState = window.history.state || {};
        window.history.replaceState({ ...currentState, usr: { ...(currentState.usr || {}), selectedModuleId: modId } }, '');
      }
    } catch (err) {}

    setHighlightedModuleId(modId);

    if (onModuleClick) {
      onModuleClick(modId);
    } else {
      navigate(`${baseRoute.replace(/\/$/, '')}/${modId}`, {
        state: { selectedModuleId: modId, returnUrl: baseRoute }
      });
    }
  };

  // Tab State
  const [dynamicTabs, setDynamicTabs] = useState<BaseTabItem[] | null>(null);
  const [internalActiveTabId, setInternalActiveTabId] = useState<string | number | undefined>(
    defaultActiveTabId ?? defaultActiveId
  );

  const controlledActiveTabId = activeTabId !== undefined ? activeTabId : activeId;
  const currentActiveTabId = controlledActiveTabId !== undefined ? controlledActiveTabId : internalActiveTabId;

  const handleTabChange = useCallback((id: string | number) => {
    if (controlledActiveTabId === undefined) {
      setInternalActiveTabId(id);
    }
    if (onTabChange) onTabChange(id);
    if (onChange) onChange(id);
  }, [controlledActiveTabId, onTabChange, onChange]);

  const contextValue: BaseSystemPageContextValue = useMemo(() => ({
    searchTerm: activeSearchTerm,
    setSearchTerm: (term: string) => {
      setInternalSearchTerm(term);
      if (onSearchChange) onSearchChange(term, searchType);
    },
    isSearching: Boolean(activeSearchTerm && activeSearchTerm.trim().length > 0),
    searchType,
    searchPlaceholder,
    filterItems,
    tabs: dynamicTabs || propsTabs,
    setTabs: setDynamicTabs,
    activeTabId: currentActiveTabId,
    setActiveTabId: handleTabChange
  }), [activeSearchTerm, searchType, searchPlaceholder, filterItems, onSearchChange, dynamicTabs, propsTabs, currentActiveTabId, handleTabChange]);

  // 1) DETAY SAYFASI VEYA MÜSTAKİL MODÜL GÖRÜNÜMÜ
  const hasTabs = Boolean((propsTabs && propsTabs.length > 0) || (dynamicTabs && dynamicTabs.length > 0));
  const hasCustomContent = Boolean(children || renderContent || hasTabs);
  if (activeModule || hasCustomContent || (effectiveModuleId && modules.length > 0)) {
    const currentModule = activeModule || (modules.length === 1 ? modules[0] : null);

    if (effectiveModuleId && !activeModule && modules.length > 1) {
      return (
        <BaseSystemPageContext.Provider value={contextValue}>
          <div className="base-system-not-found">
            <AlertCircle size={40} color="var(--danger)" className="mb-12" />
            <h3 className="m-0 text-18 font-600 text-primary mb-8">{t('auto_ayar_grubu_bulunamadi', 'Ayar Grubu Bulunamadı')}</h3>
            <p className="text-secondary mb-20 text-14">
              {t('auto_aradiginiz_ayar_modulu_bulunamadi', 'Aradığınız "{{moduleId}}" isimli ayar modülü mevcut değil veya kaldırılmış.', { moduleId: effectiveModuleId })}
            </p>
            <button 
              type="button" 
              className="btn btn-primary" 
              onClick={() => {
                if (onBack) return onBack();
                navigate(baseRoute, { state: { selectedModuleId: effectiveModuleId } });
              }}
            >
              {t('auto_ayarlar_ana_sayfasina_don', 'Ayarlar Ana Sayfasına Dön')}
            </button>
          </div>
        </BaseSystemPageContext.Provider>
      );
    }

    const rawTitleToRender = currentModule ? (currentModule.name || currentModule.title) : title;
    const titleToRender = typeof rawTitleToRender === 'string' ? t(rawTitleToRender) : rawTitleToRender;
    const rawDescToRender = currentModule ? (currentModule.desc || currentModule.subtitle) : (description || subtitle);
    const descToRender = typeof rawDescToRender === 'string' ? t(rawDescToRender) : rawDescToRender;
    const iconToRender = currentModule?.icon || icon;

    // ActionMenu ve Yenileme (Refresh) Aksiyonları
    const effectiveOnRefresh = onRefresh || currentModule?.onRefresh;
    const effectiveRefreshLoading = refreshLoading ?? currentModule?.refreshLoading;
    const effectiveExtraDropdownActions = extraDropdownActions || currentModule?.extraDropdownActions;
    const effectiveActionMenuTrigger = actionMenuTrigger || currentModule?.actionMenuTrigger;
    const effectiveActionMenuDropdownHeader = actionMenuDropdownHeader || currentModule?.actionMenuDropdownHeader;
    const effectiveOnActionMenuTriggerClick = onActionMenuTriggerClick || currentModule?.onActionMenuTriggerClick;
    const effectiveCustomActionMenu = customActionMenu !== undefined ? customActionMenu : currentModule?.customActionMenu;
    const effectiveHideActionMenu = hideActionMenu || currentModule?.hideActionMenu;

    const refreshActionItem: ActionMenuItem | null = effectiveOnRefresh ? {
      label: t('Yenile', 'Yenile'),
      icon: <RefreshCw size={15} className={effectiveRefreshLoading ? 'animate-spin spinning' : ''} />,
      disabled: Boolean(effectiveRefreshLoading),
      onClick: () => {
        if (effectiveOnRefresh && !effectiveRefreshLoading) {
          effectiveOnRefresh();
        }
      }
    } : null;

    const defaultActionMenuActions: ActionMenuItem[] = [
      ...(refreshActionItem ? [refreshActionItem] : []),
      ...(effectiveExtraDropdownActions || [])
    ];

    const resolvedActionMenu = effectiveHideActionMenu ? null : (
      effectiveCustomActionMenu !== undefined ? effectiveCustomActionMenu : (
        defaultActionMenuActions.length > 0 ? (
          <ActionMenu
            triggerLabel={effectiveActionMenuTrigger}
            onTriggerLabelClick={effectiveOnActionMenuTriggerClick}
            dropdownHeader={effectiveActionMenuDropdownHeader}
            actions={defaultActionMenuActions}
          />
        ) : null
      )
    );

    const callerActions = currentModule?.headerActions || currentModule?.actions || customHeaderActions || headerActions;
    const actionsToRender = (callerActions && resolvedActionMenu) ? (
      <div className="flex items-center gap-8">
        {callerActions}
        {resolvedActionMenu}
      </div>
    ) : (callerActions || resolvedActionMenu);

    const hasOwnLayout = Boolean(
      hideHeader ||
      currentModule?.hideHeader || 
      currentModule?.isList || 
      currentModule?.hasOwnLayout
    );

    const showHeader = !hasOwnLayout && Boolean(titleToRender || descToRender || iconToRender || actionsToRender);

    const resolvedChildren = typeof children === 'function' ? children(contextValue) : children;
    const rawContentNode = renderContent ? (
      renderContent(contextValue)
    ) : renderModuleContent && currentModule ? (
      renderModuleContent(currentModule)
    ) : currentModule?.component ? (
      typeof currentModule.component === 'function' ? (
        React.createElement(currentModule.component as React.ComponentType)
      ) : (
        currentModule.component
      )
    ) : (
      resolvedChildren
    );

    // Sekmelerin çözümlenmesi (Props tabs > currentModule.tabs > dynamicTabs)
    const rawTabs = propsTabs || currentModule?.tabs || dynamicTabs;
    let resolvedTabs = rawTabs;
    let actualContentNode = rawContentNode;

    // Eğer contentNode kendisi { tabs: [...] } yapısı döndürdüyse
    if (rawContentNode && typeof rawContentNode === 'object' && !React.isValidElement(rawContentNode) && 'tabs' in (rawContentNode as any)) {
      resolvedTabs = (rawContentNode as any).tabs;
      actualContentNode = (rawContentNode as any).children || null;
    }

    // effectiveTabs hesaplaması (Tek sekme olduğunda otomatik olarak Genel tabı oluşturur)
    let contentAssignedToTab = false;
    const effectiveTabs: BaseTabItem[] = (resolvedTabs && resolvedTabs.length > 0)
      ? resolvedTabs.map(tab => {
          if (!tab.content && actualContentNode && !contentAssignedToTab) {
            contentAssignedToTab = true;
            return { ...tab, content: actualContentNode };
          }
          return tab;
        })
      : actualContentNode
        ? [{
            id: 'default',
            label: (typeof titleToRender === 'string' ? titleToRender : undefined) || t('auto_genel', 'Genel'),
            content: actualContentNode
          }]
        : [];

    // Eğer resolvedTabs varsa ve actualContentNode hiçbir sekmeye bağlanmadıysa, TabLayout yanında render edilir
    const extraContentNode = (resolvedTabs && resolvedTabs.length > 0 && !contentAssignedToTab) 
      ? actualContentNode 
      : null;

    const hasVisibleTabs = Boolean(
      (effectiveTabs.length > 1) || 
      (effectiveTabs.length === 1 && hideIfSingleTab === false)
    );

    const isAutonomousLayout = Boolean(hasOwnLayout && (!resolvedTabs || resolvedTabs.length === 0));

    const renderContentArea = () => {
      if (isAutonomousLayout) {
        return (
          <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden w-full h-full">
            {actualContentNode}
            {canShowAddButton && (
              <EkleFloatCircleButton
                position={addButtonPosition}
                onClick={onAdd}
                title={effectiveAddButtonTitle}
                className="base-system-add-btn"
              />
            )}
          </div>
        );
      }

      return (
        <div className="base-system-content-wrapper relative flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className={`base-system-content flex-1 min-h-0 overflow-y-auto ${hasVisibleTabs ? 'has-tabs' : (showHeader ? 'has-header-no-tabs' : '')}`}>
            {effectiveTabs.length > 0 && (
              <TabLayout
                tabs={effectiveTabs}
                activeId={currentActiveTabId}
                activeTabId={currentActiveTabId}
                defaultActiveId={defaultActiveTabId || defaultActiveId}
                defaultActiveTabId={defaultActiveTabId || defaultActiveId}
                onChange={handleTabChange}
                onTabChange={handleTabChange}
                hideIfSingleTab={hideIfSingleTab}
                headerContent={tabHeaderContent}
                rightContent={rightContent}
                variant={tabVariant}
                className={`flex-1 flex flex-col min-h-0 w-full ${tabClassName || ''}`}
              />
            )}
            {extraContentNode}
          </div>
          {canShowAddButton && (
            <EkleFloatCircleButton
              position={addButtonPosition}
              onClick={onAdd}
              title={effectiveAddButtonTitle}
              className="base-system-add-btn"
            />
          )}
        </div>
      );
    };

    if (showHeader) {
      return (
        <BaseSystemPageContext.Provider value={contextValue}>
          <div className={`base-list-page ${detailWrapperClassName}`}>
            <div className="base-page-header">
              <div className="flex items-center gap-16 flex-1 min-w-0">
                {iconToRender && (
                  <div className="icon-box-large">
                    {iconToRender}
                  </div>
                )}
                <div className="base-system-header-text">
                  {titleToRender && (
                    <h1 className="base-system-header-title">
                      {titleToRender}
                    </h1>
                  )}
                  {descToRender && (
                    <p className="base-system-header-desc">
                      {descToRender}
                    </p>
                  )}
                </div>
              </div>
              {actionsToRender && (
                <div className="flex items-center gap-8 flex-shrink-0">
                  {actionsToRender}
                </div>
              )}
            </div>

            {renderContentArea()}
          </div>
        </BaseSystemPageContext.Provider>
      );
    }

    return (
      <BaseSystemPageContext.Provider value={contextValue}>
        <div className={`flex flex-col flex-1 min-h-0 ${isAutonomousLayout ? 'w-full h-full' : detailWrapperClassName}`}>
          {renderContentArea()}
        </div>
      </BaseSystemPageContext.Provider>
    );
  }

  // 2) ANA LİSTE (KARTLAR GRID) GÖRÜNÜMÜ
  const query = (activeSearchTerm || '').toLocaleLowerCase('tr-TR').trim();
  const filteredModules = modules.filter(mod => {
    if (!query) return true;
    return (
      mod.name?.toLocaleLowerCase('tr-TR').includes(query) ||
      mod.desc?.toLocaleLowerCase('tr-TR').includes(query) ||
      mod.keywords?.toLocaleLowerCase('tr-TR').includes(query)
    );
  });

  // Grid görünümü için ActionMenu ve aksiyonlar
  const gridRefreshActionItem: ActionMenuItem | null = onRefresh ? {
    label: t('Yenile', 'Yenile'),
    icon: <RefreshCw size={15} className={refreshLoading ? 'animate-spin spinning' : ''} />,
    disabled: Boolean(refreshLoading),
    onClick: () => {
      if (onRefresh && !refreshLoading) {
        onRefresh();
      }
    }
  } : null;

  const gridDefaultActions: ActionMenuItem[] = [
    ...(gridRefreshActionItem ? [gridRefreshActionItem] : []),
    ...(extraDropdownActions || [])
  ];

  const gridResolvedActionMenu = hideActionMenu ? null : (
    customActionMenu !== undefined ? customActionMenu : (
      gridDefaultActions.length > 0 ? (
        <ActionMenu
          triggerLabel={actionMenuTrigger}
          onTriggerLabelClick={onActionMenuTriggerClick}
          dropdownHeader={actionMenuDropdownHeader}
          actions={gridDefaultActions}
        />
      ) : null
    )
  );

  const gridCallerActions = customHeaderActions || headerActions;
  const gridActionsToRender = (gridCallerActions && gridResolvedActionMenu) ? (
    <div className="flex items-center gap-8">
      {gridCallerActions}
      {gridResolvedActionMenu}
    </div>
  ) : (gridCallerActions || gridResolvedActionMenu);

  return (
    <BaseSystemPageContext.Provider value={contextValue}>
      <div 
        ref={cardContainerRef}
        onScroll={handleScroll}
        className={`fade-in ${cardWrapperClassName}`}
      >
        {(title || subtitle || gridActionsToRender) && (
          <div className={`base-system-grid-header ${gridActionsToRender ? 'flex items-center justify-between' : ''}`}>
            <div>
              {title && <h1 className="base-system-grid-title">{title}</h1>}
              {subtitle && (
                <p className="base-system-grid-desc">
                  {subtitle}
                </p>
              )}
            </div>
            {gridActionsToRender && (
              <div className="flex items-center gap-8 flex-shrink-0">
                {gridActionsToRender}
              </div>
            )}
          </div>
        )}

        <div 
          className="settings-grid grid gap-20 pb-24"
          style={{ gridTemplateColumns: gridColumns }}
        >
          {filteredModules.map((mod) => (
            <SistemKart
              key={mod.id}
              id={mod.id}
              title={typeof mod.name === 'string' ? t(mod.name, mod.name) : (mod.name || mod.title || '')}
              description={mod.desc ? (typeof mod.desc === 'string' ? t(mod.desc, mod.desc) : mod.desc) : (mod.subtitle || undefined)}
              icon={mod.icon}
              badge={mod.badge}
              isSelected={highlightedModuleId === mod.id}
              onClick={() => handleCardClick(mod.id)}
            />
          ))}
        </div>

        {filteredModules.length === 0 && (
          <div className="base-system-empty-state">
            <Sliders size={36} className="mb-10 opacity-50" />
            <div>{emptyMessage ? t(emptyMessage) : t('aramaya_uygun_ayar_grubu_bulunamadi', 'Aramaya uygun ayar grubu bulunamadı.')}</div>
          </div>
        )}

        {canShowAddButton && (
          <EkleFloatCircleButton
            position={addButtonPosition}
            onClick={onAdd}
            title={effectiveAddButtonTitle}
            className="base-system-add-btn"
          />
        )}
      </div>
    </BaseSystemPageContext.Provider>
  );
};

export default BaseSystemPage;
