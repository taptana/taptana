// Regenera las sesiones de ejemplo (packages/server/seed/*.json) con participantes "reales":
// Playwright abre el prototipo de ejemplo en el servidor de verdad y lo usa como lo haría una
// persona, con pausas, toques equivocados y respuestas distintas.
//
// Uso (desde la raíz, después de `pnpm build`):
//
//   pnpm seed:record                 graba todo y reemplaza packages/server/seed/*.json
//   pnpm seed:record -- --only ana   graba solo a quien tenga "ana" en el nombre de archivo
//                                    (útil para probar un guion; no borra los demás)
//
// Variables: TAPTANA_SEED_PORT (4516), TAPTANA_CHROMIUM (ruta a un Chromium ya instalado).
//
// Qué produce:
//   01-03  sesiones libres (sin estudio): iPhone que compra, Android que abandona, laptop
//   04-12  nueve participantes del estudio examples/tienda/study.json (id st_demo_compra)
// Los ids son estables (s_demo_…), así la demo y los enlaces no cambian entre regeneraciones.
//
// Al final revisa que nada de lo escrito en los formularios del prototipo haya quedado en los
// archivos (PRIVATE, abajo). Si algo se filtra, el script falla y no deja los archivos nuevos.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChromium } from './lib/playwright.mjs';
import { api, repoRoot, startServer } from './lib/server.mjs';

const PORT = Number(process.env['TAPTANA_SEED_PORT'] ?? 4516);
const PROTOTYPE = 'pr_ejemplo';
const STUDY = 'st_demo_compra';
const SEED_DIR = join(repoRoot, 'packages/server/seed');
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt === -1 ? null : process.argv[onlyAt + 1];

// Lo que los participantes escriben en el formulario de envío. Nada de esto puede salir del
// celular: el recorder lo enmascara. Se revisa al final, archivo por archivo.
const PRIVATE = ['Zulema', 'Quispe Privada', '987600123', 'Secreto 742', 'Timbre roto'];

const UI = '[data-taptana-ui="study"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una persona frente al prototipo: sabe tocar (o hacer clic, en laptop) y esperar. */
class Person {
  constructor(context, page, touch) {
    this.context = context;
    this.page = page;
    this.touch = touch;
  }
  wait(ms) {
    return this.page.waitForTimeout(ms);
  }
  async hit(selector, pause = 900, position) {
    const el = this.page.locator(selector).first();
    await el.waitFor({ timeout: 15000 });
    const opts = position ? { position } : {};
    if (this.touch) await el.tap(opts);
    else await el.click(opts);
    await this.wait(pause);
  }
  async go(selector, url, pause = 1400) {
    await Promise.all([this.page.waitForURL(url, { timeout: 15000 }), this.hit(selector, 0)]);
    await this.wait(pause);
  }
  async scroll(dy, pause = 900) {
    await this.page.mouse.wheel(0, dy);
    await this.wait(pause);
  }
  async type(selector, text, delay = 80) {
    await this.hit(selector, 350);
    await this.page.locator(selector).first().pressSequentially(text, { delay });
    await this.wait(500);
  }
  async swipeLeft(selector) {
    const box = await this.page.locator(selector).boundingBox();
    if (!box || !this.touch) return;
    const y = box.y + box.height / 2;
    const cdp = await this.context.newCDPSession(this.page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width - 40, y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width - 40 - i * 30, y }] });
      await this.wait(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await this.wait(1100);
  }

  // ── Interfaz del estudio (shadow root del recorder) ──
  /** Toca un botón de la hoja actual y espera a que esa hoja se vaya. */
  async act(name, read = 1200) {
    const button = this.page.locator(`${UI} [data-act="${name}"]`);
    await button.waitFor({ timeout: 20000 });
    await this.wait(Math.max(450, read)); // los botones ignoran toques los primeros 300 ms
    const handle = await button.elementHandle();
    if (this.touch) await button.tap();
    else await button.click();
    await handle?.waitForElementState('hidden', { timeout: 5000 }).catch(() => {});
    await this.wait(450);
  }
  async welcome(name) {
    await this.page.locator(`${UI} #ok`).waitFor({ timeout: 20000 });
    await this.wait(2200);
    if (name) {
      await this.hit(`${UI} #who`, 300);
      await this.page.locator(`${UI} #who`).pressSequentially(name, { delay: 90 });
      await this.wait(400);
    }
    await this.hit(`${UI} #ok`, 500);
    await this.act('go', 500);
    await this.page.waitForFunction(() => Boolean(window.__taptana?.sessionId), null, { timeout: 10000 });
    return this.page.evaluate(() => window.__taptana.sessionId);
  }
  /** Abre la píldora de la tarea y toca "Listo, terminé" (done) o "No pude" (skip). */
  async finishTask(action) {
    await this.hit(`${UI} .pill`, 300);
    await this.act(action, 1300);
  }
  async scale(value) {
    await this.hit(`${UI} .num[data-v="${value}"]`, 500);
    await this.act('go', 400);
  }
  async yesNo(value) {
    if (value === null) return this.act('skip', 1500);
    await this.hit(`${UI} .num[data-v="${value ? 'yes' : 'no'}"]`, 500);
    await this.act('go', 400);
  }
  async choose(indexes) {
    await this.page.locator(`${UI} .opt`).first().waitFor({ timeout: 20000 });
    await this.wait(1800);
    if (indexes.length === 0) return this.act('skip', 600);
    for (const i of indexes) {
      const opt = this.page.locator(`${UI} .opt`).nth(i);
      if (this.touch) await opt.tap();
      else await opt.click();
      await this.wait(600);
    }
    await this.act('go', 400);
  }
  async write(text) {
    await this.page.locator(`${UI} #area`).waitFor({ timeout: 20000 });
    await this.wait(1500);
    if (!text) return this.act('skip', 600);
    await this.hit(`${UI} #area`, 300);
    await this.page.locator(`${UI} #area`).pressSequentially(text, { delay: 45 });
    await this.act('go', 500);
  }
}

