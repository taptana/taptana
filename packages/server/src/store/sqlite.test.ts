import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventBatch, SessionExport, Study, StudyV1, TaptanaEvent } from '@taptana/shared';
import { IMPORTED_PROTOTYPE_NAME, SqliteStore } from './sqlite.js';

const device = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
  screen: { width: 390, height: 844 },
  viewport: { width: 390, height: 664 },
  dpr: 3,
  touch: true,
  language: 'es-PE',
};

function batch(partial: Partial<EventBatch>): EventBatch {
  return {
    v: 1,
    prototypeId: 'local',
    sessionId: 's_1',
    pageId: 'p_1',
    seq: 0,
    sentAt: 1000,
    events: [],
    ...partial,
  };
}

const tmpDb = (): string => join(mkdtempSync(join(tmpdir(), 'taptana-db-')), 'taptana.db');

const tap = (t: number, selector = 'a'): TaptanaEvent => ({ kind: 'taptana', type: 'tap', t, x: 1, y: 1, target: { tag: 'a', selector } });
const nav = (t: number, to: string, title?: string): TaptanaEvent => ({ kind: 'taptana', type: 'navigation', t, from: '', to, ...(title && { title }) });
const rrweb = (t: number): TaptanaEvent => ({ kind: 'rrweb', t, data: { type: 3 } });

const study: Study = {
  v: 2,
  name: 'Compra',
  prototypeId: 'local',
  blocks: [
    { id: 't1', title: 'Comprar', instruction: 'Compra', success: { type: 'reached', path: '/gracias.html' } },
    { id: 'q1', kind: 'scale', question: '¿Qué tan fácil fue?', max: 5 },
    { id: 'q2', kind: 'text', question: '¿Algo más?' },
  ],
};

test('ingests batches and lists the session', () => {
  const store = new SqliteStore(':memory:');
  store.ingestBatch(
    batch({
      page: { path: '/index.html', title: 'Home', referrer: '', startedAt: 1000 },
      device,
      events: [rrweb(1000), nav(1000, '/index.html'), tap(1500)],
    }),
  );
  store.ingestBatch(
    batch({
      pageId: 'p_2',
      seq: 0,
      sentAt: 5000,
      page: { path: '/producto.html', title: 'Producto', referrer: '', startedAt: 4000 },
      events: [nav(4000, '/producto.html?id=*'), nav(4200, '/producto.html?id=*'), tap(4500)],
    }),
  );

  const sessions = store.listSessions();
  assert.equal(sessions.length, 1);
  const s = sessions[0]!;
  assert.equal(s.deviceLabel, 'iPhone · Safari 18');
  assert.equal(s.pageCount, 2);
  assert.equal(s.screenCount, 2);
  assert.equal(s.tapCount, 2);
  assert.equal(s.durationMs, 3500);
  assert.equal(s.entryPath, '/index.html');
  assert.equal(s.tasks, undefined);
  assert.equal(s.answers, undefined);

  const full = store.getSessionEvents('s_1');
  assert.ok(full);
  assert.equal(full.events.length, 6);
  assert.equal(full.pages.length, 2);
  store.close();
});

test('a later batch without page info keeps the path and title of the page', () => {
  const store = new SqliteStore(':memory:');
  store.ingestBatch(batch({ device, page: { path: '/carrito.html', title: 'Carrito', referrer: '/', startedAt: 1000 }, events: [rrweb(1000)] }));
  store.ingestBatch(batch({ seq: 1, sentAt: 4000, events: [tap(3000)] }));
  const page = store.getSessionEvents('s_1')?.pages[0];
  assert.deepEqual(page, { id: 'p_1', path: '/carrito.html', title: 'Carrito', referrer: '/', startedAt: 1000 });
  store.close();
});

