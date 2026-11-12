import type { BlockKind } from '@taptana/shared';
import { cn } from '@/lib/utils';
import { KindIcon } from '@/components/builder/fields';
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
      <ul className="flex flex-wrap gap-2">
        {entries.map((e) => {
          const active = current === e.id;
          return (
            <li key={e.id} className="min-w-0 max-w-full">
              <button
                type="button"
                onClick={() => onSelect(e.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex max-w-full sm:max-w-72 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active ? 'border-primary bg-card ring-1 ring-primary shadow-sm' : 'border-border/80 bg-card/70 text-muted-foreground hover:border-primary/40 hover:bg-card hover:text-foreground',
                )}
              >
                <KindIcon kind={e.kind} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate font-medium', active && 'text-foreground')}>{e.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {e.number}. {e.kindLabel}
                    {e.hint && ` · ${e.hint}`}
                  </span>
                </span>
                {e.score !== undefined && <ScoreChip score={e.score} className="text-sm" />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
