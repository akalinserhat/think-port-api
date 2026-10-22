/**
 * Akalin UI - Telefon Numarası Giriş Bileşeni (PhoneInput)
 * 
 * Türkiye telefon numarası formatına (0 (5XX) XXX XX XX, 0 (850) XXX XX XX, 0 (2XX) XXX XX XX)
 * uygun anlık maskeleme, akıllı imleç (cursor) takibi, doğrulama ve temizleme sağlayan merkezi giriş bileşenidir.
 * 
 * Başlıca Görevleri:
 * - 11 haneli Türkiye standart telefon numaralarını otomatik formatlama (Örn: 05551234567 -> 0 (555) 123 45 67)
 * - Kullanıcı '5' veya alan kodu ile başladığında otomatik '0' başlığı ekleme (+90 / 0090 ayıklama)
 * - Rakam ekleme veya silme anında imlecin (cursor) en başa atlamasını engelleyip doğru rakamın ardında kalmasını sağlama
 * - Parantez ve boşluk gibi maske karakterlerinde Backspace silme işlemini akıcı kılma
 * - BasitInput / BaseInput ile birebir aynı görsel form-input tasarımı ve MD3 uyumu
 * - Hem form event (e.target.value) hem de doğrudan değer erişimini destekleme
 */

import React, { useState, useEffect, useLayoutEffect, useRef, forwardRef, useCallback } from 'react';
import { Phone } from 'lucide-react';
import BaseInput from '../base/input/BaseInput';

export interface PhoneInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value?: string | number | null;
  onChange?: (e: React.ChangeEvent<HTMLInputElement> | any) => void;
  name?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  inputClassName?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
  showIcon?: boolean;
  raw?: boolean;
  onValidityChange?: (isValid: boolean, errorMsg?: string) => void;
}

/**
 * Türkiye telefon numarası formatlayıcı.
 * @param val Formatlanacak telefon numarası metni, sayısı veya obje.
 * @returns Formatlanmış telefon metni (Örn: 0 (532) 123 45 67)
 */
export const formatPhoneNumber = (val: any): string => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    val = val?.target?.value ?? val?.value ?? '';
  }
  let digits = String(val).replace(/\D/g, '');
  if (!digits) return '';

  // +90 veya 0090 ülke kodları yapıştırıldığında temizle
  if (digits.startsWith('90') && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0090') && digits.length === 14) {
    digits = digits.slice(4);
  }

  // Kullanıcı doğrudan 5 veya alan koduyla başladığında başına 0 ekle
  let normalized = digits;
  if (normalized.length > 0 && normalized[0] !== '0') {
    normalized = '0' + normalized;
  }

  // Maksimum 11 hane (0 + 10 hane numara)
  if (normalized.length > 11) {
    normalized = normalized.slice(0, 11);
  }

  if (normalized.length < 2) return normalized;
  if (normalized.length < 5) {
    return `${normalized.slice(0, 1)} (${normalized.slice(1)}`;
  }
  if (normalized.length < 8) {
    return `${normalized.slice(0, 1)} (${normalized.slice(1, 4)}) ${normalized.slice(4)}`;
  }
  if (normalized.length < 10) {
    return `${normalized.slice(0, 1)} (${normalized.slice(1, 4)}) ${normalized.slice(4, 7)} ${normalized.slice(7)}`;
  }
  return `${normalized.slice(0, 1)} (${normalized.slice(1, 4)}) ${normalized.slice(4, 7)} ${normalized.slice(7, 9)} ${normalized.slice(9, 11)}`;
};

/**
 * Telefon numarasının Türkiye standartlarında (10 veya 11 hane) geçerli olup olmadığını doğrular.
 */
export const validatePhoneNumber = (val: any): boolean => {
  if (!val) return false;
  if (typeof val === 'object') {
    val = val?.target?.value ?? val?.value ?? '';
  }
  let digits = String(val).replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0090') && digits.length === 14) {
    digits = digits.slice(4);
  }
  if (digits.length === 11 && digits.startsWith('0')) return true;
  if (digits.length === 10 && !digits.startsWith('0')) return true;
  return false;
};

/**
 * Formatlanmış metin içerisinde belirtilen hedef rakam sayısına karşılık gelen imleç indeksini hesaplar.
 */
const calculateNewCursorPosition = (formatted: string, targetDigitsCount: number): number => {
  if (targetDigitsCount <= 0 || !formatted) return 0;

  let counted = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      counted++;
      if (counted === targetDigitsCount) {
        let pos = i + 1;
        // İleriye doğru format karakterlerini (boşluk, parantez) atla
        while (pos < formatted.length && !/\d/.test(formatted[pos])) {
          pos++;
        }
        return pos;
      }
    }
  }
  return formatted.length;
};

