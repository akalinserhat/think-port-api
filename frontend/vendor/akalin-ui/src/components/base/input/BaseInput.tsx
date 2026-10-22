/**
 * Akalin UI - Temel Giriş Bileşeni (BaseInput)
 * Standart input ve textarea alanlarını ikon, hata durumu, çok satırlı yapı (multiline)
 * ve otomatik harf dönüşümü (casing / harfDonusumu: Hepsi Büyük, Hepsi Küçük, Sadece Baş Harfleri Büyük)
 * desteğiyle sunan temel form bileşeni.
 */

import React, { forwardRef, useContext } from 'react';
import { DocumentFormContext, DocumentHeaderFieldContext } from '../../../pages/base/BaseDocumentPage';
import { createSingletonContext } from '../../../utils/createSingletonContext';

export type HarfDonusumu = 
    | 'hepsiBuyuk' 
    | 'hepsiKucuk' 
    | 'basHarflerBuyuk'
    | 'Hepsi Büyük'
    | 'Hepsi Küçük'
    | 'Sadece Baş Harfleri Büyük'
    | 'uppercase' 
    | 'lowercase' 
    | 'capitalize' 
    | 'titlecase'
    | 'girildigiGibi'
    | 'serbest'
    | 'none';

export type TextCasing = HarfDonusumu;

export const HarfDonusumu = {
    HepsiBuyuk: 'hepsiBuyuk' as const,
    HepsiKucuk: 'hepsiKucuk' as const,
    BasHarflerBuyuk: 'basHarflerBuyuk' as const,
    GirildigiGibi: 'girildigiGibi' as const,
    Uppercase: 'uppercase' as const,
    Lowercase: 'lowercase' as const,
    Capitalize: 'capitalize' as const,
};

/**
 * Türkçe kurallarına uygun harf dönüşüm fonksiyonu.
 */
export const applyCasing = (value: string, mode?: HarfDonusumu): string => {
    if (!value || !mode) return value;

    const normalizedMode = mode.toString().toLowerCase().replace(/[\s_-]/g, '');

    switch (normalizedMode) {
        case 'hepsibuyuk':
        case 'uppercase':
        case 'upper':
            return value.toLocaleUpperCase('tr-TR');

        case 'hepsikucuk':
        case 'lowercase':
        case 'lower':
            return value.toLocaleLowerCase('tr-TR');

        case 'basharflerbuyuk':
        case 'sadecebasharfleribuyuk':
        case 'capitalize':
        case 'titlecase':
        case 'title':
            return value.replace(/([a-zA-ZçÇğĞıİöÖşŞüÜ]+)/g, (word) => {
                const first = word.charAt(0).toLocaleUpperCase('tr-TR');
                const rest = word.slice(1).toLocaleLowerCase('tr-TR');
                return first + rest;
            });

        default:
            return value;
    }
};

export interface InputSettingsContextType {
    defaultCasing?: HarfDonusumu;
}

export const InputSettingsContext = createSingletonContext<InputSettingsContextType>(
    '__AKALIN_UI_INPUT_SETTINGS_CONTEXT__',
    {},
    'InputSettingsContext'
);

export const useInputSettings = () => React.useContext(InputSettingsContext);

export const InputSettingsProvider: React.FC<{ defaultCasing?: HarfDonusumu; children: React.ReactNode }> = ({ defaultCasing, children }) => {
    return (
        <InputSettingsContext.Provider value={{ defaultCasing }}>
            {children}
        </InputSettingsContext.Provider>
    );
};

export interface BaseInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'textTransform'> {
    icon?: React.ReactNode;
    rightAdornment?: React.ReactNode;
    rightActions?: React.ReactNode;
    error?: boolean | string;
    inputClassName?: string;
    inputStyle?: React.CSSProperties;
    multiline?: boolean;
    rows?: number;
    casing?: HarfDonusumu;
    harfDonusumu?: HarfDonusumu;
    harfFormati?: HarfDonusumu;
    textTransform?: HarfDonusumu;
}

