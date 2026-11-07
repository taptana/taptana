/**
 * Router mínimo. Usa el historial del navegador.
 * La base (BASE_URL) la pone Vite: '/sessions/' en el server, '/' o '/taptana/' en Pages.
 *
 *   /                 lista de sesiones
 *   /:id              reproductor
 *   /studies          lista de estudios
 *   /studies/new      constructor (nuevo)
 *   /studies/:id      constructor (editar)
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export type Route =
  | { name: 'list' }
  | { name: 'player'; id: string }
  | { name: 'studies' }
  | { name: 'prototypes' }
  | { name: 'study'; id: string | null }
  | { name: 'report'; id: string };

function parse(pathname: string): Route {
  const rel = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const parts = rel.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'prototypes') return { name: 'prototypes' };
  if (parts[0] === 'studies') {
    if (!parts[1]) return { name: 'studies' };
    if (parts[2] === 'report') return { name: 'report', id: parts[1] };
    return { name: 'study', id: parts[1] === 'new' ? null : parts[1] };
  }
  if (parts[0]) return { name: 'player', id: parts[0] };
  return { name: 'list' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'player':
      return `${BASE}/${encodeURIComponent(route.id)}`;
    case 'studies':
      return `${BASE}/studies`;
    case 'prototypes':
      return `${BASE}/prototypes`;
    case 'study':
      return `${BASE}/studies/${route.id === null ? 'new' : encodeURIComponent(route.id)}`;
    case 'report':
      return `${BASE}/studies/${encodeURIComponent(route.id)}/report`;
    default:
      return `${BASE}/`;
  }
}

const RouterContext = createContext<{ route: Route; navigate: (r: Route, replace?: boolean) => void }>({
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
  const navigate = (r: Route, replace = false): void => {
    if (replace) history.replaceState(null, '', href(r));
    else history.pushState(null, '', href(r));
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
