/**
 * Akalin UI - Liste Seviyesi Yapay Zeka Komut ve Belge Oluşturma Modalı (BaseListAiModal)
 * 
 * Başlıca Görevleri:
 * - BaseListPage üzerinden kullanıcıya doğal dilde komut girme ve hızlı öneri seçme arayüzü sunmak
 * - Backend /api/AiAjanlar/belge-olustur endpoint'ine prompt ve belge parametrelerini iletmek
 * - Üretilen taslak form verisini (başlık ve satırlar) onSuccess callback'i ile üst bileşene teslim etmek
 * - Hata, yükleniyor durumu ve öneri etiketlerini yönetmek
 */

import React, { useState } from 'react';
import { Sparkles, Send, Bot, Lightbulb } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import BasePopup from './BasePopup';

export interface BaseListAiModalProps {
    isOpen: boolean;
    onClose: () => void;
    documentType: string;
    documentTitle?: string;
    suggestions?: string[];
    onSuccess: (data: any) => void;
}

const BaseListAiModal: React.FC<BaseListAiModalProps> = ({
    isOpen,
    onClose,
    documentType,
    documentTitle = 'Belge',
    suggestions = [],
    onSuccess
}) => {
    const [prompt, setPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const defaultSuggestions = suggestions.length > 0 ? suggestions : [
        `Son 1 ayın en çok satan ürünleri için %10 indirimli yeni bir ${documentTitle} hazırla`,
        `Tedarikçi fiyat listesindeki kalemlere %15 kar marjı ekleyerek liste oluştur`,
        `Son eklenen ürün gruplarını içeren standart bir taslak oluştur`
    ];

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!prompt.trim()) {
            toast.error('Lütfen oluşturmak istediğiniz belge için bir komut veya açıklama yazınız.');
            return;
        }

        setIsLoading(true);
        const toastId = toast.loading('Yapay zeka verileri analiz edip belge taslağını hazırlıyor...');

        try {
            const response = await axios.post('/api/AiAjanlar/belge-olustur', {
                belgeTuru: documentType,
                prompt: prompt.trim()
            });

            toast.dismiss(toastId);

            if (response.data?.basarili && response.data?.belgeVerisi) {
                toast.success('Belge taslağı başarıyla oluşturuldu.');
                onSuccess(response.data.belgeVerisi);
                setPrompt('');
                onClose();
            } else {
                toast.error(response.data?.mesaj || 'Belge oluşturulamadı.');
            }
        } catch (error: any) {
            toast.dismiss(toastId);
            const msg = error.response?.data?.mesaj || error.response?.data?.message || error.message || 'Yapay zeka işlemi sırasında bir hata oluştu.';
            toast.error(msg);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <BasePopup
            isOpen={isOpen}
            onClose={onClose}
            title={`✨ Yapay Zeka ile ${documentTitle} Oluştur`}
            modalSize="lg"
            hideFooter={true}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 24px' }}>
                {/* Bilgilendirme Bannerı */}
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '12px', 
                    padding: '12px 16px', 
                    background: 'rgba(99, 102, 241, 0.08)', 
                    borderRadius: '12px', 
                    border: '1px solid rgba(99, 102, 241, 0.2)' 
                }}>
                    <Bot size={24} color="var(--accent-primary, #6366f1)" />
                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                        Yapay zeka asistanı, ERP veritabanınızı ve fiyat geçmişinizi tarayarak yeni <strong>{documentTitle}</strong> belgesini otomatik doldurabilir.
                    </div>
                </div>

                {/* Hızlı Öneri Çipleri */}
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        <Lightbulb size={14} color="var(--warning, #f59e0b)" /> Hızlı Komut Önerileri
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {defaultSuggestions.map((sug, idx) => (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => setPrompt(sug)}
                                style={{
                                    textAlign: 'left',
                                    padding: '8px 12px',
                                    fontSize: '12px',
                                    borderRadius: '8px',
                                    background: 'var(--bg-primary, #f9fafb)',
                                    border: '1px solid var(--glass-border, #e5e7eb)',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    transition: '0.15s'
                                }}
                            >
                                💡 {sug}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Prompt Giriş Alanı */}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--text-primary)' }}>
                            Nasıl bir belge oluşturmak istiyorsunuz?
                        </label>
                        <textarea
                            className="form-input"
                            rows={4}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Örn: Beko beyaz eşya ürünlerine %10 zam ekleyerek 1 Eylül başlangıçlı yeni bir liste oluştur..."
                            disabled={isLoading}
                            style={{ resize: 'vertical' }}
                            autoFocus
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                        <button 
                            type="button" 
                            onClick={onClose} 
                            className="btn btn-secondary"
                            disabled={isLoading}
                            style={{ minWidth: '100px' }}
                        >
                            İptal
                        </button>
                        <button 
                            type="submit" 
                            className="btn btn-primary"
                            disabled={isLoading || !prompt.trim()}
                            style={{ minWidth: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                        >
                            <Sparkles size={16} />
                            {isLoading ? 'Hazırlanıyor...' : 'Oluştur ve İncele'}
                        </button>
                    </div>
                </form>
            </div>
        </BasePopup>
    );
};

export default BaseListAiModal;
