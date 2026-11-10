/**
 * Lógica pura del constructor de estudios: el borrador, sus bloques y lo que se deduce de una
 * demostración en el teléfono. Sin React ni DOM, para poder probarla con `node --test`.
 */

import {
  blockKind,
  isTaskBlock,
  newBlockId,
  sameScreen,
  screenId,
  screenUrl,
  validateStudy,
  type Block,
  type BlockKind,
  type ContextBlock,
  type QuestionBlock,
  type Study,
  type StudyIssue,
  type SuccessRule,
  type TaskBlock,
  type TaskReportRow,
} from '@taptana/shared';

/** Una tarea a medio escribir: todavía puede no tener regla de éxito. */
export type DraftTask = Omit<TaskBlock, 'success'> & { success?: SuccessRule };
export type DraftBlock = DraftTask | QuestionBlock | ContextBlock;
/** El estudio mientras se edita. Se valida con `validateStudy` antes de guardar. */
export type DraftStudy = Omit<Study, 'blocks'> & { blocks: DraftBlock[] };

/** Lo que se puede seleccionar en la lista de la izquierda. */
export type Selection = 'settings' | 'welcome' | 'thanks' | string;
export const FIXED_SELECTIONS: readonly string[] = ['settings', 'welcome', 'thanks'];

export function isDraftTask(block: DraftBlock): block is DraftTask {
  return isTaskBlock(block as Block);
}

export function emptyDraft(prototypeId: string): DraftStudy {
  return { v: 2, name: '', prototypeId, blocks: [] };
}

/** Quita `id` y fechas de un estudio guardado para editarlo. */
export function toDraft(record: Study & { id?: string; createdAt?: number; updatedAt?: number }): DraftStudy {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = record;
  void _id;
  void _c;
  void _u;
  return { ...rest, blocks: rest.blocks.map((b) => ({ ...b })) };
}

/** Un bloque nuevo de ese tipo, vacío y sin valores por defecto engañosos. */
export function newBlock(kind: BlockKind, taken: Iterable<string>): DraftBlock {
  const id = newBlockId(taken);
  switch (kind) {
    case 'task':
    case 'first-click':
      return { id, kind, title: '', instruction: '' };
    case 'scale':
      return { id, kind, question: '', max: 5 };
    case 'choice':
      return { id, kind, question: '', options: ['', ''] };
    case 'yesno':
      return { id, kind, question: '' };
    case 'text':
      return { id, kind, question: '' };
    case 'context':
      return { id, kind, title: '', text: '' };
  }
}

/** Copia de un bloque con id nuevo, para ponerla justo debajo. */
export function cloneBlock(block: DraftBlock, taken: Iterable<string>): DraftBlock {
  const copy = JSON.parse(JSON.stringify(block)) as DraftBlock;
  copy.id = newBlockId(taken);
  return copy;
}

/** Les da ids nuevos a todos los bloques (al traer un JSON a un estudio que ya existe). */
export function reassignIds(blocks: DraftBlock[], taken: Iterable<string>): DraftBlock[] {
  const used = new Set(taken);
  return blocks.map((b) => {
    const id = newBlockId(used);
    used.add(id);
    return { ...b, id };
  });
}

/** Mueve el elemento de `from` a `to`. Fuera de rango devuelve la misma lista. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}

/**
 * Cambia el tipo de regla. No inventa valores: una regla nueva empieza vacía y la validación
 * pide completarla.
 */
export function emptyRule(type: SuccessRule['type']): SuccessRule {
  switch (type) {
    case 'reached':
      return { type, path: '' };
    case 'tapped':
      return { type, selector: '' };
    case 'visible':
      return { type };
    case 'manual':
      return { type };
  }
}

/** Reglas que tienen sentido para cada tipo de tarea. */
export function rulesFor(kind: 'task' | 'first-click'): Array<SuccessRule['type']> {
  return kind === 'first-click' ? ['tapped', 'reached'] : ['reached', 'tapped', 'visible', 'manual'];
}

