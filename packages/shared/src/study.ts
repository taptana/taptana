/**
 * Estudio v2: una lista de bloques (contexto, tarea, primer clic y preguntas), con bienvenida,
 * consentimiento, despedida y variantes opcionales (A/B).
 *
 * El formato anterior (v1: solo `tasks`) se sigue aceptando al importar y al leer lo guardado:
 * `validateStudy` y `normalizeStudy` (en validate.ts) siempre devuelven v2. Fuera de `shared`
 * nadie lee `study.tasks`.
 *
 * Ver docs/plan-v1.md, sección 1.1.
 */

import type { AnswerValue } from './events.js';

export type SuccessRule =
  /** Llegó a esta pantalla (un ScreenId, ver screen.ts). */
  | { type: 'reached'; path: string }
  /** Tocó este elemento. */
  | { type: 'tapped'; selector: string }
  /** Aparece un elemento y/o un texto (al menos uno). Solo lo puede ver el recorder. */
  | { type: 'visible'; selector?: string; text?: string }
  /** Lo decide el moderador. */
  | { type: 'manual' };

/** `task` es la tarea normal. `first-click` termina en el primer toque. */
export type TaskKind = 'task' | 'first-click';
export type QuestionKind = 'scale' | 'choice' | 'yesno' | 'text';
export type BlockKind = TaskKind | QuestionKind | 'context';

export const TASK_KINDS: readonly TaskKind[] = ['task', 'first-click'];
export const QUESTION_KINDS: readonly QuestionKind[] = ['scale', 'choice', 'yesno', 'text'];
export const BLOCK_KINDS: readonly BlockKind[] = ['context', ...TASK_KINDS, ...QUESTION_KINDS];
/** Tamaños de escala permitidos (de 1 a max). */
export const SCALE_SIZES = [5, 7, 10] as const;

export interface TaskBlock {
  id: string;
  /** Por defecto 'task'. */
  kind?: TaskKind;
  /** Para el panel: "Comprar el producto rojo". */
  title: string;
  /** Lo que lee el participante, en sus palabras. */
  instruction: string;
  /**
   * ScreenId por URL donde empieza ("/index.html", "/index.html#/cart"). No aplica a pantallas
   * virtuales. Si falta, empieza donde esté.
   */
  startPath?: string;
  success: SuccessRule;
  /**
   * Camino esperado: ScreenIds en orden. Quien lo sigue exacto y lo logra es "éxito directo";
   * quien lo logra por otro lado, "indirecto". Si falta, se usa el camino más corto de quienes
   * lo lograron.
   */
  expectedPath?: string[];
}

interface QuestionBase {
  id: string;
  /** Lo que lee el participante. */
  question: string;
  /** Aclaración opcional debajo de la pregunta. */
  description?: string;
  /** true: no se puede saltar. */
  required?: boolean;
}

/** Escala de 1 a `max`, con etiquetas opcionales en los extremos. */
export interface ScaleBlock extends QuestionBase {
  kind: 'scale';
  max: 5 | 7 | 10;
  minLabel?: string;
  maxLabel?: string;
}

/** Opción múltiple: una respuesta, o varias si `multiple`. */
export interface ChoiceBlock extends QuestionBase {
  kind: 'choice';
  options: string[];
  multiple?: boolean;
}

export interface YesNoBlock extends QuestionBase {
  kind: 'yesno';
}

/** Pregunta abierta. */
export interface TextBlock extends QuestionBase {
  kind: 'text';
  placeholder?: string;
}

/** Texto para leer entre bloques ("Ahora imagina que…"). No pide nada. */
export interface ContextBlock {
  id: string;
  kind: 'context';
  title: string;
  text: string;
}

export type QuestionBlock = ScaleBlock | ChoiceBlock | YesNoBlock | TextBlock;
export type Block = TaskBlock | QuestionBlock | ContextBlock;
/** Alias de compatibilidad: una tarea es un bloque de tarea. */
export type Task = TaskBlock;

/** Variante de un estudio A/B. Los bloques son los mismos; cambia dónde empieza. */
export interface StudyVariant {
  id: string;
  name: string;
  startPath?: string;
  /** Otro prototipo, cuando haya varios (modo servidor). */
  prototypeId?: string;
}

export interface StudySettings {
  /** 'auto' (por defecto): al cumplirse la regla, la tarea termina sola. 'manual': espera "Listo". */
  advance?: 'auto' | 'manual';
  /** Pedir nombre o alias (opcional para el participante) en la bienvenida. */
  askName?: boolean;
}

