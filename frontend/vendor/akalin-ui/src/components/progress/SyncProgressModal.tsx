/**
 * Akalin UI - Senkronizasyon İlerleme Modalı (SyncProgressModal)
 * SignalR üzerinden arka planda yürütülen veri senkronizasyonu (örneğin TCMB Banka/Şube senkronizasyonu)
 * işlemlerinin anlık ilerleme durumunu, mesajlarını ve işlem sonucundaki rapor istatistiklerini
 * kullanıcıya sunan modal bileşenidir.
 */

import React, { useState, useEffect } from 'react';
import { X, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

export interface SyncReport {
    bankaEklenen?: number;
    bankaGuncellenen?: number;
    bankaSilinen?: number;
    subeEklenen?: number;
    subeGuncellenen?: number;
    subeSilinen?: number;
    [key: string]: any;
}

export interface SyncProgressData {
    progress: number;
    message: string;
    isError?: boolean;
    report?: SyncReport;
}

export interface SyncProgressModalProps {
    isOpen: boolean;
    onClose: () => void;
    hubUrl?: string;
    eventName?: string;
    title?: string;
    description?: string;
}

export const SyncProgressModal: React.FC<SyncProgressModalProps> = ({
    isOpen,
    onClose,
    hubUrl = '/syncHub',
    eventName = 'ReceiveProgress',
    title = 'Banka ve Şubeler Senkronize Ediliyor',
    description = 'Lütfen bu pencereyi kapatmayın. Binlerce şube kaydı inceleniyor...'
}) => {
    const [progress, setProgress] = useState<number>(0);
    const [message, setMessage] = useState<string>('Başlatılıyor...');
    const [isError, setIsError] = useState<boolean>(false);
    const [isFinished, setIsFinished] = useState<boolean>(false);
    const [connection, setConnection] = useState<any | null>(null);
    const [report, setReport] = useState<SyncReport | null>(null);

    useEffect(() => {
        let isMounted = true;
        let activeConn: any = null;

        if (isOpen) {
            setProgress(0);
            setMessage('Başlatılıyor...');
            setIsError(false);
            setIsFinished(false);
            setReport(null);

            (async () => {
                try {
                    const signalR = await import(/* @vite-ignore */ '@microsoft/signalr');
                    if (!isMounted) return;

                    const newConnection = new signalR.HubConnectionBuilder()
                        .withUrl(hubUrl)
                        .withAutomaticReconnect()
                        .build();

                    newConnection.on(eventName, (data: SyncProgressData) => {
                        if (data.progress !== undefined) {
                            setProgress(data.progress);
                        }
                        if (data.message) {
                            setMessage(data.message);
                        }
                        if (data.isError) {
                            setIsError(true);
                            setIsFinished(true);
                        }
                        if (data.report) {
                            setReport(data.report);
                        }
                        if (data.progress === 100) {
                            setIsFinished(true);
                        }
                    });

                    await newConnection.start();
                    if (isMounted) {
                        activeConn = newConnection;
                        setConnection(newConnection);
                    } else {
                        newConnection.stop();
                    }
                } catch (err) {
                    console.error('SignalR Bağlantı Hatası:', err);
                    if (isMounted) {
                        setMessage('Sunucuyla gerçek zamanlı bağlantı kurulamadı. İşlem arka planda devam ediyor olabilir.');
                    }
                }
            })();
        }

        return () => {
            isMounted = false;
            if (activeConn) {
                activeConn.stop();
            } else if (connection) {
                connection.stop();
            }
            setConnection(null);
        };
    }, [isOpen, hubUrl, eventName]);

    if (!isOpen) return null;

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', padding: '32px', borderRadius: '16px', width: '500px', maxWidth: '90%', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)', position: 'relative' }}>
                {isFinished && (
                    <button
                        onClick={onClose}
                        style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                        aria-label="Kapat"
                    >
                        <X size={24} />
                    </button>
                )}

                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                    {isFinished ? (
                        isError ? (
                            <AlertCircle size={48} color="var(--danger)" style={{ margin: '0 auto 16px' }} />
                        ) : (
                            <CheckCircle size={48} color="var(--success)" style={{ margin: '0 auto 16px' }} />
                        )
                    ) : (
                        <RefreshCw size={48} color="var(--accent-primary)" style={{ margin: '0 auto 16px', animation: 'spin 2s linear infinite' }} />
                    )}
                    <h2 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>
                        {isFinished ? (isError ? 'İşlem Başarısız' : 'Senkronizasyon Tamamlandı') : title}
                    </h2>
                    <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                        {description}
                    </p>
                </div>

                <div style={{ width: '100%', height: '8px', background: 'var(--border-light)', borderRadius: '4px', overflow: 'hidden', marginBottom: '16px' }}>
                    <div
                        style={{
                            height: '100%',
                            width: `${progress}%`,
                            background: isError ? 'var(--danger)' : (progress === 100 ? 'var(--success)' : 'var(--accent-primary)'),
                            transition: 'width 0.3s ease, background 0.3s ease'
                        }}
                    />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: '500' }}>{message}</span>
                    <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: '600' }}>%{progress}</span>
                </div>

                {isFinished && report && (
                    <div style={{ marginTop: '24px', background: 'var(--bg-body)', padding: '16px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                        <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '12px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '8px' }}>
                            Güncelleme Raporu
                        </h3>

                        {report.bankaEklenen === 0 && report.bankaGuncellenen === 0 && report.bankaSilinen === 0 && report.subeEklenen === 0 && report.subeGuncellenen === 0 ? (
                            <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-secondary)', fontSize: '14px', fontStyle: 'italic' }}>
                                Kayıtlarda herhangi bir değişiklik yapılmadı. Sistemdeki veriler güncel.
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '13px' }}>
                                <div>
                                    <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>Bankalar</div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Eklenen:</span> <span style={{ fontWeight: '500', color: 'var(--success)' }}>{report.bankaEklenen ?? 0}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Güncellenen:</span> <span style={{ fontWeight: '500', color: 'var(--warning)' }}>{report.bankaGuncellenen ?? 0}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Silinen:</span> <span style={{ fontWeight: '500', color: 'var(--danger)' }}>{report.bankaSilinen ?? 0}</span></div>
                                </div>
                                <div>
                                    <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>Şubeler</div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Eklenen:</span> <span style={{ fontWeight: '500', color: 'var(--success)' }}>{report.subeEklenen ?? 0}</span></div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Güncellenen:</span> <span style={{ fontWeight: '500', color: 'var(--warning)' }}>{report.subeGuncellenen ?? 0}</span></div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {isFinished && (
                    <button
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: '24px', padding: '12px' }}
                        onClick={onClose}
                    >
                        Pencereyi Kapat
                    </button>
                )}

                <style>{`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        </div>
    );
};

export default SyncProgressModal;
