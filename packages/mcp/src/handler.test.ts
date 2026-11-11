import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { type Study, type StudyRecord, type StudyReport } from '@taptana/shared';
import { FriendlyError, type ApiRequest, type ApiResponse } from './api.js';
import { createMcpHandler, LATEST_PROTOCOL_VERSION, type JsonRpcResponse } from './handler.js';
import { handleHttpBody } from './http.js';
import { runStdio, unreachableMessage } from './stdio.js';
import { TOOLS } from './tools.js';

const PROTO = { id: 'pr_tienda', name: 'Tienda', source: 'upload', url: '/p/pr_tienda/', createdAt: 1 };
const SCREENS = [
  { id: '/index.html', label: 'index', name: 'Inicio', source: 'file' },
  { id: '/producto.html', label: 'producto', name: 'Producto', source: 'file' },
  { id: '/gracias.html', label: 'gracias', name: 'Gracias', source: 'file' },
];

const goodStudy = (): Study => ({
  v: 2,
  name: 'Compra',
  prototypeId: 'pr_tienda',
  blocks: [
    {
      id: 't1',
      kind: 'task',
      title: 'Comprar',
      instruction: 'Compra una planta.',
      startPath: '/index.html',
      success: { type: 'reached', path: '/gracias.html' },
      expectedPath: ['/index.html', '/producto.html', '/gracias.html'],
    },
    { id: 'q1', kind: 'text', question: '¿Qué cambiarías?' },
  ],
});

const REPORT = {
  studyId: 'st_1',
  participants: 2,
  bounced: 1,
  completed: 2,
  successRate: 0.5,
  medianDurationMs: 90_000,
  avgMisclickRate: 0.1,
  score: 62,
  excluded: 0,
  pendingReview: 0,
  devices: { touch: 2, desktop: 0 },
  insights: [{ level: 'bad', text: 'La mitad no llegó a Gracias.', blockId: 't1' }],
  variants: [],
  order: [],
  screenNames: { '/index.html': 'Inicio', '/producto.html': 'Producto', '/gracias.html': 'Gracias' },
  tasks: [
    {
      taskId: 't1',
      title: 'Comprar',
      kind: 'task',
      participants: 2,
      decided: 2,
      outcomes: { direct: 1, indirect: 0, reported: 0, failed: 1, incomplete: 0, review: 0 },
      successRate: 0.5,
      directRate: 0.5,
      score: 62,
      medianTimeMs: 12_340,
      avgMisclicks: 1,
      misclickRate: 0.1,
      tapCount: 10,
      expectedPath: ['/index.html', '/producto.html', '/gracias.html'],
      expectedPathInferred: false,
      funnel: [
        { path: '/index.html', reached: 2 },
        { path: '/producto.html', reached: 2 },
        { path: '/gracias.html', reached: 1 },
      ],
      screens: [
        {
          path: '/producto.html',
          visitors: 2,
          avgTimeMs: 1000,
          taps: [{ x: 1, y: 2, vw: 390, misclick: true, sessionId: 's1' }],
          misclicks: 2,
          viewportWidth: 390,
          topMisclicks: [{ label: 'Foto', count: 2 }],
        },
      ],
      paths: [{ pages: ['/index.html', '/producto.html', '/gracias.html'], count: 1, successes: 1 }],
      results: [{ sessionId: 's1', outcome: 'direct', misclicks: 0, pages: [], who: 'Ana' }],
      byVariant: [],
    },
  ],
  questions: [{ blockId: 'q1', kind: 'text', question: '¿Qué cambiarías?', responses: 1, skipped: 0, texts: [{ sessionId: 's1', text: 'El botón', who: 'Ana' }] }],
} as unknown as StudyReport;

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

