/**
 * Formato de eventos de Taptana.
 *
 * Hay dos familias:
 * - `rrweb`: lo que rrweb graba por su cuenta (foto del DOM, cambios, movimientos).
 *   Alimentan al reproductor. No los tocamos.
 * - `taptana`: resúmenes que calculamos nosotros (tap, swipe, scroll, viewport, navigation,
 *   task, answer, study). Son los que después se listan, buscan y cuentan.
 *
 * Todos los tiempos (`t`) son milisegundos desde 1970 (`Date.now()`), en el reloj del
 * dispositivo del participante. rrweb usa el mismo formato.
 */

/** Evento crudo de rrweb. `data` es el `eventWithTime` de rrweb tal cual. */
export interface RrwebEvent {
  kind: 'rrweb';
  t: number;
  data: unknown;
}

/** Describe el elemento tocado sin guardar contenido sensible. */
export interface TargetInfo {
  /** "button", "a", "input"... */
  tag: string;
  /** id del elemento, si tiene. */
  id?: string;
  /**
   * Texto visible, máximo 40 caracteres. En campos de formulario es su etiqueta (label,
   * aria-label o placeholder), NUNCA su valor.
   */
  text?: string;
  /** Ruta CSS corta: "main > .card:nth-child(2) > button". */
  selector: string;
  /** Hasta 5 clases del elemento, para reglas tipo ".cart-link". */
  classes?: string[];
  /** aria-role si tiene. */
  role?: string;
  /**
   * true si el elemento (o un ancestro cercano) es tocable por naturaleza (enlace, botón, campo,
   * `role`, `onclick`, cursor de mano) o si el toque tuvo efecto (cambió el DOM, la pantalla, el
   * foco o el scroll en los 350 ms siguientes). false = misclick: toque sin efecto sobre algo no
   * tocable. Ausente en grabaciones anteriores a v0.4, que no cuentan misclicks.
   */
  interactive?: boolean;
}

/** Dedo que baja y sube casi sin moverse (ver GESTURE_THRESHOLDS), o un clic de mouse. */
export interface TapEvent {
  kind: 'taptana';
  type: 'tap';
  t: number;
  /** Posición en el viewport, en píxeles CSS. */
  x: number;
  y: number;
  /** Posición en la página completa (con scroll). Para mapas de calor. */
  pageX?: number;
  pageY?: number;
  target: TargetInfo;
  /** Cayó en un elemento `position: fixed` (barra inferior, botón flotante): vale x/y, no pageY. */
  fixed?: boolean;
  /** Alto del viewport al tocar. */
  vh?: number;
}

export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

/** Dedo baja y sube en menos de 600 ms moviéndose más de 40 px. */
export interface SwipeEvent {
  kind: 'taptana';
  type: 'swipe';
  /** Cuándo terminó el gesto. */
  t: number;
  direction: SwipeDirection;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  durationMs: number;
}

/** Como máximo uno cada 250 ms mientras se hace scroll, y uno más al detenerse. */
export interface ScrollEvent {
  kind: 'taptana';
  type: 'scroll';
  t: number;
  x: number;
  y: number;
  /** 0 a 1: qué tan abajo llegó. (y + alto visible) / alto total. */
  depth: number;
}

export type Orientation = 'portrait' | 'landscape';

/** Uno al cargar la página y uno cada vez que cambia el tamaño u orientación. */
export interface ViewportEvent {
  kind: 'taptana';
  type: 'viewport';
  t: number;
  width: number;
  height: number;
  orientation: Orientation;
}

/**
 * Uno cada vez que cambia la pantalla que el participante tiene delante: al cargar una página,
 * al cambiar la ruta de una app de una sola página, o al cambiar la pantalla visible sin que
 * cambie la URL. `from` y `to` son rutas ya enmascaradas (`maskUrl`) o ScreenIds.
 */
export interface NavigationEvent {
  kind: 'taptana';
  type: 'navigation';
  t: number;
  /** Pantalla anterior. Vacío si es la entrada. */
  from: string;
  /** Pantalla nueva. */
  to: string;
  /** Título o encabezado de la pantalla. */
  title?: string;
  /** Cómo cambió. 'screen' = pantalla virtual (misma URL). Ausente en grabaciones antiguas (= 'load'). */
  via?: 'load' | 'history' | 'hash' | 'screen';
}

/**
 * El participante empezó, cumplió, terminó o saltó una tarea de un estudio.
 * - start: tocó "Empezar tarea". Si se repite (recarga), vale el último.
 * - goal: el recorder vio cumplirse la regla. Las grabaciones antiguas no lo traen: el
 *   resultado se recalcula con los eventos de navegación y toque.
 * - done: "Listo, terminé" (o automático, con `auto: true`). En primer clic, el primer toque.
 * - skip: "No pude".
 */
export interface TaskEvent {
  kind: 'taptana';
  type: 'task';
  t: number;
  taskId: string;
  action: 'start' | 'goal' | 'done' | 'skip';
  /** `done` automático (el estudio avanza solo al cumplirse la regla). */
  auto?: boolean;
}

/** Valor de una respuesta: escala (número), sí/no, opción o texto, varias opciones, o null si la saltó. */
export type AnswerValue = number | boolean | string | string[] | null;

/** El participante respondió (o saltó) un bloque de pregunta. Si se repite, vale el último. */
export interface AnswerEvent {
  kind: 'taptana';
  type: 'answer';
  t: number;
  blockId: string;
  value: AnswerValue;
  /** Cuánto tardó en responder, desde que vio la pregunta. */
  durationMs?: number;
}

/** La sesión pertenece a un estudio. `start` se emite después del consentimiento. */
export interface StudyEvent {
  kind: 'taptana';
  type: 'study';
  t: number;
  studyId: string;
  /** Variante asignada al azar (A/B), si el estudio tiene variantes. */
  variantId?: string;
  action: 'start' | 'finish';
  /** Nombre o alias que escribió el participante, si el estudio lo pide. Solo en `start`. */
  participant?: string;
}

export type TaptanaOwnEvent =
  | TapEvent
  | SwipeEvent
  | ScrollEvent
  | ViewportEvent
  | NavigationEvent
  | TaskEvent
  | AnswerEvent
  | StudyEvent;

export type TaptanaEvent = RrwebEvent | TaptanaOwnEvent;

export type TaptanaOwnEventType = TaptanaOwnEvent['type'];

/** Tipos de evento propios que esta versión entiende. Los demás se descartan al validar un lote. */
export const OWN_EVENT_TYPES: readonly TaptanaOwnEventType[] = [
  'tap',
  'swipe',
  'scroll',
  'viewport',
  'navigation',
  'task',
  'answer',
  'study',
];

/** Umbrales de detección de gestos. Puntos de partida; se afinan con grabaciones reales. */
export const GESTURE_THRESHOLDS = {
  /** Un toque puede durar hasta 800 ms (dedos lentos, toques sostenidos) si casi no se mueve. */
  tapMaxMs: 800,
  tapMaxPx: 10,
  swipeMaxMs: 600,
  swipeMinPx: 40,
  scrollThrottleMs: 250,
  /** Ventana para decidir si un toque tuvo efecto (ver TargetInfo.interactive). */
  tapEffectMs: 350,
} as const;
