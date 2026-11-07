import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEventBatch } from './validate.js';

const good = {
  v: 1,
  prototypeId: 'local',
  sessionId: 's_1',
  pageId: 'p_1',
  seq: 0,
  sentAt: 1,
  events: [
    { kind: 'rrweb', t: 1, data: { type: 4 } },
    { kind: 'taptana', type: 'tap', t: 2, x: 1, y: 2, target: { tag: 'a', selector: 'a' } },
  ],
};

test('accepts a well formed batch', () => {
  const result = validateEventBatch(good);
  assert.equal(result.ok, true);
});

test('rejects a batch without session id', () => {
  const result = validateEventBatch({ ...good, sessionId: '' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /sessionId/);
});

test('rejects a malformed event', () => {
  const result = validateEventBatch({ ...good, events: [{ kind: 'nope', t: 1 }] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /events\[0\]/);
});

test('rejects unknown versions', () => {
  const result = validateEventBatch({ ...good, v: 2 });
  assert.equal(result.ok, false);
});

import { validateStudy } from './validate.js';

const study = {
  v: 1,
  name: 'Compra',
  prototypeId: 'local',
  tasks: [
    { id: 't1', title: 'Comprar', instruction: 'Compra una planta', success: { type: 'reached', path: '/gracias.html' } },
    { id: 't2', kind: 'first-click', title: 'Carrito', instruction: '¿Dónde tocarías para ver el carrito?', success: { type: 'tapped', selector: '.cart-link' } },
  ],
};

test('accepts a valid study', () => {
  assert.equal(validateStudy(study).ok, true);
});

test('rejects a study with duplicated task ids or bad rules', () => {
  const dup = validateStudy({ ...study, tasks: [study.tasks[0], study.tasks[0]] });
  assert.equal(dup.ok, false);
  const bad = validateStudy({ ...study, tasks: [{ ...study.tasks[0], success: { type: 'reached' } }] });
  assert.equal(bad.ok, false);
  const empty = validateStudy({ ...study, tasks: [] });
  assert.equal(empty.ok, false);
});
