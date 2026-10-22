import React, { useRef, useCallback, useEffect, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Card from '../../components/card/Card';
import SaveButton from '../../components/button/SaveButton';
import BackButton from '../../components/button/BackButton';
import TabLayout from '../../components/tab/TabLayout';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useHeaderApi } from '../../context/HeaderContext';
import AlertDialogContext, { type AlertDialogContextType } from '../../alerts/AlertDialogContext';
import BaseCardPageHeader, { BaseCardPageHeaderProps } from '../../components/card/BaseCardPageHeader';
import { updateDocumentTitle } from '../../utils/domUtils';

export interface BasePageProps {
  id?: string;
  pageTitle?: string;
  onSubmit?: (e: React.FormEvent) => void;
  asForm?: boolean;
  icon?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  hideBreadcrumb?: boolean;
  title?: React.ReactNode;
  onTitleEdit?: () => void;
  titleEditTooltip?: string;
  subtitle?: React.ReactNode;
  onSubtitleEdit?: () => void;
  subtitleEditTooltip?: string;
  subtitleLeft?: React.ReactNode;
  subtitleRight?: React.ReactNode;
  isSaving?: boolean;
  onSave?: (e?: any) => void | Promise<void>;
  onClose?: () => void;
  onBack?: () => void;
  showBackButton?: boolean;
  headerExtra?: React.ReactNode;
  headerProps?: Partial<BaseCardPageHeaderProps>;
  footerExtra?: React.ReactNode;
  saveButtonText?: string;
  hideSaveButton?: boolean;
  
  // Tab Props
  tabs?: Array<{ id: number; name?: string; label?: string; title?: string; icon?: React.ReactNode }>;
  activeTabId?: number;
  onTabChange?: (tabId: number) => void;
  
  disableContentWrapper?: boolean;
  containerRef?: React.RefObject<HTMLDivElement>;
  className?: string;
  children?: React.ReactNode;

  // Modal / Overlay Props (Alt sayfa ve seçim ekranları için)
  inModal?: boolean;
  overlayClassName?: string;
}

