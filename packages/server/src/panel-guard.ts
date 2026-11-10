/**
 * Guardia del panel: decide quién puede ver el panel y usar la API que maneja las grabaciones.
 *
 * Protege `/panel*` y toda la API salvo lo que usa el participante (`POST /events`,
 * `GET /studies/:id`) y un `GET /info` reducido. Dos reglas, en este orden:
 *
 * 1. Entre sitios → 403. Otra página web abierta en el navegador del diseñador no puede usar
 *    el panel a sus espaldas. Se rechaza si el navegador dice que la petición viene de otro
 *    sitio (`Sec-Fetch-Site: cross-site`) o si trae `Origin` y su host no es el nuestro. Abrir
 *    el panel con un clic desde otro sitio (un link en un correo o en la documentación) sí se
 *    permite: es una navegación normal, no una página usando el panel.
 *
 * 2. Acceso → 401 si no se cumple ninguna:
 *    - la conexión es local: viene de esta misma computadora;
 *    - trae la llave: `?key=…` la guarda en la cookie `taptana_key` (HttpOnly) y redirige a la
 *      misma dirección sin el parámetro;
 *    - el panel está en modo abierto (`--open-panel`, `TAPTANA_PANEL=open`).
 *
 * La llave vive en `<dataDir>/panel.key` y la terminal la imprime dentro del link
 * "Panel desde otro dispositivo".
 *
 * Riesgo aceptado en local: los prototipos subidos se sirven en el mismo origen que el panel
 * (`/p/<id>/`), así que el JavaScript de un prototipo podría llamar a esta API con la sesión
 * de quien lo abre desde el panel. En tu computadora son tus propios archivos; un servidor
 * hospedado necesita servirlos desde otro dominio (ver docs/servidor-hospedado.md).
 */

import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiError } from '@taptana/shared';
import { isLoopback, normalizeAddress, ownAddresses, ownHostNames } from './network.js';
import { crossSitePage, panelLockedPage } from './pages.js';

export const PANEL_KEY_COOKIE = 'taptana_key';
export const PANEL_KEY_PARAM = 'key';
export const PANEL_KEY_FILE = 'panel.key';

const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 180;
/** Cabeceras que pone un proxy: quien llega a través de uno no está en esta computadora. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded'];

export const LOCKED_MESSAGE =
  'El panel solo se abre desde la computadora donde corre Taptana. Si eres participante, abre el link del estudio que te compartieron.';
export const CROSS_SITE_MESSAGE = 'Esta petición viene de otro sitio web y Taptana no la acepta.';

export interface PanelGuardOptions {
  /** La llave del panel. Sin ella, solo entran las conexiones locales (o todas, en modo abierto). */
  key?: string;
  /** Modo abierto: cualquiera en la red puede ver el panel. */
  open?: boolean;
  /**
   * De dónde viene la conexión. Por defecto, la dirección del socket de Node. `undefined`
   * significa "no hay socket" (pruebas con `app.request`) y cuenta como local.
   */
  remoteAddress?: (c: Context) => string | undefined;
}

export interface PanelGuard {
  readonly key: string | undefined;
  readonly open: boolean;
  /** ¿La conexión viene de esta misma computadora? */
  isLocal(c: Context): boolean;
  /** ¿La petición la hace otra página web? */
  isCrossSite(c: Context): boolean;
  /** ¿Puede ver el panel y sus datos? Solo consulta: no responde ni pone cookies. */
  allows(c: Context): boolean;
  /** Para las páginas del panel: responde con una página amable y limpia `?key=` de la dirección. */
  pages: MiddlewareHandler;
  /** Para la API: responde JSON. */
  api: MiddlewareHandler;
}

/** Lee la llave del panel o la crea la primera vez. */
export function loadPanelKey(dataDir: string): string {
  const file = join(dataDir, PANEL_KEY_FILE);
  try {
    const saved = readFileSync(file, 'utf8').trim();
    if (/^[A-Za-z0-9_-]{16,128}$/.test(saved)) return saved;
  } catch {
    /* todavía no existe */
  }
  const key = randomBytes(18).toString('base64url');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  return key;
}

interface NodeBindings {
  incoming?: { socket?: { remoteAddress?: string } };
}

/** Dirección del socket con @hono/node-server. Un socket ya cerrado no cuenta como local. */
function socketAddress(c: Context): string | undefined {
  const env = c.env as (NodeBindings & { server?: NodeBindings }) | undefined;
  const incoming = env?.server?.incoming ?? env?.incoming;
  if (!incoming) return undefined;
  return incoming.socket?.remoteAddress ?? 'unknown';
}

