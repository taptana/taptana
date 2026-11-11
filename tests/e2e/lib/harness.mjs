// Ayudas comunes de las pruebas e2e: servidor en puerto libre con datos temporales,
// navegador (con el cargador de scripts/lib) y captura de pantalla cuando algo falla.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../../../scripts/lib/playwright.mjs';
import { api, repoRoot, startServer } from '../../../scripts/lib/server.mjs';

export { api, repoRoot };
export const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ARTIFACTS = join(here, '.artifacts');
export const FIXTURE_ZIP = join(here, 'fixtures', 'mini.zip');

/** Pide al sistema un puerto libre (nunca el 4321). */
async function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** Servidor real con una carpeta de datos nueva. `stop()` lo apaga y borra la carpeta. */
export async function startTestServer() {
  const dataDir = mkdtempSync(join(tmpdir(), 'taptana-e2e-'));
  let server;
  for (let attempt = 0; attempt < 5 && !server; attempt++) {
    try {
      server = await startServer({ port: await freePort(), dataDir });
    } catch (err) {
      if (attempt === 4 || !String(err.message).includes('ocupado')) throw err;
    }
  }
  return {
    origin: server.origin,
    dataDir,
    log: server.log,
    stop: async () => {
      await server.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function launch() {
  return launchChromium();
}

/** Contexto de navegador; si `fn` falla, guarda una captura de cada página en .artifacts/. */
export async function withContext(browser, label, options, fn) {
  const context = await browser.newContext({ locale: 'es-PE', ...options });
  try {
    return await fn(context);
  } catch (err) {
    mkdirSync(ARTIFACTS, { recursive: true });
    const slug = label.replace(/[^a-z0-9]+/gi, '-').slice(0, 80);
    await Promise.all(
      context.pages().map((p, i) => p.screenshot({ path: join(ARTIFACTS, `${slug}-${i}.png`), fullPage: true }).catch(() => {})),
    );
    throw err;
  } finally {
    await context.close();
  }
}

/** Sube el prototipo mínimo (zip de 3 pantallas) por la API. */
export async function uploadFixture(origin, name = 'Mini tienda') {
  const form = new FormData();
  form.set('name', name);
  form.set('file', new File([readFileSync(FIXTURE_ZIP)], 'mini.zip', { type: 'application/zip' }));
  const res = await fetch(`${origin}/api/v1/prototypes`, { method: 'POST', body: form });
  if (res.status !== 201) throw new Error(`No se pudo subir el prototipo: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Estudio mínimo: una tarea (llegar a /listo.html) y una pregunta de escala. */
export function miniStudy(prototypeId, extra = {}) {
  return {
    v: 2,
    name: 'Estudio mini',
    prototypeId,
    welcome: 'Hola, esto es una prueba.',
    settings: { advance: 'auto', askName: false },
    blocks: [
      { id: 't1', kind: 'task', title: 'Confirmar el detalle', instruction: 'Entra al detalle y confirma.', startPath: '/index.html', success: { type: 'reached', path: '/listo.html' } },
      { id: 'q1', kind: 'scale', question: '¿Qué tan fácil fue?', max: 5, minLabel: 'Difícil', maxLabel: 'Fácil', required: true },
    ],
    ...extra,
  };
}

export async function createStudy(origin, study) {
  return api(origin, '/studies', { method: 'POST', body: JSON.stringify(study) });
}

/** Link que recibe el participante (o con `tryout`, el de práctica sin grabar). */
export function studyLink(origin, proto, study, { tryout = false } = {}) {
  return `${origin}/p/${proto.id}/?study=${study.id}${tryout ? '&tryout=1' : ''}`;
}

/** Espera a que la API cumpla una condición (en vez de dormir). */
export async function waitFor(fn, { timeout = 10000, message = 'condición' } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    if (Date.now() > end) throw new Error(`Se agotó la espera de: ${message}. Último valor: ${last instanceof Error ? last.message : JSON.stringify(last)?.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

export const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const UI = '[data-taptana-ui="study"]';

/** Interfaz del estudio dentro del celular (shadow root del recorder). Ver scripts/record-seed.mjs. */
export const ui = {
  root: UI,
  /** Toca un botón de la hoja actual; espera a que acepte toques (los ignora los primeros 300 ms). */
  async act(page, name) {
    const button = page.locator(`${UI} [data-act="${name}"]`);
    await button.waitFor({ timeout: 15000 });
    await page.waitForTimeout(350);
    const handle = await button.elementHandle();
    await button.tap();
    await handle?.waitForElementState('hidden', { timeout: 5000 }).catch(() => {});
  },
  async welcomeAndConsent(page) {
    await page.locator(`${UI} #ok`).waitFor({ timeout: 15000 });
    await page.waitForTimeout(350);
    await page.locator(`${UI} #ok`).tap();
  },
};
