import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOME_LABELS, computeStudyReport, similarWidth, studyCsv, shortSessionId, type ReportSession, type TaskOutcomeCounts } from './report.js';
import type { TapEvent, TargetInfo, TaptanaEvent } from './events.js';
import type { SessionSummary } from './session.js';
import type { Block, StudyRecord, TaskBlock } from './study.js';

const buy: TaskBlock = { id: 't1', title: 'Comprar', instruction: '…', success: { type: 'reached', path: '/gracias.html' } };
const studyOf = (blocks: Block[], extra: Partial<StudyRecord> = {}): StudyRecord => ({
  v: 2, id: 'st_1', name: 'S', prototypeId: 'local', createdAt: 0, updatedAt: 0, blocks, ...extra,
});
const study = studyOf([buy], { variants: [{ id: 'A', name: 'Con fotos' }, { id: 'B', name: 'Sin fotos' }] });

const nav = (t: number, to: string, title?: string): TaptanaEvent =>
  title === undefined ? { kind: 'taptana', type: 'navigation', t, from: '', to } : { kind: 'taptana', type: 'navigation', t, from: '', to, title };
const tap = (t: number, interactive: boolean | undefined, y = 100, target: Partial<TargetInfo> = {}, extra: Partial<TapEvent> = {}): TaptanaEvent => {
  const info: TargetInfo = { tag: interactive ? 'a' : 'div', selector: 'x', ...target };
  if (interactive !== undefined) info.interactive = interactive;
  return { kind: 'taptana', type: 'tap', t, x: 10, y, pageX: 10, pageY: y + 500, target: info, ...extra };
};
const task = (t: number, action: 'start' | 'goal' | 'done' | 'skip', taskId = 't1'): TaptanaEvent => ({ kind: 'taptana', type: 'task', t, taskId, action });
const answer = (t: number, blockId: string, value: number | boolean | string | string[] | null): TaptanaEvent => ({ kind: 'taptana', type: 'answer', t, blockId, value });
const viewport = (t: number, width: number, height: number): TaptanaEvent => ({ kind: 'taptana', type: 'viewport', t, width, height, orientation: 'portrait' });
const finish = (t: number): TaptanaEvent => ({ kind: 'taptana', type: 'study', t, studyId: 'st_1', action: 'finish' });

function session(id: string, events: TaptanaEvent[], extra: Partial<SessionSummary> = {}): ReportSession {
  return {
    session: {
      id, prototypeId: 'local', startedAt: 0, lastSeenAt: 10_000, durationMs: 10_000, deviceLabel: 'iPhone · Safari 18',
      viewport: { width: 390, height: 700 }, touch: true, entryPath: '/', pageCount: 3, tapCount: 3, studyId: 'st_1', ...extra,
    },
    events: [{ kind: 'taptana', type: 'study', t: 0, studyId: 'st_1', action: 'start' }, ...events],
  };
}

const counts = (o: Partial<TaskOutcomeCounts>): TaskOutcomeCounts => ({ direct: 0, indirect: 0, reported: 0, failed: 0, incomplete: 0, review: 0, ...o });

// Tres participantes de siempre: directo, indirecto con un misclick, y uno que no pudo.
const direct = (): ReportSession => session('s1', [nav(1, '/'), task(2, 'start'), tap(3, true), nav(4, '/producto.html?id=1'), tap(5, true), nav(6, '/gracias.html'), task(7, 'done')], { variantId: 'A' });
const indirect = (): ReportSession => session('s2', [nav(1, '/'), task(2, 'start'), tap(3, false), nav(4, '/carrito.html'), nav(5, '/producto.html'), tap(6, true), nav(7, '/gracias.html'), task(8, 'done')], { variantId: 'A' });
const failed = (): ReportSession => session('s3', [nav(1, '/'), task(2, 'start'), tap(3, false), tap(4, false), nav(5, '/producto.html'), task(9, 'skip')], { variantId: 'B' });

test('direct vs indirect success, funnel, misclicks, screens and variants', () => {
  const r = computeStudyReport(study, [direct(), indirect(), failed()]);
  const t = r.tasks[0]!;
  assert.equal(r.participants, 3);
  assert.deepEqual(t.outcomes, counts({ direct: 1, indirect: 1, failed: 1 }));
  assert.equal(t.participants, 3);
  assert.equal(t.decided, 3);
  assert.equal(t.expectedPathInferred, true);
  assert.deepEqual(t.expectedPath, ['/index.html', '/producto.html', '/gracias.html']);
  assert.deepEqual(t.funnel.map((f) => f.reached), [3, 3, 2]);
  assert.equal(t.avgMisclicks, 1);
  assert.equal(t.misclickRate, 3 / 6);
  assert.equal(t.tapCount, 6);
  const home = t.screens.find((s) => s.path === '/index.html')!;
  assert.equal(home.visitors, 3);
  assert.equal(home.taps.length, 4);
  assert.equal(home.misclicks, 3);
  assert.equal(home.taps[0]!.y, 600);
  assert.deepEqual(t.screens.map((s) => s.path), ['/index.html', '/producto.html', '/gracias.html', '/carrito.html']);
  assert.equal(t.paths[0]!.count, 1);
  assert.deepEqual(t.results.map((x) => x.outcome), ['direct', 'indirect', 'failed']);
  assert.deepEqual(t.results.map((x) => x.pages.length), [3, 4, 2]);
  // 100·(1/3) + 50·(1/3) − 50·0,5 = 25
  assert.equal(t.score, 25);
  assert.equal(r.score, 25);
  assert.equal(r.successRate, 2 / 3);
  assert.equal(r.variants.find((v) => v.id === 'A')!.successRate, 1);
  assert.equal(r.variants.find((v) => v.id === 'B')!.successRate, 0);
});