/** Una API de Taptana de mentira, en memoria. */
function fakeApi(opts: { sessions?: number; locked?: boolean } = {}) {
  const calls: Call[] = [];
  const studies = new Map<string, StudyRecord>();
  studies.set('st_1', { ...goodStudy(), id: 'st_1', createdAt: 1, updatedAt: 2 });
  const reply = (status: number, data: unknown): ApiResponse => ({ status, data });
  const request: ApiRequest = async (method, path, body) => {
    calls.push({ method, path, ...(body !== undefined && { body }) });
    if (opts.locked) return reply(401, { error: 'cerrado' });
    const [route = '', query = ''] = path.replace('/api/v1', '').split('?');
    if (method === 'GET' && route === '/info') return reply(200, { version: '1.2.3', participantUrl: 'http://192.168.1.5:4321/', mode: 'local' });
    if (method === 'GET' && route === '/prototypes') return reply(200, { prototypes: [PROTO] });
    if (method === 'GET' && route === '/prototypes/pr_tienda/screens') return reply(200, { screens: SCREENS });
    if (method === 'GET' && route === '/studies') return reply(200, { studies: [...studies.values()] });
    if (method === 'GET' && route === '/sessions') {
      const n = query.includes('study=st_1') || query === '' ? (opts.sessions ?? 0) : 0;
      return reply(200, { sessions: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, studyId: 'st_1' })) });
    }
    const studyMatch = /^\/studies\/([^/]+)(\/report|\/duplicate)?$/.exec(route);
    if (studyMatch) {
      const id = decodeURIComponent(studyMatch[1] ?? '');
      const found = studies.get(id);
      if (!found) return reply(404, { error: 'No existe este estudio.' });
      if (studyMatch[2] === '/report') return reply(200, REPORT);
      if (studyMatch[2] === '/duplicate' && method === 'POST') {
        const copy = { ...found, id: 'st_copy', name: `Copia de ${found.name}` };
        studies.set(copy.id, copy);
        return reply(201, copy);
      }
      if (method === 'PUT') {
        const saved = { ...(body as Study), id, createdAt: 1, updatedAt: 3 };
        studies.set(id, saved);
        return reply(200, saved);
      }
      return reply(200, found);
    }
    if (method === 'POST' && route === '/studies') {
      const saved = { ...(body as Study), id: 'st_new', createdAt: 5, updatedAt: 5 };
      studies.set(saved.id, saved);
      return reply(201, saved);
    }
    if (method === 'POST' && route === '/prototypes') {
      assert.ok(body instanceof FormData);
      return reply(201, { id: 'pr_nuevo', name: body.get('name'), source: 'upload', url: '/p/pr_nuevo/', createdAt: 9 });
    }
    return reply(404, { error: 'No existe esta ruta de la API.' });
  };
  return { request, calls, studies };
}

let nextId = 1;
async function rpc(handler: ReturnType<typeof createMcpHandler>, method: string, params?: unknown): Promise<JsonRpcResponse> {
  const res = await handler.handle({ jsonrpc: '2.0', id: nextId++, method, ...(params !== undefined && { params }) });
  assert.ok(res && !Array.isArray(res));
  return res;
}

