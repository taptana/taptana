/**
 * Prototipos por URL: Taptana sirve un sitio publicado (Vercel, Lovable, v0, un servidor de
 * desarrollo en la laptop…) a través de sí mismo, en /p/<id>/, con el recorder inyectado.
 * Para el participante es igual que un prototipo subido: misma dirección, misma Wi-Fi, mismos
 * resultados.
 *
 * Reglas:
 * - Solo se habla con el origen configurado (`sourceUrl`). La ruta se pone sobre ese origen, así
 *   que ninguna petición puede cambiar de sitio. La URL la elige el dueño del panel (detrás de la
 *   guardia); el participante no la puede cambiar. Se permiten direcciones locales (localhost,
 *   la red de la casa): un servidor de desarrollo en la laptop es uno de los usos principales.
 * - Las redirecciones no se siguen: se devuelven al navegador, reescritas para que se queden
 *   bajo /p/<id>/ si son del mismo sitio (las que van a otro sitio pasan tal cual).
 * - En el HTML: se inyecta el recorder (igual que en los subidos), las rutas que empiezan con
 *   "/" o con el origen del sitio se ponen bajo /p/<id>/ y se quita la CSP. Lo que pide el
 *   JavaScript con rutas absolutas (`fetch('/api/x')`) llega a la raíz de Taptana y lo devuelve
 *   la redirección por Referer de app.ts.
 * - Se quitan las cabeceras que impedirían inyectar o incrustar (CSP, X-Frame-Options, HSTS).
 * - Un service worker del sitio no se instala: la petición de su script (cabecera
 *   `Service-Worker: script`) recibe 404. Así no puede quedarse con /p/<id>/ y servir páginas
 *   sin el recorder. También se quita `Service-Worker-Allowed`.
 * - Nada se guarda en disco: cada petición va al sitio en ese momento.
 * - WebSockets no pasan (la recarga en caliente de un servidor de desarrollo no funciona a
 *   través de Taptana; la página sí carga).
 */

import { normalizePrototypeUrl, type PrototypeUrlCheck, type PrototypeUrlIssue } from '@taptana/shared';
import { injectRecorder } from './inject.js';
import { upstreamDownPage } from './pages.js';
import { PANEL_KEY_COOKIE, PANEL_KEY_HEADER } from './panel-guard.js';
import { usesHistoryRouter } from './uploads.js';

/** Cuánto se espera a que el sitio empiece a responder. */
export const UPSTREAM_TIMEOUT_MS = 15_000;
/** Un HTML más grande que esto pasa sin tocar (sin recorder): casi seguro no es una pantalla. */
export const HTML_MAX_BYTES = 10 * 1024 * 1024;

export interface ProxyTarget {
  prototypeId: string;
  /** La URL del prototipo ("https://mi-app.vercel.app/inicio"). Se usa su origen. */
  sourceUrl: string;
  /** Prefijo donde lo ve el navegador ("/p/pr_abc"), o "" si está en la raíz. */
  base: string;
}

type FetchLike = (input: URL | string, init?: RequestInit) => Promise<Response>;

// ── URL ──────────────────────────────────────────────────────────────

/**
 * La dirección en el sitio para una ruta pedida bajo /p/<id>/. La ruta se coloca sobre el
 * origen: "//otro.com/x" o "/\\otro.com" quedan como rutas del mismo sitio, nunca otro host.
 */
export function upstreamUrl(sourceUrl: string, rel: string, search = ''): URL {
  const url = new URL(new URL(sourceUrl).origin);
  url.pathname = `/${rel.replace(/^[/\\]+/, '')}`;
  url.search = search;
  return url;
}

/** Una URL del sitio (absoluta, o relativa a `from`) vista desde Taptana: bajo `base` si es del mismo origen. */
export function rewriteLocation(location: string, from: URL, base: string): string {
  let target: URL;
  try {
    target = new URL(location, from);
  } catch {
    return location;
  }
  if (target.origin !== from.origin) return location;
  return `${base}${target.pathname}${target.search}${target.hash}`;
}

