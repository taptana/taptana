/*
 * Taptana · service worker de la demo (GitHub Pages).
 *
 * En la demo no hay servidor. Los prototipos subidos se guardan en IndexedDB de este navegador
 * y este archivo los sirve como si fuera el servidor local:
 *
 *   <base>local/<id>/<ruta>             archivos del prototipo (los HTML con el recorder)
 *   <base>__local/api/v1/studies/<id>   el estudio, para que el recorder lo muestre (los guardados
 *                                       en este navegador y los de ejemplo de <base>demo/studies.json)
 *
 * Nada sale del navegador. Solo funciona en este mismo navegador.
 */

const BASE = new URL(self.registration.scope).pathname; // "/taptana/"
const DB = 'taptana-panel';

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', txt: 'text/plain; charset=utf-8',
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (url.pathname.startsWith(`${BASE}local/`)) event.respondWith(serveFile(url, event.request).catch(() => notFound('No se pudo leer este prototipo en este navegador.')));
  else if (url.pathname.startsWith(`${BASE}__local/api/v1/studies/`)) event.respondWith(serveStudy(url));
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get(store, key) {
  const db = await openDb();
  try {
    if (!db.objectStoreNames.contains(store)) return undefined;
    return await new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close(); // no bloquear actualizaciones de la base que haga el panel
  }
}

const notFound = (msg) => new Response(msg, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** ¿El navegador está pidiendo una página (y no una imagen, un script o datos)? */
function wantsHtml(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}

/**
 * Responde un archivo. Con cabecera Range (video y audio) devuelve solo ese tramo (206); si el
 * rango no se entiende, el archivo completo, que también se reproduce.
 */
function fileResponse(data, type, request) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const size = bytes.byteLength;
  const headers = { 'content-type': type, 'cache-control': 'no-cache', 'accept-ranges': 'bytes' };
  const m = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('range') || '').trim());
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    const part = bytes.slice(start, end + 1);
    return new Response(part, {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(part.byteLength) },
    });
  }
  return new Response(bytes, { headers: { ...headers, 'content-length': String(size) } });
}

async function serveFile(url, request) {
  let rest;
  try {
    rest = decodeURIComponent(url.pathname.slice(`${BASE}local/`.length)); // "<id>/ruta"
  } catch {
    return notFound('No encontrado');
  }
  const slash = rest.indexOf('/');
  if (slash === -1) return Response.redirect(`${url.pathname}/${url.search}`, 301);
  const id = rest.slice(0, slash);
  let path = rest.slice(slash) || '/';
  const proto = await get('prototypes', id);
  if (!proto) return notFound('Este prototipo no está en este navegador. En la demo, los prototipos subidos solo existen en el navegador donde se subieron.');
  const entry = proto.entryPath || '/index.html';
  if (path === '/') path = entry;

  let file = await get('files', [id, path]);
  if (!file && path.endsWith('/')) file = await get('files', [id, `${path}index.html`]);
  const extensionless = !/\.[a-z0-9]+$/i.test(path);
  if (!file && extensionless) file = (await get('files', [id, `${path}.html`])) || (await get('files', [id, `${path.replace(/\/$/, '')}/index.html`]));
  // App de una sola página: una ruta sin extensión que no existe devuelve la página de entrada.
  if (!file && extensionless && wantsHtml(request)) file = await get('files', [id, entry]);
  if (!file) return notFound('No encontrado');

  const ext = (file.path.split('.').pop() || '').toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  if (ext !== 'html' && ext !== 'htm') return fileResponse(file.data, type, request);

  const html = new TextDecoder().decode(file.data);
  const tag =
    `\n<script src="${BASE}recorder.js" data-prototype="${id}" data-transport="local" data-export="off"` +
    ` data-base="${BASE}local/${id}" data-endpoint="${self.location.origin}${BASE}__local"></script>\n`;
  const i = html.search(/<\/body\s*>/i);
  return new Response(i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i), { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
}

async function serveStudy(url) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
  let id = '';
  try {
    id = decodeURIComponent(url.pathname.split('/').pop() || '');
  } catch {
    /* id ilegible: no existe */
  }
  let study;
  try {
    study = await get('studies', id);
  } catch {
    study = undefined;
  }
  if (study && study.deleted) return json({ error: 'No existe ese estudio.' }, 404);
  if (!study) {
    // Los estudios de ejemplo vienen como archivo del sitio.
    try {
      const res = await fetch(`${BASE}demo/studies.json`, { cache: 'no-cache' });
      const list = res.ok ? await res.json() : [];
      study = Array.isArray(list) ? list.find((s) => s && s.id === id) : undefined;
    } catch {
      study = undefined;
    }
  }
  return study ? json(study) : json({ error: 'No existe ese estudio.' }, 404);
}
