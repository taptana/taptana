import { applyManualPatch } from './study.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTaptanaEvent,
  normalizeStudy,
  sanitizeEvents,
  validateEventBatch,
  validateSessionExport,
  validateSessionPatch,
  validateStudy,
  type StudyIssue,
} from './validate.js';
import { STUDY_LIMITS, type Study, type StudyRecord, type StudyV1 } from './study.js';

// ── Lotes ──────────────────────────────────────────────────────────────────────────

const device = {
  userAgent: 'Mozilla/5.0 (iPhone)',
  screen: { width: 390, height: 844 },
  viewport: { width: 390, height: 664 },
  dpr: 3,
  touch: true,
  language: 'es-PE',
};
const page = { path: '/', title: 'Inicio', referrer: '', startedAt: 1 };

const good = {
  v: 1,
  prototypeId: 'local',
  sessionId: 's_1',
  pageId: 'p_1',
  seq: 0,
  sentAt: 1,
  events: [
    { kind: 'rrweb', t: 1, data: { type: 4 } },
    { kind: 'taptana', type: 'tap', t: 2, x: 1, y: 2, target: { tag: 'a', selector: 'a' } },
  ],
};

test('accepts a well formed batch', () => {
  const result = validateEventBatch({ ...good, page, device });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.events.length, 2);
  assert.deepEqual(result.value.page, page);
  assert.deepEqual(result.value.device, device);
  assert.equal(result.dropped, undefined);
});

test('still accepts the events old recorders send', () => {
  const old = [
    { kind: 'taptana', type: 'navigation', t: 1, from: '', to: '/' },
    { kind: 'taptana', type: 'viewport', t: 1, width: 390, height: 664, orientation: 'portrait' },
    { kind: 'taptana', type: 'study', t: 2, studyId: 'st_1', action: 'start' },
    { kind: 'taptana', type: 'task', t: 3, taskId: 't1', action: 'start' },
    { kind: 'taptana', type: 'tap', t: 4, x: 1, y: 2, pageX: 1, pageY: 2, target: { tag: 'a', selector: 'a', interactive: true } },
    { kind: 'taptana', type: 'scroll', t: 5, x: 0, y: 10, depth: 0.5 },
    { kind: 'taptana', type: 'swipe', t: 6, direction: 'up', startX: 1, startY: 2, endX: 1, endY: 80, durationMs: 200 },
    { kind: 'taptana', type: 'task', t: 7, taskId: 't1', action: 'done' },
    { kind: 'taptana', type: 'study', t: 8, studyId: 'st_1', action: 'finish' },
  ];
  const result = validateEventBatch({ ...good, events: old });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.events.length, old.length);
});

test('accepts the new events: goal, auto done, answers, participant, fixed taps, titled navigation', () => {
  const fresh = [
    { kind: 'taptana', type: 'navigation', t: 1, from: '/', to: '/index.html~checkout', title: 'Pago', via: 'screen' },
    { kind: 'taptana', type: 'study', t: 2, studyId: 'st_1', action: 'start', participant: 'Ana' },
    { kind: 'taptana', type: 'task', t: 3, taskId: 't1', action: 'goal' },
    { kind: 'taptana', type: 'task', t: 4, taskId: 't1', action: 'done', auto: true },
    { kind: 'taptana', type: 'tap', t: 5, x: 1, y: 600, fixed: true, vh: 664, target: { tag: 'button', selector: '#pagar' } },
    { kind: 'taptana', type: 'answer', t: 6, blockId: 'q1', value: 4, durationMs: 1200 },
    { kind: 'taptana', type: 'answer', t: 7, blockId: 'q2', value: ['Precio', 'Fotos'] },
    { kind: 'taptana', type: 'answer', t: 8, blockId: 'q3', value: true },
    { kind: 'taptana', type: 'answer', t: 9, blockId: 'q4', value: 'Todo bien' },
    { kind: 'taptana', type: 'answer', t: 10, blockId: 'q5', value: null },
  ];
  const result = validateEventBatch({ ...good, events: fresh });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.events.length, fresh.length);
  assert.equal(result.dropped, undefined);
});

