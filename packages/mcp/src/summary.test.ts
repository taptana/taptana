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
