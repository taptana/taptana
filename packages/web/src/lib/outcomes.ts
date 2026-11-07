import type { TaskOutcome, TaskResult } from '@taptana/shared';

export const OUTCOME_LABEL: Record<TaskOutcome, string> = {
  success: 'Logró',
  reported: 'Dijo que terminó',
  failed: 'No pudo',
  incomplete: 'Sin terminar',
  pending: 'No empezó',
};

/** Clases de color por resultado, pensadas para Badge variant="outline". */
export const OUTCOME_CLASS: Record<TaskOutcome, string> = {
  success: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10',
  reported: 'border-amber-600/40 text-amber-700 dark:text-amber-400 bg-amber-500/10',
  failed: 'border-red-600/40 text-red-700 dark:text-red-400 bg-red-500/10',
  incomplete: 'border-border text-muted-foreground',
  pending: 'border-border text-muted-foreground',
};

/** "2/3" logradas, para la lista de sesiones. */
export function summarizeTasks(tasks: TaskResult[] | undefined): { done: number; total: number } | null {
  if (!tasks || tasks.length === 0) return null;
  return { done: tasks.filter((t) => t.outcome === 'success').length, total: tasks.length };
}
