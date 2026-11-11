import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Prototype, PrototypeUrlCheck, ScreenInfo } from '@taptana/shared';
import { createApp } from './app.js';
import {
  checkPrototypeUrl,
  emptyWithoutJs,
  proxyRequest,
  requestHeaders,
  responseHeaders,
  rewriteHtml,
  rewriteLocation,
  rewriteSetCookie,
  staticImports,
  upstreamReferer,
  upstreamUrl,
  type ProxyTarget,
} from './proxy.js';
import { SqliteStore } from './store/sqlite.js';

const T: ProxyTarget = { prototypeId: 'pr_x', sourceUrl: 'https://sitio.dev/inicio', base: '/p/pr_x' };

describe('proxy helpers', () => {
  test('upstreamUrl never leaves the configured origin', () => {
    for (const rel of ['/a', '//evil.com/x', '/\\evil.com', '\\\\evil.com/x', '/../../etc', '/%2F%2Fevil.com', '/@evil.com', 'evil.com']) {
      const u = upstreamUrl('https://sitio.dev:8443/app', rel, '?q=1');
      assert.equal(u.host, 'sitio.dev:8443', rel);
      assert.equal(u.protocol, 'https:');
      assert.equal(u.search, '?q=1');
    }
    assert.equal(upstreamUrl('http://localhost:5173/', '/src/main.tsx').href, 'http://localhost:5173/src/main.tsx');
  });

  test('requestHeaders keeps a safe subset, hides the panel key and translates origin/referer', () => {
    const h = requestHeaders(
      new Headers({
        accept: 'text/html',
        cookie: 'taptana_key=SECRETO; sid=abc',
        'x-forwarded-for': '10.0.0.1',
        'x-taptana-key': 'SECRETO',
        'x-csrf-token': 't',
        rsc: '1',
        host: 'taptana:4321',
        origin: 'http://taptana:4321',
        referer: 'http://taptana:4321/p/pr_x/carrito?x=1',
        'sec-fetch-site': 'same-origin',
        connection: 'keep-alive',
      }),
      T,
      'taptana:4321',
    );
    assert.equal(h.get('accept'), 'text/html');
    assert.equal(h.get('cookie'), 'sid=abc');
    assert.equal(h.get('x-csrf-token'), 't');
    assert.equal(h.get('rsc'), '1');
    assert.equal(h.get('origin'), 'https://sitio.dev');
    assert.equal(h.get('referer'), 'https://sitio.dev/carrito?x=1');
    for (const gone of ['x-forwarded-for', 'x-taptana-key', 'host', 'sec-fetch-site', 'connection']) assert.equal(h.has(gone), false, gone);
    // Solo la llave: no queda cabecera cookie.
    assert.equal(requestHeaders(new Headers({ cookie: 'taptana_key=S' }), T, 'x').has('cookie'), false);
  });

  test('upstreamReferer only maps pages of this prototype', () => {
    assert.equal(upstreamReferer('http://t/p/pr_x/', T, 't'), 'https://sitio.dev/');
    assert.equal(upstreamReferer('http://t/p/pr_y/a', T, 't'), null);
    assert.equal(upstreamReferer('http://otro/p/pr_x/a', T, 't'), null);
    assert.equal(upstreamReferer('http://t/panel/studies', T, 't'), null);
    assert.equal(upstreamReferer('http://t/a/b', { ...T, base: '' }, 't'), 'https://sitio.dev/a/b');
  });

  test('rewriteHtml: root-absolute and same-origin URLs go under the base; CSP meta goes away', () => {
    const html = `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><link rel=stylesheet href=/app.css></head>
<a href="/carrito">c</a><a href='https://sitio.dev/pago?x=1'>p</a><a href="https://sitio.dev">h</a><a href="//sitio.dev/z">z</a>
<a href="https://otro.com/x">o</a><a href="rel.html">r</a><a href="#top">t</a><img src="data:image/png;base64,AAA">
<img srcset="/a.png 1x, /b.png 2x"><form action="/enviar"><button formaction="/otra">b</button></form><a href="/p/pr_x/ya">y</a>`;
    const out = rewriteHtml(html, new URL('https://sitio.dev/inicio'), '/p/pr_x');
    assert.ok(!/Content-Security-Policy/i.test(out));
    for (const expected of ['href="/p/pr_x/app.css"', 'href="/p/pr_x/carrito"', `href='/p/pr_x/pago?x=1'`, 'href="/p/pr_x/"', 'href="/p/pr_x/z"', 'srcset="/p/pr_x/a.png 1x, /p/pr_x/b.png 2x"', 'action="/p/pr_x/enviar"', 'formaction="/p/pr_x/otra"', 'href="/p/pr_x/ya"']) {
      assert.ok(out.includes(expected), expected);
    }
    for (const same of ['href="https://otro.com/x"', 'href="rel.html"', 'href="#top"', 'src="data:image/png;base64,AAA"']) assert.ok(out.includes(same), same);
    // En la raíz: solo el origen absoluto se vuelve ruta.
    const root = rewriteHtml('<a href="/a"></a><a href="https://sitio.dev/b"></a>', new URL('https://sitio.dev/'), '');
    assert.equal(root, '<a href="/a"></a><a href="/b"></a>');
  });

  test('rewriteLocation keeps same-origin redirects inside and lets other hosts through', () => {
    const from = new URL('https://sitio.dev/a/b');
    assert.equal(rewriteLocation('/login?next=1', from, '/p/pr_x'), '/p/pr_x/login?next=1');
    assert.equal(rewriteLocation('c', from, '/p/pr_x'), '/p/pr_x/a/c');
    assert.equal(rewriteLocation('https://sitio.dev/z#h', from, '/p/pr_x'), '/p/pr_x/z#h');
    assert.equal(rewriteLocation('https://accounts.google.com/o', from, '/p/pr_x'), 'https://accounts.google.com/o');
    assert.equal(rewriteLocation('http://sitio.dev/z', from, '/p/pr_x'), 'http://sitio.dev/z');
  });

  test('rewriteSetCookie drops Domain and (over http) Secure, and scopes Path to the prototype', () => {
    assert.equal(
      rewriteSetCookie('sid=abc; Domain=sitio.dev; Path=/; Secure; HttpOnly; SameSite=None; Partitioned', { base: '/p/pr_x', secure: false }),
      'sid=abc; HttpOnly; SameSite=Lax; Path=/p/pr_x/',
    );
    assert.equal(rewriteSetCookie('a=1; path=/cuenta; Secure', { base: '/p/pr_x', secure: true }), 'a=1; Secure; Path=/p/pr_x/cuenta');
    assert.equal(rewriteSetCookie('a=1', { base: '', secure: false }), 'a=1; Path=/');
  });

  test('responseHeaders drops what would break injection and fixes encoding, location and cookies', () => {
    const up = new Headers({
      'content-security-policy': "default-src 'none'",
      'x-frame-options': 'DENY',
      'strict-transport-security': 'max-age=1',
      'service-worker-allowed': '/',
      'content-encoding': 'gzip',
      'content-length': '10',
      'content-type': 'text/css',
      etag: '"1"',
      location: '/otra',
    });
    up.append('set-cookie', 'a=1; Domain=sitio.dev');
    up.append('set-cookie', 'b=2; Secure');
    const out = responseHeaders(up, { target: T, requested: new URL('https://sitio.dev/x'), secure: false, rewritten: false });
    for (const gone of ['content-security-policy', 'x-frame-options', 'strict-transport-security', 'service-worker-allowed', 'content-encoding', 'content-length']) assert.equal(out.has(gone), false, gone);
    assert.equal(out.get('etag'), '"1"');
    assert.equal(out.get('location'), '/p/pr_x/otra');
    assert.deepEqual(out.getSetCookie(), ['a=1; Path=/p/pr_x/', 'b=2; Path=/p/pr_x/']);
    const html = responseHeaders(new Headers({ etag: '"1"', 'content-length': '5' }), { target: T, requested: new URL('https://sitio.dev/'), secure: false, rewritten: true });
    assert.equal(html.has('etag'), false);
    assert.equal(html.has('content-length'), false);
  });

  test('proxyRequest refuses service worker scripts and explains when the site is down', async () => {
    const never = async (): Promise<Response> => {
      throw new Error('ECONNREFUSED');
    };
    const sw = await proxyRequest(new Request('http://t/p/pr_x/sw.js', { headers: { 'service-worker': 'script' } }), T, { rel: '/sw.js', search: '', publicHost: 't', secure: false, fetch: never });
    assert.equal(sw.status, 404);
    const page = await proxyRequest(new Request('http://t/p/pr_x/', { headers: { accept: 'text/html' } }), T, { rel: '/', search: '', publicHost: 't', secure: false, fetch: never });
    assert.equal(page.status, 502);
    assert.match(await page.text(), /No pudimos abrir este prototipo[\s\S]*https:\/\/sitio\.dev/);
    const asset = await proxyRequest(new Request('http://t/p/pr_x/a.js'), T, { rel: '/a.js', search: '', publicHost: 't', secure: false, fetch: never });
    assert.equal(asset.status, 502);
    assert.match(asset.headers.get('content-type') ?? '', /text\/plain/);
  });

  test('staticImports follows same-origin module imports only', () => {
    const from = new URL('https://sitio.dev/assets/index-a.js');
    const code = 'import{a as b}from"./chunk-b.js";import"/assets/c.js";const d=()=>import("./lazy-d.js");import x from "https://cdn.dev/e.js";import "./estilo.css";';
    assert.deepEqual(staticImports(code, from).map((u) => u.pathname), ['/assets/chunk-b.js', '/assets/c.js', '/assets/lazy-d.js']);
  });

  test('emptyWithoutJs', () => {
    assert.equal(emptyWithoutJs('<html><body><div id="root"></div><script type="module" src="/a.js"></script></body></html>'), true);
    assert.equal(emptyWithoutJs('<html><body><h1>Una tienda con productos, precios y un carrito</h1><script></script></body></html>'), false);
  });
});

