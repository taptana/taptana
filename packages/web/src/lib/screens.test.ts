import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveTitleIsStable, nameScreen, screenNamer } from './screens.ts';

const screens = [
  { id: '/index.html', title: 'Verde · Plantas' },
  { id: '/producto.html', title: 'Producto · Verde' },
  { id: '/carrito.html' },
];

test('una pantalla conocida usa siempre su título, venga como venga la ruta', () => {
  assert.equal(nameScreen('/producto.html?id=3', screens), 'Producto · Verde');
  assert.equal(nameScreen('/', screens), 'Verde · Plantas');
});

test('sin título se usa el nombre corto de la ruta', () => {
  assert.equal(nameScreen('/carrito.html', screens), 'carrito');
  assert.equal(nameScreen('/gracias.html', screens), 'gracias');
  assert.equal(nameScreen('/index.html', []), 'inicio');
});

test('el nombre que manda la API gana al título', () => {
  assert.equal(nameScreen('/producto.html', [{ id: '/producto.html', name: 'producto', title: 'Monstera deliciosa' }]), 'producto');
});

test('screenNamer da lo mismo que nameScreen', () => {
  const name = screenNamer(screens);
  assert.equal(name('/producto.html'), 'Producto · Verde');
  assert.equal(name('/producto.html'), 'Producto · Verde');
});

test('el título en vivo solo vale para pantallas con hash o virtuales', () => {
  assert.equal(liveTitleIsStable('/producto.html'), false);
  assert.equal(liveTitleIsStable('/index.html#/carrito'), true);
  assert.equal(liveTitleIsStable('/index.html~pago'), true);
});