const BaseInput = forwardRef<HTMLInputElement, BaseInputProps>(({
    icon,
    rightAdornment,
    rightActions,
    error,
    className,
    inputClassName = "form-input",
    style,
    inputStyle,
    multiline,
    rows,
    casing,
    harfDonusumu,
    harfFormati,
    textTransform,
    onChange,
    value,
    defaultValue,
    ...rest
}, ref) => {
    const inputContext = useContext(InputSettingsContext);
    const formContext = useContext(DocumentFormContext);
    const headerFieldContext = useContext(DocumentHeaderFieldContext);

    const formError = (rest.name && formContext?.errors?.[rest.name]) ||
                      (rest.id && formContext?.errors?.[rest.id]);

    const isInvalid = Boolean(
        error || 
        formError || 
        headerFieldContext?.hasError || 
        (className && className.includes('is-invalid')) || 
        (inputClassName && inputClassName.includes('is-invalid'))
    );

    const rawCasing = casing || harfDonusumu || harfFormati || textTransform || inputContext?.defaultCasing;
    const isSpecialType = rest.type === 'password' || 
                          rest.type === 'number' || 
                          rest.type === 'date' || 
                          rest.type === 'time' || 
                          rest.type === 'color' ||
                          rest.type === 'tel' ||
                          rest.type === 'email' ||
                          rest.type === 'url';
    const isNone = !rawCasing || rawCasing === 'none' || rawCasing === 'girildigiGibi' || rawCasing === 'serbest';
    const activeCasing = !isSpecialType && !isNone ? rawCasing : undefined;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (activeCasing && e.target.value) {
            const input = e.target;
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const transformed = applyCasing(input.value, activeCasing);
            input.value = transformed;

            if (onChange) {
                onChange(e as any);
            }

            if (start !== null && end !== null) {
                requestAnimationFrame(() => {
                    input.setSelectionRange(start, end);
                });
            }
        } else if (onChange) {
            onChange(e as any);
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

    const rightNode = rightAdornment ?? rightActions;
    const hasWrapper = Boolean(icon || rightNode);

    const finalInputClassName = Array.from(new Set([
        'form-input',
        inputClassName && inputClassName !== 'form-input' ? inputClassName : '',
        !hasWrapper && className ? className : '',
        rightNode ? 'has-actions' : '',
        isInvalid ? 'is-invalid' : ''
    ].filter(Boolean).join(' ').split(/\s+/))).filter(Boolean).join(' ');

    const inputElement = multiline ? (
        <textarea
            ref={ref as any}
            className={finalInputClassName}
            style={{
                ...(icon ? { paddingLeft: '40px' } : {}),
                paddingTop: '12px',
                resize: 'vertical',
                ...mergedInputStyle,
                ...(!hasWrapper ? style : {})
            }}
            rows={rows || 4}
            value={value}
            defaultValue={defaultValue}
            onChange={handleChange}
            {...(rest as any)}
        />
    ) : (
        <input
            ref={ref}
            className={finalInputClassName}
            style={{
                ...(icon ? { paddingLeft: '36px' } : {}),
                ...mergedInputStyle,
                ...(!hasWrapper ? style : {})
            }}
            value={value}
            defaultValue={defaultValue}
            onChange={handleChange}
            {...rest}
        />
    );

    if (hasWrapper) {
        const cleanClassName = className ? className.replace(/\bform-input\b/g, '').trim() : '';
        const wrapperClass = [
            icon ? 'input-with-icon' : '',
            rightNode ? 'dropdown-secici-wrapper' : '',
            rightNode && icon ? 'has-icon-wrapper' : '',
            cleanClassName,
            isInvalid ? 'is-invalid' : ''
        ].filter(Boolean).join(' ');

        return (
            <div className={wrapperClass} style={{ width: '100%', alignItems: multiline ? 'flex-start' : 'center', ...style }}>
                {icon && <span className="icon" style={multiline ? { top: '12px', left: '14px', transform: 'none' } : undefined}>{icon}</span>}
                {inputElement}
                {rightNode && (
                    <div className="dropdown-actions-container">
                        {rightNode}
                    </div>
                )}
            </div>
        );
    }

    return inputElement;
});

BaseInput.displayName = 'BaseInput';

export default BaseInput;