// ── Trozos de comportamiento sobre la tienda ──
const fillShipping = async (p, { forgetTerms = false } = {}) => {
  await p.scroll(350);
  await p.type('input[name="nombre"]', 'Zulema Quispe Privada');
  await p.type('input[name="celular"]', '987600123', 100);
  await p.type('input[name="direccion"]', 'Jirón Secreto 742', 60);
  if (forgetTerms) await p.hit('#pagar', 1600); // olvidó los términos: el formulario avisa
  await p.hit('input[name="terminos"]', 700);
};
const pay = (p) => p.go('#pagar', /gracias/, 1800);
/** Para la tarea del envío: agrega una planta pequeña y mira el resumen del carrito. */
const lookUpShipping = async (p) => {
  if (!/index|\/$/.test(new URL(p.page.url()).pathname)) await p.go('.back', /index\.html|\/$/, 1200);
  await p.go('[data-product="pothos"]', /producto/, 1500);
  await p.go('#agregar', /carrito/, 1500);
  await p.hit('[data-envio]', 2200); // lee (y toca) la fila de envío
};

/** Guion común del estudio. `spec` dice qué hace esta persona en cada bloque. */
async function studyRun(p, spec) {
  await p.page.goto(`${p.origin}/p/${PROTOTYPE}/?study=${STUDY}`);
  const id = await p.welcome(spec.name);
  await p.act('go', spec.quick ? 500 : 3000); // contexto
  await p.act('go', spec.quick ? 500 : 2500); // t1: "Empezar tarea"
  await spec.buy(p);
  await p.scale(spec.ease);
  await p.act('go', spec.quick ? 500 : 2200); // t2: primer clic (ya en /index.html)
  await p.wait(spec.quick ? 300 : 1500);
  await p.hit(spec.firstClick, 2600, spec.firstClickAt);
  await p.yesNo(spec.wouldBuy);
  await p.choose(spec.helps);
  await p.act('go', spec.quick ? 500 : 2500); // t3: envío
  await spec.shipping(p);
  await p.write(spec.change);
  await p.wait(2500); // lee el "¡Gracias!"
  return id;
}