// ── Con un sitio de verdad, levantado aquí ──────────────────────────

let upstream: Server;
let ORIGIN = '';
const seen: Array<{ method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];

const PAGE = (title: string, body: string): string =>
  `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'none'"><title>${title}</title><link rel="stylesheet" href="/style.css"></head><body>${body}</body></html>`;

before(async () => {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => chunks.push(d));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method ?? '', url: url.pathname + url.search, headers: req.headers, body });
      const html = (status: number, content: string, extra: Record<string, string | string[]> = {}): void => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...extra });
        res.end(content);
      };
      switch (url.pathname) {
        case '/':
          return html(
            200,
            PAGE('Sitio de prueba', `<h1>Inicio</h1><a id="ir" href="/acerca">Acerca</a><a href="${ORIGIN}/contacto?x=1">Contacto</a><form method="post" action="/enviar"><input name="q"></form><script>fetch('/api/data')</script>`),
            {
              'content-security-policy': "default-src 'none'",
              'x-frame-options': 'DENY',
              'strict-transport-security': 'max-age=31536000',
              'set-cookie': ['sid=abc; Domain=127.0.0.1; Path=/; HttpOnly; Secure; SameSite=None'],
            },
          );
        case '/acerca':
          return html(200, PAGE('Acerca', '<h1>Acerca</h1>'));
        case '/style.css': {
          res.writeHead(200, { 'content-type': 'text/css', 'content-encoding': 'gzip' });
          return res.end(gzipSync('body{color:green}'));
        }
        case '/api/data':
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ method: req.method, cookie: req.headers.cookie ?? null, referer: req.headers.referer ?? null, host: req.headers.host, origin: req.headers.origin ?? null, body }));
        case '/enviar':
          res.writeHead(303, { location: '/gracias' });
          return res.end();
        case '/viejo':
          res.writeHead(301, { location: `${ORIGIN}/acerca` });
          return res.end();
        case '/afuera':
          res.writeHead(302, { location: 'https://example.org/destino' });
          return res.end();
        case '/privado':
          return html(401, 'login', { 'www-authenticate': 'Basic' });
        case '/datos.json':
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end('{}');
        case '/bundle':
          return html(200, '<!doctype html><html><head><title>Bundle</title><script type="module" src="/assets/entry.js"></script></head><body><div id="root"></div></body></html>');
        case '/assets/entry.js':
          res.writeHead(200, { 'content-type': 'text/javascript' });
          return res.end('import{r}from"./router-x.js";r();');
        case '/assets/router-x.js':
          res.writeHead(200, { 'content-type': 'text/javascript' });
          return res.end('export const r=()=>window.history.pushState({},"","/b");');
        case '/sso':
          res.writeHead(302, { location: 'https://vercel.com/sso-api?url=x' });
          return res.end();
        default:
          if (url.pathname.startsWith('/app')) {
            return html(200, '<!doctype html><html><head><title>Mi app</title></head><body><div id="root"></div><script>history.pushState({}, "", "/app/b")</script></body></html>');
          }
          return html(404, 'no');
      }
    });
  });
  await new Promise<void>((ok) => upstream.listen(0, '127.0.0.1', ok));
  ORIGIN = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});
