import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StudyReport } from '@taptana/shared';
import { MAX_TEXTS, summarizeReport } from './summary.js';

test('summarizeReport caps open answers and handles an empty report', () => {
  const empty = {
    studyId: 'st',
    participants: 0,
    bounced: 0,
    completed: 0,
    successRate: 0,
    medianDurationMs: null,
    avgMisclickRate: 0,
    score: null,
    excluded: 0,
    pendingReview: 0,
    devices: { touch: 0, desktop: 0 },
    insights: [],
    variants: [],
    order: [],
    screenNames: {},
    tasks: [],
    questions: [
      {
        blockId: 'q',
        kind: 'text',
        question: '¿?',
        responses: MAX_TEXTS + 5,
        skipped: 0,
        texts: Array.from({ length: MAX_TEXTS + 5 }, (_, i) => ({ sessionId: `s${i}`, text: `r${i}` })),
      },
    ],
  } as unknown as StudyReport;
  const out = summarizeReport(empty, { id: 'st', name: 'E' });
  assert.equal(out.score, null);
  assert.equal(out.medianMinutes, null);
  assert.equal(out.questions[0]?.answers?.length, MAX_TEXTS);
  assert.equal(out.questions[0]?.moreAnswers, 5);
  assert.equal('variants' in out, false);
});

test('howToRead explains score and expectedPathInferred with the panel wording', async () => {
  const { REPORT_DEFINITIONS } = await import('@taptana/shared');
  const { HOW_TO_READ } = await import('./summary.js');
  const panel = REPORT_DEFINITIONS.map((d) => d.text).join(' ');
  const inferred = HOW_TO_READ.expectedPathInferred.replace(/^true cuando el diseñador no escribió el camino esperado\. /, '');
  assert.ok(inferred.length > 20 && panel.includes(inferred), inferred);
  assert.ok(panel.includes(HOW_TO_READ.score.split('Puntaje de una tarea: ')[1]?.split(' Puntaje del estudio: ')[0] ?? 'x'));
  assert.match(HOW_TO_READ.score, /promedio del puntaje de las tareas/);
});