test('drops unknown event types and events missing their fields, and says how many', () => {
  const events = [
    ...good.events,
    { kind: 'taptana', type: 'hover', t: 3, x: 1, y: 1 },
    { kind: 'taptana', type: 'tap', t: 4, x: 1, y: 2 },
    { kind: 'taptana', type: 'task', t: 5, taskId: 't1', action: 'paused' },
    { kind: 'taptana', type: 'answer', t: 6, blockId: 'q1', value: { no: 'vale' } },
    { kind: 'taptana', type: 'navigation', t: 7, from: '', to: 12 },
  ];
  const result = validateEventBatch({ ...good, events });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.events.length, 2);
  assert.equal(result.dropped, 5);
});

test('returns a clean copy: unknown top-level fields do not travel', () => {
  const result = validateEventBatch({ ...good, extra: 'x', device: { ...device, fingerprint: 'abc' } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal('extra' in result.value, false);
  assert.equal('fingerprint' in (result.value.device ?? {}), false);
});

test('rejects a batch without session id', () => {
  const result = validateEventBatch({ ...good, sessionId: '' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /sessionId/);
});

test('rejects ids that could end up in a file path', () => {
  for (const bad of ['../../etc', 'a/b', 'a\\b', '..', 'x'.repeat(201), 42]) {
    const result = validateEventBatch({ ...good, prototypeId: bad });
    assert.equal(result.ok, false, String(bad));
    if (!result.ok) assert.match(result.error, /prototypeId/);
  }
  assert.equal(validateEventBatch({ ...good, prototypeId: 'pr_Ab-9.x' }).ok, true);
});

test('rejects a malformed event', () => {
  const result = validateEventBatch({ ...good, events: [{ kind: 'nope', t: 1 }] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /events\[0\]/);
});

test('rejects unknown versions, bad seq and non-objects', () => {
  assert.equal(validateEventBatch({ ...good, v: 2 }).ok, false);
  assert.equal(validateEventBatch({ ...good, seq: -1 }).ok, false);
  assert.equal(validateEventBatch({ ...good, seq: 1.5 }).ok, false);
  assert.equal(validateEventBatch({ ...good, events: 'x' }).ok, false);
  assert.equal(validateEventBatch(null).ok, false);
  assert.equal(validateEventBatch([]).ok, false);
});

test('checks device and page field by field, naming the field', () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ ...good, device: {} }, /device\.userAgent/],
    [{ ...good, device: { ...device, viewport: undefined } }, /device\.viewport/],
    [{ ...good, device: { ...device, viewport: { width: '390', height: 664 } } }, /device\.viewport\.width/],
    [{ ...good, device: { ...device, screen: null } }, /device\.screen/],
    [{ ...good, device: { ...device, dpr: 'x' } }, /device\.dpr/],
    [{ ...good, device: { ...device, touch: 1 } }, /device\.touch/],
    [{ ...good, device: { ...device, language: null } }, /device\.language/],
    [{ ...good, device: 'iPhone' }, /device/],
    [{ ...good, page: { ...page, path: 7 } }, /page\.path/],
    [{ ...good, page: { ...page, title: undefined } }, /page\.title/],
    [{ ...good, page: { ...page, startedAt: 'ayer' } }, /page\.startedAt/],
    [{ ...good, page: [] }, /page/],
  ];
  for (const [batch, pattern] of cases) {
    const result = validateEventBatch(batch);
    assert.equal(result.ok, false, String(pattern));
    if (!result.ok) assert.match(result.error, pattern);
  }
});

test('isTaptanaEvent and sanitizeEvents', () => {
  assert.equal(isTaptanaEvent({ kind: 'rrweb', t: 1, data: null }), true);
  assert.equal(isTaptanaEvent({ kind: 'taptana', t: 1, type: 'lo-que-sea' }), true);
  assert.equal(isTaptanaEvent({ kind: 'taptana', t: 'x', type: 'tap' }), false);
  assert.equal(isTaptanaEvent('tap'), false);
  const { events, dropped } = sanitizeEvents([{ kind: 'rrweb', t: 1, data: {} }, 'basura', { kind: 'taptana', t: 2, type: 'nuevo' }]);
  assert.equal(events.length, 1);
  assert.equal(dropped, 2);
});

// ── Sesiones ───────────────────────────────────────────────────────────────────────

test('validateSessionPatch keeps only what came, trimmed', () => {
  const r = validateSessionPatch({ label: '  P3 · Ana ', notes: '', excluded: true, manual: { t1: 'success', t2: 'failure' }, otra: 'cosa' });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, { label: 'P3 · Ana', notes: '', excluded: true, manual: { t1: 'success', t2: 'failure' } });
  const empty = validateSessionPatch({});
  assert.equal(empty.ok, true);
  if (empty.ok) assert.deepEqual(empty.value, {});
});