after(() => upstream.close());

const pub = mkdtempSync(join(tmpdir(), 'taptana-proxy-pub-'));
writeFileSync(join(pub, 'recorder.js'), '/* recorder */');

function makeApp() {
  const store = new SqliteStore(':memory:');
  const dataDir = mkdtempSync(join(tmpdir(), 'taptana-proxy-data-'));
  return { store, app: createApp({ store, prototypeId: 'local', publicDir: pub, dataDir }) };
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('prototypes by URL through the API', () => {
  test('check: title, SPA hints and the reasons it cannot be used', async () => {
    const { app } = makeApp();
    const check = async (url: string): Promise<PrototypeUrlCheck> => (await app.request('/api/v1/prototypes/url/check', json('POST', { url }))).json() as Promise<PrototypeUrlCheck>;
    const ok = await check(`${ORIGIN}/#/algo`);
    assert.equal(ok.level, 'warning'); // cookie Secure con Taptana por http
    assert.equal(ok.url, `${ORIGIN}/`);
    assert.equal(ok.title, 'Sitio de prueba');
    assert.ok(ok.issues.some((i) => i.code === 'secure-cookies'));

    const app2 = await check(`${ORIGIN}/app`);
    assert.equal(app2.absoluteUrls, true);
    assert.deepEqual(app2.issues.map((i) => i.code).sort(), ['empty-without-js', 'history-router']);
    assert.equal(app2.level, 'ok');

    assert.equal((await check(`${ORIGIN}/bundle`)).absoluteUrls, true, 'el router vive en un trozo que importa la entrada');

    const cases: Array<[string, string]> = [
      ['/privado', 'login'],
      ['/sso', 'login'],
      ['/afuera', 'other-host'],
      ['/datos.json', 'not-html'],
      ['/no-existe', 'http-error'],
    ];
    for (const [path, code] of cases) {
      const r = await check(`${ORIGIN}${path}`);
      assert.equal(r.level, 'error', path);
      assert.equal(r.issues[0]?.code, code, path);
    }
    assert.equal((await check(`${ORIGIN}/afuera`)).suggestedUrl, 'https://example.org/destino');
    const viejo = await check(`${ORIGIN}/viejo`);
    assert.equal(viejo.title, 'Acerca');

    const down = await check('http://127.0.0.1:9/');
    assert.equal(down.issues[0]?.code, 'unreachable');
    assert.match(down.issues[0]?.message ?? '', /servidor de desarrollo/);
    assert.equal((await check('ftp://x')).issues[0]?.code, 'invalid');
  });

  test('add, serve with the recorder, absolute paths, cookies, redirects, POST and screens', async () => {
    const { app } = makeApp();
    const bad = await app.request('/api/v1/prototypes/url', json('POST', { url: `${ORIGIN}/privado` }));
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { check: PrototypeUrlCheck }).check.issues[0]?.code, 'login');

    const res = await app.request('/api/v1/prototypes/url', json('POST', { url: ORIGIN }));
    assert.equal(res.status, 201);
    const proto = (await res.json()) as Prototype;
    assert.equal(proto.source, 'url');
    assert.equal(proto.sourceUrl, `${ORIGIN}/`);
    assert.equal(proto.name, 'Sitio de prueba');
    assert.equal(proto.url, `/p/${proto.id}/`);
    const list = ((await (await app.request('/api/v1/prototypes')).json()) as { prototypes: Prototype[] }).prototypes;
    assert.deepEqual(list.map((p) => p.id), [proto.id]);
    const base = `/p/${proto.id}`;

    // La página: recorder, sin CSP, rutas dentro del prototipo, cookie reescrita.
    const page = await app.request(`${base}/`, { headers: { accept: 'text/html', cookie: 'taptana_key=SECRETO' } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(`data-prototype="${proto.id}"`) && html.includes(`data-base="${base}"`), 'recorder');
    assert.ok(!/Content-Security-Policy/i.test(html));
    assert.ok(html.includes(`href="${base}/style.css"`) && html.includes(`href="${base}/acerca"`) && html.includes(`href="${base}/contacto?x=1"`) && html.includes(`action="${base}/enviar"`));
    for (const gone of ['content-security-policy', 'x-frame-options', 'strict-transport-security']) assert.equal(page.headers.has(gone), false, gone);
    assert.deepEqual(page.headers.getSetCookie(), [`sid=abc; HttpOnly; SameSite=Lax; Path=${base}/`]);
    assert.equal(seen.at(-1)?.headers.cookie, undefined, 'la llave del panel no sale');
    assert.equal(seen.at(-1)?.headers.host, new URL(ORIGIN).host);

    // CSS comprimido: llega descomprimido y sin content-encoding.
    const css = await app.request(`${base}/style.css`);
    assert.equal(await css.text(), 'body{color:green}');
    assert.equal(css.headers.has('content-encoding'), false);

    // Lo que pide el JavaScript con rutas absolutas vuelve al prototipo por el Referer, también un POST.
    const abs = await app.request('/api/data', { headers: { referer: `http://localhost${base}/` } });
    assert.equal(abs.status, 307);
    assert.equal(abs.headers.get('location'), `${base}/api/data`);
    const absPost = await app.request('/api/data', { method: 'POST', headers: { referer: `http://localhost${base}/` }, body: 'x' });
    assert.equal(absPost.status, 307);
    // La API de Taptana sigue siendo de Taptana.
    assert.equal((await app.request('/api/v1/info', { headers: { referer: `http://localhost${base}/` } })).status, 200);

    const data = (await (await app.request(`${base}/api/data?y=2`, { method: 'POST', headers: { referer: `http://localhost${base}/acerca`, origin: 'http://localhost', cookie: 'taptana_key=S; sid=abc', 'content-type': 'text/plain' }, body: 'hola' })).json()) as Record<string, string>;
    assert.deepEqual(data, { method: 'POST', cookie: 'sid=abc', referer: `${ORIGIN}/acerca`, host: new URL(ORIGIN).host, origin: ORIGIN, body: 'hola' });

    // Formulario POST: el sitio redirige y la redirección se queda dentro.
    const form = await app.request(`${base}/enviar`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'q=1' });
    assert.equal(form.status, 303);
    assert.equal(form.headers.get('location'), `${base}/gracias`);
    assert.equal(seen.at(-1)?.body, 'q=1');
    assert.equal((await app.request(`${base}/viejo`)).headers.get('location'), `${base}/acerca`);
    assert.equal((await app.request(`${base}/afuera`)).headers.get('location'), 'https://example.org/destino');

    // App de una página con History: las rutas profundas van al sitio, que hace su propio respaldo.
    const deep = await app.request(`${base}/app/x/y`, { headers: { accept: 'text/html' } });
    assert.match(await deep.text(), /<title>Mi app<\/title>[\s\S]*data-taptana|recorder/);

    // Un service worker no se instala.
    assert.equal((await app.request(`${base}/sw.js`, { headers: { 'service-worker': 'script' } })).status, 404);

    // El link del estudio en la raíz manda al prototipo.
    const study = await (await app.request('/api/v1/studies', json('POST', { v: 2, name: 'E', prototypeId: proto.id, blocks: [{ id: 't1', kind: 'task', title: 'T', instruction: 'I', success: { type: 'reached', path: '/acerca' } }] }))).json() as { id: string };
    const toStudy = await app.request(`/?study=${study.id}`);
    assert.equal(toStudy.headers.get('location'), `${base}/?study=${study.id}`);

    // Pantallas: la de inicio. Fuente: el HTML en vivo.
    const screens = ((await (await app.request(`/api/v1/prototypes/${proto.id}/screens`)).json()) as { screens: ScreenInfo[] }).screens;
    assert.deepEqual(screens.map((s) => s.id), ['/index.html']);
    const source = (await (await app.request(`/api/v1/prototypes/${proto.id}/source?path=/acerca`)).json()) as { html: string };
    assert.match(source.html, /<h1>Acerca<\/h1>/);
    assert.ok(!source.html.includes('recorder'));
    assert.equal((await app.request(`/api/v1/prototypes/${proto.id}/source?path=/no-hay`)).status, 404);

    // Cambiar la URL: misma id, nueva entrada; una URL que no sirve no se guarda.
    assert.equal((await app.request(`/api/v1/prototypes/${proto.id}`, json('PATCH', { url: `${ORIGIN}/afuera` }))).status, 400);
    const moved = (await (await app.request(`/api/v1/prototypes/${proto.id}`, json('PATCH', { url: `${ORIGIN}/app` }))).json()) as Prototype;
    assert.equal(moved.sourceUrl, `${ORIGIN}/app`);
    assert.equal(moved.absoluteUrls, true);
    const start = await app.request(`${base}/?study=x`);
    assert.equal(start.status, 302);
    assert.equal(start.headers.get('location'), `${base}/app?study=x`);

    // Abrir en la raíz: todo lo que no es de Taptana va al sitio.
    const rooted = (await (await app.request(`/api/v1/prototypes/${proto.id}`, json('PATCH', { root: true }))).json()) as Prototype;
    assert.equal(rooted.url, '/');
    const rootPage = await (await app.request('/app/b', { headers: { accept: 'text/html' } })).text();
    assert.ok(rootPage.includes('Mi app') && rootPage.includes(`data-prototype="${proto.id}"`) && !rootPage.includes('data-base'));
    const rootApi = (await (await app.request('/api/data', { method: 'POST', body: 'z' })).json()) as Record<string, string>;
    assert.equal(rootApi.body, 'z');

    // Borrar.
    assert.equal((await app.request(`/api/v1/prototypes/${proto.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await app.request(`${base}/`)).status, 404);
  });

  test('a site that stops answering shows a friendly page to the participant', async () => {
    const { store, app } = makeApp();
    store.savePrototype({ id: 'pr_caido', name: 'Caído', createdAt: 1, source: 'url', sourceUrl: 'http://127.0.0.1:9/', entryPath: '/' });
    const res = await app.request('/p/pr_caido/', { headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' } });
    assert.equal(res.status, 502);
    assert.match(await res.text(), /No pudimos abrir este prototipo/);
  });
});

test('checkPrototypeUrl reports a timeout', async () => {
  const slow = (_u: URL | string, init?: RequestInit): Promise<Response> =>
    new Promise((_ok, fail) => init?.signal?.addEventListener('abort', () => fail(Object.assign(new Error('t'), { name: 'TimeoutError' }))));
  const r = await checkPrototypeUrl('https://lento.dev', { fetch: slow, timeoutMs: 30 });
  assert.equal(r.issues[0]?.code, 'timeout');
});
