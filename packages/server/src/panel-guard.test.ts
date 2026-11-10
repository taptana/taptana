import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerInfo, Study } from '@taptana/shared';
import { createApp } from './app.js';
import { loadPanelKey, LOCKED_MESSAGE, PANEL_KEY_COOKIE } from './panel-guard.js';
import { SqliteStore } from './store/sqlite.js';

const pub = mkdtempSync(join(tmpdir(), 'taptana-pub-'));
writeFileSync(join(pub, 'recorder.js'), '/* recorder */');
mkdirSync(join(pub, 'panel', 'assets'), { recursive: true });
writeFileSync(join(pub, 'panel', 'index.html'), '<html><body>panel</body></html>');
writeFileSync(join(pub, 'panel', 'assets', 'x.js'), 'panel-js');
const proto = mkdtempSync(join(tmpdir(), 'taptana-proto-'));
writeFileSync(join(proto, 'index.html'), '<html><body><h1>Tienda</h1></body></html>');

const KEY = 'llave-de-prueba-0123456789';
/** Una dirección de otra computadora de la red (reservada para documentación: no es de esta máquina). */
const LAN = '192.0.2.77';
const REMOTE = 'x-test-remote';

const study: Study = { v: 2, name: 'S', prototypeId: 'local', blocks: [{ id: 't1', title: 'T', instruction: 'I', success: { type: 'manual' } }] };

/**
 * La dirección de la conexión se toma de una cabecera de prueba. Sin ella no hay "socket",
 * como en cualquier `app.request`, y eso cuenta como local.
 */
function makeApp(options: { open?: boolean } = {}) {
  const store = new SqliteStore(':memory:');
  const app = createApp({
    store,
    prototypeDir: proto,
    prototypeId: 'local',
    publicDir: pub,
    panelKey: KEY,
    ...(options.open && { openPanel: true }),
    remoteAddress: (c) => c.req.header(REMOTE),
    info: { version: '9.9.9', participantUrl: 'http://192.0.2.10:4321/', prototypeId: 'local', prototypeName: 'tienda' },
  });
  return { app, store };
}

const from = (address: string, headers: Record<string, string> = {}): RequestInit => ({ headers: { [REMOTE]: address, ...headers } });
const cookieOf = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

test('local connections open the panel and the API', async () => {
  const { app } = makeApp();
  // Sin socket (pruebas) cuenta como local.
  assert.equal((await app.request('/panel')).status, 200);
  assert.equal((await app.request('/panel/studies/st_1')).status, 200);
  assert.equal((await app.request('/panel/assets/x.js')).status, 200);
  assert.equal((await app.request('/api/v1/sessions')).status, 200);
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.53']) {
    assert.equal((await app.request('/panel', from(address))).status, 200, address);
    assert.equal((await app.request('/api/v1/sessions', from(address))).status, 200, address);
  }
  const res = await app.request('/panel');
  assert.equal(await res.text(), '<html><body>panel</body></html>');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
});

