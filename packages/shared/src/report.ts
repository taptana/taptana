/**
 * Reporte de un estudio, al estilo Maze: junta todas las sesiones y calcula, por bloque,
 * puntaje de usabilidad, éxito directo e indirecto, tiempos, misclicks, embudo, caminos, toques
 * por pantalla y respuestas a las preguntas. Funciones puras: las usan el servidor y el panel
 * de la demo.
 *
 * Definiciones (el reporte las muestra en "Cómo se calcula"; docs/plan-v1.md, 1.4):
 * - Participantes: sesiones del estudio que aceptaron grabar y no están excluidas. Cada tarea
 *   cuenta solo a quienes la empezaron.
 * - Éxito directo: lo logró siguiendo exacto el camino esperado. Sin camino esperado (ni
 *   deducible de quienes lo lograron), todo éxito es directo.
 * - Por revisar: tarea manual que el participante dio por terminada y el moderador aún no
 *   marca. No cuenta en la tasa de éxito ni en el puntaje.
 * - Misclick: toque sin efecto sobre algo no tocable. Las sesiones antiguas sin el dato no
 *   cuentan misclicks (ni en el numerador ni en el denominador).
 * - Puntaje de una tarea = 100·directo + 50·indirecto − 50·tasaMisclick − penalizaciónTiempo,
 *   con tasas de 0 a 1 sobre los intentos ya decididos y
 *   penalizaciónTiempo = clamp((segundosMedianosPorPantalla − 5) / 2, 0, 10); recortado a 0–100
 *   y redondeado. "Segundos por pantalla" de un intento = su tiempo ÷ pantallas recorridas; la
 *   mediana es de quienes lo lograron. Primer clic: 100·acierto.
 * - Puntaje del estudio: promedio de las tareas con datos decididos. `null` si no hay.
 */

import type { NavigationEvent, TapEvent, TaptanaEvent, TaptanaOwnEvent, ViewportEvent } from './events.js';
import { buildInsights } from './insights.js';
import { computeAnswers, computeTaskResults, manualMarks, ownEvents } from './results.js';
import { sameScreen, screenId } from './screen.js';
import type { SessionSummary } from './session.js';
import {
  blockKind,
  blockTitle,
  questionBlocks,
  studyBlocks,
  taskBlocks,
  type AnswerResult,
  type BlockKind,
  type ManualResults,
  type QuestionBlock,
  type QuestionKind,
  type StudyRecord,
  type StudyVariant,
  type TaskBlock,
  type TaskKind,
  type TaskResult,
} from './study.js';

export interface ReportSession {
  /**
   * El resumen de la sesión. Si trae `tasks`, de ahí se toman las marcas manuales del moderador
   * (los resultados en sí siempre se recalculan con los eventos).
   */
  session: SessionSummary;
  /** Eventos de la sesión. Bastan los propios (`kind: 'taptana'`); los de rrweb se ignoran. */
  events: TaptanaEvent[];
  /** Marcas manuales del moderador, si no vienen ya en `session.tasks`. */
  manual?: ManualResults;
}

export interface HeatPoint {
  /** Posición en la página completa, en píxeles CSS del dispositivo del participante. */
  x: number;
  y: number;
  /** Ancho de pantalla del participante al tocar, para escalar. */
  vw: number;
  misclick: boolean;
  sessionId: string;
  /** Cayó en un elemento fijo (barra inferior, botón flotante): dibujar con `vy`/`vh`, no con `y`. */
  fixed?: boolean;
  /** Posición vertical en el viewport. Solo si `fixed`. */
  vy?: number;
  /** Alto del viewport al tocar. Solo si `fixed`. */
  vh?: number;
}

export interface ScreenReport {
  /** ScreenId (ver screen.ts): "/producto.html", "/index.html#/carrito", "/index.html~checkout". */
  path: string;
  /** Título o encabezado de la pantalla, si alguna sesión lo trae. */
  title?: string;
  /** Participantes que pasaron por esta pantalla durante la tarea. */
  visitors: number;
  /** Tiempo promedio en la pantalla, en ms. */
  avgTimeMs: number;
  taps: HeatPoint[];
  misclicks: number;
  /** Ancho de pantalla más común entre quienes pasaron por aquí (el de `sample`). */
  viewportWidth: number;
  /**
   * Instante de una sesión real para dibujar el fondo del mapa de calor: lo que vio alguien con
   * el tamaño de pantalla más común. `t` está en el mismo reloj que los eventos (ms desde 1970):
   * 50 ms antes de su primer toque en la pantalla, o 800 ms después de llegar si no tocó.
   */
  sample?: { sessionId: string; t: number; vw: number };
  /** Lo más tocado sin efecto, de más a menos (hasta 5). */
  topMisclicks: Array<{ label: string; count: number }>;
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
  /** Tarea manual: tocó "Listo" y el moderador aún no decide. */
  review: number;
}

