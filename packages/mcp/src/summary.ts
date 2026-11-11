/**
 * El reporte de un estudio resumido para un modelo: los números que sirven para decidir qué
 * arreglar, sin puntos de mapas de calor, sin filas por participante y sin nombres.
 */

import { OUTCOME_LABELS, REPORT_DEFINITIONS, type StudyReport, type TaskReport, type QuestionReport } from '@taptana/shared';

/** Respuestas abiertas por pregunta: más que esto no le cabe bien a un modelo chico. */
export const MAX_TEXTS = 40;

const pct = (rate: number): number => Math.round(rate * 100);
const seconds = (ms: number | null | undefined): number | null => (ms == null ? null : Math.round(ms / 100) / 10);

/** Cada pantalla sale igual en todo el resumen: su id (para usar en reglas) y su nombre. */
export interface ScreenRef {
  id: string;
  name: string;
}

function screenNamer(report: StudyReport): (id: string) => ScreenRef {
  return (id) => ({ id, name: report.screenNames[id] ?? id });
}

/** Las oraciones de "Cómo se calcula" del panel (REPORT_DEFINITIONS), tal cual. */
function sentences(term: string): string[] {
  const text = REPORT_DEFINITIONS.find((d) => d.term === term)?.text;
  if (!text) throw new Error(`Falta la definición «${term}».`);
  return text.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ"])/);
}

export const HOW_TO_READ = {
  fields:
    'successPercent: tareas logradas sobre intentos decididos. funnel: cuántos llegaron a cada pantalla del camino esperado; droppedHere es cuántos se perdieron antes de esa pantalla. ' +
    'pendingReview: tareas manuales que el diseñador todavía no marca en el panel. Cada pantalla viene como { id, name }: el id es el que se usa en las reglas del estudio.',
  expectedPathInferred: `true cuando el diseñador no escribió el camino esperado. ${sentences('Éxito directo e indirecto').find((x) => x.startsWith('Si la tarea no tiene camino esperado')) ?? ''}`,
  score: `Puntaje de una tarea: ${sentences('Puntaje de una tarea (0 a 100)')[0]} Puntaje del estudio: ${lowerFirst(sentences('Puntaje del estudio')[0] ?? '')}`,
};

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function taskSummary(task: TaskReport, name: (id: string) => ScreenRef) {
  const funnel = task.funnel.map((step, i) => {
    const before = i === 0 ? task.participants : (task.funnel[i - 1]?.reached ?? task.participants);
    return { screen: name(step.path), reached: step.reached, droppedHere: Math.max(0, before - step.reached) };
  });
  const misclickScreens = task.screens
    .filter((s) => s.misclicks > 0)
    .sort((a, b) => b.misclicks - a.misclicks)
    .slice(0, 3)
    .map((s) => ({ screen: name(s.path), misclicks: s.misclicks, mostTapped: s.topMisclicks.slice(0, 3) }));
  return {
    id: task.taskId,
    title: task.title,
    kind: task.kind,
    participants: task.participants,
    decided: task.decided,
    outcomes: task.outcomes,
    successPercent: pct(task.successRate),
    directPercent: pct(task.directRate),
    score: task.score,
    medianSeconds: seconds(task.medianTimeMs),
    misclickPercent: pct(task.misclickRate),
    expectedPath: task.expectedPath.map(name),
    expectedPathInferred: task.expectedPathInferred,
    funnel,
    topPaths: task.paths.slice(0, 3).map((p) => ({ screens: p.pages.map(name), count: p.count, successes: p.successes })),
    misclickScreens,
    ...(task.byVariant.length > 0 && {
      byVariant: task.byVariant.map((v) => ({
        variantId: v.variantId,
        participants: v.participants,
        successPercent: pct(v.successRate),
        directPercent: pct(v.directRate),
        medianSeconds: seconds(v.medianTimeMs),
        score: v.score,
      })),
    }),
  };
}

function questionSummary(q: QuestionReport) {
  const texts = q.texts?.map((t) => t.text) ?? [];
  return {
    id: q.blockId,
    kind: q.kind,
    question: q.question,
    responses: q.responses,
    skipped: q.skipped,
    ...(q.average !== undefined && { average: q.average }),
    ...(q.max !== undefined && { max: q.max }),
    ...(q.distribution && { distribution: q.distribution }),
    ...(q.texts && { answers: texts.slice(0, MAX_TEXTS) }),
    ...(texts.length > MAX_TEXTS && { moreAnswers: texts.length - MAX_TEXTS }),
  };
}

export function summarizeReport(report: StudyReport, study: { id: string; name: string }) {
  const name = screenNamer(report);
  return {
    study: { id: study.id, name: study.name },
    ...(report.filter && { filter: report.filter }),
    participants: report.participants,
    completed: report.completed,
    leftWithoutStarting: report.bounced,
    excluded: report.excluded,
    pendingReview: report.pendingReview,
    devices: report.devices,
    score: report.score,
    successPercent: pct(report.successRate),
    medianMinutes: report.medianDurationMs == null ? null : Math.round(report.medianDurationMs / 6000) / 10,
    avgMisclickPercent: pct(report.avgMisclickRate),
    insights: report.insights.map((i) => ({ level: i.level, text: i.text, ...(i.blockId && { blockId: i.blockId }) })),
    tasks: report.tasks.map((t) => taskSummary(t, name)),
    questions: report.questions.map(questionSummary),
    ...(report.variants.length > 0 && {
      variants: report.variants.map((v) => ({
        id: v.id,
        name: v.name,
        participants: v.participants,
        successPercent: pct(v.successRate),
        score: v.score,
      })),
    }),
    outcomeLabels: OUTCOME_LABELS,
    howToRead: HOW_TO_READ,
  };
}
