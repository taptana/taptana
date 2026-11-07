/**
 * Calcula el resultado de cada tarea de un estudio a partir de los eventos de una sesión.
 * Función pura: fácil de probar y de reutilizar en el panel.
 */

import type { ManualResults, Study, TapEvent, TaptanaEvent, Task, TaskResult } from '@taptana/shared';

/**
 * ¿El toque cae en lo que pide la regla? Acepta selectores simples:
 *   "#agregar"            por id
 *   ".cart-link"          por clase
 *   "button.btn-primary"  tag + clase
 *   "a"                   por tag
 *   "body > header > a"   la ruta exacta que grabó el recorder
 */
export function tapMatches(tap: TapEvent, selector: string): boolean {
  const s = selector.trim();
  if (!s) return false;
  const { id, classes = [], selector: recorded, tag } = tap.target;
  if (recorded === s) return true;
  const last = recorded.split('>').pop()?.trim() ?? '';
  if (last === s) return true;

  // Selector simple: tag opcional, luego #id y/o .clases
  const m = s.match(/^([a-z][a-z0-9-]*)?((?:[#.][\w-]+)+)?$/i);
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

function ruleMatchedIn(task: Task, events: TaptanaEvent[], from: number, to: number): { matched: boolean; at?: number } {
  const rule = task.success;
  if (rule.type === 'manual') return { matched: false };
  for (const e of events) {
    if (e.kind !== 'taptana' || e.t < from || e.t > to) continue;
    if (rule.type === 'reached' && e.type === 'navigation' && samePath(e.to, rule.path)) return { matched: true, at: e.t };
    if (rule.type === 'tapped' && e.type === 'tap' && tapMatches(e, rule.selector)) return { matched: true, at: e.t };
  }
  return { matched: false };
}

/** Compara rutas ignorando query y barra final: "/gracias.html?x=1" ≈ "/gracias.html". */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const noQuery = p.split('?')[0] ?? '';
    const noSlash = noQuery.replace(/\/+$/, '') || '/';
    return noSlash.replace(/\/index\.html$/, '') || '/';
  };
  return norm(a) === norm(b);
}

export function computeTaskResults(
  study: Study,
  events: TaptanaEvent[],
  manual: ManualResults = {},
  sessionEnd?: number,
): TaskResult[] {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const end = sessionEnd ?? sorted[sorted.length - 1]?.t ?? 0;
  const taskEvents = sorted.filter((e): e is Extract<TaptanaEvent, { type: 'task' }> => e.kind === 'taptana' && e.type === 'task');

  return study.tasks.map((task): TaskResult => {
    const start = taskEvents.find((e) => e.taskId === task.id && e.action === 'start');
    const base: TaskResult = {
      taskId: task.id,
      outcome: 'pending',
      ruleMatched: false,
      reported: null,
      manual: manual[task.id] ?? null,
    };
    if (!start) {
      if (base.manual) base.outcome = base.manual === 'success' ? 'success' : 'failed';
      return base;
    }

    const close = taskEvents.find((e) => e.taskId === task.id && e.t >= start.t && (e.action === 'done' || e.action === 'skip'));
    const nextStart = taskEvents.find((e) => e.action === 'start' && e.t > start.t && e.taskId !== task.id);
    let endedAt = close?.t ?? nextStart?.t ?? end;
    let reported: TaskResult['reported'] = close && close.action !== 'start' ? close.action : null;

    const firstTap = sorted.find((e): e is TapEvent => e.kind === 'taptana' && e.type === 'tap' && e.t > start.t && e.t <= endedAt);

    if ((task.kind ?? 'task') === 'first-click') {
      // La tarea termina en el primer toque.
      if (firstTap) {
        endedAt = firstTap.t;
        reported = reported ?? 'done';
      }
    }

    const rule = ruleMatchedIn(task, sorted, start.t, endedAt);
    const result: TaskResult = {
      ...base,
      startedAt: start.t,
      endedAt,
      durationMs: Math.max(0, (rule.at && rule.at < endedAt ? rule.at : endedAt) - start.t),
      ruleMatched: rule.matched,
      reported,
    };
    if (firstTap) {
      result.firstTap = { t: firstTap.t, x: firstTap.x, y: firstTap.y, selector: firstTap.target.selector };
      if (firstTap.target.text) result.firstTap.text = firstTap.target.text;
    }

    if (result.manual === 'success') result.outcome = 'success';
    else if (result.manual === 'failure') result.outcome = 'failed';
    else if (rule.matched) result.outcome = 'success';
    else if (reported === 'skip') result.outcome = 'failed';
    else if (reported === 'done') result.outcome = 'reported';
    else result.outcome = 'incomplete';
    return result;
  });
}
