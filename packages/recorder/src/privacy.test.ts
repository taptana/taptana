import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMask, maskWith, tokensOf } from './privacy.js';
import { rebaseUrl, stripBase } from './session.js';

test('tokensOf: el valor completo y sus palabras de 3 letras o más', () => {
  assert.deepEqual(tokensOf('  Ana  María '), ['ana maría', 'ana', 'maría']);
  assert.deepEqual(tokensOf('ab'), []);
  assert.deepEqual(tokensOf('casa con patio'), ['casa con patio', 'casa', 'patio']);
});

test('maskWith tapa solo las coincidencias, sin distinguir mayúsculas', () => {
  const mask = buildMask(tokensOf('Ana García'));
  assert.equal(maskWith('Hola ANA, bienvenida', mask), 'Hola ***, bienvenida');
  assert.equal(maskWith('Para: Ana   García.', mask), 'Para: ************.');
  assert.equal(maskWith('Sin nada que tapar', mask), 'Sin nada que tapar');
  assert.equal(maskWith('texto', buildMask([])), 'texto');
});

test('buildMask escapa los caracteres especiales', () => {
  const mask = buildMask(tokensOf('a.b+c@x.com'));
  assert.equal(maskWith('correo a.b+c@x.com listo', mask), 'correo *********** listo');
  assert.equal(maskWith('aXb+c@x.com', mask), 'aXb+c@x.com');
});

test('stripBase quita el prefijo del prototipo', () => {
  assert.equal(stripBase('/p/pr_1/x.html', '/p/pr_1'), '/x.html');
  assert.equal(stripBase('/p/pr_1', '/p/pr_1'), '/');
  assert.equal(stripBase('/p/pr_10/x.html', '/p/pr_1'), '/p/pr_10/x.html');
  assert.equal(stripBase('/x.html', ''), '/x.html');
});

test('rebaseUrl mete bajo el prefijo las rutas absolutas del mismo origen', () => {
  const href = 'http://host/p/pr_1/index.html';
  assert.equal(rebaseUrl('/checkout?x=1#a', '/p/pr_1', href), '/p/pr_1/checkout?x=1#a');
  assert.equal(rebaseUrl('/p/pr_1/cart', '/p/pr_1', href), '/p/pr_1/cart');
  assert.equal(rebaseUrl('cart', '/p/pr_1', href), 'cart');
  assert.equal(rebaseUrl('#/cart', '/p/pr_1', href), '#/cart');
  assert.equal(rebaseUrl('https://otro.com/x', '/p/pr_1', href), 'https://otro.com/x');
  assert.equal(rebaseUrl('/x', '', href), '/x');
});