test('explicit expected path makes a detour indirect', () => {
  const s = studyOf([{ ...buy, expectedPath: ['/', '/carrito.html', '/gracias.html'] }]);
  const a = session('s1', [nav(1, '/'), task(2, 'start'), nav(4, '/producto.html'), nav(6, '/gracias.html')]);
  const r = computeStudyReport(s, [a]);
  assert.equal(r.tasks[0]!.expectedPathInferred, false);
  assert.deepEqual(r.tasks[0]!.expectedPath, ['/index.html', '/carrito.html', '/gracias.html']);
  assert.equal(r.tasks[0]!.outcomes.indirect, 1);
  assert.deepEqual(r.tasks[0]!.funnel.map((f) => f.reached), [1, 0, 0]);
  // 50·1 (indirecto), sin misclicks ni penalización
  assert.equal(r.tasks[0]!.score, 50);
});

test('the expected path written by the designer is matched leniently to what was seen', () => {
  const s = studyOf([{ ...buy, success: { type: 'reached', path: '/fin' }, expectedPath: ['/', '/tienda', '/fin/'] }]);
  const a = session('s1', [nav(1, '/index.html?x=1'), task(2, 'start'), nav(4, '/tienda/'), nav(6, '/fin')]);
  const t = computeStudyReport(s, [a]).tasks[0]!;
  assert.deepEqual(t.expectedPath, ['/index.html', '/tienda/index.html', '/fin']);
  assert.equal(t.outcomes.direct, 1);
});

test('what happens after the goal is not part of the task', () => {
  // Con avance manual: llegó, siguió paseando y tocando, y después tocó "Listo".
  const a = session('s1', [nav(1, '/'), task(2, 'start'), nav(1000, '/gracias.html'), task(1001, 'goal'), tap(2000, false), nav(3000, '/'), tap(3500, false), task(5000, 'done')]);
  const t = computeStudyReport(studyOf([buy]), [a]).tasks[0]!;
  assert.deepEqual(t.results[0]!.pages, ['/index.html', '/gracias.html']);
  assert.equal(t.outcomes.direct, 1);
  assert.equal(t.tapCount, 0);
  assert.equal(t.results[0]!.durationMs, 998);
  assert.equal(t.results[0]!.goalAt, 1000);
  assert.equal(t.results[0]!.startedAt, 2);
});

test('first click: start page comes from startPath and a wrong tap is a failure', () => {
  const s = studyOf([{ id: 't1', kind: 'first-click', title: 'Carrito', instruction: '…', startPath: '/index.html', success: { type: 'tapped', selector: '.cart' } }]);
  const wrong = session('s1', [nav(1, '/gracias.html'), task(2, 'start'), nav(3, '/index.html'), tap(4, false)]);
  const right = session('s2', [nav(1, '/index.html'), task(2, 'start'), tap(4, true, 30, { classes: ['cart'] }), tap(9, false)]);
  const r = computeStudyReport(s, [wrong, right]);
  const t = r.tasks[0]!;
  assert.deepEqual(t.outcomes, counts({ direct: 1, failed: 1 }));
  assert.deepEqual(t.results[0]!.pages, ['/index.html']);
  assert.equal(t.kind, 'first-click');
  assert.equal(t.score, 50, 'first click: 100 · hit rate, misclicks do not subtract');
  assert.equal(t.tapCount, 2, 'only the first tap of each participant');
  assert.equal(t.medianTimeMs, 2);
  assert.deepEqual(t.expectedPath, [], 'a first click has no path');
  assert.deepEqual(t.funnel, []);
});

test('first click with a reached rule is a hit when the screen arrives after the tap', () => {
  const s = studyOf([{ id: 't1', kind: 'first-click', title: 'Carrito', instruction: '…', success: { type: 'reached', path: '/carrito.html' } }]);
  const a = session('s1', [nav(1, '/'), task(2, 'start'), tap(500, true), task(501, 'done'), nav(540, '/carrito.html')]);
  const t = computeStudyReport(s, [a]).tasks[0]!;
  assert.deepEqual(t.outcomes, counts({ direct: 1 }));
  assert.deepEqual(t.results[0]!.pages, ['/index.html'], 'the tap happened on the start screen');
  assert.equal(t.score, 100);
});

test('manual tasks reported as done are "to review": out of the success rate and the score', () => {
  const manual: TaskBlock = { id: 't1', title: 'Costo de envío', instruction: '…', success: { type: 'manual' } };
  const s = studyOf([manual]);
  const run = (id: string, close: 'done' | 'skip', extra: Partial<SessionSummary> = {}): ReportSession =>
    session(id, [nav(1, '/'), task(2, 'start'), task(900, close)], extra);
  const pendingOnly = computeStudyReport(s, [run('s1', 'done'), run('s2', 'done')]);
  assert.deepEqual(pendingOnly.tasks[0]!.outcomes, counts({ review: 2 }));
  assert.equal(pendingOnly.tasks[0]!.decided, 0);
  assert.equal(pendingOnly.tasks[0]!.score, null);
  assert.equal(pendingOnly.score, null);
  assert.equal(pendingOnly.successRate, 0);
  assert.equal(pendingOnly.pendingReview, 2);

  // El moderador marca una (viene en session.tasks) y otra llega por `manual`.
  const marked = run('s3', 'done', { tasks: [{ taskId: 't1', outcome: 'success', ruleMatched: false, reported: 'done', manual: 'success' }] });
  const markedFail: ReportSession = { ...run('s4', 'done'), manual: { t1: 'failure' } };
  const r = computeStudyReport(s, [run('s1', 'done'), marked, markedFail, run('s5', 'skip')]);
  const t = r.tasks[0]!;
  assert.deepEqual(t.outcomes, counts({ review: 1, direct: 1, failed: 2 }));
  assert.equal(t.participants, 4);
  assert.equal(t.decided, 3);
  assert.equal(t.successRate, 1 / 3);
  assert.equal(r.pendingReview, 1);
  assert.equal(t.score, 33);
});

