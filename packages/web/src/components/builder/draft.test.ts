import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDraft,
  cloneBlock,
  commonPath,
  demoResult,
  emptyDraft,
  fieldError,
  issueSelection,
  missedScreens,
  moveItem,
  newBlock,
  parseStudyText,
  pushScreen,
  reassignIds,
  studyFileName,
  tryoutStudy,
  type DemoStep,
  type DraftStudy,
} from './draft.ts';

test('newBlock: sin regla ni valores inventados, id nuevo', () => {
  const b = newBlock('task', ['b_aaaaaa']);
  assert.match(b.id, /^b_[a-z0-9]{6}$/);
  assert.equal('success' in b, false);
  const c = newBlock('choice', []);
  assert.deepEqual((c as { options: string[] }).options, ['', '']);
});

test('cloneBlock y reassignIds no reutilizan ids', () => {
  const b = newBlock('scale', []);
  const copy = cloneBlock(b, [b.id]);
  assert.notEqual(copy.id, b.id);
  const again = reassignIds([b, copy], [b.id, copy.id]);
  assert.equal(new Set([b.id, copy.id, ...again.map((x) => x.id)]).size, 4);
});

test('moveItem', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 5), ['a', 'b', 'c']);
});

test('checkDraft: errores con bloque y campo; tarea sin regla', () => {
  const draft: DraftStudy = { ...emptyDraft('p1'), name: '', blocks: [{ id: 'b_1', kind: 'task', title: 'Comprar', instruction: 'Compra algo' }] };
  const check = checkDraft(draft);
  assert.equal(check.ok, false);
  assert.ok(fieldError(check.errors, undefined, 'name'));
  assert.ok(fieldError(check.errors, 'b_1', 'success', 'success.path', 'success.selector'));
  const nameIssue = check.errors.find((i) => i.field === 'name');
  assert.equal(issueSelection(nameIssue!), 'settings');
  assert.equal(issueSelection({ message: 'x', blockId: 'b_1' }), 'b_1');
  assert.equal(issueSelection({ message: 'x', field: 'consent' }), 'welcome');
});

test('checkDraft: estudio completo es válido', () => {
  const draft: DraftStudy = {
    ...emptyDraft('p1'),
    name: 'Compra',
    blocks: [
      { id: 'b_1', kind: 'task', title: 'Comprar', instruction: 'Compra algo', success: { type: 'reached', path: '/gracias.html' } },
      { id: 'b_2', kind: 'scale', question: '¿Qué tan fácil fue?', max: 5 },
    ],
  };
  const check = checkDraft(draft);
  assert.equal(check.ok, true);
  assert.equal(check.value?.blocks.length, 2);
});

test('tryoutStudy: una tarea se puede probar aunque el resto esté a medias', () => {
  const draft: DraftStudy = {
    ...emptyDraft('p1'),
    blocks: [
      { id: 'b_1', kind: 'task', title: 'Comprar', instruction: 'Compra algo', success: { type: 'manual' } },
      { id: 'b_2', kind: 'task', title: '', instruction: '' },
    ],
  };
  assert.equal(tryoutStudy(draft).study, null);
  const one = tryoutStudy(draft, 'b_1');
  assert.equal(one.study?.blocks.length, 1);
  assert.equal(one.study?.name, 'Borrador');
});

const demo: DemoStep[] = [
  { type: 'screen', screen: '/index.html', title: 'Inicio' },
  { type: 'tap', screen: '/index.html', selector: '.card', text: 'Monstera' },
  { type: 'screen', screen: '/producto.html?id=2', title: 'Producto' },
  { type: 'tap', screen: '/producto.html', selector: '#agregar', text: 'Agregar' },
];

test('pushScreen no repite la pantalla que ya está delante', () => {
  const a = pushScreen([], '/index.html', 'Inicio');
  const b = pushScreen(a, '/index.html?x=1', 'Inicio');
  assert.equal(b.length, 1);
  assert.equal(pushScreen(b, '/carrito.html', 'Carrito').length, 2);
});

test('demoResult: llega a la última pantalla por defecto y ofrece el último toque', () => {
  const r = demoResult(demo);
  assert.ok(r);
  assert.equal(r.startPath, '/index.html');
  assert.deepEqual(r.expectedPath, ['/index.html', '/producto.html']);
  assert.deepEqual(r.reached, { type: 'reached', path: '/producto.html' });
  assert.deepEqual(r.tapped?.rule, { type: 'tapped', selector: '#agregar' });
  assert.equal(r.suggested, 'reached');
});

test('demoResult: si el último toque cambió de pantalla no se ofrece tocar', () => {
  const r = demoResult(demo.slice(0, 3));
  assert.equal(r?.tapped, undefined);
  assert.equal(r?.suggested, 'reached');
});

test('demoResult: sin cambio de pantalla, sugiere el toque; sin nada, null', () => {
  assert.equal(demoResult(demo.slice(0, 1)), null);
  const r = demoResult(demo.slice(0, 2));
  assert.equal(r?.suggested, 'tapped');
  assert.equal(r?.reached, undefined);
});

test('demoResult: primer clic usa el primer toque y la pantalla de inicio', () => {
  const r = demoResult(demo, 'first-click');
  assert.deepEqual(r?.tapped?.rule, { type: 'tapped', selector: '.card' });
  assert.deepEqual(r?.reached, { type: 'reached', path: '/producto.html' });
  assert.deepEqual(r?.expectedPath, []);
  assert.equal(demoResult(demo.slice(0, 1), 'first-click'), null);
});

test('missedScreens: avisa de la pantalla que casi todos visitan y falta en el camino', () => {
  const rows = [
    { outcome: 'indirect' as const, pages: ['/index.html', '/producto.html', '/carrito.html', '/gracias.html'] },
    { outcome: 'indirect' as const, pages: ['/index.html', '/producto.html', '/carrito.html', '/gracias.html'] },
    { outcome: 'failed' as const, pages: ['/index.html', '/ayuda.html'] },
  ];
  assert.deepEqual(missedScreens(['/index.html', '/producto.html', '/gracias.html'], rows), ['/carrito.html']);
  assert.deepEqual(missedScreens(['/index.html', '/producto.html', '/carrito.html', '/gracias.html'], rows), []);
  assert.deepEqual(missedScreens(undefined, rows), []);
});

test('commonPath: el más repetido entre quienes lo lograron', () => {
  assert.deepEqual(
    commonPath([
      { pages: ['/a.html'], count: 5, successes: 0 },
      { pages: ['/a.html', '/b.html'], count: 3, successes: 3 },
    ]),
    ['/a.html', '/b.html'],
  );
  assert.equal(commonPath([]), null);
});

test('parseStudyText: v1, con cercas de código y con errores en español', () => {
  const v1 = { v: 1, name: 'Compra', prototypeId: 'local', tasks: [{ id: 't1', title: 'A', instruction: 'Haz A', success: { type: 'manual' } }] };
  const ok = parseStudyText('Aquí tienes:\n```json\n' + JSON.stringify(v1) + '\n```');
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.study.v, 2);
    assert.equal(ok.study.blocks[0]?.id, 't1');
  }
  const bad = parseStudyText('{ no es json');
  assert.equal(bad.ok, false);
  const invalid = parseStudyText(JSON.stringify({ v: 2, name: '', prototypeId: 'p', blocks: [] }));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.ok(invalid.messages.length >= 1);
});

test('studyFileName', () => {
  assert.equal(studyFileName('Compra en Verde: versión 2'), 'taptana-study-compra-en-verde-version-2.json');
  assert.equal(studyFileName(''), 'taptana-study-estudio.json');
});
