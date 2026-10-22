/**
 * ============================================================================
 * BaseWizardPage
 * ============================================================================
 * Çok adımlı sihirbaz (Wizard) iş akışlarını tam sayfa düzeninde BasePage yapısı
 * kullanarak yöneten temel bileşendir.
 *
 * Sorumlulukları ve Yetenekleri:
 * - BasePage iskeletini kullanarak sayfa başlığı, geri/kapatma navigasyonu ve üst çubuğu yönetir.
 * - Çok adımlı WizardStep çocuk bileşenlerini sırasıyla stepper göstergesiyle sunar.
 * - "İleri" butonu her zaman aktif olup sonraki adıma geçmeden önce validation (onValidate / isValid) kontrollerini tetikler.
 * - Doğrulama başarısız olursa kullanıcı ilgili adımda tutulur ve hata bildirimleri gösterilir.
 * - Adımlar arası ileri, geri, iptal ve tamamlama (onFinish) eylemlerini kontrol eder.
 * - Aktif Aşama Hafızası (Step Preservation): Alt sayfalara ("Para Birimleri", "Vergi/KDV" vb.) 
 *   yönlenip geri gelindiğinde kullanıcının kaldığı adımı (location.state, sessionStorage veya props) 
 *   otomatik hatırlayarak geri yükler.
 * - i18n çok dilli desteği ve Material Design 3 tasarım token'ları ile tam uyumludur.
 * ============================================================================
 */
