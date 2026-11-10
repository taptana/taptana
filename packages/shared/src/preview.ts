/**
 * Vista previa: cómo se hablan el panel y el recorder cuando el prototipo corre dentro de un
 * `<iframe name="…">` del panel.
 *
 * El nombre de la ventana sobrevive a la navegación dentro del iframe; así el recorder sabe en
 * qué modo está en cada página, sin depender de la URL.
 */

import type { NavigationEvent, TargetInfo } from './events.js';
import type { StudyRecord } from './study.js';

/** Solo mostrar: sin grabar y sin interfaz. También con `?taptana-preview` en la URL. */
export const PREVIEW_WINDOW = 'taptana-preview';
/** El panel observa: no graba, avisa pantallas y toques (para grabar el camino correcto). */
export const DEMO_WINDOW = 'taptana-demo';
/** Prueba del estudio completo sin grabar. También con `?tryout=1` en la URL. */
export const TRYOUT_WINDOW = 'taptana-tryout';

/** Parámetro de la URL equivalente a PREVIEW_WINDOW (basta con que esté presente). */
export const PREVIEW_PARAM = 'taptana-preview';
/** Parámetro de la URL equivalente a TRYOUT_WINDOW (`?tryout=1`). */
export const TRYOUT_PARAM = 'tryout';
/** Parámetro del link de un estudio (`?study=<id>`). */
export const STUDY_PARAM = 'study';
/** Cuánto espera el recorder la respuesta del panel a `need-study` antes de bajar el estudio de la API. */
export const NEED_STUDY_TIMEOUT_MS = 600;

/** Recorder → panel (`window.parent.postMessage`). */
export type RecorderMessage =
  /** El recorder arrancó en esta página. */
  | { source: 'taptana'; type: 'ready'; screen: string; title: string }
  /** Cambió la pantalla. `screen` es un ScreenId. */
  | { source: 'taptana'; type: 'screen'; screen: string; title: string; via: NavigationEvent['via'] }
  /** Un toque. `selector` es el más corto y estable (#id, .clase, o la ruta). */
  | { source: 'taptana'; type: 'tap'; screen: string; x: number; y: number; target: TargetInfo; selector: string;
      /** true: es la respuesta a un `pick` del panel; el toque NO activó el prototipo. */
      picked?: boolean }
  /** Modo prueba: pide el estudio (el borrador) al panel. */
  | { source: 'taptana'; type: 'need-study' }
  /**
   * Modo prueba: empezó un bloque, terminó el estudio, o se presionó Escape dentro del iframe
   * (`escape`: el panel cierra el diálogo aunque el foco esté en el prototipo).
   */
  | { source: 'taptana'; type: 'tryout'; event: 'block' | 'finish' | 'escape'; blockId?: string };

/** Panel → recorder (`iframe.contentWindow.postMessage`). */
export type PanelMessage =
  /** El estudio a probar. `startAt`: id del bloque por el que empezar ("Probar esta tarea"). */
  | { source: 'taptana-panel'; type: 'study'; study: StudyRecord; startAt?: string }
  /**
   * Modo demo: el próximo toque se avisa (`tap` con `picked: true`) y NO activa el prototipo (no
   * navega ni abre nada). Sirve para elegir un elemento. `cancel: true` lo desarma sin tocar.
   */
  | { source: 'taptana-panel'; type: 'pick'; cancel?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const VIAS: ReadonlyArray<unknown> = ['load', 'history', 'hash', 'screen', undefined];

/**
 * ¿`data` (lo que llega en un evento `message`) es un mensaje del recorder bien formado?
 * Cualquier página puede mandar mensajes: revisa además `event.source` contra el iframe.
 */
export function isRecorderMessage(data: unknown): data is RecorderMessage {
  if (!isRecord(data) || data['source'] !== 'taptana') return false;
  switch (data['type']) {
    case 'ready':
      return typeof data['screen'] === 'string' && typeof data['title'] === 'string';
    case 'screen':
      return typeof data['screen'] === 'string' && typeof data['title'] === 'string' && VIAS.includes(data['via']);
    case 'tap':
      return (
        typeof data['screen'] === 'string' &&
        isNumber(data['x']) &&
        isNumber(data['y']) &&
        typeof data['selector'] === 'string' &&
        isRecord(data['target']) &&
        typeof data['target']['tag'] === 'string' &&
        typeof data['target']['selector'] === 'string' &&
        (data['picked'] === undefined || typeof data['picked'] === 'boolean')
      );
    case 'need-study':
      return true;
    case 'tryout':
      return (
        (data['event'] === 'block' || data['event'] === 'finish' || data['event'] === 'escape') &&
        (data['blockId'] === undefined || typeof data['blockId'] === 'string')
      );
    default:
      return false;
  }
}

/** ¿`data` es un mensaje del panel bien formado? El recorder revisa además `event.source === window.parent`. */
export function isPanelMessage(data: unknown): data is PanelMessage {
  if (!isRecord(data) || data['source'] !== 'taptana-panel') return false;
  if (data['type'] === 'pick') return data['cancel'] === undefined || typeof data['cancel'] === 'boolean';
  if (data['type'] !== 'study') return false;
  const study = data['study'];
  // No se exige `id`: un borrador sin guardar también se puede probar.
  if (!isRecord(study)) return false;
  if (!Array.isArray(study['blocks']) && !Array.isArray(study['tasks'])) return false;
  return data['startAt'] === undefined || typeof data['startAt'] === 'string';
}