test('fills device and page info when they arrive in a later batch', () => {
  const store = new SqliteStore(':memory:');
  store.ingestBatch(batch({ seq: 1, events: [rrweb(2000)] }));
  store.ingestBatch(batch({ seq: 0, device, page: { path: '/a', title: 'A', referrer: '', startedAt: 1000 }, events: [rrweb(1000)] }));
  const s = store.getSession('s_1');
  assert.ok(s);
  assert.equal(s.touch, true);
  assert.equal(s.startedAt, 1000);
  assert.equal(s.lastSeenAt, 2000);
  assert.equal(s.entryPath, '/a');
  assert.equal(store.getSessionEvents('s_1')?.pages[0]?.path, '/a');
  store.close();
});

test('a repeated batch is ignored; a retry that carries more events only adds the new ones', () => {
  const store = new SqliteStore(':memory:');
  const first = batch({ device, page: { path: '/', title: 'T', referrer: '', startedAt: 1000 }, events: [rrweb(1000), tap(1100)] });
  assert.deepEqual(store.ingestBatch(first), { received: 2 });
  assert.deepEqual(store.ingestBatch(first), { received: 0 });
  assert.deepEqual(store.ingestBatch(structuredClone(first)), { received: 0 });
  assert.equal(store.getSessionEvents('s_1')?.events.length, 2);
  assert.equal(store.getSession('s_1')?.tapCount, 1);

  // El recorder anterior a v1 reintentaba con el mismo seq, sumando lo nuevo al final.
  assert.deepEqual(store.ingestBatch({ ...first, events: [...first.events, tap(1200), tap(1300)] }), { received: 2 });
  assert.equal(store.getSession('s_1')?.tapCount, 3);
  assert.deepEqual(store.ingestBatch({ ...first, events: [...first.events, tap(1200), tap(1300)] }), { received: 0 });

  // Otro seq, otra página u otra sesión sí son lotes nuevos.
  assert.deepEqual(store.ingestBatch(batch({ seq: 1, events: [tap(2000)] })), { received: 1 });
  assert.deepEqual(store.ingestBatch(batch({ pageId: 'p_2', events: [tap(3000)] })), { received: 1 });
  assert.deepEqual(store.ingestBatch(batch({ sessionId: 's_2', events: [tap(3000)] })), { received: 1 });
  assert.equal(store.getSession('s_1')?.tapCount, 5);

  // Borrar la sesión borra también el registro de sus lotes: el id se puede volver a usar.
  store.deleteSession('s_1');
  assert.deepEqual(store.ingestBatch(first), { received: 2 });
  store.close();
});

test('two sessions can use the same page id', () => {
  const store = new SqliteStore(':memory:');
  store.ingestBatch(batch({ sessionId: 's_a', pageId: 'p_same', page: { path: '/a.html', title: 'A', referrer: '', startedAt: 1 }, events: [tap(10)] }));
  store.ingestBatch(batch({ sessionId: 's_b', pageId: 'p_same', page: { path: '/b.html', title: 'B', referrer: '', startedAt: 2 }, events: [tap(20), tap(30)] }));
  assert.equal(store.getSessionEvents('s_a')?.pages[0]?.path, '/a.html');
  assert.equal(store.getSessionEvents('s_b')?.pages[0]?.path, '/b.html');
  assert.equal(store.getSession('s_a')?.tapCount, 1);
  assert.equal(store.getSession('s_b')?.tapCount, 2);
  assert.equal(store.deleteSession('s_a'), true);
  assert.equal(store.getSessionEvents('s_b')?.events.length, 2);
  store.close();
});

const exported = (overrides: Partial<SessionExport['session']> = {}, events: TaptanaEvent[] = [rrweb(10), tap(20)]): SessionExport => ({
  v: 1,
  exportedAt: 1,
  session: {
    id: 's_x',
    prototypeId: 'local',
    startedAt: 10,
    lastSeenAt: 50,
    durationMs: 40,
    deviceLabel: 'Android · Chrome 129',
    viewport: { width: 400, height: 800 },
    touch: true,
    entryPath: '/',
    pageCount: 1,
    tapCount: 1,
    ...overrides,
  },
  pages: [{ id: 'pg', path: '/', title: 'Home', referrer: '', startedAt: 10 }],
  events,
});

