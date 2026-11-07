/**
 * Reporte de un estudio, al estilo Maze: junta todas las sesiones y calcula, por tarea,
 * éxito directo e indirecto, tiempos, misclicks, embudo, caminos y toques por pantalla.
 * Función pura: la usan el servidor y el panel de la demo.
 */

import type { SessionSummary } from './session.js';
import type { StudyRecord, Task, TaskResult } from './study.js';
import type { TapEvent, TaptanaEvent } from './events.js';
import { computeTaskResults } from './results.js';

export interface ReportSession {
  session: SessionSummary;
  events: TaptanaEvent[];
}

export interface HeatPoint {
  /** Posición en la página completa, en píxeles CSS del dispositivo del participante. */
  x: number;
  y: number;
  /** Ancho de pantalla del participante, para escalar. */
  vw: number;
  misclick: boolean;
  sessionId: string;
}

export interface ScreenReport {
  /** Ruta sin query: "/producto.html". */
  path: string;
  /** Participantes que pasaron por esta pantalla durante la tarea. */
  visitors: number;
  /** Tiempo promedio en la pantalla, en ms. */
  avgTimeMs: number;
  taps: HeatPoint[];
  misclicks: number;
  /** Ancho de pantalla más común, para dibujar el mapa de calor. */
  viewportWidth: number;
}

export interface PathReport {
  pages: string[];
  count: number;
  successes: number;
}

export interface TaskOutcomeCounts {
  direct: number;
  indirect: number;
  /** Tocó "Listo" pero la regla no se cumplió. */
  reported: number;
  failed: number;
  incomplete: number;
}

export interface TaskReport {
  taskId: string;
  title: string;
  kind: 'task' | 'first-click';
  /** Participantes que empezaron la tarea. */
  participants: number;
  outcomes: TaskOutcomeCounts;
  successRate: number;
  directRate: number;
  medianTimeMs: number | null;
  /** Misclicks por participante, promedio. */
  avgMisclicks: number;
  /** Misclicks sobre el total de toques, 0 a 1. */
  misclickRate: number;
  expectedPath: string[];
  /** true si el camino esperado se dedujo de quienes lo lograron. */
  expectedPathInferred: boolean;
  /** Cuántos llegaron a cada paso del camino esperado, en orden. */
  funnel: Array<{ path: string; reached: number }>;
  screens: ScreenReport[];
  paths: PathReport[];
  /** Por participante, para listar y saltar al reproductor. */
  results: Array<{ sessionId: string; outcome: keyof TaskOutcomeCounts; durationMs?: number; misclicks: number; pages: string[]; variantId?: string }>;
}

export interface StudyReport {
  studyId: string;
  participants: number;
  /** Llegaron al final del estudio. */
  completed: number;
  /** Éxito promedio de todas las tareas, 0 a 1. */
  successRate: number;
  medianDurationMs: number | null;
  avgMisclickRate: number;
  tasks: TaskReport[];
  variants: Array<{ id: string; name: string; participants: number; successRate: number; directRate: number; medianTimeMs: number | null }>;
}

