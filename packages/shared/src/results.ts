/**
 * Calcula, a partir de los eventos de una sesión, el resultado de cada tarea de un estudio y
 * las respuestas a sus preguntas. Funciones puras: las usan el servidor y el panel de la demo.
 *
 * Definiciones (docs/plan-v1.md, 1.4):
 * - Tiempo de una tarea: desde "Empezar tarea" hasta que se cumple la regla, o hasta "Listo" /
 *   "No pude" si no se cumplió. Si la tarea se reinicia (recarga), vale el último inicio.
 * - Éxito: se cumplió la regla o el moderador lo marcó. Si se cumplió y luego tocó "No pude",
 *   sigue siendo éxito (queda anotado en `reported`).
 * - Primer clic: termina en el primer toque; acierta si ese toque cumple `tapped`, o si lleva a
 *   la pantalla `reached` en los 2 s siguientes. Tocar en otro lado es "no pudo".
 */

import type {
  AnswerEvent,
  NavigationEvent,
  StudyEvent,
  TapEvent,
  TaptanaEvent,
  TaptanaOwnEvent,
  TaskEvent,
} from './events.js';
import { sameScreen } from './screen.js';
import {
  isTaskBlock,
  questionBlocks,
  taskBlocks,
  type AnswerResult,
  type Block,
  type ManualResults,
  type Study,
  type SuccessRule,
  type TapSummary,
  type TaskBlock,
  type TaskResult,
} from './study.js';

/** En primer clic con regla `reached`: cuánto puede tardar en llegar la pantalla tras el toque. */
export const FIRST_CLICK_REACH_MS = 2000;

/**
 * Holgura entre la hora de un toque y la del `goal` que provoca: el recorder evalúa la regla en
 * cuanto ve el toque, pero el evento `tap` puede llevar una hora unos milisegundos posterior.
 */
const GOAL_SLACK_MS = 400;

const isTap = (e: TaptanaOwnEvent): e is TapEvent =>
  e.type === 'tap' && typeof e.target === 'object' && e.target !== null && typeof e.target.selector === 'string';
const isNavigation = (e: TaptanaOwnEvent): e is NavigationEvent => e.type === 'navigation' && typeof e.to === 'string';
const isTaskEvent = (e: TaptanaOwnEvent): e is TaskEvent => e.type === 'task';
const isAnswer = (e: TaptanaOwnEvent): e is AnswerEvent => e.type === 'answer';

/** Los eventos propios (sin los de rrweb), en orden de tiempo. No modifica la lista original. */
export function ownEvents(events: readonly TaptanaEvent[]): TaptanaOwnEvent[] {
  return events.filter(isOwnEvent).sort((a, b) => a.t - b.t);
}

/** ¿Es un evento propio con hora? Tolera basura en la lista (datos guardados rotos). */
export function isOwnEvent(e: TaptanaEvent | null | undefined): e is TaptanaOwnEvent {
  return typeof e === 'object' && e !== null && e.kind === 'taptana' && typeof e.t === 'number' && !Number.isNaN(e.t);
}