async function tool(handler: ReturnType<typeof createMcpHandler>, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(handler, 'tools/call', { name, arguments: args });
  assert.equal(res.error, undefined, JSON.stringify(res.error));
  const result = res.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  const text = result.content[0]?.text ?? '';
  const brace = text.search(/[[{]/);
  let data: unknown = null;
  try {
    data = brace === -1 ? null : JSON.parse(text.slice(brace));
  } catch {
    data = null;
  }
  return { isError: result.isError === true, text, data: data as Record<string, any> };
}

const setup = (opts?: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi(opts);
  return { ...api, handler: createMcpHandler({ request: api.request, panelUrl: 'http://localhost:4321/' }) };
};

// ── Protocolo ────────────────────────────────────────────────────────────

test('initialize answers with the requested version when known, otherwise the latest', async () => {
  const { handler } = setup();
  const known = await rpc(handler, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  const result = known.result as { protocolVersion: string; serverInfo: { name: string }; capabilities: Record<string, unknown>; instructions: string };
  assert.equal(result.protocolVersion, '2025-03-26');
  assert.equal(result.serverInfo.name, 'taptana');
  assert.ok(result.capabilities['tools'] && result.capabilities['prompts']);
  assert.match(result.instructions, /get_study_format/);
  const unknown = await rpc(handler, 'initialize', { protocolVersion: '1999-01-01' });
  assert.equal((unknown.result as { protocolVersion: string }).protocolVersion, LATEST_PROTOCOL_VERSION);
});

test('notifications get no answer; ping, unknown methods and bad messages do', async () => {
  const { handler } = setup();
  assert.equal(await handler.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.deepEqual((await rpc(handler, 'ping')).result, {});
  assert.equal((await rpc(handler, 'resources/list')).error?.code, -32601);
  const bad = await handler.handle({ hola: 1 });
  assert.ok(bad && !Array.isArray(bad));
  assert.equal(bad.error?.code, -32600);
  // Una respuesta del cliente se ignora.
  assert.equal(await handler.handle({ jsonrpc: '2.0', id: 3, result: {} }), null);
});

test('batches answer every request and skip notifications', async () => {
  const { handler } = setup();
  const res = await handler.handle([
    { jsonrpc: '2.0', id: 'a', method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 'b', method: 'nada' },
  ]);
  assert.ok(Array.isArray(res));
  assert.deepEqual(
    res.map((r) => r.id),
    ['a', 'b'],
  );
  assert.equal(await handler.handle([{ jsonrpc: '2.0', method: 'notifications/initialized' }]), null);
});

test('tools/list declares every tool with schema and annotations, and no delete tool', async () => {
  const { handler } = setup();
  const { tools } = (await rpc(handler, 'tools/list')).result as { tools: Array<{ name: string; description: string; inputSchema: { type: string }; annotations: Record<string, unknown> }> };
  assert.deepEqual(
    tools.map((t) => t.name),
    ['get_info', 'get_study_format', 'list_prototypes', 'list_screens', 'list_studies', 'get_study', 'validate_study', 'create_study', 'update_study', 'duplicate_study', 'get_report', 'upload_prototype'],
  );
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(typeof t.annotations['readOnlyHint'], 'boolean', t.name);
    assert.ok(t.description.length > 40, t.name);
    assert.doesNotMatch(t.name, /delete|remove/);
  }
  assert.equal(tools.find((t) => t.name === 'get_report')?.annotations['readOnlyHint'], true);
  assert.equal(tools.find((t) => t.name === 'create_study')?.annotations['readOnlyHint'], false);
});

test('an unknown tool is a protocol error', async () => {
  const { handler } = setup();
  assert.equal((await rpc(handler, 'tools/call', { name: 'delete_everything' })).error?.code, -32602);
});

test('prompts: armar_estudio walks the whole flow and carries the goal', async () => {
  const { handler } = setup();
  const { prompts } = (await rpc(handler, 'prompts/list')).result as { prompts: Array<{ name: string }> };
  assert.deepEqual(
    prompts.map((p) => p.name),
    ['armar_estudio'],
  );
  const got = (await rpc(handler, 'prompts/get', { name: 'armar_estudio', arguments: { goal: 'si encuentran el carrito' } })).result as {
    messages: Array<{ role: string; content: { text: string } }>;
  };
  const text = got.messages[0]?.content.text ?? '';
  assert.match(text, /si encuentran el carrito/);
  const order = ['get_study_format', 'list_prototypes', 'list_screens', 'validate_study', 'create_study', 'tryout'].map((w) => text.indexOf(w));
  assert.ok(order.every((n, i) => n > -1 && (i === 0 || n > (order[i - 1] ?? 0))), order.join(','));
  assert.equal((await rpc(handler, 'prompts/get', { name: 'otro' })).error?.code, -32602);
});

// ── Herramientas ─────────────────────────────────────────────────────────

test('get_info: version and links, never the panel key', async () => {
  const { handler } = setup();
  const res = await tool(handler, 'get_info');
  assert.equal(res.isError, false);
  assert.equal(res.data['version'], '1.2.3');
  assert.equal(res.data['panelUrl'], 'http://localhost:4321/panel');
  assert.match(res.data['shareLinkFormat'], /^http:\/\/192\.168\.1\.5:4321\/p\/<prototypeId>\/\?study=<studyId>$/);
  assert.doesNotMatch(res.text, /key=/);
});

test('get_study_format returns the guide', async () => {
  const { handler } = setup();
  const res = await tool(handler, 'get_study_format');
  assert.match(res.text, /list_screens/);
  assert.match(res.text, /first-click/);
});

test('list_prototypes and list_screens', async () => {
  const { handler } = setup();
  const protos = await tool(handler, 'list_prototypes');
  assert.deepEqual(protos.data, [{ id: 'pr_tienda', name: 'Tienda', url: '/p/pr_tienda/' }]);
  const screens = await tool(handler, 'list_screens', { prototypeId: 'pr_tienda' });
  assert.deepEqual(screens.data[0], { id: '/index.html', name: 'Inicio', source: 'file' });
  const missing = await tool(handler, 'list_screens', { prototypeId: 'pr_no' });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /list_prototypes/);
  const noArg = await tool(handler, 'list_screens', {});
  assert.equal(noArg.isError, true);
  assert.match(noArg.text, /prototypeId/);
});

test('list_studies counts tasks and sessions; get_study brings links', async () => {
  const { handler } = setup({ sessions: 3 });
  const list = await tool(handler, 'list_studies');
  assert.equal(list.data[0].id, 'st_1');
  assert.equal(list.data[0].tasks, 1);
  assert.equal(list.data[0].sessions, 3);
  const one = await tool(handler, 'get_study', { studyId: 'st_1' });
  assert.equal(one.data['sessions'], 3);
  assert.equal(one.data['links'].tryout, 'http://192.168.1.5:4321/p/pr_tienda/?study=st_1&tryout=1');
  assert.equal(one.data['links'].share, 'http://192.168.1.5:4321/p/pr_tienda/?study=st_1');
  assert.equal(one.data['links'].edit, 'http://localhost:4321/panel/studies/st_1');
  const missing = await tool(handler, 'get_study', { studyId: 'st_no' });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /No existe este estudio/);
});

test('validate_study: same errors as the panel, plus unknown screens and prototypes', async () => {
  const { handler, calls } = setup();
  const good = await tool(handler, 'validate_study', { study: goodStudy() });
  assert.equal(good.isError, false);
  assert.equal(good.data['ok'], true);
  assert.deepEqual(good.data['errors'], []);
  assert.equal(good.data['study'].v, 2);

  const wrongScreen = goodStudy();
  (wrongScreen.blocks[0] as { success: unknown }).success = { type: 'reached', path: '/pago.html' };
  const warned = await tool(handler, 'validate_study', { study: wrongScreen });
  assert.equal(warned.data['ok'], true);
  assert.ok(warned.data['warnings'].some((w: { message: string; field: string }) => /\/pago\.html/.test(w.message) && w.field === 'success.path'));

  const broken = { v: 2, name: '', prototypeId: 'pr_tienda', blocks: [{ id: 't1', kind: 'task', title: 'x' }] };
  const bad = await tool(handler, 'validate_study', { study: broken });
  assert.equal(bad.data['ok'], false);
  assert.ok(bad.data['errors'].length > 0);
  assert.ok(bad.data['errors'].every((e: { message: string }) => typeof e.message === 'string'));

  const other = await tool(handler, 'validate_study', { study: { ...goodStudy(), prototypeId: 'pr_otro' } });
  assert.equal(other.data['ok'], false);
  assert.match(other.data['errors'][0].message, /pr_otro/);

  // Como texto JSON también vale.
  const asText = await tool(handler, 'validate_study', { study: JSON.stringify(goodStudy()) });
  assert.equal(asText.data['ok'], true);
  const notJson = await tool(handler, 'validate_study', { study: '{ nope' });
  assert.equal(notJson.isError, true);

  assert.ok(calls.every((c) => c.method === 'GET'), 'validar no guarda nada');
});

test('create_study saves a valid study and refuses an invalid one', async () => {
  const { handler, calls, studies } = setup();
  const res = await tool(handler, 'create_study', { study: goodStudy() });
  assert.equal(res.isError, false);
  assert.equal(res.data['id'], 'st_new');
  assert.equal(res.data['links'].tryout, 'http://192.168.1.5:4321/p/pr_tienda/?study=st_new&tryout=1');
  assert.ok(studies.has('st_new'));

  const before = calls.filter((c) => c.method === 'POST').length;
  const bad = await tool(handler, 'create_study', { study: { v: 2, name: 'x', prototypeId: 'pr_tienda', blocks: [] } });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /No guardé/);
  assert.equal(calls.filter((c) => c.method === 'POST').length, before);
});

