/**
 * Mantiene la misma sesión al navegar entre páginas del prototipo.
 *
 * sessionStorage vive mientras la pestaña esté abierta y se borra al cerrarla. Justo lo que
 * queremos: recargar continúa la sesión; cerrar la pestaña y volver a abrir crea una nueva.
 */

import type { DeviceInfo, PageInfo } from '@taptana/shared';
import { createId } from './ids.js';

const KEY_SESSION = 'taptana:sessionId';
const KEY_LAST_PATH = 'taptana:lastPath';

export interface SessionContext {
  sessionId: string;
  pageId: string;
  /** true si esta página es la primera de la sesión. */
  isNewSession: boolean;
  page: PageInfo;
  device: DeviceInfo;
  /** Path de la página anterior dentro de la sesión, o "" si es la entrada. */
  previousPath: string;
}

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* modo privado o storage bloqueado: la sesión dura una página */
  }
}

/** Ruta actual con query, sin el parámetro `study` (es de Taptana, no del prototipo). */
export function currentPath(): string {
  let search = location.search;
  if (search.includes('study=')) {
    const params = new URLSearchParams(search);
    params.delete('study');
    const rest = params.toString();
    search = rest ? `?${rest}` : '';
  }
  return location.pathname + search;
}

export function collectDevice(): DeviceInfo {
  return {
    userAgent: navigator.userAgent,
    screen: { width: screen.width, height: screen.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    dpr: window.devicePixelRatio || 1,
    touch: navigator.maxTouchPoints > 0 || 'ontouchstart' in window,
    language: navigator.language,
  };
}

export function startSession(): SessionContext {
  let sessionId = safeGet(KEY_SESSION);
  const isNewSession = !sessionId;
  if (!sessionId) {
    sessionId = createId('s');
    safeSet(KEY_SESSION, sessionId);
  }

  const previousPath = isNewSession ? '' : (safeGet(KEY_LAST_PATH) ?? '');
  const path = currentPath();
  safeSet(KEY_LAST_PATH, path);

  return {
    sessionId,
    pageId: createId('p'),
    isNewSession,
    previousPath,
    page: {
      path,
      title: document.title,
      referrer: document.referrer,
      startedAt: Date.now(),
    },
    device: collectDevice(),
  };
}
