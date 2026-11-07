/**
 * Router mínimo para dos rutas: la lista y el reproductor. Usa el historial del navegador.
 * La base (BASE_URL) la pone Vite: '/sessions/' en el server, '/' o '/taptana/' en Pages.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export type Route = { name: 'list' } | { name: 'player'; id: string };

function parse(pathname: string): Route {
  const rel = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const parts = rel.split('/').filter(Boolean);
  if (parts.length >= 1 && parts[0]) return { name: 'player', id: decodeURIComponent(parts[0]) };
  return { name: 'list' };
}

export function href(route: Route): string {
  if (route.name === 'player') return `${BASE}/${encodeURIComponent(route.id)}`;
  return `${BASE}/`;
}

const RouterContext = createContext<{ route: Route; navigate: (r: Route) => void }>({
  route: { name: 'list' },
  navigate: () => {},
});

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parse(location.pathname));
  useEffect(() => {
    const onPop = (): void => setRoute(parse(location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (r: Route): void => {
    history.pushState(null, '', href(r));
    setRoute(r);
  };
  return <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  return useContext(RouterContext);
}

export function Link({ to, children, className }: { to: Route; children: ReactNode; className?: string }) {
  const { navigate } = useRouter();
  return (
    <a
      href={href(to)}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
