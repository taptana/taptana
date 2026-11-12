/**
 * Columna izquierda del constructor: ajustes, bienvenida, los bloques en orden y la despedida.
 * Los bloques se reordenan arrastrando, con el menú de cada uno o con Alt + flechas.
 */
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, Ellipsis, GripVertical, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type { BlockKind } from '@taptana/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { blockKind, draftTitle, type DraftBlock, type Selection } from './draft';
import { ADD_ORDER, KIND_INFO, KindIcon } from './fields';

function Dot({ label }: { label: string }) {
  return (
    <span className="ml-auto flex shrink-0 items-center" title={label}>
      <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function GroupHeading({ children }: { children: ReactNode }) {
  return <p className="type-eyebrow border-b border-foreground pb-2">{children}</p>;
}

/* La fila elegida: papel blanco y una barra de tinta a la izquierda. */
const ROW_ACTIVE = 'bg-card shadow-[inset_3px_0_0_var(--foreground)]';

function FixedItem({ label, hint, active, incomplete, onSelect }: { label: string; hint: string; active: boolean; incomplete: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 border-b py-3 pl-10 pr-3 text-left sm:pl-14 outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground',
        active ? ROW_ACTIVE : 'hover:bg-accent/50',
      )}
    >
      <span className="min-w-0">
        <span className={cn('block text-[15px] leading-snug', active ? 'font-semibold' : 'font-medium')}>{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      {incomplete && <Dot label="Le falta algo" />}
    </button>
  );
}

export function AddBlockMenu({ onAdd, children }: { onAdd: (kind: BlockKind) => void; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        {ADD_ORDER.map((kind) => {
          const info = KIND_INFO[kind];
          return (
            <DropdownMenuItem key={kind} onSelect={() => onAdd(kind)} className="items-center gap-3 py-2">
              <KindIcon kind={kind} />
              <span className="min-w-0">
                <span className="block font-medium">{info.label}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{info.hint}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BlockList({
  blocks,
  selection,
  incomplete,
  onSelect,
  onAdd,
  onMove,
  onDuplicate,
  onDelete,
}: {
  blocks: DraftBlock[];
  selection: Selection;
  /** Ids (de bloque, o 'settings' / 'welcome' / 'thanks') a los que les falta algo. */
  incomplete: ReadonlySet<string>;
  onSelect: (selection: Selection) => void;
  onAdd: (kind: BlockKind) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  return (
    <nav aria-label="Partes del estudio" className="space-y-9">
      <div>
      <GroupHeading>Antes</GroupHeading>
      <FixedItem label="Ajustes del estudio" hint="Nombre, prototipo y opciones" active={selection === 'settings'} incomplete={incomplete.has('settings')} onSelect={() => onSelect('settings')} />
      <FixedItem label="Bienvenida" hint="Saludo y consentimiento" active={selection === 'welcome'} incomplete={incomplete.has('welcome')} onSelect={() => onSelect('welcome')} />
      </div>

      <div>
      <GroupHeading>Bloques</GroupHeading>
      <ol aria-label="Bloques, en el orden en que los ve el participante">
        {blocks.map((block, index) => {
          const kind = blockKind(block as Parameters<typeof blockKind>[0]);
          const info = KIND_INFO[kind];
          const active = selection === block.id;
          const title = draftTitle(block);
          return (
            <li
              key={block.id}
              draggable
              onDragStart={(e) => {
                setDragging(index);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', block.id);
              }}
              onDragOver={(e) => {
                if (dragging === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== index) setOver(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== null && dragging !== index) onMove(dragging, index);
                setDragging(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              className={cn(
                'group flex items-stretch border-b transition-colors',
                active ? ROW_ACTIVE : 'hover:bg-accent/50',
                dragging === index && 'opacity-50',
                over === index && dragging !== null && dragging !== index && (dragging < index ? 'border-b-foreground border-b-2' : 'border-t-foreground border-t-2'),
              )}
            >
              <span className="hidden w-5 cursor-grab items-center justify-end text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 sm:flex" aria-hidden title="Arrastra para reordenar">
                <GripVertical className="size-4" />
              </span>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                onClick={() => onSelect(block.id)}
                onKeyDown={(e) => {
                  if (!e.altKey) return;
                  if (e.key === 'ArrowUp' && index > 0) {
                    e.preventDefault();
                    onMove(index, index - 1);
                  } else if (e.key === 'ArrowDown' && index < blocks.length - 1) {
                    e.preventDefault();
                    onMove(index, index + 1);
                  }
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-3 pl-1 pr-1 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground sm:pl-0"
              >
                <span className="num w-6 shrink-0 pt-0.5 text-xs text-muted-foreground" aria-hidden>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('line-clamp-2 break-words text-[15px] leading-snug', active ? 'font-semibold' : 'font-medium', !title && 'text-muted-foreground font-normal italic')}>{title || info.untitled}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <KindIcon kind={kind} size="sm" className="size-[18px] border-0 [&_svg]:size-3.5" />
                    <span className="sr-only">{index + 1}. </span>
                    <span className="truncate">{info.label}</span>
                  </span>
                </span>
                {incomplete.has(block.id) && <Dot label="Le falta algo" />}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="my-auto mr-1 size-8 shrink-0" aria-label={`Acciones de "${title || info.untitled}"`}>
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index, index - 1)}>
                    <ArrowUp /> Subir
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={index === blocks.length - 1} onSelect={() => onMove(index, index + 1)}>
                    <ArrowDown /> Bajar
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onDuplicate(block.id)}>
                    <Copy /> Duplicar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => onDelete(block.id)}>
                    <Trash2 /> Borrar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ol>

      <AddBlockMenu onAdd={onAdd}>
        <Button type="button" variant="ghost" className="mt-2 w-full justify-start pl-10 has-[>svg]:pl-10 sm:pl-14 sm:has-[>svg]:pl-14 [&_svg]:-ml-7 [&_svg]:mr-1">
          <Plus /> Agregar bloque
        </Button>
      </AddBlockMenu>
      {blocks.length > 1 && <p className="hidden pl-14 pt-2 text-xs text-muted-foreground sm:block">Arrastra para reordenar, o usa Alt + ↑ ↓ sobre un bloque.</p>}
      </div>

      <div>
      <GroupHeading>Al final</GroupHeading>
      <FixedItem label="Gracias" hint="Pantalla final" active={selection === 'thanks'} incomplete={incomplete.has('thanks')} onSelect={() => onSelect('thanks')} />
      </div>
    </nav>
  );
}
