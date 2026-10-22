/**
 * @file AnahtarOlusturucuInput.tsx
 * @description
 * Akalin UI - Soyut Anahtar Oluşturucu Giriş Bileşeni (AnahtarOlusturucuInput / ApiKeyInput)
 *
 * Başlıca Görevleri:
 * - Özel/manuel CSS tanımlamaksızın tüm görsel özellikleri, ikon yerleşimini, `disabled`/`readOnly` davranışını
 *   ve form hata yönetimini doğrudan `BaseInput` ve `BaseButton` temel bileşenlerinden devralır.
 * - Input'un sağ iç kısmında (`rightAdornment`) mevcut anahtarı panoya kopyalayan ve `onCopy?.(value)` tetikleyen
 *   kopyalama düğmesi (`Copy` -> `Check`) barındırır.
 * - Bileşenin sağ tarafında `BaseButton` kullanarak anahtar üretme düğmesi sunar; `onGenerate` verilmişse onu çalıştırır,
 *   verilmemişse varsayılan rastgele anahtar üretip `onChange` üzerinden input değerine aktarır.
 */

import React, { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { Key, Copy, Check, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BaseInput, { BaseInputProps } from '../base/input/BaseInput';
import BaseButton, { BaseButtonProps } from '../base/button/BaseButton';

export interface AnahtarOlusturucuInputProps extends Omit<BaseInputProps, 'onChange' | 'onCopy'> {
  /** Anahtar metin değeri */
  value?: string;
  /** Değer değiştiğinde tetiklenir (hem event.target.value hem de 2. parametre olarak doğrudan string değer iletilir) */
  onChange?: (
    e: React.ChangeEvent<HTMLInputElement> | { target: { name?: string; id?: string; value: string } },
    value?: string
  ) => void;
  /** Doğrudan string değer değişimini dinlemek isteyen formlar için opsiyonel callback */
  onValueChange?: (value: string) => void;
  /** Kopyala düğmesine tıklandığında kopyalanan değer ile tetiklenir */
  onCopy?: (value: string) => void;
  /** Oluştur düğmesine tıklandığında tetiklenir. String dönerse otomatik olarak onChange'e de aktarılır. */
  onGenerate?: () => string | void | Promise<string | void>;
  /** Varsayılan anahtar üretici için anahtar uzunluğu (Varsayılan: 32) */
  keyLength?: number;
  /** Varsayılan anahtar üretici için ön ek (Örn: 'sk_', 'ak_') */
  keyPrefix?: string;
  /** Oluştur düğmesi metni (Varsayılan: 'Oluştur') */
  generateButtonText?: string;
  /** Oluştur düğmesi yükleniyor metni */
  generateLoadingText?: string;
  /** Oluştur düğmesi ikonu (Varsayılan: <RefreshCw size={16} />) */
  generateButtonIcon?: React.ReactNode;
  /** Oluştur düğmesi varyantı (Varsayılan: 'outline') */
  generateButtonVariant?: BaseButtonProps['variant'];
  /** Oluştur düğmesi ek özellikleri */
  generateButtonProps?: Partial<BaseButtonProps>;
  /** Oluştur düğmesi gösterilsin mi? (Varsayılan: true) */
  showGenerateButton?: boolean;
  /** Kopyala düğmesi gösterilsin mi? (Varsayılan: true) */
  showCopyButton?: boolean;
  /** Kopyala düğmesi ipucu metni (title) */
  copyButtonTitle?: string;
}

export type ApiKeyInputProps = AnahtarOlusturucuInputProps;

/**
 * Kriptografik olarak rastgele anahtar üreten yardımcı fonksiyon.
 */
export const generateRandomApiKey = (length: number = 32, prefix: string = ''): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const targetLength = Math.max(8, length);
  let result = '';

  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const randomValues = new Uint32Array(targetLength);
    window.crypto.getRandomValues(randomValues);
    for (let i = 0; i < targetLength; i++) {
      result += chars[randomValues[i] % chars.length];
    }
  } else {
    for (let i = 0; i < targetLength; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }

  return `${prefix}${result}`;
};

const AnahtarOlusturucuInput = forwardRef<HTMLInputElement, AnahtarOlusturucuInputProps>(
  (
    {
      id,
      name,
      value,
      defaultValue,
      onChange,
      onValueChange,
      onCopy,
      onGenerate,
      keyLength = 32,
      keyPrefix = '',
      generateButtonText,
      generateLoadingText,
      generateButtonIcon,
      generateButtonVariant = 'outline',
      generateButtonProps,
      showGenerateButton = true,
      showCopyButton = true,
      copyButtonTitle,
      icon,
      rightAdornment,
      rightActions,
      disabled = false,
      readOnly = false,
      placeholder,
      className = '',
      style,
      casing = 'none',
      ...restProps
    },
    ref
  ) => {
    const { t } = useTranslation();
    const [internalValue, setInternalValue] = useState<string>(() =>
      value !== undefined ? String(value) : defaultValue !== undefined ? String(defaultValue) : ''
    );
    const [copied, setCopied] = useState<boolean>(false);
    const [isGenerating, setIsGenerating] = useState<boolean>(false);
    const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const currentValue = value !== undefined ? String(value ?? '') : internalValue;

    useEffect(() => {
      return () => {
        if (copyTimeoutRef.current) {
          clearTimeout(copyTimeoutRef.current);
        }
      };
    }, []);

    const emitValueChange = useCallback(
      (nextValue: string, originalEvent?: React.ChangeEvent<HTMLInputElement>) => {
        if (value === undefined) {
          setInternalValue(nextValue);
        }

        if (onChange) {
          const eventToEmit =
            originalEvent ||
            ({
              target: {
                name,
                id,
                value: nextValue,
              },
              currentTarget: {
                name,
                id,
                value: nextValue,
              },
            } as React.ChangeEvent<HTMLInputElement>);

          onChange(eventToEmit, nextValue);
        }

        if (onValueChange) {
          onValueChange(nextValue);
        }
      },
      [value, onChange, onValueChange, name, id]
    );

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        emitValueChange(e.target.value, e);
      },
      [emitValueChange]
    );

    const handleCopy = useCallback(async () => {
      if (!currentValue) return;

      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(currentValue);
        } else if (typeof document !== 'undefined') {
          const textArea = document.createElement('textarea');
          textArea.value = currentValue;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
      } catch {
        // Panoya erişim kısıtlı olsa dahi onCopy callback'ini tetikle
      }

      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);

      if (onCopy) {
        onCopy(currentValue);
      }
    }, [currentValue, onCopy]);

    const handleGenerate = useCallback(async () => {
      if (disabled) return;

      if (onGenerate) {
        try {
          setIsGenerating(true);
          const generatedResult = await onGenerate();
          if (typeof generatedResult === 'string') {
            emitValueChange(generatedResult);
          }
        } finally {
          setIsGenerating(false);
        }
        return;
      }

      const newKey = generateRandomApiKey(keyLength, keyPrefix);
      emitValueChange(newKey);
    }, [disabled, onGenerate, keyLength, keyPrefix, emitValueChange]);

    const extraRightContent = rightAdornment ?? rightActions;

    const combinedRightAdornment =
      showCopyButton || extraRightContent ? (
        <>
          {extraRightContent}
          {showCopyButton && (
            <button
              type="button"
              onClick={handleCopy}
              disabled={disabled || !currentValue}
              tabIndex={-1}
              title={
                copied
                  ? t('auto_kopyalandi', 'Kopyalandı')
                  : copyButtonTitle || t('auto_kopyala', 'Kopyala')
              }
              className="dropdown-action-btn"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          )}
        </>
      ) : undefined;

    return (
      <div className={`flex items-center gap-8 w-full ${className}`.trim()} style={style}>
        <BaseInput
          ref={ref}
          id={id}
          name={name}
          value={currentValue}
          onChange={handleInputChange}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder || t('auto_anahtar_degeri', 'Anahtar değeri...')}
          icon={icon !== undefined ? icon : <Key size={16} />}
          rightAdornment={combinedRightAdornment}
          casing={casing}
          className="flex-1"
          {...restProps}
        />
        {showGenerateButton && (
          <BaseButton
            type="button"
            variant={generateButtonVariant}
            icon={generateButtonIcon !== undefined ? generateButtonIcon : <RefreshCw size={16} />}
            text={generateButtonText !== undefined ? generateButtonText : t('auto_olustur', 'Oluştur')}
            loadingText={generateLoadingText || t('auto_olusturuluyor', 'Oluşturuluyor...')}
            isSaving={isGenerating}
            disabled={disabled}
            onClick={handleGenerate}
            {...generateButtonProps}
          />
        )}
      </div>
    );
  }
);

AnahtarOlusturucuInput.displayName = 'AnahtarOlusturucuInput';

export { AnahtarOlusturucuInput, AnahtarOlusturucuInput as ApiKeyInput };
export default AnahtarOlusturucuInput;
