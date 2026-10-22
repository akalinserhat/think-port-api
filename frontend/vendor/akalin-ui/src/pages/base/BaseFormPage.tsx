// @ts-nocheck
/**
 * ============================================================================
 * AGENT KNOWLEDGE & USAGE GUIDE
 * ============================================================================
 * BaseFormPage, tam sayfa olarak çalışan standart "Kayıt Ekle/Düzenle" (Form) 
 * ekranlarının temel iskeletidir (Ör: Yeni Cari Ekle, Yeni Şube Ekle).
 *
 * Ne İş Yapar?
 * - Sayfa yüklendiğinde, URL'deki `id` parametresine bakarak API'den (`apiEndpoint`) 
 *   mevcut veriyi GET isteği ile otomatik çeker.
 * - Veri çekilirken yükleniyor (loading) state'ini yönetir.
 * - Form bileşenine (`formComponent` prop) çekilen veriyi `initialData` olarak iletir.
 * - Kullanıcı sayfadan çıkarken formda değişiklik yapılmışsa (dirty state) 
 *   AlertDialog ile "Kaydedilmemiş değişiklikleriniz var" uyarısı çıkarır.
 *
 * Nasıl Kullanılır?
 * Hedef form bileşeniniz (Ör: CariForm) kendi API POST/PUT işlemlerini kendi içinde yapar.
 * BaseFormPage sadece onu sarmalar, URL ID çözümlemesini yapar ve veriyi ona paslar.
 * ============================================================================
 */
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { updateDocumentTitle, autoFocusFirstInput } from '../../utils/domUtils';
import AlertDialog from '../../components/dialog/AlertDialog';
import SaveButton from '../../components/button/SaveButton';
import CancelButton from '../../components/button/CancelButton';
import BackButton from '../../components/button/BackButton';
import { useTranslation } from 'react-i18next';
import { useHeaderApi } from '../../context/HeaderContext';

export interface FormComponentProps<T = any> {
    initialData?: T;
    onSuccess?: (data?: any) => void;
    onCancel?: () => void;
    onDirtyChange?: (isDirty: boolean) => void;
    onTitleChange?: (title: string) => void;
    onSavingChange?: (isSaving: boolean) => void;
}

export interface BaseFormPageProps<T = any> {
    apiEndpoint?: string | null;
    baseRoute: string;
    titlePrefix?: string;
    getDisplayName?: (data: T) => string;
    formComponent: any;
    initialNewDataFn?: (searchParams: URLSearchParams) => Partial<T>;
    hideFooter?: boolean;
    isDocument?: boolean;
}

/**
 * BaseFormPage
 * Merkezi form sayfası iskeleti.
 */
