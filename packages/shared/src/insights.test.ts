import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStudyReport, type Insight, type ReportSession } from './report.js';
import type { TargetInfo, TaptanaEvent } from './events.js';
import type { SessionSummary } from './session.js';
import type { Block, StudyRecord } from './study.js';

const nav = (t: number, to: string, title?: string): TaptanaEvent =>
  title === undefined ? { kind: 'taptana', type: 'navigation', t, from: '', to } : { kind: 'taptana', type: 'navigation', t, from: '', to, title };
const tap = (t: number, interactive: boolean, target: Partial<TargetInfo> = {}): TaptanaEvent => ({
  kind: 'taptana', type: 'tap', t, x: 10, y: 100, pageX: 10, pageY: 100, target: { tag: interactive ? 'a' : 'div', selector: 'x', interactive, ...target },
});
const task = (t: number, action: 'start' | 'goal' | 'done' | 'skip', taskId: string): TaptanaEvent => ({ kind: 'taptana', type: 'task', t, taskId, action });
const answer = (t: number, blockId: string, value: number | boolean | string | null): TaptanaEvent => ({ kind: 'taptana', type: 'answer', t, blockId, value });
const finish = (t: number): TaptanaEvent => ({ kind: 'taptana', type: 'study', t, studyId: 'st_1', action: 'finish' });

function session(id: string, events: TaptanaEvent[], extra: Partial<SessionSummary> = {}): ReportSession {
  return {
    session: {
      id, prototypeId: 'local', startedAt: Number(id.replace(/\D/g, '')) || 0, lastSeenAt: 400_000, durationMs: 400_000, deviceLabel: 'iPhone · Safari 18',
      viewport: { width: 390, height: 700 }, touch: true, entryPath: '/', pageCount: 3, tapCount: 3, studyId: 'st_1', ...extra,
    },
    events: [{ kind: 'taptana', type: 'study', t: 0, studyId: 'st_1', action: 'start' }, ...events],
  };
}

const studyOf = (blocks: Block[]): StudyRecord => ({ v: 2, id: 'st_1', name: 'Compra', prototypeId: 'local', createdAt: 0, updatedAt: 0, blocks });
const plain = (insights: Insight[]): string[] => insights.map((i) => `[${i.level}] ${i.text.replace(/ /g, ' ')}`);

const shop = studyOf([
  { id: 'buy', title: 'Comprar una planta', instruction: '…', startPath: '/index.html', success: { type: 'reached', path: '/gracias.html' }, expectedPath: ['/index.html', '/producto.html', '/carrito.html', '/gracias.html'] },
  { id: 'cart', kind: 'first-click', title: 'Encontrar el carrito', instruction: '…', success: { type: 'tapped', selector: '.cart' } },
  { id: 'coupon', title: 'Aplicar un cupón', instruction: '…', success: { type: 'visible', text: 'Cupón aplicado' } },
  { id: 'ship', title: 'Costo del envío', instruction: '…', success: { type: 'manual' } },
  { id: 'ease', kind: 'scale', question: '¿Qué tan fácil fue comprar?', max: 5, minLabel: 'Muy difícil', maxLabel: 'Muy fácil' },
  { id: 'trust', kind: 'scale', question: '¿Qué tanta confianza te dio la tienda?', max: 7 },
]);

/**
 * Un participante del estudio de la tienda.
 * - buy: 'ok' compra por el camino esperado; 'stuck' se queda en el producto tocando la foto.
 * - coupon: segundos que tardó en aplicar el cupón (null = "No pude").
 */