test('update_study refuses a study with sessions unless confirm, and keeps the prototype', async () => {
  const withSessions = setup({ sessions: 2 });
  const refused = await tool(withSessions.handler, 'update_study', { studyId: 'st_1', study: goodStudy() });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /duplicate_study/);
  assert.ok(!withSessions.calls.some((c) => c.method === 'PUT'));
  const forced = await tool(withSessions.handler, 'update_study', { studyId: 'st_1', study: goodStudy(), confirm: true });
  assert.equal(forced.isError, false);

  const fresh = setup();
  const { prototypeId: _drop, ...noProto } = goodStudy();
  const updated = await tool(fresh.handler, 'update_study', { studyId: 'st_1', study: { ...noProto, name: 'Nuevo nombre' } });
  assert.equal(updated.isError, false);
  assert.equal(fresh.studies.get('st_1')?.name, 'Nuevo nombre');
  assert.equal(fresh.studies.get('st_1')?.prototypeId, 'pr_tienda');
});

test('duplicate_study returns the copy with links', async () => {
  const { handler } = setup();
  const res = await tool(handler, 'duplicate_study', { studyId: 'st_1' });
  assert.equal(res.data['id'], 'st_copy');
  assert.match(res.data['links'].edit, /st_copy$/);
  assert.equal((await tool(handler, 'duplicate_study', { studyId: 'st_no' })).isError, true);
});

