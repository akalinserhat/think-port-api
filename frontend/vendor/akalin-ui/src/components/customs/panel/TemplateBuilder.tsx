/**
 * Akalin UI - Otomatik Numara ve Kod Şablon Oluşturucu Paneli (TemplateBuilder.tsx)
 * 
 * Başlıca Görevleri:
 * - Belge, cari, ürün ve kart numaralandırma şablonlarını sürükle-bırak bloklar ve etiketlerle görsel olarak tasarlamak
 * - Değişken etiketleri ([Yıl], [Ay], [Sayaç], [Harf Serisi] vb.) ve sabit metin/ayraçları yönetmek
 * - Etiket chip'lerine tıklanabilir ayarlar (Metin Harf Dönüşümü / Text Casing) seçeneği sunmak
 * - Sayaç uzunluğu, harf serisi ve anlık canlı önizleme (Live Preview) sunmak
 */

import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, LayoutTemplate, GripVertical, FileText, SlidersHorizontal, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { applyCasing, HarfDonusumu } from '../../base/input/BaseInput';

export interface TemplateTagGroup {
    title: string;
    tags: string[];
}

export interface TemplateBlock {
    id: string;
    text: string;
    isTag: boolean;
}

export interface TemplateBuilderProps {
    id?: string;
    title?: string;
    value?: string;
    onChange?: (value: string) => void;
    availableTags?: TemplateTagGroup[];
    showCounterSettings?: boolean;
    counterLength?: number;
    onCounterLengthChange?: (length: number) => void;
    showSeriesInput?: boolean;
    seriesValue?: string;
    onSeriesChange?: (series: string) => void;
    seriesInputLabel?: string;
    seriesInputPlaceholder?: string;
    disabled?: boolean;
}

export interface CasingOption {
    id: HarfDonusumu;
    titleKey: string;
    defaultTitle: string;
    example: string;
    badgeKey?: string;
    defaultBadge?: string;
}

export const TEMPLATE_CASING_OPTIONS: CasingOption[] = [
    {
        id: 'girildigiGibi',
        titleKey: 'harf_donusumu_serbest_baslik',
        defaultTitle: 'Serbest (Dönüşüm Yok)',
        example: 'örnek metin'
    },
    {
        id: 'hepsiBuyuk',
        titleKey: 'harf_donusumu_buyuk_baslik',
        defaultTitle: 'Tümü Büyük Harf',
        example: 'ÖRNEK METİN',
        badgeKey: 'auto_badge_buyuk',
        defaultBadge: 'BÜYÜK'
    },
    {
        id: 'basHarflerBuyuk',
        titleKey: 'harf_donusumu_basharfler_baslik',
        defaultTitle: 'İlk Harfleri Büyük',
        example: 'Örnek Metin',
        badgeKey: 'auto_badge_basharfler',
        defaultBadge: 'Baş Harfler'
    },
    {
        id: 'hepsiKucuk',
        titleKey: 'harf_donusumu_kucuk_baslik',
        defaultTitle: 'Tümü Küçük Harf',
        example: 'örnek metin',
        badgeKey: 'auto_badge_kucuk',
        defaultBadge: 'küçük'
    }
];

/**
 * [Etiket:casing] formatındaki etiket string'ini ayrıştırır.
 */
export const parseTagContent = (tagWithBrackets: string): { tagName: string; casing?: HarfDonusumu } => {
    if (!tagWithBrackets.startsWith('[') || !tagWithBrackets.endsWith(']')) {
        return { tagName: tagWithBrackets };
    }
    const inner = tagWithBrackets.slice(1, -1);
    const colonIdx = inner.indexOf(':');
    if (colonIdx === -1) {
        return { tagName: inner };
    }
    const tagName = inner.slice(0, colonIdx);
    const casing = inner.slice(colonIdx + 1) as HarfDonusumu;
    return { tagName, casing };
};