/** El archivo de estudio: lo que una IA o una persona escribe, y lo que se importa. */
export interface Study {
  v: 2;
  name: string;
  description?: string;
  prototypeId: string;
  /** Texto que ve el participante al empezar. */
  welcome?: string;
  /** Texto de la casilla de consentimiento. Si falta, DEFAULT_CONSENT_TEXT. */
  consent?: string;
  /** Texto de la pantalla final. Si falta, DEFAULT_THANKS_TEXT. */
  thanks?: string;
  blocks: Block[];
  variants?: StudyVariant[];
  settings?: StudySettings;
  /** true: ya no recibe respuestas. */
  closed?: boolean;
}

/** Un estudio guardado en el servidor. */
export interface StudyRecord extends Study {
  id: string;
  createdAt: number;
  updatedAt: number;
}

/** Formato anterior (v0.3): solo tareas. Se acepta al importar y al leer lo ya guardado. */
export interface StudyV1 {
  v: 1;
  name: string;
  description?: string;
  prototypeId: string;
  welcome?: string;
  consent?: string;
  tasks: TaskBlock[];
  variants?: StudyVariant[];
}

/**
 * Estado final de una tarea en una sesión:
 * - success: la regla se cumplió o el moderador lo marcó.
 * - reported: tocó "Listo" pero la regla no se cumplió. En una tarea manual sin marcar, esto
 *   es "por revisar" (ver `needsReview`).
 * - failed: tocó "No pude", falló el primer clic, o el moderador lo marcó como fallo.
 * - incomplete: la sesión terminó sin cerrar la tarea.
 * - pending: la tarea nunca empezó.
 */
export type TaskOutcome = 'success' | 'reported' | 'failed' | 'incomplete' | 'pending';

/** Un toque resumido, para mostrar "tocó aquí" sin cargar el evento completo. */
export interface TapSummary {
  t: number;
  x: number;
  y: number;
  selector: string;
  text?: string;
}

export interface TaskResult {
  taskId: string;
  outcome: TaskOutcome;
  /** El último "Empezar tarea" (si la tarea se reinició, vale el último). */
  startedAt?: number;
  /** "Listo" / "No pude"; en primer clic, el primer toque. */
  endedAt?: number;
  /** Desde que empezó hasta que se cumplió la regla; si no se cumplió, hasta que la cerró. */
  durationMs?: number;
  /** La regla automática se cumplió dentro de la tarea. */
  ruleMatched: boolean;
  /** Cuándo se cumplió la regla. */
  goalAt?: number;
  /** Lo que el participante dijo. Si la regla se cumplió y luego tocó "No pude", queda 'skip'. */
  reported: 'done' | 'skip' | null;
  /** Lo que el moderador marcó. */
  manual: 'success' | 'failure' | null;
  /** Primer toque dentro de la tarea (primer clic, mapas de calor). */
  firstTap?: TapSummary;
  /** El toque que cumplió una regla `tapped`. Puede no ser el primero. */
  goalTap?: TapSummary;
}

/** Respuesta de una sesión a un bloque de pregunta. `value: null` = la saltó. */
export interface AnswerResult {
  blockId: string;
  value: AnswerValue;
  t: number;
  durationMs?: number;
}

/** Marcas manuales del moderador por tarea, guardadas en la sesión. */
export type ManualResults = Record<string, 'success' | 'failure'>;
/** Cambio a las marcas manuales: `null` quita la marca de esa tarea (vuelve a "por revisar"). */
export type ManualPatch = Record<string, 'success' | 'failure' | null>;

/** Aplica un cambio de marcas sobre las que ya había: las nuevas reemplazan, `null` borra. */
export function applyManualPatch(current: ManualResults | undefined, patch: ManualPatch | undefined): ManualResults {
  const out: ManualResults = { ...(current ?? {}) };
  for (const [taskId, mark] of Object.entries(patch ?? {})) {
    if (mark === 'success' || mark === 'failure') out[taskId] = mark;
    else delete out[taskId];
  }
  return out;
}

export const DEFAULT_CONSENT_TEXT =
  'Acepto que esta sesión se grabe (pantalla, toques y navegación) para mejorar este prototipo. Lo que escriba dentro del prototipo no se guarda; mis respuestas a las preguntas del estudio sí.';

export const DEFAULT_THANKS_TEXT = 'Eso era todo. Puedes cerrar esta página.';