test('a rule-based task reported as done without meeting the rule is "reported", not "review"', () => {
  const a = session('s1', [nav(1, '/'), task(2, 'start'), task(900, 'done')]);
  const t = computeStudyReport(studyOf([buy]), [a]).tasks[0]!;
  assert.deepEqual(t.outcomes, counts({ reported: 1 }));
  assert.equal(t.decided, 1);
  assert.equal(t.score, 0);
});

test('stale results in session.tasks are not trusted: outcomes are recomputed from events', () => {
  const a = session('s1', [nav(1, '/'), task(2, 'start'), nav(500, '/gracias.html'), task(900, 'done')], {
    tasks: [{ taskId: 't1', outcome: 'failed', ruleMatched: false, reported: 'skip', manual: null }],
  });
  assert.deepEqual(computeStudyReport(studyOf([buy]), [a]).tasks[0]!.outcomes, counts({ direct: 1 }));
});

test('median time only looks at those who made it', () => {
  const ok = (id: string, ms: number): ReportSession => session(id, [nav(1, '/'), task(1000, 'start'), nav(1000 + ms, '/gracias.html'), task(2000 + ms, 'done')]);
  const gaveUp = session('s9', [nav(1, '/'), task(1000, 'start'), task(101_000, 'skip')]);
  const abandoned = session('s8', [nav(1, '/'), task(1000, 'start')], { lastSeenAt: 500_000 });
  const t = computeStudyReport(studyOf([buy]), [ok('s1', 10_000), ok('s2', 20_000), gaveUp, abandoned]).tasks[0]!;
  assert.equal(t.medianTimeMs, 15_000);
  assert.deepEqual(t.outcomes, counts({ direct: 2, failed: 1, incomplete: 1 }));
  assert.equal(computeStudyReport(studyOf([buy]), [gaveUp]).tasks[0]!.medianTimeMs, null);
});

test('usability score: slow screens subtract up to 10 points', () => {
  const run = (ms: number): ReportSession => session('s1', [nav(1, '/'), task(1000, 'start'), nav(1000 + ms, '/gracias.html'), task(2000 + ms, 'done')]);
  const score = (ms: number): number | null => computeStudyReport(studyOf([buy]), [run(ms)]).tasks[0]!.score;
  assert.equal(score(8_000), 100, '4 s per screen: no penalty');
  assert.equal(score(10_000), 100, '5 s per screen: still none');
  assert.equal(score(20_000), 98, '10 s per screen: (10 − 5) / 2 = 2,5');
  assert.equal(score(40_000), 93, '20 s per screen: 7,5');
  assert.equal(score(400_000), 90, 'never more than 10');
});

test('usability score never leaves 0–100', () => {
  const lost = session('s1', [nav(1, '/'), task(2, 'start'), tap(3, false), tap(4, false), task(9, 'skip')]);
  assert.equal(computeStudyReport(studyOf([buy]), [lost]).tasks[0]!.score, 0);
});

test('the study misclick rate averages only tasks that have taps', () => {
  const second: TaskBlock = { ...buy, id: 't2', title: 'Volver' };
  const s = studyOf([buy, second]);
  const a = session('s1', [
    nav(1, '/'), task(2, 'start'), tap(3, false), tap(4, true), nav(5, '/gracias.html'), task(6, 'done'),
    task(10, 'start', 't2'), nav(11, '/gracias.html'), task(12, 'done', 't2'),
  ]);
  const r = computeStudyReport(s, [a]);
  assert.equal(r.tasks[0]!.misclickRate, 0.5);
  assert.equal(r.tasks[1]!.tapCount, 0);
  assert.equal(r.avgMisclickRate, 0.5, 'not 0,25: the task without taps does not count as 0');
});

test('old sessions without the "interactive" flag do not count misclicks, nor dilute the rate', () => {
  const old = session('s1', [nav(1, '/'), task(2, 'start'), tap(3, undefined), tap(4, undefined), nav(5, '/gracias.html'), task(6, 'done')]);
  const fresh = session('s2', [nav(1, '/'), task(2, 'start'), tap(3, false), tap(4, true), nav(5, '/gracias.html'), task(6, 'done')]);
  const onlyOld = computeStudyReport(studyOf([buy]), [old]);
  assert.equal(onlyOld.tasks[0]!.misclickRate, 0);
  assert.equal(onlyOld.tasks[0]!.tapCount, 2);
  assert.equal(onlyOld.avgMisclickRate, 0);
  const mixed = computeStudyReport(studyOf([buy]), [old, fresh]);
  assert.equal(mixed.tasks[0]!.misclickRate, 0.5, '1 misclick out of the 2 taps that carry the flag');
  assert.equal(mixed.tasks[0]!.screens[0]!.taps.filter((p) => p.misclick).length, 1);
});

test('participants: study sessions that consented and are not excluded; each task counts who started it', () => {
  const other = session('x1', [nav(1, '/'), task(2, 'start'), nav(3, '/gracias.html')], { studyId: 'st_otro' });
  const free = session('x2', [nav(1, '/')]);
  delete free.session.studyId;
  const internal = session('x3', [nav(1, '/'), task(2, 'start'), task(3, 'skip')], { excluded: true });
  const onlyConsent = session('s4', [nav(1, '/')]);
  const r = computeStudyReport(studyOf([buy]), [direct(), other, free, internal, onlyConsent, failed()]);
  assert.equal(r.participants, 2, 'who consented and left without starting anything is not a participant');
  assert.equal(r.bounced, 1);
  assert.equal(r.excluded, 1);
  assert.equal(r.tasks[0]!.participants, 2, 'the one who never started the task is not in its numbers');
  assert.deepEqual(r.tasks[0]!.outcomes, counts({ direct: 1, failed: 1 }));
  assert.deepEqual(r.devices, { touch: 2, desktop: 0 });
  // Responder una pregunta también es empezar.
  const q = studyOf([{ id: 'q', kind: 'yesno', question: '¿Sí?' }]);
  const answered = computeStudyReport(q, [session('a', [answer(5, 'q', null)]), session('b', [nav(1, '/')])]);
  assert.equal(answered.participants, 1);
  assert.equal(answered.bounced, 1);
});

