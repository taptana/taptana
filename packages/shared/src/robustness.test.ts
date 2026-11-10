import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStudyReport, studyCsv, type ReportSession } from './report.js';
import { computeAnswers, computeTaskResults } from './results.js';
import { countScreens, knownScreens, maskUrl, sameScreen, screenId, screenLabel } from './screen.js';
import { normalizeStudy, validateEventBatch, validateSessionExport, validateSessionPatch, validateStudy } from './validate.js';
import { batchesToExport } from './batches.js';
import type { TaptanaEvent } from './events.js';
import type { Study, StudyRecord } from './study.js';

/**
 * Lo que ya está guardado puede venir de una versión anterior, de un archivo editado a mano o
 * de un recorder con un error. Ningún cálculo debe tirar una excepción por eso: en el servidor
 * sería un 500 y en la demo una pantalla en blanco.
 */

const junk: unknown[] = [
  undefined, null, 0, -1, 3.5, NaN, Infinity, '', 'x', '~', '#', '?', '/%', true, false, [], [null], {}, { id: 1 }, { kind: 'nope' },
  { t: 'x' }, { kind: 'taptana' }, { kind: 'taptana', type: 'tap', t: 1 }, { kind: 'taptana', type: 'tap', t: 1, target: null },
  { kind: 'taptana', type: 'tap', t: 2, target: {} }, { kind: 'taptana', type: 'navigation', t: 3 }, { kind: 'taptana', type: 'navigation', t: 3, to: 7 },
  { kind: 'taptana', type: 'task', t: 4 }, { kind: 'taptana', type: 'task', t: 4, taskId: 't1', action: 'start' },
  { kind: 'taptana', type: 'task', t: 5, taskId: 7, action: 'done' }, { kind: 'taptana', type: 'answer', t: 6 },
  { kind: 'taptana', type: 'answer', t: 6, blockId: 'q1', value: {} }, { kind: 'taptana', type: 'viewport', t: 7 },
  { kind: 'taptana', type: 'study', t: 8 }, { kind: 'taptana', type: 'study', t: 8, action: 'start', participant: 9 },
  { kind: 'rrweb', t: 9 }, { kind: 'rrweb', t: NaN, data: 1 },
];

const brokenStudies: unknown[] = [
  {}, { blocks: 'x' }, { blocks: [null, 7, 'x', {}] }, { tasks: [{ id: 't1' }] },
  { id: 'st_1', blocks: [{ id: 't1' }, { id: 't2', success: null }, { id: 't3', success: { type: 'reached' } }, { id: 't4', success: { type: 'tapped', selector: 9 } }] },
  { id: 'st_1', blocks: [{ id: 't1', kind: 'first-click', success: { type: 'reached', path: 5 }, startPath: 5, expectedPath: 'x' }] },
  { id: 'st_1', blocks: [{ id: 'q1', kind: 'scale' }, { id: 'q2', kind: 'choice' }, { id: 'q3', kind: 'choice', options: 'a' }, { id: 'q4', kind: 'yesno' }, { id: 'q5', kind: 'text' }, { id: 'c', kind: 'context' }, { id: 'z', kind: 'raro' }] },
  { id: 'st_1', variants: 'A', blocks: [{ id: 't1', title: 'T', instruction: 'I', success: { type: 'manual' }, expectedPath: [1, null, '/a'] }] },
];

const brokenSessions = (): ReportSession[] =>
  [
    { session: { id: 's1', studyId: 'st_1' }, events: junk },
    { session: { id: 's2', studyId: 'st_1', viewport: null, tasks: 'x', startedAt: 'ayer', lastSeenAt: null, durationMs: 'mucho', touch: 'sí' }, events: [...junk].reverse() },
    { session: { id: 's3', studyId: 'st_1', tasks: [null, { taskId: 't1', manual: 'success' }, { manual: 'failure' }] }, events: [] },
    { session: { id: 's4', studyId: 'st_1' } },
    { session: null, events: [] },
    null,
  ] as unknown as ReportSession[];

test('screen helpers accept anything', () => {
  for (const value of junk) {
    const input = value as string;
    assert.equal(typeof screenId(input), 'string');
    assert.equal(typeof screenLabel(input), 'string');
    assert.equal(typeof maskUrl(input), 'string');
    assert.equal(typeof sameScreen(input, '/'), 'boolean');
  }
  assert.equal(typeof countScreens(junk as TaptanaEvent[]), 'number');
  assert.ok(Array.isArray(knownScreens([], junk as TaptanaEvent[])));
});

test('validators answer with ok: false instead of throwing', () => {
  for (const value of [...junk, ...brokenStudies]) {
    assert.equal(typeof validateStudy(value).ok, 'boolean');
    assert.equal(typeof validateEventBatch(value).ok, 'boolean');
    assert.equal(typeof validateSessionPatch(value).ok, 'boolean');
    assert.equal(typeof validateSessionExport(value).ok, 'boolean');
    assert.equal(typeof validateStudy({ v: 2, name: value, prototypeId: value, blocks: [value, { id: value, kind: value, success: value, options: value, max: value }], variants: [value], settings: value }).ok, 'boolean');
    assert.equal(typeof validateEventBatch({ v: 1, prototypeId: 'p', sessionId: 's', pageId: 'g', seq: 0, sentAt: 0, events: [value], page: value, device: value }).ok, 'boolean');
    assert.equal(typeof validateSessionExport({ v: 1, session: { id: 's', prototypeId: 'p', viewport: value, tasks: value, label: value }, pages: value, events: junk, study: value }).ok, 'boolean');
  }
});

test('results, answers, reports and CSV survive broken studies and broken events', () => {
  for (const raw of brokenStudies) {
    const study = raw as StudyRecord;
    assert.ok(Array.isArray(computeTaskResults(study, junk as TaptanaEvent[])));
    assert.ok(Array.isArray(computeAnswers(study, junk as TaptanaEvent[])));
    const report = computeStudyReport(study, brokenSessions());
    assert.equal(typeof report.participants, 'number');
    assert.ok(Array.isArray(report.insights));
    assert.doesNotMatch(JSON.stringify(report.insights), /undefined|NaN/);
    assert.equal(typeof studyCsv(study, brokenSessions()), 'string');
    const normalized = normalizeStudy(raw as Study);
    assert.equal(normalized.v, 2);
    assert.ok(Array.isArray(computeStudyReport(normalized as StudyRecord, brokenSessions()).tasks));
  }
});

test('batchesToExport survives odd batches', () => {
  const out = batchesToExport([{ v: 1, prototypeId: 'p', sessionId: 's', pageId: 'g', seq: 0, sentAt: 5, events: [] }]);
  assert.ok(out);
  assert.equal(out.session.startedAt, 5);
  assert.equal(out.session.screenCount, 0);
});