function shopper(n: number, o: { buy: 'ok' | 'stuck'; cart: boolean; coupon: number | null; ship: 'done' | 'skip'; ease: number; trust: number; end?: boolean }): ReportSession {
  const e: TaptanaEvent[] = [nav(1, '/', 'Plantas para tu casa'), task(1000, 'start', 'buy'), tap(2000, true), nav(3000, '/producto.html', 'Monstera')];
  if (o.buy === 'ok') {
    e.push(tap(5000, true), nav(6000, '/carrito.html', 'Tu carrito'), tap(8000, true), nav(9000, '/gracias.html', '¡Gracias!'), task(9001, 'goal', 'buy'), task(9900, 'done', 'buy'));
  } else {
    e.push(tap(4000, false, { text: 'Foto de la planta' }), tap(4500, false, { text: 'Foto de la planta' }), tap(5000, false, { text: 'S/ 89' }), task(20_000, 'skip', 'buy'));
  }
  e.push(task(30_000, 'start', 'cart'), tap(32_000, true, o.cart ? { classes: ['cart'] } : {}), task(32_001, 'done', 'cart'));
  e.push(task(40_000, 'start', 'coupon'));
  if (o.coupon === null) e.push(task(100_000, 'skip', 'coupon'));
  else e.push(task(40_000 + o.coupon * 1000, 'goal', 'coupon'), task(40_900 + o.coupon * 1000, 'done', 'coupon'));
  e.push(task(200_000, 'start', 'ship'), task(210_000, o.ship, 'ship'));
  e.push(answer(220_000, 'ease', o.ease), answer(230_000, 'trust', o.trust));
  if (o.end !== false) e.push(finish(240_000));
  return session(`s${n}`, e);
}

// Un estudio al que le fue mal: pocos compran, se atascan en el producto, el cupón es lento.
const rough = (): ReportSession[] => [
  shopper(1, { buy: 'ok', cart: true, coupon: 70, ship: 'done', ease: 2, trust: 6 }),
  shopper(2, { buy: 'ok', cart: false, coupon: 90, ship: 'done', ease: 2, trust: 7 }),
  shopper(3, { buy: 'stuck', cart: true, coupon: 80, ship: 'skip', ease: 1, trust: 6 }),
  shopper(4, { buy: 'stuck', cart: false, coupon: null, ship: 'done', ease: 2, trust: 6 }),
  shopper(5, { buy: 'stuck', cart: true, coupon: 60, ship: 'done', ease: 1, trust: 7 }),
  shopper(6, { buy: 'stuck', cart: true, coupon: 75, ship: 'done', ease: 3, trust: 5, end: false }),
];

test('a rough study: says what went wrong, most serious first, and still names something good', () => {
  const report = computeStudyReport(shop, rough());
  const out = plain(report.insights);
  assert.deepEqual(out, [
    '[bad] «Comprar una planta» es la tarea con menor éxito: la lograron 2 de 6 personas (33 %). Del resto: 4 dijeron que no pudieron.',
    '[bad] En «Comprar una planta», 4 de 6 personas que llegaron a «Monstera» no siguieron a «Tu carrito»: es el paso con mayor caída.',
    '[bad] «¿Qué tan fácil fue comprar?» promedió 1,8 de 5 (6 respuestas; 1 = «Muy difícil», 5 = «Muy fácil»): es la pregunta con la nota más baja.',
    '[warn] Hay 5 resultados por revisar en «Costo del envío», una tarea que decides tú. Hasta que los marques no cuentan en el éxito ni en el puntaje.',
    '[warn] «Aplicar un cupón» es la tarea más lenta: 1 min 15 s de mediana entre quienes la lograron, frente a 8 s de la otra.',
    '[good] 5 de 6 personas lograron «Aplicar un cupón» (83 %).',
  ]);
  // Las cuatro que nunca se quedan fuera: menor éxito, más lenta, peor escala y por revisar.
  for (const must of [/menor éxito/, /más lenta/, /nota más baja/, /por revisar/]) assert.equal(out.some((t) => must.test(t)), true, String(must));
  // Lo que no entró por el tope de 6 sigue un orden estable: el mismo reporte da las mismas frases.
  assert.deepEqual(plain(computeStudyReport(shop, rough()).insights), out);
});

