import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { RouterProvider, useRouter } from '@/router';
import { ErrorState, Layout, NotFound, PageSkeleton } from '@/components/layout';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { friendlyError } from '@/lib/errors';
import { HomePage } from '@/pages/Home';
import { SessionsPage } from '@/pages/Sessions';
import { PrototypesPage } from '@/pages/Prototypes';
import { StudiesPage } from '@/pages/Studies';

// Lo pesado (rrweb, constructor, reporte) se baja solo cuando se abre esa pantalla.
const PlayerPage = lazy(() => import('@/pages/Player').then((m) => ({ default: m.PlayerPage })));
const ReportPage = lazy(() => import('@/pages/Report').then((m) => ({ default: m.ReportPage })));
const StudyEditorPage = lazy(() => import('@/pages/StudyEditor').then((m) => ({ default: m.StudyEditorPage })));

/** Si una pantalla falla al dibujarse, se explica en vez de dejar la página en blanco. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Taptana: error en el panel', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <Layout>
        <ErrorState
          title="Esta pantalla tuvo un problema"
          message={friendlyError(this.state.error, 'Algo falló al mostrar esta pantalla. Tus datos están a salvo: recarga la página o vuelve al inicio.')}
          onRetry={() => location.reload()}
          retryLabel="Recargar la página"
          home
        />
      </Layout>
    );
  }
}

function Routes() {
  const { route } = useRouter();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'prototypes':
      return <PrototypesPage />;
    case 'studies':
      return <StudiesPage />;
    case 'study':
      return <StudyEditorPage key={route.id ?? 'new'} id={route.id} />;
    case 'report':
      return <ReportPage key={route.id} id={route.id} />;
    case 'recordings':
      return <SessionsPage {...(route.study ? { study: route.study } : {})} />;
    case 'player':
      return <PlayerPage key={route.id} id={route.id} {...(route.t !== undefined ? { t: route.t } : {})} />;
    default:
      return <NotFound />;
  }
}

function RoutesWithBoundary() {
  const { route } = useRouter();
  // La clave reinicia el límite de errores al cambiar de pantalla.
  const key = `${route.name}:${'id' in route ? (route.id ?? 'new') : ''}`;
  return (
    <ErrorBoundary key={key}>
      <Suspense
        fallback={
          <Layout wide={route.name === 'player' || route.name === 'report' || route.name === 'study'}>
            <PageSkeleton />
          </Layout>
        }
      >
        <Routes />
      </Suspense>
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <RouterProvider>
      <TooltipProvider delayDuration={300}>
        <RoutesWithBoundary />
        <Toaster />
      </TooltipProvider>
    </RouterProvider>
  );
}
