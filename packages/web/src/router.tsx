/**
 * Router mínimo sobre el historial del navegador.
 * La base (BASE_URL) la pone Vite: '/panel/' en el server, '/' o '/taptana/' en Pages.
 *
 *   (base)                     Inicio
 *   prototypes                 prototipos
 *   studies                    lista de estudios
 *   studies/new                constructor (nuevo)
 *   studies/:id                constructor (editar)
 *   studies/:id/report         resultados
 *   studies/:id/presentation   presentación ([?variant=<id>][&device=touch|desktop])
 *   recordings[?study=<id>]    sesiones
 *   recordings/:id[?t=<ms>]    reproductor (t: instante desde el inicio de la sesión)
 *
 * Lo viejo redirige: (base)/<idDeSesión> → recordings/<id>.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export type Route =
  | { name: 'home' }
  | { name: 'prototypes' }
  | { name: 'studies' }
  | { name: 'study'; id: string | null }
  | { name: 'report'; id: string }
  | { name: 'presentation'; id: string; variant?: string; device?: 'touch' | 'desktop' }
  | { name: 'recordings'; study?: string }
  | { name: 'player'; id: string; t?: number }
  | { name: 'notfound' };

export type RouteName = Route['name'];

/** Interpreta una dirección. `redirected` indica que era una dirección antigua. */
export function parseRoute(pathname: string, search = ''): { route: Route; redirected: boolean } {
  const rel = BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  let parts: string[];
  try {
    parts = rel.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return { route: { name: 'notfound' }, redirected: false };
  }
  const query = new URLSearchParams(search);
  const ok = (route: Route): { route: Route; redirected: boolean } => ({ route, redirected: false });
  const [first, second, third, ...rest] = parts;

  if (first === undefined || (first === 'index.html' && second === undefined)) return ok({ name: 'home' });
  if (first === 'prototypes' && second === undefined) return ok({ name: 'prototypes' });
  if (first === 'studies') {
    if (second === undefined) return ok({ name: 'studies' });
    if (third === undefined) return ok({ name: 'study', id: second === 'new' ? null : second });
    if (third === 'report' && rest.length === 0) return ok({ name: 'report', id: second });
    if (third === 'presentation' && rest.length === 0) {
      const route: Extract<Route, { name: 'presentation' }> = { name: 'presentation', id: second };
      const variant = query.get('variant');
      const device = query.get('device');
      if (variant) route.variant = variant;
      if (device === 'touch' || device === 'desktop') route.device = device;
      return ok(route);
    }
    return ok({ name: 'notfound' });
  }
  if (first === 'recordings' || first === 'sessions') {
    if (second === undefined) {
      const study = query.get('study');
      return { route: study ? { name: 'recordings', study } : { name: 'recordings' }, redirected: first === 'sessions' };
    }
    if (third === undefined) {
      const t = Number(query.get('t'));
      const route: Route = query.has('t') && Number.isFinite(t) && t >= 0 ? { name: 'player', id: second, t } : { name: 'player', id: second };
      return { route, redirected: first === 'sessions' };
    }
    return ok({ name: 'notfound' });
  }
  // Antes el reproductor vivía en (base)/<idDeSesión>.
  if (second === undefined && /^[A-Za-z0-9_-]{6,}$/.test(first)) return { route: { name: 'player', id: first }, redirected: true };
  return ok({ name: 'notfound' });
}

export function href(route: Route): string {
  switch (route.name) {
    case 'prototypes':
      return `${BASE}/prototypes`;
    case 'studies':
      return `${BASE}/studies`;
    case 'study':
      return `${BASE}/studies/${route.id === null ? 'new' : encodeURIComponent(route.id)}`;
    case 'report':
      return `${BASE}/studies/${encodeURIComponent(route.id)}/report`;
    case 'presentation': {
      const q = new URLSearchParams();
      if (route.variant) q.set('variant', route.variant);
      if (route.device) q.set('device', route.device);
      const search = q.toString();
      return `${BASE}/studies/${encodeURIComponent(route.id)}/presentation${search ? `?${search}` : ''}`;
    }
    case 'recordings':
      return `${BASE}/recordings${route.study ? `?study=${encodeURIComponent(route.study)}` : ''}`;
    case 'player':
      return `${BASE}/recordings/${encodeURIComponent(route.id)}${route.t !== undefined ? `?t=${Math.round(route.t)}` : ''}`;
    default:
      return `${BASE}/`;
  }
}

