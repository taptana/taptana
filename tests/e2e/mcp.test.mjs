// MCP por HTTP (POST /mcp): una IA crea un estudio y el panel lo muestra; no puede pisar uno con sesiones.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, launch, startTestServer, withContext } from './lib/harness.mjs';

let server, browser;
let nextId = 1;

before(async () => {
  server = await startTestServer();
  ({ browser } = await launch());
  await api(server.origin, '/example', { method: 'POST' });
});
after(async () => {
  await browser?.close();
  await server?.stop();
});

async function rpc(method, params) {
  const res = await fetch(`${server.origin}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, ...(params && { params }) }),
  });
  assert.equal(res.status, 200, `${method} → ${res.status}`);
  return (await res.json());
}
const callTool = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;
const textOf = (result) => result.content.map((c) => c.text).join('\n');

const STUDY = {
  v: 2,
  name: 'Estudio hecho por una IA',
  prototypeId: 'pr_ejemplo',
  blocks: [
    { id: 't1', kind: 'task', title: 'Llegar al carrito', instruction: 'Abre el carrito.', startPath: '/index.html', success: { type: 'reached', path: '/carrito.html' } },
    { id: 'q1', kind: 'yesno', question: '¿Te resultó claro?' },
  ],
};

describe('MCP', () => {
  test('initialize y tools/list', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
    assert.ok(init.result.protocolVersion);
    const tools = (await rpc('tools/list')).result.tools.map((t) => t.name);
    for (const n of ['create_study', 'update_study', 'list_studies', 'get_report']) assert.ok(tools.includes(n), `falta ${n}`);
  });

  test('create_study guarda el estudio y aparece en la lista del panel', async (t) => {
    const result = await callTool('create_study', { study: STUDY });
    assert.ok(!result.isError, textOf(result));
    assert.match(textOf(result), /st_\w+/);
    const { studies } = await api(server.origin, '/studies');
    assert.ok(studies.some((s) => s.name === STUDY.name), 'el estudio no está en la API');

    await withContext(browser, t.name, { viewport: { width: 1280, height: 800 } }, async (context) => {
      const page = await context.newPage();
      await page.goto(`${server.origin}/panel/studies`);
      await page.getByText(STUDY.name).first().waitFor({ timeout: 15000 });
    });
  });

  test('update_study sobre un estudio con sesiones se rechaza sin confirm', async () => {
    const before = await api(server.origin, '/studies/st_demo_compra');
    const result = await callTool('update_study', { studyId: 'st_demo_compra', study: { ...before, name: 'Nombre cambiado por la IA' } });
    assert.equal(result.isError, true, textOf(result));
    assert.match(textOf(result), /ya tiene .*sesiones.*confirm: true/s);
    assert.equal((await api(server.origin, '/studies/st_demo_compra')).name, before.name, 'el estudio cambió aunque se rechazó');
  });
});