/** Resultado de un participante en una tarea, para listar y saltar al reproductor. */
export interface TaskReportRow {
  sessionId: string;
  outcome: keyof TaskOutcomeCounts;
  durationMs?: number;
  misclicks: number;
  pages: string[];
  variantId?: string;
  /** Etiqueta del moderador o alias del participante. */
  who?: string;
  /** Cuándo empezó la tarea y cuándo se cumplió la regla (reloj de los eventos). */
  startedAt?: number;
  goalAt?: number;
}

/** Los números de una tarea para una variante (A/B). */
export interface TaskVariantReport {
  variantId: string;
  participants: number;
  /** Intentos ya decididos (sin los que están por revisar). */
  decided: number;
  successRate: number;
  directRate: number;
  medianTimeMs: number | null;
  score: number | null;
}

export interface TaskReport {
  taskId: string;
  title: string;
  kind: TaskKind;
  /** Participantes que empezaron la tarea. */
  participants: number;
  /** Intentos ya decididos: `participants` menos los que están por revisar. */
  decided: number;
  outcomes: TaskOutcomeCounts;
  /** Éxito (directo + indirecto) sobre los intentos decididos, 0 a 1. */
  successRate: number;
  directRate: number;
  /** Puntaje de usabilidad, 0 a 100. `null` si no hay intentos decididos. */
  score: number | null;
  /** Tiempo mediano, solo de quienes lo lograron. */
  medianTimeMs: number | null;
  /** Misclicks por participante, promedio. */
  avgMisclicks: number;
  /** Misclicks sobre los toques con el dato, 0 a 1. */
  misclickRate: number;
  /** Toques dentro de la tarea (todos los participantes). */
  tapCount: number;
  expectedPath: string[];
  /** true si el camino esperado se dedujo de quienes lo lograron. */
  expectedPathInferred: boolean;
  /** Cuántos llegaron a cada paso del camino esperado, en orden. */
  funnel: Array<{ path: string; reached: number }>;
  screens: ScreenReport[];
  paths: PathReport[];
  results: TaskReportRow[];
  /** La misma tarea, variante por variante. Vacío si el estudio no tiene variantes. */
  byVariant: TaskVariantReport[];
}

export interface QuestionReport {
  blockId: string;
  kind: QuestionKind;
  question: string;
  /** Participantes que respondieron. */
  responses: number;
  /** Participantes que la vieron y la saltaron. */
  skipped: number;
  /** scale: promedio (dos decimales). */
  average?: number;
  /** scale: el máximo de la escala (5, 7 o 10). */
  max?: number;
  /** scale: "1"…"max". choice: las opciones (varias respuestas cuentan en cada una). yesno: "Sí" y "No". */
  distribution?: Array<{ label: string; count: number }>;
  /** text: las respuestas abiertas. `who` = etiqueta del moderador o alias del participante. */
  texts?: Array<{ sessionId: string; text: string; who?: string }>;
}

export interface Insight {
  level: 'good' | 'warn' | 'bad';
  /** Una frase en español, lista para mostrar. */
  text: string;
  blockId?: string;
  /** ScreenId al que se refiere, si aplica. */
  screen?: string;
}

export interface ReportFilter {
  variantId?: string;
  /** 'touch': celulares y tablets. 'desktop': computadoras. */
  device?: 'touch' | 'desktop';
}

/** Resumen general de una variante (A/B): promedio de sus tareas. Para comparar, `TaskReport.byVariant`. */
export interface VariantReport {
  id: string;
  name: string;
  participants: number;
  /** Promedio de la tasa de éxito de cada tarea con datos decididos. */
  successRate: number;
  directRate: number;
  /** Promedio del tiempo mediano de cada tarea. */
  medianTimeMs: number | null;
  /** Promedio del puntaje de cada tarea. */
  score: number | null;
}

export interface StudyReport {
  studyId: string;
  /** Sesiones del estudio que aceptaron grabar, no excluidas y dentro del filtro. */
  participants: number;
  /** Llegaron al final del estudio. */
  completed: number;
  /** Promedio de la tasa de éxito de las tareas con datos decididos, 0 a 1. */
  successRate: number;
  medianDurationMs: number | null;
  /** Promedio de la tasa de misclick de las tareas con toques, 0 a 1. */
  avgMisclickRate: number;
  tasks: TaskReport[];
  variants: VariantReport[];
  /** Puntaje de usabilidad del estudio, 0 a 100. `null` si ninguna tarea tiene datos decididos. */
  score: number | null;
  /** Sesiones excluidas del estudio (no cuentan en nada de lo anterior). */
  excluded: number;
  /** Resultados manuales por revisar, sumando todas las tareas. */
  pendingReview: number;
  /** Participantes por tipo de dispositivo, antes de filtrar. */
  devices: { touch: number; desktop: number };
  /** El filtro aplicado, si hubo alguno. */
  filter?: ReportFilter;
  /** "Qué arreglar": de 2 a 6 frases generadas por reglas (sin IA), de más a menos grave. */
  insights: Insight[];
  questions: QuestionReport[];
  /** Los bloques en el orden del estudio, para pintar el reporte. */
  order: Array<{ blockId: string; kind: BlockKind }>;
}

