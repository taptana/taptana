import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXAMPLE_PROTOTYPE_ID } from '@taptana/shared';
import { createApp } from './app.js';
import { DEFAULT_EXAMPLE_DIR, DEFAULT_SEED_DIR } from './example.js';
import { SqliteStore } from './store/sqlite.js';

const REMOTE = 'x-test-remote';
const LAN = '192.0.2.77';
const KEY = 'llave-de-prueba-1234567890';

function makeApp() {
  const pub = mkdtempSync(join(tmpdir(), 'taptana-mcp-pub-'));
  mkdirSync(join(pub, 'panel'), { recursive: true });
  writeFileSync(join(pub, 'panel', 'index.html'), '<html></html>');
  const dataDir = mkdtempSync(join(tmpdir(), 'taptana-mcp-data-'));
  const store = new SqliteStore(':memory:');
  const app = createApp({
    store,
    prototypeId: 'local',
    publicDir: pub,
    dataDir,
    panelKey: KEY,
    exampleDir: DEFAULT_EXAMPLE_DIR,
    seedDir: DEFAULT_SEED_DIR,
    remoteAddress: (c) => c.req.header(REMOTE),
    info: { version: '9.9.9', participantUrl: 'http://192.168.1.5:4321/', prototypeId: '', prototypeName: '' },
  });
  return { app, store };
}

const rpc = (method: string, params?: unknown, id: number | null = 1) =>
  JSON.stringify({ jsonrpc: '2.0', ...(id !== null && { id }), method, ...(params !== undefined && { params }) });
const post = (body: string, headers: Record<string, string> = {}): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body });

test('/mcp: a local connection works; the tools go through the same API', async () => {
  const { app } = makeApp();
  const init = await app.request('/mcp', post(rpc('initialize', { protocolVersion: '2025-06-18' })));
  assert.equal(init.status, 200);
  assert.match(init.headers.get('content-type') ?? '', /application\/json/);
  const body = (await init.json()) as { result: { protocolVersion: string } };
  assert.equal(body.result.protocolVersion, '2025-06-18');

  assert.equal((await app.request('/mcp', post(rpc('notifications/initialized', undefined, null)))).status, 202);
  assert.equal((await app.request('/mcp', { method: 'GET' })).status, 405);
  assert.equal((await app.request('/mcp', post('{'))).status, 400);

  assert.equal((await app.request('/api/v1/example', { method: 'POST' })).status, 200);
  const res = await app.request('/mcp', post(rpc('tools/call', { name: 'list_screens', arguments: { prototypeId: EXAMPLE_PROTOTYPE_ID } })));
  const text = ((await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } }).result;
  assert.equal(text.isError, undefined);
  assert.match(text.content[0]?.text ?? '', /\/gracias\.html/);

  const info = await app.request('/mcp', post(rpc('tools/call', { name: 'get_info' })));
  const infoText = ((await info.json()) as { result: { content: Array<{ text: string }> } }).result.content[0]?.text ?? '';
  assert.match(infoText, /9\.9\.9/);
  assert.match(infoText, /http:\/\/localhost\/panel/);
  assert.doesNotMatch(infoText, new RegExp(KEY));
});

test('/mcp passes through the panel guard: other devices need the key (header or Bearer)', async () => {
  const { app } = makeApp();
  const remote = { [REMOTE]: LAN };
  const denied = await app.request('/mcp', post(rpc('tools/list'), remote));
  assert.equal(denied.status, 401);
  assert.equal((await app.request('/mcp', post(rpc('tools/list'), { ...remote, authorization: 'Bearer otra-llave' }))).status, 401);

  for (const auth of [{ authorization: `Bearer ${KEY}` }, { 'x-taptana-key': KEY }]) {
    const ok = await app.request('/mcp', post(rpc('tools/list'), { ...remote, ...auth }));
    assert.equal(ok.status, 200, JSON.stringify(auth));
    const { result } = (await ok.json()) as { result: { tools: unknown[] } };
    assert.ok(result.tools.length > 5);
  }
  // Bearer vale solo para el MCP: la API sigue igual.
  assert.equal((await app.request('/api/v1/studies', { headers: { ...remote, authorization: `Bearer ${KEY}` } })).status, 401);
});

test('/mcp rejects requests from other websites, even with the key', async () => {
  const { app } = makeApp();
  const res = await app.request('/mcp', post(rpc('tools/list'), { origin: 'https://malo.example', authorization: `Bearer ${KEY}` }));
  assert.equal(res.status, 403);
  const site = await app.request('/mcp', post(rpc('tools/list'), { 'sec-fetch-site': 'cross-site' }));
  assert.equal(site.status, 403);
});
