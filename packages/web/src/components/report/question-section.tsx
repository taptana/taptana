import { PlayCircle } from 'lucide-react';
import type { QuestionReport } from '@taptana/shared';
import { cn } from '@/lib/utils';
import { pct, plural } from '@/lib/format';
import { Link } from '@/router';
import { recordingRoute, useReport } from './context.tsx';

function Bars({ items, total, highlight }: { items: Array<{ label: string; count: number }>; total: number; highlight?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(3rem,auto)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="max-w-40 sm:max-w-64 break-words">{item.label}</span>
          <span className="h-6 rounded bg-muted overflow-hidden" aria-hidden="true">
            <span className={cn('block h-full rounded', highlight && item.count === max && item.count > 0 ? 'bg-primary' : 'bg-primary/50')} style={{ width: `${(item.count / max) * 100}%` }} />
          </span>
          <span className="tabular-nums text-muted-foreground whitespace-nowrap">
            <span className="text-foreground font-medium">{item.count}</span> · {total > 0 ? pct(item.count / total) : '0 %'}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Respuestas a un bloque de pregunta. */
export function QuestionBody({ question: q }: { question: QuestionReport }) {
  const ctx = useReport();
  const counts = (
    <p className="text-sm text-muted-foreground">
      {plural(q.responses, 'respuesta', 'respuestas', 'Sin respuestas todavía')}
      {q.skipped > 0 && ` · ${plural(q.skipped, 'persona la saltó', 'personas la saltaron')}`}
    </p>
  );

  if (q.responses === 0) return counts;

  if (q.kind === 'text') {
    return (
      <div className="space-y-3">
        {counts}
        <ul className="space-y-2">
          {(q.texts ?? []).map((t, i) => (
            <li key={`${t.sessionId}-${i}`} className="rounded-lg border bg-background p-3 sm:p-4 space-y-2" data-print="keep">
              <p className="whitespace-pre-wrap break-words">“{t.text}”</p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{t.who ?? ctx.names.get(t.sessionId) ?? 'Participante'}</span>
                <Link to={recordingRoute(ctx, t.sessionId)} className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground" data-print="hide">
                  <PlayCircle className="size-3.5" />
                  Ver grabación
                </Link>
              </p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const distribution = q.distribution ?? [];
  return (
    <div className="space-y-4">
      {q.kind === 'scale' && typeof q.average === 'number' && (
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums">{q.average.toFixed(1).replace('.', ',')}</span>
          <span className="text-muted-foreground">de {q.max ?? distribution.length} en promedio</span>
        </div>
      )}
      {counts}
      <Bars items={distribution} total={q.responses} highlight={q.kind !== 'scale'} />
      {q.kind === 'choice' && <p className="text-xs text-muted-foreground">Los porcentajes son sobre quienes respondieron; si se podían elegir varias, suman más de 100 %.</p>}
    </div>
  );
}