test('filter by variant and by device; the filter is echoed', () => {
  const laptop = session('s4', [nav(1, '/'), task(2, 'start'), nav(6, '/gracias.html'), task(7, 'done')], { touch: false, variantId: 'B' });
  const all = [direct(), indirect(), failed(), laptop];
  const none = computeStudyReport(study, all);
  assert.equal(none.participants, 4);
  assert.equal('filter' in none, false);
  assert.deepEqual(none.devices, { touch: 3, desktop: 1 });

  const a = computeStudyReport(study, all, { variantId: 'A' });
  assert.equal(a.participants, 2);
  assert.deepEqual(a.filter, { variantId: 'A' });
  assert.deepEqual(a.tasks[0]!.results.map((x) => x.sessionId), ['s1', 's2']);
  assert.deepEqual(a.devices, { touch: 3, desktop: 1 }, 'device counts ignore the filter, to label its options');

  const desktop = computeStudyReport(study, all, { device: 'desktop' });
  assert.deepEqual(desktop.tasks[0]!.results.map((x) => x.sessionId), ['s4']);
  const touch = computeStudyReport(study, all, { device: 'touch' });
  assert.equal(touch.participants, 3);
  const both = computeStudyReport(study, all, { variantId: 'B', device: 'touch' });
  assert.deepEqual(both.tasks[0]!.results.map((x) => x.sessionId), ['s3']);
  assert.deepEqual(both.filter, { variantId: 'B', device: 'touch' });
  assert.equal(computeStudyReport(study, all, { variantId: 'Z' }).participants, 0);
});

test('A/B is compared task by task, not by mixing every task together', () => {
  const click: TaskBlock = { id: 't2', kind: 'first-click', title: 'Carrito', instruction: '…', success: { type: 'tapped', selector: '.cart' } };
  const s = studyOf([buy, click], { variants: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }] });
  const run = (id: string, variantId: string, bought: boolean, hit: boolean): ReportSession =>
    session(id, [
      nav(1, '/'), task(1000, 'start'), ...(bought ? [nav(3000, '/gracias.html')] : []), task(4000, bought ? 'done' : 'skip'),
      task(5000, 'start', 't2'), tap(5600, true, 30, hit ? { classes: ['cart'] } : {}),
    ], { variantId });
  const r = computeStudyReport(s, [run('a1', 'A', true, false), run('a2', 'A', true, false), run('b1', 'B', false, true), run('b2', 'B', true, true)]);
  const [t1, t2] = r.tasks;
  assert.deepEqual(t1!.byVariant, [
    { variantId: 'A', participants: 2, decided: 2, successRate: 1, directRate: 1, medianTimeMs: 2000, score: 100 },
    { variantId: 'B', participants: 2, decided: 2, successRate: 0.5, directRate: 0.5, medianTimeMs: 2000, score: 50 },
  ]);
  assert.deepEqual(t2!.byVariant.map((v) => [v.variantId, v.successRate, v.score]), [['A', 0, 0], ['B', 1, 100]]);
  // El resumen general promedia las tareas de cada variante.
  assert.deepEqual(r.variants, [
    { id: 'A', name: 'A', participants: 2, successRate: 0.5, directRate: 0.5, medianTimeMs: 2000, score: 50 },
    { id: 'B', name: 'B', participants: 2, successRate: 0.75, directRate: 0.75, medianTimeMs: 1300, score: 75 },
  ]);
  assert.deepEqual(computeStudyReport(studyOf([buy]), [direct()]).tasks[0]!.byVariant, []);
});

test('screens: title from navigation events, top misclicks, and a sample to draw the background', () => {
  const a = session('s1', [
    nav(100, '/', 'Plantas para tu casa'), task(1000, 'start'),
    tap(3000, false, 100, { text: 'Envío gratis' }), tap(3500, false, 100, { text: 'Envío gratis' }), tap(4000, false, 100, { id: 'logo' }),
    tap(4500, true), nav(5000, '/producto.html', 'Monstera'), nav(9000, '/gracias.html', '¡Gracias!'), task(9500, 'done'),
  ]);
  const b = session('s2', [
    nav(100, '/', 'Plantas para tu casa'), task(2000, 'start'), tap(2500, false, 100, { tag: 'span', classes: ['brand', 'x'] }),
    nav(6000, '/producto.html', 'Echeveria'), nav(7000, '/producto.html?id=2', 'Monstera'), nav(8000, '/gracias.html'), task(8500, 'done'),
  ], { startedAt: 50 });
  const report = computeStudyReport(studyOf([buy]), [a, b]);
  const t = report.tasks[0]!;
  const [home, product, thanks] = t.screens;
  assert.equal(home!.title, 'Plantas para tu casa');
  assert.equal(product!.title, undefined, 'a title that changes from visit to visit is not the name of the screen');
  assert.equal(thanks!.title, '¡Gracias!');
  assert.deepEqual(report.screenNames, { '/index.html': 'Plantas para tu casa', '/producto.html': 'producto', '/gracias.html': '¡Gracias!' });
  // Con las pantallas conocidas del prototipo, el reporte usa esos nombres (los del constructor).
  const known = computeStudyReport(studyOf([buy]), [a, b], undefined, {
    screens: [{ id: '/producto.html', name: 'Producto · Verde' }, { id: '/index.html', label: 'inicio' } as { id: string }],
  });
  assert.deepEqual(known.screenNames, { '/index.html': 'inicio', '/producto.html': 'Producto · Verde', '/gracias.html': '¡Gracias!' });
  assert.equal(known.tasks[0]!.screens[1]!.title, 'Producto · Verde');
  assert.deepEqual(home!.topMisclicks, [
    { label: 'Envío gratis', count: 2 },
    { label: '#logo', count: 1 },
    { label: 'span.brand', count: 1 },
  ]);
  assert.equal(home!.misclicks, 4);
  // s1 es quien más tocó ahí: 50 ms antes de su ÚLTIMO toque en la pantalla.
  assert.deepEqual(home!.sample, { sessionId: 's1', t: 4450, vw: 390 });
  // Sin toques en la pantalla: 800 ms después de llegar.
  assert.deepEqual(product!.sample, { sessionId: 's1', t: 5800, vw: 390 });
  // Estuvo menos de 800 ms: justo antes de irse (aquí, el final de la tarea).
  assert.deepEqual(thanks!.sample, { sessionId: 's1', t: 9000, vw: 390 });
  assert.equal(home!.avgTimeMs, 4000);
  assert.equal(product!.visitors, 2);
  assert.deepEqual(t.results[1]!.pages, ['/index.html', '/producto.html', '/gracias.html'], 'a reload of the same screen is one visit');
});

