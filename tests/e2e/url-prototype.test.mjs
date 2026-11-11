// Prototipo por URL: un sitio que corre aparte (como un servidor de desarrollo o un sitio
// publicado) se agrega desde el panel con su dirección, y el participante lo recorre en el
// celular a través de Taptana, en /p/<id>/, con todo grabado como en un prototipo subido.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { api, createStudy, launch, MOBILE, startTestServer, ui, waitFor, withContext } from './lib/harness.mjs';

const DESKTOP = { viewport: { width: 1280, height: 900 } };
let server, browser, site, siteUrl;

const page = (title, body) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'">
<title>${title}</title><link rel="stylesheet" href="/estilos.css"></head>
<body><main>${body}</main></body></html>`;

/** El sitio "de afuera": rutas absolutas, una API que se pide con fetch('/api/…'), CSP y X-Frame-Options. */
function startSite() {
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      const { pathname } = new URL(req.url, 'http://x');
      const headers = { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "script-src 'none'", 'x-frame-options': 'DENY' };
      if (pathname === '/') {
        res.writeHead(200, headers);
        return res.end(page('Tienda Afuera', '<h1>Plantas</h1><a id="ir-detalle" href="/detalle" style="display:block;padding:24px;background:#cfc">Ver el helecho</a>'));
      }
      if (pathname === '/detalle') {
        res.writeHead(200, headers);
        return res.end(
          page(
            'Helecho',
            `<h1>Helecho</h1><p id="stock">…</p><a id="confirmar" href="/listo" style="display:block;padding:24px;background:#cfc">Comprar</a>
<script>fetch('/api/stock').then(r => r.json()).then(d => { document.getElementById('stock').textContent = 'Quedan ' + d.stock; });</script>`,
          ),
        );
      }
      if (pathname === '/listo') {
        res.writeHead(200, headers);
        return res.end(page('Listo', '<h1>¡Gracias por tu compra!</h1>'));
      }
      if (pathname === '/estilos.css') {
        res.writeHead(200, { 'content-type': 'text/css' });
        return res.end('body{font-family:sans-serif;margin:16px}');
      }
      if (pathname === '/api/stock') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ stock: 3 }));
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no');
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

before(async () => {
  site = await startSite();
  siteUrl = `http://127.0.0.1:${site.address().port}`;
  server = await startTestServer();
  ({ browser } = await launch());
});
after(async () => {
  await browser?.close();
  await server?.stop();
  await new Promise((ok) => site?.close(ok));
});

describe('prototipo por URL', () => {
  let proto;

  test('se agrega desde Prototipos: revisar, ver el veredicto con el nombre sugerido y agregar', async (t) => {
    await withContext(browser, t.name, DESKTOP, async (context) => {
      const p = await context.newPage();
      await p.goto(`${server.origin}/panel/prototypes`);
      await p.getByRole('tab', { name: /Agregar por URL/ }).click();
      await p.getByLabel('Dirección de tu prototipo').fill(siteUrl.replace('http://', ''));
      await p.getByRole('button', { name: 'Revisar' }).click();
      await p.getByText('Todo bien: se puede usar').waitFor({ timeout: 15000 });
      assert.equal(await p.getByLabel('Nombre', { exact: true }).inputValue(), 'Tienda Afuera');
      await p.getByRole('button', { name: 'Agregar' }).click();
      await p.getByText('Por URL').first().waitFor({ timeout: 15000 });
      await p.getByText(`${siteUrl}/`).first().waitFor();
    });
    const { prototypes } = await api(server.origin, '/prototypes');
    assert.equal(prototypes.length, 1);
    proto = prototypes[0];
    assert.equal(proto.source, 'url');
    assert.equal(proto.sourceUrl, `${siteUrl}/`);
    assert.equal(proto.name, 'Tienda Afuera');
  });

  test('el participante lo recorre en el celular: navegación, tarea lograda y grabación', async (t) => {
    const study = await createStudy(server.origin, {
      v: 2,
      name: 'Comprar por URL',
      prototypeId: proto.id,
      welcome: 'Hola, esto es una prueba.',
      settings: { advance: 'auto', askName: false },
      blocks: [
        { id: 't1', kind: 'task', title: 'Comprar el helecho', instruction: 'Compra el helecho.', startPath: '/', success: { type: 'reached', path: '/listo' } },
        { id: 'q1', kind: 'scale', question: '¿Qué tan fácil fue?', max: 5, required: true },
      ],
    });
    await withContext(browser, t.name, MOBILE, async (context) => {
      const p = await context.newPage();
      await p.goto(`${server.origin}/p/${proto.id}/?study=${study.id}`);
      await ui.welcomeAndConsent(p);
      await ui.act(p, 'go');
      await ui.act(p, 'go');
      await p.locator('#ir-detalle').tap();
      await p.waitForURL(new RegExp(`/p/${proto.id}/detalle`));
      // El fetch('/api/stock') del sitio vuelve al prototipo por la redirección del Referer.
      await p.getByText('Quedan 3').waitFor({ timeout: 10000 });
      assert.equal(await p.evaluate(() => getComputedStyle(document.body).fontFamily), 'sans-serif');
      await p.locator('#confirmar').tap();
      await p.waitForURL(new RegExp(`/p/${proto.id}/listo`));
      await p.locator(`${ui.root} .num[data-v="4"]`).waitFor({ timeout: 15000 });
      await p.locator(`${ui.root} .num[data-v="4"]`).tap();
      await ui.act(p, 'go');
      await p.evaluate(() => window.__taptana?.flush?.());
    });

    const report = await waitFor(
      async () => {
        const r = await api(server.origin, `/studies/${study.id}/report`);
        return r.participants === 1 && r.tasks[0]?.outcomes?.direct === 1 ? r : null;
      },
      { message: 'un participante con la tarea lograda directo' },
    );
    assert.equal(report.tasks[0].score, 100);
    const { sessions } = await api(server.origin, `/sessions?studyId=${study.id}`);
    assert.equal(sessions.length, 1);
    assert.ok(sessions[0].screenCount >= 3, `pantallas: ${sessions[0].screenCount}`);
    const detail = await api(server.origin, `/sessions/${sessions[0].id}/events`);
    const paths = detail.pages.map((pg) => pg.path);
    assert.deepEqual(paths.slice(0, 3), ['/', '/detalle', '/listo']);
    assert.ok(detail.events.filter((e) => e.kind === 'rrweb').length > 0, 'la grabación tiene eventos de rrweb');
    assert.ok(detail.events.some((e) => e.kind === 'taptana' && e.type === 'tap'), 'hay toques');

    // Las pantallas vistas aparecen para el constructor, con su nombre (título o encabezado).
    const { screens } = await api(server.origin, `/prototypes/${proto.id}/screens`);
    const names = Object.fromEntries(screens.map((s) => [s.id, s.name]));
    assert.match(names['/listo'] ?? '', /Gracias|Listo/);
  });
});
