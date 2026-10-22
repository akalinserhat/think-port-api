/**
 * Bulut Dosyaları (FilesOnClouds) UI-Core Köprüsü / Registry.
 * Gerçek implementasyon UI/src/modules/BulutDepolama modülüne taşınmıştır.
 * BaseDocumentPage, AiChatPanel ve ExcelImportModal bu köprü üzerinden bileşeni dinamik çözer.
 */
import React from 'react';

export interface FilesOnCloudsProps {
    isOpen?: boolean;
    onClose?: () => void;
    documentId?: number;
    documentGuid?: string;
    documentType?: string;
    documentNo?: string;
    isModal?: boolean;
    showFolderTree?: boolean;
    isSelectMode?: boolean;
    onFileSelected?: (file: any) => void;
    onSelectFile?: (file: any) => void;
    onAnalyzeCloudFiles?: () => void;
    hideToolbarActions?: boolean;
    isAttachedOnly?: boolean;
    onAttachedOnlyChange?: (val: boolean) => void;
    asPage?: boolean;
}

export interface FilesOnCloudsHandle {
    openUpload: () => void;
    openCreateFolder: () => void;
    refresh: () => void;
    analyze: () => void;
    openLocalFilePicker?: () => void;
    setIsAttachedOnly?: (val: boolean) => void;
}

let registeredCloudFilesComponent: React.ComponentType<any> | null = null;

export const registerCloudFilesComponent = (component: React.ComponentType<any>) => {
    registeredCloudFilesComponent = component;
};

export const getCloudFilesComponent = () => registeredCloudFilesComponent;

const FilesOnClouds = React.forwardRef<FilesOnCloudsHandle, FilesOnCloudsProps>((props, ref) => {
    if (!registeredCloudFilesComponent) {
        return null;
    }
    const Component = registeredCloudFilesComponent;
    return <Component ref={ref} {...props} />;
});

export default FilesOnClouds;