const BasePage: React.FC<BasePageProps> = ({
  id,
  pageTitle,
  onSubmit,
  asForm = true,
  icon,
  breadcrumb,
  hideBreadcrumb = false,
  title = '',
  onTitleEdit,
  titleEditTooltip,
  subtitle,
  onSubtitleEdit,
  subtitleEditTooltip,
  subtitleLeft,
  subtitleRight,
  isSaving,
  onSave,
  onClose,
  onBack,
  showBackButton,
  headerExtra,
  headerProps,
  footerExtra,
  saveButtonText,
  hideSaveButton = false,
  tabs,
  activeTabId,
  onTabChange,
  disableContentWrapper,
  containerRef,
  className,
  children,
  inModal = false,
  overlayClassName
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    updateDocumentTitle(pageTitle || title);
  }, [pageTitle, title]);

  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const handleSaveClick = useCallback((e?: any) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    if (onSaveRef.current) {
      onSaveRef.current(e);
    }
  }, []);

  const handleFormSubmit = useCallback((e: React.FormEvent) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    if (onSubmit) {
      onSubmit(e);
    }
  }, [onSubmit]);

  const finalBreadcrumb = hideBreadcrumb ? null : breadcrumb;

  const hasOnSave = !!onSave && !hideSaveButton;
  const { setHeader, clearHeader, isDocumentDirty, setIsDocumentDirty, documentBackInterceptor } = useHeaderApi() || {};
  const alertContext = React.useContext(AlertDialogContext);
  const showAlert = alertContext?.showAlert || useCallback<AlertDialogContextType['showAlert']>((type, title, message, onConfirm) => {
    if (type === 'confirm' || onConfirm) {
      if (typeof window !== 'undefined' && window.confirm(typeof message === 'string' ? `${title}\n\n${message}` : title)) {
        onConfirm?.();
      }
    } else {
      if (typeof window !== 'undefined') {
        window.alert(typeof message === 'string' ? `${title}\n\n${message}` : title);
      }
    }
  }, []);
  const headerIdRef = useRef(`base-page-back-${Math.random().toString(36).substr(2, 9)}`);
  const documentBackInterceptorRef = useRef(documentBackInterceptor);

  useEffect(() => {
    documentBackInterceptorRef.current = documentBackInterceptor;
  }, [documentBackInterceptor]);

  const handleBackClick = useCallback(async (e?: any) => {
    if (documentBackInterceptorRef.current) {
      try {
        const canExit = await documentBackInterceptorRef.current();
        if (!canExit) {
          return;
        }
      } catch (err) {
        console.error('BasePage back interceptor error:', err);
      }
    }

    const doActualBack = () => {
      if (onClose) {
        onClose();
      } else if (onBack) {
        onBack();
      } else if (window.history.state && window.history.state.idx > 0) {
        navigate(-1);
      } else {
        navigate(-1);
      }
    };

    if (!inModal && isDocumentDirty) {
      showAlert(
        'confirm',
        t('common.unsaved_changes', 'Kaydedilmemiş Değişiklikler'),
        t('common.unsaved_changes_confirm', 'Kaydedilmemiş değişiklikleriniz var. Çıkmak istediğinize emin misiniz?'),
        () => {
          if (setIsDocumentDirty) setIsDocumentDirty(false);
          doActualBack();
        },
        t('common.yes_exit', 'Evet, Çık'),
        t('common.cancel', 'İptal')
      );
    } else {
      doActualBack();
    }
  }, [onClose, onBack, navigate, inModal, isDocumentDirty, showAlert, t, setIsDocumentDirty]);


  const shouldShowBack = showBackButton !== false && (showBackButton === true || !!onClose || !!onBack);

  useEffect(() => {
    if (shouldShowBack && setHeader) {
      setHeader(
        headerIdRef.current,
        <BackButton 
          onClick={handleBackClick} 
          title={t('auto_geri_don', 'Geri Dön')} 
        />
      );

      return () => {
        if (clearHeader) {
          clearHeader(headerIdRef.current);
        }
      };
    }
  }, [shouldShowBack, handleBackClick, setHeader, clearHeader, t]);

  // ESC Tuşu ile Modal / Overlay Kapatma
  useEffect(() => {
    if (!inModal || (!onClose && !onBack)) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleBackClick();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inModal, onClose, onBack, handleBackClick]);

  // inModal durumunda contentArea bulma ve güvenli portal yönetimi
  const [contentArea, setContentArea] = useState<HTMLElement | null>(() => {
    if (typeof document !== 'undefined') {
      return document.querySelector('.content-area') as HTMLElement;
    }
    return null;
  });

  useLayoutEffect(() => {
    if (inModal && !contentArea && typeof document !== 'undefined') {
      const el = document.querySelector('.content-area') as HTMLElement;
      if (el) {
        setContentArea(el);
      }
    }
  }, [inModal, contentArea]);

  // inModal durumunda contentArea pozisyon ve taşma yönetimi
  useEffect(() => {
    if (!inModal) return;
    const target = contentArea || (typeof document !== 'undefined' ? (document.querySelector('.content-area') as HTMLElement) : null);
    if (target) {
      const originalPosition = target.style.position;
      const originalOverflow = target.style.overflow;
      if (getComputedStyle(target).position === 'static') {
        target.style.position = 'relative';
      }
      target.style.overflow = 'hidden';
      return () => {
        target.style.position = originalPosition;
        target.style.overflow = originalOverflow;
      };
    }
  }, [inModal, contentArea]);

  const isDocument = disableContentWrapper;
  const containerClass = isDocument
    ? `base-document-page form-layout-wrapper flex-col flex-1 ${className || ''}`
    : `base-card-page ${className || ''}`;

  const pageElement = (
    <div className={containerClass} ref={containerRef}>
      <Card
        as={asForm ? "form" : "div"}
        id={id}
        onSubmit={asForm ? handleFormSubmit : undefined}
        noValidate={asForm ? true : undefined}
        className="border-0 shadow-none rounded-none bg-transparent flex-1 flex flex-col min-h-0"
        style={{ background: 'transparent', border: 'none', boxShadow: 'none', borderRadius: 0, display: 'flex', flexDirection: 'column', flex: '1 1 0%', minHeight: 0 }}
      >
        {!isDocument && (
          <BaseCardPageHeader
            title={title}
            onTitleEdit={onTitleEdit || headerProps?.onTitleEdit}
            titleEditTooltip={titleEditTooltip || headerProps?.titleEditTooltip}
            icon={icon}
            subtitle={subtitle}
            onSubtitleEdit={onSubtitleEdit || headerProps?.onSubtitleEdit}
            subtitleEditTooltip={subtitleEditTooltip || headerProps?.subtitleEditTooltip}
            subtitleLeft={subtitleLeft}
            subtitleRight={subtitleRight}
            headerExtra={headerExtra}
            breadcrumb={finalBreadcrumb}
            {...headerProps}
          />
        )}

        {tabs && tabs.length > 1 && activeTabId !== undefined && onTabChange && (
          <div className="form-header-tabs">
            <TabLayout tabs={tabs} activeTabId={activeTabId} onChange={onTabChange} />
          </div>
        )}

        {disableContentWrapper ? (
          <>
            {children}
            {/* 
              KAYDET DÜĞMESİ VE İÇERİK KONUMLANDIRMA MİMARİSİ (BasePage / BaseCardPage):
              - BaseCardPage mimarisinde Kaydet düğmesi ActionMenu içerisinde header alanında sunulmaktadır.
              - Alt alandaki SaveButton geriye dönük uyumluluk amacıyla yalnızca açıkça hasOnSave aktifken render edilir.
            */}
            {(hasOnSave || footerExtra) && (
              <div className="base-page-footer pt-24 pb-8">
                {footerExtra}
                {hasOnSave && (
                  <SaveButton isSaving={isSaving} onClick={handleSaveClick} type={asForm ? "submit" : "button"} text={saveButtonText} />
                )}
              </div>
            )}
          </>
        ) : (
          <div className="base-page-content-area">
            <div className="base-page-content-inner flex flex-col">
              {children}
            </div>
            {/* 
              KAYDET DÜĞMESİ VE İÇERİK KONUMLANDIRMA MİMARİSİ (BasePage / BaseCardPage):
              - BaseCardPage mimarisinde Kaydet düğmesi ActionMenu içerisinde header alanında sunulmaktadır.
              - Alt alandaki SaveButton geriye dönük uyumluluk amacıyla yalnızca açıkça hasOnSave aktifken render edilir.
            */}
            {(hasOnSave || footerExtra) && (
              <div className="base-page-footer pt-24 pb-8">
                {footerExtra}
                {hasOnSave && (
                  <SaveButton isSaving={isSaving} onClick={handleSaveClick} type={asForm ? "submit" : "button"} text={saveButtonText} />
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );

  if (inModal) {
    const target = contentArea || (typeof document !== 'undefined' ? (document.querySelector('.content-area') as HTMLElement) : null);
    if (target) {
      const overlayElement = (
        <div className={`base-page-overlay ${overlayClassName || ''}`} role="dialog" aria-modal="true">
          {pageElement}
        </div>
      );
      return createPortal(overlayElement, target);
    }
    return null;
  }

  return pageElement;
};

export default BasePage;
