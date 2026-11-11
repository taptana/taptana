import test from 'node:test';
import assert from 'node:assert/strict';
import type { HeatPoint } from '@taptana/shared';
import { arrangePeople, biggestDrop, fallbackHeight, funnelSteps, placePoints, recordingOffset, ruleSelector, ruleText, samePages, scoreBand } from './logic.ts';

const pt = (p: Partial<HeatPoint>): HeatPoint => ({ x: 100, y: 200, vw: 390, misclick: false, sessionId: 's1', ...p });

test('scoreBand separa las franjas', () => {
  assert.equal(scoreBand(null).tone, 'none');
  assert.equal(scoreBand(100).tone, 'good');
  assert.equal(scoreBand(80).tone, 'good');
  assert.equal(scoreBand(79).tone, 'ok');
  assert.equal(scoreBand(59).tone, 'warn');
  assert.equal(scoreBand(39).tone, 'bad');
  assert.equal(scoreBand(0).tone, 'bad');
});

test('placePoints escala X por el ancho y deja Y igual', () => {
  const { shown, left } = placePoints([pt({ x: 180, y: 900, vw: 360 })], 390, 1500);
  assert.equal(left, 0);
  assert.equal(shown[0]!.x, 195);
  assert.equal(shown[0]!.y, 900);
});

test('placePoints deja fuera pantallas de ancho distinto y las cuenta', () => {
  const { shown, left } = placePoints([pt({}), pt({ vw: 1280, x: 900 }), pt({ vw: 320 })], 390, 1000);
  assert.equal(shown.length, 2);
  assert.equal(left, 1);
});

test('placePoints ancla los toques fijos al borde que les toca', () => {
  const bottom = pt({ fixed: true, vy: 800, vh: 844, y: 2300 });
  const top = pt({ fixed: true, vy: 30, vh: 844, y: 1500 });
  const { shown } = placePoints([bottom, top], 390, 2000);
  assert.equal(shown[0]!.y, 2000 - 44);
  assert.equal(shown[1]!.y, 30);
});

test('placePoints no saca puntos de la foto', () => {
  const { shown } = placePoints([pt({ y: 5000, x: 800 })], 390, 1000);
  assert.equal(shown[0]!.y, 1000);
  assert.equal(shown[0]!.x, 390);
});

test('fallbackHeight da espacio a todos los toques', () => {
  assert.equal(fallbackHeight([], 390), 741);
  assert.equal(fallbackHeight([pt({ y: 1200 })], 390), 1240);
  assert.equal(fallbackHeight([pt({ y: 99999 })], 390), 6000);
});

test('funnelSteps explica la caída en palabras', () => {
  const name = (p: string): string => p.replace(/^\/|\.html$/g, '');
  const steps = funnelSteps(
    [
      { path: '/index.html', reached: 6 },
      { path: '/producto.html', reached: 5 },
      { path: '/carrito.html', reached: 3 },
    ],
    6,
    name,
  );
  assert.deepEqual(
    steps.map((s) => s.lost),
    [0, 1, 2],
  );
  assert.equal(steps[0]!.note, '');
  assert.equal(steps[1]!.note, '1 persona no llegó a «producto» desde «index»');
  assert.equal(steps[2]!.note, '2 personas no llegaron a «carrito» desde «producto»');
  assert.equal(steps[2]!.rate, 0.5);
  assert.equal(biggestDrop(steps), 2);
  assert.equal(biggestDrop(steps.slice(0, 1)), -1);
});

test('funnelSteps sin participantes no divide por cero', () => {
  assert.equal(funnelSteps([{ path: '/a', reached: 0 }], 0, (p) => p)[0]!.rate, 0);
});

test('ruleText dice la regla en palabras', () => {
  const name = (p: string): string => p;
  assert.match(ruleText({ type: 'reached', path: 'gracias' }, name), /llegar a «gracias»/);
  assert.match(ruleText({ type: 'tapped', selector: '.cart-link' }, name, '🛒'), /tocar «🛒»/);
  assert.doesNotMatch(ruleText({ type: 'tapped', selector: '#pagar' }, name), /#pagar/);
  assert.equal(ruleSelector({ type: 'tapped', selector: '#pagar' }), '#pagar');
  assert.equal(ruleSelector({ type: 'reached', path: '/a' }), '');
  assert.match(ruleText({ type: 'visible', text: 'Listo' }, name), /texto «Listo»/);
  assert.match(ruleText({ type: 'manual' }, name), /decides tú/);
  assert.equal(ruleText(undefined, name), '');
});

test('samePages y recordingOffset', () => {
  assert.equal(samePages(['/a', '/b'], ['/a', '/b']), true);
  assert.equal(samePages(['/a'], ['/a', '/b']), false);
  assert.equal(recordingOffset(1000, 4000, 500), 2500);
  assert.equal(recordingOffset(1000, 900), 0);
  assert.equal(recordingOffset(undefined, 900), undefined);
});

test('arrangePeople ordena por llegada, por tareas logradas o por duración, y filtra problemas', () => {
  const people = [
    { id: 'a', achieved: 1, problems: 1, durationMs: 30_000 },
    { id: 'b', achieved: 2, problems: 0, durationMs: 10_000 },
    { id: 'c', achieved: 1, problems: 0, durationMs: 50_000 },
  ];
  const ids = (list: Array<{ id: string }>): string[] => list.map((p) => p.id);
  assert.deepEqual(ids(arrangePeople(people, 'arrival')), ['a', 'b', 'c']);
  assert.deepEqual(ids(arrangePeople(people, 'achieved')), ['b', 'c', 'a']);
  assert.deepEqual(ids(arrangePeople(people, 'duration')), ['c', 'a', 'b']);
  assert.deepEqual(ids(arrangePeople(people, 'arrival', true)), ['a']);
  assert.equal(people[0]!.id, 'a', 'no cambia la lista original');
});