/** Cómo se llama cada resultado de una tarea, en el reporte, en las listas y en el CSV. */
export const OUTCOME_LABELS: Record<keyof TaskOutcomeCounts, string> = {
  direct: 'Éxito directo',
  indirect: 'Éxito indirecto',
  reported: 'Dijo que terminó',
  failed: 'No pudo',
  incomplete: 'Sin terminar',
  review: 'Por revisar',
};

/** El panel dibuja en un mismo mapa de calor los toques de pantallas de ancho parecido (±20 %). */
export const SIMILAR_WIDTH_RATIO = 0.2;

export function similarWidth(a: number, b: number): boolean {
  return Math.abs(a - b) <= SIMILAR_WIDTH_RATIO * b;
}

const SAMPLE_BEFORE_TAP_MS = 50;
const SAMPLE_AFTER_ARRIVAL_MS = 800;
const DEFAULT_WIDTH = 390;
const DEFAULT_HEIGHT = 700;

function median(values: number[], round = true): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  if (s.length % 2) return s[m] as number;
  const mid = ((s[m - 1] as number) + (s[m] as number)) / 2;
  return round ? Math.round(mid) : mid;
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

const isTap = (e: TaptanaOwnEvent): e is TapEvent =>
  e.type === 'tap' && typeof e.target === 'object' && e.target !== null;
const isMisclick = (t: TapEvent): boolean => t.target.interactive === false;
const isJudged = (t: TapEvent): boolean => typeof t.target.interactive === 'boolean';

/** ¿`seq` contiene a `want` en orden (no necesariamente seguido)? Devuelve cuántos pasos cubre. */
function stepsReached(seq: string[], want: string[]): number {
  let i = 0;
  for (const p of seq) if (i < want.length && p === want[i]) i++;
  return i;
}

/** El valor más repetido; si empatan, el que apareció primero. */
function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined;
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * El ancho de pantalla "más común": el que tiene más anchos parecidos (±20 %) alrededor. Es
 * justo el grupo que el panel dibuja junto, así el mapa aprovecha la mayor cantidad de toques.
 */
function commonWidth(widths: number[]): number {
  let best = DEFAULT_WIDTH;
  let bestNear = 0;
  let bestExact = 0;
  for (const w of new Set(widths)) {
    const near = widths.filter((x) => similarWidth(x, w)).length;
    const exact = widths.filter((x) => x === w).length;
    if (near > bestNear || (near === bestNear && exact > bestExact)) {
      best = w;
      bestNear = near;
      bestExact = exact;
    }
  }
  return best;
}

function tapLabel(tap: TapEvent): string {
  const { text, id, classes, tag, selector } = tap.target;
  const shown = typeof text === 'string' ? text.trim() : '';
  if (shown) return shown;
  if (id) return `#${id}`;
  if (classes && classes.length > 0) return `${tag}.${classes[0]}`;
  const last = typeof selector === 'string' ? selector.split('>').pop()?.trim() : '';
  return last || tag || 'elemento';
}

/** Una sesión ya digerida: eventos ordenados y resultados calculados. */
interface Ctx {
  session: SessionSummary;
  own: TaptanaOwnEvent[];
  navs: Array<{ t: number; screen: string }>;
  taps: TapEvent[];
  viewports: ViewportEvent[];
  results: Map<string, TaskResult>;
  answers: Map<string, AnswerResult>;
  finished: boolean;
  who?: string;
}

function digest(study: StudyRecord, rs: ReportSession): Ctx {
  const own = ownEvents(rs.events);
  const manual: ManualResults = { ...manualMarks(rs.session.tasks), ...rs.manual };
  const navs = own
    .filter((e): e is NavigationEvent => e.type === 'navigation' && typeof e.to === 'string')
    .map((e) => ({ t: e.t, screen: screenId(e.to) }));
  const ctx: Ctx = {
    session: rs.session,
    own,
    navs,
    taps: own.filter(isTap),
    viewports: own.filter((e): e is ViewportEvent => e.type === 'viewport'),
    results: new Map(computeTaskResults(study, own, manual, rs.session.lastSeenAt).map((r) => [r.taskId, r])),
    answers: new Map(computeAnswers(study, own).map((a) => [a.blockId, a])),
    finished: own.some((e) => e.type === 'study' && e.action === 'finish'),
  };
  const who = rs.session.label || rs.session.participant;
  if (who) ctx.who = who;
  return ctx;
}

