/**
 * Akalin UI - Global Hata Yakalama Bileşeni (ErrorBoundary.tsx)
 * React bileşen ağacındaki beklenmedik render hatalarını yakalar,
 * uygulamanın tamamen çökmesini engeller ve kullanıcıya modern bir hata arayüzü sunar.
 */
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Bir render hatası yakalandı:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            minHeight: '60vh', 
            width: '100%',
            padding: '24px',
            textAlign: 'center'
        }}>
          <div style={{
              background: 'var(--bg-card)',
              padding: '40px',
              borderRadius: '16px',
              border: '1px solid var(--danger-light)',
              maxWidth: '600px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '24px'
          }}>
            <div style={{ 
                width: '64px', height: '64px', 
                borderRadius: '50%', background: 'var(--danger-light)', 
                color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' 
            }}>
                <AlertTriangle size={32} />
            </div>
            
            <div className="flex-col gap-8">
                <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                    Eyvah! Bir Hata Meydana Geldi
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '15px', margin: 0, lineHeight: '1.5' }}>
                    Bu ekranda beklenmeyen bir sorun oluştu ve işlem devam edemedi.
                    Sorun devam ederse lütfen sistem yöneticiniz ile iletişime geçin.
                </p>
            </div>

            {this.state.error && (
                <div style={{ 
                    background: 'var(--bg-main)', padding: '16px', borderRadius: '8px', 
                    width: '100%', overflowX: 'auto', textAlign: 'left', fontSize: '12px',
                    border: '1px solid var(--glass-border)', color: 'var(--danger)'
                }}>
                    <pre style={{ margin: 0 }}>{this.state.error.toString()}</pre>
                </div>
            )}

            <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                <button 
                    onClick={() => window.location.reload()}
                    className="btn-cancel"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: '500' }}
                >
                    <RefreshCcw size={18} />
                    Sayfayı Yenile
                </button>
                <button 
                    onClick={() => window.location.href = '/'}
                    className="btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', border: 'none', background: 'var(--accent-primary)', color: 'white', fontWeight: '500' }}
                >
                    <Home size={18} />
                    Ana Sayfaya Dön
                </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children; 
  }
}

export default ErrorBoundary;
