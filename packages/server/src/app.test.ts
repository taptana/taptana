import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { SqliteStore } from './store/sqlite.js';

const proto = mkdtempSync(join(tmpdir(), 'taptana-proto-'));
writeFileSync(join(proto, 'index.html'), '<html><body><h1>Tienda</h1></body></html>');
writeFileSync(join(proto, 'app.js'), 'console.log(1)');
const pub = mkdtempSync(join(tmpdir(), 'taptana-pub-'));
writeFileSync(join(pub, 'recorder.js'), '/* recorder */');
mkdirSync(join(pub, 'panel', 'assets'), { recursive: true });
writeFileSync(join(pub, 'panel', 'index.html'), '<html><body>panel</body></html>');
writeFileSync(join(pub, 'panel', 'assets', 'x.js'), 'panel-js');

function makeApp(recordSelf = false) {
  const store = new SqliteStore(':memory:');
  return { store, app: createApp({ store, prototypeDir: proto, prototypeId: 'local', publicDir: pub, recordSelf }) };
}

test('serves html with the recorder injected and other files untouched', async () => {
  const { app } = makeApp();
  const html = await (await app.request('/')).text();
  assert.match(html, /<script src="\/__taptana\/recorder.js" data-prototype="local"><\/script>/);
  const js = await app.request('/app.js');
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(await js.text(), 'console.log(1)');
  assert.equal((await app.request('/nope.html')).status, 404);
});

test('serves the recorder bundle', async () => {
  const { app } = makeApp();
  const res = await app.request('/__taptana/recorder.js');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '/* recorder */');
});

test('accepts batches and lists sessions through the API', async () => {
  const { app } = makeApp();
  const res = await app.request('/api/v1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      v: 1,
      prototypeId: 'local',
      sessionId: 's_1',
      pageId: 'p_1',
      seq: 0,
      sentAt: 1,
      page: { path: '/', title: 'T', referrer: '', startedAt: 1 },
      device: { userAgent: 'x', screen: { width: 1, height: 1 }, viewport: { width: 1, height: 1 }, dpr: 1, touch: false, language: 'es' },
      events: [{ kind: 'rrweb', t: 1, data: {} }],
    }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, received: 1 });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');

  const list = (await (await app.request('/api/v1/sessions')).json()) as { sessions: Array<{ id: string }> };
  assert.equal(list.sessions[0]?.id, 's_1');

  const bad = await app.request('/api/v1/events', { method: 'POST', body: '{"v":1}', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
});

test('serves the panel and its assets, injecting the recorder only with recordSelf', async () => {
  const { app } = makeApp();
  assert.equal(await (await app.request('/sessions')).text(), '<html><body>panel</body></html>');
  assert.equal(await (await app.request('/sessions/s_1')).text(), '<html><body>panel</body></html>');
  assert.equal(await (await app.request('/sessions/assets/x.js')).text(), 'panel-js');

  const { app: self } = makeApp(true);
  assert.match(await (await self.request('/sessions')).text(), /data-prototype="taptana-panel"/);
});