test('validateSessionPatch rejects wrong types with a message in Spanish', () => {
  const cases: Array<[unknown, RegExp]> = [
    [null, /tiene que ser un objeto/],
    [{ label: 7 }, /La etiqueta tiene que ser un texto/],
    [{ label: 'x'.repeat(81) }, /La etiqueta no puede pasar de 80 caracteres/],
    [{ notes: ['a'] }, /Las notas tienen que ser un texto/],
    [{ notes: 'x'.repeat(4001) }, /Las notas no pueden pasar de 4000 caracteres/],
    [{ excluded: 'sí' }, /"excluded" tiene que ser true o false/],
    [{ manual: 'success' }, /Las marcas/],
    [{ manual: { t1: 'ok' } }, /La marca de la tarea "t1" tiene que ser "success", "failure" o null/],
  ];
  for (const [patch, pattern] of cases) {
    const r = validateSessionPatch(patch);
    assert.equal(r.ok, false, String(pattern));
    if (!r.ok) assert.match(r.error, pattern);
  }
});

const exported = {
  v: 1,
  exportedAt: 99,
  session: {
    id: 's_1', prototypeId: 'local', startedAt: 1000, lastSeenAt: 5000, durationMs: 4000, deviceLabel: 'iPhone · Safari 18',
    viewport: { width: 390, height: 664 }, touch: true, entryPath: '/', pageCount: 2, tapCount: 99, studyId: 'st_1', variantId: 'A',
    label: ' P1 ', notes: 'Se perdió en el carrito', excluded: true, participant: 'Ana',
    tasks: [{ taskId: 't1', outcome: 'success', ruleMatched: false, reported: 'done', manual: 'success' }],
    answers: [{ blockId: 'q1', value: 5, t: 1 }], screenCount: 40,
  },
  pages: [{ id: 'p_1', path: '/', title: 'Inicio', referrer: '', startedAt: 1000 }, { path: '/sin-id' }, 'x'],
  events: [
    { kind: 'taptana', type: 'tap', t: 3000, x: 1, y: 2, target: { tag: 'a', selector: 'a' } },
    { kind: 'taptana', type: 'navigation', t: 1000, from: '', to: '/' },
    { kind: 'rrweb', t: 1001, data: {} },
    { kind: 'taptana', type: 'del-futuro', t: 1002 },
  ],
  study: { v: 1, id: 'st_1', name: 'Compra', prototypeId: 'local', createdAt: 1, updatedAt: 2, tasks: [{ id: 't1', title: 'T', instruction: 'I', success: { type: 'manual' } }] },
};

test('validateSessionExport returns a clean session file, with the study already in v2', () => {
  const r = validateSessionExport(exported);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.dropped, 1);
  assert.deepEqual(r.value.events.map((e) => e.t), [1000, 1001, 3000]);
  assert.equal(r.value.session.tapCount, 1, 'recounted from the events');
  assert.equal(r.value.session.label, 'P1');
  assert.equal(r.value.session.excluded, true);
  assert.equal(r.value.session.participant, 'Ana');
  assert.equal(r.value.session.studyId, 'st_1');
  assert.equal(r.value.session.tasks?.[0]?.manual, 'success', 'moderator marks travel with the file');
  assert.equal('answers' in r.value.session, false);
  assert.equal('screenCount' in r.value.session, false);
  assert.deepEqual(r.value.pages, [{ id: 'p_1', path: '/', title: 'Inicio', referrer: '', startedAt: 1000 }]);
  assert.equal(r.value.study?.v, 2);
  assert.deepEqual(r.value.study?.blocks.map((b) => b.id), ['t1']);
  assert.equal(r.value.exportedAt, 99);
});

