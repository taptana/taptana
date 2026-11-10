import { useState } from 'react';
import { Check, PlayCircle, X } from 'lucide-react';
import type { StudyReport } from '@taptana/shared';
import { getClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { friendlyError } from '@/lib/errors';
import { Link } from '@/router';
import { recordingRoute, useReport } from './context.tsx';

/** "Revisar pendientes": los resultados de tareas manuales que falta decidir, para marcarlos aquí. */
export function ReviewDialog({ report, open, onOpenChange }: { report: StudyReport; open: boolean; onOpenChange: (open: boolean) => void }) {
  const ctx = useReport();
  const [saving, setSaving] = useState<string | null>(null);
  const pending = report.tasks.flatMap((task) => task.results.filter((r) => r.outcome === 'review').map((row) => ({ task, row })));

  const mark = async (sessionId: string, taskId: string, value: 'success' | 'failure'): Promise<void> => {
    setSaving(`${sessionId}:${taskId}`);
    try {
      const client = await getClient();
      await client.setManualResults(sessionId, { [taskId]: value });
      await ctx.reload();
      toast.success(value === 'success' ? 'Marcado como logrado.' : 'Marcado como no logrado.');
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
            En estas tareas decides tú si la persona lo logró. Mira la grabación desde el inicio de la tarea y marca el resultado; mientras tanto no cuentan en el éxito ni en el puntaje.
          </DialogDescription>
        </DialogHeader>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No queda nada por revisar.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {pending.map(({ task, row }) => {
              const key = `${row.sessionId}:${task.taskId}`;
              const who = ctx.names.get(row.sessionId) ?? row.who ?? 'Participante';
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
                    <Button variant="outline" size="sm" disabled={saving !== null} onClick={() => void mark(row.sessionId, task.taskId, 'success')}>
                      <Check />
                      Lo logró
                    </Button>
                    <Button variant="outline" size="sm" disabled={saving !== null} onClick={() => void mark(row.sessionId, task.taskId, 'failure')}>
                      <X />
                      No lo logró
                    </Button>
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