test('insights point to the block and the screen they talk about', () => {
  const { insights } = computeStudyReport(shop, rough());
  assert.deepEqual(insights.map((i) => [i.blockId, i.screen]), [
    ['buy', undefined],
    ['buy', '/producto.html'],
    ['ease', undefined],
    ['ship', undefined],
    ['coupon', undefined],
    ['coupon', undefined],
  ]);
  const levels = insights.map((i) => i.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => 'bw g'.indexOf(a[0]!) - 'bw g'.indexOf(b[0]!)), 'bad, then warn, then good');
});

test('the slowest task shows up when there is room for it', () => {
  // Las mismas personas, pero ahora compran bien: quedan a la vista el cupón lento y el primer clic.
  const sessions = [
    shopper(1, { buy: 'ok', cart: true, coupon: 70, ship: 'skip', ease: 4, trust: 6 }),
    shopper(2, { buy: 'ok', cart: false, coupon: 90, ship: 'skip', ease: 4, trust: 7 }),
    shopper(3, { buy: 'ok', cart: false, coupon: 80, ship: 'skip', ease: 3, trust: 6 }),
    shopper(4, { buy: 'ok', cart: true, coupon: null, ship: 'skip', ease: 4, trust: 6 }),
    shopper(5, { buy: 'ok', cart: false, coupon: 60, ship: 'skip', ease: 4, trust: 7 }),
  ];
  const out = plain(computeStudyReport(shop, sessions).insights);
  assert.deepEqual(out, [
    '[bad] Nadie logró «Costo del envío»: 5 dijeron que no pudieron.',
    '[warn] «Aplicar un cupón» es la tarea más lenta: 1 min 15 s de mediana entre quienes la lograron, frente a 8 s de la otra.',
    '[good] Las 5 personas lograron «Comprar una planta», todas por el camino esperado.',
    '[good] «¿Qué tanta confianza te dio la tienda?» promedió 6,4 de 7 (5 respuestas).',
  ]);
});

test('a study that went well gets good news, and no invented problems', () => {
  const easy = studyOf([
    { id: 'buy', title: 'Comprar una planta', instruction: '…', success: { type: 'reached', path: '/gracias.html' } },
    { id: 'cart', kind: 'first-click', title: 'Encontrar el carrito', instruction: '…', success: { type: 'tapped', selector: '.cart' } },
    { id: 'ease', kind: 'scale', question: '¿Qué tan fácil fue?', max: 5 },
  ]);
  const happy = (n: number): ReportSession =>
    session(`s${n}`, [
      nav(1, '/'), task(1000, 'start', 'buy'), tap(2000, true), nav(3000, '/gracias.html'), task(3900, 'done', 'buy'),
      task(5000, 'start', 'cart'), tap(6000, true, { classes: ['cart'] }), task(6001, 'done', 'cart'),
      answer(7000, 'ease', 5), finish(8000),
    ]);
  const report = computeStudyReport(easy, [1, 2, 3, 4, 5].map(happy));
  assert.equal(report.score, 100);
  assert.deepEqual(plain(report.insights), [
    '[good] Las 2 tareas tienen 80 % de éxito o más.',
    '[good] Puntaje de usabilidad: 100 de 100. El flujo se entiende bien.',
    '[good] «¿Qué tan fácil fue?» promedió 5 de 5 (5 respuestas).',
  ]);
});