/** Topes del formato. El constructor los usa como `maxLength`; `validateStudy` los exige. */
export const STUDY_LIMITS = {
  /** Nombre del estudio y título de un bloque. */
  name: 120,
  instruction: 600,
  question: 300,
  option: 120,
  /** Etiquetas de los extremos de una escala y texto de ayuda de una pregunta abierta. */
  label: 80,
  /** Bienvenida, consentimiento, despedida, descripción y texto de un bloque de contexto. */
  text: 2000,
  minOptions: 2,
  maxOptions: 12,
  maxBlocks: 100,
  /** Largo máximo de un id de bloque o de variante. */
  id: 60,
  /** Largo máximo de una respuesta abierta del participante (`maxLength` del campo en el recorder). */
  answer: 2000,
} as const;

/** Nombre de cada tipo de bloque, para que el panel y el reporte digan lo mismo. */
export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  context: 'Contexto',
  task: 'Tarea',
  'first-click': 'Primer clic',
  scale: 'Escala',
  choice: 'Opción múltiple',
  yesno: 'Sí o no',
  text: 'Pregunta abierta',
};

/** Tipo del bloque, con el valor por defecto aplicado ('task'). */
export function blockKind(block: Block): BlockKind {
  return block.kind ?? 'task';
}

export function isTaskBlock(block: Block): block is TaskBlock {
  const kind = block.kind ?? 'task';
  return kind === 'task' || kind === 'first-click';
}

export function isQuestionBlock(block: Block): block is QuestionBlock {
  return block.kind === 'scale' || block.kind === 'choice' || block.kind === 'yesno' || block.kind === 'text';
}

export function isContextBlock(block: Block): block is ContextBlock {
  return block.kind === 'context';
}

/**
 * Los bloques del estudio. Tolera en ejecución un registro antiguo sin normalizar
 * (`tasks` en vez de `blocks`), para que un dato viejo nunca rompa un cálculo.
 */
export function studyBlocks(study: { blocks?: Block[] }): Block[] {
  const list: unknown = Array.isArray(study.blocks) ? study.blocks : (study as { tasks?: unknown }).tasks;
  if (!Array.isArray(list)) return [];
  return list.every(isBlockLike) ? (list as Block[]) : list.filter(isBlockLike);
}

/** Lo mínimo para tratar algo como bloque: un objeto con id. */
function isBlockLike(value: unknown): value is Block {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string';
}

/** Solo los bloques de tarea y primer clic, en orden. */
export function taskBlocks(study: { blocks?: Block[] }): TaskBlock[] {
  return studyBlocks(study).filter(isTaskBlock);
}

/** Solo los bloques de pregunta, en orden. */
export function questionBlocks(study: { blocks?: Block[] }): QuestionBlock[] {
  return studyBlocks(study).filter(isQuestionBlock);
}

/** Texto corto para nombrar el bloque en listas y reportes. */
export function blockTitle(block: Block): string {
  if (isQuestionBlock(block)) return block.question || '';
  if (isContextBlock(block)) return block.title || block.text || '';
  return block.title || block.instruction || '';
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Id para un bloque nuevo: "b_" + 6 caracteres al azar. Los ids no se reutilizan nunca: un
 * bloque borrado no le deja sus resultados al siguiente. Pasa los ids ya usados para descartar
 * una coincidencia.
 */
export function newBlockId(taken?: Iterable<string>): string {
  const used = new Set(taken ?? []);
  for (;;) {
    let id = 'b_';
    for (let i = 0; i < 6; i++) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    if (!used.has(id)) return id;
  }
}

/**
 * Copia de un estudio para seguir editándolo sin tocar el original: se llama "Copia de …", sus
 * bloques reciben ids nuevos (así los resultados del original no se le acreditan) y vuelve a
 * recibir respuestas. No trae `id` ni fechas: eso lo pone quien la guarda.
 */
export function duplicateStudy(study: Study): Study {
  const taken = new Set(studyBlocks(study).map((b) => b.id));
  const blocks = studyBlocks(study).map((block): Block => {
    const id = newBlockId(taken);
    taken.add(id);
    return { ...block, id };
  });
  const copy: Study = {
    v: 2,
    name: `Copia de ${study.name}`.slice(0, STUDY_LIMITS.name),
    prototypeId: study.prototypeId,
    blocks,
  };
  if (study.description) copy.description = study.description;
  if (study.welcome) copy.welcome = study.welcome;
  if (study.consent) copy.consent = study.consent;
  if (study.thanks) copy.thanks = study.thanks;
  if (study.variants && study.variants.length > 0) copy.variants = study.variants.map((v) => ({ ...v }));
  if (study.settings) copy.settings = { ...study.settings };
  return copy;
}
