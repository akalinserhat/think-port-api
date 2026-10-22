/**
 * Akalin UI - Sayfa Yükleme Göstergesi (PageLoader)
 * 
 * Başlıca Görevleri:
 * - Sayfa, rota veya modül geçişlerinde Suspense fallback ve yükleniyor durumunu animasyonlu spinner ile göstermek
 */
import React from 'react';

const PageLoader = () => {
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            width: '100%',
            flexDirection: 'column',
            gap: '16px'
        }}>
            <div style={{
                width: '40px',
                height: '40px',
                border: '3px solid var(--glass-border)',
                borderTopColor: 'var(--accent-primary)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
            }} />
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px', fontWeight: '500' }}>
                Yükleniyor...
            </div>
            
            <style>
                {`
                @keyframes spin {
                    to {
                        transform: rotate(360deg);
                    }
                }
                `}
            </style>
        </div>
    );
};

export default PageLoader;

export interface PageLoaderProps { [key: string]: any }
