import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchesToExport } from './batches.js';
import type { EventBatch } from './api.js';
import type { TaptanaEvent } from './events.js';

const device = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  screen: { width: 390, height: 844 },
  viewport: { width: 390, height: 664 },
  dpr: 3,
  touch: true,
  language: 'es-PE',
};

const nav = (t: number, to: string): TaptanaEvent => ({ kind: 'taptana', type: 'navigation', t, from: '', to });
const tap = (t: number): TaptanaEvent => ({ kind: 'taptana', type: 'tap', t, x: 1, y: 2, target: { tag: 'a', selector: 'a' } });

function batch(pageId: string, seq: number, events: TaptanaEvent[], path?: string): EventBatch {
  const b: EventBatch = { v: 1, prototypeId: 'local', sessionId: 's_1', pageId, seq, sentAt: 5000, events };
  if (path !== undefined) {
    b.page = { path, title: 'Página', referrer: '', startedAt: events[0]?.t ?? 0 };
    b.device = device;
  }
  return b;
}

test('no batches, no export', () => {
  assert.equal(batchesToExport([]), null);
});

test('builds the session summary from the batches', () => {
  const out = batchesToExport([
    batch('p_1', 0, [nav(1000, '/'), tap(1500)], '/'),
    batch('p_2', 0, [nav(2000, '/producto.html?id=*'), tap(2500)], '/producto.html?id=*'),
    batch('p_3', 0, [nav(3000, '/index.html'), tap(4000)], '/index.html'),
  ]);
  assert.ok(out);
  assert.equal(out.v, 1);
  assert.equal(out.session.id, 's_1');
  assert.equal(out.session.startedAt, 1000);
  assert.equal(out.session.lastSeenAt, 4000);
  assert.equal(out.session.durationMs, 3000);
  assert.equal(out.session.deviceLabel, 'iPhone · Safari 18');
  assert.equal(out.session.touch, true);
  assert.equal(out.session.entryPath, '/');
  assert.equal(out.session.tapCount, 3);
  assert.equal(out.session.pageCount, 3, 'three page loads');
  assert.equal(out.session.screenCount, 2, 'but only two different screens');
  assert.equal(out.pages.length, 3);
  assert.equal('studyId' in out.session, false);
  assert.equal('participant' in out.session, false);
});

test('fills study, variant and participant from the study start event', () => {
  const out = batchesToExport([
    batch('p_1', 0, [nav(1000, '/')], '/'),
    batch('p_1', 1, [
      { kind: 'taptana', type: 'study', t: 1200, studyId: 'st_1', variantId: 'B', action: 'start', participant: ' Ana ' },
      { kind: 'taptana', type: 'task', t: 1300, taskId: 't1', action: 'start' },
    ]),
    batch('p_1', 2, [{ kind: 'taptana', type: 'study', t: 9000, studyId: 'st_1', action: 'finish' }]),
  ]);
  assert.ok(out);
  assert.equal(out.session.studyId, 'st_1');
  assert.equal(out.session.variantId, 'B');
  assert.equal(out.session.participant, 'Ana');
});

test('a batch stored twice counts once, and events come out in time order', () => {
  const first = batch('p_1', 0, [nav(1000, '/'), tap(3000)], '/');
  const second = batch('p_1', 1, [tap(2000)]);
  const out = batchesToExport([first, second, second, first]);
  assert.ok(out);
  assert.deepEqual(out.events.map((e) => e.t), [1000, 2000, 3000]);
  assert.equal(out.session.tapCount, 2);
});
