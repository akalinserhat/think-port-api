/**
 * @file EpostaSeciciInput.tsx
 * @description
 * Akalin UI - Soyut E-Posta Seçici Giriş Bileşeni (EpostaSeciciInput / epostaSeciciInput)
 *
 * Başlıca Görevleri:
 * - Belirli bir modüle, tabloya veya API adresine bağımlı olmaksızın BaseSeciciInput bileşenini sarmalar.
 * - E-posta yazımına uygun olarak varsayılan küçük harf dönüşümü (`harfDonusumu = 'hepsiKucuk'`) ve sol `<Mail size={16} />` ikonu sunar.
 * - Seçim yapılmamışken (`hasSelection === false`) yazılan arama/e-posta metnini Enter, Tab, Alt+ArrowDown veya üç nokta menü butonu ile
 *   üst bileşendeki `BaseSelectionList` sayfasına/modalına (`onOpenSelection(searchText)`) aktarır.
 * - Kayıt seçildiğinde (`hasSelection === true` veya `selectedItem` dolu olduğunda) seçili kaydın e-posta adresini veya
 *   `formatDisplayValue` ile biçimlendirilmiş metnini gösterir ve sağ aksiyon butonunu temizleme (`X`) butonuna dönüştürür.
 * - Opsiyonel `validateEmailFormat` prop'u ile standart e-posta format doğrulaması (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) sağlar.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BaseSeciciInput, { BaseSeciciInputProps } from '../base/input/BaseSeciciInput';

export const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmailAddress = (email?: string | null): boolean => {
  if (!email) return true;
  return EMAIL_FORMAT_REGEX.test(email.trim());
};

export interface EpostaSeciciInputProps extends Omit<BaseSeciciInputProps, 'onChange'> {
  /** Input içinde gösterilecek e-posta veya arama metni */
  value?: string;
  /** Seçili kaydın benzersiz ID'si veya nesnesi varsa seçim yapılmış kabul edilir */
  selectedItem?: any;
  /** Seçili kayıt için doğrudan gösterilecek metin (opsiyonel) */
  displayValue?: string;
  /** Kullanıcı input'a yazdığında tetiklenir */
  onChange?: (value: string, e?: React.ChangeEvent<HTMLInputElement>) => void;
  /** Seçim listesi (BaseSelectionList / Modal) açılmak istendiğinde mevcut arama metni ile tetiklenir */
  onOpenSelection?: (searchText: string) => void;
  /** Seçili kayıt için özel gösterim formatlayıcı (ör. (item) => `${item.email} (${item.full_name})`) */
  formatDisplayValue?: (selectedItem: any, rawValue?: string) => string;
  /** E-posta format doğrulaması yapılsın mı? (Varsayılan: false) */
  validateEmailFormat?: boolean;
  /** Seçim listesi modalını/sayfasını bileşen altında render etmek isteyen sayfalar için opsiyonel render prop */
  renderSelectionModal?: (props: {
    isOpen: boolean;
    searchText: string;
    onClose: () => void;
  }) => React.ReactNode;
  /** Kapsayıcı (wrapper) CSS sınıfı */
  className?: string;
  /** Kapsayıcı (wrapper) stil nesnesi */
  style?: React.CSSProperties;
}

/**
 * Seçili nesne içerisinden e-posta veya okunabilir metin alanını çözer.
 */
const resolveSelectedItemText = (selectedItem: any, fallbackValue?: string): string => {
  if (selectedItem === undefined || selectedItem === null) {
    return fallbackValue ?? '';
  }
  if (typeof selectedItem === 'string') {
    return selectedItem;
  }
  if (typeof selectedItem === 'object') {
    const emailCandidate =
      selectedItem.eposta ??
      selectedItem.email ??
      selectedItem.e_posta ??
      selectedItem.ePosta ??
      selectedItem.mail ??
      selectedItem.emailAddress ??
      selectedItem.ad ??
      selectedItem.name ??
      selectedItem.title;

    if (typeof emailCandidate === 'string' && emailCandidate.trim().length > 0) {
      return emailCandidate;
    }
  }
  return fallbackValue ?? '';
};