test('first click, detours and people who did not finish get their own sentences', () => {
  const s = studyOf([
    { id: 'buy', title: 'Comprar', instruction: '…', success: { type: 'reached', path: '/gracias.html' }, expectedPath: ['/', '/gracias.html'] },
    { id: 'cart', kind: 'first-click', title: 'Encontrar el carrito', instruction: '…', success: { type: 'tapped', selector: '.cart' } },
  ]);
  const run = (n: number, detour: boolean, hit: boolean, end: boolean): ReportSession =>
    session(`s${n}`, [
      nav(1, '/'), task(1000, 'start', 'buy'), ...(detour ? [nav(2000, '/ayuda.html')] : []), nav(3000, '/gracias.html'), task(3900, 'done', 'buy'),
      task(5000, 'start', 'cart'), tap(6000, true, hit ? { classes: ['cart'] } : {}), task(6001, 'done', 'cart'),
      ...(end ? [finish(8000)] : []),
    ]);
  const sessions = [run(1, true, false, true), run(2, true, false, false), run(3, true, true, false), run(4, false, false, false), run(5, true, false, false)];
  assert.deepEqual(plain(computeStudyReport(s, sessions).insights), [
    '[bad] En «Encontrar el carrito», 1 de 5 personas acertó el primer clic (20 %).',
    '[warn] Solo 1 de 5 personas llegó al final del estudio.',
    '[warn] En «Comprar», 4 de 5 personas que lo lograron dieron un rodeo: no siguieron el camino esperado.',
    '[good] Las 5 personas lograron «Comprar».',
  ]);
});

test('with very little data there are still at least two sentences, and they are honest about it', () => {
  const s = studyOf([{ id: 'q', kind: 'text', question: '¿Qué opinas?' }]);
  const one = computeStudyReport(s, [session('s1', [answer(10, 'q', 'Bien'), finish(20)], { durationMs: 95_000 })]);
  assert.deepEqual(plain(one.insights), [
    '[warn] Con pocas personas (1) los porcentajes cambian mucho; con 5 o más ya aparecen los problemas principales.',
    '[good] La única persona que participó llegó al final del estudio.',
  ]);
  const six = computeStudyReport(s, [1, 2, 3, 4, 5, 6].map((n) => session(`s${n}`, [answer(10, 'q', 'Bien'), finish(20)], { durationMs: 95_000 })));
  assert.deepEqual(plain(six.insights), [
    '[good] Las 6 personas llegaron al final del estudio.',
    '[good] Participaron 6 personas. La sesión duró 1 min 35 s de mediana.',
  ]);
  const quit = computeStudyReport(s, [1, 2, 3, 4, 5, 6].map((n) => session(`s${n}`, [answer(10, 'q', null)], { durationMs: 20_000 })));
  assert.deepEqual(plain(quit.insights), [
    '[warn] Ninguna de las 6 personas llegó al final del estudio.',
    '[good] Participaron 6 personas. La sesión duró 20 s de mediana.',
  ]);
});

test('no participants, no insights; and never more than six', () => {
  assert.deepEqual(computeStudyReport(shop, []).insights, []);
  const everything = computeStudyReport(shop, [...rough(), shopper(7, { buy: 'ok', cart: false, coupon: 300, ship: 'done', ease: 1, trust: 1, end: false })]);
  assert.equal(everything.insights.length, 6);
  for (const i of everything.insights) {
    assert.match(i.text, /^[«A-ZÁÉÍÓÚÑ¿0-9]/);
    assert.match(i.text, /[.!?]$/);
    assert.doesNotMatch(i.text, /undefined|NaN|null/);
  }
});

