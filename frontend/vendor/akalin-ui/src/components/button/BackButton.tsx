/**
 * Akalin UI - BackButton (Geri Butonu)
 * Proje genelindeki standart "Geri" ikonu butonu.
 * Router içinde veya dışında güvenle çalışır, hata fırlatmaz.
 */

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface BackButtonProps {
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    to?: string | number;
    title?: string;
    className?: string;
    style?: React.CSSProperties;
    size?: number;
}

/**
 * Proje genelindeki standart "Geri" ikonu butonu.
 * 
 * @param to - Belirtilmişse `navigate(to)` ile yönlendirme yapar. Belirtilmemişse ve `onClick` de yoksa `navigate(-1)` (bir önceki sayfaya) çalışır.
 * @param onClick - Eğer verilmişse varsayılan yönlendirmeyi iptal eder ve sadece bu fonksiyonu çağırır.
 * @param className - Varsayılan: "btn-icon"
 */
const BackButton: React.FC<BackButtonProps> = ({ 
    onClick, 
    to, 
    title = "Geri Dön", 
    className = "btn-icon btn-back", 
    style,
    size = 20
}) => {
    let navigate: any = null;
    try {
        // Router konteksti dışındaysa useNavigate hata vermemesi için güvenli çağrım
        navigate = useNavigate();
    } catch {
        navigate = null;
    }

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (onClick) {
            onClick(e);
            return;
        }
        
        if (to !== undefined && to !== null && navigate) {
            navigate(to as any);
        } else if (navigate) {
            navigate(-1);
        } else if (typeof window !== 'undefined' && window.history) {
            window.history.back();
        }
    };

    return (
        <button 
            type="button"
            onClick={handleClick} 
            className={className}
            style={{ 
                padding: '8px', 
                border: 'none', 
                background: 'transparent', 
                cursor: 'pointer', 
                display: 'inline-flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                ...style
            }}
            title={title}
        >
            <ArrowLeft size={size} />
        </button>
    );
};

export default BackButton;