const PEOPLE = [
  // ── Sesiones libres ──
  {
    file: '01-iphone-compra', id: 's_demo_iphone_compra', device: 'iPhone 13',
    run: async (p) => {
      await p.page.goto(`${p.origin}/p/${PROTOTYPE}/`);
      await p.wait(1800);
      await p.scroll(250);
      await p.scroll(300, 1200);
      await p.hit('[data-filter="grande"]', 1500);
      await p.go('[data-product="ficus"]', /producto/, 1600);
      await p.swipeLeft('.gallery-track');
      await p.swipeLeft('.gallery-track');
      await p.scroll(300, 800);
      await p.hit('details:nth-of-type(1) summary', 2200);
      await p.hit('[data-size="L"]', 900);
      await p.go('#agregar', /carrito/, 1500);
      await p.hit('[data-inc]', 700);
      await p.hit('[data-dec]', 1200);
      await fillShipping(p, { forgetTerms: true });
      await pay(p);
      await p.wait(1500);
    },
  },
  {
    file: '02-android-abandona', id: 's_demo_android_abandona', device: 'Pixel 7',
    run: async (p) => {
      await p.page.goto(`${p.origin}/p/${PROTOTYPE}/`);
      await p.wait(1500);
      await p.hit('[data-filter="suculenta"]', 1300);
      await p.hit('[data-filter="interior"]', 1000);
      await p.hit('[data-filter="todas"]', 900);
      await p.scroll(500, 1200);
      await p.go('[data-product="echeveria"]', /producto/, 1400);
      await p.hit('[data-size="M"]', 600);
      await p.hit('[data-size="S"]', 800);
      await p.hit('details:nth-of-type(2) summary', 1800);
      await p.go('.back', /index\.html|\/$/, 1200);
      await p.go('[data-product="pothos"]', /producto/, 1000);
      await p.go('#agregar', /carrito/, 1500);
      await p.scroll(300, 1500);
      await p.type('input[name="nombre"]', 'Zulema', 120);
      await p.wait(2500);
      await p.go('.back', /index\.html|\/$/, 1500);
    },
  },
  {
    file: '03-laptop-rapido', id: 's_demo_laptop_rapido', device: 'laptop',
    run: async (p) => {
      await p.page.goto(`${p.origin}/p/${PROTOTYPE}/`);
      await p.wait(1200);
      await p.go('[data-product="monstera"]', /producto/, 1000);
      await p.hit('[data-size="M"]', 600);
      await p.go('#agregar', /carrito/, 1000);
      await fillShipping(p);
      await pay(p);
    },
  },

  // ── Participantes del estudio ──
  {
    file: '04-estudio-ana-directo', id: 's_demo_estudio_1', device: 'iPhone 13',
    patch: { label: 'P1 · Ana', manual: { t3: 'success' }, notes: 'Fue directo al filtro «Grandes». Encontró el envío en el resumen del carrito.' },
    run: (p) => studyRun(p, {
      name: 'Ana',
      buy: async (p) => {
        await p.hit('[data-filter="grande"]', 1300);
        await p.go('[data-product="ficus"]', /producto/, 1600);
        await p.hit('[data-size="L"]', 800);
        await p.go('#agregar', /carrito/, 1400);
        await fillShipping(p);
        await pay(p);
      },
      ease: 5, firstClick: '.cart-link', wouldBuy: true, helps: [0, 3],
      shipping: async (p) => { await lookUpShipping(p); await p.finishTask('done'); },
      change: 'Nada grave. Me gustaría ver fotos reales de las plantas, no dibujos.',
    }),
  },
  {
    file: '05-estudio-bruno-indirecto', id: 's_demo_estudio_2', device: 'Pixel 7',
    patch: { label: 'P2 · Bruno', manual: { t3: 'failure' }, notes: 'Tocó el título y el texto del inicio creyendo que eran botones. Dijo «envío gratis» sin revisar el carrito.' },
    run: (p) => studyRun(p, {
      name: 'Bruno',
      buy: async (p) => {
        await p.hit('.hero h1', 900);
        await p.hit('.hero p', 1100);
        await p.hit('[data-filter="suculenta"]', 1300);
        await p.go('[data-product="echeveria"]', /producto/, 1800);
        await p.hit('h1[data-name]', 800);
        await p.go('.back', /index\.html|\/$/, 1200);
        await p.hit('[data-filter="grande"]', 900);
        await p.go('[data-product="monstera"]', /producto/, 1400);
        await p.hit('[data-size="M"]', 600);
        await p.go('#agregar', /carrito/, 1400);
        await fillShipping(p, { forgetTerms: true });
        await pay(p);
      },
      ease: 3, firstClick: '.brand', firstClickAt: { x: 28, y: 12 }, // el nombre de la tienda, lejos de la píldora
      wouldBuy: true, helps: [1, 4],
      shipping: async (p) => { await p.hit('.hero p', 2500); await p.finishTask('done'); },
      change: 'No sabía si la planta era grande de verdad. Pondría el tamaño en centímetros.',
    }),
  },
  {
    file: '06-estudio-carla-no-pudo', id: 's_demo_estudio_3', device: 'iPhone 13',
    patch: { label: 'P3 · Carla', notes: 'No vio el botón «Agregar al carrito» (queda pegado abajo). Buscó cómo comprar tocando el precio.' },
    run: (p) => studyRun(p, {
      name: 'Carla',
      buy: async (p) => {
        await p.hit('.hero p', 900);
        await p.scroll(500, 1500);
        await p.hit('.footer', 1000);
        await p.go('[data-product="pothos"]', /producto/, 2500);
        await p.hit('.price', 1000);
        await p.hit('.hint', 1500);
        await p.hit('.price', 1800);
        await p.finishTask('skip');
      },
      ease: 1, firstClick: '.cart-link', wouldBuy: false, helps: [0, 2, 4],
      shipping: async (p) => { await p.wait(2500); await p.scroll(300, 2000); await p.finishTask('skip'); },
      change: 'No encontré cómo comprar. El botón debería estar junto al precio.',
    }),
  },
  {
    file: '07-estudio-diego-directo', id: 's_demo_estudio_4', device: 'Pixel 7',
    patch: { label: 'P4 · Diego', manual: { t3: 'success' } },
    run: (p) => studyRun(p, {
      name: 'Diego',
      buy: async (p) => {
        await p.hit('[data-filter="grande"]', 900);
        await p.go('[data-product="sansevieria"]', /producto/, 1200);
        await p.go('#agregar', /carrito/, 1200);
        await fillShipping(p);
        await pay(p);
      },
      ease: 4, firstClick: '.cart-link', wouldBuy: true, helps: [1],
      shipping: async (p) => { await lookUpShipping(p); await p.finishTask('done'); },
      change: '',
    }),
  },
  {
    file: '08-estudio-elena-carrito-primero', id: 's_demo_estudio_5', device: 'iPhone 13',
    patch: { label: 'P5 · Elena' }, // su tarea del envío queda "por revisar" a propósito
    run: (p) => studyRun(p, {
      name: 'Elena',
      buy: async (p) => {
        await p.go('.cart-link', /carrito/, 1500);
        await p.hit('.empty', 800);
        await p.go('.empty a', /index\.html|\/$/, 1200);
        await p.go('[data-product="ficus"]', /producto/, 1300);
        await p.go('#agregar', /carrito/, 1300);
        await fillShipping(p);
        await pay(p);
      },
      ease: 4, firstClick: '[data-product="monstera"]', wouldBuy: true, helps: [0, 1],
      shipping: async (p) => { await p.go('.back', /index\.html|\/$/, 1300); await p.hit('.hero p', 2000); await p.go('.cart-link', /carrito/, 2500); await p.finishTask('done'); },
      change: 'Que el carrito diga cuánto falta para el envío gratis.',
    }),
  },
  {
    file: '09-estudio-fabian-directo', id: 's_demo_estudio_6', device: 'iPhone 13',
    patch: { label: 'P6 · Fabián', manual: { t3: 'success' } },
    run: (p) => studyRun(p, {
      name: 'Fabián',
      buy: async (p) => {
        await p.go('[data-product="monstera"]', /producto/, 1100);
        await p.hit('[data-size="L"]', 600);
        await p.go('#agregar', /carrito/, 1200);
        await fillShipping(p);
        await pay(p);
      },
      ease: 5, firstClick: '.cart-link', wouldBuy: true, helps: [3],
      shipping: async (p) => { await lookUpShipping(p); await p.finishTask('done'); },
      change: 'Todo bien, fue rápido.',
    }),
  },
  {
    file: '10-estudio-gabriela-laptop', id: 's_demo_estudio_7', device: 'laptop',
    patch: { label: 'P7 · Gabriela', manual: { t3: 'success' }, notes: 'Lo hizo desde su laptop.' },
    run: (p) => studyRun(p, {
      name: 'Gabriela',
      buy: async (p) => {
        await p.hit('[data-filter="grande"]', 1000);
        await p.go('[data-product="ficus"]', /producto/, 1300);
        await p.hit('[data-size="L"]', 700);
        await p.go('#agregar', /carrito/, 1200);
        await fillShipping(p);
        await pay(p);
      },
      ease: 4, firstClick: '.cart-link', wouldBuy: null, helps: [0, 2],
      shipping: async (p) => { await lookUpShipping(p); await p.finishTask('done'); },
      change: 'En pantalla grande todo se ve muy estirado.',
    }),
  },
  {
    file: '11-estudio-hugo-indirecto', id: 's_demo_estudio_8', device: 'Pixel 7',
    patch: { label: 'P8 · Hugo', notes: 'Dudó entre dos plantas y volvió al inicio. Se rindió con el envío.' },
    run: (p) => studyRun(p, {
      name: 'Hugo',
      buy: async (p) => {
        await p.scroll(400, 1200);
        await p.go('[data-product="aloe"]', /producto/, 1700);
        await p.swipeLeft('.gallery-track');
        await p.hit('.gallery .hint', 900);
        await p.go('.back', /index\.html|\/$/, 1300);
        await p.hit('[data-filter="grande"]', 1000);
        await p.go('[data-product="sansevieria"]', /producto/, 1500);
        await p.hit('details:nth-of-type(2) summary', 1800);
        await p.hit('[data-size="L"]', 700);
        await p.go('#agregar', /carrito/, 1400);
        await fillShipping(p, { forgetTerms: true });
        await pay(p);
      },
      ease: 2, firstClick: '.cart-link', wouldBuy: false, helps: [2, 4],
      shipping: async (p) => { await p.wait(1500); await p.hit('.empty', 2200, { x: 40, y: 10 }); await p.finishTask('skip'); }, // carrito vacío: no hay resumen que mirar
      change: 'El formulario no dice qué campo falta. Me dio error y no entendí por qué.',
    }),
  },
  {
    file: '12-estudio-prueba-interna', id: 's_demo_estudio_9', device: 'iPhone 13',
    patch: { label: 'Prueba interna', excluded: true, notes: 'Recorrido rápido del equipo para revisar el estudio. Excluida del reporte.' },
    run: (p) => studyRun(p, {
      name: '', quick: true,
      buy: async (p) => { await p.wait(600); await p.finishTask('skip'); },
      ease: 3, firstClick: '.cart-link', wouldBuy: null, helps: [],
      shipping: async (p) => { await p.wait(400); await p.finishTask('skip'); },
      change: '',
    }),
  },
];

