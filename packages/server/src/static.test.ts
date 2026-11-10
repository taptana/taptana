import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mimeFor, parseRange, readRange, resolveFile } from './static.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'taptana-static-')));
const root = join(base, 'proto');
mkdirSync(root);
writeFileSync(join(root, 'index.html'), '<p>home</p>');
mkdirSync(join(root, 'sub'));
writeFileSync(join(root, 'sub', 'index.html'), '<p>sub</p>');
writeFileSync(join(root, 'producto.html'), '<p>producto</p>');
writeFileSync(join(root, 'app.js'), '0123456789');
// Lo que nunca se debe servir.
writeFileSync(join(root, '.env'), 'SECRETO=1');
mkdirSync(join(root, '.git'));
writeFileSync(join(root, '.git', 'config'), '[core]');
mkdirSync(join(root, 'sub', '.cache'));
writeFileSync(join(root, 'sub', '.cache', 'x.html'), '<p>x</p>');
writeFileSync(join(base, 'fuera.txt'), 'fuera de la carpeta');
mkdirSync(join(base, 'otra'));
writeFileSync(join(base, 'otra', 'index.html'), '<p>otra carpeta</p>');

/** Crear enlaces puede no estar permitido (Windows sin permisos): esas pruebas se saltan. */
function link(target: string, path: string): boolean {
  try {
    symlinkSync(target, path);
    return true;
  } catch {
    return false;
  }
}

test('resolves index, nested index and extensionless html', async () => {
  assert.equal((await resolveFile(root, '/'))?.absolute, join(root, 'index.html'));
  assert.equal((await resolveFile(root, '/sub/'))?.absolute, join(root, 'sub', 'index.html'));
  assert.equal((await resolveFile(root, '/producto'))?.absolute, join(root, 'producto.html'));
  const js = await resolveFile(root, '/app.js');
  assert.equal(js?.isHtml, false);
  assert.equal(js?.size, 10);
  assert.ok((js?.mtimeMs ?? 0) > 0);
  assert.equal((await resolveFile(root, '/sub/index.html'))?.needsSlash, undefined);
});

test('a folder without the trailing slash is flagged so the caller can redirect', async () => {
  const file = await resolveFile(root, '/sub');
  assert.equal(file?.absolute, join(root, 'sub', 'index.html'));
  assert.equal(file?.needsSlash, true);
});

test('refuses to leave the root', async () => {
  assert.equal(await resolveFile(root, '/../fuera.txt'), null);
  assert.equal(await resolveFile(root, '/sub/../../fuera.txt'), null);
  assert.equal(await resolveFile(root, '/%2e%2e/fuera.txt'), null);
  assert.equal(await resolveFile(root, '/..%2ffuera.txt'), null);
  assert.equal(await resolveFile(root, '/..\\fuera.txt'), null);
  assert.equal(await resolveFile(root, '/%00'), null);
  assert.equal(await resolveFile(root, '/%E0%A4%A'), null);
});

test('never serves files or folders that start with a dot', async () => {
  assert.equal(await resolveFile(root, '/.env'), null);
  assert.equal(await resolveFile(root, '/.git/config'), null);
  assert.equal(await resolveFile(root, '/.git'), null);
  assert.equal(await resolveFile(root, '/sub/.cache/x.html'), null);
  assert.equal(await resolveFile(root, '/sub/.cache/x'), null);
  assert.equal(await resolveFile(root, '/%2Eenv'), null);
  assert.equal(await resolveFile(root, '//.env'), null);
});

test('symbolic links: inside the folder are fine, outside are refused', async (t) => {
  if (!link(join(root, 'app.js'), join(root, 'alias.js'))) return t.skip('no se pueden crear enlaces aquí');
  link(join(base, 'fuera.txt'), join(root, 'escape.txt'));
  link(join(base, 'otra'), join(root, 'otra'));
  link(join(root, '.env'), join(root, 'env.txt'));
  link(join(base, 'no-existe'), join(root, 'roto.txt'));

  assert.equal((await resolveFile(root, '/alias.js'))?.absolute, join(root, 'app.js'));
  assert.equal(await resolveFile(root, '/escape.txt'), null);
  assert.equal(await resolveFile(root, '/otra/'), null);
  assert.equal(await resolveFile(root, '/otra/index.html'), null);
  assert.equal(await resolveFile(root, '/otra'), null);
  // Un enlace a un archivo oculto de la misma carpeta tampoco lo destapa.
  assert.equal(await resolveFile(root, '/env.txt'), null);
  assert.equal(await resolveFile(root, '/roto.txt'), null);
});

test('the root itself may be reached through a symbolic link', async (t) => {
  const alias = join(base, 'alias-de-proto');
  if (!link(root, alias)) return t.skip('no se pueden crear enlaces aquí');
  assert.equal((await resolveFile(alias, '/producto.html'))?.absolute, join(root, 'producto.html'));
});

test('returns null for missing files and missing roots', async () => {
  assert.equal(await resolveFile(root, '/nada.html'), null);
  assert.equal(await resolveFile(join(base, 'no-hay'), '/'), null);
});

test('range requests', async () => {
  assert.equal(parseRange(undefined, 10), null);
  assert.equal(parseRange('items=0-1', 10), null);
  assert.equal(parseRange('bytes=0-1,5-6', 10), null);
  assert.deepEqual(parseRange('bytes=0-3', 10), { start: 0, end: 3 });
  assert.deepEqual(parseRange('bytes=4-', 10), { start: 4, end: 9 });
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=5-999', 10), { start: 5, end: 9 });
  assert.equal(parseRange('bytes=10-', 10), 'invalid');
  assert.equal(parseRange('bytes=6-2', 10), 'invalid');
  assert.equal(parseRange('bytes=-0', 10), 'invalid');
  assert.equal(Buffer.from(await readRange(join(root, 'app.js'), 2, 5)).toString(), '2345');
});

test('mime types', () => {
  assert.equal(mimeFor('/a/b.CSS'), 'text/css; charset=utf-8');
  assert.equal(mimeFor('video.mp4'), 'video/mp4');
  assert.equal(mimeFor('sin-extension'), 'application/octet-stream');
});
