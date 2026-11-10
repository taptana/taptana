import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
  EVENTS_BODY_MAX_BYTES,
  EXAMPLE_PROTOTYPE_ID,
  EXAMPLE_PROTOTYPE_NAME,
  EXAMPLE_STUDY_ID,
  SESSION_LIMITS,
  type Prototype,
  type ScreenInfo,
  type ServerInfo,
  type SessionExport,
  type SessionSummary,
  type Study,
  type StudyRecord,
  type StudyReport,
  type TaptanaEvent,
} from '@taptana/shared';
import { createApp, type AppOptions } from './app.js';
import { DEFAULT_EXAMPLE_DIR, DEFAULT_SEED_DIR } from './example.js';
import { SqliteStore } from './store/sqlite.js';

const tmp = (name: string): string => mkdtempSync(join(tmpdir(), `taptana-${name}-`));

const proto = tmp('proto');
writeFileSync(join(proto, 'index.html'), '<html><body><h1>Tienda</h1></body></html>');
writeFileSync(join(proto, 'app.js'), 'console.log(1)');
writeFileSync(join(proto, '.env'), 'SECRETO=1');
mkdirSync(join(proto, 'docs'));
writeFileSync(join(proto, 'docs', 'index.html'), '<html><body>docs</body></html>');
const pub = tmp('pub');
writeFileSync(join(pub, 'recorder.js'), '/* recorder */');
mkdirSync(join(pub, 'panel', 'assets'), { recursive: true });
writeFileSync(join(pub, 'panel', 'index.html'), '<html><body>panel</body></html>');
writeFileSync(join(pub, 'panel', 'assets', 'x.js'), 'panel-js');

const REMOTE = 'x-test-remote';
const LAN = '192.0.2.77';
const HTML = { accept: 'text/html,application/xhtml+xml' };
const JSON_HEADERS = { 'content-type': 'application/json' };

function makeApp(options: Partial<AppOptions> = {}) {
  const store = new SqliteStore(':memory:');
  const app = createApp({ store, prototypeDir: proto, prototypeId: 'local', publicDir: pub, remoteAddress: (c) => c.req.header(REMOTE), ...options });
  return { store, app };
}

/** Sin carpeta local: como `taptana start`, con prototipos subidos desde el panel. */
function makeUploadApp(options: Partial<AppOptions> = {}) {
  const store = new SqliteStore(':memory:');
  const dataDir = tmp('data');
  const app = createApp({ store, prototypeId: 'local', publicDir: pub, dataDir, remoteAddress: (c) => c.req.header(REMOTE), ...options });
  return { store, app, dataDir };
}

const send = (method: string, body: unknown): RequestInit => ({ method, headers: JSON_HEADERS, body: JSON.stringify(body) });

async function upload(app: ReturnType<typeof createApp>, name: string, bytes: Uint8Array, path = '/api/v1/prototypes', method = 'POST'): Promise<Response> {
  const form = new FormData();
  form.append('file', new File([bytes], name));
  return app.request(path, { method, body: form });
}

const study: Study = {
  v: 2,
  name: 'Compra en Verde',
  prototypeId: 'local',
  blocks: [
    { id: 't1', title: 'Comprar', instruction: 'Compra una planta', success: { type: 'reached', path: '/gracias.html' } },
    { id: 't2', title: 'Envío', instruction: 'Averigua el envío', success: { type: 'manual' } },
    { id: 'q1', kind: 'scale', question: '¿Qué tan fácil fue?', max: 5 },
  ],
  variants: [
    { id: 'A', name: 'Original' },
    { id: 'B', name: 'Nueva' },
  ],
};

const batchOf = (sessionId: string, events: TaptanaEvent[], touch = true, seq = 0) => ({
  v: 1,
  prototypeId: 'local',
  sessionId,
  pageId: `p_${sessionId}`,
  seq,
  sentAt: 1,
  page: { path: '/index.html', title: 'T', referrer: '', startedAt: 1 },
  device: { userAgent: 'x', screen: { width: 390, height: 800 }, viewport: { width: 390, height: 700 }, dpr: 2, touch, language: 'es' },
  events,
});

/** Una sesión del estudio: empieza la tarea 1 y, si `reaches`, llega a la meta. */
function participant(studyId: string, variantId: string, reaches: boolean, answer: number): TaptanaEvent[] {
  const events: TaptanaEvent[] = [
    { kind: 'taptana', type: 'study', t: 1000, studyId, variantId, action: 'start' },
    { kind: 'taptana', type: 'navigation', t: 1001, from: '', to: '/index.html' },
    { kind: 'taptana', type: 'task', t: 1100, taskId: 't1', action: 'start' },
  ];
  if (reaches) events.push({ kind: 'taptana', type: 'navigation', t: 3000, from: '/index.html', to: '/gracias.html' });
  else events.push({ kind: 'taptana', type: 'task', t: 3000, taskId: 't1', action: 'skip' });
  events.push({ kind: 'taptana', type: 'task', t: 3100, taskId: 't2', action: 'start' }, { kind: 'taptana', type: 'task', t: 4000, taskId: 't2', action: 'done' });
  events.push({ kind: 'taptana', type: 'answer', t: 5000, blockId: 'q1', value: answer }, { kind: 'taptana', type: 'study', t: 5100, studyId, action: 'finish' });
  return events;
}

// ── Prototipo en carpeta ───────────────────────────────────────────────

test('serves html with the recorder injected and other files untouched', async () => {
  const { app } = makeApp();
  const html = await (await app.request('/')).text();
  assert.match(html, /<script src="\/__taptana\/recorder.js" data-prototype="local"><\/script>/);
  const js = await app.request('/app.js');
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(await js.text(), 'console.log(1)');
  assert.equal((await app.request('/nope.html')).status, 404);
  assert.equal((await app.request('/nope.html', { headers: HTML })).status, 404);
});

test('never serves dot files of the folder', async () => {
  const { app } = makeApp();
  for (const path of ['/.env', '/%2Eenv', '/.git/config', '/docs/../.env']) {
    const res = await app.request(path);
    assert.equal(res.status, 404, path);
    assert.ok(!(await res.text()).includes('SECRETO'));
  }
});