/**
 * Un valor de href/src/action del HTML del sitio: "/x" y "https://sitio/x" → "<base>/x".
 * Lo relativo, lo de otros sitios, "data:", "mailto:" y "#ancla" quedan igual.
 */
export function rewriteHtmlUrl(value: string, origin: URL, base: string): string {
  const v = value.trim();
  if (v.startsWith('//')) {
    try {
      const u = new URL(`${origin.protocol}${v}`);
      return u.host === origin.host ? `${base}${u.pathname}${u.search}${u.hash}` : value;
    } catch {
      return value;
    }
  }
  if (v.startsWith('/')) return base && !v.startsWith(`${base}/`) ? `${base}${v}` : value;
  const o = origin.origin;
  if (v.toLowerCase().startsWith(o.toLowerCase())) {
    const rest = v.slice(o.length);
    if (rest === '' || /^[/?#]/.test(rest)) return `${base}${rest.startsWith('/') ? rest : `/${rest}`}`;
  }
  return value;
}

const URL_ATTRS = 'href|src|action|formaction|poster|data|srcset|imagesrcset';
const ATTR_RE = new RegExp(`(\\s(?:${URL_ATTRS})\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'gi');
const CSP_META_RE = /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy(?:-report-only)?\b[^>]*>/gi;

/**
 * El HTML del sitio, listo para servirse bajo `base`: sin la CSP de <meta> y con las rutas
 * absolutas del mismo sitio dentro del prototipo. El recorder lo agrega quien llama.
 */
export function rewriteHtml(html: string, origin: URL, base: string): string {
  return html.replace(CSP_META_RE, '').replace(ATTR_RE, (match, prefix: string, dq?: string, sq?: string, bare?: string) => {
    const raw = dq ?? sq ?? bare ?? '';
    const name = prefix.trim().replace(/\s*=$/, '').toLowerCase();
    const next = name.endsWith('srcset') ? rewriteSrcset(raw, origin, base) : rewriteHtmlUrl(raw, origin, base);
    if (next === raw) return match;
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : '"';
    return `${prefix}${quote}${next}${quote}`;
  });
}

function rewriteSrcset(value: string, origin: URL, base: string): string {
  if (/data:/i.test(value)) return value;
  return value
    .split(',')
    .map((candidate) => {
      const m = /^(\s*)(\S+)(.*)$/s.exec(candidate);
      return m ? `${m[1]}${rewriteHtmlUrl(m[2] as string, origin, base)}${m[3]}` : candidate;
    })
    .join(',');
}

// ── Cabeceras ────────────────────────────────────────────────────────

/** Cabeceras del navegador que el sitio puede necesitar. Lo demás (host, forwarded, IP…) no se manda. */
const FORWARD_REQUEST = new Set([
  'accept',
  'accept-language',
  'authorization',
  'cache-control',
  'content-type',
  'cookie',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'if-unmodified-since',
  'pragma',
  'range',
  'user-agent',
  // Navegación de Next.js (App Router) y acciones del servidor.
  'rsc',
  'next-action',
  'next-router-state-tree',
  'next-router-prefetch',
  'next-router-segment-prefetch',
  'next-url',
]);
const NEVER_FORWARD = new Set(['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-real-ip', PANEL_KEY_HEADER]);

/**
 * Las cabeceras para el sitio. `host` lo pone fetch (el del sitio); `origin` y `referer` se
 * traducen al sitio. La cookie con la llave del panel nunca sale de Taptana.
 */
export function requestHeaders(incoming: Headers, target: ProxyTarget, publicHost: string): Headers {
  const origin = new URL(target.sourceUrl).origin;
  const out = new Headers();
  for (const [name, value] of incoming) {
    const key = name.toLowerCase();
    if (FORWARD_REQUEST.has(key) || (key.startsWith('x-') && !NEVER_FORWARD.has(key))) out.set(key, value);
  }
  const cookie = out.get('cookie');
  if (cookie !== null) {
    const kept = cookie
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part && part.split('=')[0]?.trim() !== PANEL_KEY_COOKIE);
    if (kept.length > 0) out.set('cookie', kept.join('; '));
    else out.delete('cookie');
  }
  if (incoming.has('origin')) out.set('origin', origin);
  const referer = upstreamReferer(incoming.get('referer'), target, publicHost);
  if (referer) out.set('referer', referer);
  return out;
}

/** "http://taptana:4321/p/pr_1/carrito?x" → "https://sitio/carrito?x". Lo que no viene del prototipo no se manda. */
export function upstreamReferer(referer: string | null | undefined, target: ProxyTarget, publicHost: string): string | null {
  if (!referer) return null;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  if (url.host !== publicHost) return null;
  let path = url.pathname;
  if (target.base) {
    if (path === target.base) path = '/';
    else if (path.startsWith(`${target.base}/`)) path = path.slice(target.base.length);
    else return null;
  }
  return `${new URL(target.sourceUrl).origin}${path}${url.search}`;
}

/** Cabeceras del sitio que se quitan siempre: impedirían inyectar el recorder, incrustarlo en el panel o cambiarían el navegador del participante. */
const DROP_RESPONSE = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'strict-transport-security',
  'service-worker-allowed',
  'clear-site-data',
  'alt-svc',
  'nel',
  'report-to',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'set-cookie',
  'location',
]);

export interface ResponseHeaderOptions {
  target: ProxyTarget;
  /** La dirección que se le pidió al sitio (para resolver redirecciones relativas). */
  requested: URL;
  /** El navegador ve a Taptana por https (si no, las cookies `Secure` no se guardarían). */
  secure: boolean;
  /** El cuerpo cambia (HTML reescrito): largo, ETag y fechas ya no valen. */
  rewritten: boolean;
}

export function responseHeaders(upstream: Headers, opts: ResponseHeaderOptions): Headers {
  const out = new Headers();
  // fetch ya descomprimió el cuerpo: si venía comprimido, su largo tampoco vale.
  const decoded = upstream.has('content-encoding');
  for (const [name, value] of upstream) {
    const key = name.toLowerCase();
    if (DROP_RESPONSE.has(key)) continue;
    if (key === 'content-encoding') continue;
    if (key === 'content-length' && (decoded || opts.rewritten)) continue;
    if (opts.rewritten && (key === 'etag' || key === 'last-modified')) continue;
    out.set(key, value);
  }
  const location = upstream.get('location');
  if (location !== null) out.set('location', rewriteLocation(location, opts.requested, opts.target.base));
  for (const cookie of upstream.getSetCookie()) out.append('set-cookie', rewriteSetCookie(cookie, { base: opts.target.base, secure: opts.secure }));
  return out;
}

/**
 * Una cookie del sitio, para que el navegador la guarde en Taptana: sin `Domain` (es de otro
 * host), con `Path` bajo el prototipo y, si Taptana va por http, sin `Secure` (y `SameSite=None`
 * pasa a `Lax`, que es lo que exige el navegador sin `Secure`). Alcanza para cookies de sesión
 * simples; las de nombre `__Host-`/`__Secure-` solo funcionan si Taptana va por https.
 */
export function rewriteSetCookie(value: string, opts: { base: string; secure: boolean }): string {
  const [pair = '', ...attrs] = value.split(';');
  const out: string[] = [pair.trim()];
  let path = '/';
  for (const attr of attrs) {
    const trimmed = attr.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const name = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim().toLowerCase();
    const val = eq === -1 ? '' : trimmed.slice(eq + 1).trim();
    if (name === 'domain') continue;
    if (name === 'path') {
      path = val.startsWith('/') ? val : '/';
      continue;
    }
    if (!opts.secure && (name === 'secure' || name === 'partitioned')) continue;
    if (!opts.secure && name === 'samesite' && val.toLowerCase() === 'none') {
      out.push('SameSite=Lax');
      continue;
    }
    out.push(trimmed);
  }
  out.push(`Path=${opts.base}${path}`);
  return out.join('; ');
}

// ── La petición ──────────────────────────────────────────────────────

export interface ProxyOptions {
  /** Ruta dentro del prototipo ("/carrito"). */
  rel: string;
  /** "?x=1" o "". */
  search: string;
  /** Host con el que el navegador ve a Taptana ("192.168.1.5:4321"), para traducir el Referer. */
  publicHost: string;
  secure: boolean;
  fetch?: FetchLike;
  timeoutMs?: number;
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

const isNavigation = (req: Request): boolean =>
  (req.method === 'GET' || req.method === 'HEAD') && (req.headers.get('sec-fetch-mode') === 'navigate' || (req.headers.get('accept') ?? '').includes('text/html'));

/** Pide la ruta al sitio y devuelve la respuesta lista para el navegador (o una página de error en español). */
export async function proxyRequest(req: Request, target: ProxyTarget, opts: ProxyOptions): Promise<Response> {
  // El script de un service worker: no se instala (ver arriba).
  if (req.headers.get('service-worker') === 'script') {
    return new Response('Taptana no instala service workers de prototipos por URL.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const requested = upstreamUrl(target.sourceUrl, opts.rel, opts.search);
  const doFetch: FetchLike = opts.fetch ?? fetch;
  const method = req.method.toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers: requestHeaders(req.headers, target, opts.publicHost),
      redirect: 'manual',
      signal: controller.signal,
    };
    if (method !== 'GET' && method !== 'HEAD' && req.body) {
      init.body = req.body;
      init.duplex = 'half';
    }
    res = await doFetch(requested, init);
  } catch {
    clearTimeout(timer);
    const timedOut = controller.signal.aborted;
    const shown = new URL(target.sourceUrl).origin;
    if (isNavigation(req)) {
      return new Response(upstreamDownPage({ url: shown, timeout: timedOut }), {
        status: 502,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return new Response(`No pudimos abrir tu prototipo en ${shown}${timedOut ? ': tardó demasiado en responder.' : '.'}`, {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  clearTimeout(timer);

  const type = res.headers.get('content-type') ?? '';
  const length = Number(res.headers.get('content-length') ?? '0');
  const html = /^\s*text\/html/i.test(type) && method !== 'HEAD' && !NULL_BODY.has(res.status) && !(length > HTML_MAX_BYTES && !res.headers.has('content-encoding'));
  const headers = responseHeaders(res.headers, { target, requested, secure: opts.secure, rewritten: html });

  if (html) {
    const text = await res.text();
    const page = injectRecorder(rewriteHtml(text, requested, target.base), { prototypeId: target.prototypeId, ...(target.base && { base: target.base }) });
    headers.set('content-type', 'text/html; charset=utf-8');
    // La página reescrita no se guarda en el navegador: siempre se ve lo que está publicado ahora.
    headers.set('cache-control', 'no-cache');
    return new Response(page, { status: res.status, statusText: res.statusText, headers });
  }
  const body = method === 'HEAD' || NULL_BODY.has(res.status) ? null : res.body;
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

// ── Revisar una URL antes de agregarla ───────────────────────────────

const LOGIN_PATH = /(?:^|[/._-])(?:login|log-in|signin|sign-in|sign_in|auth|sso|oauth2?|session\/new|iniciar-sesion|ingresar|acceder)(?:$|[/._?-])/i;
const LOGIN_HOST = /(?:^|[.-])(?:auth|login|sso|accounts?|id|clerk|auth0|okta)(?:[.-]|$)/i;
const CHECK_HTML_MAX = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** Cuántos scripts se leen como mucho al buscar un router (el de entrada y lo que importa directo). */
const MAX_SCRIPTS = 8;

export const looksLikeLogin = (url: URL): boolean => LOGIN_PATH.test(url.pathname) || LOGIN_HOST.test(url.hostname) || /\/sso-api\b/.test(url.pathname);

function titleOf(html: string): string | undefined {
  const raw = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  const title = raw
    ?.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return title ? title.slice(0, 120) : undefined;
}

/** ¿El HTML casi no tiene texto y sí scripts? Es una app que se arma con JavaScript. */
export function emptyWithoutJs(html: string): boolean {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const text = body
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length < 40 && /<script\b/i.test(html);
}

/** Los scripts del mismo sitio que carga el HTML, para buscar un router de History. */
function scriptUrls(html: string, page: URL): URL[] {
  const out: URL[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\ssrc\s*=\s*["']?([^"'\s>]+)/gi)) {
    try {
      const u = new URL(m[1] as string, page);
      if (u.origin === page.origin && !out.some((x) => x.href === u.href)) out.push(u);
    } catch {
      /* src inválido */
    }
  }
  return out.slice(0, MAX_SCRIPTS);
}

/** Lo que un módulo importa de forma estática ("./chunk-x.js", "/assets/y.js"): el router suele estar en otro trozo. */
export function staticImports(code: string, from: URL): URL[] {
  const out: URL[] = [];
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']((?:\.{1,2}\/|\/)[^"'\s]+?\.m?[jt]sx?)["']/g)) {
    try {
      const u = new URL(m[1] as string, from);
      if (u.origin === from.origin && !out.some((x) => x.href === u.href)) out.push(u);
    } catch {
      /* ruta inválida */
    }
  }
  return out;
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= max) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max));
}

const CHECK_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'es,en;q=0.8',
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 Taptana',
};

const levelOf = (issues: PrototypeUrlIssue[]): PrototypeUrlCheck['level'] =>
  issues.some((i) => i.level === 'error') ? 'error' : issues.some((i) => i.level === 'warning') ? 'warning' : 'ok';

/**
 * Abre la URL como lo haría el celular (sin JavaScript) y dice si sirve como prototipo, con
 * avisos en español. No guarda nada. `secure`: Taptana se ve por https.
 */
export async function checkPrototypeUrl(input: string, opts: { fetch?: FetchLike; timeoutMs?: number; secure?: boolean } = {}): Promise<PrototypeUrlCheck> {
  const normalized = normalizePrototypeUrl(input);
  if (!normalized.ok) return { url: input.trim(), level: 'error', issues: [{ level: 'error', code: 'invalid', message: normalized.error }] };
  const doFetch: FetchLike = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const start = new URL(normalized.url);
  const issues: PrototypeUrlIssue[] = [];
  const result: PrototypeUrlCheck = { url: normalized.url, level: 'ok', issues };
  const done = (): PrototypeUrlCheck => ({ ...result, level: levelOf(issues) });

  let current = start;
  let res: Response | undefined;
  let secureCookies = false;
  for (let hop = 0; ; hop++) {
    try {
      res = await doFetch(current, { headers: CHECK_HEADERS, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        issues.push({ level: 'error', code: 'timeout', message: `${current.origin} tardó más de ${Math.round(timeoutMs / 1000)} segundos en responder. Revisa que el sitio esté encendido y vuelve a intentar.` });
      } else {
        const local = /^(localhost|127\.|\[::1\])/.test(current.host);
        issues.push({
          level: 'error',
          code: 'unreachable',
          message: local
            ? `No pudimos abrir ${current.origin}. Si es tu servidor de desarrollo, revisa que esté corriendo (por ejemplo con «npm run dev») y que el puerto sea el correcto.`
            : `No pudimos abrir ${current.origin}. Revisa que la dirección esté bien escrita y que esta computadora tenga internet.`,
        });
      }
      return done();
    }
    result.status = res.status;
    for (const cookie of res.headers.getSetCookie()) if (/;\s*secure\b/i.test(cookie) || /^__(?:host|secure)-/i.test(cookie)) secureCookies = true;
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        issues.push({ level: 'error', code: 'http-error', message: 'El sitio redirige a una dirección inválida.' });
        return done();
      }
      if (next.origin !== start.origin) {
        next.hash = '';
        if (looksLikeLogin(next)) {
          issues.push({ level: 'error', code: 'login', message: `Esta dirección te manda a iniciar sesión en ${next.host}. Taptana no puede pasar por un inicio de sesión: publica el prototipo sin contraseña o compártelo como público.` });
        } else {
          result.suggestedUrl = next.toString();
          issues.push({ level: 'error', code: 'other-host', message: `Esta dirección redirige a otro sitio (${next.host}). Usa directamente la dirección final.` });
        }
        return done();
      }
      if (looksLikeLogin(next)) {
        issues.push({ level: 'warning', code: 'login', message: `El sitio redirige a una página que parece de inicio de sesión (${next.pathname}). Si tu prototipo pide cuenta, los participantes también la necesitarán.` });
      }
      if (hop + 1 >= MAX_REDIRECTS) {
        issues.push({ level: 'error', code: 'too-many-redirects', message: 'El sitio redirige demasiadas veces seguidas. Ábrelo en el navegador y copia la dirección donde termina.' });
        return done();
      }
      current = next;
      continue;
    }
    break;
  }

  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel().catch(() => undefined);
    issues.push({ level: 'error', code: 'login', message: `El sitio no deja entrar sin iniciar sesión (respondió ${res.status}). Publica el prototipo como público o quita la contraseña.` });
    return done();
  }
  if (res.status >= 400) {
    await res.body?.cancel().catch(() => undefined);
    issues.push({
      level: 'error',
      code: 'http-error',
      message: res.status === 404 ? 'En esa dirección no hay ninguna página (404). Revisa que esté bien copiada.' : `El sitio respondió con un error (${res.status}). Vuelve a intentar en un momento.`,
    });
    return done();
  }
  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml/i.test(type)) {
    await res.body?.cancel().catch(() => undefined);
    issues.push({ level: 'error', code: 'not-html', message: `Esa dirección no es una página web (es ${type.split(';')[0] || 'otro tipo de archivo'}). Usa la dirección de la página de inicio de tu prototipo.` });
    return done();
  }

  const html = await readCapped(res, CHECK_HTML_MAX).catch(() => '');
  const title = titleOf(html);
  if (title) result.title = title;
  if (emptyWithoutJs(html)) {
    issues.push({ level: 'info', code: 'empty-without-js', message: 'La página se arma con JavaScript (es una app de una sola página). Está bien: Taptana la graba igual. Sus pantallas aparecen en el constructor cuando alguien la recorre.' });
  }
  let history = usesHistoryRouter(html);
  const queue = history ? [] : scriptUrls(html, current);
  for (let i = 0; i < queue.length && i < MAX_SCRIPTS && !history; i++) {
    const script = queue[i] as URL;
    try {
      const r = await doFetch(script, { headers: { ...CHECK_HEADERS, accept: '*/*' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) {
        await r.body?.cancel().catch(() => undefined);
        continue;
      }
      const code = await readCapped(r, CHECK_HTML_MAX);
      if (usesHistoryRouter(code)) history = true;
      for (const next of staticImports(code, script)) if (!queue.some((q) => q.href === next.href)) queue.push(next);
    } catch {
      /* un script que no carga no cambia el veredicto */
    }
    if (history) break;
  }
  if (history) {
    result.absoluteUrls = true;
    issues.push({ level: 'info', code: 'history-router', message: 'Parece una app con rutas propias. Si al navegar vuelve siempre al inicio, activa «Abrir en la raíz» en Prototipos.' });
  }
  if (secureCookies && !opts.secure) {
    issues.push({ level: 'warning', code: 'secure-cookies', message: 'El sitio usa cookies que solo funcionan con https. Taptana va por http en tu red: si el prototipo guarda una sesión o un carrito en cookies, puede que no lo recuerde.' });
  }
  return done();
}