test('screens: the sample comes from the most common screen width', () => {
  const run = (id: string, width: number, startedAt: number): ReportSession =>
    session(id, [nav(1, '/'), task(100, 'start'), tap(1000, true), nav(2000, '/gracias.html')], { viewport: { width, height: 800 }, startedAt });
  const t = computeStudyReport(studyOf([buy]), [run('desk', 1280, 1), run('p1', 390, 2), run('p2', 412, 3), run('p3', 390, 4)]).tasks[0]!;
  const home = t.screens[0]!;
  assert.equal(home.viewportWidth, 390);
  assert.deepEqual(home.sample, { sessionId: 'p1', t: 950, vw: 390 });
  assert.deepEqual(home.taps.map((p) => p.vw), [1280, 390, 412, 390]);
  assert.equal(home.taps.filter((p) => similarWidth(p.vw, home.sample!.vw)).length, 3, 'the panel draws these and says 1 was left out');
  assert.equal(similarWidth(468, 390), true);
  assert.equal(similarWidth(469, 390), false);
  assert.equal(similarWidth(312, 390), true);
});

test('heat points: width follows viewport events, and fixed taps carry their viewport position', () => {
  const a = session('s1', [
    viewport(1, 390, 664), nav(1, '/'), task(100, 'start'),
    tap(1000, true, 300), viewport(1500, 664, 390), tap(2000, true, 200),
    tap(3000, true, 350, {}, { fixed: true, vh: 390 }), tap(3500, true, 360, {}, { fixed: true }),
    nav(4000, '/gracias.html'),
  ], { viewport: { width: 0, height: 0 } });
  const points = computeStudyReport(studyOf([buy]), [a]).tasks[0]!.screens[0]!.taps;
  assert.deepEqual(points[0], { x: 10, y: 800, vw: 390, misclick: false, sessionId: 's1' });
  assert.deepEqual(points[1], { x: 10, y: 700, vw: 664, misclick: false, sessionId: 's1' });
  assert.deepEqual(points[2], { x: 10, y: 850, vw: 664, misclick: false, sessionId: 's1', fixed: true, vy: 350, vh: 390 });
  assert.equal(points[3]!.vh, 390, 'without vh in the event, the viewport height at that moment');
});

const questionStudy = studyOf([
  buy,
  { id: 'q1', kind: 'scale', question: '¿Qué tan fácil fue?', max: 5 },
  { id: 'q2', kind: 'choice', question: '¿Qué te faltó?', options: ['Precio', 'Fotos', 'Nada'], multiple: true },
  { id: 'q3', kind: 'yesno', question: '¿Lo usarías?' },
  { id: 'q4', kind: 'text', question: '¿Algo más?' },
  { id: 'c1', kind: 'context', title: 'Gracias', text: '' },
]);

test('question reports: average and distribution, options, yes/no and open answers', () => {
  const p1 = session('s1', [answer(10, 'q1', 5), answer(20, 'q2', ['Precio', 'Fotos']), answer(30, 'q3', true), answer(40, 'q4', ' Me gustó ')], { label: 'P1 · Ana', participant: 'ana' });
  const p2 = session('s2', [answer(10, 'q1', 2), answer(20, 'q2', 'Precio'), answer(30, 'q3', false), answer(40, 'q4', 'No encontré el carrito')], { participant: 'Beto' });
  const p3 = session('s3', [answer(10, 'q1', 4), answer(20, 'q2', null), answer(30, 'q3', true), answer(40, 'q4', '   ')]);
  const p4 = session('s4', [answer(10, 'q1', 9), answer(15, 'q1', null), answer(20, 'q2', ['Opción vieja'])]);
  const r = computeStudyReport(questionStudy, [p1, p2, p3, p4]);
  const [scale, choice, yesno, text] = r.questions;
  assert.deepEqual(scale, {
    blockId: 'q1', kind: 'scale', question: '¿Qué tan fácil fue?', responses: 3, skipped: 1, max: 5, average: 3.67,
    distribution: [{ label: '1', count: 0 }, { label: '2', count: 1 }, { label: '3', count: 0 }, { label: '4', count: 1 }, { label: '5', count: 1 }],
  });
  assert.deepEqual(choice, {
    blockId: 'q2', kind: 'choice', question: '¿Qué te faltó?', responses: 3, skipped: 1,
    distribution: [{ label: 'Precio', count: 2 }, { label: 'Fotos', count: 1 }, { label: 'Nada', count: 0 }, { label: 'Opción vieja', count: 1 }],
  });
  assert.deepEqual(yesno, {
    blockId: 'q3', kind: 'yesno', question: '¿Lo usarías?', responses: 3, skipped: 0,
    distribution: [{ label: 'Sí', count: 2 }, { label: 'No', count: 1 }],
  });
  assert.deepEqual(text, {
    blockId: 'q4', kind: 'text', question: '¿Algo más?', responses: 2, skipped: 1,
    texts: [{ sessionId: 's1', text: 'Me gustó', who: 'P1 · Ana' }, { sessionId: 's2', text: 'No encontré el carrito', who: 'Beto' }],
  });
});