test('folder mode: single page apps, folders without slash, cache validators, ranges and form posts', async () => {
  const { app } = makeApp();
  // Una ruta de app (sin extensión) que no existe y pide HTML recibe la página de entrada.
  const spa = await app.request('/checkout/pago', { headers: HTML });
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /<h1>Tienda<\/h1>[\s\S]*data-prototype="local"/);
  assert.equal((await app.request('/checkout/pago')).status, 404, 'sin pedir HTML no hay respaldo');
  assert.equal((await app.request('/css/no-existe.css', { headers: HTML })).status, 404, 'un archivo que falta es un 404');

  const folder = await app.request('/docs?x=1');
  assert.equal(folder.status, 302);
  assert.equal(folder.headers.get('location'), '/docs/?x=1');
  assert.match(await (await app.request('/docs/')).text(), /docs/);

  const js = await app.request('/app.js');
  const etag = js.headers.get('etag');
  assert.ok(etag);
  assert.equal(js.headers.get('accept-ranges'), 'bytes');
  assert.equal((await app.request('/app.js', { headers: { 'if-none-match': etag } })).status, 304);
  const part = await app.request('/app.js', { headers: { range: 'bytes=8-10' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 8-10/14');
  assert.equal(await part.text(), 'log');
  const beyond = await app.request('/app.js', { headers: { range: 'bytes=99-' } });
  assert.equal(beyond.status, 416);
  assert.equal(beyond.headers.get('content-range'), 'bytes */14');

  const post = await app.request('/docs/?ok=1', { method: 'POST', body: 'nombre=Ana' });
  assert.equal(post.status, 303);
  assert.equal(post.headers.get('location'), '/docs/?ok=1');
});

test('serves the recorder bundle', async () => {
  const { app } = makeApp();
  const res = await app.request('/__taptana/recorder.js');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '/* recorder */');
  assert.equal((await makeApp({ publicDir: tmp('vacio') }).app.request('/__taptana/recorder.js')).status, 404);
});

// ── Eventos ────────────────────────────────────────────────────────────

test('accepts batches, ignores repeated ones and lists sessions through the API', async () => {
  const { app } = makeApp();
  const batch = batchOf('s_1', [{ kind: 'rrweb', t: 1, data: {} }]);
  const res = await app.request('/api/v1/events', send('POST', batch));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, received: 1 });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');

  // El mismo lote otra vez (un reintento): no se duplica.
  const again = await app.request('/api/v1/events', send('POST', batch));
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { ok: true, received: 0 });
  // Como lo manda sendBeacon: texto plano.
  const beacon = await app.request('/api/v1/events', { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ ...batch, seq: 1 }) });
  assert.deepEqual(await beacon.json(), { ok: true, received: 1 });

  const list = (await (await app.request('/api/v1/sessions')).json()) as { sessions: SessionSummary[] };
  assert.equal(list.sessions.length, 1);
  assert.equal(list.sessions[0]?.id, 's_1');
  assert.equal((await ((await app.request('/api/v1/sessions/s_1/events')).json() as Promise<{ events: unknown[] }>)).events.length, 2);
  const other = (await (await app.request('/api/v1/sessions?prototype=otro')).json()) as { sessions: unknown[] };
  assert.equal(other.sessions.length, 0);
});

test('invalid batches answer 400 with a message, never 500', async () => {
  const { app, store } = makeApp();
  const good = batchOf('s_1', [{ kind: 'rrweb', t: 1, data: {} }]);
  const cases: Array<[string, unknown]> = [
    ['solo versión', { v: 1 }],
    ['no es objeto', [1, 2, 3]],
    ['null', null],
    ['device roto', { ...good, device: { userAgent: 'x' } }],
    ['device no es objeto', { ...good, device: 'iphone' }],
    ['page rota', { ...good, page: { path: 1 } }],
    ['eventos no son lista', { ...good, events: 'muchos' }],
    ['evento sin forma', { ...good, events: [{ hola: 1 }] }],
    ['id con barra', { ...good, sessionId: '../../x' }],
    ['seq negativo', { ...good, seq: -1 }],
    ['seq con decimales', { ...good, seq: 1.5 }],
  ];
  for (const [name, body] of cases) {
    const res = await app.request('/api/v1/events', send('POST', body));
    assert.equal(res.status, 400, name);
    const { error } = (await res.json()) as { error: string };
    assert.match(error, /^Lote inválido/, name);
  }
  const broken = await app.request('/api/v1/events', { method: 'POST', headers: JSON_HEADERS, body: '{"v":1,' });
  assert.equal(broken.status, 400);
  assert.match(((await broken.json()) as { error: string }).error, /JSON válido/);
  assert.equal((await app.request('/api/v1/events', { method: 'POST' })).status, 400);
  assert.equal(store.listSessions().length, 0);

  // Eventos de un tipo que esta versión no conoce se descartan; el resto del lote se guarda.
  const mixed = await app.request('/api/v1/events', send('POST', batchOf('s_2', [{ kind: 'rrweb', t: 1, data: {} }, { kind: 'taptana', type: 'del-futuro', t: 2 } as unknown as TaptanaEvent])));
  assert.deepEqual(await mixed.json(), { ok: true, received: 1 });
});

test('bodies over the limit answer 413, with or without content-length', async () => {
  const { app } = makeApp();
  const declared = await app.request('/api/v1/events', { method: 'POST', headers: { ...JSON_HEADERS, 'content-length': String(EVENTS_BODY_MAX_BYTES + 1) }, body: '{}' });
  assert.equal(declared.status, 413);
  assert.match(((await declared.json()) as { error: string }).error, /16 MB/);

  // Sin content-length (envío por trozos) el límite se cuenta mientras llega.
  const chunk = new Uint8Array(1024 * 1024).fill(32);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ < 18) controller.enqueue(chunk);
      else controller.close();
    },
  });
  const streamed = await app.request('/api/v1/events', { method: 'POST', headers: { ...JSON_HEADERS, 'transfer-encoding': 'chunked' }, body: stream, duplex: 'half' } as RequestInit);
  assert.equal(streamed.status, 413);

  const bigStudy = await app.request('/api/v1/studies', { method: 'POST', headers: { ...JSON_HEADERS, 'content-length': String(2 * 1024 * 1024) }, body: '{}' });
  assert.equal(bigStudy.status, 413);
  const bigPatch = await app.request('/api/v1/sessions/s_1', { method: 'PATCH', headers: { ...JSON_HEADERS, 'content-length': String(1024 * 1024) }, body: '{}' });
  assert.equal(bigPatch.status, 413);
});

// ── Panel ──────────────────────────────────────────────────────────────

test('serves the panel at /panel and its assets, injecting the recorder only with recordSelf', async () => {
  const { app } = makeApp();
  assert.equal(await (await app.request('/panel')).text(), '<html><body>panel</body></html>');
  assert.equal(await (await app.request('/panel/')).text(), '<html><body>panel</body></html>');
  assert.equal(await (await app.request('/panel/recordings/s_1.5?t=1200')).text(), '<html><body>panel</body></html>');
  assert.equal(await (await app.request('/panel/studies/st_1/report')).text(), '<html><body>panel</body></html>');
  const asset = await app.request('/panel/assets/x.js');
  assert.equal(await asset.text(), 'panel-js');
  assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
  assert.equal((await app.request('/panel/assets/viejo.js')).status, 404);

  const { app: self } = makeApp({ recordSelf: true });
  assert.match(await (await self.request('/panel')).text(), /data-prototype="taptana-panel"/);
});

