/**
 * Akalin UI - LLM Sağlayıcısı ve Model Seçici Bileşeni (LLMSeciciInput)
 * 
 * Başlıca Sorumlulukları ve Görevleri:
 * - BaseSeciciInput temel bileşenini sarmalayarak LLM Sağlayıcılarını (OpenAI, Gemini, Claude, DeepSeek, Ollama vb.) listelemek
 * - Pasif sağlayıcıları görsel olarak belirterek (⛔ Pasif rozeti, opaklık) seçilmelerini engellemek
 * - Sağlayıcı arama/filtreleme, varsayılan model bilgisi ve API anahtarı durumunu zengin kart görünümünde sunmak
 * - Seçilen sağlayıcıyı onChange eventi ile üst forma iletmek ve sağlayıcı ayarları sayfasına hızlı erişim sağlamak
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { 
    Cpu, Sparkles, Zap, Bot, Layers, Check, Search, 
    AlertCircle, CheckCircle2, ExternalLink, RefreshCw, X, ShieldAlert
} from 'lucide-react';
import BaseSeciciInput, { BaseSeciciInputProps } from '../../base/input/BaseSeciciInput';

export interface LLMSaglayiciOption {
    id: number | string;
    ad: string;
    saglayiciTuru?: number;
    saglayiciTuruAdi?: string;
    varsayilanModel?: string;
    desteklenenModeller?: string[];
    aktifMi?: boolean;
    apiKeyTanimliMi?: boolean;
    baseUrl?: string;
    aciklama?: string;
}

export interface LLMSeciciInputProps extends Omit<BaseSeciciInputProps, 'value' | 'onChange'> {
    id?: string;
    value?: number | string | null;
    onChange?: (providerId: number | string | null, providerObj?: LLMSaglayiciOption | null) => void;
    onModelAutoSelect?: (defaultModel: string) => void;
    providers?: LLMSaglayiciOption[];
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
    showInactive?: boolean;
    onlyActive?: boolean;
    className?: string;
    style?: React.CSSProperties;
    detailsUrl?: string;
}

// ─── Sağlayıcı Türü İkon Eşleştirici ──────────────────────────────────────────
const getProviderIcon = (saglayiciTuru?: number, size = 16) => {
    switch (saglayiciTuru) {
        case 1: // OpenAI
            return <Sparkles size={size} color="#10b981" />;
        case 2: // Google Gemini
            return <Zap size={size} color="#3b82f6" />;
        case 3: // Anthropic Claude
            return <Bot size={size} color="#f59e0b" />;
        case 4: // Ollama
            return <Layers size={size} color="#8b5cf6" />;
        case 5: // DeepSeek
            return <Cpu size={size} color="#06b6d4" />;
        default:
            return <Cpu size={size} color="var(--accent-primary)" />;
    }
};

const LLMSeciciInput: React.FC<LLMSeciciInputProps> = ({
    id = 'aiSaglayiciId',
    value,
    onChange,
    onModelAutoSelect,
    providers: externalProviders,
    placeholder = 'LLM Sağlayıcısı Seçiniz...',
    disabled = false,
    error = false,
    showInactive = true,
    onlyActive = false,
    className = '',
    style = {},
    detailsUrl = '/ai-saglayicilar',
    ...restProps
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [providersList, setProvidersList] = useState<LLMSaglayiciOption[]>(externalProviders || []);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [dropdownStyles, setDropdownStyles] = useState<React.CSSProperties>({});
    
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Dışarıdan provider listesi verilmemişse API'den çek
    useEffect(() => {
        if (externalProviders && externalProviders.length > 0) {
            setProvidersList(externalProviders);
        } else {
            fetchProviders();
        }
    }, [externalProviders]);

    const fetchProviders = async () => {
        try {
            setLoading(true);
            const res = await axios.get('/api/AiSaglayicilar');
            setProvidersList(res.data || []);
        } catch (err) {
            console.error('LLM Sağlayıcıları yüklenemedi:', err);
        } finally {
            setLoading(false);
        }
    };

    // Seçili sağlayıcıyı bul
    const selectedProvider = useMemo(() => {
        if (value === undefined || value === null || value === '') return null;
        return providersList.find(p => p.id?.toString() === value?.toString()) || null;
    }, [providersList, value]);

    // Görüntülenecek metin
    const displayValue = useMemo(() => {
        if (!selectedProvider) return '';
        const turAdi = selectedProvider.saglayiciTuruAdi ? ` (${selectedProvider.saglayiciTuruAdi})` : '';
        const pasifEtiketi = selectedProvider.aktifMi === false ? ' [PASİF]' : '';
        return `${selectedProvider.ad}${turAdi}${pasifEtiketi}`;
    }, [selectedProvider]);

    // Filtrelenmiş sağlayıcılar listesi
    const filteredProviders = useMemo(() => {
        let list = [...providersList];
        if (onlyActive) {
            list = list.filter(p => p.aktifMi !== false);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            list = list.filter(p => 
                p.ad?.toLowerCase().includes(q) ||
                p.saglayiciTuruAdi?.toLowerCase().includes(q) ||
                p.varsayilanModel?.toLowerCase().includes(q) ||
                p.aciklama?.toLowerCase().includes(q)
            );
        }
        return list;
    }, [providersList, onlyActive, searchQuery]);

    // Dropdown Konumunu Hesapla
    useEffect(() => {
        if (!isOpen) return;

        const updatePosition = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                const dropdownHeight = 340;
                const spaceBelow = window.innerHeight - rect.bottom;
                const openUpward = spaceBelow < dropdownHeight && rect.top > dropdownHeight;

                setDropdownStyles({
                    position: 'fixed',
                    top: openUpward ? `${rect.top - dropdownHeight - 6}px` : `${rect.bottom + 6}px`,
                    left: `${rect.left}px`,
                    width: `${Math.max(rect.width, 360)}px`,
                    zIndex: 999999
                });
            }
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen]);

    // Dışarı tıklama kontrolü
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                containerRef.current && !containerRef.current.contains(e.target as Node) &&
                dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const handleSelect = (prov: LLMSaglayiciOption) => {
        if (prov.aktifMi === false) {
            toast.error(`'${prov.ad}' sağlayıcısı pasif durumdadır ve seçilemez.`);
            return;
        }

        if (onChange) {
            onChange(prov.id, prov);
        }

        if (onModelAutoSelect && prov.varsayilanModel) {
            onModelAutoSelect(prov.varsayilanModel);
        }

        setIsOpen(false);
        setSearchQuery('');
    };

    const handleClear = () => {
        if (onChange) {
            onChange(null, null);
        }
    };

    return (
        <div ref={containerRef} className={`relative w-full ${className}`} style={style}>
            <BaseSeciciInput
                id={id}
                value={displayValue}
                placeholder={placeholder}
                disabled={disabled}
                error={error || (selectedProvider?.aktifMi === false)}
                readOnly={true}
                icon={getProviderIcon(selectedProvider?.saglayiciTuru, 16)}
                onClick={() => {
                    if (!disabled) setIsOpen(!isOpen);
                }}
                onMenuClick={() => {
                    if (!disabled) setIsOpen(!isOpen);
                }}
                hasSelection={!!selectedProvider}
                clearable={true}
                onClear={handleClear}
                detailsUrl={detailsUrl}
                detailsUrlTitle="Model ve Sağlayıcı Ayarlarını Aç"
                alertTitle="Sağlayıcı Seçimini Temizle"
                alertMessage="Ajanın seçili LLM sağlayıcısı kaldırılacaktır."
                isMenuOpen={isOpen}
                {...restProps}
            />

            {/* ─── AÇILIR MENÜ (PORTAL) ────────────────────────────────────────── */}
            {isOpen && createPortal(
                <div 
                    ref={dropdownRef}
                    style={dropdownStyles}
                    className="glass-card shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div style={{
                        background: 'var(--bg-secondary)',
                        borderRadius: '16px',
                        border: '1px solid var(--glass-border)',
                        boxShadow: '0 16px 36px rgba(0, 0, 0, 0.25)',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        maxHeight: '340px'
                    }}>
                        {/* Arama Başlığı */}
                        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--glass-border)', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Search size={15} color="var(--text-secondary)" />
                            <input 
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Sağlayıcı veya model ara..."
                                autoFocus
                                style={{
                                    border: 'none',
                                    outline: 'none',
                                    background: 'transparent',
                                    fontSize: '13px',
                                    color: 'var(--text-primary)',
                                    width: '100%'
                                }}
                            />
                            {searchQuery && (
                                <button 
                                    type="button" 
                                    onClick={() => setSearchQuery('')}
                                    style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px' }}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {/* Sağlayıcı Listesi */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                            {loading ? (
                                <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    Sağlayıcılar yükleniyor...
                                </div>
                            ) : filteredProviders.length === 0 ? (
                                <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    Kayıtlı sağlayıcı bulunamadı.
                                </div>
                            ) : (
                                filteredProviders.map((prov) => {
                                    const isSelected = selectedProvider?.id?.toString() === prov.id?.toString();
                                    const isPassive = prov.aktifMi === false;

                                    return (
                                        <div
                                            key={prov.id}
                                            onClick={() => handleSelect(prov)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '10px 12px',
                                                borderRadius: '10px',
                                                marginBottom: '4px',
                                                cursor: isPassive ? 'not-allowed' : 'pointer',
                                                transition: 'all 0.15s ease',
                                                background: isSelected 
                                                    ? 'rgba(99, 102, 241, 0.12)' 
                                                    : isPassive 
                                                        ? 'rgba(0,0,0,0.02)' 
                                                        : 'transparent',
                                                border: isSelected ? '1px solid var(--accent-primary)' : '1px solid transparent',
                                                opacity: isPassive ? 0.6 : 1
                                            }}
                                            onMouseEnter={(e) => {
                                                if (!isSelected && !isPassive) {
                                                    e.currentTarget.style.background = 'var(--hover-bg, rgba(99, 102, 241, 0.05))';
                                                }
                                            }}
                                            onMouseLeave={(e) => {
                                                if (!isSelected && !isPassive) {
                                                    e.currentTarget.style.background = 'transparent';
                                                }
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                                                <div style={{ 
                                                    width: '32px', height: '32px', borderRadius: '8px', 
                                                    background: isPassive ? 'rgba(0,0,0,0.05)' : 'var(--bg-primary)',
                                                    border: '1px solid var(--glass-border)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    flexShrink: 0
                                                }}>
                                                    {getProviderIcon(prov.saglayiciTuru, 16)}
                                                </div>

                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <span style={{ 
                                                            fontSize: '13px', 
                                                            fontWeight: isSelected ? '700' : '600', 
                                                            color: isPassive ? 'var(--text-secondary)' : 'var(--text-primary)',
                                                            textDecoration: isPassive ? 'line-through' : 'none'
                                                        }}>
                                                            {prov.ad}
                                                        </span>
                                                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                                            ({prov.saglayiciTuruAdi || 'Özel'})
                                                        </span>
                                                    </div>

                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', fontSize: '11px' }}>
                                                        {prov.varsayilanModel && (
                                                            <code style={{ fontSize: '10px', color: 'var(--accent-primary)', background: 'rgba(99,102,241,0.08)', padding: '1px 5px', borderRadius: '4px' }}>
                                                                {prov.varsayilanModel}
                                                            </code>
                                                        )}
                                                        {prov.apiKeyTanimliMi && (
                                                            <span style={{ fontSize: '10px', color: 'var(--success)' }}>• Key Hazır</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Durum Rozetleri */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                                {isPassive ? (
                                                    <span style={{ 
                                                        fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '6px',
                                                        background: 'rgba(239, 68, 68, 0.12)', color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.2)'
                                                    }}>
                                                        ⛔ Pasif
                                                    </span>
                                                ) : isSelected ? (
                                                    <div style={{ 
                                                        width: '20px', height: '20px', borderRadius: '50%', background: 'var(--accent-primary)',
                                                        color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                    }}>
                                                        <Check size={12} />
                                                    </div>
                                                ) : (
                                                    <span style={{ 
                                                        fontSize: '10px', fontWeight: '600', padding: '2px 7px', borderRadius: '6px',
                                                        background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)'
                                                    }}>
                                                        Aktif
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* Alt Bilgi / Sağlayıcı Yönetimi Linki */}
                        <div style={{ 
                            padding: '10px 14px', borderTop: '1px solid var(--glass-border)', 
                            background: 'var(--bg-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            fontSize: '11px'
                        }}>
                            <span style={{ color: 'var(--text-secondary)' }}>
                                {filteredProviders.filter(p => p.aktifMi !== false).length} Aktif Sağlayıcı
                            </span>
                            <a 
                                href={detailsUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                Sağlayıcıları Yönet <ExternalLink size={12} />
                            </a>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default LLMSeciciInput;
