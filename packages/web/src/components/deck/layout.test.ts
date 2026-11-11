import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Slide } from '@taptana/shared';
import { countLines } from './fit.ts';
import { layoutSlide, outOfBounds, type TextShape } from './layout.ts';

const long = 'Una frase muy larga que se repite para ver qué pasa cuando el texto no cabe en la diapositiva. '.repeat(6);
const ctx = { index: 2, total: 12, deckTitle: 'Un estudio con un nombre larguísimo que podría no caber en el pie de página de la diapositiva' };

const slides: Slide[] = [
  { kind: 'cover', id: 'cover', title: long, subtitle: 'Prototipo X', takeaway: long, items: [{ text: '8 participantes' }, { text: long }, { text: '7 en celular' }], filter: 'Filtro: variante con un nombre largo · solo celular o tablet' },
  { kind: 'empty', id: 'empty', title: 'Todavía no hay resultados', takeaway: long },
  { kind: 'summary', id: 'summary', title: long, score: 100, scoreLabel: 'Muy bien', tone: 'good', metrics: [{ label: 'Tareas logradas', value: '100 %', note: long }, { label: 'b', value: '12 min 59 s' }, { label: 'c', value: '3 %' }, { label: 'd', value: '120' }], takeaway: long },
  { kind: 'highlights', id: 'highlights', title: 'Lo más importante', items: Array.from({ length: 5 }, (_, i) => ({ text: `${i} ${long}`, tone: i % 2 ? 'good' : 'problem' })) },
  {
    kind: 'task', id: 'task-t', blockId: 't', title: long, label: 'Tarea', instruction: long, score: 63, tone: 'ok', participants: 8,
    outcomes: [
      { key: 'direct', label: 'Éxito directo', count: 1, share: 1 / 6 }, { key: 'indirect', label: 'Éxito indirecto', count: 1, share: 1 / 6 },
      { key: 'review', label: 'Por revisar', count: 1, share: 1 / 6 }, { key: 'reported', label: 'Dijo que terminó', count: 1, share: 1 / 6 },
      { key: 'failed', label: 'No pudo', count: 1, share: 1 / 6 }, { key: 'incomplete', label: 'Sin terminar', count: 1, share: 1 / 6 },
    ],
    metrics: [{ label: 'Lo lograron', value: '33 %', note: '2 de 6' }, { label: 'Tiempo', value: '1 min 20 s' }, { label: 'Misclicks', value: '12 %', note: long }],
    drop: long, takeaway: long, takeawayTone: 'problem',
  },
  { kind: 'heatmap', id: 'heatmap-t', blockId: 't', screen: '/a.html', screenName: long, firstClick: false, visitors: 8, taps: 20, misclicks: 5, topMisclicks: [{ label: long, count: 2 }, { label: 'S/ 35', count: 2 }, { label: 'x', count: 1 }], title: long, takeaway: long },
  { kind: 'question', id: 'q1', blockId: 'q1', questionKind: 'scale', label: 'Escala', responses: 8, average: 3.5, max: 10, bars: Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), count: i, share: i / 45, value: '' })), title: long, takeaway: long },
  { kind: 'question', id: 'q2', blockId: 'q2', questionKind: 'choice', label: 'Opción múltiple', responses: 8, bars: Array.from({ length: 10 }, (_, i) => ({ label: `${i} ${long}`, count: i, share: i / 10, value: `${i} · ${i * 10} %` })), title: long, takeaway: long },
  { kind: 'question', id: 'q3', blockId: 'q3', questionKind: 'text', label: 'Pregunta abierta', responses: 8, quotes: Array.from({ length: 4 }, (_, i) => ({ who: `P${i + 1}`, text: long.slice(0, 140) })), title: long, takeaway: long },
  { kind: 'next-steps', id: 'next-steps', title: 'Qué arreglar primero', items: Array.from({ length: 5 }, () => ({ text: long, tone: 'problem' as const })) },
  { kind: 'method', id: 'method', title: 'Cómo se midió', items: Array.from({ length: 7 }, () => ({ text: long })) },
];

test('every slide stays inside 1280×720, even with very long texts', () => {
  for (const slide of slides) {
    const shapes = layoutSlide(slide, ctx);
    assert.deepEqual(outOfBounds(shapes), [], slide.kind);
    for (const s of shapes.filter((x): x is TextShape => x.type === 'text')) {
      const used = countLines(s.text, s.bold ? s.w * 0.93 : s.w, s.size) * s.size * s.lineHeight;
      assert.ok(used <= s.h + s.size * s.lineHeight * 0.5, `${slide.kind}: «${s.text.slice(0, 30)}» (${used} > ${s.h})`);
    }
  }
});

test('editable texts point back to the slide fields', () => {
  const shapes = layoutSlide(slides[3]!, ctx).filter((x): x is TextShape => x.type === 'text' && x.edit !== undefined);
  assert.ok(shapes.some((s) => s.edit === 'title'));
  assert.ok(shapes.some((s) => s.edit === 'item:0'));
  // Lo que se edita es el texto completo, aunque se dibuje recortado.
  for (const s of shapes) assert.ok(s.full.length >= s.text.replace('…', '').length);
});