test('screens are named the same way the report names them, never by what one visit showed', () => {
  const buyer = (n: number, product: string, cartTitle: string, ok: boolean): ReportSession =>
    session(`s${n}`, [
      nav(1, '/', 'Plantas para tu casa'), task(1000, 'start', 'buy'), nav(3000, `/producto.html?id=${n}`, product),
      ...(ok ? [nav(6000, '/carrito.html', cartTitle), nav(9000, '/gracias.html', '¡Gracias!'), task(9001, 'goal', 'buy'), task(9900, 'done', 'buy')] : [task(20_000, 'skip', 'buy')]),
      finish(30_000),
    ]);
  const s = studyOf([shop.blocks[0]!]);
  const sessions = [buyer(1, 'Monstera deliciosa', 'Carrito · Verde', true), buyer(2, 'Ficus lyrata', 'Datos de envío', true), buyer(3, 'Monstera deliciosa', '', false), buyer(4, 'Sansevieria', '', false), buyer(5, 'Pothos', '', false)];
  const report = computeStudyReport(s, sessions);
  assert.equal(report.screenNames['/producto.html'], 'producto');
  assert.equal(report.screenNames['/carrito.html'], 'carrito');
  const drop = plain(report.insights).find((t) => t.includes('mayor caída'));
  assert.equal(drop, '[bad] En «Comprar una planta», 3 de 5 personas que llegaron a «producto» no siguieron a «carrito»: es el paso con mayor caída.');
  // Con las pantallas del prototipo, las frases usan el mismo nombre que el constructor.
  const named = computeStudyReport(s, sessions, undefined, { screens: [{ id: '/producto.html', name: 'Producto · Verde' }, { id: '/carrito.html', name: 'Carrito · Verde' }] });
  assert.equal(plain(named.insights).some((t) => t.includes('que llegaron a «Producto · Verde» no siguieron a «Carrito · Verde»')), true);
});

test('the funnel sentence counts from everyone who started, and is skipped for a manual task with a guessed path', () => {
  // Tarea manual sin camino escrito: el camino se deduce de quien el moderador marcó como logrado.
  const manual = studyOf([{ id: 'ship', title: 'Costo del envío', instruction: '…', success: { type: 'manual' } }]);
  const run = (n: number, far: boolean): ReportSession =>
    session(`s${n}`, [nav(1, '/'), task(1000, 'start', 'ship'), ...(far ? [nav(2000, '/carrito.html')] : []), task(5000, 'done', 'ship'), finish(6000)], {
      tasks: [{ taskId: 'ship', outcome: far ? 'success' : 'failed', ruleMatched: false, reported: 'done', manual: far ? 'success' : 'failure' }],
    });
  const report = computeStudyReport(manual, [run(1, true), run(2, false), run(3, false), run(4, false)]);
  assert.equal(report.tasks[0]!.expectedPathInferred, true);
  assert.deepEqual(report.tasks[0]!.funnel.map((f) => f.reached), [4, 1]);
  assert.equal(plain(report.insights).some((t) => t.includes('mayor caída')), false);
  // La misma tarea con el camino escrito sí se comenta, y parte de las 4 personas que la empezaron.
  const written = studyOf([{ id: 'ship', title: 'Costo del envío', instruction: '…', success: { type: 'manual' }, expectedPath: ['/carrito.html'] }]);
  const drop = plain(computeStudyReport(written, [run(1, true), run(2, false), run(3, false), run(4, false)]).insights).find((t) => t.includes('mayor caída'));
  assert.equal(drop, '[bad] En «Costo del envío», 3 de 4 personas que llegaron a «inicio» no siguieron a «carrito»: es el paso con mayor caída.');
});

test('with fewer than 3 participants a high score is not called a flow that works', () => {
  const easy = studyOf([{ id: 'buy', title: 'Comprar', instruction: '…', success: { type: 'reached', path: '/gracias.html' } }]);
  const happy = (n: number): ReportSession =>
    session(`s${n}`, [nav(1, '/'), task(1000, 'start', 'buy'), tap(2000, true), nav(3000, '/gracias.html'), task(3900, 'done', 'buy'), finish(8000)]);
  const two = computeStudyReport(easy, [happy(1), happy(2)]);
  assert.equal(two.score, 100);
  assert.equal(plain(two.insights).some((t) => t.includes('El flujo se entiende bien')), false);
  assert.equal(plain(two.insights).includes('[warn] Con pocas personas (2) los porcentajes cambian mucho; con 5 o más ya aparecen los problemas principales.'), true);
  assert.equal(plain(computeStudyReport(easy, [happy(1), happy(2), happy(3)]).insights).some((t) => t.includes('El flujo se entiende bien')), true);
});
