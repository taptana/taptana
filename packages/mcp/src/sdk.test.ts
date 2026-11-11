/**
 * Prueba con un cliente de verdad: el SDK oficial de MCP se conecta a un Taptana real por stdio
 * (este paquete, `taptana-mcp`) y por HTTP (`POST /mcp` del servidor), y recorre el flujo
 * completo. Necesita el servidor compilado (`pnpm build`); si no está, se salta.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { EXAMPLE_PROTOTYPE_ID, EXAMPLE_STUDY_ID } from '@taptana/shared';

const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));
const bin = fileURLToPath(new URL('./bin.js', import.meta.url));
const skip = existsSync(cli) ? false : 'falta compilar el servidor (pnpm build)';

let server: ChildProcess | undefined;
let baseUrl = '';
let dataDir = '';

before(async () => {
  if (skip) return;
  dataDir = mkdtempSync(join(tmpdir(), 'taptana-mcp-sdk-'));
  const port = String(41000 + Math.floor(Math.random() * 8000));
  server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', cli, 'dev', '--port', port, '--host', '127.0.0.1', '--data-dir', dataDir, '--no-qr'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1' },
  });
  baseUrl = await new Promise<string>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`el servidor no arrancó:\n${out}`)), 15_000);
    server?.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const match = /(http:\/\/localhost:\d+)\/panel/.exec(out);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    server?.on('exit', (code) => reject(new Error(`el servidor salió (${code}):\n${out}`)));
  });
  const example = await fetch(`${baseUrl}/api/v1/example`, { method: 'POST' });
  assert.equal(example.status, 200);
});

after(() => {
  server?.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

type TextResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };
const textOf = (r: unknown): string => ((r as TextResult).content[0]?.text ?? '');
const dataOf = (r: unknown): any => {
  const text = textOf(r);
  return JSON.parse(text.slice(text.search(/[[{]/)));
};

/** El flujo de armar_estudio de punta a punta, con cualquier transporte. */
async function fullFlow(client: Client, label: string): Promise<void> {
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === 'create_study'), label);
  assert.ok(tools.every((t) => t.annotations !== undefined), label);

  const { prompts } = await client.listPrompts();
  assert.deepEqual(
    prompts.map((p) => p.name),
    ['armar_estudio'],
  );
  const prompt = await client.getPrompt({ name: 'armar_estudio', arguments: { goal: 'si encuentran el envío' } });
  assert.match(JSON.stringify(prompt.messages), /si encuentran el envío/);

  const guide = await client.callTool({ name: 'get_study_format', arguments: {} });
  assert.match(textOf(guide), /first-click/);

  const protos = dataOf(await client.callTool({ name: 'list_prototypes', arguments: {} }));
  assert.ok(protos.some((p: { id: string }) => p.id === EXAMPLE_PROTOTYPE_ID), label);

  const screens = dataOf(await client.callTool({ name: 'list_screens', arguments: { prototypeId: EXAMPLE_PROTOTYPE_ID } }));
  const ids = screens.map((s: { id: string }) => s.id);
  for (const id of ['/index.html', '/producto.html', '/carrito.html', '/gracias.html']) assert.ok(ids.includes(id), `${label}: ${id}`);

  const html = await client.callTool({ name: 'get_screen_html', arguments: { prototypeId: EXAMPLE_PROTOTYPE_ID, screen: '/index.html' } });
  assert.notEqual((html as TextResult).isError, true, textOf(html));
  assert.match(textOf(html), /<body/i);
  assert.doesNotMatch(textOf(html), /recorder\.js/);

  const study = {
    v: 2,
    name: `Prueba ${label}`,
    prototypeId: EXAMPLE_PROTOTYPE_ID,
    blocks: [
      {
        id: 't1',
        kind: 'task',
        title: 'Comprar',
        instruction: 'Quieres regalar una planta. Encuentra una y cómprala.',
        startPath: '/index.html',
        success: { type: 'reached', path: '/gracias.html' },
        expectedPath: ['/index.html', '/producto.html', '/carrito.html', '/gracias.html'],
      },
      { id: 'q1', kind: 'scale', question: '¿Qué tan fácil fue?', max: 5, minLabel: 'Muy difícil', maxLabel: 'Muy fácil' },
    ],
  };
  const invalid = dataOf(await client.callTool({ name: 'validate_study', arguments: { study: { ...study, blocks: [] } } }));
  assert.equal(invalid.ok, false);
  const valid = dataOf(await client.callTool({ name: 'validate_study', arguments: { study } }));
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));

  const created = await client.callTool({ name: 'create_study', arguments: { study } });
  assert.notEqual((created as TextResult).isError, true, textOf(created));
  const { id, links } = dataOf(created);
  assert.match(id, /^st_/);
  assert.match(links.tryout, new RegExp(`/p/${EXAMPLE_PROTOTYPE_ID}/\\?study=${id}&tryout=1$`));
  assert.equal(links.edit, `${baseUrl}/panel/studies/${id}`);

  const report = await client.callTool({ name: 'get_report', arguments: { studyId: EXAMPLE_STUDY_ID } });
  assert.notEqual((report as TextResult).isError, true, textOf(report));
  const summary = dataOf(report);
  assert.ok(summary.participants > 0, label);
  assert.ok(summary.tasks.length > 0 && summary.insights.length > 0, label);
  assert.doesNotMatch(textOf(report), /"taps"|"rrweb"/);

  // El ejemplo ya tiene sesiones: no se cambia sin confirmar.
  const refused = await client.callTool({ name: 'update_study', arguments: { studyId: EXAMPLE_STUDY_ID, study } });
  assert.equal((refused as TextResult).isError, true);
}

test('official SDK client over stdio', { skip }, async () => {
  const client = new Client({ name: 'taptana-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin], env: { ...(process.env as Record<string, string>), TAPTANA_URL: baseUrl }, stderr: 'pipe' });
  await client.connect(transport);
  try {
    assert.equal(client.getServerVersion()?.name, 'taptana');
    await fullFlow(client, 'stdio');
  } finally {
    await client.close();
  }
});

test('official SDK client over stdio, through `taptana mcp`', { skip }, async () => {
  const client = new Client({ name: 'taptana-test', version: '1.0.0' });
  const port = new URL(baseUrl).port;
  const env = { ...(process.env as Record<string, string>) };
  delete env['TAPTANA_URL'];
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--no-warnings=ExperimentalWarning', cli, 'mcp', '--port', port], env, stderr: 'pipe' });
  await client.connect(transport);
  try {
    const protos = dataOf(await client.callTool({ name: 'list_prototypes', arguments: {} }));
    assert.ok(protos.length > 0);
  } finally {
    await client.close();
  }
});

test('official SDK client over Streamable HTTP', { skip }, async () => {
  const client = new Client({ name: 'taptana-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
  try {
    assert.equal(client.getServerVersion()?.name, 'taptana');
    await fullFlow(client, 'http');
  } finally {
    await client.close();
  }
});

test('stdio with Taptana down: tools answer with a friendly error', { skip }, async () => {
  const client = new Client({ name: 'taptana-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin], env: { ...(process.env as Record<string, string>), TAPTANA_URL: 'http://127.0.0.1:9' }, stderr: 'pipe' });
  await client.connect(transport);
  try {
    const res = (await client.callTool({ name: 'list_prototypes', arguments: {} })) as TextResult;
    assert.equal(res.isError, true);
    assert.match(textOf(res), /pnpm start/);
  } finally {
    await client.close();
  }
});
