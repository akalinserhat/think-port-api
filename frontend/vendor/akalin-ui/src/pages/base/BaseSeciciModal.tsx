/**
 * @file BaseSeciciModal.tsx
 * @description BasePopup temel sınıfını kullanan, arama, klavye ile gezinme ve tekli/çoklu seçim özelliklerine sahip jenerik seçim modalı.
 */

// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Search, CheckSquare, Square } from 'lucide-react';
import BasePopup from './BasePopup';
import DataTable from '../../components/grid/DataTable';
import { useInternalTableNavigation } from '../../utils/tableUtils';
import AramaInput from '../../components/input/AramaInput';

export interface BaseSeciciModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (selected: any, extra?: any) => void;
    title?: string;
    initialSearchText?: string;
    fetchEndpoint?: string;
    searchParamName?: string;
    columns: any[];
    mobileCardRender?: (item: any) => React.ReactNode;
    searchPlaceholder?: string;
    emptyMessage?: string;
    customFetchData?: (params: { page: number; pageSize: number; aramaMetni: string }) => Promise<{ data: any[]; totalCount?: number }>;
    isMultiSelect?: boolean;
    confirmButtonText?: string;
    hideMaximize?: boolean;
    customFooterLeft?: React.ReactNode;
}

const BaseSeciciModal: React.FC<BaseSeciciModalProps> = ({
    isOpen,
    onClose,
    onSelect,
    title = "Seçim Yapın",
    initialSearchText = '',
    fetchEndpoint = '', // string (e.g. '/api/Cari')
    searchParamName = 'aramaKelimesi', // string (e.g. 'arama', 'aramaKelimesi')
    columns,
    mobileCardRender,
    searchPlaceholder = 'Ara...',
    emptyMessage = 'Arama kriterlerine uygun kayıt bulunamadı.',
    customFetchData = null, // optional function if completely custom fetch is needed
    isMultiSelect = false,
    confirmButtonText = 'Tamam',
    hideMaximize = true,
    customFooterLeft = null
}) => {
    const [items, setItems] = useState([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [aramaMetni, setAramaMetni] = useState(initialSearchText);
    const [isFocused, setIsFocused] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());

    useEffect(() => {
        if (isOpen) {
            setAramaMetni(initialSearchText);
            setSelectedIds(new Set());
            setRefreshKey(prev => prev + 1);
        }
    }, [isOpen, initialSearchText]);

    const handleFetchData = useCallback(async ({ page, pageSize }) => {
        if (customFetchData) {
            return customFetchData({ page, pageSize, aramaMetni });
        }

        if (!fetchEndpoint) {
            console.error("fetchEndpoint or customFetchData must be provided to BaseSeciciModal");
            return { data: [] };
        }

        const params = new URLSearchParams();
        params.append('sayfa', page);
        params.append('sayfaBoyutu', pageSize);
        if (aramaMetni) {
            params.append(searchParamName, aramaMetni);
        }
        
        try {
            const res = await axios.get(`${fetchEndpoint}?${params.toString()}`);
            // Desteklenen formatlar: res.data.veriler veya res.data
            return { data: res.data?.veriler || res.data || [] };
        } catch (error) {
            console.error(`${title} listesi alınamadı`, error);
            return { data: [] };
        }
    }, [aramaMetni, fetchEndpoint, searchParamName, customFetchData, title]);

    useEffect(() => {
        // Trigger fetch whenever search text changes with a debounce
        const handler = setTimeout(() => {
            setRefreshKey(prev => prev + 1);
        }, 300);
        return () => clearTimeout(handler);
    }, [aramaMetni]);

    const toggleSelection = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const handleSelectAll = (e) => {
        e.stopPropagation();
        if (selectedIds.size === items.length && items.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(items.map(i => i.id)));
        }
    };

    const { selectedIndex, setSelectedIndex } = useInternalTableNavigation({
        data: items,
        isActive: isOpen && !isFocused, // Table navigation only when search input is not focused
        onEdit: (item) => {
            if (isMultiSelect) {
                toggleSelection(item.id);
            } else {
                onSelect(item);
            }
        }
    });

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIsFocused(false);
            setSelectedIndex(0);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // Enter key press in search should focus table or select top result
            if (items.length > 0) {
                if (isMultiSelect) {
                    toggleSelection(items[0].id);
                } else {
                    onSelect(items[0]);
                    if (onClose) onClose();
                }
            }
        }
    };

    const handleSelectConfirm = () => {
        if (isMultiSelect) {
            onSelect(items.filter(i => selectedIds.has(i.id)));
        } else {
            if (items && items.length > 0 && selectedIndex >= 0 && selectedIndex < items.length) {
                onSelect(items[selectedIndex]);
            }
        }
        if (onClose) onClose();
    };

    const finalColumns = isMultiSelect ? [
        {
            accessor: '_secim',
            header: (
                <button 
                    type="button" 
                    onClick={handleSelectAll} 
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                >
                    {selectedIds.size === items.length && items.length > 0 ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} />}
                </button>
            ),
            width: '40px',
            render: (item) => (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button 
                        type="button" 
                        onClick={(e) => { e.stopPropagation(); toggleSelection(item.id); }} 
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                    >
                        {selectedIds.has(item.id) ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} />}
                    </button>
                </div>
            )
        },
        ...columns
    ] : columns;

    const finalMobileCardRender = isMultiSelect && mobileCardRender ? (item) => (
        <div 
            onClick={() => toggleSelection(item.id)} 
            style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px', cursor: 'pointer' }}
        >
            <div style={{ 
                width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: selectedIds.has(item.id) ? 'var(--accent-primary)' : 'var(--text-secondary)'
            }}>
                {selectedIds.has(item.id) ? <CheckSquare size={24} /> : <Square size={24} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                {mobileCardRender(item)}
            </div>
        </div>
    ) : mobileCardRender;

    return (
        <BasePopup
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            modalSize={isMultiSelect ? "xl" : "lg"}
            hideFooter={true}
        >
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, maxHeight: '80vh', padding: '16px 24px' }}>
                <div className="mb-16">
                    <div style={{ height: '42px' }}>
                        <AramaInput
                            placeholder={searchPlaceholder}
                            value={aramaMetni}
                            onChange={(e) => setAramaMetni(e.target.value)}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setIsFocused(false)}
                            onKeyDown={handleKeyDown}
                            autoFocus={true}
                        />
                    </div>
                </div>

                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', border: isMultiSelect ? '1px solid var(--glass-border)' : 'none', borderRadius: isMultiSelect ? '8px' : '0' }}>
                    <DataTable
                        columns={finalColumns}
                        fetchData={handleFetchData}
                        pageSize={isMultiSelect ? 500 : 50}
                        onDataChange={setItems}
                        refreshKey={refreshKey}
                        onRowClick={(item) => {
                            setSelectedIndex(items.findIndex(i => i.id === item.id));
                            if (isMultiSelect) {
                                toggleSelection(item.id);
                            }
                        }}
                        onRowDoubleClick={(item) => {
                            if (isMultiSelect) {
                                toggleSelection(item.id);
                            } else {
                                onSelect(item);
                                if (onClose) onClose();
                            }
                        }}
                        rowClassName={(item, index) => {
                            let classes = [];
                            if (index === selectedIndex && !isFocused) classes.push('row-selected');
                            if (isMultiSelect && selectedIds.has(item.id)) classes.push('row-selected');
                            return classes.join(' ');
                        }}
                        emptyMessage={emptyMessage}
                        hideSearchBar={true}
                        mobileCardRender={finalMobileCardRender}
                    />
                </div>
                
                {/* Footer / Buttons */}
                <div style={{ padding: '16px 0 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--glass-border)', marginTop: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {customFooterLeft && customFooterLeft}
                        {isMultiSelect && (
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                Seçilen Kayıt: <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{selectedIds.size}</span>
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button 
                            type="button" 
                            onClick={onClose}
                            className="btn-cancel"
                            style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', borderRadius: '6px', cursor: 'pointer' }}
                        >
                            İptal
                        </button>
                        <button 
                            type="button" 
                            onClick={handleSelectConfirm}
                            className="btn-primary"
                            style={{ padding: '8px 24px', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
                            disabled={isMultiSelect ? selectedIds.size === 0 : (!items || items.length === 0 || selectedIndex < 0)}
                        >
                            {confirmButtonText}
                        </button>
                    </div>
                </div>
            </div>
        </BasePopup>
    );
};

export default BaseSeciciModal;
