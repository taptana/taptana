import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_KINDS,
  BLOCK_KIND_LABELS,
  DEFAULT_CONSENT_TEXT,
  DEFAULT_THANKS_TEXT,
  blockKind,
  blockTitle,
  duplicateStudy,
  isContextBlock,
  isQuestionBlock,
  isTaskBlock,
  newBlockId,
  questionBlocks,
  studyBlocks,
  taskBlocks,
  type Block,
  type Study,
} from './study.js';

const blocks: Block[] = [
  { id: 'c1', kind: 'context', title: 'Antes de empezar', text: 'Imagina que…' },
  { id: 't1', title: 'Comprar', instruction: 'Compra una planta', success: { type: 'reached', path: '/gracias.html' } },
  { id: 'f1', kind: 'first-click', title: 'Carrito', instruction: '¿Dónde tocarías?', success: { type: 'tapped', selector: '.cart' } },
  { id: 'q1', kind: 'scale', question: '¿Qué tan fácil fue?', max: 5 },
  { id: 'q2', kind: 'choice', question: '¿Qué te faltó?', options: ['Precio', 'Fotos'], multiple: true },
  { id: 'q3', kind: 'yesno', question: '¿Lo usarías?' },
  { id: 'q4', kind: 'text', question: '¿Algo más?' },
];
const study: Study = { v: 2, name: 'S', prototypeId: 'local', blocks };

test('block helpers classify every kind', () => {
  assert.deepEqual(blocks.map(blockKind), ['context', 'task', 'first-click', 'scale', 'choice', 'yesno', 'text']);
  assert.deepEqual(blocks.map(isTaskBlock), [false, true, true, false, false, false, false]);
  assert.deepEqual(blocks.map(isQuestionBlock), [false, false, false, true, true, true, true]);
  assert.deepEqual(blocks.map(isContextBlock), [true, false, false, false, false, false, false]);
  assert.deepEqual([...BLOCK_KINDS].sort(), ['choice', 'context', 'first-click', 'scale', 'task', 'text', 'yesno']);
});

test('taskBlocks and questionBlocks keep the study order', () => {
  assert.deepEqual(taskBlocks(study).map((b) => b.id), ['t1', 'f1']);
  assert.deepEqual(questionBlocks(study).map((b) => b.id), ['q1', 'q2', 'q3', 'q4']);
});

test('a stored v1 record that was not normalized is still readable', () => {
  const legacy = { v: 1, name: 'S', prototypeId: 'local', tasks: [blocks[1], blocks[2]] } as unknown as Study;
  assert.deepEqual(studyBlocks(legacy).map((b) => b.id), ['t1', 'f1']);
  assert.deepEqual(taskBlocks(legacy).map((b) => b.id), ['t1', 'f1']);
  assert.deepEqual(questionBlocks(legacy), []);
  assert.deepEqual(studyBlocks({} as Study), []);
});

test('blockTitle picks the text that names the block', () => {
  assert.deepEqual(blocks.map(blockTitle), ['Antes de empezar', 'Comprar', 'Carrito', '¿Qué tan fácil fue?', '¿Qué te faltó?', '¿Lo usarías?', '¿Algo más?']);
  assert.equal(blockTitle({ id: 't', title: '', instruction: 'Haz algo', success: { type: 'manual' } }), 'Haz algo');
  assert.equal(blockTitle({ id: 'c', kind: 'context', title: '', text: 'Solo texto' }), 'Solo texto');
});

test('newBlockId: "b_" plus six characters, never one that is taken', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const id = newBlockId(ids);
    assert.match(id, /^b_[a-z0-9]{6}$/);
    assert.equal(ids.has(id), false);
    ids.add(id);
  }
  assert.equal(ids.size, 500);
  assert.match(newBlockId(), /^b_[a-z0-9]{6}$/);
});

test('default texts say what is and is not recorded', () => {
  assert.match(DEFAULT_CONSENT_TEXT, /^Acepto que esta sesión se grabe/);
  assert.match(DEFAULT_CONSENT_TEXT, /mis respuestas a las preguntas del estudio sí\.$/);
  assert.equal(DEFAULT_THANKS_TEXT, 'Eso era todo. Puedes cerrar esta página.');
});

test('every block kind has a Spanish name', () => {
  for (const kind of BLOCK_KINDS) assert.ok(BLOCK_KIND_LABELS[kind].length > 0, kind);
  assert.equal(BLOCK_KIND_LABELS['first-click'], 'Primer clic');
});

test('duplicateStudy: "Copia de …", new block ids, open again, and the original untouched', () => {
  const original: Study & { id: string; createdAt: number; updatedAt: number } = {
    ...study, id: 'st_1', createdAt: 1, updatedAt: 2, closed: true, welcome: 'Hola',
    variants: [{ id: 'A', name: 'A' }], settings: { advance: 'manual' },
  };
  const copy = duplicateStudy(original);
  assert.equal(copy.name, 'Copia de S');
  assert.equal(copy.v, 2);
  assert.equal(copy.prototypeId, 'local');
  assert.equal(copy.welcome, 'Hola');
  assert.deepEqual(copy.variants, [{ id: 'A', name: 'A' }]);
  assert.deepEqual(copy.settings, { advance: 'manual' });
  assert.equal('closed' in copy, false);
  assert.equal('id' in copy, false);
  assert.equal('createdAt' in copy, false);
  assert.equal(copy.blocks.length, blocks.length);
  const oldIds = new Set(blocks.map((b) => b.id));
  for (const b of copy.blocks) {
    assert.match(b.id, /^b_[a-z0-9]{6}$/);
    assert.equal(oldIds.has(b.id), false);
  }
  assert.equal(new Set(copy.blocks.map((b) => b.id)).size, blocks.length);
  assert.deepEqual(copy.blocks.map(blockTitle), blocks.map(blockTitle));
  assert.deepEqual(original.blocks.map((b) => b.id), ['c1', 't1', 'f1', 'q1', 'q2', 'q3', 'q4']);
  assert.equal(duplicateStudy({ ...study, name: 'x'.repeat(120) }).name.length, 120);
});
