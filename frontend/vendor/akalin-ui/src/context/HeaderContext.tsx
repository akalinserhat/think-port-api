/**
 * Akalin UI - Merkezi Başlık ve Belge Durum Yönetimi (HeaderContext)
 * ============================================================================
 * Uygulama genelinde üst başlık alanı (Header), breadcrumb navigasyonu, 
 * belge/form kirli durum takibi (isDocumentDirty) ve geri dönüş engelleme 
 * (documentBackInterceptor) mekanizmalarını merkezi olarak yöneten Context yapısıdır.
 * 
 * Temel Özellikler:
 * 1. Stack Tabanlı Başlık Yönetimi: Sayfa ve modal katmanları derinleştikçe başlıkları 
 *    yığın (stack) yapısında saklar; alt sayfa veya modal kapandığında bir önceki başlığı otomatik geri yükler.
 * 2. Breadcrumb Seçenekleri: Sayfa bazlı özel kırıntı menüsü opsiyonlarını üst bara aktarır.
 * 3. Form Kirli Durum Takibi (Dirty State): Formlarda kaydedilmemiş veri değişikliklerini 
 *    `isDocumentDirty` bayrağı ile takip eder.
 * 4. Geri Dönüş Engelleme (Back Interceptor): Kaydedilmemiş değişiklik varken sayfadan 
 *    çıkışı kontrol eden veya onay modalı tetikleyen fonksiyonları kaydeder.
 * ============================================================================
 */

import React, { useContext, useState, useRef, useCallback, useMemo } from 'react';
import { createSingletonContext } from '../utils/createSingletonContext';

/**
 * Sayfadan veya belgeden çıkış yapılmak istendiğinde tetiklenen önleyici fonksiyon tipi.
 * True dönerse çıkışa izin verilir, false dönerse çıkış engellenir.
 */
export type DocumentBackInterceptor = () => boolean | Promise<boolean>;

/**
 * HeaderContext'in tüm durumlarını ve değiştiricilerini barındıran ana context tipi.
 */
export interface HeaderContextType {
    /** Aktif üst başlık alanı içeriği (React Node) */
    headerContent: any;
    /** Üst başlık alanını doğrudan ayarlamak için state setter */
    setHeaderContent: React.Dispatch<React.SetStateAction<any>>;
    /** Belirli bir bileşene ait başlığı yığına ekler veya günceller */
    setHeader: (id: string, content: any) => void;
    /** Belirtilen ID'ye sahip başlığı yığından kaldırır ve önceki başlığı aktif yapar */
    clearHeader: (id: string) => void;
    /** Aktif breadcrumb seçenekleri */
    headerBreadcrumbOptions: any;
    /** Breadcrumb seçeneklerini güncelleyen setter */
    setHeaderBreadcrumbOptions: React.Dispatch<React.SetStateAction<any>>;
    /** Belge veya formda kaydedilmemiş değişiklik olup olmadığını belirten bayrak */
    isDocumentDirty: boolean;
    /** Belgenin kirli (dirty) durumunu güncelleyen setter */
    setIsDocumentDirty: React.Dispatch<React.SetStateAction<boolean>>;
    /** Aktif geri dönüş interceptor fonksiyonu */
    documentBackInterceptor: DocumentBackInterceptor | null;
    /** Geri dönüş interceptor fonksiyonunu tanımlayan setter */
    setDocumentBackInterceptor: (fn: DocumentBackInterceptor | null) => void;
}

/**
 * Başlık yönetimi için optimize edilmiş API context tipi.
 * `headerContent` state değişimlerinden etkilenmeden metotlara erişim sağlar.
 */
export interface HeaderApiContextType {
    /** Belirli bir bileşene ait başlığı yığına ekler veya günceller */
    setHeader: (id: string, content: any) => void;
    /** Belirtilen ID'ye sahip başlığı yığından kaldırır ve önceki başlığı aktif yapar */
    clearHeader: (id: string) => void;
    /** Breadcrumb seçeneklerini günceller */
    setHeaderBreadcrumbOptions: (options: any) => void;
    /** Belge veya formda kaydedilmemiş değişiklik olup olmadığını belirten bayrak */
    isDocumentDirty: boolean;
    /** Belgenin kirli (dirty) durumunu güncelleyen setter */
    setIsDocumentDirty: React.Dispatch<React.SetStateAction<boolean>>;
    /** Aktif geri dönüş interceptor fonksiyonu */
    documentBackInterceptor: DocumentBackInterceptor | null;
    /** Geri dönüş interceptor fonksiyonunu tanımlayan setter */
    setDocumentBackInterceptor: (fn: DocumentBackInterceptor | null) => void;
}

const defaultHeaderContext: HeaderContextType = {
    headerContent: null,
    setHeaderContent: () => { },
    setHeader: () => { },
    clearHeader: () => { },
    headerBreadcrumbOptions: null,
    setHeaderBreadcrumbOptions: () => { },
    isDocumentDirty: false,
    setIsDocumentDirty: () => { },
    documentBackInterceptor: null,
    setDocumentBackInterceptor: () => { }
};

