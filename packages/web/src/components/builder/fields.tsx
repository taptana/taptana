/**
 * Piezas pequeñas del constructor: campo con etiqueta, ayuda y error; selector de pantalla; y
 * los nombres e íconos de cada tipo de bloque.
 */
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { ChevronDown, CircleDot, FileText, ListChecks, MessageSquareText, MousePointerClick, Smartphone, Star, ThumbsUp, type LucideIcon } from 'lucide-react';
import { sameScreen, type BlockKind, type ScreenInfo } from '@taptana/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { nameScreen } from '@/lib/screens';
import { cn } from '@/lib/utils';

export const KIND_INFO: Record<BlockKind, { label: string; hint: string; icon: LucideIcon; untitled: string }> = {
  task: { label: 'Tarea', hint: 'Le pides hacer algo en el prototipo y ves si lo logra.', icon: ListChecks, untitled: 'Tarea sin título' },
  'first-click': { label: 'Primer clic', hint: '"¿Dónde tocarías para…?" Solo cuenta el primer toque.', icon: MousePointerClick, untitled: 'Primer clic sin título' },
  scale: { label: 'Escala de opinión', hint: 'Una nota del 1 al 5, 7 o 10. Por ejemplo, qué tan fácil fue.', icon: Star, untitled: 'Escala sin pregunta' },
  choice: { label: 'Opción múltiple', hint: 'Elige una o varias respuestas de una lista.', icon: CircleDot, untitled: 'Opción múltiple sin pregunta' },
  yesno: { label: 'Sí / No', hint: 'Una pregunta que se responde con sí o no.', icon: ThumbsUp, untitled: 'Sí / No sin pregunta' },
  text: { label: 'Pregunta abierta', hint: 'Responde con sus propias palabras.', icon: MessageSquareText, untitled: 'Pregunta sin texto' },
  context: { label: 'Pantalla de contexto', hint: 'Un texto para leer antes de seguir. No pide nada.', icon: FileText, untitled: 'Contexto sin título' },
};

/** Orden del menú "Agregar bloque". */
export const ADD_ORDER: BlockKind[] = ['task', 'first-click', 'scale', 'choice', 'yesno', 'text', 'context'];

/** true: los errores se muestran aunque el campo no se haya tocado todavía. */
export const ShowErrorsContext = createContext(false);

/**
 * Campo con etiqueta, ayuda y error junto a él. El error aparece cuando ya se pasó por el campo
 * (o siempre, si `ShowErrorsContext` es true) para no llenar de rojo un estudio recién abierto.
 */
export function Field({
  label,
  help,
  error,
  optional = false,
  className,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  className?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode;
}) {
  const id = useId();
  const showAll = useContext(ShowErrorsContext);
  const [touched, setTouched] = useState(false);
  const shown = error && (showAll || touched) ? error : undefined;
  const describedBy = [help ? `${id}-help` : '', shown ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)} onBlur={() => setTouched(true)}>
      <label htmlFor={id} className="flex items-baseline gap-2 text-sm font-medium">
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">opcional</span>}
      </label>
      {children({ id, 'aria-invalid': Boolean(shown), 'aria-describedby': describedBy })}
      {shown && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {shown}
        </p>
      )}
      {help && (
        <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}

/** El nombre de una pantalla (el mismo en todo el panel), con su identificador como tooltip. */
export function ScreenName({ id, screens, className }: { id: string; screens: readonly ScreenInfo[]; className?: string }) {
  return (
    <span className={className} title={id}>
      {nameScreen(id, screens) || id}
    </span>
  );
}

/**
 * Elegir una pantalla: de la lista de pantallas conocidas, la que muestra el teléfono, o escrita
 * a mano (una app de una sola página puede tener pantallas que aún no se han visto).
 */
export function ScreenPicker({
  value,
  onChange,
  screens,
  phoneScreen,
  placeholder = 'Elige una pantalla o escribe su ruta',
  urlOnly = false,
  ...inputProps
}: {
  value: string;
  onChange: (value: string) => void;
  screens: readonly ScreenInfo[];
  phoneScreen?: string | undefined;
  placeholder?: string;
  /** Solo pantallas con dirección propia (no las "virtuales" de una misma URL). */
  urlOnly?: boolean;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string | undefined;
}) {
  const list = urlOnly ? screens.filter((s) => !s.id.includes('~')) : screens;
  const phone = phoneScreen && (!urlOnly || !phoneScreen.includes('~')) ? phoneScreen : undefined;
  // Con una pantalla elegida, el botón dice cuál es (no "Elegir").
  const chosen = value.trim() ? nameScreen(value.trim(), screens) : '';
  const isKnown = value.trim() !== '' && screens.some((s) => sameScreen(s.id, value.trim()));
  return (
    <div className="flex gap-2">
      <Input {...inputProps} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} autoCapitalize="none" className="min-w-0 flex-1 font-mono text-sm" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="max-w-[45%] shrink-0" aria-label={chosen ? `Pantalla elegida: ${chosen}. Cambiar` : 'Elegir una pantalla'} title={isKnown ? undefined : chosen ? 'Esta pantalla todavía no se ha visto en el prototipo' : undefined}>
            <span className="truncate">{chosen || 'Elegir'}</span> <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {phone && (
            <>
              <DropdownMenuItem onSelect={() => onChange(phone)}>
                <Smartphone />
                <span className="min-w-0">
                  <span className="block">La que muestra el teléfono</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{phone}</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel>Pantallas del prototipo</DropdownMenuLabel>
          {list.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">Todavía no hay pantallas detectadas. Navega en el teléfono de la derecha y aparecerán aquí.</p>}
          {list.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => onChange(s.id)}>
              <span className="min-w-0">
                <span className="block truncate">{nameScreen(s.id, screens)}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">{s.id}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Tarjeta de opción (radio grande) para elegir entre pocas alternativas con explicación. */
export function OptionCards<T extends string>({
  name,
  value,
  options,
  onChange,
  columns = 2,
}: {
  name: string;
  value: T | undefined;
  options: Array<{ value: T; label: string; hint: string }>;
  onChange: (value: T) => void;
  columns?: 1 | 2;
}) {
  return (
    <div role="radiogroup" aria-label={name} className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2')}>
      {options.map((o) => {
        const checked = value === o.value;
        return (
          <label
            key={o.value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
              checked ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent/50',
            )}
          >
            <input type="radio" name={name} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={checked} onChange={() => onChange(o.value)} />
            <span className="min-w-0">
              <span className="block font-medium">{o.label}</span>
              <span className="block text-xs leading-relaxed text-muted-foreground">{o.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