test('get_report: compact summary, filters passed through, no heatmap points or names', async () => {
  const { handler, calls } = setup();
  const res = await tool(handler, 'get_report', { studyId: 'st_1', device: 'touch', variant: 'A' });
  assert.equal(res.isError, false);
  assert.ok(calls.some((c) => c.path === '/api/v1/studies/st_1/report?variant=A&device=touch'));
  const task = res.data['tasks'][0];
  assert.equal(res.data['score'], 62);
  assert.equal(task.successPercent, 50);
  assert.equal(task.medianSeconds, 12.3);
  assert.deepEqual(task.expectedPath, ['Inicio', 'Producto', 'Gracias']);
  assert.deepEqual(
    task.funnel.map((f: { droppedHere: number }) => f.droppedHere),
    [0, 0, 1],
  );
  assert.equal(task.misclickScreens[0].name, 'Producto');
  assert.deepEqual(res.data['questions'][0].answers, ['El botón']);
  assert.doesNotMatch(res.text, /"taps"|"sessionId"|Ana/);
});

test('upload_prototype sends the HTML as a file', async () => {
  const { handler, calls } = setup();
  const res = await tool(handler, 'upload_prototype', { name: 'Mi app', html: '<html><body>Hola</body></html>' });
  assert.equal(res.isError, false);
  assert.equal(res.data['id'], 'pr_nuevo');
  const body = calls.find((c) => c.method === 'POST')?.body as FormData;
  const file = body.get('file') as File;
  assert.equal(file.name, 'index.html');
  assert.match(await file.text(), /Hola/);
  assert.equal((await tool(handler, 'upload_prototype', { name: 'x', html: ' ' })).isError, true);
});

test('a locked Taptana explains how to pass the key; an unreachable one says to start it', async () => {
  const locked = setup({ locked: true });
  const res = await tool(locked.handler, 'list_prototypes');
  assert.equal(res.isError, true);
  assert.match(res.text, /TAPTANA_KEY/);
  assert.match(res.text, /Authorization: Bearer/);

  const down = createMcpHandler({
    request: async () => {
      throw new FriendlyError(unreachableMessage('http://localhost:4321'));
    },
  });
  const r = await tool(down, 'list_studies');
  assert.equal(r.isError, true);
  assert.match(r.text, /pnpm start/);

  const boom = createMcpHandler({
    request: async () => {
      throw new Error('kaput');
    },
  });
  const b = await tool(boom, 'get_info');
  assert.equal(b.isError, true);
  assert.match(b.text, /kaput/);
});

test('every tool answers (no protocol error) with a fake API', async () => {
  const { handler } = setup();
  const args: Record<string, Record<string, unknown>> = {
    list_screens: { prototypeId: 'pr_tienda' },
    get_study: { studyId: 'st_1' },
    validate_study: { study: goodStudy() },
    create_study: { study: goodStudy() },
    update_study: { studyId: 'st_1', study: goodStudy() },
    duplicate_study: { studyId: 'st_1' },
    get_report: { studyId: 'st_1' },
    upload_prototype: { name: 'n', html: '<p>x</p>' },
  };
  for (const t of TOOLS) {
    const res = await tool(handler, t.name, args[t.name] ?? {});
    assert.equal(res.isError, false, `${t.name}: ${res.text}`);
  }
});

// ── Transportes ──────────────────────────────────────────────────────────

test('HTTP body: JSON reply, 202 for notifications, 400 for broken JSON', async () => {
  const { handler } = setup();
  const reply = await handleHttpBody(handler, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.json, { jsonrpc: '2.0', id: 1, result: {} });
  assert.deepEqual(await handleHttpBody(handler, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), { status: 202 });
  const broken = await handleHttpBody(handler, '{');
  assert.equal(broken.status, 400);
  assert.equal((broken.json as JsonRpcResponse).error?.code, -32700);
});

test('stdio: one JSON message per line, only protocol on stdout', async () => {
  const { request } = fakeApi();
  const input = new PassThrough();
  const output = new PassThrough();
  let out = '';
  output.on('data', (chunk: Buffer) => (out += chunk.toString()));
  const done = runStdio({ input, output, request });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  input.write('esto no es json\n');
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_prototypes' } })}\n`);
  input.end();
  await done;
  const lines = out.trim().split('\n').map((l) => JSON.parse(l) as JsonRpcResponse);
  assert.equal(lines.length, 3);
  const byId = new Map(lines.map((l) => [l.id, l]));
  assert.equal((byId.get(1)?.result as { protocolVersion: string }).protocolVersion, '2025-06-18');
  assert.equal(byId.get(null)?.error?.code, -32700);
  assert.match(JSON.stringify(byId.get(2)?.result), /pr_tienda/);
});