/** Tamaño de la pantalla del participante en el instante `t` (cambia si gira el celular). */
function viewportAt(ctx: Ctx, t: number): { width: number; height: number } {
  let current: ViewportEvent | undefined;
  for (const v of ctx.viewports) {
    if (v.t > t) break;
    current = v;
  }
  const fallback = ctx.viewports[0];
  return {
    width: current?.width || ctx.session.viewport?.width || fallback?.width || DEFAULT_WIDTH,
    height: current?.height || ctx.session.viewport?.height || fallback?.height || DEFAULT_HEIGHT,
  };
}

interface Visit {
  screen: string;
  t: number;
  end: number;
}

/** Lo que hizo un participante dentro de una tarea. */
interface Segment {
  ctx: Ctx;
  result: TaskResult;
  /** Pantallas en orden, sin repetir seguidas. */
  pages: string[];
  visits: Visit[];
  taps: Array<{ tap: TapEvent; screen: string }>;
}

function segmentFor(ctx: Ctx, result: TaskResult, task: TaskBlock): Segment | null {
  if (result.startedAt === undefined) return null;
  const from = result.startedAt;
  const firstClick = (task.kind ?? 'task') === 'first-click';
  // Lo que pasa después de cumplir la regla (pasear antes de tocar "Listo") ya no es la tarea.
  const until = (!firstClick && result.goalAt !== undefined ? result.goalAt : result.endedAt) ?? ctx.session.lastSeenAt;
  const to = Math.max(until, from);

  // Pantallas en orden: donde estaba al empezar + las que abrió durante la tarea.
  const before = [...ctx.navs].reverse().find((n) => n.t <= from);
  const marks: Array<{ screen: string; t: number }> = [
    { screen: before?.screen ?? screenId(ctx.session.entryPath || '/'), t: from },
  ];
  for (const n of ctx.navs) if (n.t > from && n.t <= to) marks.push({ screen: n.screen, t: n.t });
  // Si la tarea empieza en una pantalla concreta, lo que vino antes es el salto automático: no cuenta.
  const startPath = task.startPath;
  if (typeof startPath === 'string' && startPath) {
    const i = marks.findIndex((v) => sameScreen(v.screen, startPath));
    if (i > 0) marks.splice(0, i);
  }
  const visits: Visit[] = [];
  marks.forEach((v, i) => {
    const end = marks[i + 1]?.t ?? to;
    const last = visits[visits.length - 1];
    if (last && last.screen === v.screen) last.end = end;
    else visits.push({ screen: v.screen, t: v.t, end });
  });
  const first = visits[0] as Visit;
  const taps = ctx.taps
    .filter((t) => t.t > from && t.t >= first.t && t.t <= to)
    .map((tap) => ({ tap, screen: ([...visits].reverse().find((v) => v.t <= tap.t) ?? first).screen }));
  return { ctx, result, pages: visits.map((v) => v.screen), visits, taps };
}

interface Row extends TaskReportRow {
  /** Toques con el dato de si tuvieron efecto. */
  judged: number;
  taps: number;
}

/** Tasas y puntaje de un grupo de intentos de una misma tarea. */
function summarize(rows: Row[], kind: TaskKind): {
  participants: number;
  decided: number;
  successRate: number;
  directRate: number;
  medianTimeMs: number | null;
  misclickRate: number;
  score: number | null;
} {
  const decided = rows.filter((r) => r.outcome !== 'review').length;
  const direct = rows.filter((r) => r.outcome === 'direct').length;
  const wins = rows.filter((r) => r.outcome === 'direct' || r.outcome === 'indirect');
  const judged = rows.reduce((a, r) => a + r.judged, 0);
  const misclicks = rows.reduce((a, r) => a + r.misclicks, 0);
  const misclickRate = judged ? misclicks / judged : 0;
  const successRate = decided ? wins.length / decided : 0;
  const directRate = decided ? direct / decided : 0;

  let score: number | null = null;
  if (decided > 0) {
    if (kind === 'first-click') {
      score = Math.round(100 * successRate);
    } else {
      const perScreen = median(
        wins.filter((r) => r.durationMs !== undefined).map((r) => (r.durationMs as number) / 1000 / Math.max(1, r.pages.length)),
        false,
      );
      const penalty = perScreen === null ? 0 : clamp((perScreen - 5) / 2, 0, 10);
      const indirectRate = successRate - directRate;
      score = Math.round(clamp(100 * directRate + 50 * indirectRate - 50 * misclickRate - penalty, 0, 100));
    }
  }
  return {
    participants: rows.length,
    decided,
    successRate,
    directRate,
    medianTimeMs: median(wins.map((r) => r.durationMs).filter((d): d is number => d !== undefined)),
    misclickRate,
    score,
  };
}

