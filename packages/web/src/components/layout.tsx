import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, CircleAlert, Compass, FileArchive, FlaskConical, House, PlayCircle, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IS_DEMO } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, useRouter, type Route, type RouteName } from '@/router';

const NAV: Array<{ to: Route; label: string; hint: string; icon: typeof FileArchive; match: (r: RouteName) => boolean }> = [
  { to: { name: 'home' }, label: 'Inicio', hint: 'Empieza aquí', icon: House, match: (r) => r === 'home' },
  { to: { name: 'prototypes' }, label: 'Prototipos', hint: 'Sube tu HTML', icon: FileArchive, match: (r) => r === 'prototypes' },
  { to: { name: 'studies' }, label: 'Estudios', hint: 'Tareas', icon: FlaskConical, match: (r) => r === 'studies' || r === 'study' || r === 'report' || r === 'presentation' },
  { to: { name: 'recordings' }, label: 'Sesiones', hint: 'Paso a paso', icon: PlayCircle, match: (r) => r === 'recordings' || r === 'player' },
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
    <div className="min-h-dvh bg-muted/30 lg:flex">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow">
        Saltar al contenido
      </a>
      <aside className="bg-background border-b lg:border-b-0 lg:border-r lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-dvh lg:flex lg:flex-col print:hidden">
        <div className="px-4 lg:px-5 pt-3 pb-1 lg:py-6 flex items-center gap-2.5">
          <Link to={{ name: 'home' }} className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label="Taptana, ir al inicio">
            <span className="size-7 lg:size-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">T</span>
            <span className="font-semibold tracking-tight text-base lg:text-lg">Taptana</span>
          </Link>
          {IS_DEMO && <span className="ml-auto lg:ml-1 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Demo</span>}
        </div>
        <nav aria-label="Secciones" className="grid grid-cols-4 gap-1 px-2 pb-2 lg:flex lg:flex-col lg:px-3 lg:pb-0">
          {NAV.map((item) => {
            const active = item.match(route.name);
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  'lg:flex-row lg:gap-3 lg:px-3 lg:py-2.5 lg:text-sm',
                  active ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4.5 shrink-0" />
                <span className="whitespace-nowrap">{item.label}</span>
                <span className="hidden xl:inline ml-auto min-w-0 truncate whitespace-nowrap pl-2 text-xs text-muted-foreground/70 font-normal">{item.hint}</span>
              </Link>
            );
          })}
        </nav>
        <div className="hidden lg:block mt-auto p-5 text-xs text-muted-foreground space-y-1.5">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <ShieldCheck className="size-4" />
            {IS_DEMO ? 'Modo demo' : 'Todo local'}
          </p>
          <p>{IS_DEMO ? 'Lo que subas o grabes queda solo en este navegador.' : 'Prototipos y sesiones quedan en esta computadora.'}</p>
        </div>
      </aside>
      <main id="contenido" className="flex-1 min-w-0">
        <div className={cn('mx-auto px-4 pt-6 pb-16 sm:px-8 sm:pt-10 lg:px-12 lg:pt-12 space-y-10 sm:space-y-12', WIDTHS[width ?? (wide ? 'wide' : 'default')])}>{children}</div>
      </main>
    </div>
  );
}

/**
 * Encabezado de página: título, una línea de descripción y, a la derecha, como mucho un botón
 * principal (las acciones secundarias van en un menú «⋯»).
 */
export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="flex items-start gap-3 min-w-0">
        {back}
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight break-words">{title}</h1>
          {description && <div className="text-muted-foreground max-w-prose leading-relaxed">{description}</div>}
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
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('space-y-5 sm:space-y-6', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground max-w-prose leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Pestañas simples (estilo shadcn Tabs) que navegan entre rutas. */
export function RouteTabs({ tabs }: { tabs: Array<{ label: string; to: Route; active: boolean; icon?: ReactNode }> }) {
  return (
    <nav aria-label="Vistas" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-1 gap-1 print:hidden">
      {tabs.map((t) => (
        <Link
          key={t.label}
          to={t.to}
          aria-current={t.active ? 'page' : undefined}
          className={cn(
            'inline-flex shrink-0 items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            t.active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.icon}
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Estado vacío con ícono, título, texto y una acción principal. */
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed bg-background px-6 py-16 sm:py-20 text-center flex flex-col items-center gap-3">
      <div className="size-12 rounded-full bg-muted grid place-items-center text-muted-foreground">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="text-muted-foreground max-w-md text-sm space-y-2">{children}</div>}
      {action && <div className="pt-2 flex flex-wrap justify-center gap-2">{action}</div>}
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
    <div role="alert" className="rounded-xl border border-destructive/30 bg-background px-6 py-12 text-center flex flex-col items-center gap-3">
      <div className="size-12 rounded-full bg-destructive/10 grid place-items-center text-destructive">
        <CircleAlert className="size-6" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="text-muted-foreground max-w-md text-sm">{message}</div>
      {(onRetry || home) && (
        <div className="pt-2 flex flex-wrap justify-center gap-2">
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
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
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
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}

/** Dirección que no existe en el panel. */
export function NotFound() {
  return (
    <Layout>
      <EmptyState
        icon={<Compass className="size-6" />}
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

const NOTICE_TONES = {
  info: 'bg-sky-500/[0.06] text-foreground [&_[data-slot=notice-icon]]:text-sky-600 dark:[&_[data-slot=notice-icon]]:text-sky-400',
  warning: 'bg-amber-500/[0.08] text-foreground [&_[data-slot=notice-icon]]:text-amber-600 dark:[&_[data-slot=notice-icon]]:text-amber-400',
  neutral: 'bg-muted/70 text-foreground [&_[data-slot=notice-icon]]:text-muted-foreground',
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
    <div role="status" className={cn('rounded-xl px-4 py-3 text-sm', NOTICE_TONES[tone], className)}>
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
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {open ? 'Ocultar' : 'Saber más'}
              <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
            </button>
          )}
          {action}
        </div>
      </div>
      {children && open && (
        <div id={id} className={cn('mt-2 max-w-prose space-y-2 leading-relaxed text-muted-foreground', icon && 'sm:pl-7')}>
          {children}
        </div>
      )}
    </div>
  );
}