test('imports, exports and deletes a session', () => {
  const store = new SqliteStore(':memory:');
  store.importSession(exported());
  const s = store.getSession('s_x');
  assert.ok(s);
  assert.equal(s.tapCount, 1);
  assert.equal(store.hasSession('s_x'), true);
  assert.equal(store.deleteSession('s_x'), true);
  assert.equal(store.hasSession('s_x'), false);
  assert.equal(store.getSession('s_x'), null);
  assert.equal(store.getSessionEvents('s_x'), null);
  store.close();
});

test('importing a session of an unknown prototype creates a visible prototype named "Importado"', () => {
  const store = new SqliteStore(':memory:');
  store.importSession(exported({ prototypeId: 'pr_deOtroLado' }));
  const proto = store.getPrototype('pr_deOtroLado');
  assert.equal(proto?.name, IMPORTED_PROTOTYPE_NAME);
  assert.equal(proto?.source, undefined);
  assert.equal(proto?.sessionCount, 1);
  // Un prototipo que ya existe conserva su nombre y su origen.
  store.savePrototype({ id: 'pr_mio', name: 'Onboarding', createdAt: 1, source: 'upload', entryPath: '/index.html' });
  store.importSession(exported({ id: 's_y', prototypeId: 'pr_mio' }));
  assert.equal(store.getPrototype('pr_mio')?.name, 'Onboarding');
  assert.equal(store.getPrototype('pr_mio')?.source, 'upload');
  store.close();
});

test('imports an old export (v1 study inside, stale tasks, no answers) and keeps the moderator marks', () => {
  const store = new SqliteStore(':memory:');
  const v1: StudyV1 & { id: string; createdAt: number; updatedAt: number } = {
    v: 1,
    id: 'st_viejo',
    createdAt: 5,
    updatedAt: 6,
    name: 'Estudio viejo',
    prototypeId: 'local',
    tasks: [
      { id: 't1', title: 'Comprar', instruction: 'Compra', success: { type: 'reached', path: '/gracias.html' } },
      { id: 't2', title: 'Envío', instruction: 'Averigua', success: { type: 'manual' } },
    ],
  };
  const file = exported({ studyId: 'st_viejo', label: 'P1 · Ana', notes: 'Dudó en el carrito', excluded: true }, [
    rrweb(10),
    { kind: 'taptana', type: 'study', t: 11, studyId: 'st_viejo', action: 'start' },
    { kind: 'taptana', type: 'task', t: 12, taskId: 't1', action: 'start' },
    nav(20, '/gracias.html'),
    { kind: 'taptana', type: 'task', t: 30, taskId: 't2', action: 'start' },
    { kind: 'taptana', type: 'task', t: 40, taskId: 't2', action: 'done' },
  ]);
  // Resultados ya calculados por una versión anterior: solo interesan sus marcas manuales.
  file.session.tasks = [
    { taskId: 't1', outcome: 'failed', ruleMatched: false, reported: null, manual: null },
    { taskId: 't2', outcome: 'success', ruleMatched: false, reported: 'done', manual: 'success' },
  ];
  file.study = v1 as unknown as NonNullable<SessionExport['study']>;
  store.importSession(file);

  const saved = store.getStudy('st_viejo');
  assert.equal(saved?.v, 2);
  assert.deepEqual(saved?.blocks.map((b) => b.id), ['t1', 't2']);
  assert.equal((saved as unknown as { tasks?: unknown }).tasks, undefined);

  const s = store.getSession('s_x');
  assert.equal(s?.label, 'P1 · Ana');
  assert.equal(s?.notes, 'Dudó en el carrito');
  assert.equal(s?.excluded, true);
  assert.deepEqual(s?.tasks?.map((t) => [t.taskId, t.outcome, t.manual]), [
    ['t1', 'success', null],
    ['t2', 'success', 'success'],
  ]);
  assert.deepEqual(s?.answers, []);

  // Importar de nuevo reemplaza la sesión y no pisa el estudio que ya está aquí.
  store.saveStudy({ ...saved!, name: 'Editado aquí' }, 'st_viejo');
  store.importSession(file);
  assert.equal(store.getStudy('st_viejo')?.name, 'Editado aquí');
  assert.equal(store.listSessions().length, 1);
  store.close();
});

