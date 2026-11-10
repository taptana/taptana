import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAnswers, computeTaskResults, manualMarks, needsReview, participantName, tapMatches } from './results.js';
import type { TapEvent, TaptanaEvent } from './events.js';
import type { Block, Study, SuccessRule, TaskBlock, TaskResult } from './study.js';

const nav = (t: number, to: string): TaptanaEvent => ({ kind: 'taptana', type: 'navigation', t, from: '', to });
const tap = (t: number, target: Partial<TapEvent['target']> = {}): TapEvent => ({
  kind: 'taptana', type: 'tap', t, x: 10, y: 20, target: { tag: 'div', selector: 'body > div', ...target },
});
const ev = (t: number, action: 'start' | 'goal' | 'done' | 'skip', taskId = 't1', auto?: boolean): TaptanaEvent =>
  auto === undefined ? { kind: 'taptana', type: 'task', t, taskId, action } : { kind: 'taptana', type: 'task', t, taskId, action, auto };
const answer = (t: number, blockId: string, value: number | boolean | string | string[] | null): TaptanaEvent => ({
  kind: 'taptana', type: 'answer', t, blockId, value,
});

const taskWith = (success: SuccessRule, extra: Partial<TaskBlock> = {}): TaskBlock => ({
  id: 't1', title: 'Tarea', instruction: '…', success, ...extra,
});
const studyOf = (...blocks: Block[]): Study => ({ v: 2, name: 'S', prototypeId: 'local', blocks });
const reached = taskWith({ type: 'reached', path: '/gracias.html' });

const one = (study: Study, events: TaptanaEvent[], sessionEnd?: number): TaskResult => {
  const r = computeTaskResults(study, events, {}, sessionEnd)[0];
  assert.ok(r);
  return r;
};

test('only task blocks produce results, in study order', () => {
  const study = studyOf(
    { id: 'c1', kind: 'context', title: 'Hola', text: '' },
    reached,
    { id: 'q1', kind: 'yesno', question: '¿Sí?' },
    { ...taskWith({ type: 'manual' }), id: 't2' },
  );
  const results = computeTaskResults(study, []);
  assert.deepEqual(results.map((r) => r.taskId), ['t1', 't2']);
  assert.deepEqual(results.map((r) => r.outcome), ['pending', 'pending']);
});

test('a v1 record that was never normalized still works', () => {
  const legacy = { v: 1, name: 'S', prototypeId: 'local', tasks: [reached] } as unknown as Study;
  const r = one(legacy, [ev(10, 'start'), nav(20, '/gracias.html'), ev(30, 'done')]);
  assert.equal(r.outcome, 'success');
});

test('old sessions without goal events: reached is recomputed from navigation', () => {
  const r = one(studyOf(reached), [nav(1, '/'), ev(100, 'start'), nav(400, '/producto.html'), nav(900, '/gracias.html?ok=1'), ev(1500, 'done')]);
  assert.equal(r.outcome, 'success');
  assert.equal(r.ruleMatched, true);
  assert.equal(r.goalAt, 900);
  assert.equal(r.startedAt, 100);
  assert.equal(r.endedAt, 1500);
  assert.equal(r.durationMs, 800, 'time stops when the rule is met, not when "Listo" is tapped');
  assert.equal(r.reported, 'done');
});

test('old sessions without goal events: tapped is recomputed from taps', () => {
  const study = studyOf(taskWith({ type: 'tapped', selector: '.cart-link' }));
  const r = one(study, [ev(100, 'start'), tap(300), tap(700, { tag: 'a', classes: ['cart-link'], text: 'Carrito' }), ev(1000, 'done')]);
  assert.equal(r.outcome, 'success');
  assert.equal(r.goalAt, 700);
  assert.equal(r.durationMs, 600);
  assert.equal(r.firstTap?.t, 300);
  assert.equal(r.goalTap?.t, 700, 'the tap that met the rule is not the first tap');
  assert.equal(r.goalTap?.text, 'Carrito');
});

test('a goal event from the recorder is honoured', () => {
  // El recorder vio que ya estaba en la pantalla: no hay navegación dentro de la tarea.
  const r = one(studyOf(reached), [nav(1, '/gracias.html'), ev(100, 'start'), ev(120, 'goal'), ev(1020, 'done', 't1', true)]);
  assert.equal(r.outcome, 'success');
  assert.equal(r.ruleMatched, true);
  assert.equal(r.goalAt, 120);
  assert.equal(r.durationMs, 20);
});

test('a goal event for a selector the panel cannot evaluate is trusted', () => {
  const study = studyOf(taskWith({ type: 'tapped', selector: 'nav [data-go="cart"]' }));
  const r = one(study, [ev(100, 'start'), tap(300), tap(600, { tag: 'span' }), ev(610, 'goal'), ev(1500, 'done', 't1', true)]);
  assert.equal(r.outcome, 'success');
  assert.equal(r.goalAt, 610);
  assert.equal(r.goalTap?.t, 600);
});