test('validateSessionExport fills what an old or hand-made file leaves out', () => {
  const r = validateSessionExport({ v: 1, session: { id: 's_2', prototypeId: 'pr_x' }, events: [{ kind: 'taptana', type: 'navigation', t: 50, from: '', to: '/' }, { kind: 'rrweb', t: 90, data: {} }] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.session, {
    id: 's_2', prototypeId: 'pr_x', startedAt: 50, lastSeenAt: 90, durationMs: 40, deviceLabel: 'Desconocido',
    viewport: { width: 0, height: 0 }, touch: false, entryPath: '', pageCount: 0, tapCount: 0,
  });
  assert.deepEqual(r.value.pages, []);
  assert.equal('study' in r.value, false);
});

test('validateSessionExport rejects what is not a session file', () => {
  for (const bad of [null, 'x', {}, { v: 2, session: {}, events: [] }, { v: 1, session: { id: 's' } }, { v: 1, events: [] }, { v: 1, session: { id: '', prototypeId: 'p' }, events: [] }, { v: 1, session: { id: 's', prototypeId: '../x' }, events: [] }]) {
    const r = validateSessionExport(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.match(r.error, /^Este archivo no es una sesión exportada de Taptana/);
  }
});

// ── Estudios ───────────────────────────────────────────────────────────────────────

const task = { id: 't1', title: 'Comprar', instruction: 'Compra una planta', success: { type: 'reached', path: '/gracias.html' } };
const v1 = {
  v: 1,
  name: 'Compra',
  prototypeId: 'local',
  tasks: [
    task,
    { id: 't2', kind: 'first-click', title: 'Carrito', instruction: '¿Dónde tocarías para ver el carrito?', success: { type: 'tapped', selector: '.cart-link' } },
  ],
};
const v2 = {
  v: 2,
  name: 'Compra',
  prototypeId: 'pr_1',
  welcome: 'Hola',
  thanks: '¡Gracias!',
  settings: { advance: 'manual', askName: true },
  blocks: [
    { id: 'c1', kind: 'context', title: 'Antes de empezar', text: 'Imagina que buscas un regalo.' },
    { ...task, kind: 'task', startPath: '/index.html', expectedPath: ['/index.html', '/producto.html', '/gracias.html'] },
    { id: 'f1', kind: 'first-click', title: 'Carrito', instruction: '¿Dónde tocarías?', success: { type: 'reached', path: '/carrito.html' } },
    { id: 'v1', title: 'Cupón', instruction: 'Aplica el cupón', success: { type: 'visible', text: 'Cupón aplicado' } },
    { id: 'q1', kind: 'scale', question: '¿Qué tan fácil fue?', max: 7, minLabel: 'Muy difícil', maxLabel: 'Muy fácil', required: true },
    { id: 'q2', kind: 'choice', question: '¿Qué te faltó?', options: ['Precio', 'Fotos', 'Nada'], multiple: true },
    { id: 'q3', kind: 'yesno', question: '¿Lo usarías?' },
    { id: 'q4', kind: 'text', question: '¿Algo más?', placeholder: 'Escribe aquí' },
  ],
};

const errors = (value: unknown): StudyIssue[] => {
  const r = validateStudy(value);
  return r.issues.filter((i) => i.level === 'error');
};
const messages = (value: unknown): string[] => errors(value).map((i) => i.message);
const withBlock = (block: unknown): unknown => ({ ...v2, blocks: [block] });

test('accepts a v2 study and returns it clean', () => {
  const r = validateStudy(v2);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.v, 2);
  assert.equal(r.value.blocks.length, 8);
  assert.deepEqual(r.value.settings, { advance: 'manual', askName: true });
  assert.equal(r.value.thanks, '¡Gracias!');
  assert.deepEqual(r.issues, []);
});

test('accepts a v1 study and converts tasks to blocks, keeping their ids', () => {
  const r = validateStudy(v1);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.v, 2);
  assert.equal('tasks' in r.value, false);
  assert.deepEqual(r.value.blocks.map((b) => b.id), ['t1', 't2']);
  assert.deepEqual(r.value.blocks.map((b) => b.kind), [undefined, 'first-click']);
});

test('accepts a file without "v" by looking at what it has', () => {
  const { v: _a, ...noVersion1 } = v1;
  const { v: _b, ...noVersion2 } = v2;
  assert.equal(validateStudy(noVersion1).ok, true);
  assert.equal(validateStudy(noVersion2).ok, true);
});

test('the result of validating is itself valid and stable (idempotent)', () => {
  const first = validateStudy(v2);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = validateStudy(first.value);
  assert.equal(second.ok, true);
  if (second.ok) assert.deepEqual(second.value, first.value);
});

