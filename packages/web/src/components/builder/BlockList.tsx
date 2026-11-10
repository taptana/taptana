/**
 * Columna izquierda del constructor: ajustes, bienvenida, los bloques en orden y la despedida.
 * Los bloques se reordenan arrastrando, con el menú de cada uno o con Alt + flechas.
 */
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, Ellipsis, GripVertical, Hand, PartyPopper, Plus, Settings2, Trash2, type LucideIcon } from 'lucide-react';
import type { BlockKind } from '@taptana/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { blockKind, draftTitle, type DraftBlock, type Selection } from './draft';
import { ADD_ORDER, KIND_INFO } from './fields';

function Dot({ label }: { label: string }) {
  return (
    <span className="ml-auto flex shrink-0 items-center" title={label}>
      <span className="size-2 rounded-full bg-amber-500" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function FixedItem({ icon: Icon, label, hint, active, incomplete, onSelect }: { icon: LucideIcon; label: string; hint: string; active: boolean; incomplete: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'border-primary bg-background ring-1 ring-primary' : 'border-transparent hover:bg-accent/60',
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
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
          const Icon = info.icon;
          return (
            <DropdownMenuItem key={kind} onSelect={() => onAdd(kind)} className="items-start py-2">
              <Icon className="mt-0.5" />
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
    <nav aria-label="Partes del estudio" className="space-y-1.5">
      <FixedItem icon={Settings2} label="Ajustes del estudio" hint="Nombre, prototipo y opciones" active={selection === 'settings'} incomplete={incomplete.has('settings')} onSelect={() => onSelect('settings')} />
      <FixedItem icon={Hand} label="Bienvenida" hint="Saludo y consentimiento" active={selection === 'welcome'} incomplete={incomplete.has('welcome')} onSelect={() => onSelect('welcome')} />

      <ol className="space-y-1.5" aria-label="Bloques, en el orden en que los ve el participante">
        {blocks.map((block, index) => {
          const kind = blockKind(block as Parameters<typeof blockKind>[0]);
          const info = KIND_INFO[kind];
          const Icon = info.icon;
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
                'group flex items-stretch rounded-lg border bg-background transition-colors',
                active ? 'border-primary ring-1 ring-primary' : 'hover:border-foreground/30',
                dragging === index && 'opacity-50',
                over === index && dragging !== null && dragging !== index && (dragging < index ? 'border-b-primary border-b-2' : 'border-t-primary border-t-2'),
              )}
            >
              <span className="hidden cursor-grab items-center pl-1.5 text-muted-foreground/60 sm:flex" aria-hidden title="Arrastra para reordenar">
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
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2.5 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className={cn('block truncate font-medium', !title && 'text-muted-foreground font-normal italic')}>{title || info.untitled}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {index + 1}. {info.label}
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
        <Button type="button" variant="outline" className="w-full justify-start border-dashed">
          <Plus /> Agregar bloque
        </Button>
      </AddBlockMenu>
      {blocks.length > 1 && <p className="hidden px-1 text-xs text-muted-foreground sm:block">Arrastra para reordenar, o usa Alt + ↑ ↓ sobre un bloque.</p>}

      <FixedItem icon={PartyPopper} label="Gracias" hint="Pantalla final" active={selection === 'thanks'} incomplete={incomplete.has('thanks')} onSelect={() => onSelect('thanks')} />
    </nav>
  );
}