test('goalAt is the earliest sign that the rule was met', () => {
  const r = one(studyOf(reached), [ev(100, 'start'), nav(500, '/gracias.html'), ev(530, 'goal'), ev(1430, 'done', 't1', true)]);
  assert.equal(r.goalAt, 500);
  assert.equal(r.durationMs, 400);
});

test('a visible rule can only be satisfied by a goal event', () => {
  const study = studyOf(taskWith({ type: 'visible', text: 'Cupón aplicado' }));
  const without = one(study, [ev(100, 'start'), tap(200), nav(300, '/gracias.html'), ev(900, 'done')]);
  assert.equal(without.ruleMatched, false);
  assert.equal(without.outcome, 'reported');
  assert.equal(without.durationMs, 800);
  const withGoal = one(study, [ev(100, 'start'), tap(200), ev(450, 'goal'), ev(900, 'done')]);
  assert.equal(withGoal.outcome, 'success');
  assert.equal(withGoal.goalAt, 450);
  assert.equal(withGoal.durationMs, 350);
});

test('a manual rule is never met by events, not even a stray goal', () => {
  const study = studyOf(taskWith({ type: 'manual' }));
  const r = one(study, [ev(100, 'start'), ev(200, 'goal'), ev(900, 'done')]);
  assert.equal(r.ruleMatched, false);
  assert.equal(r.outcome, 'reported');
  assert.equal(r.durationMs, 800);
  assert.equal(needsReview(study.blocks[0], r), true);
});

test('goal events outside the task window do not count', () => {
  const early = one(studyOf(reached), [ev(50, 'goal'), ev(100, 'start'), ev(900, 'skip')]);
  assert.equal(early.outcome, 'failed');
  const late = one(studyOf(reached), [ev(100, 'start'), ev(900, 'done'), ev(950, 'goal')]);
  assert.equal(late.outcome, 'reported');
});

test('duration without a goal runs until "Listo" or "No pude"', () => {
  const skipped = one(studyOf(reached), [ev(100, 'start'), ev(2100, 'skip')]);
  assert.equal(skipped.outcome, 'failed');
  assert.equal(skipped.reported, 'skip');
  assert.equal(skipped.durationMs, 2000);
});

test('rule met and then "No pude": still a success, and the skip is noted', () => {
  const r = one(studyOf(reached), [ev(100, 'start'), nav(500, '/gracias.html'), ev(800, 'skip')]);
  assert.equal(r.outcome, 'success');
  assert.equal(r.reported, 'skip');
  assert.equal(r.durationMs, 400);
});

test('a restarted task counts from its LAST start', () => {
  const r = one(studyOf(reached), [ev(100, 'start'), nav(5000, '/'), ev(5100, 'start'), nav(5600, '/gracias.html'), ev(6000, 'done')]);
  assert.equal(r.startedAt, 5100);
  assert.equal(r.durationMs, 500, 'the reload time is not added');
  assert.equal(r.outcome, 'success');
});

test('a restart forgets what happened before it', () => {
  const r = one(studyOf(reached), [ev(100, 'start'), nav(300, '/gracias.html'), ev(5100, 'start'), ev(6000, 'skip')]);
  assert.equal(r.outcome, 'failed');
  assert.equal(r.ruleMatched, false);
});

test('a stray start after the task was closed does not reopen it', () => {
  const r = one(studyOf(reached), [ev(100, 'start'), nav(500, '/gracias.html'), ev(900, 'done'), ev(950, 'start')]);
  assert.equal(r.startedAt, 100);
  assert.equal(r.outcome, 'success');
  assert.equal(r.endedAt, 900);
});

test('without a close, the task ends at the next block or at the end of the session', () => {
  const study = studyOf(reached, { id: 'q1', kind: 'yesno', question: '¿Sí?' }, { ...taskWith({ type: 'manual' }), id: 't2' });
  const byAnswer = one(study, [ev(100, 'start'), answer(700, 'q1', true), ev(900, 'start', 't2')]);
  assert.equal(byAnswer.outcome, 'incomplete');
  assert.equal(byAnswer.endedAt, 700);
  const byNext = one(study, [ev(100, 'start'), ev(900, 'start', 't2')]);
  assert.equal(byNext.endedAt, 900);
  const byEnd = one(study, [ev(100, 'start'), tap(400)], 5000);
  assert.equal(byEnd.endedAt, 5000);
  assert.equal(byEnd.outcome, 'incomplete');
  const byLastEvent = one(study, [ev(100, 'start'), tap(400), { kind: 'rrweb', t: 3000, data: {} }]);
  assert.equal(byLastEvent.endedAt, 3000);
});