/**
 * Belirtilen etiket adı ve casing moduna göre etiket metni üretir.
 */
export const buildTagText = (tagName: string, casing?: HarfDonusumu): string => {
    if (!casing || casing === 'girildigiGibi' || casing === 'serbest' || casing === 'none') {
        return `[${tagName}]`;
    }
    return `[${tagName}:${casing}]`;
};

/**
 * Bir şablon içindeki etiketleri ([Etiket] veya [Etiket:casing]) verilen değer ve harf dönüşüm kuralına göre değiştirir.
 */
export const replaceTemplateTag = (
    template: string,
    tagName: string,
    value: string
): string => {
    if (!template || !tagName) return template;
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\[${escapedTag}(?::([^\\]]+))?\\]`, 'g');
    return template.replace(regex, (_, modifier) => {
        return modifier ? applyCasing(value, modifier as HarfDonusumu) : value;
    });
};

const TemplateBuilder: React.FC<TemplateBuilderProps> = ({
    id = 'templateBuilder',
    title = 'Şablon (Sürükle & Bırak)',
    value = '',
    onChange,
    availableTags = [],
    showCounterSettings = false,
    counterLength,
    onCounterLengthChange,
    showSeriesInput = false,
    seriesValue,
    onSeriesChange,
    seriesInputLabel = 'Harf Serisi Değeri (Seri No)',
    seriesInputPlaceholder = 'Örn: GIB, A, B...',
    disabled = false
}) => {
    const { t } = useTranslation();
    const [templateBlocks, setTemplateBlocks] = useState<TemplateBlock[]>([]);
    const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
    const [customText, setCustomText] = useState('');
    const [activeSettingsIdx, setActiveSettingsIdx] = useState<number | null>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    const parseTemplate = (templateStr: string): TemplateBlock[] => {
        if (!templateStr) return [];
        const parts = templateStr.split(/(\[[^\]]+\])/g).filter(Boolean);
        return parts.map((part, index) => ({
            id: `chip-${Date.now()}-${index}-${Math.random()}`,
            text: part,
            isTag: part.startsWith('[') && part.endsWith(']')
        }));
    };

    // Sadece ilk yüklemede veya value dışarıdan köklü değiştiğinde parse et.
    useEffect(() => {
        const currentBlocksVal = templateBlocks.map(b => b.text).join('');
        if (value !== currentBlocksVal) {
            setTemplateBlocks(parseTemplate(value));
        }
    }, [value]);

    // Popover dışına tıklandığında veya Escape tuşuna basıldığında ayarlar menüsünü kapat
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                setActiveSettingsIdx(null);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setActiveSettingsIdx(null);
            }
        };
        if (activeSettingsIdx !== null) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeSettingsIdx]);

    const updateParent = (blocks: TemplateBlock[]) => {
        const finalTemplate = blocks.map(b => b.text).join('');
        if (onChange) {
            onChange(finalTemplate);
        }
    };

    // --- Drag & Drop Handlers ---
    const handleDragStart = (e: React.DragEvent, index: number) => {
        if (disabled) {
            e.preventDefault();
            return;
        }
        setActiveSettingsIdx(null);
        setDraggedIdx(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
    };

    const handleDragEnd = () => {
        setDraggedIdx(null);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, dropIdx: number) => {
        e.preventDefault();
        if (disabled || draggedIdx === null || draggedIdx === dropIdx) return;
        
        const newBlocks = [...templateBlocks];
        const draggedBlock = newBlocks[draggedIdx];
        
        newBlocks.splice(draggedIdx, 1);
        newBlocks.splice(dropIdx, 0, draggedBlock);
        
        setTemplateBlocks(newBlocks);
        setDraggedIdx(null);
        updateParent(newBlocks);
    };

    const addBlock = (text: string) => {
        if (disabled || !text) return;
        const isTag = text.startsWith('[') && text.endsWith(']');
        const newBlocks = [...templateBlocks, { id: `chip-${Date.now()}-${Math.random()}`, text, isTag }];
        setTemplateBlocks(newBlocks);
        updateParent(newBlocks);
    };

    const handleAddCustomText = (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (!customText.trim()) return;
        addBlock(customText);
        setCustomText('');
    };

    const removeBlock = (index: number) => {
        if (disabled) return;
        if (activeSettingsIdx === index) {
            setActiveSettingsIdx(null);
        }
        const newBlocks = [...templateBlocks];
        newBlocks.splice(index, 1);
        setTemplateBlocks(newBlocks);
        updateParent(newBlocks);
    };

    const handleSelectCasing = (blockIdx: number, tagName: string, casingMode: HarfDonusumu) => {
        const newBlocks = [...templateBlocks];
        const newText = buildTagText(tagName, casingMode);
        newBlocks[blockIdx] = {
            ...newBlocks[blockIdx],
            text: newText
        };
        setTemplateBlocks(newBlocks);
        updateParent(newBlocks);
        setActiveSettingsIdx(null);
    };

    const generatePreview = () => {
        let previewStr = '';
        templateBlocks.forEach(block => {
            if (block.isTag) {
                const { tagName, casing } = parseTagContent(block.text);
                let sampleVal = '';
                if (tagName === 'Harf Serisi') {
                    sampleVal = seriesValue || 'GIB';
                } else if (tagName === 'Yıl') {
                    sampleVal = '2024';
                } else if (tagName === 'Ay') {
                    sampleVal = '06';
                } else if (tagName === 'Gün') {
                    sampleVal = '14';
                } else if (tagName === 'Sayaç') {
                    sampleVal = String(1).padStart(counterLength || 4, '0');
                } else if (tagName === 'Marka') {
                    sampleVal = 'Nike';
                } else if (tagName === 'Marka Kısa Kod') {
                    sampleVal = 'NK';
                } else if (tagName === 'Ürün Grubu Tekil') {
                    sampleVal = 'spor ayakkabı';
                } else if (tagName === 'Ürün Grubu') {
                    sampleVal = 'Spor Ayakkabılar';
                } else if (tagName === 'Ürün Grubu Kısa Kod') {
                    sampleVal = 'SP-AYK';
                } else if (tagName === 'Ürün Türü Kısa Kod') {
                    sampleVal = 'ÜR';
                } else if (tagName === 'Üretici Kodu') {
                    sampleVal = 'art-102';
                } else if (tagName === 'Cari Türü Kısa Kodu') {
                    sampleVal = 'AL';
                } else if (tagName === 'Kart Türü Kısa Kodu') {
                    sampleVal = 'GL';
                } else if (/^Özellik \d+$/.test(tagName)) {
                    sampleVal = 'Kırmızı';
                } else {
                    sampleVal = tagName;
                }

                previewStr += casing ? applyCasing(sampleVal, casing) : sampleVal;
            } else {
                previewStr += block.text;
            }
        });
        return previewStr || t('onizleme_bulunmuyor', 'Önizleme bulunmuyor...');
    };

    const hasHarfSerisi = showSeriesInput && templateBlocks.some(b => {
        if (!b.isTag) return false;
        const { tagName } = parseTagContent(b.text);
        return tagName === 'Harf Serisi';
    });

    return (
        <div id={id} className="template-builder-container">
            <div className="template-builder-card">
                <label className="template-builder-title">
                    <LayoutTemplate size={18} /> {title}
                </label>
                
                {/* Drop Zone */}
                <div className="template-drop-zone">
                    {templateBlocks.length === 0 && (
                        <div className="template-drop-empty">
                            {t('Aşağıdaki etiketleri veya metinleri buraya ekleyerek numaratörünüzü oluşturun.')}
                        </div>
                    )}

                    {templateBlocks.map((block, idx) => {
                        const { tagName, casing } = parseTagContent(block.text);
                        const casingOpt = TEMPLATE_CASING_OPTIONS.find(c => c.id === casing);
                        const isTagWithCasing = block.isTag && casing && casing !== 'girildigiGibi';

                        return (
                            <div
                                key={block.id}
                                draggable={!disabled}
                                onDragStart={(e) => handleDragStart(e, idx)}
                                onDragEnd={handleDragEnd}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, idx)}
                                className={`template-chip-item ${block.isTag ? 'is-tag' : 'is-text'} ${disabled ? 'disabled' : ''} ${draggedIdx === idx ? 'is-dragging' : ''}`}
                            >
                                <GripVertical size={14} className="template-chip-drag-handle" />
                                
                                {block.isTag ? (
                                    <span className="template-chip-text">{tagName}</span>
                                ) : (
                                    <span className="template-chip-text">{block.text}</span>
                                )}

                                {isTagWithCasing && casingOpt?.badgeKey && (
                                    <span className="template-chip-casing-badge">
                                        {t(casingOpt.badgeKey, casingOpt.defaultBadge)}
                                    </span>
                                )}

                                {!disabled && block.isTag && (
                                    <button
                                        type="button"
                                        className={`template-chip-btn settings ${activeSettingsIdx === idx ? 'active' : ''}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveSettingsIdx(activeSettingsIdx === idx ? null : idx);
                                        }}
                                        title={t('auto_etiket_ayarlari', 'Etiket Ayarları')}
                                    >
                                        <SlidersHorizontal size={11} strokeWidth={2.2} />
                                    </button>
                                )}

                                {!disabled && (
                                    <button
                                        type="button"
                                        className="template-chip-btn remove"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeBlock(idx);
                                        }}
                                        title={t('Kaldır')}
                                    >
                                        <X size={11} strokeWidth={2.5} />
                                    </button>
                                )}

                                {/* Chip Settings Popover */}
                                {activeSettingsIdx === idx && (
                                    <div
                                        ref={popoverRef}
                                        className="template-chip-popover"
                                        onClick={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()}
                                    >
                                        <div className="template-chip-popover-header">
                                            <div className="template-chip-popover-title">
                                                <SlidersHorizontal size={14} className="template-chip-popover-icon" />
                                                <span>{t('auto_etiket_ayarlari', 'Etiket Ayarları')}: <strong>[{tagName}]</strong></span>
                                            </div>
                                            <button
                                                type="button"
                                                className="template-chip-popover-close"
                                                onClick={() => setActiveSettingsIdx(null)}
                                                title={t('Kapat', 'Kapat')}
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>

                                        <div className="template-chip-popover-section">
                                            <div className="template-chip-popover-subtitle">
                                                {t('auto_metin_harf_donusumu', 'Metin Harf Dönüşümü')}
                                            </div>
                                            <div className="template-chip-popover-hint">
                                                {t('auto_etiket_donusum_aciklama', 'Bu etiket şablonda yer aldığında metnin nasıl biçimlendirileceğini seçin.')}
                                            </div>

                                            <div className="template-chip-casing-list">
                                                {TEMPLATE_CASING_OPTIONS.map((opt) => {
                                                    const isSelected = (!casing && opt.id === 'girildigiGibi') || casing === opt.id;
                                                    return (
                                                        <div
                                                            key={opt.id}
                                                            className={`template-chip-casing-item ${isSelected ? 'active' : ''}`}
                                                            onClick={() => handleSelectCasing(idx, tagName, opt.id)}
                                                        >
                                                            <div className="template-chip-casing-item-left">
                                                                <div className="template-chip-casing-item-title">
                                                                    {t(opt.titleKey, opt.defaultTitle)}
                                                                </div>
                                                                <div className="template-chip-casing-item-example">
                                                                    <span className="template-chip-casing-example-label">{t('auto_ornek_3d9d', 'Örnek:')}</span>
                                                                    <span className="template-chip-casing-example-val">{opt.example}</span>
                                                                </div>
                                                            </div>
                                                            {isSelected && (
                                                                <div className="template-chip-casing-check">
                                                                    <Check size={14} strokeWidth={2.5} />
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Available Tags and Custom Text Panel */}
                {!disabled && (
                    <div className="template-builder-panel">
                        <div className="template-builder-panel-row">
                            {/* Etiketler Bölümü */}
                            <div className="template-builder-tags-section">
                                <h4 className="template-builder-section-title">
                                    {t('auto_degiskenler_tiklayar_66e6', 'DEĞİŞKENLER (TIKLAYARAK EKLEYİN)')}
                                </h4>
                                <div className="template-builder-group-list">
                                    {availableTags.map((group, gIdx) => (
                                        <div key={gIdx} className="template-builder-group-row">
                                            <span className="template-builder-group-label">{group.title}:</span>
                                            {group.tags.map(tag => {
                                                const { tagName } = parseTagContent(tag);
                                                return (
                                                    <button 
                                                        key={tag} 
                                                        type="button"
                                                        onClick={() => addBlock(tag)}
                                                        className="template-builder-tag-btn"
                                                    >
                                                        <Plus size={12} className="template-builder-tag-btn-icon" />
                                                        {tagName}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Sabit Metin Bölümü */}
                            <div className="template-builder-custom-section">
                                <h4 className="template-builder-section-title">
                                    {t('auto_sabit_metin_ayrac_ek_4b4d', 'SABİT METİN / AYRAÇ EKLE')}
                                </h4>
                                <div className="flex-row gap-8">
                                    <input
                                        type="text"
                                        value={customText}
                                        onChange={(e) => setCustomText(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAddCustomText(e)}
                                        placeholder="Örn: - veya /"
                                        className="template-builder-custom-input"
                                    />
                                    <button 
                                        type="button"
                                        onClick={handleAddCustomText}
                                        disabled={!customText.trim()}
                                        className="template-builder-custom-btn"
                                    >
                                        {t('Ekle', 'Ekle')}
                                    </button>
                                </div>
                                <p className="template-builder-custom-hint">
                                    {t('auto_aralara_tire_bosluk__2d53', 'Aralara tire, boşluk veya özel karakter ekleyebilirsiniz.')}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {(showCounterSettings || hasHarfSerisi) && (
                    <div className="template-builder-settings-row">
                        {/* Sayaç Uzunluğu */}
                        {showCounterSettings && (
                            <div className="template-builder-settings-group">
                                <label className="template-builder-settings-label">
                                    {t('auto_sayac_uzunlugu_hane_8a36', 'SAYAÇ UZUNLUĞU (HANE SAYISI)')}
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    max="10"
                                    value={counterLength || 4}
                                    onChange={(e) => onCounterLengthChange && onCounterLengthChange(parseInt(e.target.value) || 4)}
                                    className="form-control template-builder-counter-input"
                                    disabled={disabled}
                                />
                            </div>
                        )}

                        {/* Harf Serisi Inputu */}
                        {hasHarfSerisi && (
                            <div className="template-builder-settings-group">
                                <label className="template-builder-settings-label highlight">
                                    {seriesInputLabel}
                                </label>
                                <input
                                    type="text"
                                    value={seriesValue || ''}
                                    onChange={(e) => onSeriesChange && onSeriesChange(e.target.value.toUpperCase())}
                                    placeholder={seriesInputPlaceholder}
                                    maxLength={5}
                                    disabled={disabled}
                                    className="form-control template-builder-series-input"
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Real-Time Preview Banner */}
                <div className="template-builder-preview-banner">
                    <div className="template-builder-preview-icon">
                        <FileText size={20} />
                    </div>
                    <div>
                        <div className="template-builder-preview-label">
                            {t('auto_canli_onizleme_e23f', 'CANLI ÖNİZLEME')}
                        </div>
                        <div className="template-builder-preview-text">
                            {generatePreview()}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TemplateBuilder;