test('without a compiled panel there is a placeholder instead of an error', async () => {
  const { app } = makeApp({ publicDir: tmp('vacio') });
  const res = await app.request('/panel/studies');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /El panel todavía no está compilado/);
});

test('the old /sessions addresses redirect to the new ones', async () => {
  const { app } = makeApp();
  const cases: Array<[string, string]> = [
    ['/sessions', '/panel'],
    ['/sessions/', '/panel'],
    ['/sessions?prototype=pr_1', '/panel?prototype=pr_1'],
    ['/sessions/s_abc123', '/panel/recordings/s_abc123'],
    ['/sessions/s_abc123?x=1', '/panel/recordings/s_abc123?x=1'],
    ['/sessions/studies', '/panel/studies'],
    ['/sessions/studies/new', '/panel/studies/new'],
    ['/sessions/studies/st_1/report', '/panel/studies/st_1/report'],
    ['/sessions/prototypes', '/panel/prototypes'],
    ['/sessions/assets/x.js', '/panel/assets/x.js'],
  ];
  for (const [from, to] of cases) {
    const res = await app.request(from);
    assert.equal(res.status, 302, from);
    assert.equal(res.headers.get('location'), to, from);
  }
});

// ── Estudios ───────────────────────────────────────────────────────────

test('studies CRUD (v1 and v2), duplicate, screens, pages and qr through the API', async () => {
  const { app, store } = makeApp();
  const v1 = {
    v: 1,
    name: 'Compra',
    prototypeId: 'local',
    tasks: [{ id: 't1', title: 'Comprar', instruction: 'Compra', success: { type: 'manual' } }],
  };
  const created = await app.request('/api/v1/studies', send('POST', v1));
  assert.equal(created.status, 201);
  const record = (await created.json()) as StudyRecord;
  assert.match(record.id, /^st_/);
  assert.equal(record.v, 2);
  assert.deepEqual(record.blocks.map((b) => b.id), ['t1']);

  // Los errores llegan en español, con `issues` para pintarlos junto al campo.
  const bad = await app.request('/api/v1/studies', send('POST', { ...v1, name: '', tasks: [] }));
  assert.equal(bad.status, 400);
  const problem = (await bad.json()) as { error: string; issues: Array<{ message: string; field?: string }> };
  assert.equal(problem.error, 'Ponle un nombre al estudio');
  assert.ok(problem.issues.some((i) => i.field === 'blocks'));
  assert.equal((await app.request('/api/v1/studies', { method: 'POST', headers: JSON_HEADERS, body: 'no es json' })).status, 400);
  assert.equal((await app.request('/api/v1/studies', send('POST', 'hola'))).status, 400);

  const put = await app.request(`/api/v1/studies/${record.id}`, send('PUT', { ...study, name: 'Otro', closed: true }));
  const updated = (await put.json()) as StudyRecord;
  assert.equal(updated.name, 'Otro');
  assert.equal(updated.closed, true);
  assert.equal(updated.blocks.length, 3);
  assert.equal((await app.request('/api/v1/studies/st_nope', send('PUT', study))).status, 404);
  assert.equal((await app.request(`/api/v1/studies/${record.id}`, send('PUT', { ...study, blocks: [] }))).status, 400);

  const copyRes = await app.request(`/api/v1/studies/${record.id}/duplicate`, { method: 'POST' });
  assert.equal(copyRes.status, 201);
  const copy = (await copyRes.json()) as StudyRecord;
  assert.equal(copy.name, 'Copia de Otro');
  assert.notEqual(copy.id, record.id);
  assert.equal(copy.closed, undefined);
  assert.ok(copy.blocks.every((b) => !updated.blocks.some((o) => o.id === b.id)));
  assert.equal((await app.request('/api/v1/studies/st_nope/duplicate', { method: 'POST' })).status, 404);
  const list = (await (await app.request('/api/v1/studies')).json()) as { studies: StudyRecord[] };
  assert.equal(list.studies.length, 2);

  store.ingestBatch(batchOf('s_1', [{ kind: 'taptana', type: 'navigation', t: 5, from: '', to: '/index.html#/carrito', title: 'Tu carrito' }]) as never);
  const screens = (await (await app.request('/api/v1/prototypes/local/screens')).json()) as { screens: ScreenInfo[] };
  assert.deepEqual(screens.screens, [
    { id: '/index.html', label: 'inicio', source: 'file' },
    { id: '/docs/index.html', label: 'docs', source: 'file' },
    { id: '/index.html#/carrito', label: 'carrito', source: 'seen', title: 'Tu carrito' },
  ]);
  const pages = (await (await app.request('/api/v1/prototypes/local/pages')).json()) as { pages: Array<{ path: string }> };
  assert.deepEqual(pages.pages.map((p) => p.path), ['/index.html', '/docs/index.html']);
  assert.deepEqual(await (await app.request('/api/v1/prototypes/no-existe/screens')).json(), { screens: [] });

  const qr = await app.request('/api/v1/qr.svg?text=http://192.168.1.2:4321/?study=st_1');
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml');
  assert.match(await qr.text(), /<svg/);
  assert.equal((await app.request('/api/v1/qr.svg')).status, 400);
  assert.equal((await app.request(`/api/v1/qr.svg?text=${'x'.repeat(2001)}`)).status, 400);

  const del = await app.request(`/api/v1/studies/${record.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await app.request(`/api/v1/studies/${record.id}`)).status, 404);
  assert.equal((await app.request(`/api/v1/studies/${record.id}`, { method: 'DELETE' })).status, 404);

  const missing = await app.request('/api/v1/no-existe');
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type') ?? '', /json/);
});

test('report with filters and csv export', async () => {
  const { app, store } = makeApp();
  const saved = store.saveStudy(study);
  store.ingestBatch(batchOf('s_a', participant(saved.id, 'A', true, 5), true) as never);
  store.ingestBatch(batchOf('s_b', participant(saved.id, 'B', false, 2), false) as never);
  store.ingestBatch(batchOf('s_c', participant(saved.id, 'B', true, 4), true) as never);
  store.ingestBatch(batchOf('s_interna', participant(saved.id, 'A', false, 1), true) as never);
  store.setSessionFields('s_interna', { excluded: true });
  store.setSessionFields('s_a', { label: 'P1 · Ana' });

  const all = (await (await app.request(`/api/v1/studies/${saved.id}/report`)).json()) as StudyReport;
  assert.equal(all.studyId, saved.id);
  assert.equal(all.participants, 3);
  assert.equal(all.excluded, 1);
  assert.equal(all.pendingReview, 3);
  assert.deepEqual(all.devices, { touch: 2, desktop: 1 });
  assert.deepEqual(all.order, [
    { blockId: 't1', kind: 'task' },
    { blockId: 't2', kind: 'task' },
    { blockId: 'q1', kind: 'scale' },
  ]);
  assert.equal(all.tasks[0]?.participants, 3);
  assert.equal(all.tasks[0]?.outcomes.failed, 1);
  assert.equal(all.tasks[1]?.outcomes.review, 3);
  assert.equal(all.questions[0]?.responses, 3);
  assert.equal(all.filter, undefined);
  assert.ok(Array.isArray(all.insights));

  const variantB = (await (await app.request(`/api/v1/studies/${saved.id}/report?variant=B`)).json()) as StudyReport;
  assert.equal(variantB.participants, 2);
  assert.deepEqual(variantB.filter, { variantId: 'B' });
  const desktop = (await (await app.request(`/api/v1/studies/${saved.id}/report?device=desktop`)).json()) as StudyReport;
  assert.equal(desktop.participants, 1);
  assert.equal(desktop.tasks[0]?.outcomes.failed, 1);
  const both = (await (await app.request(`/api/v1/studies/${saved.id}/report?variant=B&device=touch`)).json()) as StudyReport;
  assert.equal(both.participants, 1);
  assert.deepEqual(both.filter, { variantId: 'B', device: 'touch' });
  assert.equal((await app.request(`/api/v1/studies/${saved.id}/report?device=reloj`)).status, 400);
  assert.equal((await app.request('/api/v1/studies/st_nope/report')).status, 404);

  // Marcar una tarea manual la saca de "por revisar".
  const patched = await app.request('/api/v1/sessions/s_a', send('PATCH', { manual: { t2: 'success' } }));
  assert.equal(patched.status, 200);
  const after = (await (await app.request(`/api/v1/studies/${saved.id}/report`)).json()) as StudyReport;
  assert.equal(after.pendingReview, 2);

  const csv = await app.request(`/api/v1/studies/${saved.id}/export.csv`);
  assert.equal(csv.status, 200);
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(csv.headers.get('content-disposition'), 'attachment; filename="compra-en-verde.csv"');
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await csv.arrayBuffer());
  const lines = text.trim().split('\r\n');
  assert.equal(lines.length, 4, 'encabezado + 3 participantes (la excluida no sale)');
  assert.ok(text.charCodeAt(0) === 0xfeff, 'empieza con BOM para Excel');
  assert.match(lines[0] ?? '', /sesión,etiqueta,fecha/);
  assert.ok(lines.some((line) => line.startsWith('s_a,P1 · Ana,')));
  assert.ok(!text.includes('s_interna'));
  assert.equal((await app.request('/api/v1/studies/st_nope/export.csv')).status, 404);
});

// ── Sesiones ───────────────────────────────────────────────────────────

test('PATCH /sessions/:id: label, notes, excluded and manual marks, with validation', async () => {
  const { app, store } = makeApp();
  const saved = store.saveStudy(study);
  store.ingestBatch(batchOf('s_9', participant(saved.id, 'A', false, 3)) as never);

  const before = (await (await app.request('/api/v1/sessions/s_9')).json()) as SessionSummary;
  assert.deepEqual(before.tasks?.map((t) => t.outcome), ['failed', 'reported']);
  assert.deepEqual(before.answers, [{ blockId: 'q1', value: 3, t: 5000 }]);
  assert.equal(before.screenCount, 1);

  const res = await app.request('/api/v1/sessions/s_9', send('PATCH', { manual: { t2: 'success' }, label: '  P3 · Ana ', notes: 'Buscó el envío en el pie', excluded: true }));
  assert.equal(res.status, 200);
  const after = (await res.json()) as SessionSummary;
  assert.equal(after.tasks?.[1]?.outcome, 'success');
  assert.equal(after.label, 'P3 · Ana');
  assert.equal(after.notes, 'Buscó el envío en el pie');
  assert.equal(after.excluded, true);

  // Solo cambia lo que viene. Vacío borra.
  const cleared = (await (await app.request('/api/v1/sessions/s_9', send('PATCH', { label: '', excluded: false }))).json()) as SessionSummary;
  assert.equal(cleared.label, undefined);
  assert.equal(cleared.excluded, undefined);
  assert.equal(cleared.notes, 'Buscó el envío en el pie');
  assert.equal(cleared.tasks?.[1]?.outcome, 'success');

  const invalid: unknown[] = [
    { manual: { t1: 'maybe' } },
    { manual: 'success' },
    { label: 'x'.repeat(SESSION_LIMITS.label + 1) },
    { label: 5 },
    { notes: 'x'.repeat(SESSION_LIMITS.notes + 1) },
    { notes: ['a'] },
    { excluded: 'si' },
    'hola',
    null,
  ];
  for (const body of invalid) {
    const bad = await app.request('/api/v1/sessions/s_9', send('PATCH', body));
    assert.equal(bad.status, 400, JSON.stringify(body).slice(0, 40));
    assert.ok(((await bad.json()) as { error: string }).error.length > 0);
  }
  assert.equal((await app.request('/api/v1/sessions/s_9', { method: 'PATCH', headers: JSON_HEADERS, body: '{' })).status, 400);
  assert.equal((await app.request('/api/v1/sessions/s_nope', send('PATCH', { label: 'x' }))).status, 404);
  assert.equal(store.getSession('s_9')?.notes, 'Buscó el envío en el pie');

  const file = await app.request('/api/v1/sessions/s_9/export');
  assert.match(file.headers.get('content-disposition') ?? '', /^attachment; filename="taptana-s-9-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(((await file.json()) as SessionExport).v, 1);

  assert.equal((await app.request('/api/v1/sessions/s_9', { method: 'DELETE' })).status, 200);
  assert.equal((await app.request('/api/v1/sessions/s_9', { method: 'DELETE' })).status, 404);
  assert.equal((await app.request('/api/v1/sessions/s_9')).status, 404);
});

test('import: 409 when the session exists unless ?replace=1; unknown prototypes show up as "Importado"', async () => {
  const { app, store } = makeUploadApp();
  const file: SessionExport = {
    v: 1,
    exportedAt: 1,
    session: {
      id: 's_imp',
      prototypeId: 'pr_deOtraLaptop',
      startedAt: 10,
      lastSeenAt: 50,
      durationMs: 40,
      deviceLabel: 'Android · Chrome 129',
      viewport: { width: 400, height: 800 },
      touch: true,
      entryPath: '/',
      pageCount: 1,
      tapCount: 1,
    },
    pages: [{ id: 'p_same', path: '/', title: 'Home', referrer: '', startedAt: 10 }],
    events: [
      { kind: 'rrweb', t: 10, data: {} },
      { kind: 'taptana', type: 'tap', t: 20, x: 0, y: 0, target: { tag: 'a', selector: 'a' } },
    ],
  };
  const first = await app.request('/api/v1/sessions/import', send('POST', file));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, id: 's_imp', replaced: false });

  // Otra sesión de otro archivo con el mismo id de página no choca.
  const other = await app.request('/api/v1/sessions/import', send('POST', { ...file, session: { ...file.session, id: 's_imp2' } }));
  assert.equal(other.status, 200);

  store.setSessionFields('s_imp', { label: 'Con mis notas' });
  const again = await app.request('/api/v1/sessions/import', send('POST', file));
  assert.equal(again.status, 409);
  const conflict = (await again.json()) as { error: string; id: string };
  assert.equal(conflict.id, 's_imp');
  assert.match(conflict.error, /ya está aquí/);
  assert.equal(store.getSession('s_imp')?.label, 'Con mis notas', 'no se reemplazó en silencio');

  const replaced = await app.request('/api/v1/sessions/import?replace=1', send('POST', file));
  assert.deepEqual(await replaced.json(), { ok: true, id: 's_imp', replaced: true });
  assert.equal(store.getSession('s_imp')?.label, undefined);
  assert.equal(store.listSessions().length, 2);

  // El prototipo que no existía aparece en la lista, con nombre claro y sin dirección que abrir.
  const list = (await (await app.request('/api/v1/prototypes')).json()) as { prototypes: Prototype[] };
  assert.deepEqual(list.prototypes.map((p) => [p.id, p.name, p.source, p.url, p.sessionCount]), [['pr_deOtraLaptop', 'Importado', undefined, undefined, 2]]);
  // Y se puede borrar con sus sesiones.
  assert.equal((await app.request('/api/v1/prototypes/pr_deOtraLaptop', { method: 'DELETE' })).status, 200);
  assert.equal(store.listSessions().length, 0);

  for (const body of [{ v: 1 }, { v: 2, session: file.session, events: [] }, { ...file, session: { ...file.session, id: '../x' } }, { ...file, events: 'no' }, [], 'hola']) {
    const bad = await app.request('/api/v1/sessions/import', send('POST', body));
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /no es una sesión exportada de Taptana/);
  }
  assert.equal((await app.request('/api/v1/sessions/import', { method: 'POST', headers: JSON_HEADERS, body: '<html>' })).status, 400);
});

// ── Prototipos subidos ─────────────────────────────────────────────────

test('upload a zip, serve it under /p/<id>/ with the recorder and base, replace and delete it', async () => {
  const { app, dataDir } = makeUploadApp();

  const zip = zipSync({ 'onb/home.html': strToU8('<html><body>home</body></html>'), 'onb/img/a.svg': strToU8('<svg/>') });
  const res = await upload(app, 'Onboarding.zip', zip);
  assert.equal(res.status, 201);
  const created = (await res.json()) as Prototype;
  assert.equal(created.name, 'Onboarding');
  assert.equal(created.entryPath, '/home.html');
  assert.equal(created.url, `/p/${created.id}/`);
  assert.equal(created.source, 'upload');
  assert.equal(created.absoluteUrls, undefined);
  assert.equal(created.root, undefined);
  const base = `/p/${created.id}`;

  // La entrada no es index.html: se redirige a su archivo, con el link del estudio intacto.
  const entry = await app.request(`${base}/?study=st_1`);
  assert.equal(entry.status, 302);
  assert.equal(entry.headers.get('location'), `${base}/home.html?study=st_1`);
  const html = await (await app.request(`${base}/home.html`)).text();
  assert.match(html, new RegExp(`data-prototype="${created.id}" data-base="${base}"`));
  assert.equal((await app.request(`${base}/img/a.svg`)).headers.get('content-type'), 'image/svg+xml');
  assert.equal((await app.request(base)).status, 301);
  assert.equal((await app.request('/p/pr_nope/')).status, 404);
  assert.equal((await app.request(`${base}/.env`)).status, 404);

  const screens = (await (await app.request(`/api/v1/prototypes/${created.id}/screens`)).json()) as { screens: ScreenInfo[] };
  assert.deepEqual(screens.screens.map((s) => s.id), ['/home.html']);
  const list = (await (await app.request('/api/v1/prototypes')).json()) as { prototypes: Prototype[] };
  assert.deepEqual(list.prototypes.map((p) => p.id), [created.id]);

  const put = await upload(app, 'v2.html', strToU8('<p>v2</p>'), `/api/v1/prototypes/${created.id}`, 'PUT');
  assert.equal(((await put.json()) as Prototype).name, 'Onboarding');
  assert.match(await (await app.request(`${base}/`)).text(), /v2/);

  // Una versión nueva que no sirve no rompe la que ya estaba.
  const broken = await upload(app, 'v3.zip', strToU8('esto no es un zip'), `/api/v1/prototypes/${created.id}`, 'PUT');
  assert.equal(broken.status, 400);
  assert.match(await (await app.request(`${base}/`)).text(), /v2/);

  assert.equal((await upload(app, 'x.pdf', strToU8('x'))).status, 400);
  assert.equal((await app.request('/api/v1/prototypes', { method: 'POST', body: new FormData() })).status, 400);
  assert.equal((await app.request('/api/v1/prototypes', { method: 'POST', headers: JSON_HEADERS, body: '{}' })).status, 400);
  assert.equal((await upload(app, 'x.html', strToU8('x'), '/api/v1/prototypes/pr_nope', 'PUT')).status, 404);
  const big = await app.request('/api/v1/prototypes', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(80 * 1024 * 1024) }, body: 'x' });
  assert.equal(big.status, 413);
  assert.equal(readFileSync(join(dataDir, 'prototypes', created.id, 'index.html'), 'utf8'), '<p>v2</p>');

  const rename = await app.request(`/api/v1/prototypes/${created.id}`, send('PATCH', { name: '  Onboarding nuevo ' }));
  assert.equal(((await rename.json()) as Prototype).name, 'Onboarding nuevo');
  for (const body of [{}, { name: '' }, { name: 5 }, { name: 'x'.repeat(200) }, { root: 'si' }]) {
    assert.equal((await app.request(`/api/v1/prototypes/${created.id}`, send('PATCH', body))).status, 400, JSON.stringify(body).slice(0, 30));
  }
  assert.equal((await app.request('/api/v1/prototypes/pr_nope', send('PATCH', { name: 'x' }))).status, 404);

  assert.equal((await app.request(`/api/v1/prototypes/${created.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await app.request(`${base}/`)).status, 404);
  assert.ok(!existsSync(join(dataDir, 'prototypes', created.id)));
  assert.equal((await app.request(`/api/v1/prototypes/${created.id}`, { method: 'DELETE' })).status, 404);
});

