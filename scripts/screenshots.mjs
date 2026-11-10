// Genera las capturas de docs/img/ (las que usan el README y la guía) con el producto real:
// arranca el servidor con datos temporales, carga el ejemplo y fotografía cada pantalla.
//
//   pnpm build && pnpm screenshots
//
// Variables: TAPTANA_SHOTS_PORT (4517), TAPTANA_CHROMIUM (ruta a un Chromium ya instalado).
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChromium } from './lib/playwright.mjs';
import { api, repoRoot, startServer } from './lib/server.mjs';

const PORT = Number(process.env['TAPTANA_SHOTS_PORT'] ?? 4517);
const OUT = join(repoRoot, 'docs/img');
const UI = '[data-taptana-ui="study"]';
mkdirSync(OUT, { recursive: true });

const dataDir = mkdtempSync(join(tmpdir(), 'taptana-shots-'));
const server = await startServer({ port: PORT, dataDir });
const { browser, devices } = await launchChromium();
try {
  const { studyId, prototypeId } = await api(server.origin, '/example', { method: 'POST' });
  const panel = `${server.origin}/panel`;

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'es-PE' });
  const page = await desktop.newPage();
  const shot = async (name, opts = {}) => {
    await page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
    console.log(`docs/img/${name}.png`);
  };

  // 1. Inicio
  await page.goto(panel);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForTimeout(800);
  await shot('inicio');

  // 2. Constructor (tres columnas: bloques, editor, teléfono)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${panel}/studies/${studyId}`);
  await page.locator('iframe[title="Prototipo en el teléfono"]').waitFor({ timeout: 15000 });
  await page.getByText('Comprar una planta grande').first().click().catch(() => {});
  await page.waitForTimeout(1800);
  await shot('constructor');

  // 3. Reporte
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${panel}/studies/${studyId}/report`);
  await page.locator('[data-testid="study-score"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot('reporte');

  // 4. Una tarea del reporte, y su mapa de calor sobre lo que vio el participante
  const task = page.locator('#bloque-t1');
  await task.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -16));
  await page.waitForTimeout(800);
  await shot('reporte-tarea');
  const map = task.locator('.tt-snapshot').first();
  if (!(await map.count())) {
    const tab = task.getByRole('tab', { name: /pantallas|mapa/i }).first();
    if (await tab.count()) await tab.click();
  }
  await map.waitFor({ timeout: 15000 });
  await map.scrollIntoViewIfNeeded();
  await page.waitForTimeout(3500); // la foto de la sesión tarda en dibujarse
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.waitForTimeout(300);
  await shot('mapa-de-calor');

  // 5. Reproductor de una sesión
  await page.goto(`${panel}/recordings/s_demo_estudio_2`);
  await page.locator('.rr-player, .replayer-wrapper').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await shot('reproductor');
  await desktop.close();

  // 6. El participante en su celular: bienvenida, tarea y pregunta
  const phone = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, locale: 'es-PE' });
  const p = await phone.newPage();
  const tap = async (selector) => {
    const el = p.locator(selector).first();
    await el.waitFor({ timeout: 15000 });
    await p.waitForTimeout(600);
    const handle = await el.elementHandle();
    await el.tap();
    return handle;
  };
  const act = async (name) => {
    const handle = await tap(`${UI} [data-act="${name}"]`);
    await handle?.waitForElementState('hidden', { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(500);
  };
  const pshot = async (name) => {
    await p.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`docs/img/${name}.png`);
  };
  await p.goto(`${server.origin}/p/${prototypeId}/?study=${studyId}`);
  await tap(`${UI} #ok`);
  await p.waitForTimeout(500);
  await pshot('participante-bienvenida');
  await act('go'); // Empezar
  await act('go'); // contexto → tarea
  await p.locator(`${UI} [data-act="go"]`).waitFor();
  await p.waitForTimeout(700);
  await pshot('participante-tarea');
  await act('go'); // Empezar tarea: queda la píldora
  await p.locator(`${UI} .pill`).waitFor();
  await tap('[data-filter="grande"]');
  await p.waitForTimeout(6500); // se va la ayuda de la píldora
  await pshot('participante-pildora');
  await tap(`${UI} .pill`);
  await act('skip'); // No pude → pregunta de escala
  await tap(`${UI} .num[data-v="4"]`);
  await p.waitForTimeout(400);
  await pshot('participante-pregunta');
  await phone.close();
} finally {
  await browser.close();
  await server.stop();
  rmSync(dataDir, { recursive: true, force: true });
}
