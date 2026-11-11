import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMask, maskWith, tokensOf } from './privacy.js';
import { rebaseUrl, stripBase } from './session.js';

test('tokensOf: el valor completo y sus palabras de 4 letras o más', () => {
  assert.deepEqual(tokensOf('  Ana  María '), ['ana maría', 'maría']);
  assert.deepEqual(tokensOf('ana'), []);
  assert.deepEqual(tokensOf('ab'), []);
  assert.deepEqual(tokensOf('casa con patio'), ['casa con patio', 'casa', 'patio']);
});

test('maskWith tapa solo las coincidencias, sin distinguir mayúsculas', () => {
  const mask = buildMask(tokensOf('Ana García'));
  assert.equal(maskWith('Hola GARCÍA, bienvenida', mask), 'Hola ******, bienvenida');
  assert.equal(maskWith('Hola ANA, bienvenida', mask), 'Hola ANA, bienvenida', 'tres letras sueltas no se tapan');
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

test('lo escrito solo se tapa cuando aparece entero, como palabra o frase', () => {
  // Buscar "ficu" no tapa "Ficus" en toda la tienda.
  const search = buildMask(tokensOf('ficu'));
  assert.equal(maskWith('Ficus lyrata · Ficus elastica', search), 'Ficus lyrata · Ficus elastica');
  assert.equal(maskWith('Resultados para «ficu»: 2', search), 'Resultados para «****»: 2');
  assert.equal(maskWith('ficu', search), '****');
  // Un nombre completo se tapa donde el prototipo lo repita.
  const name = buildMask(tokensOf('Ana María'));
  assert.equal(maskWith('Hola Ana María', name), 'Hola *********');
  assert.equal(maskWith('Gracias, María. María, tu pedido va en camino', name), 'Gracias, *****. *****, tu pedido va en camino');
  assert.equal(maskWith('Mariana y Ana', name), 'Mariana y Ana', '"ana" (3 letras) no tapa nada, ni dentro de otra palabra');
  // Tres letras no tapan nada.
  assert.equal(buildMask(tokensOf('ana')), null);
  // Los límites saben de tildes, eñes y números.
  const word = buildMask(tokensOf('caña'));
  assert.equal(maskWith('cañas, CAÑA y cañaveral; caña2', word), 'cañas, **** y cañaveral; caña2');
  assert.equal(maskWith('caña caña', word), '**** ****', 'dos seguidas, separadas por un solo espacio');
  const code = buildMask(tokensOf('4111'));
  assert.equal(maskWith('Tarjeta 4111 · 41112', code), 'Tarjeta **** · 41112');
});

test('lo escrito con guiones u otros símbolos no rompe la máscara', () => {
  const typed = 'Ana-Maria 555-0123 a.b+c (x) [y] {z} 1/2 ^$ | \\';
  const mask = buildMask(tokensOf(typed).concat(typed));
  assert.equal(maskWith('Hola Ana-Maria, tu número 555-0123', mask), 'Hola *********, tu número ********');
});
