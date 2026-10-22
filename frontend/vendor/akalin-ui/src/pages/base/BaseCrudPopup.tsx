// @ts-nocheck
/**
 * ============================================================================
 * AGENT KNOWLEDGE & USAGE GUIDE
 * ============================================================================
 * BaseCrudPopup, az sayıda veriye sahip "Sözlük/Tanım" tarzı sayfalar için 
 * (Markalar, Birimler, Vergi Daireleri vb.) tasarlanmış kompakt bir CRUD altyapısıdır.
 *
 * Farkı Nedir?
 * - `BaseListPage` gibi tam sayfa liste gösterir (Hatta altyapısında `BaseListPage` kullanır).
 * - Ancak "Yeni Ekle" veya "Düzenle" dendiğinde kullanıcıyı başka bir URL'ye (sayfaya)
 *   yönlendirmez. Tüm formu bir `Modal` (Popup) içerisinde açar!
 * - Masaüstünde modal olarak, mobil cihazlarda ise tam ekran deneyimiyle çalışır.
 *
 * Kullanım Şartı:
 * Form bileşeni (`formComponent`) sadece formu içermelidir (kendi Kaydet/İptal butonları 
 * olmalı ve onSuccess/onCancel callback'lerini tetiklemelidir).
 * ============================================================================
 */
import React, { useState, useEffect } from 'react';
import BaseListPage, { BaseListPageProps } from './BaseListPage';
import BasePopup from './BasePopup';

export interface BaseCrudPopupProps<T = any> extends Omit<BaseListPageProps<T>, 'onAddNew' | 'onEdit' | 'baseRoute'> {
    formComponent: React.ComponentType<any>;
    modalTitlePrefix?: string;
    modalSize?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
    onAddNew?: () => void;
    onEdit?: (item: T) => void;
}

const BaseCrudPopup = <T extends any = any>({
    formComponent: FormComponent,
    modalTitlePrefix = 'Kayıt',
    modalSize = "md",
    onAddNew: customAddNew,
    onEdit: customEdit,
    ...listProps
}: BaseCrudPopupProps<T>) => {
    const [showModal, setShowModal] = useState(false);
    const [selectedItem, setSelectedItem] = useState<T | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const handleAddNew = () => {
        if (customAddNew) {
            customAddNew();
        } else {
            setSelectedItem(null);
            setShowModal(true);
        }
    };

    const handleEdit = (item: T) => {
        if (customEdit) {
            customEdit(item);
        } else {
            setSelectedItem(item);
            setShowModal(true);
        }
    };

    const handleSuccess = () => {
        setShowModal(false);
        setRefreshKey(prev => prev + 1);
    };

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <BaseListPage
                {...listProps}
                onAddNew={handleAddNew}
                onEdit={handleEdit}
                refreshKey={refreshKey}
            />
            
            <BasePopup
                isOpen={showModal} 
                onClose={() => setShowModal(false)} 
                title={selectedItem ? `${modalTitlePrefix} Düzenle` : `Yeni ${modalTitlePrefix}`}
                modalSize={modalSize}
                formComponent={FormComponent}
                initialData={selectedItem}
                onSuccess={handleSuccess}
            />
        </div>
    );
};

export default BaseCrudPopup;