interface ScreenAcc {
  path: string;
  taps: HeatPoint[];
  misclicks: number;
  labels: Map<string, number>;
  /** Un registro por participante que pasó por la pantalla. */
  visitors: Array<{ sessionId: string; arrival: number; leave: number; firstTap?: number; vw: number; time: number }>;
}

function taskReport(
  task: TaskBlock,
  segments: Segment[],
  titles: Map<string, string>,
  variants: StudyVariant[],
): { report: TaskReport; judged: number } {
  const kind: TaskKind = task.kind ?? 'task';
  // Sin regla (registro viejo o roto) se trata como manual, igual que en results.ts.
  const isManual = (task.success?.type ?? 'manual') === 'manual';
  const won = (s: Segment): boolean => s.result.outcome === 'success';

  // Las pantallas del estudio (escritas por el diseñador) se llevan a la forma en que se vieron.
  const seen = new Set(segments.flatMap((s) => s.pages));
  const resolve = (path: string): string => {
    const id = screenId(path);
    if (seen.has(id)) return id;
    for (const s of seen) if (sameScreen(s, id)) return s;
    return id;
  };

  // En primer clic no hay camino: todo pasa en la pantalla donde se toca.
  const written = Array.isArray(task.expectedPath) ? task.expectedPath.filter((p) => typeof p === 'string') : [];
  let expectedPath = kind === 'first-click' ? [] : written.map(resolve);
  const inferred = expectedPath.length === 0;
  if (inferred && kind !== 'first-click') {
    // El camino más corto entre quienes lo lograron; si empatan, el más común.
    const counts = new Map<string, { pages: string[]; count: number }>();
    for (const s of segments.filter(won)) {
      const key = s.pages.join('\n');
      const c = counts.get(key) ?? { pages: s.pages, count: 0 };
      c.count++;
      counts.set(key, c);
    }
    const best = [...counts.values()].sort((a, b) => a.pages.length - b.pages.length || b.count - a.count)[0];
    expectedPath = best ? best.pages : [];
  }
  const followed = (pages: string[]): boolean =>
    expectedPath.length === 0 || (pages.length === expectedPath.length && pages.every((p, i) => p === expectedPath[i]));

  const outcomes: TaskOutcomeCounts = { direct: 0, indirect: 0, reported: 0, failed: 0, incomplete: 0, review: 0 };
  const rows: Row[] = [];
  const screens = new Map<string, ScreenAcc>();
  const screen = (path: string): ScreenAcc => {
    let sc = screens.get(path);
    if (!sc) {
      sc = { path, taps: [], misclicks: 0, labels: new Map(), visitors: [] };
      screens.set(path, sc);
    }
    return sc;
  };

  for (const s of segments) {
    let outcome: keyof TaskOutcomeCounts;
    if (s.result.outcome === 'success') {
      // En primer clic no hay camino: si acertó, es directo.
      outcome = kind === 'first-click' || followed(s.pages) ? 'direct' : 'indirect';
    } else if (s.result.outcome === 'reported') {
      // En primer clic, tocar en otro lado es fallar, no "decir que terminó".
      if (kind === 'first-click') outcome = 'failed';
      else outcome = isManual && s.result.manual === null ? 'review' : 'reported';
    } else if (s.result.outcome === 'failed') {
      outcome = 'failed';
    } else {
      outcome = 'incomplete';
    }
    outcomes[outcome]++;

    const misclicks = s.taps.filter((t) => isMisclick(t.tap)).length;
    const row: Row = {
      sessionId: s.ctx.session.id,
      outcome,
      misclicks,
      pages: s.pages,
      judged: s.taps.filter((t) => isJudged(t.tap)).length,
      taps: s.taps.length,
    };
    if (s.result.durationMs !== undefined) row.durationMs = s.result.durationMs;
    if (s.ctx.session.variantId) row.variantId = s.ctx.session.variantId;
    if (s.ctx.who) row.who = s.ctx.who;
    if (s.result.startedAt !== undefined) row.startedAt = s.result.startedAt;
    if (s.result.goalAt !== undefined) row.goalAt = s.result.goalAt;
    rows.push(row);

    // Una entrada por pantalla y participante: cuándo llegó, cuánto estuvo, su primer toque ahí.
    const mine = new Map<string, ScreenAcc['visitors'][number]>();
    for (const v of s.visits) {
      const entry = mine.get(v.screen);
      if (entry) {
        entry.time += Math.max(0, v.end - v.t);
      } else {
        mine.set(v.screen, {
          sessionId: s.ctx.session.id,
          arrival: v.t,
          leave: v.end,
          vw: viewportAt(s.ctx, v.t).width,
          time: Math.max(0, v.end - v.t),
        });
      }
    }
    for (const { tap, screen: path } of s.taps) {
      const sc = screen(path);
      const vp = viewportAt(s.ctx, tap.t);
      const miss = isMisclick(tap);
      const point: HeatPoint = {
        x: tap.fixed ? tap.x : (tap.pageX ?? tap.x),
        y: tap.pageY ?? tap.y,
        vw: vp.width,
        misclick: miss,
        sessionId: s.ctx.session.id,
      };
      if (tap.fixed) {
        point.fixed = true;
        point.vy = tap.y;
        point.vh = tap.vh ?? vp.height;
      }
      sc.taps.push(point);
      if (miss) {
        sc.misclicks++;
        const label = tapLabel(tap);
        sc.labels.set(label, (sc.labels.get(label) ?? 0) + 1);
      }
      const entry = mine.get(path);
      if (entry && entry.firstTap === undefined) entry.firstTap = tap.t;
    }
    for (const [path, entry] of mine) screen(path).visitors.push(entry);
  }

  const pathCounts = new Map<string, PathReport>();
  for (const s of segments) {
    const key = s.pages.join('\n');
    const p = pathCounts.get(key) ?? { pages: s.pages, count: 0, successes: 0 };
    p.count++;
    if (won(s)) p.successes++;
    pathCounts.set(key, p);
  }

  const order = (p: string): number => {
    const i = expectedPath.indexOf(p);
    return i === -1 ? 1000 : i;
  };
  const screenReports = [...screens.values()]
    .map((sc): ScreenReport => {
      const width = commonWidth(sc.visitors.map((v) => v.vw));
      const out: ScreenReport = {
        path: sc.path,
        visitors: sc.visitors.length,
        avgTimeMs: sc.visitors.length ? Math.round(mean(sc.visitors.map((v) => v.time))) : 0,
        taps: sc.taps,
        misclicks: sc.misclicks,
        viewportWidth: width,
        topMisclicks: [...sc.labels.entries()]
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
          .slice(0, 5),
      };
      const title = titles.get(sc.path);
      if (title) out.title = title;
      const model = sc.visitors.find((v) => v.vw === width);
      if (model) {
        const t =
          model.firstTap !== undefined
            ? Math.max(model.arrival, model.firstTap - SAMPLE_BEFORE_TAP_MS)
            : Math.max(model.arrival, Math.min(model.arrival + SAMPLE_AFTER_ARRIVAL_MS, model.leave - SAMPLE_BEFORE_TAP_MS));
        out.sample = { sessionId: model.sessionId, t, vw: width };
      }
      return out;
    })
    .sort((a, b) => order(a.path) - order(b.path) || b.visitors - a.visitors);

  const all = summarize(rows, kind);
  const n = rows.length;
  const misclicks = rows.reduce((a, r) => a + r.misclicks, 0);
  const report: TaskReport = {
    taskId: task.id,
    title: blockTitle(task),
    kind,
    participants: n,
    decided: all.decided,
    outcomes,
    successRate: all.successRate,
    directRate: all.directRate,
    score: all.score,
    medianTimeMs: all.medianTimeMs,
    avgMisclicks: n ? misclicks / n : 0,
    misclickRate: all.misclickRate,
    tapCount: rows.reduce((a, r) => a + r.taps, 0),
    expectedPath,
    expectedPathInferred: inferred,
    funnel: expectedPath.map((path, i) => ({
      path,
      reached: segments.filter((s) => stepsReached(s.pages, expectedPath) > i).length,
    })),
    screens: screenReports,
    paths: [...pathCounts.values()].sort((a, b) => b.count - a.count || b.successes - a.successes).slice(0, 8),
    results: rows.map(({ judged: _judged, taps: _taps, ...row }) => row),
    byVariant: variants.map((v) => {
      const s = summarize(rows.filter((r) => r.variantId === v.id), kind);
      return {
        variantId: v.id,
        participants: s.participants,
        decided: s.decided,
        successRate: s.successRate,
        directRate: s.directRate,
        medianTimeMs: s.medianTimeMs,
        score: s.score,
      };
    }),
  };
  return { report, judged: rows.reduce((a, r) => a + r.judged, 0) };
}