test('uploaded single page apps: fallback to the entry page and absolute paths through the Referer', async () => {
  const { app } = makeUploadApp();
  const zip = zipSync({
    'index.html': strToU8('<html><head><link rel="stylesheet" href="/css/app.css"></head><body><a href="/checkout/">Pagar</a></body></html>'),
    'css/app.css': strToU8('body{}'),
    'checkout/index.html': strToU8('<html><body>checkout</body></html>'),
  });
  const created = (await (await upload(app, 'spa.zip', zip)).json()) as Prototype;
  const base = `/p/${created.id}`;
  assert.equal(created.absoluteUrls, true, 'el panel puede sugerir abrirlo en la raíz');

  // Ruta de la app (History API) al recargar: recibe la página de entrada.
  const deep = await app.request(`${base}/producto/42`, { headers: HTML });
  assert.equal(deep.status, 200);
  assert.match(await deep.text(), new RegExp(`Pagar[\\s\\S]*data-base="${base}"`));
  assert.equal((await app.request(`${base}/producto/42`)).status, 404);
  assert.equal((await app.request(`${base}/img/falta.png`, { headers: HTML })).status, 404);

  // "/css/app.css" se sale de /p/<id>/: la página que lo pide dice de dónde viene.
  const referer = `http://localhost${base}/index.html`;
  const css = await app.request('/css/app.css?v=2', { headers: { referer } });
  assert.equal(css.status, 307);
  assert.equal(css.headers.get('location'), `${base}/css/app.css?v=2`);
  const nav = await app.request('/checkout/', { headers: { referer, ...HTML } });
  assert.equal(nav.headers.get('location'), `${base}/checkout/`);
  assert.match(await (await app.request(`${base}/checkout/`)).text(), /checkout/);
  const home = await app.request('/', { headers: { referer: `http://localhost${base}/checkout/`, ...HTML } });
  assert.equal(home.headers.get('location'), `${base}/`);

  // Sin Referer de un prototipo no hay nada que adivinar.
  assert.equal((await app.request('/css/app.css')).status, 404);
  assert.equal((await app.request('/css/app.css', { headers: { referer: 'http://localhost/p/pr_noExiste/index.html' } })).status, 404);
  assert.equal((await app.request('/css/app.css', { headers: { referer: 'http://localhost/panel/prototypes' } })).status, 404);
  // Las rutas de la API nunca se confunden con rutas del prototipo.
  const api = await app.request('/api/v1/no-existe', { headers: { referer, ...HTML } });
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type') ?? '', /json/);
});

