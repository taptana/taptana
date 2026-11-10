import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, zipSync, strToU8, type Zippable } from 'fflate';
import { extractUpload, usesHistoryRouter, MAX_FILES, UploadError } from './uploads.js';
import { listZip } from './zip.js';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'taptana-up-'));

/** Cambia en el índice del zip el tamaño descomprimido que declara su primera entrada. */
function declareSize(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = out.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      const central = view.getUint32(i + 16, true);
      view.setUint32(central + 24, size, true);
      return out;
    }
  }
  throw new Error('no es un zip');
}

test('a single html becomes index.html', async () => {
  const dest = join(tmp(), 'p');
  const r = await extractUpload('Mi Proto.HTML', strToU8('<p>hola</p>'), dest);
  assert.equal(r.entryPath, '/index.html');
  assert.equal(r.absoluteUrls, false);
  assert.equal(readFileSync(join(dest, 'index.html'), 'utf8'), '<p>hola</p>');
});

test('a zip with one top folder is flattened and junk is skipped', async () => {
  const dest = join(tmp(), 'p');
  const zip = zipSync({
    'mi-proto/index.html': strToU8('<p>home</p>'),
    'mi-proto/css/app.css': strToU8('body{}'),
    'mi-proto/.DS_Store': strToU8('x'),
    'mi-proto/.env': strToU8('SECRETO=1'),
    'mi-proto/.git/config': strToU8('x'),
    'mi-proto/node_modules/x/index.js': strToU8('x'),
    'mi-proto/Thumbs.db': strToU8('x'),
    '__MACOSX/mi-proto/._index.html': strToU8('x'),
  });
  const r = await extractUpload('mi-proto.zip', zip, dest);
  assert.equal(r.entryPath, '/index.html');
  assert.equal(r.files, 2);
  assert.ok(existsSync(join(dest, 'css', 'app.css')));
  assert.deepEqual(readdirSync(dest).sort(), ['css', 'index.html']);
});

test('entry falls back to the first html when there is no index', async () => {
  const dest = join(tmp(), 'p');
  const r = await extractUpload('x.zip', zipSync({ 'pages/login.html': strToU8('a'), 'home.html': strToU8('b') }), dest);
  assert.equal(r.entryPath, '/home.html');
});

test('rejects path traversal, absolute paths, empty zips, zips without html and other file types', async () => {
  const dest = join(tmp(), 'p');
  await assert.rejects(extractUpload('x.zip', zipSync({ '../evil.html': strToU8('x') }), dest), /Ruta no permitida/);
  await assert.rejects(extractUpload('x.zip', zipSync({ 'a/../../evil.html': strToU8('x'), 'index.html': strToU8('x') }), dest), /Ruta no permitida/);
  await assert.rejects(extractUpload('x.zip', zipSync({ '/etc/evil.html': strToU8('x') }), dest), /Ruta no permitida/);
  await assert.rejects(extractUpload('x.zip', zipSync({ 'C:\\Windows\\evil.html': strToU8('x') }), dest), /Ruta no permitida/);
  await assert.rejects(extractUpload('x.zip', zipSync({ 'a.css': strToU8('x') }), dest), /ningún archivo \.html/);
  await assert.rejects(extractUpload('x.zip', zipSync({ '.oculto/index.html': strToU8('x') }), dest), /está vacío/);
  await assert.rejects(extractUpload('x.pdf', strToU8('x'), dest), /\.html o \.zip/);
  await assert.rejects(extractUpload('x.zip', strToU8('not a zip'), dest), /No se pudo abrir/);
  await assert.rejects(extractUpload('x.zip', new Uint8Array(0), dest), UploadError);
  // Nada quedó escrito, ni siquiera a medias.
  assert.ok(!existsSync(dest));
  assert.deepEqual(readdirSync(join(dest, '..')), []);
});

