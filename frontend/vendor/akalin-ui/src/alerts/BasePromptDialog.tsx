import React, { useState, useEffect } from 'react';
import Card from '../components/card/Card';
import SaveButton from '../components/button/SaveButton';
import CancelButton from '../components/button/CancelButton';

export interface BasePromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (value: string) => Promise<void> | void;
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
}

const BasePromptDialog: React.FC<BasePromptDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  label,
  initialValue = '',
  placeholder = '',
  confirmText = 'Tamam',
  cancelText = 'İptal'
}) => {
  const [value, setValue] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      setIsSaving(false);
    }
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!value.trim()) return;
    setIsSaving(true);
    try {
      await onConfirm(value);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <div className="modal-content" style={{ width: '400px', padding: 0 }}>
        <Card style={{ margin: 0, border: 'none', boxShadow: 'none' }}>
          <Card.Header title={title} onClose={onClose} />
          <Card.Body>
            <div className="form-group" style={{ marginBottom: 0 }}>
              {label && <label className="form-label">{label}</label>}
              <input 
                type="text"
                className="form-input"
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                autoFocus
              />
            </div>
          </Card.Body>
          <Card.Footer style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <CancelButton onClick={onClose} text={cancelText} />
            <SaveButton onClick={handleConfirm} isSaving={isSaving} text={confirmText} />
          </Card.Footer>
        </Card>
      </div>
    </div>
  );
};

export default BasePromptDialog;
