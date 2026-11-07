import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Study, TaptanaEvent } from '@taptana/shared';
import { computeTaskResults, samePath } from './results.js';

const study: Study = {
  v: 1,
  name: 'Compra',
  prototypeId: 'local',
  tasks: [
    { id: 't1', title: 'Comprar', instruction: '…', success: { type: 'reached', path: '/gracias.html' } },
    { id: 't2', title: 'Carrito', instruction: '…', success: { type: 'tapped', selector: '.cart-link' } },
    { id: 't3', title: 'Envío', instruction: '…', success: { type: 'manual' } },
    { id: 't4', kind: 'first-click', title: 'Primer toque', instruction: '…', success: { type: 'tapped', selector: '#agregar' } },
  ],
};

const tap = (t: number, selector: string, id?: string): TaptanaEvent => ({
  kind: 'taptana',
  type: 'tap',
  t,
  x: 10,
  y: 20,
  target: { tag: 'a', selector, ...(id ? { id } : {}) },
});
const nav = (t: number, to: string): TaptanaEvent => ({ kind: 'taptana', type: 'navigation', t, from: '', to });
const task = (t: number, taskId: string, action: 'start' | 'done' | 'skip'): TaptanaEvent => ({ kind: 'taptana', type: 'task', t, taskId, action });

test('samePath ignores query, trailing slash and index.html', () => {
  assert.equal(samePath('/gracias.html?x=1', '/gracias.html'), true);
  assert.equal(samePath('/', '/index.html'), true);
  assert.equal(samePath('/a/', '/a'), true);
  assert.equal(samePath('/a', '/b'), false);
});

test('reached rule succeeds even if the participant never tapped Listo', () => {
  const events = [task(100, 't1', 'start'), nav(200, '/carrito.html'), nav(300, '/gracias.html?ok'), task(400, 't2', 'start')];
  const [t1] = computeTaskResults(study, events);
  assert.equal(t1?.outcome, 'success');
  assert.equal(t1?.ruleMatched, true);
  assert.equal(t1?.durationMs, 200);
  assert.equal(t1?.reported, null);
});

test('done without rule match is "reported", skip is "failed", never started is "pending"', () => {
  const events = [task(100, 't1', 'start'), task(500, 't1', 'done'), task(600, 't2', 'start'), task(900, 't2', 'skip')];
  const [t1, t2, t3] = computeTaskResults(study, events);
  assert.equal(t1?.outcome, 'reported');
  assert.equal(t1?.durationMs, 400);
  assert.equal(t2?.outcome, 'failed');
  assert.equal(t2?.reported, 'skip');
  assert.equal(t3?.outcome, 'pending');
});

test('tapped rule matches by selector, id or last segment', () => {
  const events = [task(100, 't2', 'start'), tap(150, 'header > a.x'), tap(200, 'header > .cart-link'), task(300, 't2', 'done')];
  const [, t2] = computeTaskResults(study, events);
  assert.equal(t2?.outcome, 'success');
  assert.equal(t2?.durationMs, 100);
});

test('manual marks override everything; incomplete when the session ends mid-task', () => {
  const events = [task(100, 't3', 'start'), tap(200, 'a')];
  const [, , t3] = computeTaskResults(study, events, {}, 1000);
  assert.equal(t3?.outcome, 'incomplete');
  const [, , t3b] = computeTaskResults(study, events, { t3: 'success' }, 1000);
  assert.equal(t3b?.outcome, 'success');
  const [t1] = computeTaskResults(study, [task(100, 't1', 'start'), nav(200, '/gracias.html')], { t1: 'failure' });
  assert.equal(t1?.outcome, 'failed');
});

test('first-click ends at the first tap and records it', () => {
  const events = [task(100, 't4', 'start'), tap(250, 'main > button#agregar', 'agregar'), tap(400, 'a'), task(900, 't4', 'done')];
  const [, , , t4] = computeTaskResults(study, events);
  assert.equal(t4?.outcome, 'success');
  assert.equal(t4?.endedAt, 250);
  assert.equal(t4?.firstTap?.x, 10);
  const miss = computeTaskResults(study, [task(100, 't4', 'start'), tap(250, 'a.other')]);
  assert.equal(miss[3]?.outcome, 'reported');
});
