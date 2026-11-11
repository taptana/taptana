// Flujo del diseñador: sube un prototipo desde el panel, arma un estudio con el asistente de tres
// pasos, agrega una tarea con la regla "Llega a una pantalla" y una pregunta, y lo guarda.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, FIXTURE_ZIP, launch, startTestServer, withContext } from './lib/harness.mjs';

const DESKTOP = { viewport: { width: 1280, height: 900 } };
const STUDY_NAME = 'Mi estudio e2e';
const TASK_TITLE = 'Llegar al final';
const QUESTION = '¿Te resultó claro el detalle?';
let server, browser, protoId;

before(async () => {
  server = await startTestServer();
  ({ browser } = await launch());
});
after(async () => {
  await browser?.close();
  await server?.stop();
});

describe('subir y armar', () => {
  test('subir un .zip desde Prototipos lo deja en la lista', async (t) => {
    await withContext(browser, t.name, DESKTOP, async (context) => {
      const page = await context.newPage();
      await page.goto(`${server.origin}/panel/prototypes`);
      await page.getByRole('button', { name: /Subir un prototipo/ }).waitFor();
      await page.locator('input[type=file]').first().setInputFiles(FIXTURE_ZIP);
      await page.getByText('Tus prototipos').waitFor({ timeout: 15000 });
            await page.reload();
      await page.getByText('mini', { exact: true }).first().waitFor({ timeout: 15000 });
    });
    const { prototypes } = await api(server.origin, '/prototypes');
    assert.equal(prototypes.length, 1);
    protoId = prototypes[0].id;
    const screens = await api(server.origin, `/prototypes/${protoId}/screens`);
    assert.ok(JSON.stringify(screens).includes('/listo.html'), 'el servidor no detectó las pantallas del zip');
  });

  test('nuevo estudio: asistente, tarea con regla «Llega a una pantalla» y una pregunta; sobrevive a una recarga', async (t) => {
    let studyUrl;
    await withContext(browser, t.name, DESKTOP, async (context) => {
      const page = await context.newPage();
      await page.goto(`${server.origin}/panel/studies/new`);

      // Paso 1: prototipo. Paso 2: nombre. Paso 3: empezar con una tarea.
      await page.getByRole('radio', { name: /mini/ }).check();
      await page.getByRole('button', { name: /Siguiente/ }).click();
      await page.getByLabel('Nombre del estudio').fill(STUDY_NAME);
      await page.getByRole('button', { name: /Siguiente/ }).click();
      await page.getByRole('button', { name: /Con una tarea/ }).click();

      // La tarea
      await page.getByLabel('Título', { exact: true }).fill(TASK_TITLE);
      await page.getByLabel('Instrucción', { exact: true }).fill('Entra al detalle y confirma.');
      await page.getByRole('radio', { name: /Llega a una pantalla/ }).click();
      // Hay dos selectores de pantalla (inicio opcional y meta): el de la meta es el último.
      await page.getByRole('button', { name: /Elegir una pantalla/ }).last().click();
      await page.getByText('Mini · Listo').click();

      // Una pregunta
      await page.getByRole('button', { name: /Agregar bloque/ }).first().click();
      await page.getByRole('menuitem', { name: /Sí \/ No/ }).click();
      await page.getByLabel('Pregunta', { exact: true }).fill(QUESTION);

      await page.getByRole('button', { name: /^Crear estudio/ }).first().click();
      await page.waitForURL(/\/panel\/studies\/st_[^/]+$/, { timeout: 15000 });
      studyUrl = page.url();

      // Recargar: sigue ahí, con su tarea y su pregunta.
      await page.reload();
      await page.getByText(STUDY_NAME).first().waitFor({ timeout: 15000 });
      await page.getByText(TASK_TITLE).first().waitFor();
      await page.getByText(QUESTION).first().waitFor();
    });

    const id = studyUrl.split('/').pop();
    const saved = await api(server.origin, `/studies/${id}`);
    assert.equal(saved.name, STUDY_NAME);
    assert.equal(saved.prototypeId, protoId);
    const task = saved.blocks.find((b) => b.kind === 'task');
    assert.equal(task.title, TASK_TITLE);
    assert.deepEqual(task.success, { type: 'reached', path: '/listo.html' });
    assert.equal(saved.blocks.find((b) => b.kind === 'yesno').question, QUESTION);

    // También aparece en la lista de estudios.
    await withContext(browser, `${t.name} lista`, DESKTOP, async (context) => {
      const page = await context.newPage();
      await page.goto(`${server.origin}/panel/studies`);
      await page.getByText(STUDY_NAME).first().waitFor({ timeout: 15000 });
    });
  });
});
