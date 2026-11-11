import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyDeckEdits, buildDeck, dateRange, deckFileName, visibleSlides, type Slide } from './deck.js';
import { computeStudyReport, type ReportSession } from './report.js';
import type { TaptanaEvent } from './events.js';
import type { SessionSummary } from './session.js';
import type { StudyRecord } from './study.js';

// Las sesiones de ejemplo de verdad (las mismas que carga «Ver un ejemplo»).
const seedDir = fileURLToPath(new URL('../../server/seed/', import.meta.url));
const seeds = readdirSync(seedDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(seedDir + f, 'utf8')) as { session: SessionSummary; events: TaptanaEvent[]; study?: StudyRecord });
const study = seeds.map((s) => s.study).find((s): s is StudyRecord => s?.id === 'st_demo_compra')!;
const sessions: ReportSession[] = seeds.map((s) => ({ session: s.session, events: s.events }));
const report = computeStudyReport(study, sessions);

/** Los alias y etiquetas que escribieron o pusieron a los participantes de ejemplo. */
const aliases = seeds.flatMap((s) => {
  const out: string[] = [];
  if (s.session.label) out.push(...s.session.label.split('·').map((x) => x.trim()).filter((x) => x.length > 2 && !/^P\d+$/.test(x)));
  for (const e of s.events) if (e.kind === 'taptana' && e.type === 'study' && typeof e.participant === 'string' && e.participant.trim()) out.push(e.participant.trim());
  return out;
});

const kinds = (slides: Slide[]): string[] => slides.map((s) => s.kind);

test('the example study becomes a full deck in study order', () => {
  assert.ok(study, 'el ejemplo trae su estudio');
  const deck = buildDeck(study, report, { prototypeName: 'Tienda de ejemplo' });
  assert.equal(deck.title, 'Compra en Verde');
  const k = kinds(deck.slides);
  assert.deepEqual(k.slice(0, 3), ['cover', 'summary', 'highlights']);
  assert.deepEqual(k.slice(-2), ['next-steps', 'method']);
  assert.ok(deck.slides.length > 6);
  // Tareas y preguntas en el orden del estudio; el mapa va justo después de su tarea.
  const blocks = deck.slides.filter((s): s is Extract<Slide, { blockId: string }> => 'blockId' in s && s.kind !== 'heatmap').map((s) => s.blockId);
  assert.deepEqual(blocks, ['t1', 'facilidad', 't2', 'volveria', 'decision', 't3', 'mejora']);
  for (const [i, s] of deck.slides.entries()) {
    if (s.kind === 'heatmap') assert.equal((deck.slides[i - 1] as { blockId?: string }).blockId, s.blockId);
  }

  const cover = deck.slides[0]!;
  assert.equal(cover.kind === 'cover' && cover.subtitle, 'Prototipo Tienda de ejemplo');
  assert.ok(cover.items?.some((i) => i.text === `${report.participants} participantes`));

  const summary = deck.slides[1]!;
  assert.ok(summary.kind === 'summary');
  assert.equal(summary.score, report.score);
  assert.ok(summary.metrics.some((m) => m.label === 'Tareas logradas'));

  const highlights = deck.slides[2]!;
  assert.ok(highlights.items && highlights.items.length >= 3 && highlights.items.length <= 5);
  // Las frases son las del reporte, palabra por palabra.
  for (const item of highlights.items) assert.ok(report.insights.some((i) => i.text === item.text));

  const t1 = deck.slides.find((s) => s.id === 'task-t1');
  assert.ok(t1 && t1.kind === 'task');
  assert.equal(t1.instruction, 'Quieres regalarle a tu mamá una planta grande. Encuentra una y cómprala.');
  const task = report.tasks.find((t) => t.taskId === 't1')!;
  assert.equal(t1.outcomes.reduce((a, o) => a + o.count, 0), task.participants);
  assert.ok(t1.outcomes.every((o) => o.label.length > 0));

  const firstClick = deck.slides.find((s) => s.id === 'task-t2');
  assert.ok(firstClick && firstClick.kind === 'task' && firstClick.outcomes.some((o) => o.label === 'Acertó'));

  const scale = deck.slides.find((s) => s.id === 'question-facilidad');
  assert.ok(scale && scale.kind === 'question' && scale.average !== undefined && scale.bars?.length === 5);
  const text = deck.slides.find((s) => s.id === 'question-mejora');
  assert.ok(text && text.kind === 'question' && text.quotes && text.quotes.length > 0 && text.quotes.length <= 4);
  for (const q of text.quotes) assert.match(q.who, /^P\d+$/);

  const steps = deck.slides.find((s) => s.kind === 'next-steps')!;
  assert.ok(steps.items && steps.items.length >= 1 && steps.items.length <= 5);
});

