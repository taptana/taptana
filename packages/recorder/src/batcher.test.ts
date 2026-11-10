import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_MAX_BYTES, type EventBatch, type TaptanaEvent } from '@taptana/shared';
import { Batcher, backoffMs, chunkBySize, utf8Length } from './batcher.js';
import type { SendResult, Transport, Wire } from './transport.js';

// El Batcher usa los temporizadores de `window`.
(globalThis as { window?: unknown }).window ??= globalThis;

const own = (n: number): TaptanaEvent => ({ kind: 'taptana', type: 'scroll', t: n, x: 0, y: n, depth: 0 });
const heavy = (n: number, size = 10): TaptanaEvent => ({ kind: 'rrweb', t: n, data: { n, pad: 'x'.repeat(size) } });

function setup(respond: (batch: EventBatch, wire: Wire) => SendResult) {
  const delivered: EventBatch[] = [];
  const attempts: Wire[] = [];
  const transport: Transport = {
    async send(wire) {
      attempts.push(wire);
      const batch = JSON.parse(wire.json) as EventBatch;
      const result = respond(batch, wire);
      if (result === 'ok') delivered.push(batch);
      return result;
    },
  };
  const batcher = new Batcher({
    transport,
    prototypeId: 'local',
    sessionId: 's_1',
    pageId: 'p_1',
    page: { path: '/', title: '', referrer: '', startedAt: 1 },
    device: { userAgent: 'x', screen: { width: 1, height: 1 }, viewport: { width: 1, height: 1 }, dpr: 1, touch: true, language: 'es' },
  });
  return { batcher, delivered, attempts };
}

const allEvents = (batches: EventBatch[]): TaptanaEvent[] => batches.flatMap((b) => b.events);
const seqs = (batches: EventBatch[]): number[] => batches.map((b) => b.seq);

test('utf8Length cuenta bytes, no caracteres', () => {
  assert.equal(utf8Length('abc'), 3);
  assert.equal(utf8Length('ñ'), 2);
  assert.equal(utf8Length('€'), 3);
});

test('chunkBySize reparte sin pasar del tope y deja solo al que no cabe', () => {
  assert.deepEqual(chunkBySize([], 10), []);
  assert.deepEqual(chunkBySize([4, 4, 4], 10), [[0, 2], [2, 3]]);
  assert.deepEqual(chunkBySize([20, 1, 1], 10), [[0, 1], [1, 3]]);
  assert.deepEqual(chunkBySize([1, 20, 1], 10), [[0, 1], [1, 2], [2, 3]]);
});

test('backoffMs crece hasta 30 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(backoffMs), [0, 1000, 2000, 4000, 8000]);
  assert.equal(backoffMs(40), 30_000);
});

test('los eventos propios viajan primero y solo el primer lote lleva page y device', async () => {
  const { batcher, delivered } = setup(() => 'ok');
  batcher.push(heavy(1));
  batcher.push(own(2));
  batcher.push(heavy(3));
  await batcher.flush();
  batcher.stop();
  assert.deepEqual(seqs(delivered), [0, 1]);
  assert.equal(delivered[0]?.events[0]?.kind, 'taptana');
  assert.ok(delivered[0]?.page && delivered[0]?.device);
  assert.equal(delivered[1]?.page, undefined);
  assert.equal(allEvents(delivered).length, 3);
});

test('parte por tamaño y cada trozo tiene su seq', async () => {
  const { batcher, delivered, attempts } = setup(() => 'ok');
  for (let i = 0; i < 5; i++) batcher.push(heavy(i, 200_000));
  await batcher.flush();
  batcher.stop();
  assert.equal(allEvents(delivered).length, 5);
  assert.deepEqual(seqs(delivered), [0, 1, 2]);
  for (const wire of attempts) assert.ok(utf8Length(wire.json) <= BATCH_MAX_BYTES);
});

test('sin red reintenta con el mismo seq: nada se pierde ni se duplica', async () => {
  let online = false;
  const { batcher, delivered, attempts } = setup(() => (online ? 'ok' : 'retry'));
  batcher.push(own(1));
  await batcher.flush();
  batcher.push(own(2));
  batcher.push(heavy(3));
  batcher.retryNow();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(delivered.length, 0);
  assert.equal(batcher.pending, 3);
  online = true;
  batcher.retryNow();
  await batcher.flush();
  batcher.stop();
  assert.ok(attempts.length > delivered.length);
  assert.deepEqual(seqs(delivered), [0, 1, 2]);
  assert.deepEqual(allEvents(delivered).map((e) => e.t), [1, 2, 3]);
  assert.equal(batcher.pending, 0);
});

test('un evento que el servidor rechaza se aísla y se descarta; el resto llega una vez', async () => {
  const { batcher, delivered } = setup((batch) => (batch.events.some((e) => e.t === 3) ? 'reject' : 'ok'));
  for (let i = 0; i < 6; i++) batcher.push(heavy(i));
  await batcher.flush();
  batcher.stop();
  const got = allEvents(delivered).map((e) => e.t).sort();
  assert.deepEqual(got, [0, 1, 2, 4, 5]);
  assert.equal(new Set(seqs(delivered)).size, delivered.length);
  // `page` y `device` llegan con algún lote aunque el primero se haya partido.
  assert.ok(delivered.some((b) => b.page));
  assert.equal(batcher.pending, 0);
});

test('close entrega lo pendiente y deja de aceptar eventos', async () => {
  const { batcher, delivered } = setup(() => 'ok');
  batcher.push(own(1));
  batcher.close();
  batcher.push(own(2));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(allEvents(delivered).map((e) => e.t), [1]);
});