test('trims texts and drops fields that are not part of the format', () => {
  const r = validateStudy({
    ...v1,
    name: '  Compra  ',
    id: 'st_viejo',
    createdAt: 1,
    welcome: '   ',
    tasks: [{ ...task, title: ' Comprar ', startPath: '', expectedPath: [], color: 'rojo' }],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.name, 'Compra');
  assert.equal('id' in r.value, false);
  assert.equal('welcome' in r.value, false);
  assert.deepEqual(r.value.blocks[0], { id: 't1', title: 'Comprar', instruction: 'Compra una planta', success: { type: 'reached', path: '/gracias.html' } });
});

test('messages are in Spanish, for designers', () => {
  assert.deepEqual(messages({ ...v2, name: '' }), ['Ponle un nombre al estudio']);
  assert.deepEqual(messages({ ...v2, name: undefined }), ['Ponle un nombre al estudio']);
  assert.deepEqual(messages({ ...v2, blocks: [v2.blocks[0], { ...task, instruction: ' ' }] }), ['La tarea 2 no tiene instrucción']);
  assert.deepEqual(messages({ ...v2, prototypeId: '' }), ['Elige el prototipo que vas a probar']);
  const r = validateStudy({ ...v2, name: '' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'Ponle un nombre al estudio');
  for (const m of messages({ v: 2, blocks: [{}] })) assert.doesNotMatch(m, /\b(is required|must be|invalid)\b/i);
});

test('every block error says which block and which field', () => {
  const [issue] = errors({ ...v2, blocks: [v2.blocks[0], { ...task, instruction: '' }] });
  assert.deepEqual(issue, { message: 'La tarea 2 no tiene instrucción', level: 'error', blockId: 't1', field: 'instruction' });
  const [noName] = errors({ ...v2, name: '' });
  assert.deepEqual(noName, { message: 'Ponle un nombre al estudio', level: 'error', field: 'name' });
});

test('reports all the problems at once, not only the first', () => {
  const list = errors({ v: 2, name: '', prototypeId: '', blocks: [{ id: 'a', kind: 'text', question: '' }] });
  assert.deepEqual(list.map((i) => i.field), ['name', 'prototypeId', 'question']);
});

test('needs at least one block, and a list', () => {
  assert.deepEqual(messages({ ...v2, blocks: [] }), ['Agrega al menos un bloque: una tarea o una pregunta']);
  assert.deepEqual(messages({ ...v1, tasks: [] }), ['Agrega al menos un bloque: una tarea o una pregunta']);
  assert.deepEqual(messages({ ...v2, blocks: undefined }), ['Agrega al menos un bloque: una tarea o una pregunta']);
  assert.match(messages({ ...v2, blocks: 'tareas' })[0] ?? '', /tienen que ser una lista/);
  assert.match(messages({ ...v2, blocks: ['x'] })[0] ?? '', /El bloque 1 tiene que ser un objeto/);
  const many = Array.from({ length: STUDY_LIMITS.maxBlocks + 1 }, (_, i) => ({ id: `q${i}`, kind: 'yesno', question: '¿Sí?' }));
  assert.match(messages({ ...v2, blocks: many })[0] ?? '', /hasta 100 bloques/);
});

test('ids must exist, be simple and be unique across all blocks', () => {
  assert.match(messages(withBlock({ ...task, id: undefined }))[0] ?? '', /A la tarea 1 le falta el "id"/);
  assert.match(messages(withBlock({ ...task, id: 'con espacio' }))[0] ?? '', /solo puede llevar letras, números, guiones/);
  const dup = errors({ ...v2, blocks: [task, { id: 't1', kind: 'yesno', question: '¿Sí?' }] });
  assert.equal(dup.length, 1);
  assert.match(dup[0]?.message ?? '', /El id "t1" está repetido en los bloques 1 y 2/);
  assert.equal(dup[0]?.field, 'id');
});

test('rejects unknown kinds and unknown versions with a hint', () => {
  assert.match(messages(withBlock({ id: 'x', kind: 'rating', question: '?' }))[0] ?? '', /tipo que no existe \("rating"\)\. Usa context, task, first-click, scale, choice, yesno o text/);
  assert.match(messages({ ...v2, v: 3 })[0] ?? '', /versión 3 .* solo entiende la 1 y la 2/);
  assert.match(messages('hola')[0] ?? '', /tiene que ser un objeto JSON/);
  assert.match(messages(null)[0] ?? '', /tiene que ser un objeto JSON/);
});

test('success rules: reached needs a path, tapped a selector, visible a selector or a text', () => {
  const rule = (success: unknown, kind = 'task'): string[] => messages(withBlock({ ...task, kind, success }));
  assert.deepEqual(rule({ type: 'reached' }), ['La tarea 1 no dice a qué pantalla hay que llegar']);
  assert.deepEqual(rule({ type: 'reached', path: '  ' }), ['La tarea 1 no dice a qué pantalla hay que llegar']);
  assert.deepEqual(rule({ type: 'tapped', selector: '' }), ['La tarea 1 no dice qué elemento hay que tocar']);
  assert.deepEqual(rule({ type: 'visible' }), ['La tarea 1 no dice qué texto o elemento tiene que aparecer']);
  assert.deepEqual(rule({ type: 'visible', text: 'Listo' }), []);
  assert.deepEqual(rule({ type: 'visible', selector: '.toast' }), []);
  assert.deepEqual(rule({ type: 'manual' }), []);
  assert.deepEqual(rule(undefined), ['Elige cómo se sabe que la tarea 1 se logró']);
  assert.deepEqual(rule({}), ['Elige cómo se sabe que la tarea 1 se logró']);
  assert.match(rule({ type: 'magia' })[0] ?? '', /regla que no existe \("magia"\)/);
  assert.equal(errors(withBlock({ ...task, success: { type: 'reached' } }))[0]?.field, 'success.path');
  assert.equal(errors(withBlock({ ...task, success: { type: 'tapped' } }))[0]?.field, 'success.selector');
});

test('first click only works with tapped or reached', () => {
  const rule = (success: unknown): string[] => messages(withBlock({ ...task, kind: 'first-click', success }));
  const expected = ['El primer clic 1 solo se puede medir con «toca un elemento» o «llega a una pantalla»'];
  assert.deepEqual(rule({ type: 'manual' }), expected);
  assert.deepEqual(rule({ type: 'visible', text: 'Hola' }), expected);
  assert.deepEqual(rule({ type: 'tapped', selector: '.cart' }), []);
  assert.deepEqual(rule({ type: 'reached', path: '/carrito.html' }), []);
});

test('a tag-only selector is allowed but flagged as a warning', () => {
  const r = validateStudy(withBlock({ ...task, success: { type: 'tapped', selector: 'a' } }));
  assert.equal(r.ok, true);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0]?.level, 'warn');
  assert.equal(r.issues[0]?.blockId, 't1');
  assert.equal(r.issues[0]?.field, 'success.selector');
  assert.match(r.issues[0]?.message ?? '', /cualquier elemento «a»/);
  for (const selector of ['.cart-link', '#agregar', 'a.cart-link', 'header > a']) {
    assert.deepEqual(validateStudy(withBlock({ ...task, success: { type: 'tapped', selector } })).issues, [], selector);
  }
});

