import React from 'react';
import { Save } from 'lucide-react';
import BaseButton from '../base/button/BaseButton';

interface SaveButtonProps {
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
    isSaving?: boolean;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    style?: React.CSSProperties;
    className?: string;
    text?: string;
    form?: string;
}

const SaveButton: React.FC<SaveButtonProps> = ({ onClick, isSaving, type = 'submit', disabled, style, className = '', text = 'Kaydet', form }) => {
    return (
        <BaseButton
            onClick={onClick}
            isSaving={isSaving}
            disabled={disabled}
            type={type}
            form={form}
            variant="primary"
            className={`${!text ? 'btn-icon' : ''} ${className}`.trim()}
            style={{ minWidth: text ? 'auto' : '64px', justifyContent: 'center', ...style }}
            text={text}
            loadingText="Kaydediliyor..."
            icon={<Save size={18} />}
        />
    );
};

export default SaveButton;