function questionReport(block: QuestionBlock, ctxs: Ctx[]): QuestionReport {
  const out: QuestionReport = { blockId: block.id, kind: block.kind, question: blockTitle(block), responses: 0, skipped: 0 };
  const counts = new Map<string, number>();
  const bump = (label: string): void => void counts.set(label, (counts.get(label) ?? 0) + 1);
  const texts: NonNullable<QuestionReport['texts']> = [];
  let sum = 0;

  for (const ctx of ctxs) {
    const answer = ctx.answers.get(block.id);
    if (!answer) continue;
    const v = answer.value;
    let answered = false;
    if (block.kind === 'scale') {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= block.max) {
        sum += v;
        bump(String(v));
        answered = true;
      }
    } else if (block.kind === 'yesno') {
      if (typeof v === 'boolean') {
        bump(v ? 'Sí' : 'No');
        answered = true;
      }
    } else if (block.kind === 'choice') {
      const picked = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((x) => typeof x === 'string' && x.trim() !== '');
      for (const option of new Set(picked)) bump(option);
      answered = picked.length > 0;
    } else if (typeof v === 'string' && v.trim() !== '') {
      const entry: NonNullable<QuestionReport['texts']>[number] = { sessionId: ctx.session.id, text: v.trim() };
      if (ctx.who) entry.who = ctx.who;
      texts.push(entry);
      answered = true;
    }
    if (answered) out.responses++;
    else out.skipped++;
  }

  if (block.kind === 'scale') {
    out.max = block.max;
    if (out.responses > 0) out.average = Math.round((sum / out.responses) * 100) / 100;
    out.distribution = Array.from({ length: block.max }, (_, i) => ({ label: String(i + 1), count: counts.get(String(i + 1)) ?? 0 }));
  } else if (block.kind === 'yesno') {
    out.distribution = ['Sí', 'No'].map((label) => ({ label, count: counts.get(label) ?? 0 }));
  } else if (block.kind === 'choice') {
    const options = Array.isArray(block.options) ? block.options : [];
    // Una opción que ya no está en el bloque (se editó después) conserva sus respuestas al final.
    const extra = [...counts.keys()].filter((label) => !options.includes(label));
    out.distribution = [...options, ...extra].map((label) => ({ label, count: counts.get(label) ?? 0 }));
  } else {
    out.texts = texts;
  }
  return out;
}

