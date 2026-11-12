/**
 * La presentación de un estudio: las diapositivas que se arman solas a partir del reporte.
 *
 * `buildDeck` no calcula ningún número nuevo: toma el reporte (`computeStudyReport`) y sus
 * frases (`insights`) y los ordena en diapositivas, una idea por diapositiva. Cada diapositiva es
 * un dato plano (una unión por `kind`) que dibujan dos renderizadores del panel: la vista en
 * pantalla (y su versión para PDF) y el archivo de PowerPoint.
 *
 * Privacidad: la presentación nunca lleva nombres, alias, etiquetas ni ids de sesión. Las citas
 * se firman "P1", "P2"… según el orden de llegada en el reporte. El mapa de calor se refiere a
 * la pantalla (`blockId` + `screen`); quien lo dibuja busca la foto en el reporte.
 */

import { smallSampleText } from './insights.js';
import { BLOCK_KIND_LABELS, studyBlocks, taskBlocks, type StudyRecord } from './study.js';
import { OUTCOME_ORDER, REPORT_DEFINITIONS, scoreBand, taskOutcomeLabel, type Insight, type ScoreTone, type StudyReport, type TaskOutcomeCounts, type TaskReport } from './report.js';
import { screenName as nameOf } from './screen.js';

export type SlideKind = Slide['kind'];

/** Un número destacado: "Tareas logradas · 63 %". */
export interface DeckMetric {
  label: string;
  value: string;
  note?: string;
}

/** Un punto de una lista. `tone`: problema o buena noticia. */
export interface DeckItem {
  text: string;
  tone?: 'problem' | 'good';
}

/** Una barra de un gráfico simple. `share` va de 0 a 1 (largo de la barra). */
export interface DeckBar {
  label: string;
  count: number;
  share: number;
  /** El texto junto a la barra: "3 · 38 %". */
  value: string;
}

/** Un tramo de la barra de resultados de una tarea. */
export interface DeckOutcome {
  key: keyof TaskOutcomeCounts;
  label: string;
  count: number;
  /** Sobre quienes empezaron la tarea, 0 a 1. */
  share: number;
}

interface SlideBase {
  /** Estable entre cargas: con él se guardan las ediciones. */
  id: string;
  title: string;
  /** La frase que resume la diapositiva. */
  takeaway?: string;
  /** Lista de puntos editables (lo más importante, qué arreglar, cómo se midió, portada). */
  items?: DeckItem[];
  /** Escondida por el diseñador: se ve atenuada en la lista y no sale en las descargas. */
  hidden?: boolean;
}

export type Slide =
  | (SlideBase & { kind: 'cover'; subtitle: string; filter?: string })
  | (SlideBase & { kind: 'empty' })
  | (SlideBase & { kind: 'summary'; score: number | null; scoreLabel: string; tone: ScoreTone; metrics: DeckMetric[] })
  | (SlideBase & { kind: 'highlights'; items: DeckItem[] })
  | (SlideBase & {
      kind: 'task';
      blockId: string;
      /** "Tarea" o "Primer clic". */
      label: string;
      /** El tipo de bloque, para pintarlo con su color. */
      blockKind?: 'task' | 'first-click';
      /** Lo que leyó el participante. */
      instruction: string;
      score: number | null;
      tone: ScoreTone;
      participants: number;
      outcomes: DeckOutcome[];
      metrics: DeckMetric[];
      /** La caída más grande del embudo, en palabras. */
      drop?: string;
      /** Si la frase de `takeaway` es un problema o una buena noticia. */
      takeawayTone?: 'problem' | 'good';
    })
  | (SlideBase & {
      kind: 'heatmap';
      blockId: string;
      /** ScreenId de la pantalla, para buscarla en `report.tasks[].screens`. */
      screen: string;
      screenName: string;
      firstClick: boolean;
      visitors: number;
      taps: number;
      misclicks: number;
      topMisclicks: Array<{ label: string; count: number }>;
    })
  | (SlideBase & {
      kind: 'question';
      blockId: string;
      questionKind: 'scale' | 'choice' | 'yesno' | 'text';
      /** "Escala", "Opción múltiple"… */
      label: string;
      responses: number;
      average?: number;
      max?: number;
      bars?: DeckBar[];
      quotes?: Array<{ who: string; text: string }>;
    })
  | (SlideBase & { kind: 'next-steps'; items: DeckItem[] })
  | (SlideBase & { kind: 'method'; items: DeckItem[] });

