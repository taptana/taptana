/**
 * Pantallas. Un `ScreenId` identifica lo que el participante tiene delante:
 *
 * - por URL:           "/producto.html"          (sin query; "/" y "/carpeta/" → "…/index.html")
 * - por hash de ruta:  "/index.html#/carrito"    (solo si el hash empieza con "#/" o "#!")
 * - virtual:           "/index.html~checkout"    (misma URL; el nombre lo pone el recorder)
 *
 * Todo lo que compara pantallas (regla `reached`, camino esperado, embudo, mapas de calor) pasa
 * por aquí, para que recorder, servidor y panel digan lo mismo.
 */

import type { ScreenInfo } from './api.js';
import type { TaptanaEvent } from './events.js';

export interface ScreenParts {
  /** Ruta sin query, con "/" inicial e "index.html" explícito: "/producto.html". */
  path: string;
  /** Hash de ruta normalizado, con su "#": "#/carrito". Ausente si no hay o no es de ruta. */
  hash?: string;
  /** Nombre de la pantalla virtual, ya normalizado: "checkout". */
  virtual?: string;
}

/** "http://localhost:4321" al inicio de una URL completa. */
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/** ¿El hash es de ruta ("#/carrito", "#!/carrito") y no un ancla de la página ("#top")? */
export function isRouteHash(hash: string): boolean {
  const h = hash.startsWith('#') ? hash : `#${hash}`;
  return h.startsWith('#/') || h.startsWith('#!');
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/**
 * Nombre de pantalla en minúsculas y con guiones: "Datos de envío" → "datos-de-envio".
 * El recorder lo usa para nombrar pantallas virtuales a partir de un id o un encabezado.
 */
export function screenSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug;
}

/**
 * Separa el sufijo "~nombre" de una pantalla virtual. La virgulilla solo cuenta si viene después
 * de algo que no sea "/" (así "/~ana/index.html" sigue siendo una ruta normal).
 */
function splitVirtual(value: string): [string, string | undefined] {
  const at = value.lastIndexOf('~');
  if (at <= 0 || value[at - 1] === '/') return [value, undefined];
  const name = value.slice(at + 1);
  if (name.includes('/')) return [value, undefined];
  return [value.slice(0, at), screenSlug(name) || undefined];
}

function normalizePath(raw: string): string {
  let path = safeDecode(raw).replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.endsWith('/')) path += 'index.html';
  return path;
}

/** "#/carrito/?x=1" → "#/carrito". La ruta raíz ("#/", "#!/") es la pantalla sin hash. */
function normalizeHash(raw: string): string | undefined {
  if (!raw || !isRouteHash(raw)) return undefined;
  const query = raw.indexOf('?');
  const route = safeDecode(query === -1 ? raw : raw.slice(0, query)).replace(/\/+$/, '');
  return route === '#' || route === '#!' ? undefined : route;
}

/** Descompone cualquier ruta, URL o ScreenId en sus partes ya normalizadas. */
export function screenParts(input: string): ScreenParts {
  // Un dato guardado roto (no texto) se trata como la entrada, sin tirar un error.
  const s = (typeof input === 'string' ? input : '').trim().replace(ORIGIN, '');
  const hashAt = s.indexOf('#');
  let beforeHash = hashAt === -1 ? s : s.slice(0, hashAt);
  let rawHash = hashAt === -1 ? '' : s.slice(hashAt);
  let virtual: string | undefined;
  if (rawHash && isRouteHash(rawHash)) {
    if (!rawHash.includes('?')) [rawHash, virtual] = splitVirtual(rawHash);
  } else if (!beforeHash.includes('?')) {
    [beforeHash, virtual] = splitVirtual(beforeHash);
  }
  const parts: ScreenParts = { path: normalizePath(beforeHash.split('?')[0] ?? '') };
  const hash = normalizeHash(rawHash);
  if (hash) parts.hash = hash;
  if (virtual) parts.virtual = virtual;
  return parts;
}

/**
 * Normaliza una ruta ("/producto.html?id=3"), una URL completa o un ScreenId a su forma única.
 * Aplicarla dos veces da lo mismo.
 */