test('"open at the root": one uploaded prototype is also served at /, without data-base', async () => {
  const { app, store } = makeUploadApp();
  const one = (await (await upload(app, 'uno.zip', zipSync({ 'index.html': strToU8('<html><body>uno<script src="/app.js"></script></body></html>'), 'app.js': strToU8('1') }))).json()) as Prototype;
  const two = (await (await upload(app, 'dos.html', strToU8('<html><body>dos</body></html>'))).json()) as Prototype;

  assert.match(await (await app.request('/', { headers: HTML })).text(), /Abre el link que te compartieron/);

  const res = await app.request(`/api/v1/prototypes/${one.id}`, send('PATCH', { root: true }));
  assert.equal(res.status, 200);
  const rooted = (await res.json()) as Prototype;
  assert.equal(rooted.root, true);
  assert.equal(rooted.url, '/');

  const home = await (await app.request('/', { headers: HTML })).text();
  assert.match(home, /uno/);
  assert.match(home, new RegExp(`data-prototype="${one.id}"></script>`));
  assert.ok(!home.includes('data-base'));
  assert.equal(await (await app.request('/app.js')).text(), '1');
  // App de una sola página en la raíz: una ruta suya al recargar.
  assert.match(await (await app.request('/checkout', { headers: HTML })).text(), /uno/);
  assert.equal((await app.request('/falta.png', { headers: HTML })).status, 404);
  // Sigue disponible en su dirección de siempre.
  assert.match(await (await app.request(`/p/${one.id}/`)).text(), new RegExp(`data-base="/p/${one.id}"`));

  // Solo uno a la vez.
  await app.request(`/api/v1/prototypes/${two.id}`, send('PATCH', { root: true }));
  const list = (await (await app.request('/api/v1/prototypes')).json()) as { prototypes: Prototype[] };
  assert.deepEqual(
    list.prototypes.map((p) => [p.id, p.root, p.url]).sort(),
    [
      [one.id, undefined, `/p/${one.id}/`],
      [two.id, true, '/'],
    ].sort(),
  );
  assert.match(await (await app.request('/', { headers: HTML })).text(), /dos/);

  const off = (await (await app.request(`/api/v1/prototypes/${two.id}`, send('PATCH', { root: false }))).json()) as Prototype;
  assert.equal(off.root, undefined);
  assert.equal(off.url, `/p/${two.id}/`);
  assert.match(await (await app.request('/', { headers: HTML })).text(), /Abre el link que te compartieron/);

  // Borrar el prototipo que está en la raíz la deja libre.
  await app.request(`/api/v1/prototypes/${one.id}`, send('PATCH', { root: true }));
  await app.request(`/api/v1/prototypes/${one.id}`, { method: 'DELETE' });
  assert.equal(store.getRootPrototype(), null);
  assert.match(await (await app.request('/', { headers: HTML })).text(), /Abre el link que te compartieron/);
});

