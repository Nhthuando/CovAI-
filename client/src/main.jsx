import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient.js'
import './index.css'
import App from './App.jsx'

// Intercept and suppress external browser extension noise (QuickPro, PageWorldBridgeError, etc.)
if (typeof window !== 'undefined') {
  const isExtensionNoise = (msg) => {
    if (!msg) return false;
    const str = String(msg);
    return (
      str.includes('QuickPro') ||
      str.includes('PageWorldBridgeError') ||
      str.includes('Page runtime unavailable') ||
      str.includes('chrome-extension://') ||
      /content\.[a-f0-9]+\.js/i.test(str)
    );
  };

  window.addEventListener('error', (event) => {
    if (isExtensionNoise(event.message) || isExtensionNoise(event.filename)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason?.message || String(reason);
    if (isExtensionNoise(msg) || (reason?.stack && isExtensionNoise(reason.stack))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  const origConsoleError = console.error;
  console.error = (...args) => {
    if (args.some((arg) => isExtensionNoise(arg?.message || arg?.stack || String(arg)))) {
      return;
    }
    origConsoleError.apply(console, args);
  };
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
