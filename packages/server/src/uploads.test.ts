import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { extractUpload, UploadError } from './uploads.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'taptana-up-'));

test('a single html becomes index.html', () => {
  const dest = join(tmp(), 'p');
  const r = extractUpload('Mi Proto.HTML', strToU8('<p>hola</p>'), dest);
  assert.equal(r.entryPath, '/index.html');
  assert.equal(readFileSync(join(dest, 'index.html'), 'utf8'), '<p>hola</p>');
});

test('a zip with one top folder is flattened and junk is skipped', () => {
  const dest = join(tmp(), 'p');
  const zip = zipSync({
    'mi-proto/index.html': strToU8('<p>home</p>'),
    'mi-proto/css/app.css': strToU8('body{}'),
    'mi-proto/.DS_Store': strToU8('x'),
    '__MACOSX/mi-proto/._index.html': strToU8('x'),
  });
  const r = extractUpload('mi-proto.zip', zip, dest);
  assert.equal(r.entryPath, '/index.html');
  assert.equal(r.files, 2);
  assert.ok(existsSync(join(dest, 'css', 'app.css')));
  assert.ok(!existsSync(join(dest, '.DS_Store')));
});

test('entry falls back to the first html when there is no index', () => {
  const dest = join(tmp(), 'p');
  const r = extractUpload('x.zip', zipSync({ 'pages/login.html': strToU8('a'), 'home.html': strToU8('b') }), dest);
  assert.equal(r.entryPath, '/home.html');
});

test('rejects path traversal, empty zips, zips without html and other file types', () => {
  const dest = join(tmp(), 'p');
  assert.throws(() => extractUpload('x.zip', zipSync({ '../evil.html': strToU8('x') }), dest), UploadError);
  assert.throws(() => extractUpload('x.zip', zipSync({ 'a.css': strToU8('x') }), dest), /ningún archivo \.html/);
  assert.throws(() => extractUpload('x.pdf', strToU8('x'), dest), /\.html o \.zip/);
  assert.throws(() => extractUpload('x.zip', strToU8('not a zip'), dest), /No se pudo abrir/);
});
