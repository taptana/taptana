// Privacidad: lo que el participante escribe en el prototipo no sale del celular, y antes del
// consentimiento no sale nada.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { api, createStudy, launch, miniStudy, MOBILE, startTestServer, studyLink, ui, uploadFixture, waitFor, withContext } from './lib/harness.mjs';

const SECRET = 'Zulema Quispe 731 secreto';
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

/** Todos los archivos de la carpeta de datos, menos los prototipos subidos (que son del diseñador). */
function dataFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'prototypes') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...dataFiles(full));
    else out.push(full);
  }
  return out;
}

/** Un participante completo que escribe `text` en el campo del prototipo. Devuelve el estudio. */
async function participantTypes(t, text, name) {
  const study = await createStudy(server.origin, miniStudy(proto.id, { name }));
  await withContext(browser, t.name, MOBILE, async (context) => {
    const page = await context.newPage();
    await page.goto(studyLink(server.origin, proto, study));
    await page.locator(`${ui.root} #ok`).waitFor({ timeout: 15000 });
    await page.locator(`${ui.root} #ok`).tap();
    await ui.act(page, 'go');
    await ui.act(page, 'go'); // Empezar tarea
    await page.locator('#ir-detalle').tap();
    await page.waitForURL(/detalle\.html/);
    await page.locator('#nota').tap();
    await page.locator('#nota').pressSequentially(text, { delay: 10 });
    assert.equal(await page.locator('#nota').inputValue(), text); // sí se escribió en el celular
    await page.locator('#confirmar').tap();
    await page.waitForURL(/listo\.html/);
    await page.locator(`${ui.root} .num[data-v="3"]`).tap({ timeout: 5000 });
    await ui.act(page, 'go');
    await page.evaluate(() => window.__taptana?.flush?.());
  });
  return study;
}

describe('privacidad', () => {
  test('antes del consentimiento no sale ninguna petición de eventos; después sí', async (t) => {
    const study = await createStudy(server.origin, miniStudy(proto.id, { name: 'Privacidad previa' }));
    await withContext(browser, t.name, MOBILE, async (context) => {
      const page = await context.newPage();
      const posts = [];
      page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/v1/events') && posts.push(r.url()));
      await page.goto(studyLink(server.origin, proto, study));
      await page.locator(`${ui.root} #ok`).waitFor({ timeout: 15000 });
      await page.waitForTimeout(300);
      // Marca la casilla pero todavía no empieza: sigue sin enviarse nada.
      await page.locator(`${ui.root} #ok`).tap();
      await page.waitForTimeout(300);
      assert.deepEqual(posts, [], 'salió una petición antes del consentimiento');

      // Control positivo: al empezar sí se envían eventos (si no, la prueba no probaría nada).
      const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/api/v1/events'), { timeout: 15000 });
      await ui.act(page, 'go');
      await sent;
    });
  });

  test('lo escrito en un campo del prototipo no queda en ningún dato guardado', async (t) => {
    const study = await participantTypes(t, SECRET, 'Privacidad campo');
    const sessionId = await waitFor(
      async () => {
        const { sessions } = await api(server.origin, `/sessions?studyId=${study.id}`);
        return sessions[0]?.tapCount >= 2 ? sessions[0].id : null;
      },
      { message: 'la sesión con sus toques' },
    );
    const exported = await api(server.origin, `/sessions/${sessionId}/export`);
    assert.ok(exported.events.length > 10, 'la sesión debería tener eventos de rrweb y de Taptana');
    const needles = [SECRET, SECRET.toLowerCase(), 'Quispe', 'secreto'];
    const blobs = {
      export: JSON.stringify(exported),
      eventos: JSON.stringify(await api(server.origin, `/sessions/${sessionId}/events`)),
      reporte: JSON.stringify(await api(server.origin, `/studies/${study.id}/report`)),
      detalle: JSON.stringify(await api(server.origin, `/sessions/${sessionId}`)),
    };
    for (const [where, text] of Object.entries(blobs)) {
      for (const n of needles) assert.ok(!text.includes(n), `«${n}» quedó guardado en ${where}`);
    }
    // Tampoco en los archivos de la base de datos (incluido el WAL).
    for (const file of dataFiles(server.dataDir)) {
      const bytes = readFileSync(file).toString('latin1');
      for (const n of needles) assert.ok(!bytes.includes(n), `«${n}» aparece en el archivo ${file}`);
    }
  });

  // Un guion en lo escrito rompía la máscara (expresión regular inválida) y con ella el estudio.
  test('un campo con guion no rompe la interfaz del estudio', async (t) => {
    await participantTypes(t, 'Ana-Maria 555-0123', 'Privacidad guion');
  });
});