// ── Validación ───────────────────────────────────────────────────────────

export interface DraftCheck {
  ok: boolean;
  /** El estudio limpio, listo para guardar (solo si `ok`). */
  value: Study | null;
  errors: StudyIssue[];
  warnings: StudyIssue[];
}

export function checkDraft(draft: DraftStudy): DraftCheck {
  const result = validateStudy(draft);
  const errors = result.issues.filter((i) => i.level !== 'warn');
  const warnings = result.issues.filter((i) => i.level === 'warn');
  return { ok: result.ok, value: result.ok ? result.value : null, errors, warnings };
}

/** A qué elemento de la lista pertenece un problema, para saltar a él. */
export function issueSelection(issue: StudyIssue): Selection {
  if (issue.blockId) return issue.blockId;
  if (issue.field === 'welcome' || issue.field === 'consent') return 'welcome';
  if (issue.field === 'thanks') return 'thanks';
  return 'settings';
}

/** El primer error de un campo (de un bloque o del estudio), o undefined. */
export function fieldError(errors: readonly StudyIssue[], blockId: string | undefined, ...fields: string[]): string | undefined {
  return errors.find((i) => (i.blockId ?? undefined) === blockId && i.field !== undefined && fields.includes(i.field))?.message;
}

/**
 * El estudio que se manda al teléfono para probar. Con `blockId`, solo ese bloque (así se puede
 * probar una tarea aunque el resto del estudio esté a medias).
 */
export function tryoutStudy(draft: DraftStudy, blockId?: string): { study: Study | null; error?: string } {
  const blocks = blockId ? draft.blocks.filter((b) => b.id === blockId) : draft.blocks;
  const result = validateStudy({ ...draft, name: draft.name.trim() || 'Borrador', blocks });
  if (result.ok) return { study: result.value };
  return { study: null, error: result.error };
}

// ── Grabar el camino correcto ────────────────────────────────────────────

/** Un paso de la demostración: una pantalla que apareció o un toque. */
export type DemoStep =
  | { type: 'screen'; screen: string; title: string }
  | { type: 'tap'; screen: string; selector: string; text: string };

/** Añade una pantalla a la demostración, sin repetir la que ya está delante. */
export function pushScreen(steps: readonly DemoStep[], screen: string, title: string): DemoStep[] {
  let last: string | undefined;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s?.type === 'screen') {
      last = s.screen;
      break;
    }
  }
  if (last !== undefined && sameScreen(last, screen)) return [...steps];
  return [...steps, { type: 'screen', screen: screenId(screen), title }];
}

export interface DemoResult {
  /** Dónde empieza (URL de la primera pantalla; las pantallas virtuales no sirven de inicio). */
  startPath: string;
  /** Pantallas en orden, sin repetidas consecutivas. */
  expectedPath: string[];
  /** "Llega a la última pantalla". Falta si nunca cambió de pantalla. */
  reached?: SuccessRule;
  /** "Toca el último elemento". Solo si lo último fue un toque que no cambió de pantalla. */
  tapped?: { rule: SuccessRule; text: string };
  /** La regla que conviene por defecto. */
  suggested: 'reached' | 'tapped' | null;
}