test('imports a new export with answers, participant and repeated page ids', () => {
  const store = new SqliteStore(':memory:');
  const saved = store.saveStudy(study);
  const file = exported({ studyId: saved.id }, [
    { kind: 'taptana', type: 'study', t: 11, studyId: saved.id, action: 'start', participant: '  Ana  ' },
    nav(12, '/index.html'),
    { kind: 'taptana', type: 'answer', t: 30, blockId: 'q1', value: 4, durationMs: 900 },
    { kind: 'taptana', type: 'answer', t: 40, blockId: 'q2', value: null },
    tap(45),
  ]);
  file.pages = [
    { id: 'pg', path: '/', title: 'Home', referrer: '', startedAt: 10 },
    { id: 'pg', path: '/', title: 'Home (repetida)', referrer: '', startedAt: 10 },
    { id: 'pg2', path: '/gracias.html', title: 'Gracias', referrer: '', startedAt: 35 },
  ];
  store.importSession(file);
  const s = store.getSession('s_x');
  assert.equal(s?.participant, 'Ana');
  assert.deepEqual(s?.answers, [
    { blockId: 'q1', value: 4, t: 30, durationMs: 900 },
    { blockId: 'q2', value: null, t: 40 },
  ]);
  assert.equal(s?.pageCount, 2);
  assert.equal(s?.screenCount, 1);
  store.close();
});

test('studies: saved as v2 whatever comes in; sessions link to them and get task results and answers', () => {
  const store = new SqliteStore(':memory:');
  const v1 = {
    v: 1,
    name: 'Compra',
    prototypeId: 'local',
    tasks: [{ id: 't1', title: 'Comprar', instruction: 'Compra', success: { type: 'reached', path: '/gracias.html' } }],
  } as unknown as Study;
  const saved = store.saveStudy(v1);
  assert.match(saved.id, /^st_/);
  assert.equal(saved.v, 2);
  assert.equal(saved.blocks.length, 1);
  assert.equal(store.listStudies().length, 1);
  assert.equal(store.listStudies('local').length, 1);
  assert.equal(store.listStudies('otro').length, 0);

  const updated = store.saveStudy({ ...study, name: 'Compra v2', thanks: '¡Listo!', settings: { advance: 'manual', askName: true }, closed: true }, saved.id);
  assert.equal(updated.id, saved.id);
  const read = store.getStudy(saved.id);
  assert.equal(read?.name, 'Compra v2');
  assert.equal(read?.createdAt, saved.createdAt);
  assert.equal(read?.thanks, '¡Listo!');
  assert.deepEqual(read?.settings, { advance: 'manual', askName: true });
  assert.equal(read?.closed, true);
  assert.equal(read?.blocks.length, 3);

  store.ingestBatch(
    batch({
      device,
      page: { path: '/index.html', title: 'Home', referrer: '', startedAt: 1000 },
      events: [
        { kind: 'taptana', type: 'study', t: 1000, studyId: saved.id, variantId: 'B', action: 'start', participant: 'Lucho' },
        { kind: 'taptana', type: 'task', t: 1100, taskId: 't1', action: 'start' },
        nav(1800, '/gracias.html'),
        { kind: 'taptana', type: 'answer', t: 2500, blockId: 'q1', value: 5 },
      ],
    }),
  );
  const s = store.getSession('s_1');
  assert.equal(s?.studyId, saved.id);
  assert.equal(s?.variantId, 'B');
  assert.equal(s?.participant, 'Lucho');
  assert.equal(s?.tasks?.[0]?.outcome, 'success');
  assert.equal(s?.tasks?.[0]?.durationMs, 700);
  assert.deepEqual(s?.answers, [{ blockId: 'q1', value: 5, t: 2500 }]);
  assert.equal(store.listSessions({ studyId: saved.id }).length, 1);
  assert.equal(store.listSessions({ studyId: 'nope' }).length, 0);
  assert.equal(store.getSessionEvents('s_1')?.study?.id, saved.id);

  const report = store.listReportSessions(saved.id);
  assert.equal(report.length, 1);
  assert.equal(report[0]?.session.id, 's_1');
  assert.equal(report[0]?.events.length, 4);
  assert.deepEqual(report[0]?.manual, {});

  assert.equal(store.deleteStudy(saved.id), true);
  assert.equal(store.getStudy(saved.id), null);
  assert.equal(store.getSession('s_1')?.tasks, undefined);
  store.close();
});

