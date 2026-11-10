/**
 * "Lo más importante" de un reporte: de 2 a 6 frases en español que dicen qué pasó y qué
 * arreglar, de más a menos grave. Salen de reglas fijas sobre los números del reporte: aquí no
 * hay ningún modelo de IA, así que el mismo reporte da siempre las mismas frases.
 */

import type { Insight, StudyReport, TaskReport } from './report.js';
import { screenLabel } from './screen.js';
import { questionBlocks, type StudyRecord } from './study.js';

const MAX_INSIGHTS = 6;
const MIN_INSIGHTS = 2;
/** Espacio que no se parte, entre un número y su unidad ("33 %", "45 s"). */
const NBSP = ' ';

type Candidate = Insight & { weight: number };

const pct = (x: number): string => `${Math.round(x * 100)}${NBSP}%`;
const people = (n: number): string => (n === 1 ? '1 persona' : `${n} personas`);
const quote = (s: string): string => `«${s.length > 60 ? `${s.slice(0, 57).trimEnd()}…` : s}»`;
const decimal = (x: number): string => String(Math.round(x * 10) / 10).replace('.', ',');
/** Elige singular o plural según cuántos son. */
const form = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}${NBSP}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m}${NBSP}min ${s}${NBSP}s` : `${m}${NBSP}min`;
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

function middle(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

const wins = (t: TaskReport): number => t.outcomes.direct + t.outcomes.indirect;

function screenName(task: TaskReport, path: string): string {
  return task.screens.find((s) => s.path === path)?.title ?? screenLabel(path);
}

export function buildInsights(report: Omit<StudyReport, 'insights'>, study: StudyRecord): Insight[] {
  const n = report.participants;
  if (n === 0) return [];

  const found: Candidate[] = [];
  const add = (level: Insight['level'], weight: number, text: string, extra: { blockId?: string; screen?: string } = {}): void => {
    found.push({ level, weight, text, ...extra });
  };
  const decided = report.tasks.filter((t) => t.decided > 0);
  // Con resultados por revisar, la tasa de una tarea todavía es provisional: no se usa para
  // decir cuál salió peor o mejor.
  const settled = decided.filter((t) => t.outcomes.review === 0);

  // 1. La tarea con menor éxito.
  const lowest = [...settled].sort((a, b) => a.successRate - b.successRate || b.decided - a.decided)[0];
  if (lowest && lowest.successRate < 0.8) {
    const ok = wins(lowest);
    const who = `${ok} de ${people(lowest.decided)}`;
    const title = quote(lowest.title);
    let text: string;
    if (lowest.kind === 'first-click') {
      text =
        ok === 0
          ? `Nadie acertó el primer clic en ${title} (0 de ${people(lowest.decided)}).`
          : `En ${title}, ${who} ${form(ok, 'acertó', 'acertaron')} el primer clic (${pct(lowest.successRate)}).`;
    } else {
      const { failed, incomplete, reported } = lowest.outcomes;
      const rest: string[] = [];
      if (failed) rest.push(`${failed} ${form(failed, 'dijo que no pudo', 'dijeron que no pudieron')}`);
      if (incomplete) rest.push(`${incomplete} la ${form(incomplete, 'dejó', 'dejaron')} sin terminar`);
      if (reported) rest.push(`${reported} ${form(reported, 'creyó', 'creyeron')} haber terminado sin lograrlo`);
      if (ok === 0) text = `Nadie logró ${title}: ${list(rest)}.`;
      else if (settled.length > 1) text = `${title} es la tarea con menor éxito: la ${form(ok, 'logró', 'lograron')} ${who} (${pct(lowest.successRate)}).`;
      else text = `${who} ${form(ok, 'logró', 'lograron')} ${title} (${pct(lowest.successRate)}).`;
      if (ok > 0 && rest.length) text += ` Del resto: ${list(rest)}.`;
    }
    add(lowest.successRate < 0.5 ? 'bad' : 'warn', 100 - lowest.successRate * 50, text, { blockId: lowest.taskId });
  }

  // 2. El paso del embudo con mayor caída.
  let drop: { task: TaskReport; i: number; from: number; lost: number; ratio: number } | undefined;
  for (const task of report.tasks) {
    if (task.kind !== 'task') continue;
    for (let i = 0; i + 1 < task.funnel.length; i++) {
      const from = task.funnel[i]?.reached ?? 0;
      const lost = from - (task.funnel[i + 1]?.reached ?? 0);
      if (from < 1 || lost < 1) continue;
      const ratio = lost / from;
      if (!drop || lost > drop.lost || (lost === drop.lost && ratio > drop.ratio)) drop = { task, i, from, lost, ratio };
    }
  }
  if (drop && drop.ratio >= 0.25) {
    const a = drop.task.funnel[drop.i]?.path ?? '';
    const b = drop.task.funnel[drop.i + 1]?.path ?? '';
    add(
      drop.ratio >= 0.5 && drop.lost >= 2 ? 'bad' : 'warn',
      40 + drop.ratio * 40,
      `En ${quote(drop.task.title)}, ${drop.lost} de ${people(drop.from)} que ${form(drop.from, 'llegó', 'llegaron')} a ${quote(screenName(drop.task, a))} no ${form(drop.lost, 'siguió', 'siguieron')} a ${quote(screenName(drop.task, b))}: es el paso con mayor caída.`,
      { blockId: drop.task.taskId, screen: a },
    );
  }

  // 3. La pantalla con más misclicks y su elemento más tocado sin efecto.
  let noisy: { task: TaskReport; screen: TaskReport['screens'][number] } | undefined;
  for (const task of report.tasks) {
    for (const screen of task.screens) {
      if (screen.misclicks >= 2 && (!noisy || screen.misclicks > noisy.screen.misclicks)) noisy = { task, screen };
    }
  }
  if (noisy) {
    const { screen, task } = noisy;
    const share = screen.taps.length ? screen.misclicks / screen.taps.length : 0;
    const top = screen.topMisclicks[0];
    const most = top ? `; lo más tocado fue ${quote(top.label)} (${top.count} ${form(top.count, 'vez', 'veces')})` : '';
    add(
      screen.misclicks >= 5 && share >= 0.4 ? 'bad' : 'warn',
      30 + Math.min(30, screen.misclicks * 3),
      `En la pantalla ${quote(screen.title ?? screenLabel(screen.path))} hubo ${screen.misclicks} toques sin efecto${most}. Revisa si parece tocable sin serlo.`,
      { blockId: task.taskId, screen: screen.path },
    );
  }

  // 4. La tarea más lenta.
  const timed = report.tasks
    .filter((t): t is TaskReport & { medianTimeMs: number } => t.kind === 'task' && t.medianTimeMs !== null)
    .sort((a, b) => b.medianTimeMs - a.medianTimeMs);
  const slow = timed[0];
  if (slow && timed.length >= 2) {
    const others = middle(timed.slice(1).map((t) => t.medianTimeMs));
    if (slow.medianTimeMs >= 20_000 && slow.medianTimeMs >= 1.5 * others) {
      add(
        'warn',
        45,
        `${quote(slow.title)} es la tarea más lenta: ${duration(slow.medianTimeMs)} de mediana entre quienes la lograron, frente a ${duration(others)} de ${form(timed.length - 1, 'la otra', 'las demás')}.`,
        { blockId: slow.taskId },
      );
    }
  } else if (slow && slow.medianTimeMs >= 120_000) {
    add('warn', 35, `Quienes lograron ${quote(slow.title)} tardaron ${duration(slow.medianTimeMs)} de mediana.`, { blockId: slow.taskId });
  }

  // 5. Resultados por revisar.
  const pending = report.pendingReview;
  if (pending > 0) {
    const waiting = report.tasks.filter((t) => t.outcomes.review > 0);
    const first = waiting[0];
    const where =
      waiting.length === 1 && first ? `${quote(first.title)}, una tarea que decides tú` : `${waiting.length} tareas que decides tú`;
    add(
      'warn',
      90,
      `Hay ${pending} ${form(pending, 'resultado', 'resultados')} por revisar en ${where}. Hasta que ${form(pending, 'lo', 'los')} marques no ${form(pending, 'cuenta', 'cuentan')} en el éxito ni en el puntaje.`,
      first ? { blockId: first.taskId } : {},
    );
  }

  // 6. La pregunta de escala con peor promedio (y la mejor, si salió bien).
  const blocks = new Map(questionBlocks(study).map((b) => [b.id, b]));
  const scales = report.questions
    .filter((q): q is typeof q & { average: number; max: number } => q.kind === 'scale' && q.average !== undefined && q.max !== undefined && q.max > 1)
    .map((q) => ({ q, norm: (q.average - 1) / (q.max - 1) }))
    .sort((a, b) => a.norm - b.norm);
  const scaleText = (q: (typeof scales)[number]['q']): string => {
    const block = blocks.get(q.blockId);
    const ends =
      block && block.kind === 'scale' && block.minLabel && block.maxLabel
        ? `; 1 = ${quote(block.minLabel)}, ${q.max} = ${quote(block.maxLabel)}`
        : '';
    return `${quote(q.question)} promedió ${decimal(q.average)} de ${q.max} (${q.responses} ${form(q.responses, 'respuesta', 'respuestas')}${ends})`;
  };
  const worstScale = scales[0];
  const bestScale = scales[scales.length - 1];
  if (worstScale && worstScale.norm < 0.6) {
    add(
      worstScale.norm < 0.4 ? 'bad' : 'warn',
      45 - worstScale.norm * 30,
      `${scaleText(worstScale.q)}${scales.length > 1 ? ': es la pregunta con la nota más baja' : ''}.`,
      { blockId: worstScale.q.blockId },
    );
  }
  if (bestScale && bestScale.norm >= 0.8) {
    add('good', 50, `${scaleText(bestScale.q)}.`, { blockId: bestScale.q.blockId });
  }

  // 7. Éxito con rodeos: lo logran, pero no por donde se esperaba.
  const detour = settled
    .filter((t) => t.kind === 'task' && wins(t) >= 2 && t.outcomes.indirect > t.outcomes.direct && t.successRate >= 0.5)
    .sort((a, b) => b.outcomes.indirect / wins(b) - a.outcomes.indirect / wins(a))[0];
  if (detour) {
    const k = detour.outcomes.indirect;
    add(
      'warn',
      30,
      `En ${quote(detour.title)}, ${k} de ${people(wins(detour))} que lo lograron ${form(k, 'dio', 'dieron')} un rodeo: no ${form(k, 'siguió', 'siguieron')} el camino ${detour.expectedPathInferred ? 'más corto' : 'esperado'}.`,
      { blockId: detour.taskId },
    );
  }

  // 8. Pocas personas terminaron el estudio.
  const completion = report.completed / n;
  if (completion < 0.6) {
    let text: string;
    if (report.completed > 0) text = `Solo ${report.completed} de ${people(n)} ${form(report.completed, 'llegó', 'llegaron')} al final del estudio.`;
    else text = n === 1 ? 'La única persona que participó no llegó al final del estudio.' : `Ninguna de las ${n} personas llegó al final del estudio.`;
    add('warn', 55, text);
  }

  // 9. Muestra chica.
  if (n < 5) {
    add('warn', 5, `Con ${people(n)} los porcentajes cambian mucho de una persona a otra. Con 5 ya aparece la mayoría de los problemas.`);
  }

  // 10. Lo que salió bien.
  const solid = settled.filter((t) => t.successRate >= 0.8 && t.decided >= 2);
  if (decided.length >= 2 && solid.length === decided.length) {
    add('good', 80, `Las ${decided.length} tareas tienen ${pct(0.8)} de éxito o más.`);
  } else {
    const best = [...solid].sort((a, b) => b.successRate - a.successRate || b.directRate - a.directRate)[0];
    if (best) {
      const ok = wins(best);
      const verb = best.kind === 'first-click' ? 'acertaron el primer clic en' : 'lograron';
      const who = ok === best.decided ? `Las ${ok} personas` : `${ok} de ${people(best.decided)}`;
      const direct =
        best.kind === 'task' && !best.expectedPathInferred && best.outcomes.direct === ok ? ', todas por el camino esperado' : '';
      const rate = ok === best.decided ? '' : ` (${pct(best.successRate)})`;
      add('good', 60, `${who} ${verb} ${quote(best.title)}${rate}${direct}.`, { blockId: best.taskId });
    }
  }
  if (report.score !== null && report.score >= 80) {
    add('good', 70, `Puntaje de usabilidad: ${report.score} de 100. El flujo se entiende bien.`);
  }

  // De más a menos grave. Si no caben todas, se guarda un lugar para algo que salió bien.
  const rank = { bad: 0, warn: 1, good: 2 } as const;
  found.sort((a, b) => rank[a.level] - rank[b.level] || b.weight - a.weight);
  let picked = found.slice(0, MAX_INSIGHTS);
  const praise = found.find((c) => c.level === 'good');
  if (praise && !picked.includes(praise)) picked = [...picked.slice(0, MAX_INSIGHTS - 1), praise];

  // Con muy pocos datos, al menos decir cuántos participaron y cuántos terminaron.
  if (picked.length < MIN_INSIGHTS && completion >= 0.6) {
    const all = report.completed === n;
    picked.push({
      level: 'good',
      weight: 0,
      text: all
        ? `${n === 1 ? 'La única persona que participó llegó' : `Las ${n} personas llegaron`} al final del estudio.`
        : `${report.completed} de ${people(n)} ${form(report.completed, 'llegó', 'llegaron')} al final del estudio.`,
    });
  }
  if (picked.length < MIN_INSIGHTS) {
    const time = report.medianDurationMs === null ? '' : ` La sesión duró ${duration(report.medianDurationMs)} de mediana.`;
    picked.push({
      level: 'good',
      weight: 0,
      text: `${n === 1 ? 'Participó 1 persona' : `Participaron ${n} personas`}.${time}`,
    });
  }

  return picked.map(({ weight: _weight, ...insight }) => insight);
}
