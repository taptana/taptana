import type { BlockKind } from '@taptana/shared';
import { cn } from '@/lib/utils';
import { ScoreChip } from './overview.tsx';

export interface IndexEntry {
  id: string;
  number: number;
  title: string;
  kind: BlockKind;
  kindLabel: string;
  /** Solo tareas. */
  score?: number | null;
  /** Texto corto para preguntas ("4,2 de 5", "6 respuestas"). */
  hint?: string;
}

export const blockAnchor = (id: string): string => `bloque-${id}`;

/**
 * Elige qué bloque mirar (una tarea a la vez). Tarjetas chicas que bajan de línea en vez de
 * esconderse en un scroll horizontal.
 */
export function BlockPicker({ entries, current, onSelect, label }: { entries: IndexEntry[]; current: string | undefined; onSelect: (id: string) => void; label: string }) {
  if (entries.length < 2) return null;
  return (
    <nav aria-label={label} data-print="hide">
      <ul className="grid gap-px border-y bg-border sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        {entries.map((e) => {
          const active = current === e.id;
          return (
            <li key={e.id} className="min-w-0 bg-background">
              <button
                type="button"
                onClick={() => onSelect(e.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex h-full w-full cursor-pointer flex-col gap-1.5 px-4 py-4 text-left text-sm outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground',
                  active ? 'shadow-[inset_0_3px_0_var(--foreground)]' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="type-eyebrow truncate">
                  {String(e.number).padStart(2, '0')} — {e.kindLabel}
                  {e.hint && ` · ${e.hint}`}
                </span>
                <span className={cn('block max-w-full truncate text-[15px]', active ? 'font-semibold text-foreground' : 'font-medium')}>{e.title}</span>
                {e.score !== undefined && <ScoreChip score={e.score} className="mt-0.5 text-sm" />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