test('setSessionFields: label, notes, excluded and manual marks', () => {
  const store = new SqliteStore(':memory:');
  const saved = store.saveStudy(study);
  store.ingestBatch(
    batch({
      events: [
        { kind: 'taptana', type: 'study', t: 1000, studyId: saved.id, action: 'start' },
        { kind: 'taptana', type: 'task', t: 1100, taskId: 't1', action: 'start' },
        nav(1800, '/gracias.html'),
      ],
    }),
  );
  assert.equal(store.setSessionFields('nope', { label: 'x' }), false);
  assert.equal(store.setSessionFields('s_1', { label: 'P3 · Ana', notes: 'Se perdió en el carrito', excluded: true }), true);
  let s = store.getSession('s_1');
  assert.equal(s?.label, 'P3 · Ana');
  assert.equal(s?.notes, 'Se perdió en el carrito');
  assert.equal(s?.excluded, true);
  assert.equal(s?.tasks?.[0]?.outcome, 'success');

  // Solo cambia lo que viene; un texto vacío borra.
  assert.equal(store.setSessionFields('s_1', { label: '', excluded: false, manual: { t1: 'failure' } }), true);
  s = store.getSession('s_1');
  assert.equal(s?.label, undefined);
  assert.equal(s?.notes, 'Se perdió en el carrito');
  assert.equal(s?.excluded, undefined);
  assert.equal(s?.tasks?.[0]?.outcome, 'failed');

  // Las marcas se suman a las que ya había.
  store.setSessionFields('s_1', { manual: { otra: 'success' } });
  assert.deepEqual(store.listReportSessions(saved.id)[0]?.manual, { t1: 'failure', otra: 'success' });
  assert.equal(store.setSessionFields('s_1', {}), true);
  store.close();
});

test('duplicateStudy copies the study with new block ids', () => {
  const store = new SqliteStore(':memory:');
  const saved = store.saveStudy({ ...study, closed: true });
  const copy = store.duplicateStudy(saved.id);
  assert.ok(copy);
  assert.notEqual(copy.id, saved.id);
  assert.equal(copy.name, 'Copia de Compra');
  assert.equal(copy.closed, undefined);
  assert.equal(copy.blocks.length, 3);
  for (const block of copy.blocks) assert.ok(!saved.blocks.some((b) => b.id === block.id));
  assert.equal(store.listStudies().length, 2);
  assert.equal(store.getStudy(copy.id)?.name, 'Copia de Compra');
  assert.equal(store.duplicateStudy('nope'), null);
  store.close();
});

