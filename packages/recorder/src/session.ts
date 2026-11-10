/**
 * Mantiene la misma sesión al navegar entre páginas del prototipo.
 *
 * sessionStorage vive mientras la pestaña esté abierta y se borra al cerrarla. Justo lo que
 * queremos: recargar continúa la sesión; cerrar la pestaña y volver a abrir crea una nueva.
 */

import { PREVIEW_PARAM, STUDY_PARAM, TRYOUT_PARAM, isRouteHash, maskUrl, screenId, type DeviceInfo, type PageInfo } from '@taptana/shared';
import { createId } from './ids.js';

const KEY_SESSION = 'taptana:sessionId';
const KEY_LAST_SCREEN = 'taptana:lastPath';

export interface SessionContext {
  sessionId: string;
  pageId: string;
  /** true si esta página es la primera de la sesión. */
  isNewSession: boolean;
  page: PageInfo;
  device: DeviceInfo;
  /** Pantalla anterior dentro de la sesión (ScreenId), o "" si es la entrada. */
  previousScreen: string;
}

export function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Devuelve false si no se pudo guardar (modo privado o storage bloqueado). */
export function storageSet(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* nada que borrar */
  }
}

let basePath = '';

/** Prefijo bajo el que se sirve el prototipo ("/p/pr_abc"). Se quita de las rutas registradas. */
export function setBasePath(base: string): void {
  basePath = base;
}

export function getBasePath(): string {
  return basePath;
}

/** Convierte una ruta del prototipo ("/gracias.html") en una URL real ("/p/pr_abc/gracias.html"). */
export function withBase(path: string): string {
  return basePath + (path.startsWith('/') ? path : `/${path}`);
}

/** Quita el prefijo del prototipo de una ruta: "/p/pr_abc/x.html" → "/x.html". */
export function stripBase(pathname: string, base: string = basePath): string {
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}

/**
 * Con `data-base`, una URL absoluta dentro del mismo origen que se sale del prototipo
 * (`pushState('/checkout')`) se reescribe bajo el prefijo, para que al recargar siga dentro.
 * Devuelve la URL tal cual si no hay nada que cambiar.
 */
export function rebaseUrl(url: string, base: string, href: string): string {
  if (!base) return url;
  let target: URL;
  let here: URL;
  try {
    here = new URL(href);
    target = new URL(url, href);
  } catch {
    return url;
  }
  if (target.origin !== here.origin) return url;
  if (target.pathname === base || target.pathname.startsWith(`${base}/`)) return url;
  return base + target.pathname + target.search + target.hash;
}

/** Parámetros que son nuestros y no dicen nada del prototipo. */
const OWN_PARAMS = [STUDY_PARAM, TRYOUT_PARAM, PREVIEW_PARAM];

/**
 * Ruta actual con query, sin el prefijo del prototipo ni nuestros parámetros, y con los valores
 * de la query enmascarados: lo que alguien escribió en un formulario GET no sale del celular.
 */
export function currentPath(): string {
  const pathname = stripBase(location.pathname);
  let search = location.search;
  if (search.length > 1) {
    try {
      const params = new URLSearchParams(search);
      for (const name of OWN_PARAMS) params.delete(name);
      const rest = params.toString();
      search = rest ? `?${rest}` : '';
    } catch {
      /* se enmascara tal cual */
    }
  }
  return maskUrl(pathname + search);
}

/** ScreenId de la URL actual: ruta sin prefijo ni query, más el hash si es de ruta. */
export function urlScreen(): string {
  const hash = isRouteHash(location.hash) ? location.hash : '';
  return screenId(stripBase(location.pathname) + hash);
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

/** Olvida la sesión de esta pestaña: la próxima `startSession` crea una nueva. */
export function resetSession(): void {
  storageRemove(KEY_SESSION);
  storageRemove(KEY_LAST_SCREEN);
}

/** Recuerda la pantalla actual para que la siguiente página sepa de dónde vino. */
export function saveLastScreen(screen: string): void {
  storageSet(KEY_LAST_SCREEN, screen);
}

/** Última pantalla que vio esta pestaña dentro de la sesión, o "". */
export function lastScreen(): string {
  return storageGet(KEY_LAST_SCREEN) ?? '';
}

/** `title` ya viene sin lo que el participante escribió (ver privacy.ts). */
export function startSession(title: string): SessionContext {
  let sessionId = storageGet(KEY_SESSION);
  const isNewSession = !sessionId;
  if (!sessionId) {
    sessionId = createId('s');
    storageSet(KEY_SESSION, sessionId);
  }

  return {
    sessionId,
    pageId: createId('p'),
    isNewSession,
    previousScreen: isNewSession ? '' : (storageGet(KEY_LAST_SCREEN) ?? ''),
    page: {
      path: currentPath(),
      title,
      referrer: maskUrl(document.referrer),
      startedAt: Date.now(),
    },
    device: collectDevice(),
  };
}