test('manual marks win over everything; a task never started can be marked too', () => {
  const study = studyOf(reached, { ...taskWith({ type: 'manual' }), id: 't2' });
  const events = [ev(100, 'start'), nav(500, '/gracias.html'), ev(900, 'done')];
  const [a, b] = computeTaskResults(study, events, { t1: 'failure', t2: 'success' });
  assert.equal(a?.outcome, 'failed');
  assert.equal(a?.manual, 'failure');
  assert.equal(a?.ruleMatched, true);
  assert.equal(b?.outcome, 'success');
  assert.equal(b?.startedAt, undefined);
});

test('needsReview: only a manual task reported as done and not yet marked', () => {
  const manual = taskWith({ type: 'manual' });
  const study = studyOf(manual);
  const done = one(study, [ev(100, 'start'), ev(900, 'done')]);
  assert.equal(needsReview(manual, done), true);
  const marked = computeTaskResults(study, [ev(100, 'start'), ev(900, 'done')], { t1: 'success' })[0] as TaskResult;
  assert.equal(needsReview(manual, marked), false);
  const skipped = one(study, [ev(100, 'start'), ev(900, 'skip')]);
  assert.equal(skipped.outcome, 'failed');
  assert.equal(needsReview(manual, skipped), false);
  const open = one(study, [ev(100, 'start')], 900);
  assert.equal(needsReview(manual, open), false);
  const ruleBased = one(studyOf(reached), [ev(100, 'start'), ev(900, 'done')]);
  assert.equal(ruleBased.outcome, 'reported');
  assert.equal(needsReview(reached, ruleBased), false);
  assert.equal(needsReview({ id: 'q', kind: 'yesno', question: '?' }, done), false);
  assert.equal(needsReview(undefined, done), false);
});

// ── Primer clic ────────────────────────────────────────────────────────────────────

const firstClick = (success: SuccessRule): Study => studyOf(taskWith(success, { kind: 'first-click' }), { ...taskWith({ type: 'manual' }, { startPath: '/carrito.html' }), id: 't2' });

test('first click: ends at the first tap; a matching tap is a success', () => {
  const study = firstClick({ type: 'tapped', selector: '.cart-link' });
  const r = one(study, [ev(100, 'start'), tap(600, { tag: 'a', classes: ['cart-link'] }), ev(601, 'done'), tap(900)]);
  assert.equal(r.outcome, 'success');
  assert.equal(r.endedAt, 600);
  assert.equal(r.durationMs, 500);
  assert.equal(r.firstTap?.t, 600);
  assert.equal(r.goalTap?.t, 600);
});

test('first click: tapping elsewhere is a failure, even if the right tap comes later', () => {
  const study = firstClick({ type: 'tapped', selector: '.cart-link' });
  const r = one(study, [ev(100, 'start'), tap(600), tap(900, { classes: ['cart-link'] })]);
  assert.equal(r.outcome, 'failed');
  assert.equal(r.reported, 'done');
  assert.equal(r.endedAt, 600);
  assert.equal(r.ruleMatched, false);
});

test('first click: no tap and "No pude" is a failure; no tap at all is incomplete', () => {
  const study = firstClick({ type: 'tapped', selector: '.cart-link' });
  assert.equal(one(study, [ev(100, 'start'), ev(900, 'skip')]).outcome, 'failed');
  assert.equal(one(study, [ev(100, 'start')], 900).outcome, 'incomplete');
});

test('first click with a reached rule: succeeds when the screen arrives within 2 s of the tap', () => {
  const study = firstClick({ type: 'reached', path: '/carrito.html' });
  // Recorder antiguo: emite "done" justo después del toque; la navegación cae después.
  const hit = one(study, [ev(100, 'start'), tap(600, { tag: 'a' }), ev(601, 'done'), nav(640, '/carrito.html'), ev(990, 'start', 't2')]);
  assert.equal(hit.outcome, 'success');
  assert.equal(hit.goalAt, 640);
  assert.equal(hit.endedAt, 600);
  assert.equal(hit.durationMs, 500, 'time to first click, not to the page load');
  const slow = one(study, [ev(100, 'start'), tap(600), nav(2601, '/carrito.html')]);
  assert.equal(slow.outcome, 'failed', 'more than 2 s later is not this tap');
  const edge = one(study, [ev(100, 'start'), tap(600), nav(2600, '/carrito.html')]);
  assert.equal(edge.outcome, 'success');
  const elsewhere = one(study, [ev(100, 'start'), tap(600), nav(640, '/producto.html')]);
  assert.equal(elsewhere.outcome, 'failed');
});

