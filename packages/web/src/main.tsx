import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

declare const __TAPTANA_MODE__: 'http' | 'static';
// En la demo, el service worker sirve los prototipos subidos a este navegador.
if (__TAPTANA_MODE__ === 'static' && 'serviceWorker' in navigator) {
  void import('./api/static.ts').then((m) => m.ensureServiceWorker(import.meta.env.BASE_URL).catch(() => {}));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
