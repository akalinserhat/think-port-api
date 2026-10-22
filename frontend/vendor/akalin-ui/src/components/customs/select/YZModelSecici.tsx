/**
 * Akalin UI - Yapay Zeka (AI) Model Seçici Bileşeni (YZModelSecici)
 * 
 * Başlıca Sorumlulukları ve Görevleri:
 * - OpenAI, Gemini, Claude, Ollama, DeepSeek sağlayıcılarının modellerini zengin havuzdan listelemek
 * - Hem Çoklu Model Seçimi (Sağlayıcı Formu) hem de Tekil Model Seçimi (Ajan Formu / singleSelect) desteği sunmak
 * - "Yenile" aksiyonu ile sağlayıcının canlı API'sinden güncel modelleri çekmek:
 *   * Sağlayıcının artık kullanmadığı/kaldırdığı modelleri temizler
 *   * Yeni modelleri ekler
 *   * Halen geçerli olan mevcut modelleri olduğu gibi korur
 * - BaseSeciciInput altyapısı ile salt-okunur gösterim, temizleme ve klavye navigasyonu sağlamak
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { 
    Check, Search, Sparkles, RefreshCw, X, Plus, 
    Layers, Cpu, CheckSquare, Square, Star, Trash2
} from 'lucide-react';
import BaseSeciciInput from '../../base/input/BaseSeciciInput';

export interface YZModelOption {
    id: string;
    label?: string;
    badge?: string;
    kategori?: string;
}

export interface YZModelSeciciProps {
    id?: string;
    value?: string | string[];
    onChange?: (selectedModels: any) => void;
    saglayiciTuru?: number; // 1: OpenAI, 2: Google Gemini, 3: Anthropic, 4: Ollama, 5: DeepSeek, 99: Ozel
    baseUrl?: string;
    apiKey?: string;
    providerId?: number | string;
    options?: (string | YZModelOption)[];
    disabled?: boolean;
    placeholder?: string;
    error?: boolean;
    className?: string;
    style?: React.CSSProperties;
    varsayilanModel?: string;
    onDefaultModelChange?: (model: string) => void;
    showLiveFetchButton?: boolean;
    singleSelect?: boolean;
}

// Sağlayıcı türlerine göre önceden tanımlanmış varsayılan model havuzu
const DEFAULT_PROVIDER_MODELS: Record<number, YZModelOption[]> = {
    // OpenAI
    1: [
        { id: 'gpt-4o', label: 'GPT-4o', badge: 'Amiral Gemisi / Multimodal' },
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini', badge: 'Hızlı & Ekonomik' },
        { id: 'gpt-4.5-preview', label: 'GPT-4.5 Preview', badge: 'Büyük Model' },
        { id: 'o1', label: 'o1', badge: 'Gelişmiş Akıl Yürütme' },
        { id: 'o1-mini', label: 'o1 Mini', badge: 'Hızlı Akıl Yürütme' },
        { id: 'o3-mini', label: 'o3 Mini', badge: 'Yeni Nesil Muhakeme' },
        { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', badge: 'Yüksek Performans' },
        { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', badge: 'Klasik Hızlı Model' }
    ],
    // Google Gemini
    2: [
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', badge: 'Ultra Hızlı & Multimodal' },
        { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', badge: 'Hafif & Ekonomik' },
        { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', badge: '2M Token Geniş Bağlam' },
        { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', badge: 'Düşük Gecikme' },
        { id: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B', badge: 'Mikro Multimodal' },
        { id: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro', badge: 'Standart Metin' }
    ],
    // Anthropic Claude
    3: [
        { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet', badge: 'Hibrit Akıl Yürütme' },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', badge: 'Üstün Kod & Analiz' },
        { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', badge: 'Hızlı Model' },
        { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus', badge: 'Derin Muhakeme' }
    ],
    // Ollama (Yerel)
    4: [
        { id: 'llama3.3:latest', label: 'Llama 3.3 (70B)', badge: 'En Güçlü Açık Model' },
        { id: 'llama3.2:latest', label: 'Llama 3.2 (3B/1B)', badge: 'Ultra Hafif Yerel' },
        { id: 'llama3.1:latest', label: 'Llama 3.1 (8B)', badge: 'Çok Dilli Yerel' },
        { id: 'deepseek-r1:latest', label: 'DeepSeek R1 (Yerel)', badge: 'Akıl Yürütme' },
        { id: 'qwen2.5:latest', label: 'Qwen 2.5 (7B)', badge: 'Alibaba Güçlü Model' },
        { id: 'mistral:latest', label: 'Mistral 7B', badge: 'Klasik Hızlı Yerel' }
    ],
    // DeepSeek
    5: [
        { id: 'deepseek-chat', label: 'DeepSeek-V3 (Chat)', badge: 'Genel Sohbet & Kod' },
        { id: 'deepseek-reasoner', label: 'DeepSeek-R1 (Reasoner)', badge: 'Düşünce Zinciri (CoT)' }
    ]
};

const YZModelSecici: React.FC<YZModelSeciciProps> = ({
    id = 'yz-model-secici',
    value,
    onChange,
    saglayiciTuru = 1,
    baseUrl = '',
    apiKey = '',
    providerId,
    options,
    disabled = false,
    placeholder = 'Desteklenecek modelleri seçiniz...',
    error = false,
    className = '',
    style = {},
    varsayilanModel = '',
    onDefaultModelChange,
    showLiveFetchButton = true,
    singleSelect = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [fetchingModels, setFetchingModels] = useState(false);
    const [dynamicModels, setDynamicModels] = useState<YZModelOption[]>([]);
    const [dropdownStyles, setDropdownStyles] = useState<React.CSSProperties>({});
    
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Değeri diziye normalize et
    const normalizedValue = useMemo<string[]>(() => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        return [value];
    }, [value]);

    // Dışarı tıklama kontrolü
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const isOutsideContainer = containerRef.current && !containerRef.current.contains(event.target as Node);
            const isOutsideDropdown = dropdownRef.current && !dropdownRef.current.contains(event.target as Node);
            if (isOutsideContainer && isOutsideDropdown) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Dropdown açıldığında arama inputuna odaklan ve konumu hesapla
    useEffect(() => {
        if (isOpen) {
            updateDropdownPosition();
            setTimeout(() => {
                if (searchInputRef.current) {
                    searchInputRef.current.focus();
                }
            }, 50);
        } else {
            setSearchQuery('');
        }
    }, [isOpen]);

    const updateDropdownPosition = () => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const estimatedHeight = 360;
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldOpenUp = spaceBelow < estimatedHeight && rect.top > estimatedHeight;

        setDropdownStyles({
            position: 'fixed',
            top: shouldOpenUp ? `${rect.top - estimatedHeight - 6}px` : `${rect.bottom + 6}px`,
            left: `${rect.left}px`,
            width: `${Math.max(rect.width, 380)}px`,
            maxHeight: `${estimatedHeight}px`,
            zIndex: 999999
        });
    };

    useEffect(() => {
        if (isOpen) {
            window.addEventListener('scroll', updateDropdownPosition, true);
            window.addEventListener('resize', updateDropdownPosition);
            return () => {
                window.removeEventListener('scroll', updateDropdownPosition, true);
                window.removeEventListener('resize', updateDropdownPosition);
            };
        }
    }, [isOpen]);

    // Model havuzunu birleştir
    const allAvailableModels = useMemo<YZModelOption[]>(() => {
        const list: YZModelOption[] = [];
        const seenIds = new Set<string>();

        const addOption = (item: string | YZModelOption) => {
            const opt: YZModelOption = typeof item === 'string' ? { id: item, label: item } : item;
            if (!opt.id || seenIds.has(opt.id)) return;
            seenIds.add(opt.id);
            list.push(opt);
        };

        // 1. Canlı API'den güncel modeller çekildiyse öncelik ver
        if (dynamicModels.length > 0) {
            dynamicModels.forEach(addOption);
        } else if (options && options.length > 0) {
            // Dışarıdan options verilmişse
            options.forEach(addOption);
        } else {
            // Sağlayıcı türünün varsayılan katalogları
            const defaults = DEFAULT_PROVIDER_MODELS[saglayiciTuru] || [];
            defaults.forEach(addOption);
        }

        // 2. Halen seçili olan modelleri de havuza ekle
        normalizedValue.forEach(val => {
            if (val && !seenIds.has(val)) {
                addOption({ id: val, label: val, badge: 'Seçili' });
            }
        });

        return list;
    }, [saglayiciTuru, options, dynamicModels, normalizedValue]);

    // Arama filtrelemesi
    const filteredPool = useMemo(() => {
        if (!searchQuery.trim()) return allAvailableModels;
        const q = searchQuery.toLocaleLowerCase('tr-TR');
        return allAvailableModels.filter(m => 
            m.id.toLocaleLowerCase('tr-TR').includes(q) || 
            (m.label && m.label.toLocaleLowerCase('tr-TR').includes(q)) ||
            (m.badge && m.badge.toLocaleLowerCase('tr-TR').includes(q))
        );
    }, [allAvailableModels, searchQuery]);

    // Seçili modeller listesi
    const selectedModelItems = useMemo(() => {
        return normalizedValue.map(val => {
            const found = allAvailableModels.find(m => m.id === val);
            return found || { id: val, label: val };
        });
    }, [normalizedValue, allAvailableModels]);

    // Model seçimi (Toggle veya Single Select)
    const handleToggleModel = (modelId: string) => {
        if (singleSelect) {
            if (onChange) onChange(modelId);
            if (onDefaultModelChange) onDefaultModelChange(modelId);
            setIsOpen(false);
            setSearchQuery('');
            return;
        }

        const currentVals = normalizedValue;
        let newVals: string[];
        if (currentVals.includes(modelId)) {
            newVals = currentVals.filter(id => id !== modelId);
            if (varsayilanModel === modelId && onDefaultModelChange) {
                onDefaultModelChange(newVals[0] || '');
            }
        } else {
            newVals = [...currentVals, modelId];
            if (!varsayilanModel && onDefaultModelChange) {
                onDefaultModelChange(modelId);
            }
        }

        if (onChange) {
            onChange(newVals);
        }
    };

    // Tümünü seç / Temizle
    const handleSelectAllFiltered = () => {
        if (singleSelect) return;
        const currentVals = new Set(normalizedValue);
        filteredPool.forEach(m => currentVals.add(m.id));
        const newVals = Array.from(currentVals);
        if (onChange) onChange(newVals);
        if (!varsayilanModel && newVals.length > 0 && onDefaultModelChange) {
            onDefaultModelChange(newVals[0]);
        }
    };

    const handleClearAll = () => {
        if (singleSelect) {
            if (onChange) onChange('');
            if (onDefaultModelChange) onDefaultModelChange('');
        } else {
            if (onChange) onChange([]);
            if (onDefaultModelChange) onDefaultModelChange('');
        }
    };

    // Listede olmayan özel model adını havuza ekle ve seç
    const handleAddCustomModel = (customName: string) => {
        const clean = customName.trim();
        if (!clean) return;
        const exists = allAvailableModels.some(m => m.id === clean);
        if (!exists) {
            setDynamicModels(prev => [...prev, { id: clean, label: clean, badge: 'Özel Eklenen' }]);
        }
        
        if (singleSelect) {
            if (onChange) onChange(clean);
            if (onDefaultModelChange) onDefaultModelChange(clean);
            setIsOpen(false);
            setSearchQuery('');
            toast.success(`"${clean}" modeli seçildi.`);
            return;
        }

        if (!normalizedValue.includes(clean)) {
            handleToggleModel(clean);
        }
        setSearchQuery('');
        toast.success(`"${clean}" modeli havuza eklendi ve seçildi.`);
    };

    // API'den Canlı Modelleri Yenile ve Senkronize Et
    const handleFetchLiveModels = async () => {
        setFetchingModels(true);
        try {
            let res;
            if (providerId) {
                // Kayıtlı sağlayıcı için doğrudan DB senkronizasyonlu endpoint çağrılır
                res = await axios.post(`/api/AiSaglayicilar/${providerId}/fetch-models`, {
                    saglayiciTuru,
                    baseUrl,
                    apiKey,
                    model: varsayilanModel
                });
            } else if (apiKey?.trim() || saglayiciTuru === 4) {
                res = await axios.post('/api/AiSaglayicilar/fetch-models', {
                    saglayiciTuru,
                    baseUrl,
                    apiKey,
                    model: varsayilanModel
                });
            } else {
                toast.error('Lütfen önce sağlayıcıyı veya API Anahtarını giriniz.');
                setFetchingModels(false);
                return;
            }

            const fetched: string[] = res.data || [];
            if (fetched.length === 0) {
                toast.error('API üzerinden güncel model listesi alınamadı. API anahtarını kontrol ediniz.');
            } else {
                const newOpts: YZModelOption[] = fetched.map(m => ({
                    id: m,
                    label: m,
                    badge: 'Güncel API'
                }));
                setDynamicModels(newOpts);
                
                if (singleSelect) {
                    // Tekil Model Seçiminde: Mevcut model hala geçerliyse koru, değilse ilk modele geç
                    const current = normalizedValue[0];
                    if (current && fetched.includes(current)) {
                        // Mevcut model geçerli, korundu
                    } else {
                        const newFirst = fetched[0] || '';
                        if (onChange) onChange(newFirst);
                        if (onDefaultModelChange) onDefaultModelChange(newFirst);
                    }
                } else {
                    // Çoklu Desteklenen Modeller Havuzunda (AiSaglayiciForm):
                    // 1. Var olan seçili modellerden API'de hala mevcut olanları koru (Kullanımdan kalkanlar ayıklanır)
                    const stillValid = normalizedValue.filter(m => fetched.includes(m));
                    
                    // 2. Yeni gelen modeller havuza (dynamicModels / MODEL HAVUZU) eklenir, kullanıcı onaylamadan otomatik seçilmez
                    const updatedSelection = stillValid.length > 0 ? stillValid : (normalizedValue.length === 0 ? [] : (fetched.length > 0 ? [fetched[0]] : []));
                    
                    if (onChange) {
                        onChange(updatedSelection);
                    }
                    
                    // Varsayılan modelin kontrolü
                    if (varsayilanModel && !fetched.includes(varsayilanModel) && onDefaultModelChange) {
                        onDefaultModelChange(updatedSelection[0] || fetched[0] || '');
                    } else if (!varsayilanModel && updatedSelection.length > 0 && onDefaultModelChange) {
                        onDefaultModelChange(updatedSelection[0]);
                    }
                }

                toast.success(`Modeller yenilendi: ${fetched.length} model havuza alındı.`);
            }
        } catch (err) {
            toast.error('Modeller API üzerinden yenilenirken hata oluştu.');
        } finally {
            setFetchingModels(false);
        }
    };

    // BaseSeciciInput için özet metin oluştur
    const displaySummary = useMemo(() => {
        if (singleSelect) {
            const current = normalizedValue[0];
            if (!current) return '';
            const found = allAvailableModels.find(m => m.id === current);
            return found ? (found.label && found.label !== found.id ? `${found.id} (${found.label})` : found.id) : current;
        }

        const count = normalizedValue.length;
        if (count === 0) return '';
        if (count === 1) return `${normalizedValue[0]} (1 model seçili)`;
        const firstTwo = normalizedValue.slice(0, 2).join(', ');
        return `${count} model seçili (${firstTwo}${count > 2 ? '...' : ''})`;
    }, [singleSelect, normalizedValue, allAvailableModels]);

    const isSearchExactMatch = useMemo(() => {
        const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
        return allAvailableModels.some(m => m.id.toLocaleLowerCase('tr-TR') === q);
    }, [allAvailableModels, searchQuery]);

    return (
        <div ref={containerRef} className={`yz-model-secici-container relative w-full ${className}`} style={style}>
            <BaseSeciciInput
                id={id}
                value={displaySummary}
                onChange={() => {}}
                onClick={() => {
                    if (!disabled) setIsOpen(!isOpen);
                }}
                onMenuClick={() => {
                    if (!disabled) setIsOpen(!isOpen);
                }}
                hasSelection={normalizedValue.length > 0}
                onClear={handleClearAll}
                disabled={disabled}
                readOnly={true}
                placeholder={placeholder}
                error={error}
                icon={<Cpu size={16} />}
                isMenuOpen={isOpen}
                clearable={true}
                alertTitle="Model Seçimini Temizle"
                alertMessage={singleSelect ? "Seçili model kaldırılacaktır. Emin misiniz?" : "Seçili tüm desteklenen modeller havuzdan kaldırılacaktır. Emin misiniz?"}
            />

            {/* Portal Dropdown Menü */}
            {isOpen && !disabled && createPortal(
                <div
                    ref={dropdownRef}
                    className="yz-model-secici-dropdown fade-in-fast"
                    style={dropdownStyles}
                    onMouseDown={e => e.stopPropagation()}
                >
                    {/* Header: Arama, Canlı Yenileme & Hızlı Aksiyonlar */}
                    <div className="yz-secici-header">
                        <div className="yz-secici-search-wrapper">
                            <Search size={15} className="yz-secici-search-icon" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                className="yz-secici-search-input"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Model ara veya ekle (örn: gpt-4o, gemini-2.0, claude-3-7)..."
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && searchQuery.trim()) {
                                        e.preventDefault();
                                        if (!isSearchExactMatch) {
                                            handleAddCustomModel(searchQuery);
                                        }
                                    }
                                }}
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="yz-secici-search-clear"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        <div className="yz-secici-toolbar">
                            {showLiveFetchButton && (
                                <button
                                    type="button"
                                    onClick={handleFetchLiveModels}
                                    disabled={fetchingModels}
                                    className="yz-secici-live-btn"
                                    title="API'den güncel modelleri yenile"
                                >
                                    <RefreshCw size={13} className={fetchingModels ? 'animate-spin' : ''} />
                                    <span>{fetchingModels ? 'Yenileniyor...' : 'Yenile'}</span>
                                </button>
                            )}
                            <div className="yz-secici-quick-actions">
                                {!singleSelect && (
                                    <>
                                        <button 
                                            type="button" 
                                            onClick={handleSelectAllFiltered}
                                            className="yz-secici-link-btn"
                                        >
                                            Tümünü Seç
                                        </button>
                                        <span>•</span>
                                    </>
                                )}
                                <button 
                                    type="button" 
                                    onClick={handleClearAll}
                                    className="yz-secici-link-btn danger"
                                >
                                    Temizle
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Menü Gövdesi (Scroll Edilebilir Alan) */}
                    <div className="yz-secici-body">
                        
                        {/* ───────────────────────────────────────────────────────────── */}
                        {/* 1. SEÇİLEN MODELLER BÖLÜMÜ                                   */}
                        {/* ───────────────────────────────────────────────────────────── */}
                        {selectedModelItems.length > 0 && (
                            <div className="yz-secici-section selected-section">
                                <div className="yz-secici-section-header">
                                    <span className="yz-secici-section-title">
                                        <CheckSquare size={13} className="text-accent" />
                                        {singleSelect ? 'SEÇİLİ MODEL' : `SEÇİLEN MODELLER (${selectedModelItems.length})`}
                                    </span>
                                    <span className="yz-secici-section-subtitle">
                                        {singleSelect ? 'Modeli değiştirmek için havuzdan tıklayın' : 'Seçimi kaldırmak için X\'e tıklayın'}
                                    </span>
                                </div>

                                <div className="yz-secici-items-list">
                                    {selectedModelItems.map(item => {
                                        const isDefault = varsayilanModel === item.id;
                                        return (
                                            <div
                                                key={`sel-${item.id}`}
                                                className={`yz-model-item selected ${isDefault ? 'is-default' : ''}`}
                                                onClick={() => handleToggleModel(item.id)}
                                            >
                                                {/* Sol Taraf: Check Kutusu */}
                                                <button
                                                    type="button"
                                                    className="yz-check-box checked"
                                                    title="Seçili"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleToggleModel(item.id);
                                                    }}
                                                >
                                                    <Check size={12} />
                                                </button>

                                                {/* Model Adı ve Rozet */}
                                                <div className="yz-model-info">
                                                    <span className="yz-model-id">{item.id}</span>
                                                    {item.label && item.label !== item.id && (
                                                        <span className="yz-model-label">({item.label})</span>
                                                    )}
                                                </div>

                                                {/* Sağ Aksiyonlar */}
                                                <div className="yz-model-actions" onClick={e => e.stopPropagation()}>
                                                    {!singleSelect && onDefaultModelChange && (
                                                        <button
                                                            type="button"
                                                            onClick={() => onDefaultModelChange(item.id)}
                                                            className={`yz-default-btn ${isDefault ? 'active' : ''}`}
                                                            title={isDefault ? "Varsayılan Model" : "Varsayılan Model Yap"}
                                                        >
                                                            <Star size={13} fill={isDefault ? "currentColor" : "none"} />
                                                            <span>{isDefault ? 'Varsayılan' : 'Varsayılan Yap'}</span>
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleModel(item.id)}
                                                        className="yz-remove-btn"
                                                        title="Modeli seçimden çıkar"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ───────────────────────────────────────────────────────────── */}
                        {/* 2. TÜM KULLANILABİLİR MODELLER HAVUZU (SEÇİLEBİLİR LİSTE)      */}
                        {/* ───────────────────────────────────────────────────────────── */}
                        <div className="yz-secici-section pool-section">
                            <div className="yz-secici-section-header">
                                <span className="yz-secici-section-title">
                                    <Layers size={13} />
                                    MODEL HAVUZU ({filteredPool.length})
                                </span>
                                <span className="yz-secici-section-subtitle">
                                    {singleSelect ? 'Seçmek için modele tıklayın' : 'Havuza eklemek için sol onay kutusuna tıklayın'}
                                </span>
                            </div>

                            {/* Özel Model Ekleme Butonu (Arama eşleşmediyse) */}
                            {searchQuery.trim() && !isSearchExactMatch && (
                                <div 
                                    className="yz-custom-add-item"
                                    onClick={() => handleAddCustomModel(searchQuery)}
                                >
                                    <Plus size={15} />
                                    <span>
                                        <strong>"{searchQuery.trim()}"</strong> modelini havuza ekle ve seç
                                    </span>
                                </div>
                            )}

                            {filteredPool.length === 0 ? (
                                <div className="yz-secici-empty-pool">
                                    Aranan kriterlere uygun model bulunamadı.
                                </div>
                            ) : (
                                <div className="yz-secici-items-list">
                                    {filteredPool.map(item => {
                                        const isSelected = normalizedValue.includes(item.id);
                                        const isDefault = varsayilanModel === item.id;
                                        return (
                                            <div
                                                key={`pool-${item.id}`}
                                                className={`yz-model-item ${isSelected ? 'selected' : ''}`}
                                                onClick={() => handleToggleModel(item.id)}
                                            >
                                                {/* Sol Taraf: Tıklanabilir Onay / Check İkonu */}
                                                <button
                                                    type="button"
                                                    className={`yz-check-box ${isSelected ? 'checked' : ''}`}
                                                    title={isSelected ? "Seçildi" : "Seç"}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleToggleModel(item.id);
                                                    }}
                                                >
                                                    {isSelected && <Check size={12} />}
                                                </button>

                                                {/* Model Adı ve Rozet */}
                                                <div className="yz-model-info">
                                                    <span className="yz-model-id">{item.id}</span>
                                                    {item.badge && (
                                                        <span className="yz-model-badge">{item.badge}</span>
                                                    )}
                                                </div>

                                                {/* Sağ Taraf */}
                                                <div className="yz-model-actions" onClick={e => e.stopPropagation()}>
                                                    {!singleSelect && isSelected && onDefaultModelChange && (
                                                        <button
                                                            type="button"
                                                            onClick={() => onDefaultModelChange(item.id)}
                                                            className={`yz-default-btn ${isDefault ? 'active' : ''}`}
                                                            title={isDefault ? "Varsayılan Model" : "Varsayılan Model Yap"}
                                                        >
                                                            <Star size={13} fill={isDefault ? "currentColor" : "none"} />
                                                            <span>{isDefault ? 'Varsayılan' : 'Varsayılan Yap'}</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default YZModelSecici;
