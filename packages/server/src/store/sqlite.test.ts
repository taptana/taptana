import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EventBatch } from '@taptana/shared';
import { SqliteStore } from './sqlite.js';

const device = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
  screen: { width: 390, height: 844 },
  viewport: { width: 390, height: 664 },
  dpr: 3,
  touch: true,
  language: 'es-PE',
};

function batch(partial: Partial<EventBatch>): EventBatch {
  return {
    v: 1,
    prototypeId: 'local',
    sessionId: 's_1',
    pageId: 'p_1',
    seq: 0,
    sentAt: 1000,
    events: [],
    ...partial,
  };
}

test('ingests batches and lists the session', () => {
  const store = new SqliteStore(':memory:');
  store.ingestBatch(
    batch({
      page: { path: '/index.html', title: 'Home', referrer: '', startedAt: 1000 },
      device,
      events: [
        { kind: 'rrweb', t: 1000, data: { type: 4 } },
        { kind: 'taptana', type: 'tap', t: 1500, x: 1, y: 1, target: { tag: 'a', selector: 'a' } },
      ],
    }),
  );
  store.ingestBatch(
    batch({
      pageId: 'p_2',
      seq: 0,
      sentAt: 5000,
      page: { path: '/producto.html', title: 'Producto', referrer: '', startedAt: 4000 },
      events: [{ kind: 'taptana', type: 'tap', t: 4500, x: 1, y: 1, target: { tag: 'a', selector: 'a' } }],
    }),
  );

  const sessions = store.listSessions();
  assert.equal(sessions.length, 1);
  const s = sessions[0]!;
  assert.equal(s.deviceLabel, 'iPhone · Safari 18');
  assert.equal(s.pageCount, 2);
  assert.equal(s.tapCount, 2);
  assert.equal(s.durationMs, 3500);
  assert.equal(s.entryPath, '/index.html');

  const full = store.getSessionEvents('s_1');
  assert.ok(full);
  assert.equal(full.events.length, 3);
  assert.equal(full.pages.length, 2);
  store.close();
});

test('fills device info when it arrives in a later batch', () => {
  const store = new SqliteStore(':memory:');
  store.ingestBatch(batch({ seq: 1, events: [{ kind: 'rrweb', t: 2000, data: {} }] }));
  store.ingestBatch(batch({ seq: 0, device, page: { path: '/a', title: 'A', referrer: '', startedAt: 1000 }, events: [{ kind: 'rrweb', t: 1000, data: {} }] }));
  const s = store.getSession('s_1');
  assert.ok(s);
  assert.equal(s.touch, true);
  assert.equal(s.startedAt, 1000);
  assert.equal(s.lastSeenAt, 2000);
  store.close();
});

test('imports, exports and deletes a session', () => {
  const store = new SqliteStore(':memory:');
  store.importSession({
    v: 1,
    exportedAt: 1,
    session: {
      id: 's_x',
      prototypeId: 'local',
      startedAt: 10,
      lastSeenAt: 50,
      durationMs: 40,
      deviceLabel: 'Android · Chrome 129',
      viewport: { width: 400, height: 800 },
      touch: true,
      entryPath: '/',
      pageCount: 1,
      tapCount: 1,
    },
    pages: [{ id: 'pg', path: '/', title: 'Home', referrer: '', startedAt: 10 }],
    events: [
      { kind: 'rrweb', t: 10, data: {} },
      { kind: 'taptana', type: 'tap', t: 20, x: 0, y: 0, target: { tag: 'a', selector: 'a' } },
    ],
  });
  const s = store.getSession('s_x');
  assert.ok(s);
  assert.equal(s.tapCount, 1);
  assert.equal(store.deleteSession('s_x'), true);
  assert.equal(store.getSession('s_x'), null);
  assert.equal(store.getSessionEvents('s_x'), null);
  store.close();
});
