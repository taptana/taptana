/*
 * Taptana · service worker de la demo (GitHub Pages).
 *
 * En la demo no hay servidor. Los prototipos subidos se guardan en IndexedDB de este navegador
 * y este archivo los sirve como si fuera el servidor local:
 *
 *   <base>local/<id>/<ruta>             archivos del prototipo (los HTML con el recorder)
 *   <base>__local/api/v1/studies/<id>   el estudio, para que el recorder lo muestre
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
  if (url.pathname.startsWith(`${BASE}local/`)) event.respondWith(serveFile(url));
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

async function serveFile(url) {
  const rest = decodeURIComponent(url.pathname.slice(`${BASE}local/`.length)); // "<id>/ruta"
  const slash = rest.indexOf('/');
  if (slash === -1) return Response.redirect(`${url.pathname}/${url.search}`, 301);
  const id = rest.slice(0, slash);
  let path = rest.slice(slash) || '/';
  const proto = await get('prototypes', id);
  if (!proto) return notFound('Este prototipo no está en este navegador.');
  if (path === '/') path = proto.entryPath || '/index.html';

  let file = await get('files', [id, path]);
  if (!file && path.endsWith('/')) file = await get('files', [id, `${path}index.html`]);
  if (!file && !/\.[a-z0-9]+$/i.test(path)) file = (await get('files', [id, `${path}.html`])) || (await get('files', [id, `${path}/index.html`]));
  if (!file) return notFound('No encontrado');

  const ext = (file.path.split('.').pop() || '').toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const headers = { 'content-type': type, 'cache-control': 'no-cache' };
  if (ext !== 'html' && ext !== 'htm') return new Response(file.data, { headers });

  const html = new TextDecoder().decode(file.data);
  const tag =
    `\n<script src="${BASE}recorder.js" data-prototype="${id}" data-transport="local" data-export="off"` +
    ` data-base="${BASE}local/${id}" data-endpoint="${self.location.origin}${BASE}__local"></script>\n`;
  const i = html.search(/<\/body\s*>/i);
  return new Response(i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i), { headers });
}

async function serveStudy(url) {
  const id = decodeURIComponent(url.pathname.split('/').pop() || '');
  const study = await get('studies', id);
  if (!study) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify(study), { headers: { 'content-type': 'application/json' } });
}
