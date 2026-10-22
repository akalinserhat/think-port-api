/**
 * Akalin UI - Barkod Tarayıcılı Giriş Bileşeni (BarcodeScannerInput)
 * Metin alanı yanındaki kamera butonu ile mobil cihaz kamerasını tetikleyip
 * barkodu tarayarak doğrudan alana aktaran standart veri giriş bileşeni.
 */
import React, { useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BarcodeScannerModal from '../modal/BarcodeScannerModal';
import AlertDialog from '../../alerts/AlertDialog';
import { isNativePlatform, isMobileBrowser } from '../../utils/device';

export interface BarcodeScannerInputProps {
    value?: string;
    onChange?: (e: { target: { name?: string; value: string } } | React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    error?: boolean | string;
    placeholder?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    onScan?: (decodedText: string) => void;
    className?: string;
    style?: React.CSSProperties;
    inputClassName?: string;
    inputStyle?: React.CSSProperties;
    name?: string;
}

export const canOpenBarcodeScanner = async (): Promise<boolean> => {
    if (isNativePlatform()) {
        return true;
    }
    if (!isMobileBrowser()) {
        return false;
    }
    try {
        const scannerModule = await import(/* @vite-ignore */ '@capacitor-mlkit/barcode-scanning').catch(() => null);
        const BarcodeScanner = scannerModule?.BarcodeScanner || (typeof window !== 'undefined' && (window as any).BarcodeScanner);
        if (!BarcodeScanner?.isSupported) return false;
        const result = await BarcodeScanner.isSupported();
        return !!result?.supported;
    } catch {
        return false;
    }
};

const BarcodeScannerInput: React.FC<BarcodeScannerInputProps> = ({ 
    value, 
    onChange, 
    onKeyDown, 
    error, 
    placeholder, 
    disabled = false, 
    autoFocus = false, 
    onScan,
    className = '',
    style,
    inputClassName = '',
    inputStyle,
    name
}) => {
    const { t } = useTranslation();
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [alertOpen, setAlertOpen] = useState(false);

    const handleOpenScanner = async () => {
        if (disabled) return;
        const canOpen = await canOpenBarcodeScanner();
        if (canOpen) {
            setIsScannerOpen(true);
        } else {
            setAlertOpen(true);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && e.altKey) {
            e.preventDefault();
            handleOpenScanner();
        }
        if (onKeyDown) onKeyDown(e);
    };

    const handleScan = (decodedText: string) => {
        if (onScan) {
            onScan(decodedText);
        }
        if (onChange) {
            onChange({ target: { name, value: decodedText } });
        }
    };

    return (
        <div className={`relative flex items-center w-full h-full ${className}`} style={style}>
            <input 
                type="text"
                className={`form-input w-full ${error ? 'error is-invalid' : ''} ${inputClassName}`}
                value={value || ''}
                onChange={onChange}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                autoFocus={autoFocus}
                name={name}
                placeholder={placeholder || t('Barkod...') || 'Barkod...'}
                autoComplete="off"
                style={{ 
                    paddingRight: '32px',
                    ...inputStyle
                }}
            />
            <button 
                type="button"
                onClick={handleOpenScanner}
                disabled={disabled}
                tabIndex={-1}
                title={t('Barkod Tara (Alt+Enter)') || 'Barkod Tara (Alt+Enter)'}
                className="absolute right-6 top-1/2 -translate-y-1/2 bg-transparent border-0 flex items-center justify-center p-4 cursor-pointer text-secondary hover:text-primary transition-colors"
                style={{
                    position: 'absolute',
                    right: '6px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    cursor: disabled ? 'default' : 'pointer'
                }}
            >
                <ScanBarcode size={16} />
            </button>

            <BarcodeScannerModal
                isOpen={isScannerOpen}
                onClose={() => setIsScannerOpen(false)}
                onScan={handleScan}
            />
            
            <AlertDialog
                isOpen={alertOpen}
                onClose={() => setAlertOpen(false)}
                type="warning"
                title={t('Desteklenmeyen Cihaz') || 'Desteklenmeyen Cihaz'}
                message={t('Bilgisayar veya bu web tarayıcı kameraları ile okuma desteklenmemektedir. Lütfen barkod okutma işlemi için desteklenen bir mobil tarayıcı veya uygulamamızı kullanınız.') || 'Bilgisayar veya bu web tarayıcı kameraları ile okuma desteklenmemektedir. Lütfen barkod okutma işlemi için desteklenen bir mobil tarayıcı veya uygulamamızı kullanınız.'}
                confirmText={t('Tamam') || 'Tamam'}
                onConfirm={() => setAlertOpen(false)}
            />
        </div>
    );
};

export default BarcodeScannerInput;
