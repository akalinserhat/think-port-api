/**
 * Akalin UI - Yapay Zeka Yanıt ve Yazma Göstergesi Bileşeni (AiTypingIndicator).
 * Yapay zekanın (LLM / Yerel Modeller) yanıt üretimi esnasında hareketli dalgalanma (typing indicator)
 * animasyonunu ve asistan avatarını sunan standart ilerleme/bekleme bileşenidir.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

export interface AiTypingIndicatorProps {
    /** Sol taraftaki asistan avatarı gösterilsin mi? (Varsayılan: true) */
    showAvatar?: boolean;
    /** Özel durum / yazıyor metni */
    statusText?: string;
    /** Ekstra CSS sınıfı */
    className?: string;
    /** Ekstra alt elemanlar */
    children?: React.ReactNode;
}

const AiTypingIndicator: React.FC<AiTypingIndicatorProps> = ({
    showAvatar = true,
    statusText,
    className = '',
    children
}) => {
    const { t } = useTranslation();

    return (
        <div className={`ai-message-row ai-message-row-assistant ${className}`}>
            {showAvatar && (
                <div className="ai-avatar-assistant pulse" title={t('Yapay Zeka Çalışıyor')}>
                    <Sparkles size={16} />
                </div>
            )}

            <div className="ai-sending-container">
                <div className="ai-message-bubble ai-bubble-assistant ai-bubble-typing">
                    <div className="ai-typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>

                    {statusText && (
                        <span className="ai-typing-status-text">
                            {statusText}
                        </span>
                    )}

                    {children}
                </div>
            </div>
        </div>
    );
};

export default AiTypingIndicator;
