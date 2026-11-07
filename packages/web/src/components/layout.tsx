import type { ReactNode } from 'react';
import { FileArchive, FlaskConical, PlayCircle, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link, useRouter, type Route } from '@/router';

declare const __TAPTANA_MODE__: 'http' | 'static';

const NAV: Array<{ to: Route; label: string; hint: string; icon: typeof FileArchive; match: (r: Route['name']) => boolean }> = [
  { to: { name: 'prototypes' }, label: 'Prototipos', hint: 'Sube tu HTML', icon: FileArchive, match: (r) => r === 'prototypes' },
  { to: { name: 'studies' }, label: 'Estudios', hint: 'Tareas y resultados', icon: FlaskConical, match: (r) => r === 'studies' || r === 'study' || r === 'report' },
  { to: { name: 'list' }, label: 'Sesiones', hint: 'Grabaciones', icon: PlayCircle, match: (r) => r === 'list' || r === 'player' },
];

/**
 * Estructura del panel: menú lateral fijo (arriba en celular) y contenido con aire.
 * `wide` usa todo el ancho disponible (reporte, reproductor).
 */
export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { route } = useRouter();
  return (
    <div className="min-h-screen bg-muted/30 lg:flex">
      <aside className="lg:w-64 lg:shrink-0 lg:border-r bg-background lg:sticky lg:top-0 lg:h-screen flex lg:flex-col border-b lg:border-b-0">
        <div className="px-5 py-4 lg:py-6 flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">T</div>
          <span className="font-semibold tracking-tight text-lg hidden sm:inline">Taptana</span>
        </div>
        <nav className="flex lg:flex-col gap-1 px-2 lg:px-3 items-center lg:items-stretch overflow-x-auto">
          {NAV.map((item) => {
            const active = item.match(route.name);
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                to={item.to}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 lg:py-2.5 text-sm transition-colors shrink-0',
                  active ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4.5" />
                <span>{item.label}</span>
                <span className="hidden lg:inline ml-auto text-xs text-muted-foreground/70 font-normal">{item.hint}</span>
              </Link>
            );
          })}
        </nav>
        <div className="hidden lg:block mt-auto p-5 text-xs text-muted-foreground space-y-1.5">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <ShieldCheck className="size-4" />
            {__TAPTANA_MODE__ === 'static' ? 'Modo demo' : 'Todo local'}
          </p>
          <p>{__TAPTANA_MODE__ === 'static' ? 'Lo que subas queda solo en este navegador.' : 'Prototipos y grabaciones quedan en esta computadora.'}</p>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className={cn('mx-auto px-5 py-6 sm:px-8 sm:py-10 space-y-8', wide ? 'max-w-7xl' : 'max-w-5xl')}>{children}</div>
      </main>
    </div>
  );
}

/** Encabezado de página: título grande, descripción y acciones a la derecha. */
export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        {back}
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{title}</h1>
          {description && <div className="text-muted-foreground">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Pestañas simples (estilo shadcn Tabs) que navegan entre rutas. */
export function RouteTabs({ tabs }: { tabs: Array<{ label: string; to: Route; active: boolean; icon?: ReactNode }> }) {
  return (
    <div className="inline-flex rounded-lg bg-muted p-1 gap-1">
      {tabs.map((t) => (
        <Link
          key={t.label}
          to={t.to}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-all',
            t.active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.icon}
          {t.label}
        </Link>
      ))}
    </div>
  );
}

/** Estado vacío con ícono, título, texto y una acción principal. */
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-background px-6 py-14 text-center flex flex-col items-center gap-3">
      <div className="size-12 rounded-full bg-muted grid place-items-center text-muted-foreground">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="text-muted-foreground max-w-md text-sm">{children}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