test('question reports: out-of-range scale answers do not count, and nobody answering gives no average', () => {
  const odd = session('s1', [answer(10, 'q1', 0), answer(30, 'q3', 'sí')]);
  const half = session('s2', [answer(10, 'q1', 3.5)]);
  const r = computeStudyReport(questionStudy, [odd, half]);
  assert.equal(r.questions[0]!.responses, 0);
  assert.equal(r.questions[0]!.skipped, 2);
  assert.equal('average' in r.questions[0]!, false);
  assert.equal(r.questions[2]!.skipped, 1);
  assert.equal(r.questions[3]!.responses, 0);
  assert.deepEqual(r.questions[3]!.texts, []);
});

test('order lists every block of the study, with its kind', () => {
  const r = computeStudyReport(questionStudy, []);
  assert.deepEqual(r.order, [
    { blockId: 't1', kind: 'task' },
    { blockId: 'q1', kind: 'scale' },
    { blockId: 'q2', kind: 'choice' },
    { blockId: 'q3', kind: 'yesno' },
    { blockId: 'q4', kind: 'text' },
    { blockId: 'c1', kind: 'context' },
  ]);
  assert.deepEqual(r.tasks.map((t) => t.taskId), ['t1']);
  assert.deepEqual(r.questions.map((q) => q.blockId), ['q1', 'q2', 'q3', 'q4']);
});

test('an empty study report is well formed', () => {
  const r = computeStudyReport(study, []);
  assert.equal(r.participants, 0);
  assert.equal(r.completed, 0);
  assert.equal(r.score, null);
  assert.equal(r.successRate, 0);
  assert.equal(r.avgMisclickRate, 0);
  assert.equal(r.medianDurationMs, null);
  assert.equal(r.excluded, 0);
  assert.equal(r.pendingReview, 0);
  assert.deepEqual(r.insights, []);
  assert.deepEqual(r.tasks[0]!.outcomes, counts({}));
  assert.equal(r.tasks[0]!.score, null);
  assert.deepEqual(r.tasks[0]!.screens, []);
  assert.deepEqual(r.variants.map((v) => v.participants), [0, 0]);
});

test('completed counts who reached the end; the study numbers average the tasks with decided data', () => {
  const manual: TaskBlock = { id: 't2', title: 'Envío', instruction: '…', success: { type: 'manual' } };
  const s = studyOf([buy, manual]);
  const a = session('s1', [nav(1, '/'), task(2, 'start'), nav(3, '/gracias.html'), task(4, 'done'), task(5, 'start', 't2'), task(6, 'done', 't2'), finish(7)], { durationMs: 4000 });
  const b = session('s2', [nav(1, '/'), task(2, 'start'), task(4, 'skip')], { durationMs: 8000 });
  const r = computeStudyReport(s, [a, b]);
  assert.equal(r.completed, 1);
  assert.equal(r.medianDurationMs, 6000);
  assert.equal(r.successRate, 0.5, 'the manual task is still to review: it does not pull the average to 25 %');
  assert.equal(r.score, 50);
  assert.equal(r.pendingReview, 1);
});

test('a stored v1 study that was never normalized still gets a report', () => {
  const legacy = { v: 1, id: 'st_1', name: 'S', prototypeId: 'local', createdAt: 0, updatedAt: 0, tasks: [buy] } as unknown as StudyRecord;
  const r = computeStudyReport(legacy, [direct()]);
  assert.equal(r.tasks.length, 1);
  assert.deepEqual(r.tasks[0]!.outcomes, counts({ direct: 1 }));
  assert.deepEqual(r.order, [{ blockId: 't1', kind: 'task' }]);
});

// ── CSV ────────────────────────────────────────────────────────────────────────────