export function screenPath(path: string): string {
  const p = (path.split('?')[0] ?? '/').split('#')[0] ?? '/';
  if (p === '' || p === '/') return '/index.html';
  return p.replace(/\/$/, '/index.html');
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

const isTap = (e: TaptanaEvent): e is TapEvent => e.kind === 'taptana' && e.type === 'tap';
const isMisclick = (t: TapEvent): boolean => t.target.interactive === false;

/** ¿`seq` contiene a `want` en orden (no necesariamente seguido)? Devuelve cuántos pasos cubre. */
function stepsReached(seq: string[], want: string[]): number {
  let i = 0;
  for (const p of seq) if (i < want.length && p === want[i]) i++;
  return i;
}

interface Segment {
  session: SessionSummary;
  result: TaskResult;
  pages: string[];
  taps: TapEvent[];
  /** Tiempo por pantalla dentro de la tarea. */
  time: Map<string, number>;
  viewportWidth: number;
}

function segmentFor(rs: ReportSession, result: TaskResult, task: Task): Segment | null {
  if (result.startedAt === undefined) return null;
  const from = result.startedAt;
  const to = result.endedAt ?? rs.session.lastSeenAt;
  const navs = rs.events.filter((e): e is Extract<TaptanaEvent, { type: 'navigation' }> => e.kind === 'taptana' && e.type === 'navigation');
  const before = [...navs].reverse().find((n) => n.t <= from);
  // Pantallas en orden: donde estaba al empezar + las que abrió durante la tarea.
  const visits: Array<{ path: string; t: number }> = [];
  if (before) visits.push({ path: screenPath(before.to), t: from });
  for (const n of navs) if (n.t > from && n.t <= to) visits.push({ path: screenPath(n.to), t: n.t });
  // Si la tarea empieza en una pantalla concreta, lo que vino antes es el salto automático: no cuenta.
  if (task.startPath) {
    const start = screenPath(task.startPath);
    const i = visits.findIndex((v) => v.path === start);
    if (i > 0) visits.splice(0, i);
  }
  const pages: string[] = [];
  const time = new Map<string, number>();
  visits.forEach((v, i) => {
    if (pages[pages.length - 1] !== v.path) pages.push(v.path);
    const end = visits[i + 1]?.t ?? to;
    time.set(v.path, (time.get(v.path) ?? 0) + Math.max(0, end - v.t));
  });
  const taps = rs.events.filter(isTap).filter((t) => t.t > from && t.t <= to);
  return { session: rs.session, result, pages, taps, time, viewportWidth: rs.session.viewport.width || 390 };
}

/** Pantalla en la que estaba el participante en el instante t. */
function screenAt(rs: ReportSession, t: number): string {
  let path = '/index.html';
  for (const e of rs.events) {
    if (e.t > t) break;
    if (e.kind === 'taptana' && e.type === 'navigation') path = screenPath(e.to);
  }
  return path;
}

function taskReport(task: Task, segments: Segment[], allSessions: Map<string, ReportSession>): TaskReport {
  const succeeded = segments.filter((s) => s.result.outcome === 'success');
  let expectedPath = (task.expectedPath ?? []).map(screenPath);
  const inferred = expectedPath.length === 0;
  if (inferred && succeeded.length) {
    // El camino más corto entre quienes lo lograron; si empatan, el más común.
    const counts = new Map<string, number>();
    for (const s of succeeded) counts.set(s.pages.join('>'), (counts.get(s.pages.join('>')) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => a[0].split('>').length - b[0].split('>').length || b[1] - a[1])[0];
    expectedPath = best ? best[0].split('>') : [];
  }

  const outcomes: TaskOutcomeCounts = { direct: 0, indirect: 0, reported: 0, failed: 0, incomplete: 0 };
  const results: TaskReport['results'] = [];
  const screens = new Map<string, ScreenReport & { widths: number[]; times: number[] }>();
  let misclicks = 0;
  let taps = 0;

  for (const s of segments) {
    let outcome: keyof TaskOutcomeCounts;
    if (s.result.outcome === 'success') {
      outcome = expectedPath.length && s.pages.join('>') === expectedPath.join('>') ? 'direct' : 'indirect';
      // first click: si acertó, es directo.
      if ((task.kind ?? 'task') === 'first-click') outcome = 'direct';
    } else if (s.result.outcome === 'reported') {
      // En first click, tocar en otro lado es fallar, no "decir que terminó".
      outcome = (task.kind ?? 'task') === 'first-click' ? 'failed' : 'reported';
    }
    else if (s.result.outcome === 'failed') outcome = 'failed';
    else outcome = 'incomplete';
    outcomes[outcome]++;

    const miss = s.taps.filter(isMisclick).length;
    misclicks += miss;
    taps += s.taps.length;
    const r: TaskReport['results'][number] = { sessionId: s.session.id, outcome, misclicks: miss, pages: s.pages };
    if (s.result.durationMs !== undefined) r.durationMs = s.result.durationMs;
    if (s.session.variantId) r.variantId = s.session.variantId;
    results.push(r);

    for (const path of new Set(s.pages)) {
      const sc = screens.get(path) ?? { path, visitors: 0, avgTimeMs: 0, taps: [], misclicks: 0, viewportWidth: 0, widths: [], times: [] };
      sc.visitors++;
      sc.times.push(s.time.get(path) ?? 0);
      sc.widths.push(s.viewportWidth);
      screens.set(path, sc);
    }
    const rs = allSessions.get(s.session.id)!;
    for (const t of s.taps) {
      const path = screenAt(rs, t.t);
      const sc = screens.get(path) ?? { path, visitors: 1, avgTimeMs: 0, taps: [], misclicks: 0, viewportWidth: 0, widths: [s.viewportWidth], times: [] };
      sc.taps.push({ x: t.pageX ?? t.x, y: t.pageY ?? t.y, vw: s.viewportWidth, misclick: isMisclick(t), sessionId: s.session.id });
      if (isMisclick(t)) sc.misclicks++;
      screens.set(path, sc);
    }
  }

  const pathCounts = new Map<string, PathReport>();
  for (const s of segments) {
    const key = s.pages.join('>');
    const p = pathCounts.get(key) ?? { pages: s.pages, count: 0, successes: 0 };
    p.count++;
    if (s.result.outcome === 'success') p.successes++;
    pathCounts.set(key, p);
  }

  const n = segments.length;
  const success = outcomes.direct + outcomes.indirect;
  const order = (p: string): number => {
    const i = expectedPath.indexOf(p);
    return i === -1 ? 1000 : i;
  };
  return {
    taskId: task.id,
    title: task.title || task.instruction,
    kind: task.kind ?? 'task',
    participants: n,
    outcomes,
    successRate: n ? success / n : 0,
    directRate: n ? outcomes.direct / n : 0,
    medianTimeMs: median(segments.map((s) => s.result.durationMs).filter((d): d is number => d !== undefined)),
    avgMisclicks: n ? misclicks / n : 0,
    misclickRate: taps ? misclicks / taps : 0,
    expectedPath,
    expectedPathInferred: inferred,
    funnel: expectedPath.map((path, i) => ({ path, reached: segments.filter((s) => stepsReached(s.pages, expectedPath) > i).length })),
    screens: [...screens.values()]
      .map(({ widths, times, ...sc }) => ({
        ...sc,
        avgTimeMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
        viewportWidth: median(widths) ?? 390,
      }))
      .sort((a, b) => order(a.path) - order(b.path) || b.visitors - a.visitors),
    paths: [...pathCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    results,
  };
}

export function computeStudyReport(study: StudyRecord, sessions: ReportSession[]): StudyReport {
  const mine = sessions.filter((s) => s.session.studyId === study.id);
  const byId = new Map(mine.map((s) => [s.session.id, s]));
  const withResults = mine.map((s) => ({
    rs: s,
    results: s.session.tasks ?? computeTaskResults(study, s.events, {}, s.session.lastSeenAt),
  }));

  const tasks = study.tasks.map((task) => {
    const segments = withResults
      .map(({ rs, results }) => {
        const r = results.find((x) => x.taskId === task.id);
        return r ? segmentFor(rs, r, task) : null;
      })
      .filter((s): s is Segment => s !== null);
    return taskReport(task, segments, byId);
  });

  const completed = mine.filter((s) => s.events.some((e) => e.kind === 'taptana' && e.type === 'study' && e.action === 'finish')).length;
  const rates = tasks.filter((t) => t.participants > 0);
  const variants = (study.variants ?? []).map((v) => {
    const ids = new Set(mine.filter((s) => s.session.variantId === v.id).map((s) => s.session.id));
    const rows = tasks.flatMap((t) => t.results.filter((r) => ids.has(r.sessionId)));
    const ok = rows.filter((r) => r.outcome === 'direct' || r.outcome === 'indirect').length;
    return {
      id: v.id,
      name: v.name,
      participants: ids.size,
      successRate: rows.length ? ok / rows.length : 0,
      directRate: rows.length ? rows.filter((r) => r.outcome === 'direct').length / rows.length : 0,
      medianTimeMs: median(rows.map((r) => r.durationMs).filter((d): d is number => d !== undefined)),
    };
  });

  return {
    studyId: study.id,
    participants: mine.length,
    completed,
    successRate: rates.length ? rates.reduce((a, t) => a + t.successRate, 0) / rates.length : 0,
    medianDurationMs: median(mine.map((s) => s.session.durationMs)),
    avgMisclickRate: rates.length ? rates.reduce((a, t) => a + t.misclickRate, 0) / rates.length : 0,
    tasks,
    variants,
  };
}
