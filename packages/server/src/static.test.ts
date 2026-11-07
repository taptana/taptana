import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFile } from './static.js';

const root = mkdtempSync(join(tmpdir(), 'taptana-static-'));
writeFileSync(join(root, 'index.html'), '<p>home</p>');
mkdirSync(join(root, 'sub'));
writeFileSync(join(root, 'sub', 'index.html'), '<p>sub</p>');
writeFileSync(join(root, 'producto.html'), '<p>producto</p>');
writeFileSync(join(root, 'app.js'), 'x');

test('resolves index, nested index and extensionless html', async () => {
  assert.equal((await resolveFile(root, '/'))?.absolute, join(root, 'index.html'));
  assert.equal((await resolveFile(root, '/sub/'))?.absolute, join(root, 'sub', 'index.html'));
  assert.equal((await resolveFile(root, '/producto'))?.absolute, join(root, 'producto.html'));
  assert.equal((await resolveFile(root, '/app.js'))?.isHtml, false);
});

test('refuses to leave the root', async () => {
  assert.equal(await resolveFile(root, '/../etc/passwd'), null);
  assert.equal(await resolveFile(root, '/sub/../../x'), null);
  assert.equal(await resolveFile(root, '/%2e%2e/%2e%2e/etc/passwd'), null);
});

test('returns null for missing files', async () => {
  assert.equal(await resolveFile(root, '/nada.html'), null);
});
