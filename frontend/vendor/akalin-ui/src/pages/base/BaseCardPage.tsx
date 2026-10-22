/**
 * Akalin UI - Kart Sayfaları İçin Base Bileşen (BaseCardPage)
 * 
 * Başlıca Görevleri:
 * - Cari Kart, Depo/Lokasyon Kartı, Personel Kartı gibi tüm kart sayfalarının sekme ve genel düzenini yönetmek.
 * - En üstteki başlık alanını BaseCard'dan türeyen BaseCardPageHeader bileşeniyle standartlaştırmak.
 * - AI ile Liste üzerinden aktarılan taslak verileri (location.state.initialAiData) yakalamak ve onAiApply ile forma teslim etmek.
 * 
 * ACTIONMENU VE KAYDET DÜĞMESİ MİMARİSİ (AGENT KNOWLEDGE & USAGE GUIDE):
 * 1. BaseCardPage ve türeyen tüm kart/form sayfalarında (DepoForm, CariForm, PersonelForm, ApiKeyCardPage vb.) "Kaydet" işlemi
 *    sayfa başlığındaki (BaseCardPageHeader) ActionMenu bileşeni içerisine varsayılan split-button olarak konumlandırılmıştır.
 * 2. Birincil kaydet düğmesinin metni HER ZAMAN standart "Kaydet" olmalıdır. `saveButtonText` prop'u ile "Yeni Anahtar Oluştur",
 *    "Kullanıcı Ekle" gibi varlığa özel metinler KESİNLİKLE verilmemelidir (`saveButtonText` boş bırakılarak varsayılan "Kaydet" korunmalıdır).
 * 3. Formun altında bulunan eski "Kaydet" düğmesi kaldırılmış, başlık alanındaki ActionMenu ile standartlaştırılmıştır.
 * 4. Cmd+S / Ctrl+S global klavye kısayolu ile form her an hızlıca kaydedilebilir.
 * 5. Yapay Zeka / MCP asistanı (enableAiAssistant) ve sayfaya özel ek aksiyonlar (extraDropdownActions) da
 *    aynı ActionMenu dropdown'ı içerisinden sunulur.
 * 6. SAYFA ODAKLILIĞI VE TEK SORUMLULUK İLKESİ:
 *    Kart sayfaları yalnızca hizmet ettikleri varlığın (entity) veri giriş ve görüntüleme alanlarını sade bir şekilde
 *    içermelidir. Farklı sayfaların görev alanına giren bilgiler (ör. başka bir modülün kota/istatistik özetleri) veya
 *    gereksiz/karşılıksız alanlar kart sayfasına eklenmemelidir.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import BasePage, { BasePageProps } from './BasePage';
import TabLayout from '../../components/tab/TabLayout';
import { BaseTabItem } from '../../components/base/tab/BaseTab';
import BaseAiAssistantModal from '../../components/modal/BaseAiAssistantModal';
import ActionMenu, { ActionMenuItem } from '../../components/menu/ActionMenu';
import { Save, Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useHeaderApi } from '../../context/HeaderContext';

export interface BaseCardPageProps extends Omit<BasePageProps, 'tabs' | 'activeTabId' | 'onTabChange'> {
  recordTitle?: string;
  tabs?: BaseTabItem[];
  activeTabId?: string | number;
  onTabChange?: (tabId: string | number) => void;
  tabHeaderContent?: React.ReactNode;
  hideIfSingleTab?: boolean;
  onAiApply?: (aiData: any, bulutDosyaId?: number | null) => void;
  documentType?: string;
  cardType?: string;
  documentId?: number;
  cardId?: number;
  enableAiAssistant?: boolean;

  // ActionMenu ve Başlık Aksiyonları
  headerActions?: React.ReactNode;
  extraDropdownActions?: ActionMenuItem[];
  actionMenuTrigger?: React.ReactNode;
  actionMenuDropdownHeader?: React.ReactNode;
  onActionMenuTriggerClick?: (e: React.MouseEvent) => void;
  customActionMenu?: React.ReactNode;
  disableKeyboardShortcut?: boolean;
}

const BaseCardPage: React.FC<BaseCardPageProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  tabHeaderContent,
  hideIfSingleTab = true,
  onAiApply,
  documentType,
  cardType,
  documentId,
  cardId,
  enableAiAssistant = true,
  showBackButton = true,
  children,
  // BasePageProps'tan gelen aksiyon ve kaydetme alanları
  id,
  onSubmit,
  onSave,
  isSaving,
  saveButtonText,
  hideSaveButton = false,
  headerExtra,
  headerActions,
  headerProps,
  extraDropdownActions,
  actionMenuTrigger,
  actionMenuDropdownHeader,
  onActionMenuTriggerClick,
  customActionMenu,
  disableKeyboardShortcut = false,
  recordTitle,
  ...restBasePageProps
}) => {
  const { t } = useTranslation();
  const location = useLocation();
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const effectiveType = cardType || documentType || 'CariKart';

  const { setHeaderBreadcrumbOptions } = useHeaderApi() || {};

  // Breadcrumb'da benzersiz kayıt adını (recordTitle) otomatik senkronize et
  useEffect(() => {
    if (setHeaderBreadcrumbOptions && recordTitle) {
      setHeaderBreadcrumbOptions({
        recordTitle
      });
    }
    return () => {
      if (setHeaderBreadcrumbOptions && recordTitle) {
        setHeaderBreadcrumbOptions(null);
      }
    };
  }, [recordTitle, setHeaderBreadcrumbOptions]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsMac(/Mac|iPod|iPhone|iPad/.test(navigator.platform || ''));
    }
  }, []);

  useEffect(() => {
    if (location?.state?.initialAiData && onAiApply) {
      onAiApply(location.state.initialAiData);
    }
  }, [location?.state, onAiApply]);

  // Canlı MCP / AI Ajan event dinleyicisi
  useEffect(() => {
    const handleMcpApplyEvent = (event: Event) => {
      const customEvt = event as CustomEvent;
      const detail = customEvt.detail;
      if (!detail || !onAiApply) return;

      if (detail.documentType && effectiveType &&
          detail.documentType.toLowerCase() !== effectiveType.toLowerCase()) {
        return;
      }

      onAiApply(detail.data || detail, detail.bulutDosyaId || null);
      toast.success(t('auto_mcp_taslak_forma_aktarildi', 'Yapay zeka / MCP taslağı forma aktarıldı.'));
    };

    window.addEventListener('akalin:mcp-apply', handleMcpApplyEvent);
    return () => {
      window.removeEventListener('akalin:mcp-apply', handleMcpApplyEvent);
    };
  }, [effectiveType, onAiApply, t]);

  // Kaydetme tetikleyicisi (ActionMenu split button veya klavye kısayolu)
  const handleTriggerSave = useCallback((e?: any) => {
    if (isSaving) return;

    if (onSave) {
      onSave(e);
    } else {
      const formElement = (id ? document.getElementById(id) : null) as HTMLFormElement;
      if (formElement && typeof formElement.requestSubmit === 'function') {
        formElement.requestSubmit();
      } else if (formElement) {
        formElement.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else if (onSubmit) {
        onSubmit(e as any);
      }
    }
  }, [isSaving, onSave, onSubmit, id]);

  // Global klavye kısayolu (Cmd+S / Ctrl+S ile formu anında kaydetme)
  useEffect(() => {
    if (disableKeyboardShortcut || hideSaveButton || (!onSave && !onSubmit && !isSaving)) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleTriggerSave(e);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [disableKeyboardShortcut, hideSaveButton, onSave, onSubmit, isSaving, handleTriggerSave]);

  // Çocuğun (kullanan sayfanın) ActionMenu varsayılanını ezip ezmediğini tespit et
  const hasChildExplicitDefault = Boolean(
    extraDropdownActions?.some(a => !a.hidden && (a.isDefault || a.default))
  );
  const hasCustomTrigger = actionMenuTrigger !== undefined;
  const isChildOverridingDefault = hasChildExplicitDefault || hasCustomTrigger;

  const hasSaveAction = !hideSaveButton && (Boolean(onSave) || Boolean(onSubmit) || Boolean(isSaving));

  // ActionMenu'nün varsayılan işlemi: "Kaydet"
  const saveActionItem: ActionMenuItem | null = hasSaveAction ? {
    label: isSaving ? t('Kaydediliyor', 'Kaydediliyor...') : (saveButtonText || t('Kaydet', 'Kaydet')),
    icon: isSaving ? <Loader2 size={15} className="document-save-spinner animate-spin" /> : <Save size={15} />,
    badge: <kbd className="document-save-hotkey">{isMac ? '⌘S' : 'Ctrl+S'}</kbd>,
    isDefault: !isChildOverridingDefault,
    variant: !isChildOverridingDefault ? 'primary' : 'default',
    disabled: isSaving,
    onClick: handleTriggerSave
  } : null;

  // Yapay Zeka Asistanı & MCP aksiyonu
  const aiActionItem: ActionMenuItem | null = (onAiApply && enableAiAssistant !== false) ? {
    label: t('auto_ai_asistan_mcp', 'Yapay Zeka Asistanı & MCP'),
    icon: <Sparkles size={16} />,
    dividerAbove: Boolean(saveActionItem),
    onClick: () => setIsAiModalOpen(true)
  } : null;

  // Menü aksiyonlarının sıralanması
  const actionsList: ActionMenuItem[] = useMemo(() => {
    if (!saveActionItem) {
      return [
        ...(extraDropdownActions || []),
        ...(aiActionItem ? [aiActionItem] : [])
      ];
    }

    if (isChildOverridingDefault) {
      const childDefaultIdx = (extraDropdownActions || []).findIndex(a => !a.hidden && (a.isDefault || a.default));
      if (childDefaultIdx !== -1) {
        const before = (extraDropdownActions || []).slice(0, childDefaultIdx + 1);
        const after = (extraDropdownActions || []).slice(childDefaultIdx + 1);
        return [
          ...before,
          saveActionItem,
          ...after,
          ...(aiActionItem ? [aiActionItem] : [])
        ];
      }

      return [
        ...(extraDropdownActions || []),
        saveActionItem,
        ...(aiActionItem ? [aiActionItem] : [])
      ];
    }

    // Normal durum: "Kaydet" en baştaki varsayılan aksiyondur
    return [
      saveActionItem,
      ...(extraDropdownActions || []),
      ...(aiActionItem ? [aiActionItem] : [])
    ];
  }, [saveActionItem, extraDropdownActions, aiActionItem, isChildOverridingDefault]);

  // ActionMenu bileşeni
  const cardActionMenu = customActionMenu !== undefined ? customActionMenu : (
    actionsList.length > 0 ? (
      <ActionMenu
        showDefaultActionAsButton={true}
        triggerLabel={actionMenuTrigger}
        onTriggerLabelClick={onActionMenuTriggerClick}
        dropdownHeader={actionMenuDropdownHeader}
        actions={actionsList}
      />
    ) : null
  );

  // Başlık aksiyonlarının birleştirilmesi (headerExtra / headerActions + cardActionMenu)
  const finalHeaderExtra = useMemo(() => {
    const callerExtra = headerExtra || headerActions;
    if (callerExtra && cardActionMenu) {
      return (
        <div className="flex items-center gap-8">
          {callerExtra}
          {cardActionMenu}
        </div>
      );
    }
    return callerExtra || cardActionMenu;
  }, [headerExtra, headerActions, cardActionMenu]);

  // HeaderProps ile headerExtra birleştirme
  const mergedHeaderProps = useMemo(() => {
    if (!headerProps) return undefined;
    return {
      ...headerProps,
      headerExtra: headerProps.headerExtra ? (
        finalHeaderExtra ? (
          <div className="flex items-center gap-8">
            {headerProps.headerExtra}
            {finalHeaderExtra}
          </div>
        ) : headerProps.headerExtra
      ) : finalHeaderExtra
    };
  }, [headerProps, finalHeaderExtra]);

  const hasExplicitTabs = Boolean(tabs && tabs.length > 0);

  const effectiveTabs: BaseTabItem[] = useMemo(() => {
    if (hasExplicitTabs) {
      return tabs!;
    }
    if (children) {
      return [
        {
          id: 'default',
          label: 'Genel',
          content: children
        }
      ];
    }
    return [];
  }, [hasExplicitTabs, tabs, children]);

  const [internalActiveTabId, setInternalActiveTabId] = useState<string | number>(
    () => activeTabId ?? effectiveTabs[0]?.id ?? 'default'
  );

  useEffect(() => {
    if (activeTabId !== undefined) {
      setInternalActiveTabId(activeTabId);
    }
  }, [activeTabId]);

  const handleTabChange = useCallback((id: string | number) => {
    if (activeTabId === undefined) {
      setInternalActiveTabId(id);
    }
    if (onTabChange) {
      onTabChange(id);
    }
  }, [activeTabId, onTabChange]);

  const currentActiveTabId = activeTabId !== undefined ? activeTabId : internalActiveTabId;

  return (
    <BasePage
      showBackButton={showBackButton}
      id={id}
      onSubmit={onSubmit}
      onSave={onSave}
      isSaving={isSaving}
      headerExtra={finalHeaderExtra}
      headerProps={mergedHeaderProps}
      hideSaveButton={true}
      {...restBasePageProps}
    >
      {effectiveTabs.length > 0 && (
        <TabLayout
          tabs={effectiveTabs}
          activeId={currentActiveTabId}
          activeTabId={currentActiveTabId}
          onChange={handleTabChange}
          onTabChange={handleTabChange}
          headerContent={tabHeaderContent}
          hideIfSingleTab={hideIfSingleTab}
          className="flex-1 flex flex-col"
        />
      )}
      {hasExplicitTabs && children}

      {onAiApply && enableAiAssistant !== false && (
        <BaseAiAssistantModal
          isOpen={isAiModalOpen}
          onClose={() => setIsAiModalOpen(false)}
          documentType={effectiveType}
          documentId={cardId || documentId}
          onApply={(data, bulutDosyaId) => {
            onAiApply(data, bulutDosyaId);
          }}
        />
      )}
    </BasePage>
  );
};

export default BaseCardPage;
