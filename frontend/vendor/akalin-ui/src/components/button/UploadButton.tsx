import React from 'react';
import { Upload } from 'lucide-react';
import BaseMenuButton from '../base/button/BaseMenuButton';
import BaseButton from '../base/button/BaseButton';

export interface UploadButtonProps {
    onClick?: (e?: any) => void | Promise<void>;
    onSelectProvider?: (providerId: any, rawValue?: any) => void;
    options?: any[];
    isLoading?: boolean;
    disabled?: boolean;
    style?: React.CSSProperties;
    className?: string;
    text?: string;
    loadingText?: string;
    value?: any;
}

const UploadButton: React.FC<UploadButtonProps> = ({ 
    onClick, 
    onSelectProvider,
    options = [],
    isLoading, 
    disabled, 
    style, 
    className = '', 
    text = 'Yeni Dosya Yükle', 
    loadingText = 'Yükleniyor...'
}) => {
    if (options && options.length > 0) {
        const menuItems = options.map(opt => ({
            id: String(opt.value || opt.id),
            label: `${opt.label}'a Yükle`,
            icon: opt.icon || <Upload size={16} />,
            onClick: (e: React.MouseEvent) => {
                if (onSelectProvider) {
                    onSelectProvider(opt.value || opt.id, opt);
                } else if (onClick) {
                    onClick(opt.value || opt.id);
                }
            }
        }));

        return (
            <div style={style} className={className}>
                <BaseMenuButton
                    items={menuItems}
                    disabled={disabled || isLoading}
                    variant="primary"
                />
            </div>
        );
    }

    return (
        <BaseButton
            onClick={onClick}
            isSaving={isLoading}
            disabled={disabled}
            type="button"
            className={`btn-primary flex items-center gap-8 ${className}`}
            style={style}
            text={text}
            loadingText={loadingText}
            icon={<Upload size={16} />}
        />
    );
};

export default UploadButton;