test('studyCsv: one row per participant, with tasks first and then questions', () => {
  const s = studyOf(
    [
      { ...buy, title: 'Comprar, rápido' },
      { id: 'q1', kind: 'scale', question: '¿Qué tan "fácil" fue?', max: 5 },
      { id: 't2', title: 'Envío', instruction: '…', success: { type: 'manual' } },
      { id: 'q2', kind: 'choice', question: '¿Qué te faltó?', options: ['Precio', 'Fotos'], multiple: true },
      { id: 'q3', kind: 'yesno', question: '¿Lo usarías?' },
      { id: 'q4', kind: 'text', question: '¿Algo más?' },
    ],
    { variants: [{ id: 'A', name: 'Con fotos' }] },
  );
  const p1 = session('s1', [
    nav(1, '/'), task(1000, 'start'), tap(2000, false), nav(13_400, '/gracias.html'), task(14_000, 'done'),
    answer(15_000, 'q1', 4), task(16_000, 'start', 't2'), task(20_000, 'done', 't2'),
    answer(21_000, 'q2', ['Precio', 'Fotos']), answer(22_000, 'q3', true), answer(23_000, 'q4', 'Bien,\n"todo" claro'),
  ], { label: 'P1 · Ana', variantId: 'A', startedAt: Date.UTC(2026, 10, 10, 15, 30), durationMs: 23_400, notes: 'Dudó en el envío, luego siguió' });
  const p2 = session('s2', [nav(1, '/'), task(1000, 'start'), task(5000, 'skip'), answer(6000, 'q1', null), answer(7000, 'q3', false), answer(8000, 'q4', '=1+1')], {
    participant: 'beto', deviceLabel: 'Android · Chrome 129', startedAt: Date.UTC(2026, 10, 11, 9, 0), durationMs: 8000,
  });
  const hidden = session('s3', [nav(1, '/')], { excluded: true });
  const csv = studyCsv(s, [p2, hidden, p1]);

  assert.equal(csv.charCodeAt(0), 0xfeff, 'UTF-8 BOM first');
  assert.equal(csv.endsWith('\r\n'), true);
  // Un salto de línea dentro de una celda entre comillas no parte la fila.
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.length, 4, 'header + 2 participants + the empty tail after the last CRLF');
  assert.equal(csv.slice(1).replace(/\r\n/g, '').includes('\r'), false);
  assert.equal(
    lines[0],
    'participante,sesión,fecha_utc,dispositivo,variante,duración_s,"Comprar, rápido · resultado","Comprar, rápido · tiempo_s","Comprar, rápido · misclicks",Envío · resultado,Envío · tiempo_s,Envío · misclicks,"¿Qué tan ""fácil"" fue?",¿Qué te faltó?,¿Lo usarías?,¿Algo más?,notas',
  );
  assert.equal(
    lines[1],
    'P1 · Ana,s1,2026-11-10T15:30:00.000Z,iPhone · Safari 18,Con fotos,23,éxito directo,12,1,por revisar,4,0,4,Precio | Fotos,Sí,"Bien,\n""todo"" claro","Dudó en el envío, luego siguió"',
  );
  assert.equal(
    lines[2],
    "beto,s2,2026-11-11T09:00:00.000Z,Android · Chrome 129,,8,no pudo,4,0,no empezó,,,,,No,'=1+1,",
  );
  // Sin etiqueta ni alias, el participante se nombra con el id corto de la sesión.
  const anon = studyCsv(s, [session('s_Ab3dEf9hJk', [task(1, 'start')], { startedAt: 0 }), session('s_bounced', [nav(1, '/')])]);
  const anonLines = anon.slice(1).trim().split('\r\n');
  assert.equal(anonLines.length, 2, 'who left without starting anything gets no row');
  assert.equal(anonLines[1]!.startsWith('Ef9hJk,s_Ab3dEf9hJk,1970-01-01T00:00:00.000Z,'), true);
  assert.equal(shortSessionId('s1'), 's1');
  assert.equal(shortSessionId('s_demo_estudio_1').length, 6
  );
});

test('studyCsv: every outcome has its Spanish label', () => {
  const s = studyOf([{ ...buy, expectedPath: ['/', '/gracias.html'] }]);
  const csv = studyCsv(s, [
    session('a', [nav(1, '/'), task(2, 'start'), nav(3, '/gracias.html'), task(4, 'done')], { startedAt: 1 }),
    session('b', [nav(1, '/'), task(2, 'start'), nav(3, '/producto.html'), nav(4, '/gracias.html')], { startedAt: 2 }),
    session('c', [nav(1, '/'), task(2, 'start'), task(4, 'done')], { startedAt: 3 }),
    session('d', [nav(1, '/'), task(2, 'start'), task(4, 'skip')], { startedAt: 4 }),
    session('e', [nav(1, '/'), task(2, 'start')], { startedAt: 5 }),
  ]);
  const outcome = csv.slice(1).trim().split('\r\n').slice(1).map((line) => line.split(',')[6]);
  assert.deepEqual(outcome, ['éxito directo', 'éxito indirecto', 'dijo que terminó', 'no pudo', 'sin terminar']);
});

test('every outcome has a label for the panel, the same words the CSV uses', () => {
  assert.deepEqual(Object.keys(OUTCOME_LABELS).sort(), Object.keys(counts({})).sort());
  assert.equal(OUTCOME_LABELS.review, 'Por revisar');
  assert.equal(OUTCOME_LABELS.direct, 'Éxito directo');
});

test('studyCsv of a study without sessions is just the header', () => {
  assert.equal(studyCsv(studyOf([buy]), []), '﻿participante,sesión,fecha_utc,dispositivo,variante,duración_s,Comprar · resultado,Comprar · tiempo_s,Comprar · misclicks,notas\r\n');
});

// ── Ronda de QA 1 ──────────────────────────────────────────────────────────────────