export function screenId(path: string): string {
  const p = screenParts(path);
  return p.path + (p.hash ?? '') + (p.virtual ? `~${p.virtual}` : '');
}

/** La misma comparación sin "index.html": "/carpeta", "/carpeta/" y "/carpeta/index.html" coinciden. */
function compareKey(path: string): string {
  const p = screenParts(path);
  const base = p.path.replace(/\/index\.html$/, '');
  return `${base}|${p.hash ?? ''}|${p.virtual ?? ''}`;
}

/** ¿Son la misma pantalla? Ignora la query, las anclas y la barra final. */
export function sameScreen(a: string, b: string): boolean {
  return compareKey(a) === compareKey(b);
}

/** La URL (relativa al prototipo) donde está la pantalla: sin el nombre virtual. */
export function screenUrl(id: string): string {
  const p = screenParts(id);
  return p.path + (p.hash ?? '');
}

/** Arma el ScreenId de una pantalla virtual: la URL actual + "~" + el nombre normalizado. */
export function virtualScreenId(path: string, name: string): string {
  const slug = screenSlug(name);
  const base = screenUrl(path);
  return slug ? `${base}~${slug}` : base;
}

/** Nombre corto para mostrar: "producto", "carrito", "checkout". La entrada es "inicio". */
export function screenLabel(id: string): string {
  const p = screenParts(id);
  if (p.virtual) return p.virtual;
  if (p.hash) return p.hash.replace(/^#!?\/?/, '') || 'inicio';
  const segments = p.path.split('/').filter(Boolean);
  if (segments[segments.length - 1] === 'index.html') segments.pop();
  const last = segments[segments.length - 1];
  if (!last) return 'inicio';
  return last.replace(/\.[a-z0-9]+$/i, '') || last;
}

function maskQuery(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      return eq === -1 ? pair : `${pair.slice(0, eq)}=*`;
    })
    .join('&');
}

/**
 * Quita de una URL lo que el participante pudo haber escrito: conserva la ruta y los nombres de
 * los parámetros, y reemplaza cada valor por "*" ("/buscar?q=ana" → "/buscar?q=*"). Los hash de
 * ruta se conservan (con su query enmascarada); las demás anclas se quitan.
 * Se aplica a `navigation.to/from`, `PageInfo.path`, `PageInfo.referrer` y al `href` del evento
 * Meta de rrweb. Acepta rutas y URLs completas. Aplicarla dos veces da lo mismo.
 */
export function maskUrl(url: string): string {
  if (typeof url !== 'string') return '';
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  let out = queryAt === -1 ? beforeHash : `${beforeHash.slice(0, queryAt)}?${maskQuery(beforeHash.slice(queryAt + 1))}`;
  if (hash && isRouteHash(hash)) {
    const hashQueryAt = hash.indexOf('?');
    out += hashQueryAt === -1 ? hash : `${hash.slice(0, hashQueryAt)}?${maskQuery(hash.slice(hashQueryAt + 1))}`;
  }
  return out;
}

/** Pantallas distintas que vio una sesión (para `SessionSummary.screenCount`). */
export function countScreens(events: readonly TaptanaEvent[]): number {
  const seen = new Set<string>();
  for (const e of events) {
    if (e && e.kind === 'taptana' && e.type === 'navigation' && typeof e.to === 'string') seen.add(screenId(e.to));
  }
  return seen.size;
}

/**
 * El título estable de cada pantalla (ScreenId → título). Es la única regla para nombrar
 * pantallas; la usan el reporte, las frases del resumen y `knownScreens` (el constructor):
 *
 * 1. Si la pantalla es un archivo HTML del prototipo, su `<title>` (salvo que varios archivos
 *    compartan el mismo título: entonces no distingue nada y no se usa).
 * 2. Si no, el título que traen los eventos de navegación, solo si TODAS las visitas dicen lo
 *    mismo. Una pantalla que cambia de título según su contenido ("Monstera", "Ficus" en
 *    producto.html; "Carrito" y "Datos de envío" en el mismo carrito) se queda sin título.
 * 3. Sin título, el nombre es `screenLabel(id)` (ver `screenName`).
 */