test('listScreens merges the html files with the screens seen in sessions of that prototype', () => {
  const store = new SqliteStore(':memory:');
  store.ingestBatch(
    batch({
      events: [nav(1, '/index.html', 'Tienda'), nav(2, '/index.html#/carrito', 'Tu carrito'), nav(3, '/index.html~checkout', 'Pago'), nav(4, '/index.html#/carrito?x=*')],
    }),
  );
  store.ingestBatch(batch({ sessionId: 's_otro', prototypeId: 'otro', events: [nav(1, '/ajena.html')] }));
  const screens = store.listScreens('local', [
    { path: '/index.html', title: 'Verde · Plantas' },
    { path: '/gracias.html', title: '' },
  ]);
  assert.deepEqual(screens, [
    { id: '/index.html', label: 'inicio', source: 'file', title: 'Verde · Plantas' },
    { id: '/gracias.html', label: 'gracias', source: 'file' },
    { id: '/index.html#/carrito', label: 'carrito', source: 'seen', title: 'Tu carrito' },
    { id: '/index.html~checkout', label: 'checkout', source: 'seen', title: 'Pago' },
  ]);
  assert.deepEqual(store.listScreens('vacio'), []);
  store.close();
});

test('prototypes: save, list with session count, root flag, delete cascades', () => {
  const store = new SqliteStore(':memory:');
  store.savePrototype({ id: 'pr_1', name: 'Onboarding', createdAt: 5, source: 'upload', entryPath: '/home.html', absoluteUrls: true });
  store.ingestBatch(batch({ prototypeId: 'pr_1', events: [rrweb(1)] }));
  store.saveStudy({ ...study, prototypeId: 'pr_1' });
  const [p] = store.listPrototypes();
  assert.equal(p?.name, 'Onboarding');
  assert.equal(p?.source, 'upload');
  assert.equal(p?.entryPath, '/home.html');
  assert.equal(p?.sessionCount, 1);
  assert.equal(p?.absoluteUrls, true);
  assert.equal(p?.root, undefined);

  // Renombrar no pierde lo que ya se sabía del prototipo.
  store.savePrototype({ id: 'pr_1', name: 'Onboarding v2', createdAt: 5, source: 'upload', entryPath: '/index.html' });
  assert.equal(store.getPrototype('pr_1')?.name, 'Onboarding v2');
  assert.equal(store.getPrototype('pr_1')?.absoluteUrls, true);

  // En la raíz solo puede haber uno.
  store.savePrototype({ id: 'pr_2', name: 'Otro', createdAt: 6, source: 'upload', entryPath: '/index.html' });
  assert.equal(store.getRootPrototype(), null);
  store.setRootPrototype('pr_1');
  assert.equal(store.getRootPrototype()?.id, 'pr_1');
  store.setRootPrototype('pr_2');
  assert.equal(store.getRootPrototype()?.id, 'pr_2');
  assert.equal(store.getPrototype('pr_1')?.root, undefined);
  assert.equal(store.getPrototype('pr_2')?.root, true);
  store.setRootPrototype(null);
  assert.equal(store.getRootPrototype(), null);

  assert.equal(store.deletePrototype('pr_1'), true);
  assert.equal(store.getPrototype('pr_1'), null);
  assert.equal(store.listSessions().length, 0);
  assert.equal(store.listStudies().length, 0);
  store.close();
});

test('cached results follow the session and the study', () => {
  const store = new SqliteStore(':memory:');
  const saved = store.saveStudy(study);
  store.ingestBatch(
    batch({
      events: [
        { kind: 'taptana', type: 'study', t: 1000, studyId: saved.id, action: 'start' },
        { kind: 'taptana', type: 'task', t: 1100, taskId: 't1', action: 'start' },
        nav(1500, '/carrito.html'),
      ],
    }),
  );
  const outcome = (): string | undefined => store.listSessions()[0]?.tasks?.[0]?.outcome;
  assert.equal(outcome(), 'incomplete');
  assert.equal(outcome(), 'incomplete');

  // Llega otro lote de la misma sesión.
  store.ingestBatch(batch({ seq: 1, sentAt: 2000, events: [nav(1900, '/gracias.html'), { kind: 'taptana', type: 'answer', t: 2000, blockId: 'q1', value: 3 }] }));
  assert.equal(outcome(), 'success');
  assert.equal(store.getSession('s_1')?.screenCount, 2);
  assert.equal(store.getSession('s_1')?.answers?.[0]?.value, 3);

  // El moderador marca; después cambia la regla del estudio.
  store.setSessionFields('s_1', { manual: { t1: 'failure' } });
  assert.equal(outcome(), 'failed');
  const [task, ...others] = study.blocks;
  store.saveStudy({ ...study, blocks: [{ ...task!, id: 't1b' } as Study['blocks'][number], ...others] }, saved.id);
  assert.deepEqual(store.listSessions()[0]?.tasks?.map((t) => [t.taskId, t.outcome]), [['t1b', 'pending']]);

  // El estudio se borra: la sesión ya no trae resultados.
  store.deleteStudy(saved.id);
  assert.equal(store.listSessions()[0]?.tasks, undefined);
  store.close();
});