const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(({
  value,
  onChange,
  onKeyDown,
  name,
  placeholder = "0 (5XX) XXX XX XX",
  required = false,
  disabled = false,
  readOnly = false,
  className = "",
  inputClassName = "form-input",
  style = {},
  autoFocus = false,
  showIcon = false,
  raw = false,
  onValidityChange,
  ...rest
}, ref) => {
  const [displayValue, setDisplayValue] = useState<string>(() => formatPhoneNumber(value));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nextCursorPosRef = useRef<number | null>(null);

  const setCombinedRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    }
  }, [ref]);

  useEffect(() => {
    setDisplayValue(formatPhoneNumber(value));
  }, [value]);

  useLayoutEffect(() => {
    if (nextCursorPosRef.current !== null && inputRef.current) {
      const pos = nextCursorPosRef.current;
      inputRef.current.setSelectionRange(pos, pos);
    }
  }, [displayValue]);

  const setSelection = useCallback((pos: number) => {
    nextCursorPosRef.current = pos;
    if (inputRef.current) {
      inputRef.current.setSelectionRange(pos, pos);
    }
    requestAnimationFrame(() => {
      if (inputRef.current && nextCursorPosRef.current !== null) {
        inputRef.current.setSelectionRange(nextCursorPosRef.current, nextCursorPosRef.current);
        nextCursorPosRef.current = null;
      }
    });
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const cursorPositionBefore = input.selectionStart || 0;
    const rawValue = input.value;
    const digitsBeforeCursor = rawValue.slice(0, cursorPositionBefore).replace(/\D/g, '').length;

    let rawDigits = rawValue.replace(/\D/g, '');
    if (rawDigits.startsWith('90') && rawDigits.length === 12) {
      rawDigits = rawDigits.slice(2);
    } else if (rawDigits.startsWith('0090') && rawDigits.length === 14) {
      rawDigits = rawDigits.slice(4);
    }

    let limitedDigits = rawDigits;
    let autoZeroPrepended = false;
    if (limitedDigits.length > 0 && limitedDigits[0] !== '0' && limitedDigits.length <= 10) {
      limitedDigits = '0' + limitedDigits;
      autoZeroPrepended = true;
    }
    if (limitedDigits.length > 11) {
      limitedDigits = limitedDigits.slice(0, 11);
    }

    const formatted = formatPhoneNumber(limitedDigits);
    setDisplayValue(formatted);

    const targetDigitsBefore = digitsBeforeCursor + (autoZeroPrepended ? 1 : 0);
    const newPos = calculateNewCursorPosition(formatted, targetDigitsBefore);
    setSelection(newPos);

    const isValid = validatePhoneNumber(limitedDigits);
    if (onValidityChange) {
      onValidityChange(isValid, isValid ? undefined : 'Geçersiz telefon numarası');
    }

    if (onChange) {
      const outputValue = raw ? limitedDigits : formatted;
      e.target.value = outputValue;
      (e as any).rawValue = limitedDigits;
      (e as any).isValid = isValid;
      onChange(e);
    }
  }, [onChange, raw, onValidityChange, setSelection]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (onKeyDown) {
      onKeyDown(e);
      if (e.defaultPrevented) return;
    }

    if (e.key === 'Backspace') {
      const input = e.currentTarget;
      const start = input.selectionStart;
      const end = input.selectionEnd;

      // Sadece metin seçili değilken (tekil imleç)
      if (start !== null && start === end && start > 0) {
        const val = input.value;
        const charToDelete = val[start - 1];

        // Eğer imlecin solundaki karakter rakam değilse (parantez veya boşluk)
        if (!/\d/.test(charToDelete)) {
          e.preventDefault();

          // Sola doğru ilk rakamın indeksini bul
          let lastDigitIndex = -1;
          for (let i = start - 1; i >= 0; i--) {
            if (/\d/.test(val[i])) {
              lastDigitIndex = i;
              break;
            }
          }

          if (lastDigitIndex !== -1) {
            const newVal = val.slice(0, lastDigitIndex) + val.slice(lastDigitIndex + 1);
            let rawDigits = newVal.replace(/\D/g, '');
            if (rawDigits.startsWith('90') && rawDigits.length === 12) {
              rawDigits = rawDigits.slice(2);
            }

            let limitedDigits = rawDigits;
            if (limitedDigits.length > 0 && limitedDigits[0] !== '0' && limitedDigits.length <= 10) {
              limitedDigits = '0' + limitedDigits;
            }
            if (limitedDigits.length > 11) {
              limitedDigits = limitedDigits.slice(0, 11);
            }

            const formatted = formatPhoneNumber(limitedDigits);
            setDisplayValue(formatted);

            const digitsBefore = val.slice(0, lastDigitIndex).replace(/\D/g, '').length;
            const newPos = calculateNewCursorPosition(formatted, digitsBefore);
            setSelection(newPos);

            const isValid = validatePhoneNumber(limitedDigits);
            if (onValidityChange) {
              onValidityChange(isValid, isValid ? undefined : 'Geçersiz telefon numarası');
            }

            if (onChange) {
              const outputValue = raw ? limitedDigits : formatted;
              const syntheticEvent = {
                ...e,
                target: { ...input, value: outputValue, name: input.name },
                currentTarget: { ...input, value: outputValue, name: input.name },
                rawValue: limitedDigits,
                isValid
              };
              onChange(syntheticEvent as any);
            }
          }
        }
      }
    }
  }, [onChange, onKeyDown, raw, onValidityChange, setSelection]);

  return (
    <BaseInput
      ref={setCombinedRef}
      icon={showIcon ? <Phone size={16} /> : undefined}
      type="tel"
      casing="none"
      harfDonusumu="none"
      name={name}
      value={displayValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      readOnly={readOnly}
      className={className}
      inputClassName={inputClassName || className}
      style={style}
      autoFocus={autoFocus}
      maxLength={19}
      {...(rest as any)}
    />
  );
});

PhoneInput.displayName = 'PhoneInput';

export default PhoneInput;
