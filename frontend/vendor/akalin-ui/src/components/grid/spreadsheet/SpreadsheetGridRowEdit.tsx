import React from 'react';
import BaseDetailDialog from '../../dialog/BaseDetailDialog';
import SaveButton from '../../button/SaveButton';
import CancelButton from '../../button/CancelButton';

export interface SpreadsheetGridRowEditProps {
    isOpen: boolean;
    onClose: () => void;
    rowIndex: number | null;
    data: any[];
    activeColumns: any[];
    isEmptyRow?: (row: any) => boolean;
    onRemoveRow?: (index: number) => void;
}

const SpreadsheetGridRowEdit: React.FC<SpreadsheetGridRowEditProps> = ({
    isOpen,
    onClose,
    rowIndex,
    data,
    activeColumns,
    isEmptyRow,
    onRemoveRow
}) => {
    if (rowIndex === null) return null;

    const rowData = data[rowIndex] || {};
    const isEditingExisting = rowIndex < data.length && (!isEmptyRow || !isEmptyRow(rowData));
    const title = isEditingExisting ? 'Satırı Düzenle' : 'Yeni Satır Ekle';

    return (
        <BaseDetailDialog
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            size="full"
            hideMaximize={true}
            footerContent={
                <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                    <CancelButton 
                        style={{ flex: 1 }} 
                        onClick={onClose}
                    />
                    <SaveButton 
                        text="Tamam"
                        type="button"
                        style={{ flex: 2, width: 'auto' }} 
                        onClick={onClose}
                    />
                </div>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '4px' }}>
                {activeColumns.map((col: any, colIndex: number) => (
                    <div key={col.id || colIndex} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                            {col.header}
                        </label>
                        <div style={{ background: 'var(--bg-primary)', borderRadius: '6px', border: '1px solid var(--glass-border)' }}>
                            {typeof col.render === 'function' ? col.render(rowData, rowIndex) : (col.id ? rowData[col.id] : '')}
                        </div>
                    </div>
                ))}
            </div>
        </BaseDetailDialog>
    );
};

export default SpreadsheetGridRowEdit;