const BaseFormPage = <T extends any = any>({
    apiEndpoint,
    baseRoute,
    titlePrefix = 'Kayıt',
    getDisplayName = (data: T) => (data as any)?.ad || (data as any)?.unvan || (data as any)?.isim || '',
    formComponent: FormComponent,
    initialNewDataFn,
    hideFooter = false,
    isDocument = false
}: BaseFormPageProps<T>) => {
    const { t } = useTranslation();
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const [searchParams] = useSearchParams();
    
    const [initialData, setInitialData] = useState(() => {
        if (id) return location.state?.item || null;
        return initialNewDataFn ? initialNewDataFn(searchParams) : null;
    });
    
    // Eğer state'ten veri geldiyse yükleniyor ekranında bekletme
    const [loading, setLoading] = useState(id ? !location.state?.item : false);
    
    // Merkezi Auto-Focus (Sayfa yüklendiğinde veya data geldiğinde ilk input'a odaklanır)
    useEffect(() => {
        const timer = setTimeout(() => autoFocusFirstInput(), 150);
        return () => clearTimeout(timer);
    }, [loading]);

    const [isFormDirty, setIsFormDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [formTitle, setFormTitle] = useState('');
    const [alertDialog, setAlertDialog] = useState({ isOpen: false, type: 'info', title: '', message: '', onConfirm: null, confirmText: 'Tamam' });

    const headerApi = useHeaderApi();
    const { setHeaderBreadcrumbOptions } = headerApi || {};

    const displayTitle = id 
        ? `${titlePrefix} Düzenle${formTitle ? ' - ' + formTitle : ''}` 
        : `Yeni ${titlePrefix}`;

    useEffect(() => {
        if (setHeaderBreadcrumbOptions) {
            const effectiveRecordTitle = formTitle || (id ? `#${id}` : `Yeni ${titlePrefix}`);
            setHeaderBreadcrumbOptions({ recordTitle: effectiveRecordTitle });
        }
        return () => {
            if (setHeaderBreadcrumbOptions) {
                setHeaderBreadcrumbOptions(null);
            }
        };
    }, [formTitle, id, titlePrefix, setHeaderBreadcrumbOptions]);
    
    const doNavigateBack = () => {
        const returnPath = location.state?.returnUrl || baseRoute;
        if (id && returnPath) {
            try {
                sessionStorage.setItem(`akalin_active_row_${returnPath}`, String(id));
            } catch (e) {}
        }
        if (window.history.state && window.history.state.idx > 0) {
            navigate(-1);
        } else {
            navigate(returnPath, { replace: true, state: id ? { selectedId: id } : undefined });
        }
    };

    const handleFormClose = () => {
        if (isFormDirty) {
            setAlertDialog({
                isOpen: true,
                type: 'confirm',
                title: t('auto_kaydedilmemis_degisiklikler', 'Kaydedilmemiş Değişiklikler'),
                message: t('auto_kaydedilmemis_degisiklikler_var', 'Kaydedilmemiş değişiklikleriniz var. Çıkmak istediğinize emin misiniz?'),
                confirmText: t('auto_evet_cik', 'Evet, Çık'),
                onConfirm: doNavigateBack
            });
        } else {
            doNavigateBack();
        }
    };

    useEffect(() => {
        updateDocumentTitle(displayTitle);
        if (headerApi?.setHeader) {
            headerApi.setHeader(
                displayTitle,
                <BackButton onClick={handleFormClose} title={t('auto_geri_don', 'Geri Dön')} />
            );
        }
        return () => {
            if (headerApi?.clearHeader) {
                headerApi.clearHeader(displayTitle);
            }
        };
    }, [displayTitle, headerApi, handleFormClose, t]);

    useEffect(() => {
        if (!isDocument) return;
        const contentArea = document.querySelector('.content-area');
        if (contentArea) {
            contentArea.classList.add('content-area-document');
            return () => {
                contentArea.classList.remove('content-area-document');
            };
        }
    }, [isDocument]);

    useEffect(() => {
        if (id && apiEndpoint) {
            // State'ten veri geldiyse hemen gösterelim (Optimistic UI)
            if (location.state?.item) {
                setFormTitle(getDisplayName(location.state.item));
            }

            axios.get(`${apiEndpoint}/${id}`)
                .then(res => {
                    setInitialData(res.data);
                    setFormTitle(getDisplayName(res.data));
                    setLoading(false);
                })
                .catch(err => {
                    // Eğer API isteği başarısız olursa fakat elimizde listeden gelen state datası varsa hata verme!
                    if (location.state?.item) {
                        setLoading(false);
                        return;
                    }
                    setAlertDialog({
                        isOpen: true,
                        type: 'error',
                        title: t('auto_hata', 'Hata'),
                        message: t('auto_kayit_detaylari_yuklenemedi', 'Kayıt detayları yüklenemedi.'),
                        onConfirm: doNavigateBack
                    });
                    setLoading(false);
                });
        }
    }, [id, navigate, apiEndpoint, baseRoute, location.state]);

    if (loading) {
        return <div style={{ padding: '24px', display: 'flex', justifyContent: 'center' }}>{t('auto_yukleniyor_4deb')}</div>;
    }

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <FormComponent 
                    initialData={initialData} 
                    onSuccess={doNavigateBack} 
                    onCancel={handleFormClose}
                    onDirtyChange={setIsFormDirty}
                    onTitleChange={setFormTitle}
                    onSavingChange={setIsSaving}
                />
            </div>
            
            {!hideFooter && (
                <div className="page-footer" style={{ padding: '16px 24px', borderTop: '1px solid var(--glass-border)', background: 'var(--bg-secondary)', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexShrink: 0 }}>
                    <CancelButton onClick={handleFormClose} />
                    <SaveButton form="base-form" isSaving={isSaving} text={id ? 'Güncelle' : 'Kaydet'} />
                </div>
            )}

            <AlertDialog 
                isOpen={alertDialog.isOpen}
                onClose={() => setAlertDialog(prev => ({ ...prev, isOpen: false }))}
                type={alertDialog.type}
                title={alertDialog.title}
                message={alertDialog.message}
                onConfirm={alertDialog.onConfirm}
                confirmText={alertDialog.confirmText}
            />
        </div>
    );
};

export default BaseFormPage;
