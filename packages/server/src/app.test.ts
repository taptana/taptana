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
