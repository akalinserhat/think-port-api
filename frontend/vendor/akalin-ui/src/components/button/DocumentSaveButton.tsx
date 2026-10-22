import React, { useEffect, useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface DocumentSaveButtonProps {
    onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
    isSaving?: boolean;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    className?: string;
    text?: string;
    form?: string;
    showHotkey?: boolean;
    hotkeyText?: string;
    icon?: React.ReactNode;
}

/**
 * Akalin UI - Belge Kaydetme Butonu (DocumentSaveButton)
 * 
 * Fatura, Sipariş, İrsaliye gibi tüm belge sayfalarında (BaseDocumentPage)
 * standartlaşmış, Material Design 3 ilkelerine uygun, klavye kısayolu (⌘S / Ctrl+S)
 * rozetine ve yüklenme animasyonuna sahip birincil (primary) işlem butonu.
 */
export const DocumentSaveButton: React.FC<DocumentSaveButtonProps> = ({
    onClick,
    isSaving = false,
    type = 'submit',
    disabled = false,
    className = '',
    text,
    form,
    showHotkey = true,
    hotkeyText,
    icon
}) => {
    const { t } = useTranslation();
    const [isMac, setIsMac] = useState(false);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            setIsMac(/Mac|iPod|iPhone|iPad/.test(navigator.platform || ''));
        }
    }, []);

    const displayText = text || t('Kaydet', 'Kaydet');
    const savingText = t('Kaydediliyor', 'Kaydediliyor...');
    const defaultHotkey = isMac ? '⌘S' : 'Ctrl+S';
    const finalHotkey = hotkeyText || defaultHotkey;

    return (
        <button
            type={type}
            form={form}
            disabled={disabled || isSaving}
            onClick={onClick}
            className={`document-save-btn ${isSaving ? 'is-saving' : ''} ${className}`.trim()}
            title={showHotkey ? `${displayText} (${finalHotkey})` : displayText}
            aria-label={displayText}
        >
            {isSaving ? (
                <Loader2 size={16} className="document-save-spinner" />
            ) : icon ? (
                icon
            ) : (
                <Save size={16} className="document-save-icon" />
            )}
            <span className="document-save-text">
                {isSaving ? savingText : displayText}
            </span>
            {showHotkey && !isSaving && (
                <kbd className="document-save-hotkey">{finalHotkey}</kbd>
            )}
        </button>
    );
};

export default DocumentSaveButton;
