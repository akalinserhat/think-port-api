/**
 * Akalin UI - Temel Popup / Modal İskelet Bileşeni (BasePopup)
 * 
 * Başlıca Görevleri:
 * - Sistem genelindeki tüm form, kart veya işlem pencerelerinin standart Modal yapısını yönetmek
 * - Hem formComponent (dinamik form bileşeni) hem de doğrudan children içeriği desteği sunmak
 * - Kaydet/Güncelle/İptal butonları, yükleniyor durumları ve alt aksiyon çubuğunu standartlaştırmak
 * - Başlık yanında ekstra aksiyonlar (AI Asistan, yardım butonları vb.) için alan sağlamak
 */

import React, { useState, ReactNode } from 'react';
import Modal from './Modal';
import CancelButton from '../../components/button/CancelButton';
import SaveButton from '../../components/button/SaveButton';

export interface BasePopupProps<T = any> {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    formComponent?: React.ComponentType<any>;
    children?: ReactNode;
    initialData?: T | null;
    onSuccess?: (data?: any) => void;
    modalSize?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
    size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
    hideMaximize?: boolean;
    hideActions?: boolean;
    hideFooter?: boolean;
    extraHeaderActions?: ReactNode;
    extraFooterLeft?: ReactNode;
    customFooter?: ReactNode;
    submitButtonText?: string;
    isSaving?: boolean;
    onSave?: () => void;
}

const BasePopup = <T extends any = any>({
    isOpen,
    onClose,
    title,
    formComponent: FormComponent,
    children,
    initialData,
    onSuccess,
    modalSize,
    size,
    hideMaximize,
    hideActions,
    hideFooter,
    extraHeaderActions,
    extraFooterLeft,
    customFooter,
    submitButtonText,
    isSaving: externalIsSaving,
    onSave
}: BasePopupProps<T>) => {
    const [internalIsSaving, setInternalIsSaving] = useState(false);
    const isSaving = externalIsSaving !== undefined ? externalIsSaving : internalIsSaving;
    const shouldHideFooter = hideActions || hideFooter;
    const effectiveSize = modalSize || size || "md";

    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            title={title}
            size={effectiveSize}
            hideMaximize={hideMaximize}
        >
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {extraHeaderActions && (
                    <div style={{ padding: '0 24px 12px 24px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        {extraHeaderActions}
                    </div>
                )}
                
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {isOpen && (
                        FormComponent ? (
                            <FormComponent 
                                initialData={initialData} 
                                onSuccess={(data: any) => {
                                    if (onSuccess) onSuccess(data);
                                }} 
                                onCancel={onClose} 
                                setIsSaving={setInternalIsSaving}
                            />
                        ) : children
                    )}
                </div>

                {!shouldHideFooter && (
                    customFooter ? (
                        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--glass-border)', background: 'var(--bg-secondary)' }}>
                            {customFooter}
                        </div>
                    ) : (
                        <div style={{ 
                            padding: '16px 24px', 
                            display: 'flex', 
                            justifyContent: extraFooterLeft ? 'space-between' : 'flex-end', 
                            alignItems: 'center', 
                            gap: '12px', 
                            borderTop: '1px solid var(--glass-border)', 
                            background: 'var(--bg-secondary)' 
                        }}>
                            {extraFooterLeft ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {extraFooterLeft}
                                </div>
                            ) : null}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <CancelButton onClick={onClose} style={{ minWidth: '120px', justifyContent: 'center' }} />
                                <SaveButton 
                                    type={onSave ? "button" : "submit"} 
                                    form={onSave ? undefined : "base-popup-form"} 
                                    onClick={onSave}
                                    isSaving={isSaving} 
                                    text={submitButtonText || (initialData ? 'Güncelle' : 'Kaydet')} 
                                    style={{ minWidth: '120px', justifyContent: 'center' }} 
                                />
                            </div>
                        </div>
                    )
                )}
            </div>
        </Modal>
    );
};

export default BasePopup;
