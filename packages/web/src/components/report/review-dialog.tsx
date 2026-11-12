import { useEffect, useState } from 'react';
import { Check, PlayCircle, Undo2, X } from 'lucide-react';
import type { StudyReport } from '@taptana/shared';
import { getClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { friendlyError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { Link } from '@/router';
import { recordingRoute, useReport } from './context.tsx';

/** "Revisar pendientes": los resultados de tareas manuales que falta decidir, para marcarlos aquí. */
export function ReviewDialog({ report, open, onOpenChange }: { report: StudyReport; open: boolean; onOpenChange: (open: boolean) => void }) {
  const ctx = useReport();
  const [saving, setSaving] = useState<string | null>(null);
  // Lo que se marcó en esta visita sigue en la lista, para poder cambiarlo o quitar la marca.
  const [marked, setMarked] = useState<Map<string, 'success' | 'failure'>>(new Map());
  useEffect(() => {
    if (open) setMarked(new Map());
  }, [open]);
  const pending = report.tasks.flatMap((task) =>
    task.results.filter((r) => r.outcome === 'review' || marked.has(`${r.sessionId}:${task.taskId}`)).map((row) => ({ task, row })),
  );
  const left = pending.filter(({ task, row }) => !marked.has(`${row.sessionId}:${task.taskId}`)).length;

  const mark = async (sessionId: string, taskId: string, value: 'success' | 'failure' | null): Promise<void> => {
    const key = `${sessionId}:${taskId}`;
    setSaving(key);
    try {
      const client = await getClient();
      await client.setManualResults(sessionId, { [taskId]: value });
      setMarked((m) => {
        const next = new Map(m);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      });
      await ctx.reload();
      toast.success(value === 'success' ? 'Marcado como logrado.' : value === 'failure' ? 'Marcado como no logrado.' : 'Marca quitada: vuelve a estar por revisar.');
    } catch (e) {
      toast.error(friendlyError(e, 'No se pudo guardar la marca. Inténtalo de nuevo.'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Resultados por revisar</DialogTitle>
          <DialogDescription>
            En estas tareas decides tú si la persona lo logró. Mira la grabación desde el inicio de la tarea y marca el resultado; mientras tanto no cuentan en el éxito ni en el puntaje. Si te equivocas, usa «Quitar marca».
            {pending.length > 0 && left === 0 && ' Ya no queda nada por revisar.'}
          </DialogDescription>
        </DialogHeader>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No queda nada por revisar.</p>
        ) : (
          <ul className="divide-y border-y">
            {pending.map(({ task, row }) => {
              const key = `${row.sessionId}:${task.taskId}`;
              const who = ctx.names.get(row.sessionId) ?? row.who ?? 'Participante';
              const value = marked.get(key);
              return (
                <li key={key} className="p-3 space-y-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{who}</div>
                    <div className="text-sm text-muted-foreground break-words">{task.title}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={recordingRoute(ctx, row.sessionId, row.startedAt)}>
                        <PlayCircle />
                        Ver grabación
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving !== null}
                      aria-pressed={value === 'success'}
                      className={cn(value === 'success' && 'border-emerald-600/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20')}
                      onClick={() => void mark(row.sessionId, task.taskId, 'success')}
                    >
                      <Check />
                      Lo logró
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving !== null}
                      aria-pressed={value === 'failure'}
                      className={cn(value === 'failure' && 'border-red-600/50 bg-red-500/15 text-red-700 dark:text-red-400 hover:bg-red-500/20')}
                      onClick={() => void mark(row.sessionId, task.taskId, 'failure')}
                    >
                      <X />
                      No lo logró
                    </Button>
                    {value && (
                      <Button variant="ghost" size="sm" disabled={saving !== null} onClick={() => void mark(row.sessionId, task.taskId, null)}>
                        <Undo2 />
                        Quitar marca
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
