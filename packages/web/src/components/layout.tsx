import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Link, useRouter } from '@/router';

/** Barra superior con las dos secciones del panel. */
export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { route } = useRouter();
  const inStudies = route.name === 'studies' || route.name === 'study';
  const tab = (active: boolean): string =>
    cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground');
  return (
    <div className={cn('mx-auto p-4 sm:p-6 space-y-4', wide ? 'max-w-6xl' : 'max-w-5xl')}>
      <nav className="flex items-center gap-1 -mx-1">
        <span className="font-semibold tracking-tight px-2 mr-2">Taptana</span>
        <Link to={{ name: 'list' }} className={tab(!inStudies)}>
          Sesiones
        </Link>
        <Link to={{ name: 'studies' }} className={tab(inStudies)}>
          Estudios
        </Link>
      </nav>
      {children}
    </div>
  );
}