test('with a local folder the root belongs to the folder', async () => {
  const dataDir = tmp('data');
  const { app, store } = makeApp({ dataDir });
  store.savePrototype({ id: 'local', name: 'tienda', createdAt: 1, source: 'folder', entryPath: '/' });
  const up = (await (await upload(app, 'uno.html', strToU8('<html><body>uno</body></html>'))).json()) as Prototype;
  const res = await app.request(`/api/v1/prototypes/${up.id}`, send('PATCH', { root: true }));
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /carpeta/);
  assert.match(await (await app.request('/')).text(), /Tienda/);
  const list = (await (await app.request('/api/v1/prototypes')).json()) as { prototypes: Prototype[] };
  assert.deepEqual(list.prototypes.map((p) => [p.id, p.url]).sort(), [[up.id, `/p/${up.id}/`], ['local', '/']].sort());
  // La carpeta local no se borra desde el panel.
  assert.equal((await app.request('/api/v1/prototypes/local', { method: 'DELETE' })).status, 400);
  assert.equal((await app.request('/api/v1/prototypes/local', send('PATCH', { root: true }))).status, 400);
});

// ── La raíz sin nada montado ───────────────────────────────────────────

test('the root with nothing mounted: a friendly page for a lost participant', async () => {
  const { app } = makeUploadApp();
  const local = await app.request('/', { headers: HTML });
  assert.equal(local.status, 200);
  const page = await local.text();
  assert.match(page, /<html lang="es">/);
  assert.match(page, /Abre el link que te compartieron/);
  assert.match(page, /href="\/panel"/, 'en la computadora de Taptana se ofrece el panel');

  const phone = await (await app.request('/', { headers: { ...HTML, [REMOTE]: LAN } })).text();
  assert.match(phone, /Abre el link que te compartieron/);
  assert.ok(!phone.includes('/panel'), 'a un participante no se le manda al panel');

  const missing = await app.request('/cualquier/cosa', { headers: { ...HTML, [REMOTE]: LAN } });
  assert.equal(missing.status, 404);
  assert.ok(!(await missing.text()).includes('/panel'));
});