const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false };

async function main() {
  const people = only ? PEOPLE.filter((x) => x.file.includes(only)) : PEOPLE;
  if (people.length === 0) throw new Error(`Nadie coincide con --only ${only}`);
  const dataDir = mkdtempSync(join(tmpdir(), 'taptana-seed-'));
  const server = await startServer({ port: PORT, dataDir });
  const { browser, devices } = await launchChromium();
  const outDir = join(dataDir, 'out');
  mkdirSync(outDir);
  try {
    await prepare(server.origin);

    // Tres a la vez: cada quien en su propio contexto (su propio "celular").
    const queue = [...people];
    const worker = async () => {
      for (let person = queue.shift(); person; person = queue.shift()) {
        const raw = await record(browser, devices, server.origin, person);
        writeFileSync(join(outDir, `${person.file}.json`), raw);
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    // Nada de lo escrito en el prototipo puede estar en los archivos.
    for (const file of readdirSync(outDir)) {
      const raw = readFileSync(join(outDir, file), 'utf8');
      const leaked = PRIVATE.filter((text) => raw.includes(text));
      if (leaked.length) throw new Error(`FUGA en ${file}: quedó grabado texto escrito en el formulario (${leaked.join(', ')})`);
    }

    const report = await api(server.origin, `/studies/${STUDY}/report`);
    console.log(`\nreporte: ${report.participants} participantes, puntaje ${report.score}, ${report.pendingReview} por revisar, ${report.excluded} excluidas`);
    for (const t of report.tasks) console.log(`  ${t.title}: ${JSON.stringify(t.outcomes)} puntaje ${t.score}`);

    // Todo bien: ahora sí se reemplazan los archivos.
    if (!only) for (const f of readdirSync(SEED_DIR)) if (f.endsWith('.json')) rmSync(join(SEED_DIR, f));
    for (const f of readdirSync(outDir)) renameSync(join(outDir, f), join(SEED_DIR, f));
    console.log(`\n${people.length} sesiones en packages/server/seed (sin fugas de texto). Corre «pnpm build» para que el servidor y la demo las usen.`);
  } finally {
    await browser.close();
    await server.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

/** Deja en el servidor el prototipo de ejemplo y el estudio de examples/tienda con su id estable. */
async function prepare(origin) {
  // Con sesiones de ejemplo ya grabadas esto lo carga todo; sin ellas responde 503, pero deja
  // el prototipo creado, que es lo que hace falta aquí.
  await fetch(`${origin}/api/v1/example`, { method: 'POST' });
  for (const s of (await api(origin, '/sessions')).sessions) await api(origin, `/sessions/${s.id}`, { method: 'DELETE' });

  const study = JSON.parse(readFileSync(join(repoRoot, 'examples/tienda/study.json'), 'utf8'));
  const exists = await fetch(`${origin}/api/v1/studies/${STUDY}`);
  if (!exists.ok) {
    // La API crea estudios con id al azar; importar una sesión que lo trae dentro conserva el id.
    const now = Date.now();
    const stub = {
      v: 1, exportedAt: now,
      session: { id: 's_tmp_semilla', prototypeId: PROTOTYPE, startedAt: now, lastSeenAt: now, durationMs: 0, deviceLabel: 'tmp', viewport: { width: 390, height: 844 }, touch: true, entryPath: '/index.html', pageCount: 0, tapCount: 0, eventCount: 0 },
      pages: [], events: [],
      study: { ...study, id: STUDY, createdAt: now, updatedAt: now },
    };
    await api(origin, '/sessions/import', { method: 'POST', body: JSON.stringify(stub) });
    await api(origin, '/sessions/s_tmp_semilla', { method: 'DELETE' });
  }
  const saved = await api(origin, `/studies/${STUDY}`, { method: 'PUT', body: JSON.stringify({ ...study, prototypeId: PROTOTYPE }) });
  if (saved.v !== 2 || saved.blocks.length !== study.blocks.length || saved.prototypeId !== PROTOTYPE) throw new Error('El estudio de ejemplo no quedó guardado como se esperaba.');
}

async function record(browser, devices, origin, person) {
  const touch = person.device !== 'laptop';
  const context = await browser.newContext({ ...(touch ? devices[person.device] : LAPTOP), locale: 'es-PE', timezoneId: 'America/Lima' });
  const page = await context.newPage();
  const p = new Person(context, page, touch);
  p.origin = origin;
  let id;
  try {
    id = await person.run(p);
    id ??= await page.evaluate(() => window.__taptana?.sessionId);
    await page.evaluate(() => window.__taptana?.flush?.());
    await p.wait(1200);
  } catch (err) {
    await page.screenshot({ path: join(tmpdir(), `taptana-seed-error-${person.file}.png`) }).catch(() => {});
    throw new Error(`${person.file}: ${err instanceof Error ? err.message : err}\n(captura en ${join(tmpdir(), `taptana-seed-error-${person.file}.png`)})`);
  } finally {
    await context.close();
  }
  if (!id) throw new Error(`${person.file}: no se obtuvo el id de la sesión`);
  if (person.patch) await api(origin, `/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(person.patch) });
  const data = await api(origin, `/sessions/${id}/export`);
  if (data.events.length < 10) throw new Error(`${person.file}: la sesión quedó casi vacía (${data.events.length} eventos)`);

  // Ids y origen estables, para que los archivos no cambien de forma entre regeneraciones.
  const raw = JSON.stringify(data).split(id).join(person.id).split(origin).join('http://localhost:4321');
  const s = JSON.parse(raw).session;
  const tasks = (s.tasks ?? []).map((t) => `${t.taskId}:${t.outcome}${t.manual ? `(${t.manual})` : ''}`).join(' ');
  console.log(`${person.file}  ${s.deviceLabel}  ${Math.round(s.durationMs / 1000)} s  ${Math.round(raw.length / 1024)} kB  ${tasks}  respuestas:${s.answers?.length ?? 0}`);
  return raw;
}

await main();
