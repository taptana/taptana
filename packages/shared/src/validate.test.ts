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
