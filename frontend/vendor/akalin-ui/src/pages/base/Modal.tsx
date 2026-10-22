/**
 * Akalin UI - Düşük Seviye Temel Modal Pencere Motoru (Modal)
 * 
 * Başlıca Görevleri:
 * - DOM createPortal ile pencereyi document.body üzerine monte etmek
 * - Mobil donanım geri tuşunu (hardware back button) popstate ile dinlemek ve yönetmek
 * - Esc ile kapatma, Shift+Enter ile tam ekran büyütme/küçültme kısayollarını sunmak
 * - useFormAutoFocus ile modal açıldığında formun ilk inputuna otomatik odaklanmak
 * - Gövde kaydırmasını (body scroll lock) kilitlemek ve duyarlı mobil/masaüstü başlık düzeni sağlamak
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import BackButton from '../../components/button/BackButton';
import { autoFocusFirstInput } from '../../utils/domUtils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  children?: React.ReactNode;
  backdropOnly?: boolean;
  hideMaximize?: boolean;
  [key: string]: any;
}

const Modal: React.FC<ModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  size, 
  children, 
  backdropOnly, 
  hideMaximize 
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Modal her açıldığında form içerisindeki ilk input'a odaklan
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => autoFocusFirstInput(containerRef.current), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
      if (e.key === 'Enter' && e.shiftKey && isOpen && !hideMaximize) {
        if ((e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          setIsFullscreen(prev => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, hideMaximize]);

  const onCloseRef = React.useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const stateIdRef = React.useRef<string | null>(null);

  // Handle hardware back button
  useEffect(() => {
    if (isOpen) {
      let isMounted = true;
      const stateId = Date.now().toString() + Math.random().toString(36).substring(7);
      
      const timer = setTimeout(() => {
        if (isMounted) {
          stateIdRef.current = stateId;
          const originalState = window.history.state;
          window.history.pushState({ ...originalState, modalStateId: stateId }, '');
        }
      }, 50);

      const handlePopState = (e: PopStateEvent) => {
        if (e.state?.modalStateId !== stateId) {
          stateIdRef.current = null;
          onCloseRef.current();
        }
      };

      window.addEventListener('popstate', handlePopState);

      return () => {
        isMounted = false;
        clearTimeout(timer);
        window.removeEventListener('popstate', handlePopState);
      };
    } else {
      if (stateIdRef.current) {
        if (window.history.state?.modalStateId === stateIdRef.current) {
          window.history.back();
        }
        stateIdRef.current = null;
      }
    }
  }, [isOpen]);

  // Reset fullscreen when modal closes or opens
  useEffect(() => {
    if (!isOpen) {
      setIsFullscreen(false);
    }
  }, [isOpen]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getMaxWidth = () => {
    if (isFullscreen) return '100vw';
    if (size === 'full') return '100vw';
    if (size === 'xl') return '1100px';
    if (size === 'lg') return '900px';
    if (size === 'md') return '750px';
    return '600px';
  };
  const getHeight = () => {
    if (isFullscreen) return '100dvh';
    if (size === 'full') return '100dvh';
    if (size === 'xl' || size === 'lg') return 'calc(100vh - 60px)';
    if (size === 'md') return 'auto';
    return 'auto';
  };

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsFullscreen(!isFullscreen);
  };

  return createPortal(
    <div ref={containerRef} className="modal-wrapper" style={{ 
      position: 'fixed', top: 0, left: 'var(--modal-left-offset, 0px)', right: 0, bottom: 0, 
      background: 'rgba(0,0,0,0.5)', zIndex: 2100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: isFullscreen ? '0' : '20px',
      animation: 'fadeIn 0.2s',
      transition: 'padding 0.3s ease'
    }}>
      {backdropOnly ? (
        <div className="modal-backdrop-only" style={{ 
          width: '100%', 
          maxWidth: getMaxWidth(), 
          height: getHeight(), 
          maxHeight: isFullscreen || size === 'full' ? '100dvh' : '90vh', 
          position: 'relative', 
          display: 'flex', 
          flexDirection: 'column',
          transition: 'all 0.3s ease',
          borderRadius: isFullscreen || size === 'full' ? '0' : undefined
        }}>
          <div className="desktop-modal-actions" style={{ position: 'absolute', top: '24px', right: '24px', zIndex: 100, display: 'flex', gap: '8px' }}>
            {!hideMaximize && (
              <button type="button" onClick={toggleFullscreen} className="btn-icon" style={{ background: 'var(--bg-secondary)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} title="Tam Ekran (Shift+Enter)">
                {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-icon" style={{ background: 'var(--bg-secondary)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} title="Kapat (Esc)">
              <X size={20} />
            </button>
          </div>
          
          <div className="mobile-modal-header">
             <BackButton onClick={onClose} size={24} style={{ margin: '-8px 8px -8px -8px' }} />
             <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>{title}</h3>
          </div>
          
          {children}
        </div>
      ) : (
        <div className="surface-card" style={{ 
          width: '100%', 
          maxWidth: getMaxWidth(), 
          height: getHeight(),
          background: 'var(--bg-secondary)', 
          padding: 0, 
          display: 'flex', 
          flexDirection: 'column', 
          maxHeight: isFullscreen || size === 'full' ? '100dvh' : '90vh',
          transition: 'all 0.3s ease',
          borderRadius: isFullscreen || size === 'full' ? '0' : undefined
        }}>
          <div className="desktop-modal-header" style={{ padding: '24px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, flex: 1, display: 'flex', alignItems: 'center' }}>{title}</h2>
            <div className="desktop-modal-actions flex-row gap-8" >
              {!hideMaximize && (
                <button type="button" onClick={toggleFullscreen} className="btn-icon" title="Tam Ekran (Shift+Enter)">
                  {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
              )}
              <button type="button" onClick={onClose} className="btn-icon" title="Kapat (Esc)">
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="mobile-modal-header">
             <BackButton onClick={onClose} size={24} style={{ margin: '-8px 8px -8px -8px' }} />
             <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', flex: 1, display: 'flex', alignItems: 'center' }}>{title}</h3>
          </div>
          
          <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {children}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default Modal;
