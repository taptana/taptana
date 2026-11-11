/**
 * El reporte de un estudio resumido para un modelo: los números que sirven para decidir qué
 * arreglar, sin puntos de mapas de calor, sin filas por participante y sin nombres.
 */

import { OUTCOME_LABELS, type StudyReport, type TaskReport, type QuestionReport } from '@taptana/shared';

/** Respuestas abiertas por pregunta: más que esto no le cabe bien a un modelo chico. */
export const MAX_TEXTS = 40;

const pct = (rate: number): number => Math.round(rate * 100);
const seconds = (ms: number | null | undefined): number | null => (ms == null ? null : Math.round(ms / 100) / 10);

function screenNamer(report: StudyReport): (id: string) => string {
  return (id) => report.screenNames[id] ?? id;
}

function taskSummary(task: TaskReport, name: (id: string) => string) {
  const funnel = task.funnel.map((step, i) => {
    const before = i === 0 ? task.participants : (task.funnel[i - 1]?.reached ?? task.participants);
    return { screen: step.path, name: name(step.path), reached: step.reached, droppedHere: Math.max(0, before - step.reached) };
  });
  const misclickScreens = task.screens
    .filter((s) => s.misclicks > 0)
    .sort((a, b) => b.misclicks - a.misclicks)
    .slice(0, 3)
    .map((s) => ({ screen: s.path, name: name(s.path), misclicks: s.misclicks, mostTapped: s.topMisclicks.slice(0, 3) }));
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
    howToRead:
      'score: puntaje de usabilidad de 0 a 100 (null si aún no hay datos). successPercent: tareas logradas sobre intentos decididos. ' +
      'funnel: cuántos llegaron a cada pantalla del camino esperado; droppedHere es cuántos se perdieron antes de esa pantalla. ' +
      'pendingReview: tareas manuales que el diseñador todavía no marca en el panel.',
  };
}