test('/?study=<id> goes to the prototype of that study, keeping the link', async () => {
  const { app, store } = makeUploadApp();
  const created = (await (await upload(app, 'tienda.html', strToU8('<html><body>tienda</body></html>'))).json()) as Prototype;
  const saved = store.saveStudy({ ...study, prototypeId: created.id });

  const res = await app.request(`/?study=${saved.id}&variant=B`, { headers: { ...HTML, [REMOTE]: LAN } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), `/p/${created.id}/?study=${saved.id}&variant=B`);

  // Un estudio que no existe (o cuyo prototipo no está): se explica, sin mandar al panel.
  const unknown = await app.request('/?study=st_noExiste', { headers: { ...HTML, [REMOTE]: LAN } });
  assert.equal(unknown.status, 404);
  const html = await unknown.text();
  assert.match(html, /Este link de estudio no funciona/);
  assert.ok(!html.includes('/panel'));
  const orphan = store.saveStudy({ ...study, prototypeId: 'pr_sinArchivos' });
  assert.equal((await app.request(`/?study=${orphan.id}`, { headers: HTML })).status, 404);

  // Con el prototipo del estudio en la raíz no hay nada que redirigir.
  store.setRootPrototype(created.id);
  const direct = await app.request(`/?study=${saved.id}`, { headers: HTML });
  assert.equal(direct.status, 200);
  assert.match(await direct.text(), /tienda/);
  // Y un estudio de otro prototipo se va al suyo aunque haya algo en la raíz.
  const second = (await (await upload(app, 'otra.html', strToU8('<html><body>otra</body></html>'))).json()) as Prototype;
  const other = store.saveStudy({ ...study, prototypeId: second.id });
  assert.equal((await app.request(`/?study=${other.id}`)).headers.get('location'), `/p/${second.id}/?study=${other.id}`);
});

test('in folder mode a study link for an uploaded prototype is redirected too', async () => {
  const dataDir = tmp('data');
  const { app, store } = makeApp({ dataDir });
  const up = (await (await upload(app, 'uno.html', strToU8('<html><body>uno</body></html>'))).json()) as Prototype;
  const mine = store.saveStudy(study);
  const theirs = store.saveStudy({ ...study, prototypeId: up.id });
  assert.equal((await app.request(`/?study=${mine.id}`)).status, 200);
  assert.equal((await app.request(`/?study=${theirs.id}`)).headers.get('location'), `/p/${up.id}/?study=${theirs.id}`);
});

// ── Ejemplo ────────────────────────────────────────────────────────────

/** Un ejemplo en miniatura: una carpeta de prototipo y dos sesiones exportadas con su estudio v1. */
function miniExample(): { exampleDir: string; seedDir: string } {
  const exampleDir = tmp('example');
  writeFileSync(join(exampleDir, 'index.html'), '<html><body>Tienda de plantas</body></html>');
  writeFileSync(join(exampleDir, 'styles.css'), 'body{}');
  writeFileSync(join(exampleDir, 'study.json'), '{}');
  writeFileSync(join(exampleDir, 'README.md'), '# no se copia');
  const seedDir = tmp('seed');
  const embedded = {
    v: 1,
    id: EXAMPLE_STUDY_ID,
    createdAt: 1,
    updatedAt: 1,
    name: 'Compra en Verde',
    prototypeId: 'local',
    tasks: [{ id: 't1', title: 'Comprar', instruction: 'Compra', success: { type: 'reached', path: '/gracias.html' } }],
  };
  const session = (id: string, withStudy: boolean) => ({
    v: 1,
    exportedAt: 1,
    session: {
      id,
      prototypeId: 'local',
      startedAt: 1000,
      lastSeenAt: 5000,
      durationMs: 4000,
      deviceLabel: 'iPhone · Safari 26',
      viewport: { width: 390, height: 664 },
      touch: true,
      entryPath: '/',
      pageCount: 1,
      tapCount: 0,
      ...(withStudy && { studyId: EXAMPLE_STUDY_ID }),
    },
    pages: [{ id: 'p_1', path: '/', title: 'Tienda', referrer: '', startedAt: 1000 }],
    events: withStudy ? participant(EXAMPLE_STUDY_ID, 'A', true, 5) : [{ kind: 'taptana', type: 'navigation', t: 1000, from: '', to: '/' }],
    ...(withStudy && { study: embedded }),
  });
  writeFileSync(join(seedDir, '01-libre.json'), JSON.stringify(session('s_demo_libre', false)));
  writeFileSync(join(seedDir, '02-estudio.json'), JSON.stringify(session('s_demo_estudio', true)));
  writeFileSync(join(seedDir, '03-roto.json'), '{ esto no es json');
  writeFileSync(join(seedDir, 'notas.txt'), 'no es una sesión');
  return { exampleDir, seedDir };
}

