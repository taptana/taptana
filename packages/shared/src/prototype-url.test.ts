import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateHost, normalizePrototypeUrl } from './prototype-url.js';

const ok = (input: string): string => {
  const r = normalizePrototypeUrl(input);
  assert.ok(r.ok, `${input}: ${r.ok ? '' : r.error}`);
  return r.url;
};

test('adds https:// to public hosts and http:// to local ones', () => {
  assert.equal(ok('mi-app.vercel.app'), 'https://mi-app.vercel.app/');
  assert.equal(ok('  https://x.lovable.app/inicio  '), 'https://x.lovable.app/inicio');
  assert.equal(ok('localhost:5173'), 'http://localhost:5173/');
  assert.equal(ok('192.168.1.20:3000/app'), 'http://192.168.1.20:3000/app');
  assert.equal(ok('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/');
});

test('strips the fragment and keeps the query', () => {
  assert.equal(ok('https://a.dev/app?x=1#/carrito'), 'https://a.dev/app?x=1');
});

test('rejects other schemes, credentials and garbage', () => {
  for (const bad of ['', '   ', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://a.com', 'mailto:a@b.c', 'https://user:pw@a.com/', 'http://']) {
    const r = normalizePrototypeUrl(bad);
    assert.equal(r.ok, false, bad);
  }
});

test('isPrivateHost', () => {
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.9', 'mac.local', '[::1]']) assert.equal(isPrivateHost(h), true, h);
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1', 'fd.example.com']) assert.equal(isPrivateHost(h), false, h);
});