export interface Deck {
  title: string;
  slides: Slide[];
}

export interface DeckOptions {
  /** El nombre del prototipo (el reporte solo trae su id). */
  prototypeName?: string;
  /** Nombres de las variantes, si el filtro es por variante (si no, salen del estudio). */
  variantName?: string;
}

const NBSP = ' ';
/** Las frases que hablan del éxito de una tarea (las de toques sin efecto van con su mapa). */
const TASK_TOPICS = new Set(['lowest-success', 'funnel-drop', 'slow', 'detour', 'review', 'solid']);
const MAX_HIGHLIGHTS = 5;
const MAX_STEPS = 5;
const MAX_QUOTES = 4;
const QUOTE_CHARS = 140;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pct = (x: number): string => `${Math.round(x * 100)}${NBSP}%`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const quote = (s: string): string => `«${s.length > 60 ? `${s.slice(0, 57).trimEnd()}…` : s}»`;
const decimal = (x: number): string => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');

/** Igual que `seconds` del panel: "8,5 s", "27 s", "1 min 5 s". */
function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1).replace('.', ',') : Math.round(s)}${NBSP}s`;
  return `${Math.floor(s / 60)}${NBSP}min ${Math.round(s % 60)}${NBSP}s`;
}

function day(t: number): { d: number; m: number; y: number } {
  const date = new Date(t);
  return { d: date.getDate(), m: date.getMonth(), y: date.getFullYear() };
}

/** "11 de noviembre de 2026", "3 al 11 de noviembre de 2026", "28 de octubre al 2 de noviembre de 2026". */
export function dateRange(from: number, to: number): string {
  const a = day(from);
  const b = day(to);
  const full = (x: typeof a): string => `${x.d} de ${MONTHS[x.m]} de ${x.y}`;
  if (a.y === b.y && a.m === b.m && a.d === b.d) return full(a);
  if (a.y === b.y && a.m === b.m) return `${a.d} al ${full(b)}`;
  if (a.y === b.y) return `${a.d} de ${MONTHS[a.m]} al ${full(b)}`;
  return `${full(a)} al ${full(b)}`;
}

/** Recorta un texto largo en una palabra, con "…". */
function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

function filterText(report: StudyReport, study: StudyRecord, options: DeckOptions): string | undefined {
  const f = report.filter;
  if (!f) return undefined;
  const parts: string[] = [];
  if (f.variantId) parts.push(`variante ${options.variantName ?? study.variants?.find((v) => v.id === f.variantId)?.name ?? f.variantId}`);
  if (f.device === 'touch') parts.push('solo celular o tablet');
  if (f.device === 'desktop') parts.push('solo escritorio');
  return parts.length ? `Filtro: ${parts.join(' · ')}` : undefined;
}

function deviceMix(report: StudyReport): string {
  const touch = report.people.filter((p) => p.touch).length;
  const desktop = report.people.length - touch;
  const parts: string[] = [];
  if (touch) parts.push(`${touch} en celular o tablet`);
  if (desktop) parts.push(`${desktop} en computadora`);
  return parts.join(' · ');
}

const wins = (t: TaskReport): number => t.outcomes.direct + t.outcomes.indirect;
const toneOf = (i: Insight): 'problem' | 'good' => (i.level === 'good' ? 'good' : 'problem');

/** La caída más grande del embudo, como la explica el reporte. */
function biggestDrop(task: TaskReport, screen: (path: string) => string): string | undefined {
  if (task.kind !== 'task' || task.funnel.length < 2) return undefined;
  let best: { i: number; lost: number } | undefined;
  for (let i = 1; i < task.funnel.length; i++) {
    const lost = (task.funnel[i - 1]?.reached ?? 0) - (task.funnel[i]?.reached ?? 0);
    if (lost > 0 && (!best || lost > best.lost)) best = { i, lost };
  }
  if (!best) return undefined;
  const from = screen(task.funnel[best.i - 1]?.path ?? '');
  const to = screen(task.funnel[best.i]?.path ?? '');
  const who = best.lost === 1 ? '1 persona no llegó' : `${best.lost} personas no llegaron`;
  return `${who} a «${to}» desde «${from}»: es la caída más grande del camino esperado.`;
}

/** "Qué arreglar primero": una acción por cada problema, en el orden de gravedad de las frases. */
function nextStep(i: Insight, report: StudyReport, screen: (path: string) => string): string | undefined {
  const task = i.blockId ? report.tasks.find((t) => t.taskId === i.blockId) : undefined;
  const question = i.blockId ? report.questions.find((q) => q.blockId === i.blockId) : undefined;
  const title = task ? quote(task.title) : question ? quote(question.question) : '';
  switch (i.topic) {
    case 'lowest-success':
      if (!task) return undefined;
      return task.kind === 'first-click'
        ? `Haz más fácil de encontrar lo que pide ${title}: ${pct(task.successRate)} acertó el primer clic.`
        : `Revisa el flujo de ${title}: ${wins(task) === 1 ? 'lo logró' : 'lo lograron'} ${wins(task)} de ${plural(task.decided, 'persona', 'personas')} (${pct(task.successRate)}).`;
    case 'funnel-drop': {
      if (!task || !i.screen) return undefined;
      const k = task.funnel.findIndex((f) => f.path === i.screen);
      const next = task.funnel[k + 1]?.path;
      return next
        ? `Mira por qué la gente no pasa de ${quote(screen(i.screen))} a ${quote(screen(next))} en ${title}.`
        : `Mira por qué la gente se queda en ${quote(screen(i.screen))} en ${title}.`;
    }
    case 'misclicks': {
      const s = task?.screens.find((x) => x.path === i.screen);
      const top = s?.topMisclicks[0];
      const where = i.screen ? quote(screen(i.screen)) : 'la pantalla con más toques sin efecto';
      return top
        ? `Haz que ${quote(top.label)} responda al tocarlo, o que no parezca tocable (pantalla ${where}).`
        : `Revisa qué parece tocable sin serlo en ${where}.`;
    }
    case 'slow':
      return task ? `Acorta o aclara ${title}: es donde más tiempo se va (${duration(task.medianTimeMs)} de mediana).` : undefined;
    case 'review':
      return report.pendingReview === 1
        ? 'Marca el resultado que está por revisar: hasta entonces no cuenta en el éxito ni en el puntaje.'
        : `Marca los ${report.pendingReview} resultados por revisar: hasta entonces no cuentan en el éxito ni en el puntaje.`;
    case 'scale-low':
      return question ? `Sube la nota de ${title}: ${decimal(question.average ?? 0)} de ${question.max ?? ''}. Mira las grabaciones de quienes pusieron menos.` : undefined;
    case 'detour':
      return task ? `Haz más visible el camino ${task.expectedPathInferred ? 'más corto' : 'esperado'} de ${title}: la mayoría lo logró dando un rodeo.` : undefined;
    case 'completion':
      return 'Revisa por qué la gente deja el estudio a mitad: puede ser largo o confuso.';
    case 'small-sample':
      return 'Prueba con más personas: con 5 o más ya aparecen los problemas principales.';
    default:
      return undefined;
  }
}

/**
 * Las diapositivas de un estudio, en orden: portada, resumen, lo más importante, una por tarea
 * (y su mapa de calor si hubo toques sin efecto), una por pregunta, qué arreglar primero y cómo se
 * midió. Sin participantes: portada y "todavía no hay resultados". Respeta el filtro del reporte.
 */
export function buildDeck(study: StudyRecord, report: StudyReport, options: DeckOptions = {}): Deck {
  const slides: Slide[] = [];
  const n = report.participants;
  const screen = (path: string): string => nameOf(path, report.screenNames ?? {});
  const filter = filterText(report, study, options);
  const prototype = options.prototypeName ?? study.prototypeId;
  const starts = report.people.map((p) => p.startedAt).filter((t) => Number.isFinite(t));
  const when = starts.length ? dateRange(Math.min(...starts), Math.max(...starts)) : '';

  const coverItems: DeckItem[] = [];
  if (n > 0) {
    coverItems.push({ text: plural(n, 'participante', 'participantes') });
    if (when) coverItems.push({ text: when });
    const mix = deviceMix(report);
    if (mix) coverItems.push({ text: mix });
  }
  slides.push({
    kind: 'cover',
    id: 'cover',
    title: study.name || 'Estudio sin nombre',
    subtitle: `Prototipo ${prototype}`,
    ...(study.description ? { takeaway: study.description } : {}),
    items: coverItems,
    ...(filter ? { filter } : {}),
  });

  if (n === 0) {
    slides.push({
      kind: 'empty',
      id: 'empty',
      title: 'Todavía no hay resultados',
      takeaway: filter
        ? 'Nadie coincide con este filtro. Quítalo o elige otro para ver resultados.'
        : 'Cuando alguien haga el estudio, esta presentación se arma sola con lo que pasó.',
    });
    return { title: study.name || 'Estudio sin nombre', slides };
  }

  // ── Resumen ──
  const band = scoreBand(report.score);
  const withData = report.tasks.filter((t) => t.decided > 0).length;
  const tapped = report.tasks.some((t) => t.tapCount > 0);
  const metrics: DeckMetric[] = [];
  if (withData) metrics.push({ label: 'Tareas logradas', value: pct(report.successRate), note: 'De todos los intentos ya decididos' });
  metrics.push({ label: 'Duración mediana', value: duration(report.medianDurationMs), note: 'Del estudio completo, por participante' });
  if (tapped) metrics.push({ label: 'Misclicks', value: pct(report.avgMisclickRate), note: 'De los toques cayeron donde no pasa nada' });
  metrics.push({
    label: 'Participantes',
    value: String(n),
    note: report.completed === n ? 'Todos llegaron al final' : `${report.completed} de ${n} llegaron al final`,
  });
  slides.push({
    kind: 'summary',
    id: 'summary',
    title: 'Cómo le fue al prototipo',
    score: report.score,
    scoreLabel: band.label,
    tone: band.tone,
    metrics,
    takeaway:
      report.score === null
        ? 'El puntaje aparece cuando al menos una tarea tenga resultados decididos.'
        : `Puntaje de usabilidad de 0 a 100, promedio de ${plural(withData, 'tarea', 'tareas')}: 80 o más es muy bien; menos de 40, problemas serios.`,
  });

  // ── Lo más importante ──
  let top = report.insights.slice(0, MAX_HIGHLIGHTS);
  const praise = report.insights.find((i) => i.level === 'good');
  if (praise && !top.includes(praise) && top.length === MAX_HIGHLIGHTS) top = [...top.slice(0, -1), praise];
  if (top.length > 0) {
    slides.push({ kind: 'highlights', id: 'highlights', title: 'Lo más importante', items: top.map((i) => ({ text: i.text, tone: toneOf(i) })) });
  }

  // ── Bloques, en el orden del estudio ──
  const blocks = new Map(studyBlocks(study).map((b) => [b.id, b]));
  const order = report.people.map((p) => p.sessionId);
  const multiple = (id: string): boolean => {
    const b = blocks.get(id);
    return b?.kind === 'choice' && b.multiple === true;
  };
  for (const item of report.order) {
    if (item.kind === 'context') continue;
    const task = report.tasks.find((t) => t.taskId === item.blockId);
    if (task) {
      if (task.participants === 0) continue;
      const block = blocks.get(task.taskId);
      const firstClick = task.kind === 'first-click';
      const tb = block && block.kind !== 'context' && 'instruction' in block ? block : undefined;
      const outcomes: DeckOutcome[] = OUTCOME_ORDER.filter((k) => task.outcomes[k] > 0).map((k) => ({
        key: k,
        label: taskOutcomeLabel(k, firstClick),
        count: task.outcomes[k],
        share: task.outcomes[k] / Math.max(1, task.participants),
      }));
      const tm: DeckMetric[] = [{ label: firstClick ? 'Acertaron' : 'Lo lograron', value: task.decided ? pct(task.successRate) : '—', note: `${wins(task)} de ${task.decided}` }];
      if (!firstClick) tm.push({ label: 'Tiempo mediano', value: duration(task.medianTimeMs), note: 'De quienes lo lograron' });
      if (task.tapCount > 0) tm.push({ label: 'Misclicks', value: pct(task.misclickRate), note: `${task.screens.reduce((a, s) => a + s.misclicks, 0)} toques sin efecto` });
      const manual = (tb?.success?.type ?? 'manual') === 'manual';
      const drop = task.expectedPathInferred && manual ? undefined : biggestDrop(task, screen);
      const insight = report.insights.find((i) => i.blockId === task.taskId && TASK_TOPICS.has(i.topic ?? 'basic'));
      const fallback =
        task.decided === 0
          ? `${plural(task.outcomes.review, 'resultado', 'resultados')} por revisar: márcalos para ver el éxito.`
          : `${wins(task)} de ${plural(task.decided, 'persona', 'personas')} ${firstClick ? (wins(task) === 1 ? 'acertó el primer clic' : 'acertaron el primer clic') : wins(task) === 1 ? 'lo logró' : 'lo lograron'} (${pct(task.successRate)}).`;
      slides.push({
        kind: 'task',
        id: `task-${task.taskId}`,
        blockId: task.taskId,
        title: task.title || 'Tarea sin título',
        label: BLOCK_KIND_LABELS[task.kind],
        blockKind: task.kind,
        instruction: tb?.instruction ?? '',
        score: task.score,
        tone: scoreBand(task.score).tone,
        participants: task.participants,
        outcomes,
        metrics: tm,
        ...(drop ? { drop } : {}),
        takeaway: insight?.text ?? fallback,
        takeawayTone: insight ? toneOf(insight) : task.successRate >= 0.8 ? 'good' : 'problem',
      });

      // El mapa de la pantalla con más toques sin efecto (en primer clic, la más tocada).
      const ranked = [...task.screens].sort((a, b) => (firstClick ? b.taps.length - a.taps.length : b.misclicks - a.misclicks || b.taps.length - a.taps.length));
      const hot = ranked[0];
      if (hot && hot.taps.length > 0 && (firstClick || hot.misclicks > 0)) {
        const name = screen(hot.path);
        slides.push({
          kind: 'heatmap',
          id: `heatmap-${task.taskId}`,
          blockId: task.taskId,
          screen: hot.path,
          screenName: name,
          firstClick,
          visitors: hot.visitors,
          taps: hot.taps.length,
          misclicks: hot.misclicks,
          topMisclicks: hot.topMisclicks.slice(0, 3),
          title: firstClick ? `Dónde tocaron primero en «${name}»` : `Dónde tocaron en «${name}»`,
          takeaway: firstClick
            ? `${wins(task)} de ${plural(task.decided, 'persona', 'personas')} ${wins(task) === 1 ? 'acertó' : 'acertaron'}. Verde: acertó; rojo: tocó en otro lado.`
            : (report.insights.find((i) => i.topic === 'misclicks' && i.blockId === task.taskId && i.screen === hot.path)?.text ??
              (hot.misclicks === 1
              ? `1 toque sin efecto de ${hot.taps.length}: algo parece tocable y no lo es.`
              : `${hot.misclicks} de ${hot.taps.length} toques no tuvieron efecto: algo parece tocable y no lo es.`)),
        });
      }
      continue;
    }

    const q = report.questions.find((x) => x.blockId === item.blockId);
    if (!q || q.responses === 0) continue;
    const base = { id: `question-${q.blockId}`, blockId: q.blockId, questionKind: q.kind, label: BLOCK_KIND_LABELS[q.kind], responses: q.responses, title: q.question || 'Pregunta sin texto' };
    const bars = (q.distribution ?? []).map((d) => {
      const share = d.count / Math.max(1, q.responses);
      return { label: d.label, count: d.count, share, value: `${d.count} · ${pct(share)}` };
    });
    const answered = plural(q.responses, 'respuesta', 'respuestas');
    if (q.kind === 'scale') {
      const block = blocks.get(q.blockId);
      const ends = block && block.kind === 'scale' && block.minLabel && block.maxLabel ? ` 1 = ${block.minLabel}; ${q.max} = ${block.maxLabel}.` : '';
      slides.push({
        ...base,
        kind: 'question',
        ...(q.average !== undefined ? { average: q.average } : {}),
        ...(q.max !== undefined ? { max: q.max } : {}),
        bars,
        takeaway: `${q.average !== undefined ? `Promedio ${decimal(q.average)} de ${q.max ?? ''}` : 'Sin promedio'}, con ${answered}.${ends}`,
      });
    } else if (q.kind === 'text') {
      const quotes = (q.texts ?? [])
        .filter((t) => t.text.trim())
        .slice(0, MAX_QUOTES)
        .map((t) => {
          const at = order.indexOf(t.sessionId);
          return { who: at >= 0 ? `P${at + 1}` : 'Participante', text: clip(t.text, QUOTE_CHARS) };
        });
      if (quotes.length === 0) continue;
      const more = (q.texts?.length ?? 0) - quotes.length;
      slides.push({ ...base, kind: 'question', quotes, takeaway: more > 0 ? `${answered}; aquí van ${quotes.length}. El resto está en el reporte.` : answered });
    } else {
      const best = [...bars].sort((a, b) => b.count - a.count)[0];
      slides.push({
        ...base,
        kind: 'question',
        bars,
        takeaway: best ? `Lo más elegido: «${best.label}» (${best.count} de ${q.responses}).${multiple(q.blockId) ? ' Se podía elegir más de una.' : ''}` : answered,
      });
    }
  }

  // ── Qué arreglar primero ──
  // Primero lo que se arregla en el diseño, en el orden de gravedad de las frases; después, lo
  // que falta en el estudio (marcar resultados, más personas).
  const steps: DeckItem[] = [];
  const covered = new Set<string>();
  const push = (text: string | undefined, key?: string): void => {
    if (!text || steps.some((x) => x.text === text)) return;
    steps.push({ text, tone: 'problem' });
    if (key) covered.add(key);
  };
  const problems = report.insights.filter((i) => i.level !== 'good');
  const later = new Set(['review', 'small-sample', 'completion']);
  for (const i of problems.filter((x) => !later.has(x.topic ?? ''))) {
    push(nextStep(i, report, screen), i.topic === 'misclicks' ? `screen:${i.blockId}:${i.screen}` : i.blockId && `task:${i.blockId}`);
  }
  // Otras tareas con menos de 80 % de éxito y otras pantallas con varios toques sin efecto.
  for (const t of [...report.tasks].filter((x) => x.decided > 0 && x.successRate < 0.8).sort((a, b) => a.successRate - b.successRate)) {
    if (!covered.has(`task:${t.taskId}`)) push(nextStep({ level: 'warn', topic: 'lowest-success', text: '', blockId: t.taskId }, report, screen), `task:${t.taskId}`);
  }
  for (const t of report.tasks) {
    for (const sc of t.screens) {
      if (sc.misclicks >= 3 && !covered.has(`screen:${t.taskId}:${sc.path}`)) push(nextStep({ level: 'warn', topic: 'misclicks', text: '', blockId: t.taskId, screen: sc.path }, report, screen), `screen:${t.taskId}:${sc.path}`);
    }
  }
  for (const i of problems.filter((x) => later.has(x.topic ?? ''))) push(nextStep(i, report, screen));
  steps.splice(MAX_STEPS);
  if (steps.length === 0) steps.push({ text: 'Nada urgente: ninguna tarea mostró problemas serios. Prueba con más personas o con tareas más difíciles.', tone: 'good' });
  slides.push({ kind: 'next-steps', id: 'next-steps', title: 'Qué arreglar primero', items: steps });

  // ── Cómo se midió ──
  const method: DeckItem[] = [];
  const oneDay = starts.length > 0 && !when.includes(' al ');
  method.push({ text: `${plural(n, 'participante', 'participantes')}${when ? `, ${oneDay ? 'el' : 'del'} ${when}` : ''}. ${report.completed === n ? 'Todos llegaron al final.' : `${report.completed} llegaron al final.`}` });
  const aside: string[] = [];
  if (report.bounced > 0) aside.push(report.bounced === 1 ? '1 entró y salió sin empezar' : `${report.bounced} entraron y salieron sin empezar`);
  if (report.excluded > 0) aside.push(plural(report.excluded, 'sesión excluida a mano', 'sesiones excluidas a mano'));
  if (aside.length) method.push({ text: `No cuentan: ${aside.join('; ')}.` });
  const tasks = taskBlocks(study).filter((b) => report.tasks.some((t) => t.taskId === b.id && t.participants > 0));
  const manualCount = tasks.filter((b) => (b.success?.type ?? 'manual') === 'manual').length;
  const ruleCount = tasks.length - manualCount;
  if (tasks.length) {
    const parts: string[] = [];
    if (ruleCount) parts.push(`${plural(ruleCount, 'tarea se decidió', 'tareas se decidieron')} con una regla automática (llegar a una pantalla, tocar un elemento o ver un texto)`);
    if (manualCount) parts.push(`${plural(manualCount, 'tarea la decidiste', 'tareas las decidiste')} tú al ver la grabación`);
    method.push({ text: `${parts.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()) });
  }
  const scoreDef = REPORT_DEFINITIONS.find((d) => d.term.startsWith('Puntaje de una tarea'));
  if (scoreDef) method.push({ text: `Puntaje: ${scoreDef.text}` });
  if (filter) method.push({ text: `${filter}.` });
  if (n < 5) method.push({ text: smallSampleText(n) });
  method.push({ text: 'Las frases salen de reglas fijas sobre los números, sin IA: el mismo estudio da siempre la misma presentación.' });
  slides.push({ kind: 'method', id: 'method', title: 'Cómo se midió', items: method });

  return { title: study.name || 'Estudio sin nombre', slides };
}

