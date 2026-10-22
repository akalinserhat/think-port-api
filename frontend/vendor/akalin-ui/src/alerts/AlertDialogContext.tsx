import React, { useContext, useState } from 'react';
import AlertDialog from './AlertDialog';
import { createSingletonContext } from '../utils/createSingletonContext';

export interface AlertDialogContextType {
  showAlert: (
    type: 'info' | 'success' | 'warning' | 'error' | 'confirm',
    title: string,
    message: React.ReactNode,
    onConfirm?: (() => void) | (() => Promise<void>) | null,
    confirmText?: string,
    cancelText?: string,
    showCancel?: boolean,
    onCancel?: (() => void) | null
  ) => void;
  hideAlert: () => void;
}

const GLOBAL_KEY = '__AKALIN_UI_ALERT_DIALOG_CONTEXT__';
const AlertDialogContext = createSingletonContext<AlertDialogContextType | null>(
  GLOBAL_KEY,
  null,
  'AlertDialogContext'
);

export const AlertDialogProvider = ({ children }: { children: React.ReactNode }) => {
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    type: 'info' | 'success' | 'warning' | 'error' | 'confirm';
    title: string;
    message: React.ReactNode;
    onConfirm: (() => void) | (() => Promise<void>) | null;
    confirmText: string;
    cancelText: string;
    showCancel?: boolean;
    onCancel?: (() => void) | null;
  }>({
    isOpen: false,
    type: 'info',
    title: '',
    message: '',
    onConfirm: null,
    confirmText: 'Tamam',
    cancelText: 'İptal',
    showCancel: false,
    onCancel: null
  });

  const showAlert = (
    type: 'info' | 'success' | 'warning' | 'error' | 'confirm',
    title: string,
    message: React.ReactNode,
    onConfirm: (() => void) | (() => Promise<void>) | null = null,
    confirmText = 'Tamam',
    cancelText = 'İptal',
    showCancel?: boolean,
    onCancel: (() => void) | null = null
  ) => {
    setAlertState({ isOpen: true, type, title, message, onConfirm, confirmText, cancelText, showCancel, onCancel });
  };

  const hideAlert = () => {
    setAlertState(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <AlertDialogContext.Provider value={{ showAlert, hideAlert }}>
      {children}
      <AlertDialog 
        isOpen={alertState.isOpen}
        type={alertState.type}
        title={alertState.title}
        message={alertState.message}
        confirmText={alertState.confirmText}
        cancelText={alertState.cancelText}
        onConfirm={async () => {
          if (alertState.onConfirm) {
            await alertState.onConfirm();
          }
          hideAlert();
        }}
        onClose={() => {
          if (alertState.onCancel) {
            alertState.onCancel();
          }
          hideAlert();
        }}
        showCancel={alertState.showCancel ?? (alertState.type === 'confirm' || (!!alertState.onConfirm && alertState.type !== 'warning'))} 
      />
    </AlertDialogContext.Provider>
  );
};

export const useAlertDialog = () => {
  const context = useContext(AlertDialogContext);
  if (!context) {
    throw new Error('useAlertDialog must be used within an AlertDialogProvider');
  }
  return context;
};

export default AlertDialogContext;