import React, { 
    useState, 
    ReactNode, 
    isValidElement, 
    Children, 
    useEffect, 
    useRef, 
    useCallback 
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BaseCardPageHeader, { BaseCardPageHeaderProps } from '../../components/card/BaseCardPageHeader';
import BackButton from '../../components/button/BackButton';
import { useHeaderApi } from '../../context/HeaderContext';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { updateDocumentTitle } from '../../utils/domUtils';
import NextButton from '../../components/button/NextButton';
import PrevButton from '../../components/button/PrevButton';
import FinishButton from '../../components/button/FinishButton';
import CancelButton from '../../components/button/CancelButton';

export interface WizardStepProps {
    id?: string;
    title: string;
    children: ReactNode;
    isValid?: boolean; // Adımın geçerli olup olmadığını kontrol etmek için
    onValidate?: () => boolean | Promise<boolean>; // İleri gitmeden önce çalıştırılacak doğrulama fonksiyonu
}

export const WizardStep: React.FC<WizardStepProps> = ({ children }) => {
    return <div className="wizard-step-content flex flex-col flex-1 w-full">{children}</div>;
};

export interface BaseWizardPageProps {
    id?: string;
    title: string;
    pageTitle?: string;
    icon?: ReactNode;
    subtitle?: ReactNode;
    subtitleLeft?: ReactNode;
    subtitleRight?: ReactNode;
    headerExtra?: ReactNode;
    headerProps?: Partial<BaseCardPageHeaderProps>;
    showBackButton?: boolean;
    className?: string;
    isOpen?: boolean;
    onClose?: () => void | Promise<void>;
    size?: 'md' | 'lg' | 'xl';
    onFinish: () => void | Promise<void>;
    children: ReactNode;
    finishText?: string;
    isFinishing?: boolean;
    asForm?: boolean;
    hideBreadcrumb?: boolean;
    onStepChange?: (stepIndex: number) => void;
    onBeforeStepChange?: (currentStepIndex: number, nextStepIndex: number) => boolean | Promise<boolean>;
    containerRef?: React.RefObject<HTMLDivElement>;

    // Aktif Aşama / Adım Yönetimi & Hafıza (Step Preservation)
    activeStepIndex?: number;
    activeStepId?: string;
    initialStepIndex?: number;
    initialStepId?: string;
    persistStep?: boolean;
    storageKey?: string;
}

const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const resolveStepIndex = (
    target: any,
    stepList: React.ReactElement<WizardStepProps>[]
): number | null => {
    if (target === undefined || target === null || target === '' || !stepList || stepList.length === 0) {
        return null;
    }

    // 1. Doğrudan sayısal indeks (0, 1, 2...)
    if (typeof target === 'number' && target >= 0 && target < stepList.length) {
        return target;
    }

    // 2. String sayı ("0", "1", "2")
    if (typeof target === 'string' && /^\d+$/.test(target.trim())) {
        const num = parseInt(target.trim(), 10);
        if (num >= 0 && num < stepList.length) {
            return num;
        }
    }

    // 3. String eşleşmesi: ID, Title veya Slug
    if (typeof target === 'string') {
        const raw = target.trim();
        const lower = raw.toLowerCase();

        // 3.1. step.props.id ile birebir / case-insensitive eşleşme
        const idIdx = stepList.findIndex(s => s.props?.id && s.props.id.toLowerCase() === lower);
        if (idIdx !== -1) return idIdx;

        // 3.2. step.props.title ile eşleşme
        const titleIdx = stepList.findIndex(s => s.props?.title && s.props.title.toLowerCase() === lower);
        if (titleIdx !== -1) return titleIdx;

        // 3.3. Slug eşleşmesi (ör: "sektorelAyarlar" <=> "Sektörel Ayarlar")
        const targetSlug = toSlug(raw);
        if (targetSlug) {
            const slugIdx = stepList.findIndex(s => {
                const sIdSlug = s.props?.id ? toSlug(s.props.id) : '';
                const sTitleSlug = s.props?.title ? toSlug(s.props.title) : '';
                return (sIdSlug && sIdSlug === targetSlug) || (sTitleSlug && sTitleSlug === targetSlug);
            });
            if (slugIdx !== -1) return slugIdx;
        }
    }

    return null;
};

const BaseWizardPage: React.FC<BaseWizardPageProps> = ({
    id,
    title,
    pageTitle,
    icon,
    subtitle,
    subtitleLeft,
    subtitleRight,
    headerExtra,
    headerProps,
    showBackButton = true,
    className = '',
    isOpen = true,
    onClose,
    onFinish,
    children,
    finishText,
    isFinishing = false,
    asForm = false,
    hideBreadcrumb = false,
    onStepChange,
    onBeforeStepChange,
    containerRef,
    activeStepIndex,
    activeStepId,
    initialStepIndex,
    initialStepId,
    persistStep = true,
    storageKey
}) => {
    const { t } = useTranslation();

    let location: any = null;
    try {
        location = useLocation();
    } catch {
        // Router context dışında render edilirse
    }

    let navigate: any = null;
    try {
        navigate = useNavigate();
    } catch {
        // Router context dışında render edilirse
    }

    useEffect(() => {
        updateDocumentTitle(pageTitle || title);
    }, [pageTitle, title]);

    const steps = Children.toArray(children).filter((child) => isValidElement(child)) as React.ReactElement<WizardStepProps>[];
    const totalSteps = steps.length;

    const resolvedStorageKey = storageKey || (id ? `akalin_wizard_step_${id}` : (location?.pathname ? `akalin_wizard_step_${location.pathname.replace(/\/+$/, '')}` : null));

    const getStoredStep = useCallback((): number | null => {
        if (persistStep === false || !resolvedStorageKey) return null;
        try {
            const raw = sessionStorage.getItem(resolvedStorageKey);
            if (!raw) return null;

            try {
                const parsed = JSON.parse(raw);
                if (typeof parsed === 'number') {
                    return resolveStepIndex(parsed, steps);
                }
                if (parsed && typeof parsed === 'object') {
                    if (parsed.id !== undefined) {
                        const byId = resolveStepIndex(parsed.id, steps);
                        if (byId !== null) return byId;
                    }
                    if (parsed.index !== undefined) {
                        const byIndex = resolveStepIndex(parsed.index, steps);
                        if (byIndex !== null) return byIndex;
                    }
                }
            } catch {
                return resolveStepIndex(raw, steps);
            }
        } catch {
            // Storage erişim hatası
        }
        return null;
    }, [persistStep, resolvedStorageKey, steps]);

    const saveStepToStorage = useCallback((stepIdx: number) => {
        if (persistStep === false || !resolvedStorageKey) return;
        try {
            const stepItem = steps[stepIdx];
            const stepId = stepItem?.props?.id || null;
            sessionStorage.setItem(resolvedStorageKey, JSON.stringify({
                index: stepIdx,
                id: stepId,
                title: stepItem?.props?.title,
                timestamp: Date.now()
            }));
        } catch {
            // Ignore
        }
    }, [persistStep, resolvedStorageKey, steps]);

    const clearStepFromStorage = useCallback(() => {
        if (!resolvedStorageKey) return;
        try {
            sessionStorage.removeItem(resolvedStorageKey);
        } catch {
            // Ignore
        }
    }, [resolvedStorageKey]);

    const determineInitialStep = useCallback((): number => {
        // 0. Temiz / Sıfır Başlangıç Kontrolü (isNew, clean, resetStep)
        if (location?.state?.isNew || location?.state?.clean || location?.state?.resetStep) {
            clearStepFromStorage();
            return 0;
        }

        // 1. Kontrollü prop'lar
        if (activeStepIndex !== undefined) {
            const idx = resolveStepIndex(activeStepIndex, steps);
            if (idx !== null) return idx;
        }
        if (activeStepId !== undefined) {
            const idx = resolveStepIndex(activeStepId, steps);
            if (idx !== null) return idx;
        }

        // 2. React Router location.state (alt sayfadan geri dönüş veya yönlendirme)
        if (location?.state) {
            const state = location.state;
            const stateCandidates = [
                state.activeStepIndex,
                state.stepIndex,
                state.step,
                state.activeStepId,
                state.activeTabId,
                state.tabId,
                state.currentStep
            ];
            for (const candidate of stateCandidates) {
                if (candidate !== undefined && candidate !== null) {
                    const idx = resolveStepIndex(candidate, steps);
                    if (idx !== null) return idx;
                }
            }
        }

        // 3. URL Query Parametreleri (?step=... veya ?tab=...)
        if (location?.search) {
            try {
                const searchParams = new URLSearchParams(location.search);
                const queryCandidates = [
                    searchParams.get('step'),
                    searchParams.get('stepIndex'),
                    searchParams.get('tab'),
                    searchParams.get('activeTab')
                ];
                for (const candidate of queryCandidates) {
                    if (candidate) {
                        const idx = resolveStepIndex(candidate, steps);
                        if (idx !== null) return idx;
                    }
                }
            } catch {
                // Ignore
            }
        }

        // 4. Session Storage (sayfalar arası hafıza)
        const stored = getStoredStep();
        if (stored !== null) {
            return stored;
        }

        // 5. Başlangıç prop'ları
        if (initialStepIndex !== undefined) {
            const idx = resolveStepIndex(initialStepIndex, steps);
            if (idx !== null) return idx;
        }
        if (initialStepId !== undefined) {
            const idx = resolveStepIndex(initialStepId, steps);
            if (idx !== null) return idx;
        }

        return 0;
    }, [activeStepIndex, activeStepId, location?.state, location?.search, getStoredStep, initialStepIndex, initialStepId, steps, clearStepFromStorage]);

    const [currentStepIndex, setCurrentStepIndex] = useState<number>(() => {
        return determineInitialStep();
    });
    const [isCancelling, setIsCancelling] = useState<boolean>(false);

    // Modal açılıp kapandığında (isOpen geçişlerinde) adım senkronizasyonu
    const prevIsOpenRef = useRef(isOpen);
    useEffect(() => {
        if (!prevIsOpenRef.current && isOpen) {
            const initial = determineInitialStep();
            setCurrentStepIndex(initial);
        } else if (prevIsOpenRef.current && !isOpen) {
            clearStepFromStorage();
        }
        prevIsOpenRef.current = isOpen;
    }, [isOpen, determineInitialStep, clearStepFromStorage]);

    // Sayfa ilk yüklendiğinde mevcut adımı hafızaya yaz
    useEffect(() => {
        if (isOpen) {
            saveStepToStorage(currentStepIndex);
        }
    }, []);

    // Sayfadan tamamen ayrıldığında (alt sayfalara değil, başka bir ana menü/rotaya gidildiğinde) hafızayı temizle
    const currentPathnameRef = useRef(location?.pathname || '');
    useEffect(() => {
        currentPathnameRef.current = location?.pathname || '';
    }, [location?.pathname]);

    useEffect(() => {
        return () => {
            try {
                const currentPath = currentPathnameRef.current.replace(/\/+$/, '');
                const destinationPath = window.location.pathname.replace(/\/+$/, '');
                
                // Eğer gidilen adres mevcut sihirbazın bir alt sayfası DEĞİLSE (örn: /firmalar/yeni -> /firmalar)
                // hafızadaki adımı temizle ki kullanıcı menüden geldiğinde temiz başlasın.
                const isSubRoute = currentPath && destinationPath.startsWith(currentPath + '/');
                if (!isSubRoute) {
                    clearStepFromStorage();
                }
            } catch (e) {
                // Ignore
            }
        };
    }, [clearStepFromStorage]);

    // location.state değiştiğinde (örneğin alt sayfadan geri dönüldüğünde veya isNew ile gelindiğinde) adımı güncelle
    // Sadece gerçek rota geçişlerinde (location.key değiştiğinde) 1 kez işletilir; iç adım değişimlerinde tekrarlanmaz.
    const lastProcessedLocationKeyRef = useRef<string | null>(location?.key || 'initial');
    useEffect(() => {
        const currentKey = location?.key || 'initial';
        if (currentKey === lastProcessedLocationKeyRef.current) {
            return;
        }
        lastProcessedLocationKeyRef.current = currentKey;

        if (location?.state) {
            if (location.state.isNew || location.state.clean || location.state.resetStep) {
                clearStepFromStorage();
                setCurrentStepIndex(0);
                if (onStepChange) onStepChange(0);
                return;
            }

            const state = location.state;
            const stateCandidates = [
                state.activeStepIndex,
                state.stepIndex,
                state.step,
                state.activeStepId,
                state.activeTabId,
                state.tabId,
                state.currentStep
            ];
            for (const candidate of stateCandidates) {
                if (candidate !== undefined && candidate !== null) {
                    const idx = resolveStepIndex(candidate, steps);
                    if (idx !== null) {
                        setCurrentStepIndex(idx);
                        saveStepToStorage(idx);
                        if (onStepChange) onStepChange(idx);
                        break;
                    }
                }
            }
        }
    }, [location?.key, location?.state, clearStepFromStorage, onStepChange, saveStepToStorage, steps]);

    // Kontrollü prop'lar değiştiğinde adımı güncelle
    const prevActiveIndexRef = useRef(activeStepIndex);
    const prevActiveIdRef = useRef(activeStepId);
    useEffect(() => {
        if (activeStepIndex !== undefined && activeStepIndex !== prevActiveIndexRef.current) {
            const idx = resolveStepIndex(activeStepIndex, steps);
            if (idx !== null && idx !== currentStepIndex) {
                setCurrentStepIndex(idx);
                saveStepToStorage(idx);
            }
        }
        prevActiveIndexRef.current = activeStepIndex;

        if (activeStepId !== undefined && activeStepId !== prevActiveIdRef.current) {
            const idx = resolveStepIndex(activeStepId, steps);
            if (idx !== null && idx !== currentStepIndex) {
                setCurrentStepIndex(idx);
                saveStepToStorage(idx);
            }
        }
        prevActiveIdRef.current = activeStepId;
    }, [activeStepIndex, activeStepId, steps, currentStepIndex, saveStepToStorage]);

    const changeStep = (newIndex: number) => {
        setCurrentStepIndex(newIndex);
        saveStepToStorage(newIndex);
        if (onStepChange) {
            onStepChange(newIndex);
        }
    };

    const handleNext = async () => {
        const currentStep = steps[currentStepIndex];

        // 1. Adım seviyesinde onValidate fonksiyonu varsa çalıştır
        if (currentStep?.props?.onValidate) {
            const isValid = await currentStep.props.onValidate();
            if (!isValid) {
                return;
            }
        }

        // 2. Adım seviyesinde isValid prop kontrolü (eğer explicitly false ise ilerleme)
        if (currentStep?.props?.isValid === false) {
            return;
        }

        // 3. Genel onBeforeStepChange kuralı varsa çalıştır
        if (onBeforeStepChange) {
            const canProceed = await onBeforeStepChange(currentStepIndex, currentStepIndex + 1);
            if (!canProceed) {
                return;
            }
        }

        if (currentStepIndex < totalSteps - 1) {
            const nextIndex = currentStepIndex + 1;
            changeStep(nextIndex);
        }
    };

    const handleBack = () => {
        if (currentStepIndex > 0) {
            const prevIndex = currentStepIndex - 1;
            changeStep(prevIndex);
        }
    };

    const handleStepClick = async (targetIndex: number) => {
        if (targetIndex < currentStepIndex && !isFinishing) {
            if (onBeforeStepChange) {
                const canProceed = await onBeforeStepChange(currentStepIndex, targetIndex);
                if (!canProceed) return;
            }
            changeStep(targetIndex);
        }
    };

    const handleFinish = async () => {
        const currentStep = steps[currentStepIndex];

        // Son adımda da onValidate kontrolü varsa çalıştır
        if (currentStep?.props?.onValidate) {
            const isValid = await currentStep.props.onValidate();
            if (!isValid) {
                return;
            }
        }

        if (currentStep?.props?.isValid === false) {
            return;
        }

        await onFinish();
        clearStepFromStorage();
    };

    const handleCancel = useCallback(async () => {
        if (isCancelling || isFinishing) return;
        setIsCancelling(true);
        try {
            clearStepFromStorage();
            if (onClose) {
                await onClose();
            }
        } finally {
            setIsCancelling(false);
        }
    }, [clearStepFromStorage, onClose, isCancelling, isFinishing]);

    const { setHeader, clearHeader } = useHeaderApi() || {};
    const headerIdRef = useRef(`base-wizard-back-${Math.random().toString(36).substr(2, 9)}`);

    const handleBackClick = useCallback(async () => {
        if (onClose) {
            await handleCancel();
        } else if (navigate) {
            navigate(-1);
        } else if (window.history.state && window.history.state.idx > 0) {
            window.history.back();
        }
    }, [onClose, handleCancel, navigate]);

    const shouldShowBack = showBackButton !== false && (showBackButton === true || !!onClose);

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

    if (isOpen === false || totalSteps === 0) {
        return null;
    }

    const currentStep = steps[currentStepIndex];

    const resolvedFinishText = finishText || t('auto_bitti_9a34') || 'Bitti';
    const resolvedProcessingText = t('auto_isleniyor_3f1b') || 'İşleniyor...';

    const wizardContent = (
        <div 
            id={id}
            ref={containerRef}
            className={`base-card-page wizard-page-wrapper flex-col flex-1 min-h-0 ${className || ''}`}
        >
            <BaseCardPageHeader
                title={title || pageTitle}
                icon={icon}
                subtitle={subtitle}
                subtitleLeft={subtitleLeft}
                subtitleRight={subtitleRight}
                headerExtra={headerExtra}
                breadcrumb={null}
                {...headerProps}
            />

            <div className="wizard-page-container flex-col flex-1 min-h-0">
                {/* Stepper Header */}
                <div className="wizard-header">
                    {steps.map((step, index) => {
                        const isActive = index === currentStepIndex;
                        const isCompleted = index < currentStepIndex;

                        return (
                            <React.Fragment key={index}>
                                <div 
                                    className={`wizard-step-item ${isCompleted ? 'completed cursor-pointer' : ''} ${!(isActive || isCompleted) ? 'inactive' : ''}`}
                                    onClick={() => isCompleted && handleStepClick(index)}
                                    title={isCompleted ? t('auto_bu_adima_don', 'Bu adıma dön') : undefined}
                                >
                                    <div className={`wizard-step-number ${isActive ? 'active' : isCompleted ? 'completed' : 'pending'}`}>
                                        {isCompleted ? <Check size={16} /> : index + 1}
                                    </div>
                                    <span className={`wizard-step-text ${isActive ? 'active' : isCompleted ? 'completed' : 'pending'}`}>
                                        {step.props.title}
                                    </span>
                                </div>
                                {index < totalSteps - 1 && (
                                    <div className={`wizard-step-divider ${isCompleted ? 'completed' : 'pending'}`} />
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* Content & Scroll Container (Footer her zaman content'in altında yer alır) */}
                <div className="wizard-content">
                    <div className="wizard-content-inner flex flex-col flex-1">
                        {currentStep}
                    </div>

                    {/* Footer */}
                    <div className="wizard-footer">
                        <PrevButton
                            onClick={handleBack}
                            disabled={currentStepIndex === 0 || isFinishing || isCancelling}
                            text={t('auto_geri_8f21') || 'Geri'}
                        />

                        <div className="wizard-footer-actions">
                            {onClose && (
                                <CancelButton
                                    onClick={handleCancel}
                                    disabled={isFinishing || isCancelling}
                                    isSaving={isCancelling}
                                    text={t('auto_iptal_2517') || 'İptal'}
                                />
                            )}

                            {currentStepIndex < totalSteps - 1 ? (
                                <NextButton
                                    onClick={handleNext}
                                    disabled={isFinishing || isCancelling}
                                    text={t('auto_ileri_c235') || 'İleri'}
                                />
                            ) : (
                                <FinishButton
                                    onClick={handleFinish}
                                    disabled={isFinishing || isCancelling}
                                    isSaving={isFinishing}
                                    text={resolvedFinishText}
                                    loadingText={resolvedProcessingText}
                                    className="wizard-btn-finish"
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    if (asForm) {
        return (
            <form 
                onSubmit={(e) => e.preventDefault()} 
                noValidate 
                className="flex-1 flex flex-col min-h-0"
            >
                {wizardContent}
            </form>
        );
    }

    return wizardContent;
};

export default BaseWizardPage;