test('inferred expected path: the most common one from the start screen, stable when a session goes away', () => {
  const via = (id: string, startedAt: number, ...mid: string[]): ReportSession =>
    session(id, [nav(1, '/'), task(2, 'start'), ...mid.map((p, i) => nav(3 + i, p)), nav(8, '/gracias.html'), task(9, 'done')], { startedAt });
  // Uno encontró un atajo; otro empezó en otra pantalla (venía de la tarea anterior).
  const shortcut = via('s1', 1);
  const elsewhere = session('s0', [nav(1, '/ayuda.html'), task(2, 'start'), nav(8, '/gracias.html'), task(9, 'done')], { startedAt: 0 });
  const usual = [via('s2', 2, '/producto.html'), via('s3', 3, '/producto.html'), via('s4', 4, '/producto.html')];
  const all = computeStudyReport(studyOf([buy]), [elsewhere, shortcut, ...usual]).tasks[0]!;
  assert.deepEqual(all.expectedPath, ['/index.html', '/producto.html', '/gracias.html'], 'not the shortest: the most common');
  assert.equal(all.expectedPathInferred, true);
  const outcomes = (sessions: ReportSession[]): Record<string, string> =>
    Object.fromEntries(computeStudyReport(studyOf([buy]), sessions).tasks[0]!.results.map((r) => [r.sessionId, r.outcome]));
  assert.deepEqual(outcomes([elsewhere, shortcut, ...usual]), { s0: 'indirect', s1: 'indirect', s2: 'direct', s3: 'direct', s4: 'direct' });
  // Excluir a uno de los directos no cambia quién es directo.
  const without = [elsewhere, shortcut, { ...usual[0]!, session: { ...usual[0]!.session, excluded: true } }, usual[1]!, usual[2]!];
  assert.deepEqual(outcomes(without), { s0: 'indirect', s1: 'indirect', s3: 'direct', s4: 'direct' });
  // Empate en cantidad: gana el más corto.
  const tie = computeStudyReport(studyOf([buy]), [shortcut, usual[0]!]).tasks[0]!;
  assert.deepEqual(tie.expectedPath, ['/index.html', '/gracias.html']);
  // Nadie lo logró desde la pantalla de inicio: no hay camino que deducir.
  const none = computeStudyReport(studyOf([{ ...buy, startPath: '/index.html' }]), [elsewhere]).tasks[0]!;
  assert.deepEqual(none.expectedPath, []);
});

test('funnel: starts at the start screen with everyone who started the task', () => {
  // El diseñador escribió el camino sin la pantalla de inicio.
  const s = studyOf([{ ...buy, expectedPath: ['/producto.html', '/gracias.html'] }]);
  const t = computeStudyReport(s, [direct(), indirect(), failed()]).tasks[0]!;
  assert.deepEqual(t.expectedPath, ['/index.html', '/producto.html', '/gracias.html']);
  assert.equal(t.expectedPathInferred, false);
  assert.deepEqual(t.funnel, [
    { path: '/index.html', reached: 3 },
    { path: '/producto.html', reached: 3 },
    { path: '/gracias.html', reached: 2 },
  ]);
  assert.equal(t.funnel[0]!.reached, t.participants);
  assert.deepEqual(t.outcomes, counts({ direct: 1, indirect: 1, failed: 1 }));
  // Con startPath, el primer paso es esa pantalla aunque alguien no haya llegado a ella.
  const jump = studyOf([{ ...buy, startPath: '/producto.html', expectedPath: ['/gracias.html'] }]);
  const lost = session('s9', [nav(1, '/'), task(2, 'start'), task(3, 'skip')]);
  const ok = session('s8', [nav(1, '/'), task(2, 'start'), nav(3, '/producto.html'), nav(4, '/gracias.html'), task(5, 'done')]);
  const j = computeStudyReport(jump, [ok, lost]).tasks[0]!;
  assert.deepEqual(j.funnel, [{ path: '/producto.html', reached: 2 }, { path: '/gracias.html', reached: 1 }]);
  assert.deepEqual(j.results.map((r) => r.outcome), ['direct', 'failed']);
});

test('heatmap sample: who tapped the most on the screen, right before their last tap there', () => {
  const few = session('s1', [nav(1000, '/carrito.html'), task(1100, 'start'), tap(2000, true), nav(3000, '/gracias.html')], { startedAt: 1 });
  const many = session('s2', [nav(1000, '/carrito.html'), task(1100, 'start'), tap(2000, true), tap(4000, true), tap(9000, true), nav(9500, '/gracias.html')], { startedAt: 2 });
  const s = studyOf([{ ...buy, startPath: '/carrito.html' }]);
  const cart = computeStudyReport(s, [few, many]).tasks[0]!.screens[0]!;
  assert.deepEqual(cart.sample, { sessionId: 's2', t: 8950, vw: 390 });
  // Sesión antigua con visitas de 0 ms: el instante nunca queda pegado a la llegada si el toque vino después.
  const old = session('s3', [nav(1000, '/'), nav(5000, '/carrito.html'), nav(5000, '/'), nav(5000, '/carrito.html'), task(5000, 'start'), tap(5020, true), nav(7000, '/gracias.html')]);
  const sample = computeStudyReport(s, [old]).tasks[0]!.screens[0]!.sample!;
  assert.equal(sample.t, 5020, 'never after the tap itself');
  const late = session('s4', [nav(1000, '/carrito.html'), task(1000, 'start'), tap(1120, true), nav(7000, '/gracias.html')]);
  assert.equal(computeStudyReport(s, [late]).tasks[0]!.screens[0]!.sample!.t, 1100, 'at least 100 ms after arriving, when the full snapshot exists');
});

test('study success rate is pooled over decided attempts, not the mean of the task rates', () => {
  const second: TaskBlock = { id: 't2', title: 'Volver', instruction: '…', success: { type: 'reached', path: '/index.html' } };
  const s = studyOf([buy, second], { variants: [{ id: 'A', name: 'A' }] });
  const both = (id: string): ReportSession =>
    session(id, [nav(1, '/'), task(2, 'start'), nav(3, '/gracias.html'), task(4, 'done'), task(5, 'start', 't2'), task(6, 'skip', 't2')], { variantId: 'A' });
  const onlyFirst = (id: string): ReportSession => session(id, [nav(1, '/'), task(2, 'start'), nav(3, '/gracias.html'), task(4, 'done')], { variantId: 'A' });
  // Tarea 1: 4 de 4. Tarea 2: 0 de 1. Promedio de tasas = 50 %; sobre los intentos = 4 de 5.
  const r = computeStudyReport(s, [both('a'), onlyFirst('b'), onlyFirst('c'), onlyFirst('d')]);
  assert.deepEqual(r.tasks.map((t) => t.successRate), [1, 0]);
  assert.equal(r.successRate, 4 / 5);
  assert.equal(r.variants[0]!.successRate, 4 / 5);
});
