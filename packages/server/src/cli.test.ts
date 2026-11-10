import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { resolveConfig } from './config.js';
import { listen, ListenError } from './listen.js';
import { isLoopback, normalizeAddress } from './network.js';
import { nodeProblem, sqliteProblem } from './node-version.js';
import { openBrowser, openCommand } from './open-browser.js';

test('nodeProblem explains an old Node and accepts 22.5 or newer', () => {
  for (const ok of ['22.5.0', '22.13.1', 'v22.23.4', '23.0.0', '24.1.0', '100.0.0']) assert.equal(nodeProblem(ok), null, ok);
  for (const old of ['22.4.1', '20.11.0', 'v18.19.0', '16.0.0', '0.12.0', 'no-es-una-version']) {
    const message = nodeProblem(old);
    assert.ok(message, old);
    assert.match(message, /Taptana necesita Node\.js 22\.5 o más nuevo/);
    assert.ok(message.includes(old));
    assert.match(message, /nodejs\.org/);
  }
  assert.match(sqliteProblem('22.6.0'), /22\.13/);
});

test('openCommand picks the opener of each system and openBrowser never throws', () => {
  const url = 'http://localhost:4321/panel';
  assert.deepEqual(openCommand('darwin', url), { command: 'open', args: [url] });
  assert.deepEqual(openCommand('linux', url), { command: 'xdg-open', args: [url] });
  assert.deepEqual(openCommand('freebsd', url), { command: 'xdg-open', args: [url] });
  assert.deepEqual(openCommand('win32', url), { command: 'cmd', args: ['/c', 'start', '', url] });
  // Un sistema sin ese comando (un servidor, Docker): no pasa nada.
  assert.doesNotThrow(() => openBrowser(url, 'aix'));
});

test('resolveConfig: flags win over the environment; panel and public url', () => {
  const env = { TAPTANA_PORT: '5000', TAPTANA_HOST: '127.0.0.1', TAPTANA_DATA_DIR: '/datos', TAPTANA_PANEL: 'open', TAPTANA_PUBLIC_URL: 'https://taptana.ejemplo.com/' };
  const fromEnv = resolveConfig('/proto', {}, env);
  assert.equal(fromEnv.port, 5000);
  assert.equal(fromEnv.host, '127.0.0.1');
  assert.equal(fromEnv.dataDir, resolve('/datos'));
  assert.equal(fromEnv.openPanel, true);
  assert.equal(fromEnv.publicUrl, 'https://taptana.ejemplo.com');
  assert.equal(fromEnv.openBrowser, true);

  const fromFlags = resolveConfig('/proto', { port: '6000', host: '0.0.0.0', dataDir: '/otros', openPanel: false, open: false, publicUrl: 'http://localhost:6000' }, env);
  assert.equal(fromFlags.port, 6000);
  assert.equal(fromFlags.host, '0.0.0.0');
  assert.equal(fromFlags.dataDir, resolve('/otros'));
  assert.equal(fromFlags.openPanel, false);
  assert.equal(fromFlags.openBrowser, false);
  assert.equal(fromFlags.publicUrl, 'http://localhost:6000');

  const defaults = resolveConfig('/proto', {}, {});
  assert.equal(defaults.port, 4321);
  assert.equal(defaults.openPanel, false);
  assert.equal(defaults.publicUrl, undefined);

  // Las rutas relativas se cuentan desde donde la persona escribió el comando (pnpm cambia de carpeta).
  const viaPnpm = resolveConfig('./examples/tienda', {}, { INIT_CWD: resolve('/repo') });
  assert.equal(viaPnpm.prototypeDir, resolve('/repo/examples/tienda'));
  assert.equal(viaPnpm.dataDir, resolve('/repo/.taptana'));

  assert.throws(() => resolveConfig('/proto', { port: 'abc' }, {}), /Puerto inválido: abc/);
  assert.throws(() => resolveConfig('/proto', { port: '70000' }, {}), /Puerto inválido/);
  assert.throws(() => resolveConfig('/proto', {}, { TAPTANA_PUBLIC_URL: 'taptana.ejemplo.com' }), /Dirección pública inválida/);
  assert.throws(() => resolveConfig('/proto', {}, { TAPTANA_PUBLIC_URL: 'ftp://x' }), /http:\/\/ o https:\/\//);
});

test('addresses', () => {
  assert.equal(normalizeAddress('::ffff:192.168.1.5'), '192.168.1.5');
  assert.equal(normalizeAddress('FE80::1%en0'), 'fe80::1');
  assert.equal(normalizeAddress('[::1]'), '::1');
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback('192.168.1.5'), false);
  assert.equal(isLoopback('127.evil.example'), false);
  assert.equal(isLoopback('localhost'), false);
});

/** Ocupa un puerto libre cualquiera de esta máquina y lo devuelve. */
function occupy(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') return reject(new Error('sin puerto'));
      resolvePromise({ port: address.port, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

test('listen moves to the next port when the first is taken, and explains when none is free', async () => {
  const busy = await occupy();
  try {
    const fetch = (): Response => new Response('hola');
    const listening = await listen(fetch, { port: busy.port, host: '127.0.0.1' });
    try {
      assert.ok(listening.port > busy.port, 'usó un puerto siguiente');
      assert.ok(listening.port <= busy.port + 20);
      assert.equal(await (await globalThis.fetch(`http://127.0.0.1:${listening.port}/`)).text(), 'hola');
    } finally {
      await new Promise<void>((done) => listening.server.close(() => done()));
    }

    // Sin intentos de más: un mensaje claro, no una pila.
    await assert.rejects(listen(fetch, { port: busy.port, host: '127.0.0.1', attempts: 0 }), (err: unknown) => {
      assert.ok(err instanceof ListenError);
      assert.match(err.message, new RegExp(`El puerto ${busy.port} está ocupado`));
      assert.match(err.message, /--port/);
      return true;
    });
  } finally {
    await busy.close();
  }
});