test('warns when the expected path can never be followed, or the task is done before starting', () => {
  const warns = (extra: object): string[] => {
    const r = validateStudy(withBlock({ ...task, ...extra }));
    assert.equal(r.ok, true);
    return r.issues.map((i) => `${i.level}:${i.field}`);
  };
  assert.deepEqual(warns({ startPath: '/index.html', expectedPath: ['/producto.html', '/gracias.html'] }), ['warn:expectedPath']);
  assert.deepEqual(warns({ expectedPath: ['/index.html', '/carrito.html'] }), ['warn:expectedPath']);
  assert.deepEqual(warns({ startPath: '/', expectedPath: ['/index.html', '/gracias.html?ok=1'] }), []);
  assert.deepEqual(warns({ startPath: '/gracias.html' }), ['warn:success.path']);
  const r = validateStudy({ ...v2, blocks: [v2.blocks[0]] });
  assert.equal(r.ok, true);
  assert.match(r.issues[0]?.message ?? '', /solo tiene bloques de contexto/);
});

test('startPath cannot be a virtual screen, and expectedPath must be a list of screens', () => {
  assert.match(messages(withBlock({ ...task, startPath: '/index.html~checkout' }))[0] ?? '', /La pantalla de inicio de la tarea 1 .* no se puede abrir directamente/);
  assert.deepEqual(messages(withBlock({ ...task, startPath: '/index.html#/carrito' })), []);
  assert.match(messages(withBlock({ ...task, expectedPath: 'index' }))[0] ?? '', /El camino esperado de la tarea 1 tiene que ser una lista de pantallas/);
  assert.match(messages(withBlock({ ...task, expectedPath: ['/a', ''] }))[0] ?? '', /El camino esperado/);
});