test('cached results notice what another process wrote to the same database', () => {
  const file = tmpDb();
  const server = new SqliteStore(file);
  const saved = server.saveStudy(study);
  server.ingestBatch(batch({ events: [{ kind: 'taptana', type: 'study', t: 1000, studyId: saved.id, action: 'start' }, { kind: 'taptana', type: 'task', t: 1100, taskId: 't1', action: 'start' }] }));
  assert.equal(server.listSessions()[0]?.tasks?.[0]?.outcome, 'incomplete');

  // Como `taptana seed` mientras el servidor corre: otra conexión a la misma base.
  const other = new SqliteStore(file);
  other.ingestBatch(batch({ seq: 1, sentAt: 2000, events: [nav(1900, '/gracias.html')] }));
  other.close();

  assert.equal(server.listSessions()[0]?.tasks?.[0]?.outcome, 'success');
  assert.equal(server.getSession('s_1')?.screenCount, 1);
  server.close();
});

test('lists, results, report and screens never read rrweb events', () => {
  const file = tmpDb();
  const store = new SqliteStore(file);
  const saved = store.saveStudy(study);
  store.ingestBatch(
    batch({
      events: [rrweb(900), rrweb(950), { kind: 'taptana', type: 'study', t: 1000, studyId: saved.id, action: 'start' }, nav(1001, '/index.html'), tap(1200), rrweb(1300)],
    }),
  );
  // Si alguna consulta leyera las filas de rrweb, vería estas navegaciones y toques falsos.
  const raw = new DatabaseSync(file);
  const fake = JSON.stringify({ kind: 'taptana', type: 'navigation', t: 1, from: '', to: '/no-deberia-leerse.html' });
  raw.prepare("UPDATE events SET data = ? WHERE kind = 'rrweb'").run(fake);
  raw.close();

  const s = store.listSessions()[0];
  assert.equal(s?.screenCount, 1);
  assert.equal(s?.tapCount, 1);
  assert.equal(store.getSession('s_1')?.screenCount, 1);
  assert.equal(store.listReportSessions(saved.id)[0]?.events.length, 3);
  assert.deepEqual(store.listScreens('local').map((x) => x.id), ['/index.html']);
  // El reproductor sí los lee todos.
  assert.equal(store.getSessionEvents('s_1')?.events.length, 6);
  store.close();
});

// Esquema de v0.1 (commit ed15a12), tal cual: sin estudios, sin columnas nuevas, y con el id
// de página como clave única en toda la base.
const SCHEMA_V01 = `
CREATE TABLE IF NOT EXISTS prototypes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  prototype_id  TEXT NOT NULL REFERENCES prototypes(id),
  started_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT,
  device_label  TEXT,
  screen_w      INTEGER,
  screen_h      INTEGER,
  viewport_w    INTEGER,
  viewport_h    INTEGER,
  dpr           REAL,
  touch         INTEGER,
  language      TEXT,
  entry_path    TEXT
);
CREATE TABLE IF NOT EXISTS pages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  title         TEXT,
  referrer      TEXT,
  started_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page_id       TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  t             INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  type          TEXT,
  data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_session_t ON events (session_id, t);
CREATE INDEX IF NOT EXISTS events_session_type ON events (session_id, type);
CREATE INDEX IF NOT EXISTS pages_session ON pages (session_id, started_at);
CREATE INDEX IF NOT EXISTS sessions_prototype ON sessions (prototype_id, started_at);
`;

