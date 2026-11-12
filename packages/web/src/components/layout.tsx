import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IS_DEMO } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyArt, type EmptyArtKind } from '@/components/brand/art';
import { LogoMark } from '@/components/brand/logo';
import { Link, useRouter, type Route, type RouteName } from '@/router';

const NAV: Array<{ to: Route; label: string; match: (r: RouteName) => boolean }> = [
  { to: { name: 'home' }, label: 'Inicio', match: (r) => r === 'home' },
  { to: { name: 'prototypes' }, label: 'Prototipos', match: (r) => r === 'prototypes' },
  { to: { name: 'studies' }, label: 'Estudios', match: (r) => r === 'studies' || r === 'study' || r === 'report' || r === 'presentation' },
  { to: { name: 'recordings' }, label: 'Sesiones', match: (r) => r === 'recordings' || r === 'player' },
];

const WIDTHS = { default: 'max-w-[1040px]', wide: 'max-w-[1280px]', full: 'max-w-none' } as const;

/**
 * Estructura del panel: menú lateral fijo en pantallas grandes; en celular, una barra arriba
 * con las cuatro secciones siempre a la vista (sin scroll horizontal).
 * `wide` usa más ancho (reporte, reproductor); `width="full"` todo el ancho (constructor).
 */
export function Layout({ children, wide = false, width }: { children: ReactNode; wide?: boolean; width?: keyof typeof WIDTHS }) {
  const { route } = useRouter();
  return (
    <div className="min-h-dvh bg-background lg:flex">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:border focus:border-foreground focus:bg-card focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      <aside className="bg-sidebar border-b lg:border-b-0 lg:border-r lg:w-60 lg:shrink-0 lg:sticky lg:top-0 lg:h-dvh lg:flex lg:flex-col print:hidden">
        <div className="px-4 lg:px-6 pt-3 pb-2 lg:pt-7 lg:pb-8 flex items-center gap-2.5">
          <Link to={{ name: 'home' }} className="flex items-center gap-2.5 rounded-sm outline-none focus-ink" aria-label="Taptana, ir al inicio">
            <LogoMark className="size-7" />
            <span className="font-display font-bold tracking-[-0.03em] text-xl lg:text-[1.375rem] leading-none">Taptana</span>
          </Link>
          {IS_DEMO && <span className="ml-auto lg:ml-1 rounded-sm border px-1.5 py-0.5 font-mono text-2xs font-medium uppercase tracking-[0.05em] text-muted-foreground">Demo</span>}
        </div>
        <p className="type-eyebrow hidden lg:block px-6 pb-2" aria-hidden>
          Secciones
        </p>
        <nav aria-label="Secciones" className="grid grid-cols-4 px-2 lg:flex lg:flex-col lg:px-3">
          {NAV.map((item) => {
            const active = item.match(route.name);
            return (
              <Link
                key={item.label}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex min-h-11 items-center justify-center border-b-2 px-1 text-sm transition-colors outline-none focus-ink',
                  'lg:min-h-10 lg:justify-start lg:gap-3 lg:rounded-sm lg:border-b-0 lg:px-3 lg:text-[15px]',
                  active ? 'border-foreground text-foreground font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {/* Un hoyo del tablero por sección; el de la sección actual está «tocado». */}
                <span
                  aria-hidden
                  className={cn(
                    'hidden lg:block size-2.5 shrink-0 rounded-full border',
                    active ? 'border-foreground bg-mark' : 'border-input group-hover:border-foreground',
                  )}
                />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <p className="hidden lg:block mt-auto mx-6 mb-6 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          <span className="type-eyebrow mb-1 block">{IS_DEMO ? 'Modo demo' : 'Todo local'}</span>
          {IS_DEMO ? 'Lo que subas o grabes queda solo en este navegador.' : 'Prototipos y sesiones quedan en esta computadora.'}
        </p>
      </aside>
      <main id="contenido" className="flex-1 min-w-0">
        <div className={cn('mx-auto px-4 pt-6 pb-16 sm:px-8 sm:pt-10 lg:px-12 lg:pt-12 space-y-10 lg:space-y-14', WIDTHS[width ?? (wide ? 'wide' : 'default')])}>{children}</div>
      </main>
    </div>
  );
}

/**
 * Encabezado de página: título, una línea de descripción y, a la derecha, como mucho un botón
 * principal (las acciones secundarias van en un menú «⋯»).
 */
export function PageHeader({ title, description, actions, back, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="flex items-start gap-3 min-w-0">
        {back && <div className={cn('shrink-0', eyebrow && 'pt-7')}>{back}</div>}
        <div className="min-w-0 space-y-2.5">
          {eyebrow && <p className="type-eyebrow">{eyebrow}</p>}
          <h1 className="type-page-title break-words">{title}</h1>
          {description && <div className="text-muted-foreground max-w-[65ch] leading-relaxed">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </header>
  );
}

/** Una sección de página con título, una línea opcional de ayuda y su contenido. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  /** Antetítulo en mono, por ejemplo «01 — Resultado». */
  eyebrow?: ReactNode;
}) {
  return (
    <section id={id} className={cn('space-y-5 sm:space-y-6 border-t border-foreground pt-5', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1.5">
          {eyebrow && <p className="type-eyebrow">{eyebrow}</p>}
          <h2 className="type-section">{title}</h2>
          {description && <p className="text-muted-foreground max-w-[65ch] leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Dos o tres vistas de lo mismo (Diseño / Resultados): texto en fila; la actual lleva el trazo de resaltador. */
export function RouteTabs({ tabs }: { tabs: Array<{ label: string; to: Route; active: boolean; icon?: ReactNode }> }) {
  return (
    <nav aria-label="Vistas" className="inline-flex max-w-full items-center overflow-x-auto rounded-md border border-input p-0.5 print:hidden">
      {tabs.map((t) => (
        <Link
          key={t.label}
          to={t.to}
          aria-current={t.active ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-9 shrink-0 items-center rounded-sm px-3.5 py-1.5 text-sm transition-colors outline-none focus-ink',
            t.active ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <span className={cn(t.active && 'mark')}>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * Estado vacío: una ilustración del tablero (`art`) o un ícono, título, texto y una acción principal.
 */
export function EmptyState({ icon, art, title, children, action }: { icon?: ReactNode; art?: EmptyArtKind; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-y border-foreground/90 py-10 sm:py-14 flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-10">
      {art ? <EmptyArt kind={art} className="shrink-0 sm:w-40" /> : <div className="size-10 shrink-0 grid place-items-center rounded-sm border text-muted-foreground">{icon}</div>}
      <div className="min-w-0 space-y-3">
        <h2 className="type-section">{title}</h2>
        {children && <div className="text-muted-foreground max-w-[56ch] leading-relaxed space-y-2">{children}</div>}
        {action && <div className="pt-2 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

/** Algo no cargó: qué pasó, en español, y cómo seguir. */
export function ErrorState({
  title = 'No pudimos cargar esto',
  message,
  onRetry,
  retryLabel = 'Reintentar',
  home = false,
}: {
  title?: string;
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  home?: boolean;
}) {
  return (
    <div role="alert" className="border-l-2 border-destructive py-2 pl-5 flex flex-col items-start gap-3">
      <CircleAlert className="size-5 text-destructive" aria-hidden />
      <h2 className="type-section">{title}</h2>
      <div className="text-muted-foreground max-w-[52ch] leading-relaxed">{message}</div>
      {(onRetry || home) && (
        <div className="pt-2 flex flex-wrap gap-2">
          {onRetry && <Button onClick={onRetry}>{retryLabel}</Button>}
          {home && (
            <Button variant="outline" asChild>
              <a href={import.meta.env.BASE_URL}>Ir al inicio</a>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Aviso de error en línea (dentro de una página que sí cargó). */
export function InlineError({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 border-l-2 border-destructive py-1.5 pl-4 text-sm text-destructive">
      <CircleAlert className="size-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">{children}</div>
      {onDismiss && (
        <button type="button" className="shrink-0 underline underline-offset-4 cursor-pointer" onClick={onDismiss}>
          Cerrar
        </button>
      )}
    </div>
  );
}

/** Esqueleto mientras carga una página. `rows`: filas de lista; `cards`: tarjetas en cuadrícula. */
export function PageSkeleton({ variant = 'rows' }: { variant?: 'rows' | 'cards' }) {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Cargando">
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <ListSkeleton variant={variant} />
    </div>
  );
}

export function ListSkeleton({ variant = 'rows', count = 4 }: { variant?: 'rows' | 'cards'; count?: number }) {
  if (variant === 'cards') {
    return (
      <div className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Cargando">
        {Array.from({ length: count }, (_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}

/** Dirección que no existe en el panel. */
export function NotFound() {
  return (
    <Layout>
      <EmptyState
        art="lost"
        title="Esta página no existe"
        action={
          <Button asChild>
            <Link to={{ name: 'home' }}>Ir al inicio</Link>
          </Button>
        }
      >
        <p>Puede que el link esté incompleto o que lo que buscabas se haya borrado.</p>
      </EmptyState>
    </Layout>
  );
}

/* Avisos: sin fondo; una regla del color del estado a la izquierda y su ícono. */
const NOTICE_TONES = {
  info: 'border-l-sky-500 [&_[data-slot=notice-icon]]:text-sky-600 dark:[&_[data-slot=notice-icon]]:text-sky-400',
  warning: 'border-l-amber-500 [&_[data-slot=notice-icon]]:text-amber-600 dark:[&_[data-slot=notice-icon]]:text-amber-400',
  neutral: 'border-l-input [&_[data-slot=notice-icon]]:text-muted-foreground',
} as const;

/**
 * Aviso compacto de una línea. Lo largo queda detrás de «Saber más» para no cargar la pantalla.
 * `action` es un botón opcional a la derecha (por ejemplo, «Duplicar estudio»).
 */
export function Notice({
  icon,
  title,
  children,
  action,
  tone = 'info',
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  tone?: keyof typeof NOTICE_TONES;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div role="status" className={cn('border-l-2 py-1 pl-4 text-sm text-foreground', NOTICE_TONES[tone], className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {icon && (
          <span data-slot="notice-icon" className="shrink-0 [&_svg]:size-4" aria-hidden>
            {icon}
          </span>
        )}
        <p className="min-w-[min(100%,14rem)] flex-1 font-medium leading-snug">{title}</p>
        <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">
          {children && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-ink"
            >
              {open ? 'Ocultar' : 'Saber más'}
              <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
            </button>
          )}
          {action}
        </div>
      </div>
      {children && open && (
        <div id={id} className={cn('mt-2 max-w-[65ch] space-y-2 leading-relaxed text-muted-foreground', icon && 'sm:pl-7')}>
          {children}
        </div>
      )}
    </div>
  );
}