test('scale: only 5, 7 or 10 points; 5 when it does not say', () => {
  const scale = (extra: object): unknown => withBlock({ id: 'q', kind: 'scale', question: '¿Fácil?', ...extra });
  assert.deepEqual(messages(scale({ max: 6 })), ['La escala de la pregunta 1 tiene que ser de 5, 7 o 10 puntos (dice 6)']);
  assert.deepEqual(messages(scale({ max: '5' })), ['La escala de la pregunta 1 tiene que ser de 5, 7 o 10 puntos (dice "5")']);
  for (const max of [5, 7, 10]) assert.deepEqual(messages(scale({ max })), []);
  const r = validateStudy(scale({}));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value.blocks[0], { id: 'q', kind: 'scale', question: '¿Fácil?', max: 5 });
});

test('choice: 2 to 12 options, none empty, none repeated', () => {
  const choice = (options: unknown): string[] => messages(withBlock({ id: 'q', kind: 'choice', question: '¿Cuál?', options }));
  assert.deepEqual(choice(['Una']), ['La pregunta 1 necesita entre 2 y 12 opciones (tiene 1)']);
  assert.deepEqual(choice(undefined), ['La pregunta 1 necesita entre 2 y 12 opciones']);
  assert.deepEqual(choice(Array.from({ length: 13 }, (_, i) => `Opción ${i}`)), ['La pregunta 1 necesita entre 2 y 12 opciones (tiene 13)']);
  assert.deepEqual(choice(['Una', ' ']), ['La opción 2 de la pregunta 1 está vacía']);
  assert.deepEqual(choice(['Una', 7]), ['La opción 2 de la pregunta 1 está vacía']);
  assert.deepEqual(choice(['Una', 'Una']), ['La opción "Una" de la pregunta 1 está repetida']);
  assert.deepEqual(choice(['Una', 'x'.repeat(121)]), ['La opción 2 de la pregunta 1 es muy larga (máximo 120 caracteres)']);
  assert.deepEqual(choice(['Una', 'Dos']), []);
  assert.deepEqual(choice(Array.from({ length: 12 }, (_, i) => `Opción ${i}`)), []);
});

test('text limits: name 120, instruction 600, question 300', () => {
  assert.deepEqual(messages({ ...v2, name: 'x'.repeat(121) }), ['El nombre del estudio es muy largo (máximo 120 caracteres, tiene 121)']);
  assert.deepEqual(messages(withBlock({ ...task, instruction: 'x'.repeat(601) })), ['La instrucción de la tarea 1 es muy larga (máximo 600 caracteres, tiene 601)']);
  assert.deepEqual(messages(withBlock({ id: 'q', kind: 'text', question: 'x'.repeat(301) })), ['El texto de la pregunta 1 es muy largo (máximo 300 caracteres, tiene 301)']);
  assert.deepEqual(messages(withBlock({ ...task, title: 'x'.repeat(121) })), ['El título de la tarea 1 es muy largo (máximo 120 caracteres, tiene 121)']);
  assert.deepEqual(messages({ ...v2, name: 'x'.repeat(120) }), []);
  assert.deepEqual(messages(withBlock({ ...task, instruction: 'x'.repeat(600) })), []);
  assert.deepEqual(messages(withBlock({ id: 'q', kind: 'text', question: 'x'.repeat(300) })), []);
});

test('questions need a text; tasks need a title; context needs something', () => {
  assert.deepEqual(messages(withBlock({ id: 'q', kind: 'yesno' })), ['La pregunta 1 no tiene texto']);
  assert.deepEqual(messages(withBlock({ ...task, title: '' })), ['La tarea 1 no tiene título']);
  assert.deepEqual(messages(withBlock({ id: 'c', kind: 'context' })), ['El contexto 1 está vacío: ponle un título o un texto']);
  assert.deepEqual(messages({ ...v2, blocks: [{ id: 'c', kind: 'context', text: 'Solo texto' }, task] }), []);
  assert.deepEqual(messages(withBlock({ id: 'q', kind: 'yesno', question: 7 })), ['El texto de la pregunta 1 tiene que ser un texto']);
  assert.deepEqual(messages(withBlock({ id: 'q', kind: 'yesno', question: '¿Sí?', required: 'sí' })), ['"required" de la pregunta 1 tiene que ser true o false']);
});

