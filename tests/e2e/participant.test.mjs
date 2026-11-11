// El participante real: abre el link del estudio en un "celular", acepta el consentimiento,
// hace la tarea tocando el prototipo, responde y llega al final.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, createStudy, launch, miniStudy, MOBILE, startTestServer, studyLink, ui, uploadFixture, waitFor, withContext } from './lib/harness.mjs';

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

describe('participante en el celular', () => {
  test('consentimiento, tarea, pregunta y final: queda una sesión con todo registrado', async (t) => {
    const study = await createStudy(server.origin, miniStudy(proto.id, { thanks: 'Fin de la prueba, gracias.' }));
    await withContext(browser, t.name, MOBILE, async (context) => {
      const page = await context.newPage();
      await page.goto(studyLink(server.origin, proto, study));

      // Bienvenida y consentimiento
      await page.locator(`${ui.root} #ok`).waitFor({ timeout: 15000 });
      await page.getByText('Hola, esto es una prueba.').waitFor();
      await page.locator(`${ui.root} #ok`).tap();
      await ui.act(page, 'go');

      // Contexto de la tarea ("Empezar tarea") y la tarea en el prototipo
      await ui.act(page, 'go');
      await page.locator('#ir-detalle').tap();
      await page.waitForURL(/detalle\.html/);
      await page.locator('#confirmar').tap();
      await page.waitForURL(/listo\.html/);

      // Pregunta de escala: elige 4 y continúa
      await page.locator(`${ui.root} .num[data-v="4"]`).waitFor({ timeout: 15000 });
      await page.locator(`${ui.root} .num[data-v="4"]`).tap();
      await ui.act(page, 'go');

      // Final
      await page.getByText('Fin de la prueba, gracias.').waitFor({ timeout: 15000 });
      await page.evaluate(() => window.__taptana?.flush?.());
    });

    const report = await waitFor(
      async () => {
        const r = await api(server.origin, `/studies/${study.id}/report`);
        return r.participants === 1 && r.tasks[0]?.outcomes?.direct === 1 ? r : null;
      },
      { message: 'un participante con la tarea lograda directo' },
    );
    assert.equal(report.completed, 1);
    assert.equal(report.tasks[0].score, 100);

    const { sessions } = await api(server.origin, `/sessions?studyId=${study.id}`);
    assert.equal(sessions.length, 1);
    const detail = await api(server.origin, `/sessions/${sessions[0].id}`);
    assert.equal(detail.tasks[0].outcome, 'success');
    assert.deepEqual(detail.answers.map((a) => [a.blockId, a.value]), [['q1', 4]]);
  });

  test('si rechaza el consentimiento no se guarda ninguna sesión', async (t) => {
    const study = await createStudy(server.origin, miniStudy(proto.id, { name: 'Estudio rechazo' }));
    const before = (await api(server.origin, '/sessions')).sessions.length;
    await withContext(browser, t.name, MOBILE, async (context) => {
      const page = await context.newPage();
      const posts = [];
      page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/v1/events') && posts.push(r.url()));
      await page.goto(studyLink(server.origin, proto, study));
      await page.locator(`${ui.root} #ok`).waitFor({ timeout: 15000 });
      await ui.act(page, 'no');
      // Recargar la pestaña no la reactiva: sigue sin grabar ni enviar nada.
      await page.reload();
      await page.locator('#ir-detalle').waitFor();
      await page.waitForTimeout(300);
      assert.deepEqual(posts, []);
    });
    // Margen para un envío tardío: ninguna sesión nueva.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await api(server.origin, '/sessions')).sessions.length, before);
  });
});
