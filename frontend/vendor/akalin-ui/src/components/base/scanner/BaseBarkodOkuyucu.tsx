import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Camera } from 'lucide-react';
import { isNativePlatform } from '../../../utils/device';

export interface BaseBarkodOkuyucuProps {
    isActive: boolean;
    barkod: string;
    setBarkod: (val: string) => void;
    onBarkodScanned: (val: string) => void;
    loading: boolean;
    title?: string;
    description?: string;
    placeholder?: string;
    scannerId?: string; // Kept for backward compatibility but unused
}

const BaseBarkodOkuyucu = ({ 
    isActive, 
    barkod, 
    setBarkod, 
    onBarkodScanned, 
    loading,
    title = "Barkod Okutun",
    description = "Kamerayı kullanarak veya aşağıdaki alana yazarak barkod okutabilirsiniz.",
    placeholder = "Barkod numarası yazın veya okutun..."
}: BaseBarkodOkuyucuProps) => {
    const barkodInputRef = useRef<HTMLInputElement>(null);
    const [isNative] = useState(() => isNativePlatform());

    useEffect(() => {
        if (isActive) {
            setTimeout(() => barkodInputRef.current?.focus(), 100);
            
            const handleScannedBarcode = (e: any) => {
                const scannedBarcode = typeof e === 'string' ? e : e?.detail;
                if (scannedBarcode && typeof scannedBarcode === 'string') {
                    setBarkod(scannedBarcode);
                    onBarkodScanned(scannedBarcode);
                    toast.success("Barkod Terminali'nden okutuldu: " + scannedBarcode);
                }
            };

            window.addEventListener('barcode-scanned', handleScannedBarcode);

            return () => {
                window.removeEventListener('barcode-scanned', handleScannedBarcode);
            };
        }
    }, [isActive, setBarkod, onBarkodScanned]);

    const handleNativeScan = async () => {
        try {
            const scannerModule = await import(/* @vite-ignore */ '@capacitor-mlkit/barcode-scanning').catch(() => null);
            const BarcodeScanner = scannerModule?.BarcodeScanner || (typeof window !== 'undefined' && (window as any).BarcodeScanner);
            if (!BarcodeScanner) {
                toast.error("Barkod okuyucu modülü bulunamadı.");
                return;
            }

            // Request permissions if not granted
            const { camera } = await BarcodeScanner.requestPermissions();
            if (camera === 'granted' || camera === 'limited') {
                document.querySelector('body')?.classList.add('barcode-scanner-active');
                
                const { barcodes } = await BarcodeScanner.scan({ autoZoom: true });
                
                document.querySelector('body')?.classList.remove('barcode-scanner-active');

                if (barcodes.length > 0) {
                    const scannedValue = barcodes[0].rawValue;
                    if (scannedValue) {
                        setBarkod(scannedValue);
                        onBarkodScanned(scannedValue);
                    }
                }
            } else {
                toast.error("Kamera izni reddedildi. Lütfen ayarlardan izin verin.");
            }
        } catch (error) {
            document.querySelector('body')?.classList.remove('barcode-scanner-active');
            console.error(error);
            toast.error("Barkod okuyucu başlatılamadı.");
        }
    };

    const handleBarkodKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = barkod.trim();
            if (val) {
                onBarkodScanned(val);
            }
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', textAlign: 'center', padding: '24px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
            
            {title && <h3 style={{ margin: '10px 0 0', color: 'var(--text-primary)' }}>{title}</h3>}
            {description && (
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {description}
                </p>
            )}

            {!isNative && (
                <div style={{ background: 'var(--warning-light)', color: 'var(--warning)', padding: '12px', borderRadius: '8px', fontSize: '12px', marginTop: '12px', border: '1px solid var(--warning)' }}>
                    Bilgisayar kameraları ile okuma desteklenmemektedir. Lütfen barkodu manuel giriniz veya okutma işlemi için mobil uygulamayı kullanınız.
                </div>
            )}

            {isNative && (
                <button 
                    onClick={handleNativeScan}
                    disabled={loading}
                    className="btn btn-primary"
                    style={{ marginTop: '16px', width: '100%', maxWidth: '300px', padding: '16px', fontSize: '16px' }}
                >
                    <Camera size={20} style={{ marginRight: '8px' }} />
                    Kamerayı Aç ve Okut
                </button>
            )}
            
            <div style={{ position: 'relative', width: '100%', maxWidth: '400px', marginTop: '20px' }}>
                <input
                    ref={barkodInputRef}
                    type="text"
                    className="form-input"
                    placeholder={placeholder}
                    value={barkod}
                    onChange={(e) => setBarkod(e.target.value)}
                    onKeyDown={handleBarkodKeyDown}
                    disabled={loading}
                    style={{ padding: '16px', fontSize: '18px', textAlign: 'center', borderRadius: '8px', border: '2px solid var(--accent-primary)', background: 'var(--bg-primary)' }}
                />
                {loading && (
                    <div style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)' }}>
                        <div className="spinner" style={{ width: '20px', height: '20px', border: '2px solid var(--primary-light)', borderTopColor: 'var(--primary)' }}></div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BaseBarkodOkuyucu;
