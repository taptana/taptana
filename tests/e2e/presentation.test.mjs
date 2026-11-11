// La presentación: se arma sola con el ejemplo, se recorre y se descarga como PowerPoint sin
// nombres de participantes.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { api, launch, repoRoot, startTestServer, withContext } from './lib/harness.mjs';

// fflate es dependencia del servidor (JavaScript puro): de ahí se toma para abrir el .pptx.
const { unzipSync, strFromU8 } = createRequire(join(repoRoot, 'packages/server/package.json'))('fflate');

const DESKTOP = { viewport: { width: 1440, height: 900 }, acceptDownloads: true };
const STUDY = 'st_demo_compra';
let server, browser;

before(async () => {
  server = await startTestServer();
  ({ browser } = await launch());
  await api(server.origin, '/example', { method: 'POST' });
});
after(async () => {
  await browser?.close();
  await server?.stop();
});

describe('presentación', () => {
  test('desde el reporte, «Crear presentación» arma las diapositivas y baja un .pptx sin nombres', async (t) => {
    const sessions = (await api(server.origin, '/sessions')).sessions;
    // Los alias del ejemplo ("P1 · Ana" → "Ana") y los ids de sesión no pueden aparecer.
    const aliases = sessions.flatMap((s) => (s.label ?? '').split('·').map((x) => x.trim())).filter((x) => x.length > 2 && !/^P\d+$/.test(x));
    assert.ok(aliases.includes('Ana') && aliases.includes('Bruno'), aliases.join(', '));

    await withContext(browser, t.name, DESKTOP, async (context) => {
      const page = await context.newPage();
      await page.goto(`${server.origin}/panel/studies/${STUDY}/report`);
      await page.getByRole('link', { name: 'Crear presentación' }).click();
      await page.waitForURL(new RegExp(`/panel/studies/${STUDY}/presentation`));
      await page.getByTestId('deck-slide').waitFor({ timeout: 15000 });
      const count = await page.getByTestId('deck-thumb').count();
      assert.ok(count > 5, `diapositivas: ${count}`);

      // Las flechas recorren las diapositivas.
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByTestId('deck-position').innerText(), `2 de ${count}`);
      assert.equal(await page.getByTestId('deck-slide').getAttribute('data-kind'), 'summary');

      await page.getByRole('button', { name: /Descargar/ }).click();
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByTestId('download-pptx').click()]);
      assert.equal(download.suggestedFilename(), 'compra-en-verde-presentacion.pptx');
      const file = await download.path();
      const bytes = readFileSync(file);
      assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK');

      const zip = unzipSync(new Uint8Array(bytes));
      const slides = Object.keys(zip).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
      assert.ok(slides.length >= 6, `diapositivas en el .pptx: ${slides.length}`);
      assert.equal(slides.length, count);
      const xml = slides.map((name) => strFromU8(zip[name])).join('\n');
      assert.ok(xml.includes('Compra en Verde'), 'el nombre del estudio está en las diapositivas');
      for (const alias of aliases) assert.ok(!new RegExp(`\\b${alias}\\b`).test(xml), `el .pptx no dice «${alias}»`);
      for (const s of sessions) assert.ok(!xml.includes(s.id), `ni el id ${s.id}`);
    });
  });
});