export function screenTitles(
  events: readonly TaptanaEvent[] = [],
  files: ReadonlyArray<{ path: string; title?: string }> = [],
): Map<string, string> {
  const titles = new Map<string, string>();
  const fileIds = new Set<string>();
  const fileTitleUses = new Map<string, number>();
  const fileTitles = new Map<string, string>();
  for (const file of files) {
    if (!file || typeof file.path !== 'string') continue;
    const id = screenId(file.path);
    if (fileIds.has(id)) continue;
    fileIds.add(id);
    const t = typeof file.title === 'string' ? file.title.trim() : '';
    if (!t) continue;
    fileTitles.set(id, t);
    fileTitleUses.set(t, (fileTitleUses.get(t) ?? 0) + 1);
  }
  for (const [id, t] of fileTitles) if (fileTitleUses.get(t) === 1) titles.set(id, t);
  // null: las visitas no coinciden en el título.
  const seen = new Map<string, string | null>();
  for (const e of events) {
    if (!e || e.kind !== 'taptana' || e.type !== 'navigation' || typeof e.to !== 'string') continue;
    if (typeof e.title !== 'string' || !e.title.trim()) continue;
    const id = screenId(e.to);
    if (titles.has(id) && fileIds.has(id)) continue;
    const t = e.title.trim();
    const before = seen.get(id);
    seen.set(id, before === undefined || before === t ? t : null);
  }
  for (const [id, t] of seen) if (t !== null && !titles.has(id)) titles.set(id, t);
  return titles;
}

/**
 * El nombre de una pantalla para mostrar: su título estable (de `screenTitles`,
 * `StudyReport.screenNames` o las pantallas de la API) o, si no tiene, `screenLabel(id)`.
 */
export function screenName(
  id: string,
  titles?: ReadonlyMap<string, string> | Readonly<Record<string, string | undefined>> | ReadonlyArray<{ id: string; name?: string; title?: string }>,
): string {
  const key = screenId(id);
  let found: string | undefined;
  if (titles instanceof Map) found = titles.get(key) ?? titles.get(id);
  else if (Array.isArray(titles)) {
    const info = (titles as ReadonlyArray<{ id: string; name?: string; title?: string }>).find((s) => s && (s.id === key || s.id === id));
    found = info?.name ?? info?.title;
  } else if (titles) {
    const rec = titles as Readonly<Record<string, string | undefined>>;
    found = (Object.hasOwn(rec, key) ? rec[key] : undefined) ?? (Object.hasOwn(rec, id) ? rec[id] : undefined);
  }
  return (typeof found === 'string' && found.trim()) || screenLabel(key);
}

/**
 * Las pantallas conocidas de un prototipo, para elegirlas en el constructor: primero sus
 * archivos HTML (`source: 'file'`) y después las que se vieron en sesiones y no son un archivo
 * (`source: 'seen'`): rutas por hash, rutas de History y pantallas virtuales. `events` son los
 * eventos (basta con los de navegación) de las sesiones de ese prototipo. Cada una trae su
 * `name` (el nombre único para mostrar) y, si tiene título estable, `title` (`screenTitles`).
 */
export function knownScreens(files: ReadonlyArray<{ path: string; title?: string }>, events: readonly TaptanaEvent[] = []): ScreenInfo[] {
  const titles = screenTitles(events, files);
  const byId = new Map<string, ScreenInfo>();
  const add = (id: string, source: ScreenInfo['source']): void => {
    if (byId.has(id)) return;
    const info: ScreenInfo = { id, label: screenLabel(id), name: screenName(id, titles), source };
    const title = titles.get(id);
    if (title) info.title = title;
    byId.set(id, info);
  };
  for (const file of files) add(screenId(file.path), 'file');
  for (const e of events) {
    if (!e || e.kind !== 'taptana' || e.type !== 'navigation' || typeof e.to !== 'string') continue;
    add(screenId(e.to), 'seen');
  }
  return [...byId.values()];
}

/** Alias de compatibilidad de `screenId`. */
export const screenPath = screenId;
/** Alias de compatibilidad de `sameScreen`. */
export const samePath = sameScreen;
