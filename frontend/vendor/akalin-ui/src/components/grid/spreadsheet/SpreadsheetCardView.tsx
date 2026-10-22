import React from 'react';
import SpreadsheetAddNewRow, { SpreadsheetAddAction } from './SpreadsheetAddNewRow';
import { useTranslation } from 'react-i18next';

export interface SpreadsheetCardViewProps {
    data: any[];
    isEmptyRow?: (row: any) => boolean;
    setMobileEditRowIndex: (index: number | null) => void;
    mobileCardRender?: (row: any, rowIndex: number) => React.ReactNode;
    autoAddRow: boolean;
    onAddRow?: () => void;
    onCustomAddAction?: () => void;
    handleAddRequest: (e?: React.MouseEvent) => void;
    customAddIcon?: React.ReactNode;
    additionalAddActions?: SpreadsheetAddAction[];
}

const SpreadsheetCardView: React.FC<SpreadsheetCardViewProps> = ({
    data,
    isEmptyRow,
    setMobileEditRowIndex,
    mobileCardRender,
    autoAddRow,
    onAddRow,
    onCustomAddAction,
    handleAddRequest,
    customAddIcon,
    additionalAddActions
}) => {
    const { t } = useTranslation();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px', overflowY: 'auto', flex: 1, background: 'var(--bg-secondary)' }}>
            {data.map((row, rowIndex) => {
                if (isEmptyRow && isEmptyRow(row) && rowIndex === data.length - 1) return null;

                return (
                    <div 
                        key={row.id || rowIndex} 
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', cursor: 'pointer' }}
                        onClick={() => setMobileEditRowIndex(rowIndex)}
                    >
                        {mobileCardRender ? mobileCardRender(row, rowIndex) : (
                            <div className="flex-col gap-8">
                                <div style={{ fontSize: '14px', fontWeight: '600' }}>{t('auto_satir_numarasi', { defaultValue: `Satır ${rowIndex + 1}`, no: rowIndex + 1 })}</div>
                                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{t('auto_duzenlemek_icin_doku_1187', 'Düzenlemek için dokunun')}</div>
                            </div>
                        )}
                    </div>
                );
            })}
            
            {data.length === 0 || (data.length === 1 && isEmptyRow && isEmptyRow(data[0])) ? (
                <div 
                    onClick={() => {
                        if (autoAddRow) handleAddRequest();
                    }}
                    style={{ 
                        padding: '32px 24px', 
                        textAlign: 'center', 
                        color: 'var(--text-secondary)', 
                        background: 'var(--bg-primary)', 
                        borderRadius: '8px', 
                        border: '1px dashed var(--glass-border)',
                        cursor: autoAddRow ? 'pointer' : 'default'
                    }}
                >
                    {t('auto_kayit_bulunamadi_3696', 'Kayıt bulunamadı.')}
                    <div style={{ marginTop: '8px', fontSize: '13px' }}>
                        {autoAddRow 
                            ? t('auto_yeni_satir_icin_tiklayin', 'Yeni satır eklemek için buraya dokunun veya tıklayın.')
                            : t('auto_yeni_satir_eklemek_i_5c5f', 'Yeni satır eklemek için ekle düğmesini kullanabilirsiniz.')}
                    </div>
                </div>
            ) : null}

            {autoAddRow && (onAddRow || onCustomAddAction) && (
                <SpreadsheetAddNewRow 
                    onAddRow={handleAddRequest} 
                    customAddIcon={customAddIcon} 
                    additionalAddActions={additionalAddActions}
                />
            )}
        </div>
    );
};

export default SpreadsheetCardView;
