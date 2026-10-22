/**
 * Akalin UI - Temel Liste Veri Girişi Bileşeni (BaseListInput)
 * Kalem/alt liste veri girişlerinde tablo veya kart görünümü, satır silme ve
 * yüzen ekleme butonu desteği sunan genel bileşen.
 */
import React, { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import EkleFloatCircleButton from '../../button/EkleFloatCircleButton';

export interface Column<T> {
    header: string;
    accessor?: string;
    render?: (item: T, index: number) => ReactNode;
    width?: string;
}

export type BaseListInputColumn<T = any> = Column<T>;

export interface BaseListInputProps<T = any> {
    items: T[];
    onRemove: (index: number) => void;
    columns: Column<T>[];
    inputForm?: ReactNode;
    emptyMessage?: string;
    listTitle?: string;
    showAddButton?: boolean;
    onAddClick?: () => void;
}

export function BaseListInput<T>({
    items,
    onRemove,
    columns,
    inputForm,
    emptyMessage = "Henüz kayıt eklenmedi.",
    listTitle = "Eklenenler",
    showAddButton = false,
    onAddClick
}: BaseListInputProps<T>) {
    return (
        <div className="flex-col min-h-0 bg-primary rounded-12 border-glass shadow-sm relative overflow-hidden" style={{ height: 'max-content' }}>
            {/* Action Bar (Input Form) */}
            {inputForm && (
                <div className="bg-secondary p-12 border-b border-glass shrink-0">
                    {inputForm}
                </div>
            )}
            
            {/* Header */}
            <div className="flex items-center px-16 py-12 bg-secondary/50 border-b border-glass shrink-0" style={{ minHeight: '48px' }}>
                {columns.map((col, idx) => (
                    <div key={idx} className="text-12 font-semibold text-secondary uppercase tracking-wider" style={{ width: col.width, flex: col.width ? 'none' : 1 }}>
                        {col.header}
                    </div>
                ))}
                <div className="w-24 shrink-0"></div> {/* Spacer for delete button */}
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-col p-8 gap-4 pb-48" style={{ minHeight: '150px', maxHeight: '350px' }}>
                {items.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-13 text-secondary italic py-24">
                        {emptyMessage}
                    </div>
                ) : (
                    items.map((item, index) => (
                        <div key={index} className="flex items-center px-8 py-8 bg-secondary rounded-8 border-glass hover:border-accent-primary transition-colors group">
                            {columns.map((col, idx) => (
                                <div key={idx} className="text-13 font-medium text-primary" style={{ width: col.width, flex: col.width ? 'none' : 1 }}>
                                    {col.render ? col.render(item, index) : (item as any)[col.accessor || '']}
                                </div>
                            ))}
                            <div className="w-24 flex justify-end shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                    type="button"
                                    onClick={() => onRemove(index)}
                                    className="btn-icon p-4 text-danger hover:bg-danger hover:text-white rounded-6"
                                    title="Sil"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Floating Action Button */}
            {showAddButton && onAddClick && (
                <EkleFloatCircleButton 
                    onClick={onAddClick}
                    position="absolute-bottom-right"
                />
            )}
        </div>
    );
}

export default BaseListInput;