/** Lo que se deduce de una demostración. `null` si todavía no hay nada que usar. */
export function demoResult(steps: readonly DemoStep[], kind: 'task' | 'first-click' = 'task'): DemoResult | null {
  const screens: string[] = [];
  for (const s of steps) {
    if (s.type !== 'screen') continue;
    const prev = screens[screens.length - 1];
    if (prev === undefined || !sameScreen(prev, s.screen)) screens.push(screenId(s.screen));
  }
  const first = screens[0];
  if (first === undefined) return null;
  const taps = steps.filter((s): s is Extract<DemoStep, { type: 'tap' }> => s.type === 'tap');

  if (kind === 'first-click') {
    // Solo cuenta el primer toque; la pantalla a la que lleva sirve como alternativa.
    const tap = taps[0];
    if (!tap) return null;
    const second = screens[1];
    const out: DemoResult = { startPath: screenUrl(first), expectedPath: [], suggested: 'tapped' };
    if (tap.selector) out.tapped = { rule: { type: 'tapped', selector: tap.selector }, text: tap.text };
    if (second !== undefined) out.reached = { type: 'reached', path: second };
    if (!out.tapped) out.suggested = out.reached ? 'reached' : null;
    return out.suggested ? out : null;
  }

  const out: DemoResult = { startPath: screenUrl(first), expectedPath: screens, suggested: null };
  const lastScreen = screens[screens.length - 1] as string;
  if (screens.length > 1) out.reached = { type: 'reached', path: lastScreen };
  const lastStep = steps[steps.length - 1];
  if (lastStep?.type === 'tap' && lastStep.selector) {
    out.tapped = { rule: { type: 'tapped', selector: lastStep.selector }, text: lastStep.text };
  }
  out.suggested = out.reached ? 'reached' : out.tapped ? 'tapped' : null;
  return out.suggested ? out : null;
}

// ── Camino esperado contra lo que hizo la gente ──────────────────────────

/**
 * Pantallas que visitó más de la mitad de quienes lograron la tarea y que el camino esperado no
 * tiene: con ellas fuera, nadie cuenta como "éxito directo".
 */
export function missedScreens(expectedPath: readonly string[] | undefined, rows: ReadonlyArray<Pick<TaskReportRow, 'outcome' | 'pages'>>): string[] {
  if (!expectedPath || expectedPath.length === 0) return [];
  const winners = rows.filter((r) => r.outcome === 'direct' || r.outcome === 'indirect');
  if (winners.length < 2) return [];
  const counts = new Map<string, number>();
  for (const row of winners) {
    for (const page of new Set(row.pages.map(screenId))) counts.set(page, (counts.get(page) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [page, count] of counts) {
    if (count * 2 > winners.length && !expectedPath.some((p) => sameScreen(p, page))) out.push(page);
  }
  return out;
}

/** El camino más común entre quienes lo lograron, o null. */
export function commonPath(paths: ReadonlyArray<{ pages: string[]; count: number; successes: number }>): string[] | null {
  const best = [...paths].filter((p) => p.successes > 0 && p.pages.length > 0).sort((a, b) => b.successes - a.successes || b.count - a.count)[0];
  return best ? best.pages.map(screenId) : null;
}

export function samePathList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((p, i) => sameScreen(p, y[i] as string));
}

// ── Importar ─────────────────────────────────────────────────────────────

export type ParsedStudy = { ok: true; study: Study; warnings: string[] } | { ok: false; messages: string[] };

/** Lee un study.json pegado o subido (v1 o v2). Tolera los ``` que suele poner una IA. */
export function parseStudyText(text: string): ParsedStudy {
  let body = text.trim();
  if (!body) return { ok: false, messages: ['Pega aquí el JSON del estudio.'] };
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(body);
  if (fenced?.[1]) body = fenced[1].trim();
  else {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start > 0 && end > start) body = body.slice(start, end + 1);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, messages: ['Esto no es un JSON válido. Copia la respuesta completa, desde la primera llave { hasta la última }.'] };
  }
  const result = validateStudy(raw);
  if (!result.ok) {
    const errors = result.issues.filter((i) => i.level !== 'warn').map((i) => i.message);
    return { ok: false, messages: errors.length ? errors : [result.error] };
  }
  return { ok: true, study: result.value, warnings: result.issues.map((i) => i.message) };
}

/** Nombre de archivo para exportar: "taptana-study-compra-en-verde.json". */
export function studyFileName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `taptana-study-${slug || 'estudio'}.json`;
}

/** Título corto de un bloque para la lista; vacío si aún no tiene. */
export function draftTitle(block: DraftBlock): string {
  if (isDraftTask(block)) return block.title || block.instruction || '';
  if (block.kind === 'context') return block.title || block.text || '';
  return block.question || '';
}

export { blockKind };
