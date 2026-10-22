import React from 'react';
import { AlertCircle } from 'lucide-react';

export interface FieldErrorProps {
    error?: string | null;
}

export const FieldError: React.FC<FieldErrorProps> = ({ error }) => {
    if (!error) return null;
    
    return (
        <div style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <AlertCircle size={12} />
            <span>{error}</span>
        </div>
    );
};

export default FieldError;