test('studies CRUD, prototype pages and qr through the API', async () => {
  const { app } = makeApp();
  const study = {
    v: 1,
    name: 'Compra',
    prototypeId: 'local',
    tasks: [{ id: 't1', title: 'Comprar', instruction: 'Compra', success: { type: 'manual' } }],
  };
  const created = await app.request('/api/v1/studies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(study) });
  assert.equal(created.status, 201);
  const record = (await created.json()) as { id: string; name: string };
  assert.match(record.id, /^st_/);

  const bad = await app.request('/api/v1/studies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...study, tasks: [] }) });
  assert.equal(bad.status, 400);

  const put = await app.request(`/api/v1/studies/${record.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...study, name: 'Otro' }) });
  assert.equal(((await put.json()) as { name: string }).name, 'Otro');
  const list = (await (await app.request('/api/v1/studies')).json()) as { studies: Array<{ id: string }> };
  assert.equal(list.studies.length, 1);

  const pages = (await (await app.request('/api/v1/prototypes/local/pages')).json()) as { pages: Array<{ path: string }> };
  assert.deepEqual(pages.pages.map((p) => p.path), ['/index.html']);

  const qr = await app.request('/api/v1/qr.svg?text=http://192.168.1.2:4321/?study=st_1');
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml');
  assert.match(await qr.text(), /<svg/);

  const del = await app.request(`/api/v1/studies/${record.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await app.request(`/api/v1/studies/${record.id}`)).status, 404);
});

test('manual results through PATCH', async () => {
  const { app, store } = makeApp();
  const saved = store.saveStudy({ v: 1, name: 'S', prototypeId: 'local', tasks: [{ id: 't1', title: 'T', instruction: 'I', success: { type: 'manual' } }] });
  store.ingestBatch({
    v: 1, prototypeId: 'local', sessionId: 's_9', pageId: 'p_9', seq: 0, sentAt: 1,
    page: { path: '/', title: 'T', referrer: '', startedAt: 1 },
    events: [
      { kind: 'taptana', type: 'study', t: 1, studyId: saved.id, action: 'start' },
      { kind: 'taptana', type: 'task', t: 2, taskId: 't1', action: 'start' },
      { kind: 'taptana', type: 'task', t: 9, taskId: 't1', action: 'done' },
    ],
  });
  const before = (await (await app.request('/api/v1/sessions/s_9')).json()) as { tasks: Array<{ outcome: string }> };
  assert.equal(before.tasks[0]?.outcome, 'reported');
  const res = await app.request('/api/v1/sessions/s_9', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manual: { t1: 'success' } }) });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { tasks: Array<{ outcome: string }> }).tasks[0]?.outcome, 'success');
  const invalid = await app.request('/api/v1/sessions/s_9', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manual: { t1: 'maybe' } }) });
  assert.equal(invalid.status, 400);
});

test('upload a zip, serve it under /p/<id>/ with the recorder and base, replace and delete it', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const dataDir = mkdtempSync(join(tmpdir(), 'taptana-data-'));
  const store = new SqliteStore(':memory:');
  const app = createApp({ store, prototypeId: 'local', publicDir: pub, dataDir });

  assert.equal((await app.request('/')).headers.get('location'), '/sessions/prototypes');

  const zip = zipSync({ 'onb/home.html': strToU8('<html><body>home</body></html>'), 'onb/img/a.svg': strToU8('<svg/>') });
  const form = new FormData();
  form.append('file', new File([zip], 'Onboarding.zip'));
  const res = await app.request('/api/v1/prototypes', { method: 'POST', body: form });
  assert.equal(res.status, 201);
  const proto = (await res.json()) as { id: string; name: string; url: string; entryPath: string };
  assert.equal(proto.name, 'Onboarding');
  assert.equal(proto.entryPath, '/home.html');
  assert.equal(proto.url, `/p/${proto.id}/`);

  const html = await (await app.request(`/p/${proto.id}/`)).text();
  assert.match(html, new RegExp(`data-prototype="${proto.id}" data-base="/p/${proto.id}"`));
  assert.equal((await app.request(`/p/${proto.id}/img/a.svg`)).headers.get('content-type'), 'image/svg+xml');
  assert.equal((await app.request(`/p/${proto.id}`)).status, 301);
  assert.equal((await app.request('/p/pr_nope/')).status, 404);

  const pages = (await (await app.request(`/api/v1/prototypes/${proto.id}/pages`)).json()) as { pages: Array<{ path: string }> };
  assert.deepEqual(pages.pages.map((p) => p.path), ['/home.html']);
  const list = (await (await app.request('/api/v1/prototypes')).json()) as { prototypes: Array<{ id: string }> };
  assert.deepEqual(list.prototypes.map((p) => p.id), [proto.id]);

  const again = new FormData();
  again.append('file', new File([strToU8('<p>v2</p>')], 'v2.html'));
  const put = await app.request(`/api/v1/prototypes/${proto.id}`, { method: 'PUT', body: again });
  assert.equal(((await put.json()) as { name: string }).name, 'Onboarding');
  assert.match(await (await app.request(`/p/${proto.id}/`)).text(), /v2/);

  const bad = new FormData();
  bad.append('file', new File([strToU8('x')], 'x.pdf'));
  assert.equal((await app.request('/api/v1/prototypes', { method: 'POST', body: bad })).status, 400);

  assert.equal((await app.request(`/api/v1/prototypes/${proto.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await app.request(`/p/${proto.id}/`)).status, 404);
});
