/**
 * Akalin UI - Barkod Okuyucu Modalı (BarcodeScannerModal)
 * Mobil kamera veya cihaz kamerası üzerinden barkod/karekod okutmayı sağlayan modal.
 */
import React, { useState, useEffect, useRef } from 'react';
import BasePopup from '../../pages/base/BasePopup';
import toast from 'react-hot-toast';
import { Camera } from 'lucide-react';
import { isNativePlatform } from '../../utils/device';

export interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan?: (decodedText: string) => void;
}

const getBarcodeScanner = async () => {
  try {
    const mod = await import(/* @vite-ignore */ '@capacitor-mlkit/barcode-scanning');
    return mod.BarcodeScanner || mod;
  } catch {
    return (typeof window !== 'undefined' ? (window as any).BarcodeScanner : null);
  }
};

const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({ isOpen, onClose, onScan }) => {
  const [isNative] = useState(() => isNativePlatform());
  const [isScanning, setIsScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleScan = async () => {
      try {
          const BarcodeScanner = await getBarcodeScanner();
          if (!BarcodeScanner) {
              toast.error("Barkod tarayıcı modülü bulunamadı.");
              return;
          }

          const { camera } = await BarcodeScanner.requestPermissions();
          if (camera === 'granted' || camera === 'limited' || camera === 'prompt') {
              if (isNative) {
                  document.querySelector('body')?.classList.add('barcode-scanner-active');
                  const { barcodes } = await BarcodeScanner.scan({ autoZoom: true });
                  document.querySelector('body')?.classList.remove('barcode-scanner-active');

                  if (barcodes.length > 0 && barcodes[0].rawValue) {
                      if (onScan) onScan(barcodes[0].rawValue);
                      onClose();
                  }
              } else if (videoRef.current) {
                  setIsScanning(true);
                  await BarcodeScanner.startScan({ videoElement: videoRef.current });
              }
          } else {
              toast.error("Kamera izni reddedildi. Lütfen ayarlardan izin verin.");
          }
      } catch (error) {
          document.querySelector('body')?.classList.remove('barcode-scanner-active');
          setIsScanning(false);
          console.error(error);
          toast.error("Barkod okuyucu başlatılamadı.");
      }
  };

  useEffect(() => {
      let listener: any;
      let isMounted = true;
      if (!isNative && isScanning && isOpen) {
          getBarcodeScanner().then(BarcodeScanner => {
              if (!BarcodeScanner || !isMounted) return;
              BarcodeScanner.addListener('barcodesScanned', async (result: any) => {
                  if (result.barcodes && result.barcodes.length > 0 && result.barcodes[0].rawValue) {
                      const scannedValue = result.barcodes[0].rawValue;
                      await BarcodeScanner.stopScan().catch(()=>{});
                      if (isMounted) setIsScanning(false);
                      if (onScan) onScan(scannedValue);
                      onClose();
                  }
              }).then((l: any) => { if (isMounted) listener = l; });
          });
      }
      return () => {
          isMounted = false;
          if (listener) listener.remove();
      };
  }, [isNative, isScanning, isOpen, onScan, onClose]);

  useEffect(() => {
      if (!isOpen && !isNative) {
          getBarcodeScanner().then(BarcodeScanner => {
              BarcodeScanner?.stopScan?.().catch(()=>{});
          });
          setIsScanning(false);
      }
  }, [isOpen, isNative]);

  return (
    <BasePopup isOpen={isOpen} onClose={onClose} title="Barkod Okut" modalSize="md" hideFooter={true}>
      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
        
        {/* WEB IÇIN VİDEO ÖNİZLEME */}
        {!isNative && (
            <div style={{ width: '100%', maxWidth: '300px', display: isScanning ? 'block' : 'none' }}>
                <video ref={videoRef} playsInline style={{ width: '100%', borderRadius: '12px', background: '#000' }} />
            </div>
        )}

        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', margin: 0 }}>
          Kamerayı açarak barkodu okutabilirsiniz.
        </p>
        
        <button 
            onClick={handleScan}
            disabled={isScanning && !isNative}
            className="btn btn-primary"
            style={{ width: '100%', maxWidth: '300px', padding: '16px', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
            <Camera size={20} style={{ marginRight: '8px' }} />
            {isScanning && !isNative ? 'Tarayıcı Açık...' : 'Kamerayı Aç ve Okut'}
        </button>

      </div>
    </BasePopup>
  );
};

export default BarcodeScannerModal;

