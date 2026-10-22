import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import {
  AlertDialogProvider,
  HeaderProvider,
  InputSettingsProvider,
} from '@akalin/ui';
import { GlobalSearchProvider } from '@akalin/global_search_module';
import './i18n';
import './index.css';
import { ThemeProvider } from './context/ThemeContext';
import { initializeGatewayModules } from './modules';
import App from './App';

initializeGatewayModules();

const reportClientError = (data: Record<string, unknown>) => {
  try {
    fetch('/admin/logs/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        href: window.location.href,
        ...data,
      }),
    }).catch(() => {});
  } catch {}
};

window.addEventListener('error', (e) => {
  reportClientError({
    type: 'window.error',
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    stack: e.error?.stack,
  });
});

window.addEventListener('unhandledrejection', (e) => {
  reportClientError({
    type: 'unhandledrejection',
    message: String(e.reason?.message || e.reason),
    stack: e.reason?.stack,
  });
});

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[RootErrorBoundary]', error, info.componentStack);
    reportClientError({
      type: 'RootErrorBoundary',
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#ef4444', fontFamily: 'monospace' }}>
          <h2>Uygulama Hatası</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error.stack || this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #ef4444',
              background: 'transparent',
              color: '#ef4444',
              cursor: 'pointer',
            }}
          >
            Sayfayı Yenile
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AlertDialogProvider>
            <HeaderProvider>
              <InputSettingsProvider>
                <GlobalSearchProvider allowMultipleFilterTypes={true}>
                  <Toaster position="top-right" />
                  <App />
                </GlobalSearchProvider>
              </InputSettingsProvider>
            </HeaderProvider>
          </AlertDialogProvider>
        </ThemeProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>
);

