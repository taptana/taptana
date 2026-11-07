/**
 * Estudio: nombre, prototipo, bienvenida y consentimiento, tareas con criterio de éxito,
 * y variantes opcionales (A/B).
 *
 * Ver docs/estudios-con-ia.md y docs/constructor-de-estudios.md.
 */

export type SuccessRule =
  /** Llegó a esta página. Se verifica con los eventos `navigation`. */
  | { type: 'reached'; path: string }
  /** Tocó este elemento. Se verifica con los eventos `tap` y su `selector` o `id`. */
  | { type: 'tapped'; selector: string }
  /** Lo marca el moderador a mano. */
  | { type: 'manual' };

/**
 * Tipo de tarea. `task` es la normal. `first-click` termina en el primer toque.
 * Los demás tipos (five-seconds, preference) llegan en versiones posteriores.
 */
export type TaskKind = 'task' | 'first-click';

export interface Task {
  id: string;
  /** Por defecto 'task'. */
  kind?: TaskKind;
  /** "Comprar el producto rojo" */
  title: string;
  /** Lo que lee el participante, en sus palabras. */
  instruction: string;
  /** "/index.html". Si falta, empieza donde esté. */
  startPath?: string;
  success: SuccessRule;
}

/** Variante de un estudio A/B. Las tareas son las mismas; cambia dónde empieza. */
export interface StudyVariant {
  id: string;
  name: string;
  startPath?: string;
  /** Otro prototipo, cuando haya varios (modo servidor). */
  prototypeId?: string;
}

/** El archivo de estudio: lo que una IA o una persona escribe, y lo que se importa. */
export interface Study {
  v: 1;
  name: string;
  description?: string;
  prototypeId: string;
  /** Texto que ve el participante al empezar. */
  welcome?: string;
  /** Texto de la casilla de consentimiento. Si falta, se usa uno por defecto. */
  consent?: string;
  tasks: Task[];
  variants?: StudyVariant[];
}

/** Un estudio guardado en el servidor. */
export interface StudyRecord extends Study {
  id: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Estado final de una tarea en una sesión:
 * - success: la regla se cumplió o el moderador lo marcó.
 * - reported: tocó "Listo" pero la regla no se cumplió (o es manual y nadie la marcó).
 * - failed: tocó "No pude" o el moderador lo marcó como fallo.
 * - incomplete: la sesión terminó sin cerrar la tarea.
 * - pending: la tarea nunca empezó.
 */
export type TaskOutcome = 'success' | 'reported' | 'failed' | 'incomplete' | 'pending';

export interface TaskResult {
  taskId: string;
  outcome: TaskOutcome;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  /** La regla automática se cumplió dentro de la tarea. */
  ruleMatched: boolean;
  /** Lo que el participante dijo. */
  reported: 'done' | 'skip' | null;
  /** Lo que el moderador marcó. */
  manual: 'success' | 'failure' | null;
  /** Primer toque dentro de la tarea (first click, mapas de calor). */
  firstTap?: { t: number; x: number; y: number; selector: string; text?: string };
}

/** Marcas manuales del moderador por tarea, guardadas en la sesión. */
export type ManualResults = Record<string, 'success' | 'failure'>;

export const DEFAULT_CONSENT_TEXT =
  'Acepto que esta sesión se grabe (pantalla, toques y navegación) para mejorar este prototipo. Lo que escriba en formularios no se guarda.';
