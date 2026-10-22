/**
 * Akalin UI - Uyarı ve Onay İletişim Kutusu (AlertDialog)
 * Bilgi, hata, uyarı, onay ve başarı mesajlarını standart ikonlar ve butonlarla görüntüler.
 */
import React from 'react';
import Modal from '../pages/base/Modal';
import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react';
import OkButton from '../components/button/OkButton';

export interface AlertDialogProps {
  isOpen: boolean;
  onClose: () => void;
  type?: 'info' | 'error' | 'warning' | 'confirm' | 'success';
  title?: string;
  message?: React.ReactNode;
  onConfirm?: (() => void) | (() => Promise<void>) | null;
  confirmText?: string;
  cancelText?: string;
  children?: React.ReactNode;
  showCancel?: boolean;
  extraActions?: React.ReactNode;
}

const AlertDialog = ({ 
  isOpen, 
  onClose, 
  type = 'info', 
  title, 
  message, 
  onConfirm, 
  confirmText = 'Tamam', 
  cancelText = 'İptal',
  children,
  showCancel = false,
  extraActions
}: AlertDialogProps) => {
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(typeof window !== 'undefined' ? window.innerWidth <= 768 : false);

  React.useEffect(() => {
    if (isOpen) setIsProcessing(false);
  }, [isOpen]);

  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getConfig = () => {
    switch (type) {
      case 'error':
        return { icon: <XCircle size={32} color="#ef4444" />, color: '#ef4444' };
      case 'warning':
        return { icon: <AlertTriangle size={32} color="#f59e0b" />, color: '#f59e0b' };
      case 'confirm':
        return { icon: <AlertTriangle size={32} color="#3b82f6" />, color: '#3b82f6' };
      case 'success':
        return { icon: <CheckCircle size={32} color="#10b981" />, color: '#10b981' };
      default:
        return { icon: <Info size={32} color="#3b82f6" />, color: '#3b82f6' };
    }
  };

  const { icon } = getConfig();

  const handleConfirm = async () => {
    if (isProcessing) return;
    if (onConfirm) {
      setIsProcessing(true);
      try {
        await onConfirm();
      } finally {
        setIsProcessing(false);
      }
    } else {
      onClose();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size={isMobile ? "full" : "md"} hideMaximize={true} backdropOnly={false}>
      <div className="alert-dialog-container">
        <div className="alert-dialog-content">
          <div className="alert-dialog-icon">
            {icon}
          </div>
          <div className="alert-dialog-text">
            {message && typeof message === 'string' ? (
              <p>{message}</p>
            ) : (
              <div>{message}</div>
            )}
            {children}
          </div>
        </div>
        <div className="alert-dialog-actions">
          {(type === 'confirm' || showCancel) && (
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={isProcessing}>
              {cancelText}
            </button>
          )}
          <OkButton 
            style={type === 'error' ? { backgroundColor: '#ef4444', borderColor: '#ef4444' } : {}}
            onClick={handleConfirm}
            isSaving={isProcessing}
            text={confirmText}
            loadingText="İşleniyor..."
          />
          {extraActions}
        </div>
      </div>
    </Modal>
  );
};

export default AlertDialog;