function requestHost(c: Context): string {
  return (c.req.header('host') ?? new URL(c.req.url).host).toLowerCase();
}

/** "192.168.1.5:4321" → "192.168.1.5"; "[::1]:4321" → "::1". */
function hostName(host: string): string {
  if (host.startsWith('[')) return host.slice(1, Math.max(1, host.indexOf(']')));
  const colon = host.lastIndexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

/** ¿Es un nombre con el que esta computadora se llama a sí misma? */
function isOwnHostName(name: string): boolean {
  if (name === 'localhost' || name.endsWith('.localhost') || isLoopback(name)) return true;
  return ownAddresses().has(normalizeAddress(name)) || ownHostNames().includes(name);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createPanelGuard(opts: PanelGuardOptions = {}): PanelGuard {
  const remoteAddress = opts.remoteAddress ?? socketAddress;
  const key = opts.key;
  const open = opts.open === true;

  const isLocal = (c: Context): boolean => {
    const address = remoteAddress(c);
    if (address === undefined) return true;
    if (PROXY_HEADERS.some((name) => c.req.header(name) !== undefined)) return false;
    const ip = normalizeAddress(address);
    if (!isLoopback(ip) && !ownAddresses().has(ip)) return false;
    // Una página de otro sitio puede hacer que su dominio apunte a 127.0.0.1 ("DNS rebinding"):
    // la conexión es local pero el nombre con que nos llaman no es el nuestro.
    return isOwnHostName(hostName(requestHost(c)));
  };

  const isCrossSite = (c: Context): boolean => {
    const site = c.req.header('sec-fetch-site');
    // El navegador mismo dice que la página que pide es nuestra (o que lo pidió la persona).
    if (site === 'same-origin' || site === 'none') return false;
    if (site === 'cross-site' || site === 'same-site') {
      const method = c.req.method;
      const navigation = (method === 'GET' || method === 'HEAD') && c.req.header('sec-fetch-mode') === 'navigate' && c.req.header('sec-fetch-dest') === 'document';
      if (navigation) return false;
      if (site === 'cross-site') return true;
    }
    // "same-site" (otro puerto de esta máquina) o sin la cabecera (HTTP en la red local no la
    // manda): se compara Origin con nuestro host.
    const origin = c.req.header('origin');
    if (origin === undefined) return site === 'same-site';
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return true; // "null": un iframe aislado o un archivo local
    }
    if (originHost === '') return true;
    const forwarded = c.req.header('x-forwarded-host')?.toLowerCase();
    return originHost !== requestHost(c) && originHost !== forwarded;
  };

  const hasKey = (c: Context): boolean => {
    if (!key) return false;
    const cookie = getCookie(c, PANEL_KEY_COOKIE);
    return cookie !== undefined && safeEqual(cookie, key);
  };

  const allowed = (c: Context): boolean => open || isLocal(c) || hasKey(c);

  const deny = (c: Context, kind: 'pages' | 'api', status: 401 | 403, wrongKey = false): Response => {
    c.header('cache-control', 'no-store');
    if (kind === 'api') return c.json<ApiError>({ error: status === 403 ? CROSS_SITE_MESSAGE : LOCKED_MESSAGE }, status);
    return c.html(status === 403 ? crossSitePage() : panelLockedPage({ wrongKey }), status);
  };

  const middleware =
    (kind: 'pages' | 'api'): MiddlewareHandler =>
    async (c, next) => {
      if (isCrossSite(c)) return deny(c, kind, 403);
      let ok = allowed(c);
      const given = c.req.query(PANEL_KEY_PARAM);
      if (given !== undefined) {
        if (key && safeEqual(given, key)) {
          setCookie(c, PANEL_KEY_COOKIE, key, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: COOKIE_MAX_AGE_S });
          ok = true;
          if (kind === 'pages' && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
            // La llave no se queda en la barra de direcciones ni en el historial.
            const url = new URL(c.req.url);
            url.searchParams.delete(PANEL_KEY_PARAM);
            c.header('cache-control', 'no-store');
            return c.redirect(url.pathname + url.search, 302);
          }
        } else if (!ok) {
          return deny(c, kind, 401, true);
        }
      }
      if (!ok) return deny(c, kind, 401);
      return next();
    };

  return {
    key,
    open,
    isLocal,
    isCrossSite,
    allows: (c) => !isCrossSite(c) && allowed(c),
    pages: middleware('pages'),
    api: middleware('api'),
  };
}