function matchesOne(tap: TapEvent, selector: string): boolean {
  const { id, classes = [], selector: recorded, tag } = tap.target;
  if (recorded === selector) return true;
  // La ruta grabada va de afuera hacia adentro: si el selector es uno de sus tramos, el toque
  // cayó en ese elemento o dentro de él.
  const segments = recorded.split('>').map((p) => p.trim());
  if (segments.includes(selector)) return true;

  // Selector simple: tag opcional, luego #id y/o .clases
  const m = selector.match(/^([a-z][a-z0-9-]*)?((?:[#.][\w-]+)+)?$/i);
  if (!m) return false;
  const [, wantTag, parts = ''] = m;
  if (wantTag && wantTag.toLowerCase() !== tag) return false;
  if (!wantTag && !parts) return false;
  for (const part of parts.match(/[#.][\w-]+/g) ?? []) {
    if (part.startsWith('#') && id !== part.slice(1)) return false;
    if (part.startsWith('.') && !classes.includes(part.slice(1))) return false;
  }
  return true;
}

/**
 * ¿El toque cae en lo que pide la regla? Trabaja solo con lo que guarda el evento, así que
 * acepta selectores simples (varios separados por coma):
 *   "#agregar"            por id (también si el toque cayó dentro de ese elemento)
 *   ".cart-link"          por clase
 *   "button.btn-primary"  tag + clase
 *   "a"                   por tag
 *   "body > header > a"   la ruta exacta que grabó el recorder
 * El recorder, que tiene el DOM delante, evalúa cualquier selector y emite `goal`.
 */
export function tapMatches(tap: TapEvent, selector: string): boolean {
  if (typeof selector !== 'string') return false;
  return selector
    .split(',')
    .map((s) => s.trim())
    .some((s) => s !== '' && matchesOne(tap, s));
}

function summarize(tap: TapEvent): TapSummary {
  const out: TapSummary = { t: tap.t, x: tap.x, y: tap.y, selector: tap.target.selector };
  if (tap.target.text) out.text = tap.target.text;
  return out;
}

interface Timeline {
  taskEvents: TaskEvent[];
  taps: TapEvent[];
  navs: NavigationEvent[];
  /** Señales de que el estudio ya pasó a otro bloque: otro inicio, una respuesta o el final. */
  boundaries: Array<TaskEvent | AnswerEvent | StudyEvent>;
  end: number;
}

function taskResult(task: TaskBlock, tl: Timeline, mark: 'success' | 'failure' | null): TaskResult {
  const base: TaskResult = { taskId: task.id, outcome: 'pending', ruleMatched: false, reported: null, manual: mark };
  const mine = tl.taskEvents.filter((e) => e.taskId === task.id);
  const starts = mine.filter((e) => e.action === 'start');
  const closes = mine.filter((e) => e.action === 'done' || e.action === 'skip');

  // Vale el último inicio. Si la tarea ya se cerró, el último inicio anterior a ese cierre.
  const lastClose = closes[closes.length - 1];
  const start =
    (lastClose ? [...starts].reverse().find((e) => e.t <= lastClose.t) : undefined) ?? starts[starts.length - 1];
  if (!start) {
    if (mark) base.outcome = mark === 'success' ? 'success' : 'failed';
    return base;
  }

  const isOther = (e: TaskEvent | AnswerEvent | StudyEvent): boolean => !(e.type === 'task' && e.taskId === task.id);
  const close = closes.find((e) => e.t >= start.t);
  const next = tl.boundaries.find((e) => e.t > start.t && isOther(e));
  let endedAt = close?.t ?? next?.t ?? Math.max(tl.end, start.t);
  let reported: TaskResult['reported'] = close ? (close.action === 'skip' ? 'skip' : 'done') : null;

  const firstClick = (task.kind ?? 'task') === 'first-click';
  // Un registro viejo o roto sin regla se trata como manual: nunca se cumple solo.
  const rule: SuccessRule = task.success ?? { type: 'manual' };
  const firstTap = tl.taps.find((e) => e.t > start.t && e.t <= endedAt);
  const goals = mine.filter((e) => e.action === 'goal' && e.t >= start.t);

  // Instantes en que la regla se dio por cumplida, según el recorder (`goal`) o recalculados.
  const reached: number[] = [];
  const reach = (t: number | undefined): void => {
    if (t !== undefined) reached.push(t);
  };
  let goalTap: TapEvent | undefined;

  if (firstClick) {
    // La tarea termina en el primer toque; lo que venga después ya no cuenta.
    if (firstTap) {
      endedAt = firstTap.t;
      reported = reported ?? 'done';
      const from = firstTap.t - GOAL_SLACK_MS;
      const until = firstTap.t + FIRST_CLICK_REACH_MS + GOAL_SLACK_MS;
      if (rule.type !== 'manual') reach(goals.find((e) => e.t >= from && e.t <= until)?.t);
      if (rule.type === 'tapped' && tapMatches(firstTap, rule.selector)) reach(firstTap.t);
      if (rule.type === 'reached') {
        // La navegación cae después del toque. No se mira más allá del siguiente bloque: el
        // salto automático a su pantalla de inicio no es mérito de este toque.
        const after = tl.boundaries.find((e) => e.t > firstTap.t && isOther(e));
        const limit = Math.min(firstTap.t + FIRST_CLICK_REACH_MS, after?.t ?? Infinity);
        reach(tl.navs.find((e) => e.t >= firstTap.t && e.t <= limit && sameScreen(e.to, rule.path))?.t);
      }
      if (reached.length) goalTap = firstTap;
    }
  } else if (rule.type !== 'manual') {
    reach(goals.find((e) => e.t <= endedAt)?.t);
    if (rule.type === 'reached') {
      reach(tl.navs.find((e) => e.t >= start.t && e.t <= endedAt && sameScreen(e.to, rule.path))?.t);
    }
    if (rule.type === 'tapped') {
      goalTap = tl.taps.find((e) => e.t > start.t && e.t <= endedAt && tapMatches(e, rule.selector));
      reach(goalTap?.t);
      const seen = reached[0];
      if (!goalTap && seen !== undefined) {
        // Solo el recorder lo vio (selector complejo): el toque que lo cumplió es el anterior al `goal`.
        goalTap = [...tl.taps].reverse().find((e) => e.t > start.t && e.t <= seen + GOAL_SLACK_MS);
      }
    }
    // `visible` solo lo puede ver el recorder: se cumple únicamente con un evento `goal`.
  }

  const goalAt = reached.length ? Math.min(...reached) : undefined;
  const stop = firstClick ? endedAt : (goalAt ?? endedAt);
  const result: TaskResult = {
    ...base,
    startedAt: start.t,
    endedAt,
    durationMs: Math.max(0, stop - start.t),
    ruleMatched: goalAt !== undefined,
    reported,
  };
  if (goalAt !== undefined) result.goalAt = goalAt;
  if (firstTap) result.firstTap = summarize(firstTap);
  if (goalTap) result.goalTap = summarize(goalTap);

  if (mark === 'success') result.outcome = 'success';
  else if (mark === 'failure') result.outcome = 'failed';
  else if (result.ruleMatched) result.outcome = 'success';
  else if (firstClick && firstTap) result.outcome = 'failed';
  else if (reported === 'skip') result.outcome = 'failed';
  else if (reported === 'done') result.outcome = 'reported';
  else result.outcome = 'incomplete';
  return result;
}

/**
 * Resultado de cada bloque de tarea (los demás bloques no producen TaskResult), en el orden
 * del estudio. Además de los eventos `goal` del recorder, recalcula `reached` y `tapped` con
 * los eventos de navegación y toque: las grabaciones antiguas no traen `goal`.
 */
export function computeTaskResults(
  study: Study,
  events: TaptanaEvent[],
  manual: ManualResults = {},
  sessionEnd?: number,
): TaskResult[] {
  const own = ownEvents(events);
  let last = 0;
  for (const e of events) if (e && e.t > last) last = e.t;
  const tl: Timeline = {
    taskEvents: own.filter(isTaskEvent),
    taps: own.filter(isTap),
    navs: own.filter(isNavigation),
    boundaries: own.filter(
      (e): e is TaskEvent | AnswerEvent | StudyEvent =>
        (e.type === 'task' && e.action === 'start') || e.type === 'answer' || (e.type === 'study' && e.action === 'finish'),
    ),
    end: sessionEnd ?? last,
  };
  return taskBlocks(study).map((task) => taskResult(task, tl, manual[task.id] ?? null));
}

/**
 * ¿Es una tarea manual que el participante dio por terminada y el moderador aún no decide?
 * Esas quedan "por revisar": no cuentan en la tasa de éxito ni en el puntaje.
 */
export function needsReview(block: Block | undefined, result: TaskResult): boolean {
  if (!block || !isTaskBlock(block)) return false;
  return (block.success?.type ?? 'manual') === 'manual' && result.outcome === 'reported' && result.manual === null;
}

/** Las marcas manuales del moderador que traen unos resultados ya calculados (`session.tasks`). */
export function manualMarks(tasks: readonly TaskResult[] | undefined): ManualResults {
  const marks: ManualResults = {};
  for (const r of Array.isArray(tasks) ? tasks : []) {
    if (r && typeof r.taskId === 'string' && (r.manual === 'success' || r.manual === 'failure')) marks[r.taskId] = r.manual;
  }
  return marks;
}

/**
 * Respuestas de una sesión a los bloques de pregunta del estudio, en el orden del estudio.
 * Si una pregunta se respondió más de una vez, vale la última. Las preguntas que la sesión no
 * llegó a ver no aparecen; las que saltó aparecen con `value: null`.
 */
export function computeAnswers(study: Study, events: TaptanaEvent[]): AnswerResult[] {
  const lastByBlock = new Map<string, AnswerEvent>();
  for (const e of ownEvents(events)) {
    if (isAnswer(e) && typeof e.blockId === 'string') lastByBlock.set(e.blockId, e);
  }
  const out: AnswerResult[] = [];
  for (const block of questionBlocks(study)) {
    const e = lastByBlock.get(block.id);
    if (!e) continue;
    const answer: AnswerResult = { blockId: block.id, value: e.value ?? null, t: e.t };
    if (typeof e.durationMs === 'number') answer.durationMs = e.durationMs;
    out.push(answer);
  }
  return out;
}

/** Alias que escribió el participante en la bienvenida (viene en el `start` del estudio). */
export function participantName(events: TaptanaEvent[]): string | undefined {
  for (const e of events) {
    if (isOwnEvent(e) && e.type === 'study' && e.action === 'start' && typeof e.participant === 'string') {
      const name = e.participant.trim();
      if (name) return name;
    }
  }
  return undefined;
}
