import test from 'node:test';
import assert from 'node:assert/strict';
import { exportFileName, fileSlug, sessionName, stripPrototypeBase, taskTally } from './sessions.ts';
import { friendlyError, UserError } from './errors.ts';

test('sessionName prefiere la etiqueta del moderador', () => {
  assert.equal(sessionName({ label: ' P3 · Ana ', participant: 'ana' }), 'P3 · Ana');
  assert.equal(sessionName({ participant: 'ana' }), 'ana');
  assert.equal(sessionName({ label: '  ' }), undefined);
});

test('fileSlug quita acentos y símbolos', () => {
  assert.equal(fileSlug('P3 · Ána Núñez'), 'p3-ana-nunez');
  assert.equal(fileSlug('***'), '');
});

test('exportFileName usa etiqueta y fecha', () => {
  const startedAt = new Date(2026, 2, 4, 10, 0).getTime();
  assert.equal(exportFileName({ label: 'P3 · Ana', startedAt, deviceLabel: 'iPhone · Safari' }), 'taptana-p3-ana-2026-03-04.json');
  assert.equal(exportFileName({ startedAt, deviceLabel: 'iPhone · Safari 18' }), 'taptana-iphone-safari-18-2026-03-04.json');
  assert.equal(exportFileName({ startedAt, deviceLabel: '' }), 'taptana-sesion-2026-03-04.json');
});

test('stripPrototypeBase quita la carpeta del prototipo', () => {
  assert.equal(stripPrototypeBase('/taptana/prototipo/carrito.html'), '/carrito.html');
  assert.equal(stripPrototypeBase('/taptana/local/pr_abc/index.html#/cart'), '/index.html#/cart');
  assert.equal(stripPrototypeBase('/p/pr_abc/'), '/');
  assert.equal(stripPrototypeBase('/p/pr_abc'), '/');
  assert.equal(stripPrototypeBase('/producto.html?id=*'), '/producto.html?id=*');
  assert.equal(stripPrototypeBase('/pagos/index.html'), '/pagos/index.html');
});

test('taskTally cuenta las logradas', () => {
  assert.equal(taskTally(undefined), null);
  assert.deepEqual(
    taskTally([
      { taskId: 'a', outcome: 'success', ruleMatched: true, reported: null, manual: null },
      { taskId: 'b', outcome: 'failed', ruleMatched: false, reported: 'skip', manual: null },
    ]),
    { done: 1, total: 2 },
  );
});

test('friendlyError nunca muestra texto crudo', () => {
  assert.equal(friendlyError(new UserError('Ponle un nombre')), 'Ponle un nombre');
  assert.match(friendlyError(new TypeError('Failed to fetch')), /No pudimos conectar/);
  assert.match(friendlyError(new Error('Cannot read properties of undefined')), /Algo salió mal/);
  assert.match(friendlyError(Object.assign(new Error('x'), { name: 'QuotaExceededError' })), /sin espacio/);
  assert.equal(friendlyError(new Error('boom'), 'No se pudo subir.'), 'No se pudo subir.');
});
