import React from 'react';
import BaseMenuButton from '../../base/button/BaseMenuButton';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface SpreadsheetAddAction {
    id: string;
    label: string;
    icon?: React.ReactNode;
    onClick: (e: React.MouseEvent) => void;
}

export interface SpreadsheetAddNewRowProps {
    onAddRow: (e?: React.MouseEvent) => void;
    customAddIcon?: React.ReactNode;
    additionalAddActions?: SpreadsheetAddAction[];
}

const SpreadsheetAddNewRow: React.FC<SpreadsheetAddNewRowProps> = ({
    onAddRow,
    customAddIcon,
    additionalAddActions = []
}) => {
    const { t } = useTranslation();
    return (
        <BaseMenuButton
            variant="outline"
            style={{ width: '100%', marginTop: '4px', background: 'var(--bg-primary)' }}
            items={[
                {
                    id: 'new_row',
                    label: t('auto_yeni_satir_ekle_btn', 'Yeni Satır Ekle'),
                    icon: customAddIcon || <Plus size={18} />,
                    onClick: (e) => onAddRow(e as React.MouseEvent)
                },
                ...additionalAddActions.map(action => ({
                    id: action.id,
                    label: action.label,
                    icon: action.icon,
                    onClick: action.onClick
                }))
            ]}
        />
    );
};

export default SpreadsheetAddNewRow;
