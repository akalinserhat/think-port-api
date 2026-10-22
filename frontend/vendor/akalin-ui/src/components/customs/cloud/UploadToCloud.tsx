/**
 * Buluta Dosya Yükleme (UploadToCloud) UI-Core Köprüsü / Registry.
 * Gerçek implementasyon UI/src/modules/BulutDepolama modülüne taşınmıştır.
 */
import React from 'react';

export interface Integration {
    id: number;
    providerType: string;
    ad: string;
    eposta: string;
}

export interface UploadToCloudProps {
    isOpen: boolean;
    onClose: () => void;
    documentId?: number;
    documentGuid?: string;
    documentType?: string;
    documentNo?: string;
    integrations: Integration[];
    initialFile?: File | null;
    initialProvider?: string;
    klasorId?: number;
    onUploadSuccess?: (fileInfo: any, originalFile?: File) => void;
}

let registeredUploadToCloudComponent: React.ComponentType<any> | null = null;

export const registerUploadToCloudComponent = (component: React.ComponentType<any>) => {
    registeredUploadToCloudComponent = component;
};

export const getUploadToCloudComponent = () => registeredUploadToCloudComponent;

const UploadToCloud: React.FC<UploadToCloudProps> = (props) => {
    if (!registeredUploadToCloudComponent) {
        return null;
    }
    const Component = registeredUploadToCloudComponent;
    return <Component {...props} />;
};

export default UploadToCloud;