interface Analysis {
  study: StudyRecord;
  report: StudyReport;
  /** Sesiones que entraron al reporte, de la más antigua a la más nueva. */
  ctxs: Ctx[];
}

function analyze(input: StudyRecord, sessions: ReportSession[], filter: ReportFilter = {}): Analysis {
  // Un registro antiguo sin normalizar (`tasks`) se lee igual.
  const study: StudyRecord = { ...input, v: 2, blocks: studyBlocks(input) };
  const mine = sessions.filter((s) => s && s.session && Array.isArray(s.events) && s.session.studyId === study.id);
  const counted = mine.filter((s) => !s.session.excluded);
  const picked = counted
    .filter((s) => filter.variantId === undefined || s.session.variantId === filter.variantId)
    .filter((s) => filter.device === undefined || (filter.device === 'touch') === Boolean(s.session.touch))
    .sort((a, b) => a.session.startedAt - b.session.startedAt || (a.session.id < b.session.id ? -1 : 1));
  const ctxs = picked.map((rs) => digest(study, rs));

  // Título de cada pantalla: el más repetido en los eventos de navegación.
  const titleVotes = new Map<string, string[]>();
  for (const ctx of ctxs) {
    for (const e of ctx.own) {
      if (e.type !== 'navigation' || typeof e.to !== 'string' || typeof e.title !== 'string' || !e.title.trim()) continue;
      const id = screenId(e.to);
      titleVotes.set(id, [...(titleVotes.get(id) ?? []), e.title.trim()]);
    }
  }
  const titles = new Map<string, string>();
  for (const [id, votes] of titleVotes) titles.set(id, mostCommon(votes) as string);

  const variantList = Array.isArray(study.variants) ? study.variants.filter((v) => v && typeof v.id === 'string') : [];
  const built = taskBlocks(study).map((task) => {
    const segments = ctxs
      .map((ctx) => {
        const r = ctx.results.get(task.id);
        return r ? segmentFor(ctx, r, task) : null;
      })
      .filter((s): s is Segment => s !== null);
    return taskReport(task, segments, titles, variantList);
  });
  const tasks = built.map((b) => b.report);

  const decided = tasks.filter((t) => t.decided > 0);
  // La tasa de misclick del estudio promedia solo las tareas con toques que traen el dato.
  const tapped = built.filter((b) => b.judged > 0).map((b) => b.report);
  const scores = tasks.map((t) => t.score).filter((s): s is number => s !== null);

  const variants = variantList.map((v): VariantReport => {
    const per = tasks.map((t) => t.byVariant.find((b) => b.variantId === v.id)).filter((x): x is TaskVariantReport => x !== undefined);
    const withData = per.filter((x) => x.decided > 0);
    const times = per.map((x) => x.medianTimeMs).filter((t): t is number => t !== null);
    const vScores = per.map((x) => x.score).filter((s): s is number => s !== null);
    return {
      id: v.id,
      name: v.name,
      participants: ctxs.filter((c) => c.session.variantId === v.id).length,
      successRate: withData.length ? mean(withData.map((x) => x.successRate)) : 0,
      directRate: withData.length ? mean(withData.map((x) => x.directRate)) : 0,
      medianTimeMs: times.length ? Math.round(mean(times)) : null,
      score: vScores.length ? Math.round(mean(vScores)) : null,
    };
  });

  const base: Omit<StudyReport, 'insights'> = {
    studyId: study.id,
    participants: ctxs.length,
    completed: ctxs.filter((c) => c.finished).length,
    successRate: decided.length ? mean(decided.map((t) => t.successRate)) : 0,
    medianDurationMs: median(ctxs.map((c) => c.session.durationMs).filter((d) => typeof d === 'number')),
    avgMisclickRate: tapped.length ? mean(tapped.map((t) => t.misclickRate)) : 0,
    tasks,
    variants,
    score: scores.length ? Math.round(mean(scores)) : null,
    excluded: mine.length - counted.length,
    pendingReview: tasks.reduce((a, t) => a + t.outcomes.review, 0),
    devices: {
      touch: counted.filter((s) => s.session.touch).length,
      desktop: counted.filter((s) => !s.session.touch).length,
    },
    questions: questionBlocks(study).map((b) => questionReport(b, ctxs)),
    order: studyBlocks(study).map((b) => ({ blockId: b.id, kind: blockKind(b) })),
  };
  const applied: ReportFilter = {};
  if (filter.variantId !== undefined) applied.variantId = filter.variantId;
  if (filter.device !== undefined) applied.device = filter.device;
  if (Object.keys(applied).length > 0) base.filter = applied;

  return { study, ctxs, report: { ...base, insights: buildInsights(base, study) } };
}

