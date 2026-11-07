import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceLabel } from './device.js';

test('iPhone Safari', () => {
  const ua =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  assert.equal(deviceLabel(ua), 'iPhone · Safari 18');
});

test('Android Chrome', () => {
  const ua =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
  assert.equal(deviceLabel(ua), 'Android · Chrome 129');
});

test('Mac Chrome', () => {
  const ua =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
  assert.equal(deviceLabel(ua), 'Mac · Chrome 129');
});

test('unknown', () => {
  assert.equal(deviceLabel('curl/8'), 'Desconocido · Navegador');
});
