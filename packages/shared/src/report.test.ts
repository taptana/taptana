import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStudyReport, screenPath, type ReportSession } from './report.js';
import type { StudyRecord, TaptanaEvent } from './index.js';

const study: StudyRecord = {
  v: 1, id: 'st_1', name: 'S', prototypeId: 'local', createdAt: 0, updatedAt: 0,
  tasks: [{ id: 't1', title: 'Comprar', instruction: '…', success: { type: 'reached', path: '/gracias.html' } }],
  variants: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }],
};

const nav = (t: number, to: string): TaptanaEvent => ({ kind: 'taptana', type: 'navigation', t, from: '', to });
const tap = (t: number, interactive: boolean, y = 100): TaptanaEvent => ({
  kind: 'taptana', type: 'tap', t, x: 10, y, pageX: 10, pageY: y + 500, target: { tag: interactive ? 'a' : 'div', selector: 'x', interactive },
});
const task = (t: number, action: 'start' | 'done' | 'skip'): TaptanaEvent => ({ kind: 'taptana', type: 'task', t, taskId: 't1', action });

function session(id: string, variantId: string, events: TaptanaEvent[]): ReportSession {
  return {
    session: {
      id, prototypeId: 'local', startedAt: 0, lastSeenAt: 10_000, durationMs: 10_000, deviceLabel: 'x',
      viewport: { width: 390, height: 700 }, touch: true, entryPath: '/', pageCount: 3, tapCount: 3, studyId: 'st_1', variantId,
    },
    events: [{ kind: 'taptana', type: 'study', t: 0, studyId: 'st_1', action: 'start' }, ...events],
  };
}

test('screenPath normalizes query and index', () => {
  assert.equal(screenPath('/'), '/index.html');
  assert.equal(screenPath('/producto.html?id=3'), '/producto.html');
  assert.equal(screenPath('/a/'), '/a/index.html');
});

test('direct vs indirect success, funnel, misclicks, screens and variants', () => {
  const direct = session('s1', 'A', [nav(1, '/'), task(2, 'start'), tap(3, true), nav(4, '/producto.html?id=1'), tap(5, true), nav(6, '/gracias.html'), task(7, 'done')]);
  const indirect = session('s2', 'A', [nav(1, '/'), task(2, 'start'), tap(3, false), nav(4, '/carrito.html'), nav(5, '/producto.html'), tap(6, true), nav(7, '/gracias.html'), task(8, 'done')]);
  const failed = session('s3', 'B', [nav(1, '/'), task(2, 'start'), tap(3, false), tap(4, false), nav(5, '/producto.html'), task(9, 'skip')]);
  const r = computeStudyReport(study, [direct, indirect, failed]);
  const t = r.tasks[0]!;
  assert.equal(r.participants, 3);
  assert.deepEqual(t.outcomes, { direct: 1, indirect: 1, reported: 0, failed: 1, incomplete: 0 });
  assert.equal(t.expectedPathInferred, true);
  assert.deepEqual(t.expectedPath, ['/index.html', '/producto.html', '/gracias.html']);
  assert.deepEqual(t.funnel.map((f) => f.reached), [3, 3, 2]);
  assert.equal(t.avgMisclicks, 1);
  assert.equal(t.misclickRate, 3 / 6);
  const home = t.screens.find((s) => s.path === '/index.html')!;
  assert.equal(home.visitors, 3);
  assert.equal(home.taps.length, 4);
  assert.equal(home.misclicks, 3);
  assert.equal(home.taps[0]!.y, 600);
  assert.equal(t.paths[0]!.count, 1);
  assert.equal(r.variants.find((v) => v.id === 'A')!.successRate, 1);
  assert.equal(r.variants.find((v) => v.id === 'B')!.successRate, 0);
});

test('explicit expected path makes a detour indirect', () => {
  const s = { ...study, tasks: [{ ...study.tasks[0]!, expectedPath: ['/', '/carrito.html', '/gracias.html'] }] };
  const a = session('s1', 'A', [nav(1, '/'), task(2, 'start'), nav(4, '/producto.html'), nav(6, '/gracias.html')]);
  const r = computeStudyReport(s, [a]);
  assert.equal(r.tasks[0]!.expectedPathInferred, false);
  assert.equal(r.tasks[0]!.outcomes.indirect, 1);
  assert.deepEqual(r.tasks[0]!.funnel.map((f) => f.reached), [1, 0, 0]);
});

test('first click: start page comes from startPath and a wrong tap is a failure', () => {
  const s: StudyRecord = { ...study, tasks: [{ id: 't1', kind: 'first-click', title: 'Carrito', instruction: '…', startPath: '/index.html', success: { type: 'tapped', selector: '.cart' } }] };
  const wrong = session('s1', 'A', [nav(1, '/gracias.html'), task(2, 'start'), nav(3, '/index.html'), tap(4, false)]);
  const r = computeStudyReport(s, [wrong]);
  assert.equal(r.tasks[0]!.outcomes.failed, 1);
  assert.deepEqual(r.tasks[0]!.results[0]!.pages, ['/index.html']);
});
