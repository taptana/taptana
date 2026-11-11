// Modo práctica (?tryout=1): corre el estudio completo, pero no graba ni envía nada.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, createStudy, launch, miniStudy, MOBILE, startTestServer, studyLink, ui, uploadFixture, withContext } from './lib/harness.mjs';

let server, browser, proto;

before(async () => {
  server = await startTestServer();
  ({ browser } = await launch());
  proto = await uploadFixture(server.origin);
});
after(async () => {
  await browser?.close();
  await server?.stop();
});

test('el link de práctica recorre todo el estudio y no guarda ninguna sesión', async (t) => {
  const study = await createStudy(server.origin, miniStudy(proto.id, { thanks: 'Fin de la práctica.' }));
  await withContext(browser, t.name, MOBILE, async (context) => {
    const page = await context.newPage();
    const posts = [];
    page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/v1/events') && posts.push(r.url()));
    await page.goto(studyLink(server.origin, proto, study, { tryout: true }));

    await page.locator(`${ui.root} #ok`).waitFor({ timeout: 15000 });
    await page.locator(`${ui.root} #ok`).tap();
    await ui.act(page, 'go');
    await ui.act(page, 'go'); // Empezar tarea
    await page.locator('#ir-detalle').tap();
    await page.waitForURL(/detalle\.html/);
    await page.locator('#confirmar').tap();
    await page.waitForURL(/listo\.html/);
    await page.locator(`${ui.root} .num[data-v="5"]`).tap({ timeout: 15000 });
    await ui.act(page, 'go');
    await page.getByText('Fin de la práctica.').waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
    assert.deepEqual(posts, [], 'la práctica envió eventos');
  });
  assert.equal((await api(server.origin, '/sessions')).sessions.length, 0);
  assert.equal((await api(server.origin, `/studies/${study.id}/report`)).participants, 0);
});
