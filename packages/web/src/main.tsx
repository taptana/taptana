import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { IS_DEMO } from './api/client';

document.title = IS_DEMO ? 'Taptana · Demo' : 'Taptana';

// En la demo, el service worker sirve los prototipos subidos a este navegador y le entrega el
// estudio al recorder. Si el navegador no lo permite, el panel lo explica al intentar subir.
if (IS_DEMO && 'serviceWorker' in navigator) {
  void import('./api/static.ts').then((m) => m.ensureServiceWorker(import.meta.env.BASE_URL)).catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