test('zip bomb: the declared size is checked before anything is inflated', async () => {
  const dest = join(tmp(), 'p');
  const zip = zipSync({ 'index.html': strToU8('<p>hola</p>') });
  // 3 GB declarados en un archivo de pocos bytes: se rechaza sin reservar esa memoria.
  await assert.rejects(extractUpload('bomba.zip', declareSize(zip, 3_000_000_000), dest), /pesa más de 200 MB/);
  assert.ok(!existsSync(dest));

  // Y si miente al revés (declara poco, trae mucho), sale cortado a lo declarado.
  const liar = declareSize(zipSync({ 'index.html': new Uint8Array(2 * 1024 * 1024) }), 10);
  await extractUpload('mentiroso.zip', liar, dest);
  assert.equal(readFileSync(join(dest, 'index.html')).byteLength, 10);
});

test('too many files are rejected before writing anything', async () => {
  const dest = join(tmp(), 'p');
  const files: Zippable = { 'index.html': strToU8('x') };
  for (let i = 0; i <= MAX_FILES; i++) files[`img/${i}.txt`] = new Uint8Array(0);
  await assert.rejects(extractUpload('muchos.zip', zipSync(files, { level: 0 }), dest), /más de 2000 archivos/);
  assert.ok(!existsSync(dest));
});

test('symbolic links and password-protected zips are rejected', async () => {
  const dest = join(tmp(), 'p');
  const link = zipSync({
    'index.html': strToU8('<p>x</p>'),
    'secretos': [strToU8('/etc/passwd'), { os: 3, attrs: (0o120777 << 16) >>> 0 }],
  });
  assert.equal(listZip(link).find((e) => e.name === 'secretos')?.symlink, true);
  await assert.rejects(extractUpload('enlace.zip', link, dest), /enlace simbólico \(secretos\)/);
  assert.ok(!existsSync(dest));

  // Un enlace dentro de una carpeta que de todos modos no se copia no estorba.
  const harmless = zipSync({
    'index.html': strToU8('<p>x</p>'),
    'node_modules/.bin/tsc': [strToU8('../typescript/bin/tsc'), { os: 3, attrs: (0o120777 << 16) >>> 0 }],
  });
  assert.equal((await extractUpload('ok.zip', harmless, dest)).files, 1);

  const encrypted = zipSync({ 'index.html': strToU8('<p>x</p>') });
  const view = new DataView(encrypted.buffer);
  for (let i = encrypted.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      const central = view.getUint32(i + 16, true);
      view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
      break;
    }
  }
  await assert.rejects(extractUpload('clave.zip', encrypted, dest), /contraseña/);
});

test('a file and a folder with the same name: the folder wins and nothing crashes', async () => {
  const dest = join(tmp(), 'p');
  const zip = zipSync({
    'index.html': strToU8('<p>x</p>'),
    'docs': strToU8('soy un archivo'),
    'docs/guia.html': strToU8('<p>guia</p>'),
    'Assets': strToU8('otro archivo'),
    'assets/logo.svg': strToU8('<svg/>'),
  });
  const r = await extractUpload('choque.zip', zip, dest);
  assert.equal(r.files, 3);
  assert.equal(readFileSync(join(dest, 'docs', 'guia.html'), 'utf8'), '<p>guia</p>');
  assert.ok(existsSync(join(dest, 'assets', 'logo.svg')));
});

test('windows separators and utf-8 names without the utf-8 flag', async () => {
  const dest = join(tmp(), 'p');
  const zip = zipSync({ 'sitio\\index.html': strToU8('<p>x</p>'), 'sitio\\img\\diseño.svg': strToU8('<svg/>') });
  // Como lo hacen varios compresores: nombres en UTF-8 sin marcar la bandera.
  const view = new DataView(zip.buffer);
  for (const entry of listZip(zip)) view.setUint16(entry.offset + 6, view.getUint16(entry.offset + 6, true) & ~0x800, true);
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      let at = view.getUint32(i + 16, true);
      for (let n = view.getUint16(i + 10, true); n > 0; n--) {
        view.setUint16(at + 8, view.getUint16(at + 8, true) & ~0x800, true);
        at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
      }
      break;
    }
  }
  const r = await extractUpload('windows.zip', zip, dest);
  assert.equal(r.entryPath, '/index.html');
  assert.ok(existsSync(join(dest, 'img', 'diseño.svg')));
});

