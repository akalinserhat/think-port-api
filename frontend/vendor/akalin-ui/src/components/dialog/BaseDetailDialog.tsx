import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import BaseButton from '../base/button/BaseButton';
import CancelButton from '../button/CancelButton';
import { Save } from 'lucide-react';
import { updateDocumentTitle } from '../../utils/domUtils';
import { useHeaderApi } from '../../context/HeaderContext';

export interface BaseDetailDialogProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
    children: React.ReactNode;
    onSave?: () => void;
    saveText?: string;
    cancelText?: string;
    hideSaveButton?: boolean;
    isSaveDisabled?: boolean;
    hideMaximize?: boolean;
    footerContent?: React.ReactNode;
    hideFooter?: boolean;
}

const FullScreenContent: React.FC<BaseDetailDialogProps> = (props) => {
    const headerApi = useHeaderApi();
    const headerContent = useMemo(() => (
        <div className="flex items-center gap-16 flex-1 min-w-0" style={{ paddingLeft: '8px' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <h2 className="m-0 text-18 font-extrabold tracking-tight" style={{ wordBreak: 'break-word', lineHeight: '1.2' }}>
                    {props.title}
                </h2>
            </div>
        </div>
    ), [props.title]);

    React.useEffect(() => {
        updateDocumentTitle(props.title);
        const headerId = `dialog-${props.title}`;
        if (headerApi?.setHeader) {
            headerApi.setHeader(headerId, headerContent);
        }
        return () => {
            if (headerApi?.clearHeader) {
                headerApi.clearHeader(headerId);
            }
        };
    }, [props.title, headerContent, headerApi]);

    return (
        <div style={{ 
            position: 'absolute', 
            top: 0, left: 0, right: 0, bottom: 0, 
            zIndex: 50, 
            background: 'var(--bg-primary)', 
            display: 'flex', 
            flexDirection: 'column' 
        }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '24px', overflow: 'auto' }}>
                {props.children}
            </div>
            
            {!props.hideFooter && (
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'flex-end', 
                    gap: '12px', 
                    padding: '20px 24px', 
                    borderTop: '1px solid var(--glass-border)',
                    flexShrink: 0,
                    background: 'var(--bg-secondary)',
                    zIndex: 10
                }}>
                    {props.footerContent ? props.footerContent : (
                        <>
                            <CancelButton onClick={props.onClose} text={props.cancelText || 'İptal'} />
                            {!props.hideSaveButton && props.onSave && (
                                <BaseButton type="button" onClick={props.onSave} text={props.saveText || 'Kaydet'} disabled={props.isSaveDisabled} icon={<Save size={18} />} />
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

const BaseDetailDialog: React.FC<BaseDetailDialogProps> = (props) => {
    if (!props.isOpen) return null;

    const contentArea = document.querySelector('.content-area') as HTMLElement;
    
    // Fallback: If for some reason .content-area doesn't exist, render directly
    if (!contentArea) {
        return <FullScreenContent {...props} />;
    }

    // Ensure content-area is relative so the absolute overlay covers it perfectly
    if (getComputedStyle(contentArea).position === 'static') {
        contentArea.style.position = 'relative';
    }

    return createPortal(<FullScreenContent {...props} />, contentArea);
};

export default BaseDetailDialog;
