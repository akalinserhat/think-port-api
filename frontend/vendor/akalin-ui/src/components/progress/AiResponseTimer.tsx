/**
 * Akalin UI - Yapay Zeka Yanıt Süresi ve İlerleme Sayacı (AiResponseTimer).
 * Kullanıcı yapay zekaya prompt gönderdikten sonra geçen süreyi (kronometre sayacı)
 * canlı olarak gösteren, yanıt geciktiğinde aktif model ve sağlayıcı bilgilerini de
 * sunarak kullanıcıyı bilgilendiren ve sonlandırma aksiyonu sağlayan ilerleme bileşenidir.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Square, Timer, Cpu, Sparkles, Bot } from 'lucide-react';

export interface AiResponseTimerProps {
    /** Başlangıçtan itibaren geçen işlem süresi (saniye) */
    elapsedSeconds: number;
    /** Yanıt üretimini durdurma / iptal fonksiyonu */
    onStop?: () => void;
    /** Aktif uzman ajan adı (Örn: "Kampanya Uzmanı", "Stok Uzmanı") */
    agentName?: string;
    /** Aktif yapay zeka sağlayıcısı (Örn: "Ollama (Yerel LLM)", "Google Gemini") */
    providerName?: string;
    /** Aktif model adı (Örn: "llama3.3", "qwen2.5:14b", "gemini-2.5-flash") */
    modelName?: string;
    /** Süre göstergesinin yanında yer alacak özel durum metni */
    statusText?: string;
    /** Belirli bir eşiği aşınca uzun bekleme uyarı kartı gösterilsin mi? (Varsayılan: true) */
    showLongWaitingWarning?: boolean;
    /** Uzun bekleme uyarısının devreye gireceği saniye eşiği (Varsayılan: 10) */
    longWaitingThreshold?: number;
    /** İnce nabız/zaman ilerleme çubuğu gösterilsin mi? (Varsayılan: true) */
    showProgressBar?: boolean;
    /** Ekstra CSS sınıfı */
    className?: string;
}

const AiResponseTimer: React.FC<AiResponseTimerProps> = ({
    elapsedSeconds = 0,
    onStop,
    agentName,
    providerName,
    modelName,
    statusText,
    showLongWaitingWarning = true,
    longWaitingThreshold = 10,
    showProgressBar = true,
    className = ''
}) => {
    const { t } = useTranslation();

    const isLongWaiting = showLongWaitingWarning && elapsedSeconds >= longWaitingThreshold;

    // Modelin yerel (Ollama vb.) olup olmadığını tespit et
    const isLocalModel = 
        (providerName || '').toLowerCase().includes('ollama') ||
        (providerName || '').toLowerCase().includes('yerel') ||
        (providerName || '').toLowerCase().includes('local');

    // Süreyi dakika:saniye formatına dönüştür (örn: 1dk 12s veya 14s)
    const formatDuration = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const remSecs = seconds % 60;
        return `${mins}m ${remSecs}s`;
    };

    return (
        <div className={`ai-response-timer-wrapper ${className}`}>
            {/* 1. Kompakt Süre ve Durum Göstergesi (Inline Durdur düğmesi olmadan, sade görünüm) */}
            <div className="ai-response-timer-bar">
                <div className="ai-response-timer-badge">
                    <Clock size={13} className="ai-response-timer-icon pulse" />
                    <span className="ai-response-timer-text">
                        {statusText || t('Geçen Süre')}:
                    </span>
                    <strong className="ai-response-timer-seconds">
                        {formatDuration(elapsedSeconds)}
                    </strong>
                </div>
            </div>

            {/* 2. Hareketli Zaman İlerleme Çizgisi */}
            {showProgressBar && (
                <div className="ai-response-timer-progress-track">
                    <div className="ai-response-timer-progress-fill" />
                </div>
            )}

            {/* 3. Uzun Süre Uyarısı & Model Bilgilendirme Kartı */}
            {isLongWaiting && (
                <div className="ai-long-waiting-card">
                    <div className="ai-long-waiting-header">
                        <Timer size={15} className="ai-long-waiting-icon pulse" />
                        <strong className="ai-long-waiting-title">
                            {t('Yapay zekanın yanıt vermesi beklenenden uzun sürüyor')} ({elapsedSeconds}s)
                        </strong>
                    </div>

                    {/* Model ve Sağlayıcı Bilgisi Rozeti */}
                    <div className="ai-model-info-banner">
                        {isLocalModel ? (
                            <Cpu size={14} className="ai-model-info-icon local" />
                        ) : (
                            <Sparkles size={14} className="ai-model-info-icon cloud" />
                        )}
                        <div className="ai-model-info-content">
                            <span className="ai-model-info-agent">
                                {agentName || t('Genel ERP Asistanı')}
                            </span>
                            <span className="ai-model-info-divider">•</span>
                            <span className="ai-model-info-provider">
                                {providerName || (isLocalModel ? t('Ollama (Yerel LLM)') : t('Bulut Yapay Zeka'))}
                            </span>
                            {modelName && (
                                <code className="ai-model-info-code">
                                    {modelName}
                                </code>
                            )}
                        </div>
                    </div>

                    {/* Modele / Sağlayıcıya Özel Dinamik Açıklama */}
                    <p className="ai-long-waiting-desc">
                        {isLocalModel
                            ? t('Yerel model (Ollama), model ağırlıklarını bilgisayarınızın RAM/VRAM belleğine yüklerken veya derin analiz yaparken yanıt üretimi biraz zaman alabilir. Dilerseniz bekleyebilir veya işlemi durdurabilirsiniz.')
                            : t('Bulut yapay zeka servisi geniş veri bağlamını işlediği için yanıt üretimi devam ediyor. Dilerseniz bekleyebilir veya işlemi durdurabilirsiniz.')}
                    </p>

                    {onStop && (
                        <div className="ai-long-waiting-actions">
                            <button
                                type="button"
                                className="ai-btn-long-waiting-stop"
                                onClick={onStop}
                                title={t('Yanıtı Durdur')}
                            >
                                <Square size={12} fill="currentColor" />
                                <span>{t('Yanıtı Durdur')}</span>
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AiResponseTimer;