test('first click with a reached rule: the jump to the next task start screen is not a hit', () => {
  const study = firstClick({ type: 'reached', path: '/carrito.html' });
  // Tocó mal; la tarea siguiente empieza en /carrito.html y el recorder antiguo salta ahí.
  const r = one(study, [ev(100, 'start'), tap(600), ev(601, 'done'), ev(951, 'start', 't2'), nav(980, '/carrito.html')]);
  assert.equal(r.outcome, 'failed');
});

test('first click: a goal event near the first tap is honoured, one before it is not', () => {
  const study = firstClick({ type: 'tapped', selector: '[data-cart]' });
  const hit = one(study, [ev(100, 'start'), ev(600, 'goal'), tap(605, { tag: 'span' }), ev(900, 'done', 't1', true)]);
  assert.equal(hit.outcome, 'success');
  assert.equal(hit.endedAt, 605);
  const stale = one(study, [ev(100, 'start'), ev(110, 'goal'), tap(900)]);
  assert.equal(stale.outcome, 'failed');
});

// ── tapMatches ─────────────────────────────────────────────────────────────────────

test('tapMatches understands simple selectors', () => {
  const t = tap(1, { tag: 'a', id: 'cart', classes: ['cart-link', 'icon'], selector: 'body > header > #cart' });
  for (const s of ['#cart', '.cart-link', 'a', 'a.cart-link', 'a#cart.icon', '.icon.cart-link', 'body > header > #cart', ' .cart-link ']) {
    assert.equal(tapMatches(t, s), true, s);
  }
  for (const s of ['#other', '.missing', 'button', 'button.cart-link', '', '  ', 'a.cart-link.nope', 'header .cart-link']) {
    assert.equal(tapMatches(t, s), false, s);
  }
});

test('tapMatches: a tap inside the element counts, and comma lists are alternatives', () => {
  const inside = tap(1, { tag: 'span', selector: '#agregar > span' });
  assert.equal(tapMatches(inside, '#agregar'), true);
  assert.equal(tapMatches(inside, '#pagar'), false);
  assert.equal(tapMatches(inside, '#pagar, #agregar'), true);
  assert.equal(tapMatches(inside, '#pagar, .x'), false);
});

// ── Respuestas ─────────────────────────────────────────────────────────────────────

const questions = studyOf(
  reached,
  { id: 'q1', kind: 'scale', question: '¿Fácil?', max: 5 },
  { id: 'q2', kind: 'choice', question: '¿Cuál?', options: ['A', 'B'], multiple: true },
  { id: 'q3', kind: 'text', question: '¿Algo más?' },
  { id: 'q4', kind: 'yesno', question: '¿Sí?' },
);

test('computeAnswers: one result per answered question, in study order', () => {
  const events: TaptanaEvent[] = [
    answer(300, 'q3', 'Todo bien'),
    { kind: 'taptana', type: 'answer', t: 100, blockId: 'q1', value: 4, durationMs: 1500 },
    answer(200, 'q2', ['A', 'B']),
  ];
  assert.deepEqual(computeAnswers(questions, events), [
    { blockId: 'q1', value: 4, t: 100, durationMs: 1500 },
    { blockId: 'q2', value: ['A', 'B'], t: 200 },
    { blockId: 'q3', value: 'Todo bien', t: 300 },
  ]);
});

test('computeAnswers: the last answer per block wins, skips are null, unknown blocks are ignored', () => {
  const events = [answer(100, 'q1', 2), answer(200, 'q4', null), answer(300, 'q1', 5), answer(400, 'borrada', 'x'), answer(500, 't1', 'x')];
  assert.deepEqual(computeAnswers(questions, events), [
    { blockId: 'q1', value: 5, t: 300 },
    { blockId: 'q4', value: null, t: 200 },
  ]);
  assert.deepEqual(computeAnswers(questions, []), []);
});

test('participantName reads the alias from the study start event', () => {
  const start = (participant?: string): TaptanaEvent =>
    participant === undefined
      ? { kind: 'taptana', type: 'study', t: 1, studyId: 'st', action: 'start' }
      : { kind: 'taptana', type: 'study', t: 1, studyId: 'st', action: 'start', participant };
  assert.equal(participantName([nav(0, '/'), start(' Ana ')]), 'Ana');
  assert.equal(participantName([start()]), undefined);
  assert.equal(participantName([start('   ')]), undefined);
  assert.equal(participantName([]), undefined);
});

test('manualMarks recovers the moderator marks from computed results', () => {
  const study = studyOf(reached, { ...taskWith({ type: 'manual' }), id: 't2' }, { ...taskWith({ type: 'manual' }), id: 't3' });
  const results = computeTaskResults(study, [ev(100, 'start'), ev(900, 'done')], { t1: 'failure', t3: 'success' });
  assert.deepEqual(manualMarks(results), { t1: 'failure', t3: 'success' });
  assert.deepEqual(manualMarks(undefined), {});
  assert.deepEqual(manualMarks([]), {});
});
