import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_WINDOW,
  PREVIEW_WINDOW,
  TRYOUT_WINDOW,
  isPanelMessage,
  isRecorderMessage,
  type PanelMessage,
  type RecorderMessage,
} from './preview.js';
import type { StudyRecord } from './study.js';

const target = { tag: 'a', selector: 'body > header > a', classes: ['cart-link'], interactive: true };

test('window names are distinct and stable', () => {
  assert.equal(PREVIEW_WINDOW, 'taptana-preview');
  assert.equal(DEMO_WINDOW, 'taptana-demo');
  assert.equal(TRYOUT_WINDOW, 'taptana-tryout');
});

test('isRecorderMessage accepts every message the recorder sends', () => {
  const messages: RecorderMessage[] = [
    { source: 'taptana', type: 'ready', screen: '/index.html', title: 'Inicio' },
    { source: 'taptana', type: 'screen', screen: '/index.html#/carrito', title: 'Carrito', via: 'hash' },
    { source: 'taptana', type: 'screen', screen: '/index.html~checkout', title: '', via: undefined },
    { source: 'taptana', type: 'tap', screen: '/index.html', x: 10, y: 20, target, selector: '.cart-link' },
    { source: 'taptana', type: 'need-study' },
    { source: 'taptana', type: 'tryout', event: 'block', blockId: 'b_abc123' },
    { source: 'taptana', type: 'tryout', event: 'finish' },
  ];
  for (const m of messages) assert.equal(isRecorderMessage(m), true, JSON.stringify(m));
  // Sobrevive al viaje por postMessage (clon estructurado ≈ JSON).
  for (const m of messages) assert.equal(isRecorderMessage(JSON.parse(JSON.stringify(m))), true);
});

test('isRecorderMessage rejects anything else that lands on the message event', () => {
  const junk: unknown[] = [
    null,
    undefined,
    'taptana',
    42,
    [],
    {},
    { source: 'react-devtools-bridge', payload: {} },
    { source: 'taptana' },
    { source: 'taptana', type: 'otra-cosa' },
    { source: 'taptana-panel', type: 'ready', screen: '/', title: '' },
    { source: 'taptana', type: 'ready', screen: '/' },
    { source: 'taptana', type: 'screen', screen: '/', title: '', via: 'teletransporte' },
    { source: 'taptana', type: 'tap', screen: '/', x: '10', y: 20, target, selector: '.a' },
    { source: 'taptana', type: 'tap', screen: '/', x: 10, y: 20, target: null, selector: '.a' },
    { source: 'taptana', type: 'tap', screen: '/', x: 10, y: 20, target },
    { source: 'taptana', type: 'tryout', event: 'pausa' },
    { source: 'taptana', type: 'tryout', event: 'block', blockId: 7 },
  ];
  for (const m of junk) assert.equal(isRecorderMessage(m), false, JSON.stringify(m));
});

test('isPanelMessage accepts the study message, saved or still a draft', () => {
  const study: StudyRecord = { v: 2, id: 'st_1', name: 'S', prototypeId: 'local', createdAt: 0, updatedAt: 0, blocks: [] };
  const whole: PanelMessage = { source: 'taptana-panel', type: 'study', study };
  const fromBlock: PanelMessage = { source: 'taptana-panel', type: 'study', study, startAt: 'b_abc123' };
  assert.equal(isPanelMessage(whole), true);
  assert.equal(isPanelMessage(fromBlock), true);
  assert.equal(isPanelMessage({ source: 'taptana-panel', type: 'study', study: { v: 2, name: 'Borrador', blocks: [] } }), true);
  assert.equal(isPanelMessage({ source: 'taptana-panel', type: 'study', study: { v: 1, tasks: [] } }), true);
});

test('isPanelMessage rejects everything else', () => {
  const junk: unknown[] = [
    null,
    'study',
    {},
    { source: 'taptana', type: 'study', study: { blocks: [] } },
    { source: 'taptana-panel', type: 'otra', study: { blocks: [] } },
    { source: 'taptana-panel', type: 'study' },
    { source: 'taptana-panel', type: 'study', study: 'st_1' },
    { source: 'taptana-panel', type: 'study', study: { name: 'sin bloques' } },
    { source: 'taptana-panel', type: 'study', study: { blocks: [] }, startAt: 3 },
  ];
  for (const m of junk) assert.equal(isPanelMessage(m), false, JSON.stringify(m));
});
