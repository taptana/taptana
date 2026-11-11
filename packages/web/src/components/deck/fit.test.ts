import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLines, fitList, fitText } from './fit.ts';

test('countLines wraps by words and splits very long words', () => {
  assert.equal(countLines('hola', 1000, 20), 1);
  // 10 letras por línea a 20 px (0,5 em) en 100 px.
  assert.equal(countLines('uno dos tres cuatro', 100, 20), 3);
  assert.equal(countLines('a'.repeat(25), 100, 20), 3);
  assert.equal(countLines('uno\ndos', 1000, 20), 2);
});

test('fitText keeps the biggest size that fits, then clips with an ellipsis', () => {
  const short = fitText('Comprar una planta', { width: 1000, height: 60 }, 44, 24);
  assert.equal(short.size, 44);
  assert.equal(short.text, 'Comprar una planta');

  const long = 'Encuentra el costo del envío de una planta pequeña a tu casa y dinos cuánto cuesta antes de pagar';
  const mid = fitText(long, { width: 800, height: 120 }, 44, 20);
  assert.ok(mid.size < 44 && mid.size >= 20);
  assert.equal(mid.text, long);

  const huge = fitText(long.repeat(10), { width: 400, height: 60 }, 30, 20);
  assert.equal(huge.size, 20);
  assert.ok(huge.text.endsWith('…'));
  assert.ok(countLines(huge.text, 400, 20) * 20 * 1.25 <= 60 + 1e-9);
});

test('fitList shares one size across items', () => {
  const size = fitList(['uno', 'dos', 'tres'], { width: 600, height: 200 }, 30, 16);
  assert.equal(size, 30);
  const tight = fitList(Array(5).fill('una frase bastante larga que ocupa más de una línea en la caja'), { width: 500, height: 300 }, 30, 14);
  assert.ok(tight < 30);
});
