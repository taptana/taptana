import { needsReview, type Block, type TaskOutcome, type TaskResult } from '@taptana/shared';
export { taskTally as summarizeTasks } from './sessions.ts';

/** Resultado de una tarea para una sesión, con las mismas palabras que el reporte. */
export const OUTCOME_LABEL: Record<TaskOutcome, string> = {
  success: 'Lo logró',
  reported: 'Dijo que terminó',
  failed: 'No pudo',
  incomplete: 'Sin terminar',
  pending: 'No empezó',
};

const REVIEW_CLASS = 'border-sky-600/40 text-sky-700 dark:text-sky-400 bg-sky-500/10';

/** Clases de color por resultado, pensadas para Badge variant="outline". */
export const OUTCOME_CLASS: Record<TaskOutcome, string> = {
  success: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10',
  reported: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/10',
  failed: 'border-red-600/40 text-red-700 dark:text-red-400 bg-red-500/10',
  incomplete: 'border-border text-muted-foreground',
  pending: 'border-border text-muted-foreground',
};

/** Etiqueta y color del resultado; una tarea manual sin decidir sale como "Por revisar". */
export function outcomeBadge(block: Block | undefined, result: TaskResult): { label: string; className: string } {
  if (needsReview(block, result)) return { label: 'Por revisar', className: REVIEW_CLASS };
  return { label: OUTCOME_LABEL[result.outcome], className: OUTCOME_CLASS[result.outcome] };
}