test('another device without the key gets a friendly 401 page, and JSON on the API', async () => {
  const { app } = makeApp();
  for (const path of ['/panel', '/panel/recordings/s_1', '/panel/assets/x.js']) {
    const res = await app.request(path, from(LAN));
    assert.equal(res.status, 401, path);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const html = await res.text();
    assert.match(html, /<html lang="es">/);
    assert.match(html, /El panel solo se abre desde la computadora donde corre Taptana/);
    assert.match(html, /Si eres participante, abre el link del estudio que te compartieron/);
    assert.ok(!html.includes(KEY));
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  for (const [method, path] of [
    ['GET', '/api/v1/sessions'],
    ['GET', '/api/v1/studies'],
    ['GET', '/api/v1/prototypes'],
    ['GET', '/api/v1/sessions/s_1/events'],
    ['GET', '/api/v1/studies/st_1/report'],
    ['GET', '/api/v1/qr.svg?text=hola'],
    ['DELETE', '/api/v1/sessions/s_1'],
    ['POST', '/api/v1/studies'],
    ['PUT', '/api/v1/studies/st_1'],
    ['DELETE', '/api/v1/studies/st_1'],
    ['POST', '/api/v1/example'],
    ['POST', '/api/v1/sessions/import'],
    ['GET', '/api/v1/no-existe'],
  ] as const) {
    const res = await app.request(path, { method, ...from(LAN) });
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.deepEqual(await res.json(), { error: LOCKED_MESSAGE });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  }
});

test('?key= sets an HttpOnly cookie and redirects without the key', async () => {
  const { app } = makeApp();
  const res = await app.request(`/panel/studies?key=${KEY}&prototype=pr_1`, from(LAN));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/panel/studies?prototype=pr_1');
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, new RegExp(`^${PANEL_KEY_COOKIE}=${KEY};`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /Max-Age=\d+/i);
  assert.equal((await app.request(`/panel?key=${KEY}`, from(LAN))).headers.get('location'), '/panel');

  // Con la cookie, ese dispositivo ya entra al panel y a la API.
  const cookie = cookieOf(res);
  assert.equal((await app.request('/panel', from(LAN, { cookie }))).status, 200);
  assert.equal((await app.request('/panel/assets/x.js', from(LAN, { cookie }))).status, 200);
  assert.equal((await app.request('/api/v1/sessions', from(LAN, { cookie }))).status, 200);
  assert.equal((await app.request('/api/v1/sessions', from(LAN, { cookie: `otra=1; ${cookie}` }))).status, 200);

  // En la API la llave también vale (y deja la cookie), sin redirigir.
  const api = await app.request(`/api/v1/sessions?key=${KEY}`, from(LAN));
  assert.equal(api.status, 200);
  assert.match(api.headers.get('set-cookie') ?? '', /HttpOnly/i);
});

test('a wrong key or a wrong cookie does not open anything', async () => {
  const { app } = makeApp();
  const res = await app.request('/panel?key=no-es-la-llave', from(LAN));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.match(await res.text(), /La llave de este link ya no sirve/);
  assert.equal((await app.request(`/panel?key=${KEY}x`, from(LAN))).status, 401);
  assert.equal((await app.request('/panel?key=', from(LAN))).status, 401);
  assert.equal((await app.request('/api/v1/sessions?key=no', from(LAN))).status, 401);
  assert.equal((await app.request('/panel', from(LAN, { cookie: `${PANEL_KEY_COOKIE}=no-es-la-llave` }))).status, 401);
  assert.equal((await app.request('/api/v1/sessions', from(LAN, { cookie: `${PANEL_KEY_COOKIE}=` }))).status, 401);
  // Desde la propia computadora una llave equivocada no estorba.
  assert.equal((await app.request('/panel?key=no-es-la-llave')).status, 200);
});

test('open mode lets any device in', async () => {
  const { app } = makeApp({ open: true });
  assert.equal((await app.request('/panel', from(LAN))).status, 200);
  assert.equal((await app.request('/api/v1/sessions', from(LAN))).status, 200);
  // Pero sigue sin aceptar peticiones de otros sitios.
  assert.equal((await app.request('/api/v1/sessions', from(LAN, { origin: 'http://evil.example' }))).status, 403);
});

test('requests from another site are rejected with 403, even on a local connection', async () => {
  const { app, store } = makeApp();
  const saved = store.saveStudy(study);
  const evil = { origin: 'http://evil.example' };

  const del = await app.request(`/api/v1/studies/${saved.id}`, { method: 'DELETE', headers: evil });
  assert.equal(del.status, 403);
  assert.match(((await del.json()) as { error: string }).error, /otro sitio/);
  assert.equal(del.headers.get('access-control-allow-origin'), null);
  assert.ok(store.getStudy(saved.id), 'el estudio no se borró');

  assert.equal((await app.request('/api/v1/sessions', { headers: evil })).status, 403);
  assert.equal((await app.request('/api/v1/sessions', { headers: { origin: 'null' } })).status, 403);
  assert.equal((await app.request('/api/v1/studies', { method: 'POST', headers: { ...evil, 'content-type': 'text/plain' }, body: JSON.stringify(study) })).status, 403);
  assert.equal((await app.request('/api/v1/sessions', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' } })).status, 403);
  // Otra página en otro puerto de esta máquina tampoco.
  assert.equal((await app.request('http://localhost:4321/api/v1/sessions', { headers: { origin: 'http://localhost:3000' } })).status, 403);
  assert.equal((await app.request('/api/v1/sessions', { headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors' } })).status, 403);
  // Incrustar el panel en un iframe de otro sitio.
  const framed = await app.request('/panel', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' } });
  assert.equal(framed.status, 403);
  assert.match(await framed.text(), /no se puede abrir desde otro sitio/);
  // Un preflight de otro sitio no recibe permiso.
  const preflight = await app.request('/api/v1/sessions/s_1', { method: 'OPTIONS', headers: { ...evil, 'access-control-request-method': 'DELETE' } });
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);

  // Lo que sí pasa: nuestro propio origen, y abrir el panel con un clic desde otro sitio.
  assert.equal((await app.request('http://localhost:4321/api/v1/sessions', { headers: { origin: 'http://localhost:4321' } })).status, 200);
  assert.equal((await app.request('/api/v1/sessions', { headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
  assert.equal((await app.request('/api/v1/sessions', { headers: { 'sec-fetch-site': 'none' } })).status, 200);
  const click = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  assert.equal((await app.request('/panel', { headers: click })).status, 200);
  assert.equal((await app.request(`/panel?key=${KEY}`, from(LAN, click))).status, 302);
  assert.equal((await app.request('/panel', from(LAN, click))).status, 401);
  // Detrás de un proxy que cambia Host (Codespaces): el navegador dice que es el mismo origen.
  const proxied = await app.request('http://localhost:4321/api/v1/sessions', {
    method: 'GET',
    headers: { [REMOTE]: '127.0.0.1', 'x-forwarded-host': 'mi-4321.app.example', 'x-forwarded-for': '203.0.113.5', origin: 'https://mi-4321.app.example', cookie: `${PANEL_KEY_COOKIE}=${KEY}` },
  });
  assert.equal(proxied.status, 200);
});

test('POST /events and GET /studies/:id stay public, with CORS *', async () => {
  const { app, store } = makeApp();
  const saved = store.saveStudy({ ...study, closed: true });
  const headers = { [REMOTE]: LAN, origin: 'https://prototipo.example', 'content-type': 'application/json' };

  const events = await app.request('/api/v1/events', {
    method: 'POST',
    headers,
    body: JSON.stringify({ v: 1, prototypeId: 'local', sessionId: 's_1', pageId: 'p_1', seq: 0, sentAt: 1, events: [{ kind: 'rrweb', t: 1, data: {} }] }),
  });
  assert.equal(events.status, 200);
  assert.deepEqual(await events.json(), { ok: true, received: 1 });
  assert.equal(events.headers.get('access-control-allow-origin'), '*');

  const preflight = await app.request('/api/v1/events', { method: 'OPTIONS', headers: { ...headers, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /POST/);

  const got = await app.request(`/api/v1/studies/${saved.id}`, { headers });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('access-control-allow-origin'), '*');
  const body = (await got.json()) as { id: string; closed: boolean; blocks: unknown[] };
  assert.equal(body.id, saved.id);
  assert.equal(body.closed, true);
  assert.equal(body.blocks.length, 1);
  assert.equal((await app.request('/api/v1/studies/no-existe', { headers })).status, 404);

  // Solo eso es público: leer el estudio sí, cambiarlo o borrarlo no.
  assert.equal((await app.request(`/api/v1/studies/${saved.id}`, { method: 'PUT', headers, body: JSON.stringify(study) })).status, 403);
  assert.equal((await app.request(`/api/v1/studies/${saved.id}`, { method: 'DELETE', ...from(LAN) })).status, 401);
  assert.equal((await app.request(`/api/v1/studies/${saved.id}/report`, from(LAN))).status, 401);
  assert.equal((await app.request(`/api/v1/studies/${saved.id}/export.csv`, from(LAN))).status, 401);
  assert.equal((await app.request('/api/v1/events', from(LAN))).status, 401);
  const put = await app.request(`/api/v1/studies/${saved.id}`, { method: 'OPTIONS', headers: { ...headers, 'access-control-request-method': 'PUT' } });
  assert.ok(!(put.headers.get('access-control-allow-methods') ?? '').includes('PUT'));
  assert.ok(store.getStudy(saved.id));

  // El prototipo y el recorder los abre cualquiera: son lo que usa el participante.
  assert.equal((await app.request('/', from(LAN))).status, 200);
  assert.equal((await app.request('/__taptana/recorder.js', from(LAN))).status, 200);
});

test('GET /info tells everything to the panel and only the version to anyone else', async () => {
  const { app } = makeApp();
  const local = (await (await app.request('/api/v1/info')).json()) as ServerInfo;
  assert.equal(local.version, '9.9.9');
  assert.equal(local.mode, 'local');
  assert.equal(local.exampleLoaded, false);
  assert.equal(local.participantUrl, 'http://192.0.2.10:4321/');
  assert.equal(local.prototypeName, 'tienda');
  assert.equal(local.panelKeyUrl, `http://192.0.2.10:4321/panel?key=${KEY}`);

  const outside = await app.request('/api/v1/info', from(LAN));
  assert.equal(outside.status, 200);
  assert.deepEqual(await outside.json(), { version: '9.9.9', mode: 'local' });
  assert.equal(outside.headers.get('access-control-allow-origin'), null);

  // Otra página en el navegador del diseñador tampoco se entera de la llave.
  const crossSite = await app.request('/api/v1/info', { headers: { origin: 'http://evil.example' } });
  assert.deepEqual(await crossSite.json(), { version: '9.9.9', mode: 'local' });

  // Con la llave, otro dispositivo ve los datos del servidor, pero no la llave otra vez.
  const withKey = (await (await app.request('/api/v1/info', from(LAN, { cookie: `${PANEL_KEY_COOKIE}=${KEY}` }))).json()) as ServerInfo;
  assert.equal(withKey.participantUrl, 'http://192.0.2.10:4321/');
  assert.equal(withKey.panelKeyUrl, undefined);

  // En modo abierto no hace falta llave: el link es el del panel a secas.
  const open = (await (await makeApp({ open: true }).app.request('/api/v1/info')).json()) as ServerInfo;
  assert.equal(open.panelKeyUrl, 'http://192.0.2.10:4321/panel');
});

test('what looks local but is not: proxies, foreign host names and closed sockets', async () => {
  const { app } = makeApp();
  // Un proxy o túnel en esta máquina reenvía visitas de afuera desde 127.0.0.1.
  assert.equal((await app.request('/panel', from('127.0.0.1', { 'x-forwarded-for': '203.0.113.5' }))).status, 401);
  assert.equal((await app.request('/api/v1/sessions', from('127.0.0.1', { forwarded: 'for=203.0.113.5' }))).status, 401);
  // Un dominio ajeno que apunta a 127.0.0.1 (DNS rebinding).
  assert.equal((await app.request('http://evil.example:4321/panel', from('127.0.0.1'))).status, 401);
  assert.equal((await app.request('http://evil.example:4321/api/v1/sessions', from('127.0.0.1', { origin: 'http://evil.example:4321' }))).status, 401);
  assert.equal((await app.request('http://localhost:4321/panel', from('127.0.0.1'))).status, 200);
  assert.equal((await app.request('http://127.0.0.1:4321/panel', from('127.0.0.1'))).status, 200);
  assert.equal((await app.request('http://[::1]:4321/panel', from('::1'))).status, 200);
  // Si el socket ya se cerró no se sabe de dónde venía: no es local.
  assert.equal((await app.request('/api/v1/sessions', { method: 'DELETE', ...from('unknown') })).status, 401);
});

test('the old /sessions address leads to the guarded panel', async () => {
  const { app } = makeApp();
  const res = await app.request('/sessions', from(LAN));
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/panel');
  assert.equal((await app.request('/panel', from(LAN))).status, 401);
});

test('loadPanelKey creates the key once and reuses it', () => {
  const dataDir = join(mkdtempSync(join(tmpdir(), 'taptana-data-')), 'nueva');
  const key = loadPanelKey(dataDir);
  assert.match(key, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(readFileSync(join(dataDir, 'panel.key'), 'utf8').trim(), key);
  assert.equal(loadPanelKey(dataDir), key);
  // Un archivo dañado se reemplaza por una llave nueva.
  writeFileSync(join(dataDir, 'panel.key'), 'corta');
  const next = loadPanelKey(dataDir);
  assert.notEqual(next, 'corta');
  assert.match(next, /^[A-Za-z0-9_-]{24}$/);
});