test('a bad new version leaves the previous files untouched', async () => {
  const dest = join(tmp(), 'p');
  await extractUpload('v1.zip', zipSync({ 'index.html': strToU8('<p>v1</p>'), 'a.css': strToU8('a{}') }), dest);
  await assert.rejects(extractUpload('v2.zip', zipSync({ 'solo.css': strToU8('x') }), dest), UploadError);
  await assert.rejects(extractUpload('v2.zip', strToU8('roto'), dest), UploadError);
  assert.equal(readFileSync(join(dest, 'index.html'), 'utf8'), '<p>v1</p>');
  // Una versión buena sí reemplaza todo: no quedan archivos de la anterior.
  await extractUpload('v3.zip', zipSync({ 'index.html': strToU8('<p>v3</p>') }), dest);
  assert.deepEqual(readdirSync(dest), ['index.html']);
  assert.deepEqual(readdirSync(join(dest, '..')), ['p']);
});

test('absoluteUrls: only for prototypes that navigate with the History API', async () => {
  assert.equal(usesHistoryRouter('history.pushState({}, "", "/carrito")'), true);
  assert.equal(usesHistoryRouter('window.history.replaceState(null,"",u)'), true);
  assert.equal(usesHistoryRouter('e.pushState (s,"",t)'), true, 'minified');
  assert.equal(usesHistoryRouter('const router = createBrowserRouter([{ path: "/" }])'), true);
  assert.equal(usesHistoryRouter('createRouter({ history: createWebHistory("/app/") })'), true);
  assert.equal(usesHistoryRouter('<link rel="stylesheet" href="/css/app.css"><a href="/checkout/">Pagar</a>'), false);
  assert.equal(usesHistoryRouter('location.hash = "#/carrito"; history.back()'), false);

  // Varias carpetas con rutas absolutas a sus archivos: funciona bajo /p/<id>/, no hace falta la raíz.
  const site = await extractUpload(
    'sitio.zip',
    zipSync({ 'index.html': strToU8('<link href="/css/app.css" rel="stylesheet"><a href="/checkout/">Pagar</a>'), 'css/app.css': strToU8('body{}'), 'checkout/index.html': strToU8('<a href="/">Volver</a>') }),
    join(tmp(), 'sitio'),
  );
  assert.equal(site.absoluteUrls, false);
  // Una app con router de History, en el HTML o en un script de una subcarpeta.
  const inline = await extractUpload('spa.html', strToU8('<script>history.pushState({}, "", "/carrito")</script>'), join(tmp(), 'a'));
  assert.equal(inline.absoluteUrls, true);
  const bundled = await extractUpload(
    'spa.zip',
    zipSync({ 'index.html': strToU8('<script type="module" src="/assets/app.js"></script>'), 'assets/app.js': strToU8('function go(t){window.history.pushState({},"",t)}'), 'assets/data.json': strToU8('{"x":"pushState("}') }),
    join(tmp(), 'b'),
  );
  assert.equal(bundled.absoluteUrls, true);
  const dataOnly = await extractUpload('p.zip', zipSync({ 'index.html': strToU8('<p>hola</p>'), 'data.json': strToU8('{"x":"pushState("}') }), join(tmp(), 'c'));
  assert.equal(dataOnly.absoluteUrls, false, 'only .html and .js are read');
});

test('listZip reads stored and deflated entries and refuses garbage', () => {
  const zip = zipSync({ 'a.txt': [strToU8('hola'), { level: 0 }], 'dir/b.txt': strToU8('hola hola hola hola'), 'dir/': new Uint8Array(0) });
  const entries = listZip(zip);
  assert.deepEqual(entries.map((e) => [e.name, e.size, e.directory]), [
    ['a.txt', 4, false],
    ['dir/b.txt', 19, false],
    ['dir/', 0, true],
  ]);
  assert.throws(() => listZip(strToU8('hola')));
  assert.throws(() => listZip(deflateSync(strToU8('no soy un zip aunque esté comprimido'))));
  assert.throws(() => listZip(zip.subarray(0, zip.length - 30)));
});
