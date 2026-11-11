// El ejemplo: un servidor nuevo, "Ver un ejemplo" en Inicio, y el reporte completo.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, launch, startTestServer, withContext } from './lib/harness.mjs';

const DESKTOP = { viewport: { width: 1280, height: 900 } };
const STUDY = 'st_demo_compra';
let server, browser, study;

before(async () => {
  server = await startTestServer();
  ({ browser } = await launch());
});
after(async () => {
  await browser?.close();
  await server?.stop();
});

describe('ejemplo y reporte', () => {
  test('Inicio → «Ver un ejemplo» abre el reporte con puntaje', async (t) => {
    await withContext(browser, t.name, DESKTOP, async (context) => {
      const page = await context.newPage();
      await page.goto(`${server.origin}/panel`);
      await page.getByRole('button', { name: /Ver un ejemplo/ }).click();
      await page.waitForURL(new RegExp(`/panel/studies/${STUDY}/report`), { timeout: 30000 });
      await page.getByText('Puntaje de usabilidad').waitFor({ timeout: 15000 });
      const main = await page.locator('main').innerText();
      const score = /Puntaje de usabilidad[\s\S]*?\b(\d{1,3})\s+de 100/.exec(main);
      assert.ok(score, `no se ve un puntaje: ${main.slice(0, 300)}`);
      assert.ok(Number(score[1]) >= 0 && Number(score[1]) <= 100);
    });
    study = await api(server.origin, `/studies/${STUDY}`);
    assert.equal((await api(server.origin, '/sessions')).sessions.length >= 8, true);
  });

  test('las cuatro pestañas muestran contenido y ?tab= sobrevive a una recarga', async (t) => {
    const task = study.blocks.find((b) => b.kind === 'task');
    const question = study.blocks.find((b) => b.kind === 'scale');
    await withContext(browser, t.name, DESKTOP, async (context) => {
      const page = await context.newPage();
      await page.goto(`${server.origin}/panel/studies/${STUDY}/report`);
      const tab = (name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
      const checks = [
        ['Resumen', page.getByText('Puntaje de usabilidad')],
        ['Tareas', page.getByText(task.title).first()],
        ['Preguntas', page.getByText(question.question).first()],
        ['Participantes', page.getByRole('button', { name: /^P1 · / })],
      ];
      for (const [name, expected] of checks) {
        await tab(name).click();
        await expected.waitFor({ timeout: 10000 });
        assert.equal(await tab(name).getAttribute('aria-selected'), 'true', name);
        if (name !== 'Resumen') assert.match(page.url(), new RegExp(`tab=${name === 'Participantes' ? 'participantes' : name.toLowerCase()}`));
      }
      await page.reload();
      await page.getByRole('button', { name: /^P1 · / }).waitFor({ timeout: 15000 });
      assert.equal(await tab('Participantes').getAttribute('aria-selected'), 'true');

      // Y entrando directo con el link.
      await page.goto(`${server.origin}/panel/studies/${STUDY}/report?tab=preguntas`);
      await page.getByText(question.question).first().waitFor({ timeout: 15000 });
      assert.equal(await tab('Preguntas').getAttribute('aria-selected'), 'true');
    });
  });

  test('Participantes lista 8 personas y al abrir una se ven sus tareas y respuestas', async (t) => {
    await withContext(browser, t.name, DESKTOP, async (context) => {
      const page = await context.newPage();
      await page.goto(`${server.origin}/panel/studies/${STUDY}/report?tab=participantes`);
      const people = page.getByRole('button', { name: /^P\d+ · / });
      await people.first().waitFor({ timeout: 15000 });
      assert.equal(await people.count(), 8);
      const first = people.first();
      assert.equal(await first.getAttribute('aria-expanded'), 'false');
      await first.click();
      assert.equal(await first.getAttribute('aria-expanded'), 'true');
      const task = study.blocks.find((b) => b.kind === 'task');
      const scale = study.blocks.find((b) => b.kind === 'scale');
      await page.getByText(task.title).first().waitFor();
      await page.getByText(scale.question).first().waitFor();
      await page.getByRole('link', { name: /^Ver la sesión de/ }).first().waitFor();
    });
  });

  test('una grabación abre y el reproductor se monta', async (t) => {
    await withContext(browser, t.name, DESKTOP, async (context) => {
      const page = await context.newPage();
      await page.goto(`${server.origin}/panel/studies/${STUDY}/report?tab=participantes`);
      await page.getByRole('button', { name: /^P1 · / }).click();
      await page.getByRole('link', { name: /^Ver la sesión de/ }).first().click();
      await page.waitForURL(/\/panel\/recordings\/s_/);
      await page.locator('.rr-player iframe').waitFor({ state: 'attached', timeout: 20000 });
      await page.locator('.rr-controller').waitFor({ timeout: 10000 });
      await page.getByText('Resultado de tareas').waitFor();
    });
  });
});
