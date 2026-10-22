// @ts-nocheck
/**
 * BaseDocumentPage Bileşeni
 * 
 * Fatura, İrsaliye, Sipariş, Kasa ve Banka Fişleri gibi "Belge" (Document) tarzı formların
 * Header (Üst Bilgiler) - Detail (Kalemler / Veri Izgarası) - Footer (Alt Toplamlar / Sonuçlar)
 * yapısını standartlaştıran merkezi OOP base bileşenidir.
 * 
 * Sorumluluklar ve Özellikler:
 * 1. Header (Üst Bilgiler): Tab menüsü, işlem aksiyonları (Save, ActionMenu) ve genel form alanlarını (Cari, Belge No, Tarih vb.) barındırır.
 * 2. Detail (Kalemler / SpreadsheetGrid): Esnek, dikeyde kalan tüm alanı kaplayan ve kaydırılabilen veri ızgarasını barındırır.
 * 3. Footer (Alt Toplamlar): DocumentResultPanel gibi dip toplam, iskonto ve KDV özetlerini sağa yaslı ve standart margin/padding ile sunar.
 * 4. Dinamik Boyutlandırma: Header ve Footer resizer tutamaçları ile fare ile yeniden boyutlandırılabilir ve kullanıcı tercihini saklar.
 * 5. Bulut Dosyaları ve AI Desteği: Belgeye bağlı bulut dosyalarını ve yapay zeka aktarım verilerini yönetir.
 */
