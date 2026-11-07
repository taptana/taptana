/**
 * Formato de eventos de Taptana.
 *
 * Hay dos familias:
 * - `rrweb`: lo que rrweb graba por su cuenta (foto del DOM, cambios, movimientos).
 *   Alimentan al reproductor. No los tocamos.
 * - `taptana`: resúmenes que calculamos nosotros (tap, swipe, scroll, viewport, navigation).
 *   Son los que después se listan, buscan y cuentan.
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
  /** Texto visible, máximo 40 caracteres. NUNCA se llena para inputs. */
  text?: string;
  /** Ruta CSS corta: "main > .card:nth-child(2) > button". */
  selector: string;
  /** aria-role si tiene. */
  role?: string;
}

/** Dedo baja y sube en menos de 300 ms moviéndose menos de 10 px. */
export interface TapEvent {
  kind: 'taptana';
  type: 'tap';
  t: number;
  /** Posición en el viewport, en píxeles CSS. */
  x: number;
  y: number;
  target: TargetInfo;
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

/** Uno al cargar cada página. */
export interface NavigationEvent {
  kind: 'taptana';
  type: 'navigation';
  t: number;
  /** Path anterior. Vacío si es la entrada. */
  from: string;
  /** Path nuevo. */
  to: string;
}

/**
 * El participante empezó, terminó o saltó una tarea de un estudio.
 * El éxito por regla no es un evento: lo calcula el servidor al leer la sesión.
 */
export interface TaskEvent {
  kind: 'taptana';
  type: 'task';
  t: number;
  taskId: string;
  action: 'start' | 'done' | 'skip';
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
}

export type TaptanaOwnEvent =
  | TapEvent
  | SwipeEvent
  | ScrollEvent
  | ViewportEvent
  | NavigationEvent
  | TaskEvent
  | StudyEvent;

export type TaptanaEvent = RrwebEvent | TaptanaOwnEvent;

export type TaptanaOwnEventType = TaptanaOwnEvent['type'];

/** Umbrales de detección de gestos. Puntos de partida; se afinan con grabaciones reales. */
export const GESTURE_THRESHOLDS = {
  tapMaxMs: 300,
  tapMaxPx: 10,
  swipeMaxMs: 600,
  swipeMinPx: 40,
  scrollThrottleMs: 250,
} as const;
