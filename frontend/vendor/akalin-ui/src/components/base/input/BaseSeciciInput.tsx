import React, { useState, useRef, useEffect, useContext } from 'react';
import { MoreVertical, X, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AlertDialog from '../../dialog/AlertDialog';
import { useInputSettings, applyCasing, type HarfDonusumu } from './BaseInput';
import { DocumentHeaderFieldContext } from '../../../pages/base/BaseDocumentPage';

export interface BaseSeciciInputProps {
    id?: string;
    value?: any;
    onChange?: (val: any, rawValue?: any) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    onMenuClick?: () => void;
    onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
    onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
    error?: boolean | string;
    placeholder?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    hasSelection?: boolean;
    onClear?: () => void;
    detailsUrl?: string | null;
    detailsUrlTitle?: string;
    alertTitle?: string;
    alertMessage?: string;
    inputClassName?: string;
    inputStyle?: React.CSSProperties;
    icon?: React.ReactNode;
    menuIcon?: React.ReactNode;
    readOnly?: boolean;
    isMenuOpen?: boolean;
    onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
    clearable?: boolean;
    enableClearAlert?: boolean;
    casing?: HarfDonusumu;
    harfDonusumu?: HarfDonusumu;
    harfFormati?: HarfDonusumu;
    textTransform?: HarfDonusumu;
}

const BaseSeciciInput: React.FC<BaseSeciciInputProps> = ({ 
    id,
    value, 
    onChange, 
    onKeyDown, 
    onMenuClick, 
    onFocus,
    onBlur,
    error = false, 
    placeholder = '', 
    disabled = false, 
    autoFocus = false, 
    hasSelection = false, 
    onClear = undefined, 
    detailsUrl = null,
    detailsUrlTitle,
    alertTitle,
    alertMessage,
    inputClassName = "form-input",
    inputStyle = {},
    icon = null,
    menuIcon = null,
    readOnly = false,
    isMenuOpen = false,
    onClick = undefined,
    clearable = true,
    enableClearAlert = false,
    casing,
    harfDonusumu,
    harfFormati,
    textTransform
}) => {
    const { t } = useTranslation();
    const inputContext = useInputSettings();
    const [isAlertOpen, setIsAlertOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const rawCasing = casing || harfDonusumu || harfFormati || textTransform || inputContext?.defaultCasing;
    const isNone = !rawCasing || rawCasing === 'none' || rawCasing === 'girildigiGibi' || rawCasing === 'serbest';
    const activeCasing = !readOnly && !disabled && !isNone ? rawCasing : undefined;

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const rawValue = e.target.value;
        const transformed = (activeCasing && rawValue) ? applyCasing(rawValue, activeCasing) : rawValue;

        if (onChange) {
            onChange(e, transformed);
        }
    };

    const cssTextTransform: React.CSSProperties['textTransform'] = activeCasing
        ? (['hepsibuyuk', 'uppercase', 'upper'].includes(activeCasing.toLowerCase().replace(/[\s_-]/g, ''))
            ? 'uppercase'
            : ['hepsikucuk', 'lowercase', 'lower'].includes(activeCasing.toLowerCase().replace(/[\s_-]/g, ''))
                ? 'lowercase'
                : ['basharflerbuyuk', 'sadecebasharfleribuyuk', 'capitalize', 'titlecase', 'title'].includes(activeCasing.toLowerCase().replace(/[\s_-]/g, ''))
                    ? 'capitalize'
                    : undefined)
        : undefined;

    const mergedInputStyle: React.CSSProperties = {
        ...(cssTextTransform ? { textTransform: cssTextTransform } : {}),
        ...inputStyle
    };

    // hasSelection KESİNLİKLE sadece açıkça boolean true verildiğinde true olur.
    // Kullanıcının yazdığı value/text metninden asla seçim durumu çıkarılamaz.
    const effectiveHasSelection = Boolean(hasSelection);

    useEffect(() => {
        if (isMenuOpen && containerRef.current) {
            setTimeout(() => {
                if (!containerRef.current) return;
                const rect = containerRef.current.getBoundingClientRect();
                const dropdownEstimatedHeight = 280; 
                
                if (rect.bottom + dropdownEstimatedHeight > window.innerHeight) {
                    containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 50);
        }
    }, [isMenuOpen]);

    const handleActionClick = () => {
        if (effectiveHasSelection && clearable) {
            if (enableClearAlert) {
                setIsAlertOpen(true);
            } else {
                if (onClear) onClear();
            }
        } else {
            if (onMenuClick) onMenuClick();
        }
    };

    /**
     * Klavye Olayları:
     * 1. Tab / Enter tuşu: Text alanı boş değilse ve henüz seçim yapılmamışsa seçim ekranını aç
     * 2. Alt + ↓: Evrensel seçim menüsü açma standardı
     * 3. readOnly modunda Aşağı Ok / Enter / Boşluk
     */
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Text alanı boş değilken Tab veya Enter tuşuna basıldığında seçim listesini tetikle
        if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter') {
            const rawVal = (inputRef.current?.value ?? value ?? '').toString();
            if (rawVal.trim().length > 0 && !effectiveHasSelection) {
                e.preventDefault();
                if (!disabled && onMenuClick) {
                    onMenuClick();
                }
                return;
            }
        }

        const isStandardTrigger = !isMenuOpen && e.altKey && e.key === 'ArrowDown';
        const isReadOnlyTrigger = !isMenuOpen && readOnly && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ');

        if (isStandardTrigger || isReadOnlyTrigger) {
            e.preventDefault();
            if (!disabled && onMenuClick) onMenuClick();
            return;
        }
        
        if (onKeyDown) onKeyDown(e);
    };

    const finalDetailsTitle = detailsUrlTitle || t('auto_yeni_sekmede_ac', 'Yeni Sekmede Aç');
    const finalAlertTitle = alertTitle || t('auto_emin_misiniz', 'Emin misiniz?');
    const finalAlertMessage = alertMessage || t('auto_secili_kayit_temizlenecektir', 'Seçili kayıt temizlenecektir.');
    const finalActionTitle = (effectiveHasSelection && clearable) 
        ? t('auto_secimi_temizle', 'Seçimi Temizle') 
        : t('auto_secim_menusu', 'Seçim Menüsü');

    const headerFieldContext = useContext(DocumentHeaderFieldContext);
    const effectiveError = Boolean(error || headerFieldContext?.hasError || (inputClassName && inputClassName.includes('is-invalid')));

    return (
        <div ref={containerRef} className={`dropdown-secici-wrapper h-full ${icon ? 'has-icon-wrapper' : ''} ${effectiveError ? 'is-invalid' : ''}`}>
            {icon && <span className="icon">{icon}</span>}
            <input 
                id={id}
                ref={inputRef}
                type="text"
                className={`${inputClassName} ${effectiveError ? 'is-invalid' : ''} has-actions ${(effectiveHasSelection && detailsUrl) ? 'has-details' : ''}`}
                value={value || ''}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onClick={onClick}
                onFocus={onFocus}
                onBlur={onBlur}
                disabled={disabled}
                readOnly={readOnly}
                placeholder={placeholder || t('auto_ara', 'Ara...')}
                autoFocus={autoFocus}
                autoComplete="off"
                style={mergedInputStyle}
            />
            <div className="dropdown-actions-container">
                {effectiveHasSelection && detailsUrl && (
                    <a 
                        href={detailsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={finalDetailsTitle}
                        tabIndex={-1}
                        className="dropdown-action-btn"
                    >
                        <ExternalLink size={16} />
                    </a>
                )}
                <button 
                    type="button"
                    onClick={handleActionClick}
                    disabled={disabled}
                    tabIndex={-1}
                    title={finalActionTitle}
                    className="dropdown-action-btn"
                >
                    {(effectiveHasSelection && clearable) ? <X size={16} /> : (menuIcon || <MoreVertical size={16} />)}
                </button>
            </div>

            <AlertDialog
                isOpen={isAlertOpen}
                onClose={() => setIsAlertOpen(false)}
                type="confirm"
                title={finalAlertTitle}
                message={finalAlertMessage}
                confirmText={t('auto_evet_temizle', 'Evet, Temizle')}
                cancelText={t('auto_iptal', 'İptal')}
                onConfirm={() => {
                    if (onClear) onClear();
                    setIsAlertOpen(false);
                }}
            />
        </div>
    );
};

export default BaseSeciciInput;