// ── Ediciones del diseñador (el panel las guarda en el navegador) ──

export interface SlideEdit {
  hidden?: boolean;
  title?: string;
  takeaway?: string;
  /** Texto nuevo de un punto de la lista, por su posición. */
  items?: Record<string, string>;
}

export type DeckEdits = Record<string, SlideEdit>;

/**
 * La presentación con las ediciones aplicadas: títulos, frases y puntos cambiados, y las
 * diapositivas escondidas marcadas con `hidden` (siguen en la lista). Una edición de una
 * diapositiva que ya no existe se ignora; un texto vacío deja el original.
 */
export function applyDeckEdits(deck: Deck, edits: DeckEdits | null | undefined): Deck {
  if (!edits) return deck;
  const slides = deck.slides.map((slide): Slide => {
    const e = edits[slide.id];
    if (!e) return slide;
    const out = { ...slide };
    if (e.hidden) out.hidden = true;
    if (typeof e.title === 'string' && e.title.trim()) out.title = e.title.trim();
    if (typeof e.takeaway === 'string' && e.takeaway.trim() && slide.takeaway !== undefined) out.takeaway = e.takeaway.trim();
    if (e.items && slide.items) {
      out.items = slide.items.map((item, i) => {
        const text = e.items?.[String(i)];
        return typeof text === 'string' && text.trim() ? { ...item, text: text.trim() } : item;
      });
    }
    return out as Slide;
  });
  const cover = slides.find((s) => s.kind === 'cover');
  return { title: cover?.title ?? deck.title, slides };
}

/** Las diapositivas que salen en las descargas (sin las escondidas). */
export function visibleSlides(deck: Deck): Slide[] {
  return deck.slides.filter((s) => !s.hidden);
}

/** Nombre de archivo a partir del nombre del estudio: "compra-en-verde-presentacion". */
export function deckFileName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${slug || 'estudio'}-presentacion`;
}