/**
 * El reporte del estudio. Deja fuera las sesiones de otros estudios y las excluidas (las cuenta
 * en `excluded`) y aplica el filtro por variante y dispositivo.
 */
export function computeStudyReport(study: StudyRecord, sessions: ReportSession[], filter?: ReportFilter): StudyReport {
  return analyze(study, sessions, filter).report;
}

/** Una celda según RFC 4180. Un texto que empieza como fórmula se desactiva con un apóstrofo. */
function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function answerCell(block: QuestionBlock, answer: AnswerResult | undefined): string | number {
  const v = answer?.value;
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(' | ');
  if (typeof v === 'number') return block.kind === 'scale' ? v : String(v);
  return v;
}

/**
 * El estudio como CSV, una fila por participante (sin las sesiones excluidas). Columnas:
 * sesión, etiqueta, fecha (ISO), dispositivo, variante, duración_s; por cada tarea,
 * "<título> · resultado", "<título> · tiempo_s" y "<título> · misclicks"; y por cada pregunta,
 * su texto con la respuesta (varias opciones separadas por " | "). Comillas según RFC 4180,
 * saltos de línea CRLF y marca BOM de UTF-8 al inicio, para que Excel lo abra bien.
 */
export function studyCsv(study: StudyRecord, sessions: ReportSession[]): string {
  const { study: s, report, ctxs } = analyze(study, sessions);
  const tasks = taskBlocks(s);
  const questions = questionBlocks(s);
  const variantName = new Map((Array.isArray(s.variants) ? s.variants : []).filter(Boolean).map((v) => [v.id, v.name]));

  const header: Array<string | number> = ['sesión', 'etiqueta', 'fecha', 'dispositivo', 'variante', 'duración_s'];
  for (const t of tasks) {
    const title = blockTitle(t);
    header.push(`${title} · resultado`, `${title} · tiempo_s`, `${title} · misclicks`);
  }
  for (const q of questions) header.push(blockTitle(q));

  const rows: Array<Array<string | number>> = [header];
  for (const ctx of ctxs) {
    const { session } = ctx;
    const row: Array<string | number> = [
      session.id,
      ctx.who ?? '',
      Number.isFinite(session.startedAt) ? new Date(session.startedAt).toISOString() : '',
      session.deviceLabel ?? '',
      session.variantId ? (variantName.get(session.variantId) ?? session.variantId) : '',
      Math.round((session.durationMs || 0) / 1000),
    ];
    for (const t of tasks) {
      const r = report.tasks.find((x) => x.taskId === t.id)?.results.find((x) => x.sessionId === session.id);
      if (!r) row.push('no empezó', '', '');
      else row.push(OUTCOME_LABELS[r.outcome].toLowerCase(), r.durationMs === undefined ? '' : Math.round(r.durationMs / 1000), r.misclicks);
    }
    for (const q of questions) row.push(answerCell(q, ctx.answers.get(q.id)));
    rows.push(row);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',') + '\r\n').join('');
}
