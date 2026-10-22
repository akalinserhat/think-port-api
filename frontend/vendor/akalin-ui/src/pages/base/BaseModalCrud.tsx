/**
 * ============================================================================
 * AGENT KNOWLEDGE & USAGE GUIDE
 * ============================================================================
 * BaseModalCrud, az sayıda veriye sahip "Sözlük/Tanım" tarzı sayfalar için 
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
import React, { useState } from 'react';
import BaseListPage from './BaseListPage';
import BasePopup from './BasePopup';

export interface BaseModalCrudProps<T = any> {
    title?: string;
    subtitle?: string;
    icon?: React.ReactNode;
    apiEndpoint?: string;
    columns?: any[];
    searchableFields?: any[];
    itemNameResolver?: (item: T) => string;
    formComponent: React.ComponentType<any>;
    modalTitlePrefix?: string;
    pageSize?: number;
    mobileCardRender?: (item: T, index: number, tableActions: any) => React.ReactNode;
    customRenderContent?: (props: any) => React.ReactNode;
    customFetchData?: (paramsObj?: any) => Promise<{ data: T[] }>;
    customDeleteData?: (id: string | number) => Promise<void>;
    canDelete?: (item: T) => boolean | Promise<boolean | { canDelete: boolean; message?: string }>;
    modalSize?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const BaseModalCrud = <T extends any = any>({
    title,
    subtitle,
    icon,
    apiEndpoint,
    columns,
    searchableFields,
    itemNameResolver,
    formComponent: FormComponent,
    modalTitlePrefix = 'Kayıt',
    pageSize = 50,
    mobileCardRender,
    customRenderContent,
    customFetchData,
    customDeleteData,
    canDelete,
    modalSize = "md"
}: BaseModalCrudProps<T>) => {
    const [showModal, setShowModal] = useState(false);
    const [selectedItem, setSelectedItem] = useState<T | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const handleAddNew = () => {
        setSelectedItem(null);
        setShowModal(true);
    };

    const handleEdit = (item: T) => {
        setSelectedItem(item);
        setShowModal(true);
    };

    const handleSuccess = () => {
        setShowModal(false);
        setRefreshKey(prev => prev + 1);
    };

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <BaseListPage
                title={title}
                subtitle={subtitle}
                icon={icon}
                apiEndpoint={apiEndpoint}
                columns={columns}
                searchableFields={searchableFields}
                onAddNew={handleAddNew}
                onEdit={handleEdit}
                itemNameResolver={itemNameResolver}
                refreshKey={refreshKey}
                pageSize={pageSize}
                mobileCardRender={mobileCardRender}
                customRenderContent={customRenderContent}
                customFetchData={customFetchData}
                customDeleteData={customDeleteData}
                canDelete={canDelete}
            />
            
            <BasePopup 
                isOpen={showModal} 
                onClose={() => setShowModal(false)} 
                title={selectedItem ? `${modalTitlePrefix} Düzenle` : `Yeni ${modalTitlePrefix}`}
                modalSize={modalSize}
                hideFooter={true}
            >
                {showModal && (
                    <FormComponent 
                        initialData={selectedItem} 
                        onSuccess={handleSuccess} 
                        onCancel={() => setShowModal(false)} 
                    />
                )}
            </BasePopup>
        </div>
    );
};

export default BaseModalCrud;
