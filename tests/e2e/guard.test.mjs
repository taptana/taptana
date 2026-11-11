// Guardia del panel, sin navegador: qué es público, qué no, y que el MCP responde en local.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudy, miniStudy, startTestServer, uploadFixture } from './lib/harness.mjs';

let server, proto, study;
// Una cabecera de proxy hace que la conexión ya no cuente como "de esta computadora"
// (así lo decide panel-guard.ts), aunque el socket sea local: sirve para simular a alguien en la red.
const REMOTE = { 'x-forwarded-for': '203.0.113.9' };

before(async () => {
  server = await startTestServer();
  proto = await uploadFixture(server.origin);
  study = await createStudy(server.origin, miniStudy(proto.id));
});
after(() => server?.stop());

const get = (path, headers = {}) => fetch(`${server.origin}${path}`, { headers, redirect: 'manual' });
const post = (path, body, headers = {}) =>
  fetch(`${server.origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('endpoints públicos (participante) sin llave, también desde la red', () => {
  test('GET /api/v1/studies/:id', async () => {
    const res = await get(`/api/v1/studies/${study.id}`, REMOTE);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).id, study.id);
  });

  test('GET /api/v1/info devuelve una versión reducida', async () => {
    const local = await (await get('/api/v1/info')).json();
    const res = await get('/api/v1/info', REMOTE);
    assert.equal(res.status, 200);
    const remote = await res.json();
    assert.ok(Object.keys(remote).length <= Object.keys(local).length);
    assert.ok(!JSON.stringify(remote).includes(readFileSync(join(server.dataDir, 'panel.key'), 'utf8').trim()), 'la llave no debe salir en /info');
  });

  test('POST /api/v1/events acepta un lote (aunque venga de la red)', async () => {
    const res = await post('/api/v1/events', { prototypeId: proto.id, sessionId: 's_guardia_test', pageId: 'p1', seq: 0, events: [] }, REMOTE);
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
  });
});

describe('el resto está protegido', () => {
  test('la API con conexión no local responde 401 y no filtra datos', async () => {
    for (const path of ['/api/v1/sessions', '/api/v1/studies', '/api/v1/prototypes', `/api/v1/studies/${study.id}/report`]) {
      const res = await get(path, REMOTE);
      assert.equal(res.status, 401, path);
      assert.ok(!(await res.text()).includes(study.name), `${path} filtró datos`);
    }
  });

  test('el panel y /mcp con conexión no local responden 401', async () => {
    assert.equal((await get('/panel', REMOTE)).status, 401);
    const mcp = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, REMOTE);
    assert.equal(mcp.status, 401);
  });

  test('con la llave correcta sí entra, y con una incorrecta no', async () => {
    const key = readFileSync(join(server.dataDir, 'panel.key'), 'utf8').trim();
    assert.equal((await get('/api/v1/sessions', { ...REMOTE, 'x-taptana-key': key })).status, 200);
    assert.equal((await get('/api/v1/sessions', { ...REMOTE, 'x-taptana-key': 'x'.repeat(24) })).status, 401);
    const bearer = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { ...REMOTE, authorization: `Bearer ${key}` });
    assert.equal(bearer.status, 200);
  });

  test('una petición de otro sitio web es rechazada (403) aunque sea local', async () => {
    assert.equal((await get('/api/v1/sessions', { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await get('/api/v1/sessions', { origin: 'https://sitio-malo.example' })).status, 403);
  });
});

describe('local', () => {
  test('POST /mcp tools/list responde con herramientas', async () => {
    const res = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { accept: 'application/json, text/event-stream' });
    assert.equal(res.status, 200);
    const { result } = await res.json();
    const names = result.tools.map((t) => t.name);
    assert.ok(names.includes('create_study') && names.includes('get_report'), names.join(','));
  });

  test('la API local funciona sin llave', async () => {
    assert.equal((await get('/api/v1/sessions')).status, 200);
  });
});
