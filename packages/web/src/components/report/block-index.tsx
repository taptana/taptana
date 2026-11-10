import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { ScoreChip } from './overview.tsx';

export interface IndexEntry {
  id: string;
  number: number;
  title: string;
  kindLabel: string;
  /** Solo tareas. */
  score?: number | null;
  /** Texto corto para preguntas ("4,2 de 5", "6 respuestas"). */
  hint?: string;
}

export const blockAnchor = (id: string): string => `bloque-${id}`;

/** Bloque que está a la vista (el último cuyo inicio ya pasó por arriba). */
function useCurrentBlock(entries: IndexEntry[]): string | undefined {
  const [current, setCurrent] = useState<string | undefined>(entries[0]?.id);
  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      frame = 0;
      let found = entries[0]?.id;
      for (const e of entries) {
        const el = document.getElementById(blockAnchor(e.id));
        if (el && el.getBoundingClientRect().top <= 140) found = e.id;
      }
      setCurrent(found);
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [entries]);
  return current;
}

/**
 * Índice de bloques siempre a la vista: columna fija a la derecha en pantallas grandes, tira
 * horizontal pegada arriba en las chicas.
 */
export function BlockIndex({ entries, onJump, variant }: { entries: IndexEntry[]; onJump: (id: string) => void; variant: 'side' | 'bar' }) {
  const current = useCurrentBlock(entries);
  if (entries.length === 0) return null;

  if (variant === 'bar') {
    return (
      <nav aria-label="Bloques del estudio" className="sticky top-0 z-20 -mx-4 sm:-mx-8 border-y bg-background/95 backdrop-blur px-4 sm:px-8 py-2 xl:hidden" data-print="hide">
        <ul className="flex gap-2 overflow-x-auto">
          {entries.map((e) => (
            <li key={e.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onJump(e.id)}
                aria-current={current === e.id ? 'true' : undefined}
                className={cn(
                  'inline-flex max-w-52 cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  current === e.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="tabular-nums font-medium">{e.number}</span>
                <span className="truncate">{e.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Bloques del estudio" className="hidden xl:block sticky top-6 self-start max-h-[calc(100dvh-3rem)] overflow-y-auto" data-print="hide">
      <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Bloques</p>
      <ul className="space-y-0.5">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onJump(e.id)}
              aria-current={current === e.id ? 'true' : undefined}
              className={cn(
                'flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                current === e.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <span className="mt-0.5 size-5 shrink-0 rounded-full bg-muted grid place-items-center text-[11px] font-medium tabular-nums text-foreground">{e.number}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {e.kindLabel}
                  {e.hint && ` · ${e.hint}`}
                </span>
              </span>
              {e.score !== undefined && <ScoreChip score={e.score} className="mt-0.5 text-xs" />}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