const EpostaSeciciInput: React.FC<EpostaSeciciInputProps> = ({
  id,
  value,
  selectedItem,
  displayValue,
  onChange,
  onOpenSelection,
  onMenuClick,
  onClear,
  formatDisplayValue,
  validateEmailFormat = false,
  renderSelectionModal,
  hasSelection,
  error = false,
  placeholder,
  disabled = false,
  readOnly = false,
  clearable = true,
  icon,
  harfDonusumu = 'hepsiKucuk',
  casing,
  harfFormati,
  textTransform,
  isMenuOpen,
  className = '',
  style,
  ...restProps
}) => {
  const { t } = useTranslation();
  const [internalValue, setInternalValue] = useState<string>(value ?? '');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalSearchText, setModalSearchText] = useState<string>('');

  // Seçim durumu: açıkça hasSelection verilmişse onu kullan, aksi halde selectedItem varlığına bak
  const effectiveHasSelection = useMemo(() => {
    if (hasSelection !== undefined) {
      return Boolean(hasSelection);
    }
    if (selectedItem === undefined || selectedItem === null || selectedItem === '' || selectedItem === false) {
      return false;
    }
    if (typeof selectedItem === 'object' && Object.keys(selectedItem).length === 0) {
      return false;
    }
    return true;
  }, [hasSelection, selectedItem]);

  // Mevcut ham metin (kontrollü veya kontrolsüz kullanım)
  const rawInputValue = value !== undefined ? value : internalValue;

  // Input içerisinde görüntülenecek nihai metin
  const resolvedInputValue = useMemo(() => {
    if (effectiveHasSelection) {
      if (formatDisplayValue && selectedItem !== undefined && selectedItem !== null) {
        return formatDisplayValue(selectedItem, rawInputValue);
      }
      if (displayValue !== undefined && displayValue !== null && displayValue !== '') {
        return displayValue;
      }
      if (rawInputValue && rawInputValue.trim().length > 0) {
        return rawInputValue;
      }
      return resolveSelectedItemText(selectedItem, rawInputValue);
    }
    return rawInputValue ?? '';
  }, [effectiveHasSelection, formatDisplayValue, selectedItem, displayValue, rawInputValue]);

  // Opsiyonel e-posta format doğrulaması
  const isFormatInvalid = useMemo(() => {
    if (!validateEmailFormat) return false;

    if (effectiveHasSelection) {
      // Seçili kayıt varsa kaydın ham e-posta değerini kontrol et (formatDisplayValue kaynaklı ek metinleri hariç tut)
      const candidateEmail =
        typeof selectedItem === 'object' && selectedItem !== null
          ? (selectedItem.eposta ??
             selectedItem.email ??
             selectedItem.e_posta ??
             selectedItem.ePosta ??
             selectedItem.mail ??
             rawInputValue)
          : rawInputValue;

      if (!candidateEmail || typeof candidateEmail !== 'string' || candidateEmail.trim().length === 0) {
        return false;
      }
      return !isValidEmailAddress(candidateEmail);
    }

    const trimmed = (rawInputValue ?? '').trim();
    if (!trimmed) return false;
    return !isValidEmailAddress(trimmed);
  }, [validateEmailFormat, effectiveHasSelection, selectedItem, rawInputValue]);

  const effectiveError = Boolean(error) || isFormatInvalid;

  // Kullanıcı input alanına yazdığında
  const handleBaseChange = useCallback(
    (eOrVal: any, transformedVal?: string) => {
      const nextValue =
        typeof transformedVal === 'string'
          ? transformedVal
          : typeof eOrVal === 'string'
            ? eOrVal
            : (eOrVal?.target?.value ?? '');

      if (value === undefined) {
        setInternalValue(nextValue);
      }

      const eventObj =
        eOrVal && typeof eOrVal === 'object' && 'target' in eOrVal
          ? (eOrVal as React.ChangeEvent<HTMLInputElement>)
          : undefined;

      if (onChange) {
        onChange(nextValue, eventObj);
      }
    },
    [value, onChange]
  );

  // Seçim listesi (Enter, Tab, Alt+ArrowDown veya üç nokta menü butonu ile) tetiklendiğinde
  const handleOpenSelection = useCallback(() => {
    if (disabled) return;
    const currentSearchText = effectiveHasSelection ? '' : (rawInputValue ?? '').trim();
    setModalSearchText(currentSearchText);

    if (renderSelectionModal) {
      setIsModalOpen(true);
    }

    if (onOpenSelection) {
      onOpenSelection(currentSearchText);
    }

    if (onMenuClick) {
      onMenuClick();
    }
  }, [disabled, effectiveHasSelection, rawInputValue, renderSelectionModal, onOpenSelection, onMenuClick]);

  // Seçim temizlendiğinde (X butonu)
  const handleClearSelection = useCallback(() => {
    setInternalValue('');
    setModalSearchText('');

    if (onClear) {
      onClear();
    } else if (onChange) {
      onChange('');
    }
  }, [onClear, onChange]);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const effectiveIsMenuOpen = isMenuOpen !== undefined ? isMenuOpen : isModalOpen;

  const wrapperContent = (
    <>
      <BaseSeciciInput
        id={id}
        value={resolvedInputValue}
        onChange={handleBaseChange}
        onMenuClick={handleOpenSelection}
        onClear={handleClearSelection}
        hasSelection={effectiveHasSelection}
        clearable={clearable}
        error={effectiveError}
        disabled={disabled}
        readOnly={readOnly}
        placeholder={placeholder || t('auto_eposta_veya_kisi_ara', 'ornek@sirket.com veya ara...')}
        icon={icon !== undefined ? icon : <Mail size={16} />}
        harfDonusumu={harfDonusumu}
        casing={casing}
        harfFormati={harfFormati}
        textTransform={textTransform}
        isMenuOpen={effectiveIsMenuOpen}
        {...restProps}
      />
      {renderSelectionModal &&
        renderSelectionModal({
          isOpen: effectiveIsMenuOpen,
          searchText: modalSearchText,
          onClose: handleCloseModal,
        })}
    </>
  );

  if (className || style) {
    return (
      <div className={className} style={style}>
        {wrapperContent}
      </div>
    );
  }

  return wrapperContent;
};

EpostaSeciciInput.displayName = 'EpostaSeciciInput';

export { EpostaSeciciInput, EpostaSeciciInput as epostaSeciciInput };
export default EpostaSeciciInput;
