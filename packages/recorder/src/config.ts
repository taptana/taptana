/**
 * Lee la configuración de los atributos data-* de la etiqueta <script> y decide en qué modo
 * corre el recorder en esta ventana.
 *
 *   <script src="/__taptana/recorder.js" data-prototype="local"></script>
 *   <script src="https://taptana.midominio.com/__taptana/recorder.js"
 *           data-endpoint="https://taptana.midominio.com"
 *           data-prototype="pr_9xKq2mN"
 *           data-transport="http"></script>
 */

import {
  DEMO_WINDOW,
  LOCAL_PROTOTYPE_ID,
  PREVIEW_PARAM,
  PREVIEW_WINDOW,
  STUDY_PARAM,
  TRYOUT_PARAM,
  TRYOUT_WINDOW,
} from '@taptana/shared';

export type TransportKind = 'http' | 'local';

export interface RecorderConfig {
  /** Origen del servidor, sin barra final. Si falta, el origen del propio script. */
  endpoint: string;
  prototypeId: string;
  transport: TransportKind;
  /** Prefijo donde vive el prototipo ("/p/pr_abc"). Las rutas se registran sin él. */
  base: string;
  /** Mostrar el botón "Terminar y exportar" en modo local (data-export="off" lo oculta). */
  exportButton: boolean;
}

declare const __TAPTANA_VERSION__: string;
export const VERSION = __TAPTANA_VERSION__;

export function readConfig(): RecorderConfig {
  const script = document.currentScript as HTMLScriptElement | null;
  const data = script?.dataset ?? {};

  let endpoint = (data['endpoint'] ?? '').replace(/\/+$/, '');
  if (!endpoint && script?.src) {
    try {
      endpoint = new URL(script.src, location.href).origin;
    } catch {
      endpoint = location.origin;
    }
  }
  if (!endpoint) endpoint = location.origin;

  const transport: TransportKind = data['transport'] === 'local' ? 'local' : 'http';

  return {
    endpoint,
    prototypeId: data['prototype'] || LOCAL_PROTOTYPE_ID,
    transport,
    base: (data['base'] ?? '').replace(/\/+$/, ''),
    exportButton: data['export'] !== 'off',
  };
}

/**
 * - record: graba (lo normal).
 * - preview: el panel solo muestra el prototipo; el recorder no hace nada.
 * - demo: el panel observa pantallas y toques para armar el estudio; no graba.
 * - tryout: corre el estudio completo sin grabar ni enviar.
 */
export type Mode = 'record' | 'preview' | 'demo' | 'tryout';

/** Valor de un parámetro de la URL, o null si no está. */
export function queryParam(name: string): string | null {
  try {
    return new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}

/**
 * El modo sale del nombre de la ventana (lo pone el panel en su `<iframe name="…">` y sobrevive
 * a la navegación) o de la URL. Un link con `?tryout=1` abierto en una pestaña le pone ese
 * nombre a la pestaña, para que las siguientes páginas tampoco graben.
 */
export function detectMode(): Mode {
  const name = window.name;
  if (name === PREVIEW_WINDOW || queryParam(PREVIEW_PARAM) !== null) return 'preview';
  if (name === DEMO_WINDOW) return 'demo';
  const tryout = queryParam(TRYOUT_PARAM);
  if (tryout !== null && tryout !== '0' && tryout !== 'false') {
    try {
      window.name = TRYOUT_WINDOW;
    } catch {
      /* la prueba dura esta página */
    }
    return 'tryout';
  }
  if (name === TRYOUT_WINDOW) {
    // Una pestaña que quedó en modo prueba y ahora abre el link real del estudio: vuelve a grabar.
    if (window.top === window.self && queryParam(STUDY_PARAM) !== null) {
      window.name = '';
      return 'record';
    }
    return 'tryout';
  }
  return 'record';
}