const defaultHeaderApiContext: HeaderApiContextType = {
    setHeader: () => { },
    clearHeader: () => { },
    setHeaderBreadcrumbOptions: () => { },
    isDocumentDirty: false,
    setIsDocumentDirty: () => { },
    documentBackInterceptor: null,
    setDocumentBackInterceptor: () => { }
};

const HeaderContext = createSingletonContext<HeaderContextType>(
    '__AKALIN_UI_HEADER_CONTEXT__',
    defaultHeaderContext,
    'HeaderContext'
);
const HeaderApiContext = createSingletonContext<HeaderApiContextType>(
    '__AKALIN_UI_HEADER_API_CONTEXT__',
    defaultHeaderApiContext,
    'HeaderApiContext'
);

/**
 * HeaderProvider
 * Uygulamanın üst başlık (Header), breadcrumb ve dirty durumlarını yöneten Context Provider bileşeni.
 * Uygulama kök seviyesinde veya ana layout içerisinde konumlandırılmalıdır.
 */
export const HeaderProvider = ({ children }: { children: React.ReactNode }) => {
    const [headerContent, setHeaderContent] = useState<any>(null);
    const [headerBreadcrumbOptions, setHeaderBreadcrumbOptions] = useState<any>(null);
    const [isDocumentDirty, setIsDocumentDirty] = useState<boolean>(false);
    const stackRef = useRef<{ id: string; content: any }[]>([]);

    const setHeader = useCallback((id: string, content: any) => {
        const existingIndex = stackRef.current.findIndex(item => item.id === id);
        if (existingIndex >= 0) {
            stackRef.current[existingIndex].content = content;
        } else {
            stackRef.current.push({ id, content });
        }
        setHeaderContent(content);
    }, []);

    const clearHeader = useCallback((id: string) => {
        stackRef.current = stackRef.current.filter(item => item.id !== id);
        if (stackRef.current.length > 0) {
            setHeaderContent(stackRef.current[stackRef.current.length - 1].content);
        } else {
            setHeaderContent(null);
        }
    }, []);

    const [documentBackInterceptor, setDocumentBackInterceptorState] = useState<DocumentBackInterceptor | null>(null);
    const interceptorRef = useRef<DocumentBackInterceptor | null>(null);

    const setDocumentBackInterceptor = useCallback((fn: DocumentBackInterceptor | null) => {
        interceptorRef.current = fn;
        setDocumentBackInterceptorState(() => fn);
    }, []);

    const value = useMemo(() => ({
        headerContent,
        setHeaderContent,
        setHeader,
        clearHeader,
        headerBreadcrumbOptions,
        setHeaderBreadcrumbOptions,
        isDocumentDirty,
        setIsDocumentDirty,
        documentBackInterceptor,
        setDocumentBackInterceptor
    }), [headerContent, setHeaderContent, setHeader, clearHeader, headerBreadcrumbOptions, setHeaderBreadcrumbOptions, isDocumentDirty, setIsDocumentDirty, documentBackInterceptor, setDocumentBackInterceptor]);

    const apiValue = useMemo(() => ({
        setHeader,
        clearHeader,
        setHeaderBreadcrumbOptions,
        isDocumentDirty,
        setIsDocumentDirty,
        documentBackInterceptor,
        setDocumentBackInterceptor
    }), [setHeader, clearHeader, setHeaderBreadcrumbOptions, isDocumentDirty, setIsDocumentDirty, documentBackInterceptor, setDocumentBackInterceptor]);

    return (
        <HeaderContext.Provider value={value}>
            <HeaderApiContext.Provider value={apiValue}>
                {children}
            </HeaderApiContext.Provider>
        </HeaderContext.Provider>
    );
};

/**
 * useHeader
 * Aktif üst başlık içeriğini (headerContent) okumak ve HeaderContext'in tüm durumlarına erişmek için hook.
 */
export const useHeader = () => useContext(HeaderContext) || defaultHeaderContext;

/**
 * useHeaderApi
 * Header manipülasyonu için optimize edilmiş API hook'u.
 * `setHeader` ve `clearHeader` gibi metodları header içeriği değişimlerinden kaynaklanan
 * gereksiz re-render'lara neden olmadan kullanmanızı sağlar.
 */
export const useHeaderApi = () => useContext(HeaderApiContext) || defaultHeaderApiContext;

/**
 * useDocumentDirty
 * Belge formlarının kaydedilmemiş değişiklik (dirty) durumunu okumak ve değiştirmek için merkezi hook.
 */
export const useDocumentDirty = () => {
    const { isDocumentDirty, setIsDocumentDirty } = useHeader();
    return {
        isDirty: isDocumentDirty,
        setDirty: setIsDocumentDirty,
        setIsDocumentDirty
    };
};