import React, { ReactNode, CSSProperties, FormEvent, useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BasePage from './BasePage';
import TabLayout from '../../components/tab/TabLayout';
import SpreadsheetGrid from '../../components/grid/spreadsheet/SpreadsheetGrid';
import FieldError from '../../components/common/FieldError';
import ActionMenu, { ActionMenuItem } from '../../components/menu/ActionMenu';
import DocumentSaveButton from '../../components/button/DocumentSaveButton';
import { Cloud, Coins, AlertCircle, X, Save, Loader2, Sparkles } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import FilesOnClouds from '../../components/customs/cloud/FilesOnClouds';
import BaseAiAssistantModal from '../../components/modal/BaseAiAssistantModal';
import AlertDialog from '../../components/dialog/AlertDialog';
import AlertDialogContext from '../../alerts/AlertDialogContext';
import { useTranslation } from 'react-i18next';
import { useHeaderApi } from '../../context/HeaderContext';
import { updateDocumentTitle, autoFocusFirstInput } from '../../utils/domUtils';
import { createSingletonContext } from '../../utils/createSingletonContext';

// Hata nesnelerini ve diğer form context verilerini taşımak için
export const DocumentFormContext = createSingletonContext<{ 
    errors?: Record<string, string>;
    isDirty?: boolean;
    setIsDirty?: (dirty: boolean) => void;
    markDirty?: () => void;
    clearDirty?: () => void;
}>(
    '__AKALIN_UI_DOCUMENT_FORM_CONTEXT__',
    {},
    'DocumentFormContext'
);

export interface DocumentHeaderPanelProps {
    children?: ReactNode;
    columns?: number;
    style?: CSSProperties;
}

/**
 * Belge başlığındaki (Header) form elemanlarını yan yana düzenli gösteren Grid yapısı.
 */
export const DocumentHeaderPanel: React.FC<DocumentHeaderPanelProps> = ({ children, columns = 2, style }) => (
    <div
        className="document-header-panel"
        style={{
            '--panel-columns': columns,
            ...style
        } as React.CSSProperties}
    >
        {children}
    </div>
);

export interface DocumentHeaderFieldProps {
    name?: string;
    label?: string | ReactNode;
    required?: boolean;
    fullWidth?: boolean;
    children?: ReactNode;
    style?: CSSProperties;
}

export const DocumentHeaderFieldContext = createSingletonContext<{ name?: string; hasError?: boolean; error?: string | null }>(
    '__AKALIN_UI_DOCUMENT_HEADER_FIELD_CONTEXT__',
    {},
    'DocumentHeaderFieldContext'
);

/**
 * Label ve Input ikilisini proje standartlarında alt alta dizecek bileşen.
 * Eğer name prop'u geçilirse ve DocumentFormContext içerisinde o name'e ait bir error varsa,
 * hatayı otomatik olarak alanın altında gösterir ve altındaki giriş bileşenlerine hata context'ini iletir.
 */
export const DocumentHeaderField: React.FC<DocumentHeaderFieldProps> = ({ name, label, required, fullWidth, children, style }) => {
    const { errors } = useContext(DocumentFormContext);
    const error = name && errors ? errors[name] : null;

    return (
        <DocumentHeaderFieldContext.Provider value={{ name, hasError: Boolean(error), error }}>
            <div 
                className={`document-header-field ${fullWidth ? 'full-width' : ''} ${error ? 'has-error is-invalid' : ''}`} 
                style={style}
                data-field-name={name}
                data-required={required ? 'true' : undefined}
            >
                {label && (
                    <label className="document-field-label">
                        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
                    </label>
                )}
                {children}
                {error && <FieldError error={error} />}
            </div>
        </DocumentHeaderFieldContext.Provider>
    );
};

export interface DocumentTabItem {
    id: string | number;
    title: string;
    icon?: ReactNode;
}

export interface DocumentCurrencyProps {
    value?: string;
    onChange?: (currency: string, raw?: any) => void;
    disabled?: boolean;
    currencies?: any[];
}

export interface BaseDocumentPageProps {
    formId?: string;
    onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
    tabs?: DocumentTabItem[];
    activeTabId?: string | number;
    onTabChange?: (tabId: string | number) => void;
    headerActions?: ReactNode;
    headerContent?: ReactNode;
    gridProps?: any; // SpreadsheetGridProps can be imported later when SpreadsheetGrid is typed
    customDetailContent?: ReactNode;
    footerContent?: ReactNode;
    headerHeight?: number | 'auto';
    footerHeight?: number | 'auto';
    onHeaderHeightChange?: (height: number | 'auto') => void;
    onFooterHeightChange?: (height: number | 'auto') => void;
    minHeaderHeight?: number;
    minFooterHeight?: number;
    maxHeaderHeight?: number;
    maxFooterHeight?: number;
    contentMaxWidth?: string | number;
    headerClassName?: string;
    detailClassName?: string;
    footerClassName?: string;
    errors?: Record<string, string>;
    documentId?: number;
    documentGuid?: string;
    documentType?: string;
    documentNo?: string;
    formData?: any;
    extraDropdownActions?: any[];
    actionMenuTrigger?: ReactNode;
    actionMenuDropdownHeader?: ReactNode;
    onActionMenuTriggerClick?: (e: React.MouseEvent) => void;
    customActionMenu?: ReactNode;
    pageTitle?: string;
    onBack?: () => void;
    onAiApply?: (aiData: any, bulutDosyaId?: number | null) => void;
    enableAiAssistant?: boolean;
    // Gelişmiş UX ve Aksiyon Butonları
    currencyProps?: DocumentCurrencyProps;
    isSaving?: boolean;
    saveButtonText?: string;
    hideSaveButton?: boolean;
    onSave?: (e?: any) => void;
    disableKeyboardShortcut?: boolean;
    settingsColumnPosition?: 'fixed' | 'inline' | 'end';
    pinSettingsColumn?: boolean;
    // Kaydedilmemiş değişiklik (Dirty) yönetimi
    isDirty?: boolean;
    onDirtyChange?: (isDirty: boolean) => void;
    // Çıkış ve Doğrulama (Validation) Yönetimi
    onValidate?: () => boolean | Record<string, string> | { isValid: boolean; errors?: Record<string, string> };
    validate?: () => boolean | Record<string, string> | { isValid: boolean; errors?: Record<string, string> };
}

const HorizontalResizer = ({ onMouseDown, onDoubleClick }: { onMouseDown: (e: React.MouseEvent) => void, onDoubleClick?: () => void }) => {
    return (
        <div
            onMouseDown={onMouseDown}
            onDoubleClick={onDoubleClick}
            className="document-resizer"
        >
            <div className="document-resizer-handle" />
        </div>
    );
};

const getCurrencySymbolHelper = (code?: string): string => {
    if (!code) return '₺';
    const c = code.toUpperCase();
    if (c === 'TRY' || c === 'TL') return '₺';
    if (c === 'USD') return '$';
    if (c === 'EUR' || c === 'EURO') return '€';
    if (c === 'GBP') return '£';
    return c;
};

/**
 * BaseDocumentPage
 * 
 * Fatura, İrsaliye, Sipariş gibi belge bazlı formlar için
 * Header (Üst Bilgiler) - Detail (Kalemler Grid'i) - Footer (Alt Toplamlar)
 * yapısını standartlaştıran OOP mimarisi base bileşeni.
 */
const normalizeDocFormData = (data: any): string => {
    if (!data || typeof data !== 'object') return '';
    const { _gridId, _isDraftTemplate, _draftData, tempId, ...rest } = data;
    return JSON.stringify(rest);
};

const isDocDataMeaningful = (data: any): boolean => {
    if (!data || typeof data !== 'object') return false;
    return Object.keys(data).some(k => {
        const val = data[k];
        if (val === null || val === undefined || val === '' || val === 0) return false;
        if (Array.isArray(val)) return val.length > 0;
        return true;
    });
};

const BaseDocumentPage: React.FC<BaseDocumentPageProps> = ({
    formId = 'documentForm',
    onSubmit,
    tabs,
    activeTabId,
    onTabChange,
    headerActions,
    headerContent,
    gridProps,
    customDetailContent,
    footerContent,
    headerHeight: propHeaderHeight,
    footerHeight: propFooterHeight,
    onHeaderHeightChange,
    onFooterHeightChange,
    minHeaderHeight = 100,
    minFooterHeight = 60,
    maxHeaderHeight,
    maxFooterHeight,
    contentMaxWidth,
    headerClassName,
    detailClassName,
    footerClassName,
    errors,
    documentId,
    documentGuid,
    documentType,
    documentNo,
    formData,
    extraDropdownActions,
    actionMenuTrigger: propActionMenuTrigger,
    actionMenuDropdownHeader: propActionMenuDropdownHeader,
    onActionMenuTriggerClick: propOnActionMenuTriggerClick,
    customActionMenu,
    pageTitle,
    onBack,
    onAiApply,
    enableAiAssistant = true,
    currencyProps,
    isSaving,
    saveButtonText,
    hideSaveButton = false,
    onSave,
    disableKeyboardShortcut = false,
    settingsColumnPosition,
    pinSettingsColumn,
    isDirty: propIsDirty,
    onDirtyChange,
    onValidate,
    validate
}) => {
    const location = useLocation();
    const navigate = useNavigate();
    const containerRef = useRef<HTMLDivElement>(null);
    const [internalHeaderHeight, setInternalHeaderHeight] = useState<number | 'auto'>('auto');
    const [internalFooterHeight, setInternalFooterHeight] = useState<number | 'auto'>('auto');

    const headerHeight = propHeaderHeight !== undefined ? propHeaderHeight : internalHeaderHeight;
    const footerHeight = propFooterHeight !== undefined ? propFooterHeight : internalFooterHeight;

    const setHeaderHeight = useCallback((val: number | 'auto') => {
        setInternalHeaderHeight(val);
        if (onHeaderHeightChange) onHeaderHeightChange(val);
    }, [onHeaderHeightChange]);

    const setFooterHeight = useCallback((val: number | 'auto') => {
        setInternalFooterHeight(val);
        if (onFooterHeightChange) onFooterHeightChange(val);
    }, [onFooterHeightChange]);

    const { t } = useTranslation();
    const { setHeaderBreadcrumbOptions, isDocumentDirty, setIsDocumentDirty, setDocumentBackInterceptor } = useHeaderApi() || {};
    const alertDialog = useContext(AlertDialogContext);

    const [internalErrors, setInternalErrors] = useState<Record<string, string>>({});
    const [dismissedGridError, setDismissedGridError] = useState(false);
    const effectiveErrors = useMemo(() => ({
        ...internalErrors,
        ...(errors || {})
    }), [internalErrors, errors]);

    const gridErrorMessage = effectiveErrors?.kalemler || effectiveErrors?.satirlar || effectiveErrors?.items;
    const hasGridError = Boolean(gridErrorMessage && !dismissedGridError);

    const onValidateProp = onValidate || validate;
    const onValidateRef = useRef(onValidateProp);
    useEffect(() => {
        onValidateRef.current = onValidateProp;
    }, [onValidateProp]);

    const isDirtyControlled = propIsDirty !== undefined;
    const initialFormDataRef = useRef<string | null>(null);
    const hasInitializedFormDataRef = useRef<boolean>(false);

    // Form veri giriş alanlarının eksiklik ve validasyon taraması
    const runDocumentValidation = useCallback(() => {
        const detectedErrors: Record<string, string> = {};
        let firstInvalidEl: HTMLElement | null = null;

        // 1. Dışarıdan onValidate/validate prop'u geçilmişse çalıştır
        if (onValidateRef.current) {
            try {
                const res = onValidateRef.current();
                if (typeof res === 'boolean') {
                    if (!res) {
                        detectedErrors['_general'] = t('auto_form_gecersiz', 'Lütfen formdaki eksik alanları doldurunuz.');
                    }
                } else if (res && typeof res === 'object') {
                    if ('isValid' in res) {
                        if (!res.isValid) {
                            if (res.errors && typeof res.errors === 'object') {
                                Object.assign(detectedErrors, res.errors);
                            } else {
                                detectedErrors['_general'] = t('auto_form_gecersiz', 'Lütfen formdaki eksik alanları doldurunuz.');
                            }
                        }
                    } else if (Object.keys(res).length > 0) {
                        Object.assign(detectedErrors, res);
                    }
                }
            } catch (err) {
                console.error('Document onValidate execution error:', err);
            }
        }

        // 2. Dışarıdan errors prop'u gelmişse ve hata varsa
        if (errors && Object.keys(errors).length > 0) {
            Object.assign(detectedErrors, errors);
        }

        // 3. DOM üzerindeki zorunlu alanları tara (.document-header-field)
        const rootContainer = containerRef?.current || (formId ? document.getElementById(formId) : null) || document.querySelector('.base-document-page');
        if (rootContainer) {
            const headerFields = rootContainer.querySelectorAll('.document-header-field');
            headerFields.forEach((hf) => {
                const isRequired = hf.getAttribute('data-required') === 'true' || hf.querySelector('.document-field-label span') !== null;
                const fieldName = hf.getAttribute('data-field-name') || '';
                const labelText = hf.querySelector('.document-field-label')?.textContent?.replace('*', '').trim() || fieldName || t('auto_alan', 'Alan');

                if (isRequired) {
                    let hasValue = false;
                    // Varsa formData kontrolü
                    if (fieldName && formData && formData[fieldName] !== undefined && formData[fieldName] !== null && formData[fieldName] !== '') {
                        if (Array.isArray(formData[fieldName])) {
                            hasValue = formData[fieldName].length > 0;
                        } else if (typeof formData[fieldName] === 'number') {
                            hasValue = formData[fieldName] > 0 || fieldName.toLowerCase().includes('tutar') || fieldName.toLowerCase().includes('oran');
                        } else {
                            hasValue = String(formData[fieldName]).trim().length > 0;
                        }
                    } else if (!fieldName.toLowerCase().endsWith('id')) {
                        // DOM input kontrolü (Sadece ID/Seçici alanı değilse DOM input kontrolü yapılabilir)
                        const inputEl = hf.querySelector('input:not([type="hidden"]), select, textarea') as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
                        if (inputEl) {
                            hasValue = inputEl.value !== undefined && inputEl.value !== null && inputEl.value.trim().length > 0;
                        }
                    }

                    if (!hasValue && fieldName) {
                        detectedErrors[fieldName] = t('auto_bu_alan_zorunludur', '{{label}} alanı zorunludur.', { label: labelText });
                        if (!firstInvalidEl) {
                            firstInvalidEl = (hf.querySelector('input, select, textarea') as HTMLElement) || (hf as HTMLElement);
                        }
                    }
                }
            });

            // Standart HTML required inputları
            const standardRequired = rootContainer.querySelectorAll('input[required]:not([type="hidden"]), select[required], textarea[required]');
            standardRequired.forEach((inputEl: any) => {
                const val = inputEl.value;
                if (!val || !val.trim()) {
                    const name = inputEl.name || inputEl.id || 'requiredField';
                    if (!detectedErrors[name]) {
                        detectedErrors[name] = t('auto_zorunlu_alan', 'Bu alan zorunludur.');
                        if (!firstInvalidEl) firstInvalidEl = inputEl;
                    }
                }
            });
        }

        // 4. Belge Kalemleri / SpreadsheetGrid Kontrolü
        if (gridProps || customDetailContent) {
            const kalemler = formData?.kalemler || gridProps?.data;
            const hasMeaningfulItem = Array.isArray(kalemler) && kalemler.length > 0 && kalemler.some((k: any) => {
                if (!k) return false;
                const hasProduct = Boolean(k.urunVeHizmetKartiId || k.urunId || k.stokId || k.kartId || (k.tedarikciUrunKodu && String(k.tedarikciUrunKodu).trim()));
                const hasAmount = Boolean((k.fiyat && Number(k.fiyat) > 0) || (k.tutar && Number(k.tutar) > 0) || (k.miktar && Number(k.miktar) > 0));
                return hasProduct || hasAmount;
            });

            if (!hasMeaningfulItem && !detectedErrors['kalemler'] && !detectedErrors['satirlar'] && !detectedErrors['items']) {
                detectedErrors['kalemler'] = t('auto_en_az_bir_satir_girilmeli', 'En az bir satır bilgi girilmelidir.');
                if (!firstInvalidEl && rootContainer) {
                    firstInvalidEl = rootContainer.querySelector('.spreadsheet-grid, .detail-container') as HTMLElement;
                }
            }
        }

        const isValid = Object.keys(detectedErrors).length === 0;
        return {
            isValid,
            errors: detectedErrors,
            firstErrorElement: firstInvalidEl
        };
    }, [formData, gridProps?.data, errors, formId, containerRef, t]);

    const backAttemptCountRef = useRef(0);
    const backAttemptTimerRef = useRef<any>(null);

    // Form verisi kullanıcı tarafından değiştirildiğinde çıkış deneme sayacını sıfırla
    useEffect(() => {
        backAttemptCountRef.current = 0;
        if (backAttemptTimerRef.current) {
            clearTimeout(backAttemptTimerRef.current);
            backAttemptTimerRef.current = null;
        }
        setDismissedGridError(false);
    }, [formData]);

    // Geri çıkış interceptor'ı: 1. basışta validasyon ve eksik alanların gösterimi, 2. basışta çıkış
    const handleDocumentBackInterception = useCallback(async (): Promise<boolean> => {
        // 2. basış kontrolü: Kullanıcı daha önce 1. basışta uyarılmışsa ve tekrar basıyorsa
        if (backAttemptCountRef.current >= 1) {
            backAttemptCountRef.current = 0;
            if (backAttemptTimerRef.current) {
                clearTimeout(backAttemptTimerRef.current);
                backAttemptTimerRef.current = null;
            }
            // 2. kez çıkış düğmesine basılıyor -> belgeden çıkılmasına izin ver
            return true;
        }

        // Formda hiçbir veri yoksa ve kullanıcı hiçbir şey değiştirmemişse doğrudan çık
        const isMeaningful = isDocumentDirty || isDocDataMeaningful(formData) || Boolean(documentId);
        if (!isMeaningful) {
            return true;
        }

        // Validasyonu çalıştır
        const validation = runDocumentValidation();

        // Eğer tüm alanlar geçerliyse ve eksik alan yoksa çıkışa izin ver
        if (validation.isValid) {
            return true;
        }

        // Eksik alanlar var! 1. basış muamelesi yap:
        backAttemptCountRef.current = 1;

        // 10 saniye sonra sayacı sıfırla
        if (backAttemptTimerRef.current) clearTimeout(backAttemptTimerRef.current);
        backAttemptTimerRef.current = setTimeout(() => {
            backAttemptCountRef.current = 0;
        }, 10000);

        // Hataları ve eksik alanları formda göster
        setInternalErrors(validation.errors);
        setDismissedGridError(false);

        // İlk hatalı alana odaklan ve kaydır
        if (validation.firstErrorElement) {
            try {
                validation.firstErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                if (typeof validation.firstErrorElement.focus === 'function') {
                    validation.firstErrorElement.focus();
                }
            } catch (e) {}
        }

        // Kullanıcıya açık ve net uyarı toast'u göster
        toast.error(
            t('auto_eksik_alanlar_var_cikmak_icin_tekrar_basin', 'Verisi eksik alanlar bulunmaktadır. Yine de çıkmak için Geri düğmesine tekrar basın.'),
            { id: 'doc-back-validation-toast', duration: 4500 }
        );

        // 1. basışta çıkışı engelle
        return false;
    }, [isDocumentDirty, formData, documentId, runDocumentValidation, t]);

    // HeaderContext üzerindeki interceptor'ı bağla
    useEffect(() => {
        if (setDocumentBackInterceptor) {
            setDocumentBackInterceptor(handleDocumentBackInterception);
        }

        return () => {
            if (setDocumentBackInterceptor) {
                setDocumentBackInterceptor(null);
            }
        };
    }, [setDocumentBackInterceptor, handleDocumentBackInterception]);

    const handleActualBack = useCallback(async () => {
        const canExit = await handleDocumentBackInterception();
        if (!canExit) {
            return;
        }
        if (onBack) {
            onBack();
        } else {
            navigate(-1);
        }
    }, [handleDocumentBackInterception, onBack, navigate]);

    // Dışarıdan isDirty prop'u geçilmişse HeaderContext ile senkronize et
    useEffect(() => {
        if (isDirtyControlled && setIsDocumentDirty) {
            setIsDocumentDirty(Boolean(propIsDirty));
        }
    }, [isDirtyControlled, propIsDirty, setIsDocumentDirty]);

    // SpreadsheetGrid gibi DOM olaylarını yakalayarak formu anında dirty yap
    useEffect(() => {
        const markDirty = () => {
            if (!isDirtyControlled) {
                if (!documentId && !isDocDataMeaningful(formData)) {
                    return;
                }
                if (setIsDocumentDirty) {
                    setIsDocumentDirty(true);
                }
                if (onDirtyChange) {
                    onDirtyChange(true);
                }
            }
        };

        window.addEventListener('spreadsheet-grid-change', markDirty);

        return () => {
            window.removeEventListener('spreadsheet-grid-change', markDirty);
        };
    }, [isDirtyControlled, setIsDocumentDirty, onDirtyChange, documentId, formData]);

    // Programatik form veri değişikliklerini (Cari seçici, modal, datepicker vb.) izleme
    useEffect(() => {
        if (!formData) return;

        // Form ilk kez yüklendiğinde snapshot al
        if (!hasInitializedFormDataRef.current) {
            // Edit modunda backend'den asıl veri gelene kadar bekle
            if (documentId && (!formData.id && (!formData.kalemler || formData.kalemler.length === 0))) {
                return;
            }
            try {
                initialFormDataRef.current = normalizeDocFormData(formData);
                hasInitializedFormDataRef.current = true;
                if (!isDirtyControlled && setIsDocumentDirty) {
                    setIsDocumentDirty(false);
                }
            } catch (e) {
                hasInitializedFormDataRef.current = true;
            }
            return;
        }

        // Form başlatıldıktan sonra formData değişmişse dirty yap, eski haline döndüyse temizle
        if (initialFormDataRef.current !== null) {
            try {
                const currentStr = normalizeDocFormData(formData);
                const isDirty = currentStr !== initialFormDataRef.current;

                if (!isDirtyControlled) {
                    if (setIsDocumentDirty) {
                        setIsDocumentDirty(isDirty);
                    }
                    if (onDirtyChange) {
                        onDirtyChange(isDirty);
                    }
                }
            } catch (e) {}
        }
    }, [formData, documentId, isDirtyControlled, setIsDocumentDirty, onDirtyChange]);

    // Yalnızca açıkça pageTitle verilmişse sekme başlığını güncelle
    useEffect(() => {
        if (pageTitle) {
            updateDocumentTitle(pageTitle);
        }
    }, [pageTitle]);


    // Belge başlığındaki Breadcrumb adımını senkronize et (Yeni Belge veya Belge Numarası)
    useEffect(() => {
        if (!setHeaderBreadcrumbOptions) return;

        const isNew = location.pathname.endsWith('/yeni') || location.pathname.includes('/yeni/');

        if (isNew) {
            setHeaderBreadcrumbOptions({ recordTitle: t('auto_yeni_belge', 'Yeni Belge') });
        } else if (documentNo && String(documentNo).trim()) {
            setHeaderBreadcrumbOptions({ recordTitle: String(documentNo).trim() });
        } else if (documentId) {
            setHeaderBreadcrumbOptions({ recordTitle: `#${documentId}` });
        }

        return () => {
            if (setHeaderBreadcrumbOptions) {
                setHeaderBreadcrumbOptions(null);
            }
        };
    }, [documentNo, documentId, location.pathname, setHeaderBreadcrumbOptions, t]);

    const appliedAiStateRef = useRef<any>(null);
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);

    // AI ile Liste üzerinden yönlendirilen veriyi yakalama (Sonsuz render döngüsünü önlemek için sadece 1 kez çalışır)
    useEffect(() => {
        const aiData = location?.state?.initialAiData;
        if (aiData && onAiApply && appliedAiStateRef.current !== aiData) {
            appliedAiStateRef.current = aiData;
            onAiApply(aiData);
        }
    }, [location?.state?.initialAiData, onAiApply]);

    // Canlı MCP / AI Ajan event dinleyicisi (Açık olan aktif belge formuna doğrudan aktarım)
    useEffect(() => {
        const handleMcpApplyEvent = (event: Event) => {
            const customEvt = event as CustomEvent;
            const detail = customEvt.detail;
            if (!detail || !onAiApply) return;

            // Eğer belirli bir belge türü hedeflendiyse kontrol et
            if (detail.documentType && documentType && 
                detail.documentType.toLowerCase() !== documentType.toLowerCase()) {
                return;
            }

            onAiApply(detail.data || detail, detail.bulutDosyaId || null);
            toast.success(t('auto_mcp_taslak_forma_aktarildi', 'Yapay zeka / MCP taslağı forma aktarıldı.'));
        };

        window.addEventListener('akalin:mcp-apply', handleMcpApplyEvent);
        return () => {
            window.removeEventListener('akalin:mcp-apply', handleMcpApplyEvent);
        };
    }, [documentType, onAiApply, t]);

    const [internalGuid] = useState(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)));
    const effectiveGuid = documentGuid || internalGuid;

    const headerHeightRef = useRef<number | 'auto'>('auto');
    const footerHeightRef = useRef<number | 'auto'>('auto');
    const isResizingHeader = useRef(false);
    const isResizingFooter = useRef(false);
    const headerRef = useRef<HTMLDivElement>(null);
    const footerRef = useRef<HTMLDivElement>(null);

    // Drag state
    const dragStartY = useRef(0);
    const initialHeight = useRef(0);

    // Global auto-focus (Document açıldığında ilk input'a odaklanır)
    useEffect(() => {
        const timer = setTimeout(() => autoFocusFirstInput(containerRef.current), 150);
        return () => clearTimeout(timer);
    }, []);

    // Para birimlerini yükleme (ParaBirimiSelector altyapısıyla uyumlu)
    const [availableCurrencies, setAvailableCurrencies] = useState<any[]>(currencyProps?.currencies || []);

    useEffect(() => {
        if (currencyProps && (!currencyProps.currencies || currencyProps.currencies.length === 0)) {
            let isMounted = true;
            axios.get('/api/ParaBirimleri')
                .then(res => {
                    if (isMounted && Array.isArray(res.data)) {
                        const active = res.data.filter((p: any) => p.aktifMi !== false);
                        if (active.length > 0) {
                            setAvailableCurrencies(active);
                        }
                    }
                })
                .catch(err => {
                    console.debug('BaseDocumentPage currencies load fallback:', err);
                });
            return () => { isMounted = false; };
        }
    }, [currencyProps]);

    const [isMac, setIsMac] = useState(false);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            setIsMac(/Mac|iPod|iPhone|iPad/.test(navigator.platform || ''));
        }
    }, []);

    const handleTriggerSave = useCallback((e?: any) => {
        if (isSaving) return;

        if (onSave) {
            onSave(e);
        } else {
            const formElement = document.getElementById(formId) as HTMLFormElement;
            if (formElement && typeof formElement.requestSubmit === 'function') {
                formElement.requestSubmit();
            } else if (formElement) {
                formElement.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            } else if (onSubmit) {
                onSubmit(e as any);
            }
        }
    }, [isSaving, onSave, onSubmit, formId]);

    // Global klavye kısayolu (Cmd+S / Ctrl+S ile formu anında kaydetme)
    useEffect(() => {
        if (disableKeyboardShortcut) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                handleTriggerSave(e);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [disableKeyboardShortcut, handleTriggerSave]);

    // Load saved heights on mount
    useEffect(() => {
        if (formId) {
            if (propHeaderHeight === undefined) {
                const savedHeader = localStorage.getItem(`BaseDoc_${formId}_headerHeight`);
                if (savedHeader && savedHeader !== 'auto') {
                    setHeaderHeight(parseInt(savedHeader, 10));
                }
            }
            if (propFooterHeight === undefined) {
                const savedFooter = localStorage.getItem(`BaseDoc_${formId}_footerHeight`);
                if (savedFooter && savedFooter !== 'auto') {
                    setFooterHeight(parseInt(savedFooter, 10));
                }
            }
        }
    }, [formId, propHeaderHeight, propFooterHeight, setHeaderHeight, setFooterHeight]);

    // Keep refs up to date for the mouse events
    useEffect(() => {
        headerHeightRef.current = headerHeight;
    }, [headerHeight]);

    useEffect(() => {
        footerHeightRef.current = footerHeight;
    }, [footerHeight]);

    // Sekme (Tab) değiştiğinde farklı içerik yüksekliklerine (ör. Genel vs Not sekmesi)
    // otomatik uyum sağlaması için header yüksekliğini dinamik 'auto' değerine çek.
    const isFirstMount = useRef(true);
    useEffect(() => {
        if (isFirstMount.current) {
            isFirstMount.current = false;
            return;
        }
        if (propHeaderHeight === undefined) {
            setHeaderHeight('auto');
            if (formId) {
                localStorage.removeItem(`BaseDoc_${formId}_headerHeight`);
            }
        }
    }, [activeTabId, formId, propHeaderHeight, setHeaderHeight]);

    // Belge sayfasında dış container'ların (content-area, form) istenmeyen bir şekilde
    // kaydırılmasını (scrollTop > 0) önlemek ve Header'ın daima en üstte görünür kalmasını sağlamak
    useEffect(() => {
        const resetContainerScroll = () => {
            const contentArea = containerRef.current?.closest('.content-area') || document.querySelector('.content-area');
            if (contentArea && contentArea.scrollTop > 0) {
                contentArea.scrollTop = 0;
            }
            if (containerRef.current) {
                if (containerRef.current.scrollTop > 0) containerRef.current.scrollTop = 0;
                const formEl = containerRef.current.querySelector('form');
                if (formEl && formEl.scrollTop > 0) formEl.scrollTop = 0;
            }
        };

        resetContainerScroll();
        const tId = setTimeout(resetContainerScroll, 100);
        return () => clearTimeout(tId);
    }, [activeTabId]);

    // Setup global mouse events for resizing
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingHeader.current && !isResizingFooter.current) return;

            if (isResizingHeader.current) {
                const deltaY = e.clientY - dragStartY.current;
                let newHeight = initialHeight.current + deltaY;
                if (newHeight < minHeaderHeight) newHeight = minHeaderHeight;
                if (maxHeaderHeight && newHeight > maxHeaderHeight) newHeight = maxHeaderHeight;
                setHeaderHeight(newHeight);
            }
            if (isResizingFooter.current) {
                const deltaY = dragStartY.current - e.clientY; // Moving mouse UP increases footer height
                let newHeight = initialHeight.current + deltaY;
                if (newHeight < minFooterHeight) newHeight = minFooterHeight;
                if (maxFooterHeight && newHeight > maxFooterHeight) newHeight = maxFooterHeight;
                setFooterHeight(newHeight);
            }
        };

        const handleMouseUp = () => {
            if (isResizingHeader.current || isResizingFooter.current) {
                isResizingHeader.current = false;
                isResizingFooter.current = false;

                // Save to localStorage when drag ends
                if (formId) {
                    if (headerHeightRef.current !== 'auto') {
                        localStorage.setItem(`BaseDoc_${formId}_headerHeight`, headerHeightRef.current.toString());
                    }
                    if (footerHeightRef.current !== 'auto') {
                        localStorage.setItem(`BaseDoc_${formId}_footerHeight`, footerHeightRef.current.toString());
                    }
                }
                document.body.style.cursor = 'default';
                document.body.style.userSelect = 'auto';
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [formId]);

    const startResizeHeader = (e: React.MouseEvent) => {
        e.preventDefault();
        isResizingHeader.current = true;
        dragStartY.current = e.clientY;
        const el = headerRef.current || (e.currentTarget as HTMLElement).parentElement;
        initialHeight.current = el ? el.getBoundingClientRect().height : (headerHeightRef.current === 'auto' ? minHeaderHeight : headerHeightRef.current);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    };

    const startResizeFooter = (e: React.MouseEvent) => {
        e.preventDefault();
        isResizingFooter.current = true;
        dragStartY.current = e.clientY;
        const el = footerRef.current || (e.currentTarget as HTMLElement).parentElement;
        initialHeight.current = el ? el.getBoundingClientRect().height : (footerHeightRef.current === 'auto' ? minFooterHeight : footerHeightRef.current);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    };

    const isCloudRoute = location.pathname.endsWith('/bulut-dosyalari');
    const [localShowCloudFiles, setLocalShowCloudFiles] = useState(false);
    const showCloudFiles = isCloudRoute || localShowCloudFiles;

    useEffect(() => {
        if (!location.pathname.endsWith('/bulut-dosyalari')) {
            setLocalShowCloudFiles(false);
        }
    }, [location.pathname]);

    const handleOpenCloudFiles = useCallback(async () => {
        try {
            const res = await axios.get('/api/Storage/Entegrasyonlar');
            const data = res.data;
            const active = Array.isArray(data) && data.length > 0 && data.some((i: any) => i.isConnected !== false);
            if (!active) {
                if (alertDialog?.showAlert) {
                    alertDialog.showAlert(
                        'warning',
                        t('BulutDepolama_entegrasyonYokBaslik', 'Bulut Depolama Entegrasyonu Bulunamadı'),
                        t('BulutDepolama_entegrasyonYokMesaj', 'Bulut depolama için henüz hiçbir entegrasyon yapılmamış. Dosyaları görüntülemek veya yüklemek için lütfen en az bir bulut sağlayıcısı entegre ediniz.'),
                        () => navigate('/ayarlar/bulut-depolama'),
                        t('BulutDepolama_entegrasyonSayfasinaGit', 'Entegrasyon Ayarlarına Git'),
                        t('Iptal', 'İptal'),
                        true
                    );
                }
                return;
            }
        } catch (e) {
            if (alertDialog?.showAlert) {
                alertDialog.showAlert(
                    'warning',
                    t('BulutDepolama_entegrasyonYokBaslik', 'Bulut Depolama Entegrasyonu Bulunamadı'),
                    t('BulutDepolama_entegrasyonYokMesaj', 'Bulut depolama için henüz hiçbir entegrasyon yapılmamış. Dosyaları görüntülemek veya yüklemek için lütfen en az bir bulut sağlayıcısı entegre ediniz.'),
                    () => navigate('/ayarlar/bulut-depolama'),
                    t('BulutDepolama_entegrasyonSayfasinaGit', 'Entegrasyon Ayarlarına Git'),
                    t('Iptal', 'İptal'),
                    true
                );
            }
            return;
        }

        if (formData && documentType) {
            try {
                sessionStorage.setItem(`akalin_${documentType.toLowerCase()}_draft`, JSON.stringify(formData));
            } catch (e) {}
        }
        if (!isCloudRoute) {
            const cleanPath = location.pathname.replace(/\/+$/, '');
            navigate(`${cleanPath}/bulut-dosyalari`, {
                state: {
                    ...location.state,
                    currentFormData: formData || location.state?.currentFormData
                }
            });
        }
        setLocalShowCloudFiles(true);
    }, [isCloudRoute, location.pathname, location.state, formData, documentType, navigate, alertDialog, t]);

    const handleCloseCloudFiles = useCallback(() => {
        setLocalShowCloudFiles(false);
        if (location.pathname.endsWith('/bulut-dosyalari')) {
            const parentPath = location.pathname.replace(/\/bulut-dosyalari$/, '');
            navigate(parentPath, {
                state: {
                    ...location.state,
                    currentFormData: formData || location.state?.currentFormData
                }
            });
        }
    }, [location.pathname, location.state, formData, navigate]);

    // Para birimleri listesi ve sembol hesaplama (TRY, USD, EUR, GBP standart dövizlerini her zaman sun)
    const displayCurrencies = (() => {
        const list = [...availableCurrencies];
        const defaultCurrencies = [
            { kod: 'TRY', sembol: '₺', ad: t('Türk Lirası', 'Türk Lirası') },
            { kod: 'USD', sembol: '$', ad: t('ABD Doları', 'ABD Doları') },
            { kod: 'EUR', sembol: '€', ad: t('Euro', 'Euro') },
            { kod: 'GBP', sembol: '£', ad: t('İngiliz Sterlini', 'İngiliz Sterlini') }
        ];
        for (const d of defaultCurrencies) {
            if (!list.some(c => (c.kod || '').toUpperCase() === d.kod)) {
                list.push(d);
            }
        }
        return list;
    })();

    const currentCurrency = (currencyProps?.value || 'TRY').toUpperCase();
    const currentSymbol = getCurrencySymbolHelper(currentCurrency);

    // ActionMenu içerisinde şık Para Birimi seçici başlığı
    const currencyDropdownHeader = currencyProps ? (
        <div className="action-menu-currency-header">
            <div className="action-menu-currency-title">
                <span className="flex items-center gap-4">
                    <Coins size={14} className="text-secondary" />
                    <span>{t('Para Birimi', 'Para Birimi')}</span>
                </span>
                <span className="text-xs font-semibold text-primary">{currentCurrency}</span>
            </div>
            <div className="action-menu-currency-grid">
                {displayCurrencies.map((curr: any) => {
                    const code = (curr.kod || curr.code || '').toUpperCase();
                    const symbol = curr.sembol || curr.symbol || getCurrencySymbolHelper(code);
                    const isActive = code === currentCurrency;
                    return (
                        <button
                            key={code}
                            type="button"
                            className={`currency-chip-btn ${isActive ? 'active' : ''}`}
                            disabled={currencyProps.disabled}
                            onClick={() => {
                                if (currencyProps.onChange) {
                                    currencyProps.onChange(code, curr);
                                }
                            }}
                            title={`${code} - ${curr.ad || ''}`}
                        >
                            <span className="currency-chip-symbol">{symbol}</span>
                            <span className="currency-chip-code">{code}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    ) : null;

    // Menü öğeleri kaldırılmasın/gizlenmesin: Para birimi seçici başlığı (currencyDropdownHeader)
    // varsa her zaman korunmalıdır. Harici bir başlık (propActionMenuDropdownHeader)
    // varsa birlikte sunulur.
    const effectiveDropdownHeader = currencyDropdownHeader ? (
        <>
            {propActionMenuDropdownHeader}
            {currencyDropdownHeader}
        </>
    ) : propActionMenuDropdownHeader;

    // Çocuğun (kullanan sayfanın) ActionMenu varsayılanını ezip ezmediğini tespit et:
    // 1. extraDropdownActions içerisinde açıkça isDefault veya default olan bir aksiyon var mı?
    // 2. veya dışarıdan özel bir actionMenuTrigger (örn. Adres Seçimi veya Excel'den Veri Al) verilmiş mi?
    const hasChildExplicitDefault = Boolean(
        extraDropdownActions?.some(a => !a.hidden && (a.isDefault || a.default))
    );
    const hasCustomTrigger = propActionMenuTrigger !== undefined;
    const isChildOverridingDefault = hasChildExplicitDefault || hasCustomTrigger;

    // ActionMenu'nün varsayılan işlemi: "Kaydet"
    // Sayfa varsayılanı ezmişse, "Kaydet" isDefault: false olarak menüde bir seçenek olarak KALMAYA DEVAM EDER.
    // Sayfa varsayılanı ezmemişse, "Kaydet" isDefault: true olarak ActionMenu'nün ana varsayılan split-button işlemi olur.
    const saveActionItem: ActionMenuItem | null = !hideSaveButton ? {
        label: isSaving ? t('Kaydediliyor', 'Kaydediliyor...') : (saveButtonText || t('Kaydet', 'Kaydet')),
        icon: isSaving ? <Loader2 size={15} className="document-save-spinner" /> : <Save size={15} />,
        badge: <kbd className="document-save-hotkey">{isMac ? '⌘S' : 'Ctrl+S'}</kbd>,
        isDefault: !isChildOverridingDefault,
        variant: !isChildOverridingDefault ? 'primary' : 'default',
        disabled: isSaving,
        onClick: handleTriggerSave
    } : null;

    // ActionMenu tetikleyici rozeti (aktif para birimi ve sembolü veya dışarıdan sağlanan özel tetikleyici)
    const defaultCurrencyTrigger = currencyProps ? (
        <span className="action-menu-currency-badge">
            <span className="currency-symbol">{currentSymbol}</span>
            <span className="currency-code">{currentCurrency}</span>
        </span>
    ) : undefined;

    // Özel sekme tetikleyicisi (örn. Adres Seçimi veya Excel'den Veri Al) varsa önceliklidir;
    // Eğer yoksa ve Kaydet gizli ise para birimi rozeti tetikleyici olarak kullanılır.
    // Aksi halde tetikleyici boştur ve ActionMenu doğrudan varsayılan aksiyonu (Kaydet) split-button olarak gösterir.
    const effectiveActionMenuTrigger = propActionMenuTrigger !== undefined
        ? propActionMenuTrigger
        : (hideSaveButton ? defaultCurrencyTrigger : undefined);

    const effectiveOnActionMenuTriggerClick = propActionMenuTrigger !== undefined
        ? propOnActionMenuTriggerClick
        : undefined;

    const aiActionItem: ActionMenuItem | null = (onAiApply && enableAiAssistant !== false) ? {
        label: t('auto_ai_asistan_mcp', 'Yapay Zeka Asistanı & MCP'),
        icon: <Sparkles size={16} />,
        dividerAbove: true,
        onClick: () => setIsAiModalOpen(true)
    } : null;

    // Menü aksiyonlarının sıralanması:
    // Eğer sayfa varsayılanı ezmişse (örn. Excel'den Veri Al isDefault: true):
    // Sayfanın varsayılan aksiyonu öne çıkar, "Kaydet" menüde seçenek olarak kalmaya devam eder.
    const actionsList: ActionMenuItem[] = (() => {
        if (!saveActionItem) {
            return [
                ...(extraDropdownActions || []),
                ...(aiActionItem ? [aiActionItem] : []),
                {
                    label: t('Bulut Dosyaları', 'Bulut Dosyaları'),
                    icon: <Cloud size={16} />,
                    dividerAbove: !aiActionItem && Boolean(extraDropdownActions && extraDropdownActions.length > 0),
                    onClick: handleOpenCloudFiles
                }
            ];
        }

        if (isChildOverridingDefault) {
            // Çocuk varsayılanı ezdi:
            // Eğer extraDropdownActions içinde bir default aksiyon varsa, saveActionItem onun hemen ardına eklenir
            const childDefaultIdx = (extraDropdownActions || []).findIndex(a => !a.hidden && (a.isDefault || a.default));
            if (childDefaultIdx !== -1) {
                const before = (extraDropdownActions || []).slice(0, childDefaultIdx + 1);
                const after = (extraDropdownActions || []).slice(childDefaultIdx + 1);
                return [
                    ...before,
                    saveActionItem,
                    ...after,
                    ...(aiActionItem ? [aiActionItem] : []),
                    {
                        label: t('Bulut Dosyaları', 'Bulut Dosyaları'),
                        icon: <Cloud size={16} />,
                        dividerAbove: !aiActionItem,
                        onClick: handleOpenCloudFiles
                    }
                ];
            }

            return [
                ...(extraDropdownActions || []),
                saveActionItem,
                ...(aiActionItem ? [aiActionItem] : []),
                {
                    label: t('Bulut Dosyaları', 'Bulut Dosyaları'),
                    icon: <Cloud size={16} />,
                    dividerAbove: !aiActionItem,
                    onClick: handleOpenCloudFiles
                }
            ];
        }

        // Normal durum: "Kaydet" en baştaki varsayılan aksiyondur
        return [
            saveActionItem,
            ...(extraDropdownActions || []),
            ...(aiActionItem ? [aiActionItem] : []),
            {
                label: t('Bulut Dosyaları', 'Bulut Dosyaları'),
                icon: <Cloud size={16} />,
                dividerAbove: !aiActionItem && (Boolean(extraDropdownActions && extraDropdownActions.length > 0) || Boolean(saveActionItem)),
                onClick: handleOpenCloudFiles
            }
        ];
    })();

    const documentActionMenu = customActionMenu !== undefined ? customActionMenu : (
        <ActionMenu
            showDefaultActionAsButton={true}
            triggerLabel={effectiveActionMenuTrigger}
            onTriggerLabelClick={effectiveOnActionMenuTriggerClick}
            dropdownHeader={effectiveDropdownHeader}
            actions={actionsList}
        />
    );

    if (isCloudRoute) {
        return (
            <FilesOnClouds 
                isOpen={true}
                isModal={false}
                asPage={true}
                documentId={documentId} 
                documentGuid={effectiveGuid}
                documentType={documentType} 
                documentNo={documentNo}
                onClose={handleCloseCloudFiles} 
            />
        );
    }

    return (
        <DocumentFormContext.Provider value={{ 
            errors: effectiveErrors,
            isDirty: isDocumentDirty,
            setIsDirty: setIsDocumentDirty,
            markDirty: () => {
                if (setIsDocumentDirty) setIsDocumentDirty(true);
                if (onDirtyChange) onDirtyChange(true);
            },
            clearDirty: () => {
                if (setIsDocumentDirty) setIsDocumentDirty(false);
                if (onDirtyChange) onDirtyChange(false);
            }
        }}>
            <BasePage
                id={formId}
                asForm={true}
                onSubmit={(e) => { e.preventDefault(); onSubmit && onSubmit(e); }}
                title={undefined}
                onClose={handleActualBack}
                disableContentWrapper={true}
                containerRef={containerRef}
            >

                    {/* 1. SABİT BÖLÜM: Başlık ve Üst Bilgiler */}
                    <div
                        ref={headerRef}
                        className={`document-page-header ${headerClassName || ''}`}
                        style={{
                            height: headerHeight !== 'auto' ? `${headerHeight}px` : 'auto',
                            minHeight: minHeaderHeight ? `${minHeaderHeight}px` : undefined,
                            maxHeight: maxHeaderHeight ? `${maxHeaderHeight}px` : undefined,
                            ...(contentMaxWidth ? { maxWidth: contentMaxWidth, margin: '0 auto', width: '100%' } : {})
                        }}
                    >
                        <div
                            className="document-page-header-body"
                            style={{ overflowY: headerHeight !== 'auto' ? 'auto' : 'visible' }}
                        >
                            {tabs && tabs.length > 1 ? (
                                <TabLayout
                                    tabs={tabs.map(t => ({ ...t, label: (t as any).label || t.title || (t as any).name })) as any}
                                    activeId={activeTabId}
                                    onChange={onTabChange}
                                    rightContent={
                                        <div className="document-page-tab-actions">
                                            {headerActions}
                                            {documentActionMenu}
                                        </div>
                                    }
                                />
                            ) : (
                                <div className="document-page-top-bar">
                                    {headerActions}
                                    {documentActionMenu}
                                </div>
                            )}

                            {headerContent && (
                                <div className="document-page-header-content">
                                    {headerContent}
                                </div>
                            )}
                        </div>
                        {/* HEADER RESIZER */}
                        <HorizontalResizer
                            onMouseDown={startResizeHeader}
                            onDoubleClick={() => {
                                setHeaderHeight('auto');
                                if (formId) localStorage.removeItem(`BaseDoc_${formId}_headerHeight`);
                            }}
                        />
                    </div>

                    {/* 2. KAYDIRILABİLİR BÖLÜM: Belge Kalemleri (Datasheet) */}
                    <div 
                        className={`document-page-detail ${detailClassName || ''}`}
                        style={contentMaxWidth ? { maxWidth: contentMaxWidth, margin: '0 auto', width: '100%' } : undefined}
                    >
                        <div className={`document-page-detail-inner ${hasGridError ? 'has-validation-error' : ''}`}>
                            {customDetailContent ? customDetailContent : (
                                gridProps && (
                                    <SpreadsheetGrid
                                        bordered={false}
                                        {...(settingsColumnPosition !== undefined ? { settingsColumnPosition } : {})}
                                        {...(pinSettingsColumn !== undefined ? { pinSettingsColumn } : {})}
                                        {...gridProps}
                                    />
                                )
                            )}
                            {hasGridError && (
                                <div 
                                    className="document-grid-validation-badge"
                                    onClick={() => {
                                        const firstInput = containerRef.current?.querySelector('.spreadsheet-grid tbody tr:first-child input, .spreadsheet-grid tbody tr:first-child td') as HTMLElement;
                                        if (firstInput) {
                                            firstInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            firstInput.focus?.();
                                        }
                                    }}
                                >
                                    <AlertCircle size={15} className="badge-icon" />
                                    <span>{gridErrorMessage}</span>
                                    <button 
                                        type="button" 
                                        className="badge-close-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setDismissedGridError(true);
                                        }}
                                        title={t('Kapat', 'Kapat')}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 3. SABİT BÖLÜM: Footer (Alt Toplamlar) */}
                    {footerContent && (
                        <div
                            ref={footerRef}
                            className={`document-page-footer ${footerClassName || ''}`}
                            style={{
                                height: footerHeight !== 'auto' ? `${footerHeight}px` : 'auto',
                                minHeight: minFooterHeight ? `${minFooterHeight}px` : undefined,
                                maxHeight: maxFooterHeight ? `${maxFooterHeight}px` : undefined,
                                ...(contentMaxWidth ? { maxWidth: contentMaxWidth, margin: '0 auto', width: '100%' } : {})
                            }}
                        >
                            {/* FOOTER RESIZER */}
                            <HorizontalResizer
                                onMouseDown={startResizeFooter}
                                onDoubleClick={() => {
                                    setFooterHeight('auto');
                                    if (formId) localStorage.removeItem(`BaseDoc_${formId}_footerHeight`);
                                }}
                            />

                            <div className="document-page-footer-content">
                                {footerContent}
                            </div>
                        </div>
                    )}

                </BasePage>

                {documentType && localShowCloudFiles && (
                    <FilesOnClouds 
                        isOpen={localShowCloudFiles}
                        documentId={documentId} 
                        documentGuid={effectiveGuid}
                        documentType={documentType} 
                        documentNo={documentNo}
                        onClose={handleCloseCloudFiles} 
                    />
                )}

                {onAiApply && enableAiAssistant !== false && (
                    <BaseAiAssistantModal
                        isOpen={isAiModalOpen}
                        onClose={() => setIsAiModalOpen(false)}
                        documentType={documentType || 'Belge'}
                        documentId={documentId}
                        currentFormData={formData}
                        onApply={(data, bulutDosyaId) => {
                            onAiApply(data, bulutDosyaId);
                        }}
                    />
                )}
        </DocumentFormContext.Provider>
    );
};

export default BaseDocumentPage;