test('the deck never carries names, aliases or session ids', () => {
  assert.ok(aliases.length >= 5, `alias de las semillas: ${aliases.join(', ')}`);
  const json = JSON.stringify(buildDeck(study, report));
  for (const name of aliases) assert.ok(!json.includes(name), `la presentación no dice «${name}»`);
  for (const s of sessions) assert.ok(!json.includes(s.session.id), `ni el id ${s.session.id}`);
  assert.ok(!json.includes('s_demo'));
});

test('zero participants: cover and a no-results slide', () => {
  const empty = buildDeck(study, computeStudyReport(study, []));
  assert.deepEqual(kinds(empty.slides), ['cover', 'empty']);
  assert.equal(empty.slides[1]!.title, 'Todavía no hay resultados');
  assert.deepEqual(empty.slides[0]!.items, []);
});

test('filters are respected and named on the cover', () => {
  const desktop = computeStudyReport(study, sessions, { device: 'desktop' });
  const deck = buildDeck(study, desktop);
  const cover = deck.slides[0]!;
  assert.ok(cover.kind === 'cover');
  assert.equal(cover.filter, 'Filtro: solo escritorio');
  assert.ok(cover.items?.some((i) => i.text === `${desktop.participants} ${desktop.participants === 1 ? 'participante' : 'participantes'}`));
  assert.ok(desktop.participants < report.participants);
  assert.ok(deck.slides.find((s) => s.kind === 'method')?.items?.some((i) => i.text.includes('solo escritorio')));

  const nobody = buildDeck(study, computeStudyReport(study, sessions, { variantId: 'no-existe' }));
  assert.deepEqual(kinds(nobody.slides), ['cover', 'empty']);
  assert.match(nobody.slides[1]!.takeaway ?? '', /filtro/);
});

test('small samples get the same warning as the report', () => {
  const few = computeStudyReport(study, sessions.slice(3, 6));
  const method = buildDeck(study, few).slides.find((s) => s.kind === 'method')!;
  assert.ok(method.items?.some((i) => i.text.startsWith(`Con pocas personas (${few.participants})`)));
});

test('edits change texts and hide slides; empty texts keep the original', () => {
  const deck = buildDeck(study, report);
  const edited = applyDeckEdits(deck, {
    cover: { title: 'Mi estudio' },
    summary: { hidden: true, takeaway: '  ' },
    highlights: { items: { '0': 'Otra frase', '1': '' } },
    'no-existe': { title: 'x' },
  });
  assert.equal(edited.title, 'Mi estudio');
  assert.equal(edited.slides[0]!.title, 'Mi estudio');
  assert.equal(edited.slides[1]!.hidden, true);
  assert.equal(edited.slides[1]!.takeaway, deck.slides[1]!.takeaway);
  assert.equal(edited.slides[2]!.items?.[0]?.text, 'Otra frase');
  assert.equal(edited.slides[2]!.items?.[1]?.text, deck.slides[2]!.items?.[1]?.text);
  assert.equal(visibleSlides(edited).length, deck.slides.length - 1);
  assert.equal(applyDeckEdits(deck, null), deck);
});

test('date ranges and file names', () => {
  const d = (y: number, m: number, day: number): number => new Date(y, m, day, 12).getTime();
  assert.equal(dateRange(d(2026, 10, 11), d(2026, 10, 11)), '11 de noviembre de 2026');
  assert.equal(dateRange(d(2026, 10, 3), d(2026, 10, 11)), '3 al 11 de noviembre de 2026');
  assert.equal(dateRange(d(2026, 9, 28), d(2026, 10, 2)), '28 de octubre al 2 de noviembre de 2026');
  assert.equal(deckFileName('Compra en Verde: ¿fácil?'), 'compra-en-verde-facil-presentacion');
  assert.equal(deckFileName('¡¡!!'), 'estudio-presentacion');
});
