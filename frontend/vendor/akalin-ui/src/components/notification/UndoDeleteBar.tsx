import React, { useEffect, useState } from 'react';
import { RotateCcw, X, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface UndoDeleteBarProps {
  itemName: string;
  duration?: number;
  onUndo: () => void;
  onDismiss: () => void;
}

export const UndoDeleteBar: React.FC<UndoDeleteBarProps> = ({
  itemName,
  duration = 4000,
  onUndo,
  onDismiss
}) => {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingPercent = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remainingPercent);
      if (elapsed >= duration) {
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [duration]);

  return (
    <div className="undo-delete-bar" role="status" aria-live="polite">
      <div className="undo-delete-inner">
        <div className="undo-delete-info">
          <div className="undo-delete-icon">
            <Trash2 size={16} />
          </div>
          <span className="undo-delete-text">
            <strong>{itemName}</strong> {t('auto_kayit_silindi_kisa', 'silindi.')}
          </span>
        </div>
        <div className="undo-delete-actions">
          <button
            type="button"
            className="undo-delete-btn"
            onClick={onUndo}
            title={t('auto_geri_al', 'Geri Al')}
          >
            <RotateCcw size={15} />
            <span>{t('auto_geri_al', 'Geri Al')}</span>
          </button>
          <button
            type="button"
            className="undo-delete-dismiss-btn"
            onClick={onDismiss}
            title={t('auto_kapat', 'Kapat')}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="undo-delete-progress-track">
        <div 
          className="undo-delete-progress-fill" 
          style={{ width: `${progress}%` }} 
        />
      </div>
    </div>
  );
};

export default UndoDeleteBar;