test('variants and settings are checked too', () => {
  assert.deepEqual(messages({ ...v2, variants: [{ id: 'A', name: 'A' }, { id: 'A', name: 'B' }] }), ['El id de variante "A" está repetido']);
  assert.deepEqual(messages({ ...v2, variants: [{ id: 'A' }] }), ['A la variante 1 le falta el nombre']);
  assert.deepEqual(messages({ ...v2, variants: [{ name: 'A' }] }), ['A la variante 1 le falta el "id"']);
  assert.match(messages({ ...v2, variants: 'A/B' })[0] ?? '', /Las variantes .* tienen que ser una lista/);
  assert.match(messages({ ...v2, settings: { advance: 'rápido' } })[0] ?? '', /"settings\.advance" tiene que ser "auto"/);
  assert.match(messages({ ...v2, settings: { askName: 'sí' } })[0] ?? '', /"settings\.askName" tiene que ser true o false/);
  const r = validateStudy({ ...v2, variants: [{ id: 'A', name: 'Con fotos', startPath: '/a.html' }], closed: true, settings: {} });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.variants, [{ id: 'A', name: 'Con fotos', startPath: '/a.html' }]);
  assert.equal(r.value.closed, true);
  assert.equal('settings' in r.value, false);
});

test('warnings never make a study invalid, and errors always do', () => {
  const warned = validateStudy(withBlock({ ...task, success: { type: 'tapped', selector: 'button' } }));
  assert.equal(warned.ok, true);
  const broken = validateStudy({ ...v2, name: '', blocks: [{ ...task, success: { type: 'tapped', selector: 'button' } }] });
  assert.equal(broken.ok, false);
  assert.deepEqual(broken.issues.map((i) => i.level), ['error', 'warn']);
  if (!broken.ok) assert.equal(broken.error, 'Ponle un nombre al estudio');
});

// ── normalizeStudy ─────────────────────────────────────────────────────────────────

test('normalizeStudy turns a stored v1 record into v2 and keeps id and dates', () => {
  const stored = { ...v1, id: 'st_1', createdAt: 10, updatedAt: 20 } as unknown as StudyV1 & { id: string; createdAt: number; updatedAt: number };
  const record: StudyRecord = normalizeStudy(stored);
  assert.equal(record.v, 2);
  assert.equal(record.id, 'st_1');
  assert.equal(record.createdAt, 10);
  assert.equal(record.updatedAt, 20);
  assert.equal('tasks' in record, false);
  assert.deepEqual(record.blocks.map((b) => b.id), ['t1', 't2']);
  assert.equal(record.blocks[0], stored.tasks[0], 'blocks are not copied');
  assert.equal(stored.v, 1, 'the original is untouched');
});

test('normalizeStudy leaves v2 as it is, is idempotent and never rejects', () => {
  const stored = { ...v2, id: 'st_2', createdAt: 1, updatedAt: 2 } as unknown as StudyRecord;
  const once = normalizeStudy(stored);
  assert.deepEqual(once, stored);
  assert.deepEqual(normalizeStudy(once), once);
  const plain: Study = normalizeStudy(v2 as unknown as Study);
  assert.equal('id' in plain, false);
  // Lo guardado no se valida: un estudio que hoy no pasaría las reglas se sigue leyendo.
  const old = normalizeStudy({ v: 1, name: 'x'.repeat(500), prototypeId: 'local', tasks: [{ id: 't1' }, null, 'x'] } as unknown as StudyV1);
  assert.equal(old.name.length, 500);
  assert.equal(old.blocks.length, 1);
  assert.deepEqual(normalizeStudy({} as Study), { v: 2, name: '', prototypeId: '', blocks: [] });
});

test('validateSessionPatch: null clears a manual mark, and applyManualPatch applies it', () => {
  const r = validateSessionPatch({ manual: { t1: null, t2: 'failure' } });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.manual, { t1: null, t2: 'failure' });
  assert.deepEqual(applyManualPatch({ t1: 'success', t3: 'success' }, r.value.manual), { t2: 'failure', t3: 'success' });
  assert.deepEqual(applyManualPatch(undefined, { t9: null }), {});
});