test('POST /example loads the prototype, the study and the sessions, and can be repeated', async () => {
  const { app, store, dataDir } = makeUploadApp(miniExample());
  assert.equal(((await (await app.request('/api/v1/info')).json()) as ServerInfo).exampleLoaded, false);

  const res = await app.request('/api/v1/example', { method: 'POST' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { prototypeId: EXAMPLE_PROTOTYPE_ID, studyId: EXAMPLE_STUDY_ID });
  assert.equal(((await (await app.request('/api/v1/info')).json()) as ServerInfo).exampleLoaded, true);

  const list = (await (await app.request('/api/v1/prototypes')).json()) as { prototypes: Prototype[] };
  assert.deepEqual(list.prototypes.map((p) => [p.id, p.name, p.source, p.url, p.sessionCount]), [[EXAMPLE_PROTOTYPE_ID, EXAMPLE_PROTOTYPE_NAME, 'upload', `/p/${EXAMPLE_PROTOTYPE_ID}/`, 2]]);
  assert.match(await (await app.request(`/p/${EXAMPLE_PROTOTYPE_ID}/`)).text(), /Tienda de plantas[\s\S]*data-base="\/p\/pr_ejemplo"/);
  assert.equal((await app.request(`/p/${EXAMPLE_PROTOTYPE_ID}/styles.css`)).status, 200);
  assert.ok(!existsSync(join(dataDir, 'prototypes', EXAMPLE_PROTOTYPE_ID, 'study.json')));
  assert.ok(!existsSync(join(dataDir, 'prototypes', EXAMPLE_PROTOTYPE_ID, 'README.md')));

  // El estudio apunta al prototipo de ejemplo y quedó en formato de bloques.
  const saved = store.getStudy(EXAMPLE_STUDY_ID);
  assert.equal(saved?.prototypeId, EXAMPLE_PROTOTYPE_ID);
  assert.equal(saved?.v, 2);
  assert.equal(saved?.blocks.length, 1);
  // Las sesiones conservan su id y pasan al prototipo de ejemplo.
  assert.deepEqual(store.listSessions().map((s) => [s.id, s.prototypeId]).sort(), [
    ['s_demo_estudio', EXAMPLE_PROTOTYPE_ID],
    ['s_demo_libre', EXAMPLE_PROTOTYPE_ID],
  ]);
  const report = (await (await app.request(`/api/v1/studies/${EXAMPLE_STUDY_ID}/report`)).json()) as StudyReport;
  assert.equal(report.participants, 1);
  assert.equal(report.tasks[0]?.outcomes.direct, 1);
  assert.equal((await app.request(`/?study=${EXAMPLE_STUDY_ID}`)).headers.get('location'), `/p/${EXAMPLE_PROTOTYPE_ID}/?study=${EXAMPLE_STUDY_ID}`);

  // Repetir no duplica ni pisa lo que el diseñador cambió; lo borrado vuelve.
  store.setSessionFields('s_demo_estudio', { label: 'La marqué yo' });
  store.saveStudy({ ...saved!, name: 'Lo edité' }, EXAMPLE_STUDY_ID);
  store.deleteSession('s_demo_libre');
  const [a, b] = await Promise.all([app.request('/api/v1/example', { method: 'POST' }), app.request('/api/v1/example', { method: 'POST' })]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(store.listSessions().length, 2);
  assert.equal(store.listStudies().length, 1);
  assert.equal(store.listPrototypes().length, 1);
  assert.equal(store.getSession('s_demo_estudio')?.label, 'La marqué yo');
  assert.equal(store.getStudy(EXAMPLE_STUDY_ID)?.name, 'Lo edité');
});

test('POST /example moves seed sessions that were imported before under another prototype', async () => {
  const dirs = miniExample();
  const { app, store } = makeUploadApp(dirs);
  // Como quedaba con el `taptana seed` anterior: sesiones y estudio colgando del prototipo "local".
  const old = JSON.parse(readFileSync(join(dirs.seedDir, '02-estudio.json'), 'utf8')) as SessionExport;
  await app.request('/api/v1/sessions/import', send('POST', old));
  assert.equal(store.getSession('s_demo_estudio')?.prototypeId, 'local');
  assert.equal(store.getStudy(EXAMPLE_STUDY_ID)?.prototypeId, 'local');

  assert.equal((await app.request('/api/v1/example', { method: 'POST' })).status, 200);
  assert.equal(store.getSession('s_demo_estudio')?.prototypeId, EXAMPLE_PROTOTYPE_ID);
  assert.equal(store.getStudy(EXAMPLE_STUDY_ID)?.prototypeId, EXAMPLE_PROTOTYPE_ID);
  assert.equal(store.listSessions().length, 2);
});

test('POST /example explains itself when the example is not in the package', async () => {
  const { app, store } = makeUploadApp({ exampleDir: tmp('no-hay'), seedDir: tmp('no-hay') });
  const res = await app.request('/api/v1/example', { method: 'POST' });
  assert.equal(res.status, 503);
  assert.match(((await res.json()) as { error: string }).error, /El ejemplo no viene en esta instalación/);
  assert.equal(store.listPrototypes().length, 0);
  // Sin carpeta de datos no hay dónde copiarlo.
  assert.equal((await makeApp().app.request('/api/v1/example', { method: 'POST' })).status, 400);
});

test('the example shipped in the package loads and produces a report', async (t) => {
  if (!existsSync(join(DEFAULT_EXAMPLE_DIR, 'index.html')) || !existsSync(DEFAULT_SEED_DIR)) return t.skip('el paquete no está compilado con su ejemplo');
  const { app, store } = makeUploadApp();
  const res = await app.request('/api/v1/example', { method: 'POST' });
  assert.equal(res.status, 200);
  const { prototypeId, studyId } = (await res.json()) as { prototypeId: string; studyId: string };
  assert.equal(prototypeId, EXAMPLE_PROTOTYPE_ID);
  assert.equal(studyId, EXAMPLE_STUDY_ID);
  const sessions = store.listSessions();
  assert.ok(sessions.length >= 6);
  assert.ok(sessions.every((s) => s.prototypeId === EXAMPLE_PROTOTYPE_ID));
  assert.equal(store.getStudy(studyId)?.prototypeId, EXAMPLE_PROTOTYPE_ID);
  const report = (await (await app.request(`/api/v1/studies/${studyId}/report`)).json()) as StudyReport;
  assert.ok(report.participants >= 6);
  assert.ok(report.tasks.length > 0);
  assert.equal((await app.request(`/p/${EXAMPLE_PROTOTYPE_ID}/`)).status, 200);
  assert.equal((await app.request(`/p/${EXAMPLE_PROTOTYPE_ID}/study.json`)).status, 404);
  const screens = (await (await app.request(`/api/v1/prototypes/${EXAMPLE_PROTOTYPE_ID}/screens`)).json()) as { screens: ScreenInfo[] };
  assert.ok(screens.screens.some((s) => s.id === '/gracias.html'));
});
