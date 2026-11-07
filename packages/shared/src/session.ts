/**
 * Sesión, página y dispositivo.
 *
 * - Sesión: una visita de una persona. Sobrevive al cambiar de página (sessionStorage).
 * - Página: cada carga de un HTML dentro de la sesión. rrweb toma una foto completa del DOM
 *   al empezar cada una.
 */

export interface DeviceInfo {
  /** Texto del navegador. El server lo resume en `deviceLabel`. */
  userAgent: string;
  /** Pantalla física. */
  screen: { width: number; height: number };
  /** Área visible. */
  viewport: { width: number; height: number };
  /** Densidad de píxeles (2 o 3 en celulares). */
  dpr: number;
  /** ¿Tiene pantalla táctil? */
  touch: boolean;
  /** "es-PE". */
  language: string;
}

export interface PageInfo {
  /** "/producto.html?id=3" */
  path: string;
  /** <title> de la página. */
  title: string;
  /** De dónde vino. Vacío si es la primera. */
  referrer: string;
  startedAt: number;
}

/** Un prototipo: la carpeta servida en modo dev, o un zip subido en modo servidor. */
export interface Prototype {
  id: string;
  name: string;
  createdAt: number;
}

/** Resumen de sesión tal como lo muestra la lista del panel. */
export interface SessionSummary {
  id: string;
  prototypeId: string;
  startedAt: number;
  lastSeenAt: number;
  /** Duración en ms: lastSeenAt - startedAt. */
  durationMs: number;
  /** "iPhone · Safari 18", calculado del user agent. */
  deviceLabel: string;
  viewport: { width: number; height: number };
  touch: boolean;
  /** Primera página que abrió. */
  entryPath: string;
  pageCount: number;
  tapCount: number;
}

/** Página dentro de una sesión, como la guarda el server. */
export interface SessionPage extends PageInfo {
  id: string;
}

/** Id del único prototipo en modo `taptana dev`. */
export const LOCAL_PROTOTYPE_ID = 'local';