test('opens a v0.1 database: migrates columns, keys and indexes, and keeps the data', () => {
  const file = tmpDb();
  const old = new DatabaseSync(file);
  old.exec('PRAGMA journal_mode = WAL;');
  old.exec('PRAGMA foreign_keys = ON;');
  old.exec(SCHEMA_V01);
  old.prepare('INSERT INTO prototypes (id, name, created_at) VALUES (?, ?, ?)').run('local', 'tienda', 1);
  old.prepare(
    `INSERT INTO sessions (id, prototype_id, started_at, last_seen_at, user_agent, device_label, viewport_w, viewport_h, touch, entry_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('s_old', 'local', 1000, 5000, 'x', 'iPhone · Safari 17', 390, 664, 1, '/index.html');
  old.prepare('INSERT INTO pages (id, session_id, path, title, referrer, started_at) VALUES (?, ?, ?, ?, ?, ?)').run('p_old', 's_old', '', 'Home', '', 1000);
  const insert = old.prepare('INSERT INTO events (session_id, page_id, t, kind, type, data) VALUES (?, ?, ?, ?, ?, ?)');
  const events: TaptanaEvent[] = [rrweb(1000), nav(1001, '/index.html'), tap(2000), tap(3000)];
  for (const e of events) insert.run('s_old', 'p_old', e.t, e.kind, e.kind === 'taptana' ? e.type : null, JSON.stringify(e));
  old.close();

  const store = new SqliteStore(file);
  const s = store.getSession('s_old');
  assert.equal(s?.deviceLabel, 'iPhone · Safari 17');
  assert.equal(s?.tapCount, 2);
  assert.equal(s?.pageCount, 1);
  assert.equal(s?.screenCount, 1);
  const full = store.getSessionEvents('s_old');
  assert.equal(full?.events.length, 4);
  // v0.1 perdía la ruta de la página: se recupera de su primera navegación.
  assert.equal(full?.pages[0]?.path, '/index.html');
  assert.equal(store.getPrototype('local')?.name, 'tienda');

  // Todo lo nuevo funciona sobre la base migrada.
  const saved = store.saveStudy(study);
  store.ingestBatch(batch({ sessionId: 's_new', pageId: 'p_old', events: [{ kind: 'taptana', type: 'study', t: 9000, studyId: saved.id, action: 'start', participant: 'Ana' }, tap(9100)] }));
  assert.equal(store.getSession('s_new')?.participant, 'Ana');
  assert.equal(store.listSessions({ studyId: saved.id }).length, 1);
  assert.equal(store.setSessionFields('s_old', { label: 'Vieja', excluded: true }), true);
  assert.equal(store.getSession('s_old')?.label, 'Vieja');
  store.savePrototype({ id: 'pr_1', name: 'Subido', createdAt: 2, source: 'upload', entryPath: '/index.html' });
  store.setRootPrototype('pr_1');
  assert.equal(store.getRootPrototype()?.id, 'pr_1');
  assert.equal(store.deleteSession('s_old'), true);
  assert.equal(store.getSessionEvents('s_new')?.events.length, 2);
  store.close();

  const check = new DatabaseSync(file);
  const indexes = (check.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((r) => r.name);
  for (const name of ['events_session_t', 'events_session_type', 'pages_session', 'sessions_prototype', 'sessions_study']) {
    assert.ok(indexes.includes(name), `falta el índice ${name}`);
  }
  assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal((check.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n, 2);
  check.close();

  // Abrirla otra vez no vuelve a migrar ni rompe nada.
  const again = new SqliteStore(file);
  assert.equal(again.listSessions().length, 1);
  again.close();
});
