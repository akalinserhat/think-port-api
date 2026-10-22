/**
 * Akalin UI - Yapay Zeka Düşünce ve Teknik Analiz Detayları Bileşeni (AiThinkingDetails).
 * Büyük veri analizleri, derin model çıkarımları veya arka planda üretilen teknik JSON
 * yapılarını kullanıcıyı boğmadan, isteğe bağlı açılıp kapanabilen (collapsible)
 * şık ve modern bir akordiyon panelinde sunar.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronDown, ChevronUp, Code, Sparkles } from 'lucide-react';

export interface AiThinkingDetailsProps {
    /** Gösterilecek düşünce metni veya teknik JSON verisi */
    content: string;
    /** Başlık (Varsayılan: "Teknik Analiz ve Çıkarım Detayları") */
    title?: string;
    /** Varsayılan olarak açık gelsin mi? (Varsayılan: false) */
    defaultExpanded?: boolean;
    /** Ekstra CSS sınıfı */
    className?: string;
}

const AiThinkingDetails: React.FC<AiThinkingDetailsProps> = ({
    content,
    title,
    defaultExpanded = false,
    className = ''
}) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);

    if (!content || !content.trim()) return null;

    const displayTitle = title || t('Teknik Analiz ve Çıkarım Detayları');

    return (
        <div className={`ai-thinking-details-card ${isExpanded ? 'expanded' : ''} ${className}`}>
            <button
                type="button"
                className="ai-thinking-details-header"
                onClick={() => setIsExpanded(prev => !prev)}
                title={isExpanded ? t('Detayları Gizle') : t('Detayları Göster')}
            >
                <div className="ai-thinking-header-left">
                    <Brain size={14} className="ai-thinking-icon pulse" />
                    <span className="ai-thinking-title">{displayTitle}</span>
                </div>
                <div className="ai-thinking-header-right">
                    <span className="ai-thinking-toggle-text">
                        {isExpanded ? t('Gizle') : t('Detayları Göster')}
                    </span>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
            </button>

            {isExpanded && (
                <div className="ai-thinking-details-body">
                    <pre className="ai-thinking-code-block">
                        <code>{content}</code>
                    </pre>
                </div>
            )}
        </div>
    );
};

export default AiThinkingDetails;