/** Dirección absoluta (con origen) de una ruta del panel, para compartir o abrir en otra pestaña. */
export function absoluteHref(route: Route): string {
  return new URL(href(route), location.origin).toString();
}

/**
 * Un bloqueo de navegación (cambios sin guardar). Recibe `proceed`: llámalo para continuar la
 * navegación que se detuvo. Devuelve true si la navegación puede seguir de inmediato.
 */
type Blocker = (proceed: () => void) => boolean;

interface RouterValue {
  route: Route;
  navigate: (route: Route, opts?: { replace?: boolean; force?: boolean }) => void;
  setBlocker: (blocker: Blocker | null) => void;
}

const RouterContext = createContext<RouterValue>({ route: { name: 'home' }, navigate: () => {}, setBlocker: () => {} });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => {
    const parsed = parseRoute(location.pathname, location.search);
    if (parsed.redirected) history.replaceState(null, '', href(parsed.route));
    return parsed.route;
  });
  const blocker = useRef<Blocker | null>(null);
  const current = useRef(location.href);

  const go = useCallback((next: Route, replace: boolean): void => {
    const url = href(next);
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    current.current = location.href;
    setRoute(next);
    if (!replace) window.scrollTo(0, 0);
  }, []);

  const navigate = useCallback<RouterValue['navigate']>(
    (next, opts = {}) => {
      const proceed = (): void => go(next, opts.replace === true);
      if (!opts.force && blocker.current && !blocker.current(proceed)) return;
      proceed();
    },
    [go],
  );

  useEffect(() => {
    const onPop = (): void => {
      const target = location.href;
      const apply = (): void => {
        const parsed = parseRoute(location.pathname, location.search);
        if (parsed.redirected) history.replaceState(null, '', href(parsed.route));
        current.current = location.href;
        setRoute(parsed.route);
      };
      if (blocker.current && target !== current.current) {
        // Volvemos a dejar la dirección como estaba y preguntamos antes de salir.
        const stay = current.current;
        history.pushState(null, '', stay);
        const proceed = (): void => {
          history.pushState(null, '', target);
          apply();
        };
        if (!blocker.current(proceed)) return;
        proceed();
        return;
      }
      apply();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setBlocker = useCallback((b: Blocker | null): void => {
    blocker.current = b;
  }, []);

  return <RouterContext.Provider value={{ route, navigate, setBlocker }}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  return useContext(RouterContext);
}

/**
 * Detiene la navegación dentro del panel mientras `active` sea true (cambios sin guardar).
 * `onBlocked` recibe `proceed` para continuar después (por ejemplo, tras un diálogo).
 * También avisa al cerrar o recargar la pestaña.
 */
export function useNavigationBlocker(active: boolean, onBlocked: (proceed: () => void) => void): void {
  const { setBlocker } = useRouter();
  const handler = useRef(onBlocked);
  handler.current = onBlocked;
  useEffect(() => {
    if (!active) return;
    setBlocker((proceed) => {
      handler.current(() => {
        setBlocker(null);
        proceed();
      });
      return false;
    });
    const onUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      setBlocker(null);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [active, setBlocker]);
}

export function Link({
  to,
  children,
  className,
  replace,
  ...rest
}: { to: Route; children: ReactNode; className?: string; replace?: boolean } & Omit<React.ComponentProps<'a'>, 'href'>) {
  const { navigate } = useRouter();
  return (
    <a
      {...rest}
      href={href(to)}
      className={className}
      onClick={(e) => {
        rest.onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || rest.target === '_blank') return;
        e.preventDefault();
        navigate(to, replace ? { replace: true } : {});
      }}
    >
      {children}
    </a>
  );
}
