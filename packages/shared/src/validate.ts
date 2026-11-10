/**
 * Validación de lo que llega de fuera: lotes de eventos (por la red) y archivos de estudio
 * (escritos por una persona o por una IA). Sin dependencias.
 *
 * Los mensajes de un estudio los lee un diseñador: van en español, dicen qué bloque y qué
 * falta, y traen `blockId` y `field` para pintarlos junto al campo.
 */

import type { EventBatch, SessionExport, SessionPatch } from './api.js';
import { OWN_EVENT_TYPES, type TaptanaEvent } from './events.js';
import { sameScreen, screenParts } from './screen.js';
import { SESSION_LIMITS, type DeviceInfo, type PageInfo, type SessionPage, type SessionSummary } from './session.js';
import {
  BLOCK_KINDS,
  SCALE_SIZES,
  STUDY_LIMITS,
  type Block,
  type BlockKind,
  type ChoiceBlock,
  type ContextBlock,
  type ManualPatch,
  type ManualResults,
  type ScaleBlock,
  type Study,
  type StudyRecord,
  type StudySettings,
  type StudyV1,
  type StudyVariant,
  type SuccessRule,
  type TaskBlock,
  type TaskResult,
  type TextBlock,
  type YesNoBlock,
} from './study.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// ── Lotes de eventos ───────────────────────────────────────────────────────────────

/** ¿Tiene la forma mínima de un evento (rrweb o propio)? No revisa el tipo ni sus campos. */
export function isTaptanaEvent(value: unknown): value is TaptanaEvent {
  if (!isRecord(value)) return false;
  if (!isFiniteNumber(value['t'])) return false;
  if (value['kind'] === 'rrweb') return 'data' in value;
  if (value['kind'] === 'taptana') return isNonEmptyString(value['type']);
  return false;
}

const isOneOf = (value: unknown, options: readonly string[]): boolean =>
  typeof value === 'string' && options.includes(value);

/** ¿Un evento propio trae los campos que los cálculos dan por hechos? */
function isUsableOwnEvent(e: Record<string, unknown>): boolean {
  switch (e['type']) {
    case 'tap': {
      const target = e['target'];
      return (
        isFiniteNumber(e['x']) &&
        isFiniteNumber(e['y']) &&
        isRecord(target) &&
        typeof target['tag'] === 'string' &&
        typeof target['selector'] === 'string'
      );
    }
    case 'swipe':
      return isOneOf(e['direction'], ['up', 'down', 'left', 'right']);
    case 'scroll':
      return isFiniteNumber(e['x']) && isFiniteNumber(e['y']);
    case 'viewport':
      return isFiniteNumber(e['width']) && isFiniteNumber(e['height']);
    case 'navigation':
      return typeof e['from'] === 'string' && typeof e['to'] === 'string';
    case 'task':
      return isNonEmptyString(e['taskId']) && isOneOf(e['action'], ['start', 'goal', 'done', 'skip']);
    case 'study':
      return isNonEmptyString(e['studyId']) && isOneOf(e['action'], ['start', 'finish']);
    case 'answer': {
      const v = e['value'];
      const ok =
        v === null ||
        typeof v === 'boolean' ||
        typeof v === 'string' ||
        isFiniteNumber(v) ||
        (Array.isArray(v) && v.every((x) => typeof x === 'string'));
      return isNonEmptyString(e['blockId']) && ok;
    }
    default:
      return false;
  }
}

/**
 * Deja solo los eventos que esta versión entiende: los de rrweb tal cual, y los propios de un
 * tipo conocido y con sus campos. Lo demás se descarta (un recorder más nuevo puede mandar
 * tipos que este servidor no conoce) y se cuenta en `dropped`.
 */
export function sanitizeEvents(events: readonly unknown[]): { events: TaptanaEvent[]; dropped: number } {
  const known: readonly string[] = OWN_EVENT_TYPES;
  const kept: TaptanaEvent[] = [];
  let dropped = 0;
  for (const e of events) {
    if (!isTaptanaEvent(e)) {
      dropped++;
      continue;
    }
    if (e.kind === 'rrweb' || (known.includes(e.type) && isUsableOwnEvent(e as unknown as Record<string, unknown>))) {
      kept.push(e);
    } else {
      dropped++;
    }
  }
  return { events: kept, dropped };
}

export type ValidationResult<T> =
  /** `dropped`: cuántos eventos se descartaron por tipo desconocido o campos rotos (ausente si ninguno). */
  | { ok: true; value: T; dropped?: number }
  | { ok: false; error: string };

/** ¿Tiene una barra o un carácter de control? (lo que no debe llegar a una ruta de archivo) */
function hasPathChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || value[i] === '/' || value[i] === '\\') return true;
  }
  return false;
}

/** Los ids se usan como claves y pueden acabar en rutas: cortos y sin separadores de carpeta. */
function idProblem(value: unknown): string | null {
  if (!isNonEmptyString(value)) return 'falta o no es un texto';
  if (value.length > 200) return 'es demasiado largo (máximo 200 caracteres)';
  if (hasPathChars(value) || value === '.' || value === '..') return 'tiene caracteres que no se permiten';
  return null;
}

function sizeProblem(value: unknown, name: string): string | null {
  if (!isRecord(value)) return `${name} tiene que ser un objeto { width, height }`;
  for (const key of ['width', 'height'] as const) {
    if (!isFiniteNumber(value[key])) return `${name}.${key} tiene que ser un número`;
  }
  return null;
}

function deviceProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'device tiene que ser un objeto';
  if (typeof value['userAgent'] !== 'string') return 'device.userAgent tiene que ser un texto';
  const size = sizeProblem(value['screen'], 'device.screen') ?? sizeProblem(value['viewport'], 'device.viewport');
  if (size) return size;
  if (!isFiniteNumber(value['dpr'])) return 'device.dpr tiene que ser un número';
  if (typeof value['touch'] !== 'boolean') return 'device.touch tiene que ser true o false';
  if (typeof value['language'] !== 'string') return 'device.language tiene que ser un texto';
  return null;
}

function pageProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'page tiene que ser un objeto';
  for (const key of ['path', 'title', 'referrer'] as const) {
    if (typeof value[key] !== 'string') return `page.${key} tiene que ser un texto`;
  }
  if (!isFiniteNumber(value['startedAt'])) return 'page.startedAt tiene que ser un número';
  return null;
}

/**
 * Valida un lote de eventos y devuelve una copia limpia: solo los campos del formato, y solo
 * los eventos que esta versión entiende (ver `sanitizeEvents`). Un lote mal formado no se
 * guarda: el servidor responde 400 con `error`.
 */
export function validateEventBatch(value: unknown): ValidationResult<EventBatch> {
  const fail = (error: string): ValidationResult<EventBatch> => ({ ok: false, error: `Lote inválido: ${error}` });
  if (!isRecord(value)) return fail('tiene que ser un objeto');
  if (value['v'] !== 1) return fail('versión de lote no soportada (se esperaba v: 1)');
  for (const key of ['prototypeId', 'sessionId', 'pageId'] as const) {
    const problem = idProblem(value[key]);
    if (problem) return fail(`${key} ${problem}`);
  }
  if (!isFiniteNumber(value['seq']) || value['seq'] < 0 || !Number.isInteger(value['seq'])) {
    return fail('seq tiene que ser un entero mayor o igual a 0');
  }
  if (!isFiniteNumber(value['sentAt'])) return fail('sentAt tiene que ser un número');
  const events = value['events'];
  if (!Array.isArray(events)) return fail('events tiene que ser una lista');
  for (let i = 0; i < events.length; i++) {
    if (!isTaptanaEvent(events[i])) return fail(`events[${i}] no tiene la forma de un evento (kind, t y type o data)`);
  }
  if (value['page'] !== undefined) {
    const problem = pageProblem(value['page']);
    if (problem) return fail(problem);
  }
  if (value['device'] !== undefined) {
    const problem = deviceProblem(value['device']);
    if (problem) return fail(problem);
  }

  const clean = sanitizeEvents(events);
  const batch: EventBatch = {
    v: 1,
    prototypeId: value['prototypeId'] as string,
    sessionId: value['sessionId'] as string,
    pageId: value['pageId'] as string,
    seq: value['seq'],
    sentAt: value['sentAt'],
    events: clean.events,
  };
  if (value['page'] !== undefined) {
    const p = value['page'] as unknown as PageInfo;
    batch.page = { path: p.path, title: p.title, referrer: p.referrer, startedAt: p.startedAt };
  }
  if (value['device'] !== undefined) {
    const d = value['device'] as unknown as DeviceInfo;
    batch.device = {
      userAgent: d.userAgent,
      screen: { width: d.screen.width, height: d.screen.height },
      viewport: { width: d.viewport.width, height: d.viewport.height },
      dpr: d.dpr,
      touch: d.touch,
      language: d.language,
    };
  }
  return clean.dropped > 0 ? { ok: true, value: batch, dropped: clean.dropped } : { ok: true, value: batch };
}

// ── Sesiones ───────────────────────────────────────────────────────────────────────

/**
 * Valida el cuerpo de `PATCH /sessions/:id` y lo devuelve limpio: solo los campos que vinieron,
 * los textos sin espacios sobrantes. Una etiqueta o unas notas vacías borran lo que había.
 */
export function validateSessionPatch(value: unknown): ValidationResult<SessionPatch> {
  if (!isRecord(value)) return { ok: false, error: 'El cambio de la sesión tiene que ser un objeto' };
  const patch: SessionPatch = {};
  for (const [key, what, max] of [
    ['label', 'La etiqueta', SESSION_LIMITS.label],
    ['notes', 'Las notas', SESSION_LIMITS.notes],
  ] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string') return { ok: false, error: `${what} ${key === 'label' ? 'tiene' : 'tienen'} que ser un texto` };
    const s = raw.trim();
    if (s.length > max) return { ok: false, error: `${what} no ${key === 'label' ? 'puede' : 'pueden'} pasar de ${max} caracteres` };
    patch[key] = s;
  }
  if (value['excluded'] !== undefined) {
    if (typeof value['excluded'] !== 'boolean') return { ok: false, error: '"excluded" tiene que ser true o false' };
    patch.excluded = value['excluded'];
  }
  if (value['manual'] !== undefined) {
    const raw = value['manual'];
    if (!isRecord(raw)) return { ok: false, error: 'Las marcas ("manual") tienen que ser un objeto { idDeTarea: "success" | "failure" | null }' };
    const manual: ManualPatch = {};
    for (const [taskId, mark] of Object.entries(raw)) {
      if (mark !== 'success' && mark !== 'failure' && mark !== null) {
        return { ok: false, error: `La marca de la tarea "${taskId}" tiene que ser "success", "failure" o null (para quitarla)` };
      }
      manual[taskId] = mark;
    }
    patch.manual = manual;
  }
  return { ok: true, value: patch };
}

const NOT_A_SESSION = 'Este archivo no es una sesión exportada de Taptana';

/**
 * Valida un archivo de sesión (el que exporta el recorder en modo local o descarga el panel)
 * antes de importarlo, y lo devuelve limpio: el resumen con sus campos y valores por defecto,
 * las páginas bien formadas, solo los eventos que esta versión entiende y el estudio ya en v2.
 * `tasks` se conserva para no perder las marcas del moderador (`manualMarks`); `answers` y
 * `screenCount` no, porque se recalculan con los eventos.
 */
export function validateSessionExport(value: unknown): ValidationResult<SessionExport> {
  if (!isRecord(value) || value['v'] !== 1 || !isRecord(value['session']) || !Array.isArray(value['events'])) {
    return { ok: false, error: NOT_A_SESSION };
  }
  const raw = value['session'];
  for (const key of ['id', 'prototypeId'] as const) {
    const problem = idProblem(raw[key]);
    if (problem) return { ok: false, error: `${NOT_A_SESSION}: session.${key} ${problem}` };
  }
  const { events, dropped } = sanitizeEvents(value['events']);
  events.sort((a, b) => a.t - b.t);
  const num = (v: unknown, fallback: number): number => (isFiniteNumber(v) ? v : fallback);
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const pages: SessionPage[] = (Array.isArray(value['pages']) ? value['pages'] : [])
    .filter((p): p is Record<string, unknown> => isRecord(p) && isNonEmptyString(p['id']))
    .map((p) => ({ id: p['id'] as string, path: str(p['path'], 2000), title: str(p['title'], 500), referrer: str(p['referrer'], 2000), startedAt: num(p['startedAt'], 0) }));

  const startedAt = num(raw['startedAt'], events[0]?.t ?? 0);
  const lastSeenAt = Math.max(startedAt, num(raw['lastSeenAt'], events[events.length - 1]?.t ?? startedAt));
  const viewport = isRecord(raw['viewport']) ? raw['viewport'] : {};
  const session: SessionSummary = {
    id: raw['id'] as string,
    prototypeId: raw['prototypeId'] as string,
    startedAt,
    lastSeenAt,
    durationMs: lastSeenAt - startedAt,
    deviceLabel: str(raw['deviceLabel'], 200) || 'Desconocido',
    viewport: { width: num(viewport['width'], 0), height: num(viewport['height'], 0) },
    touch: raw['touch'] === true,
    entryPath: str(raw['entryPath'], 2000),
    pageCount: num(raw['pageCount'], pages.length),
    tapCount: events.filter((e) => e.kind === 'taptana' && e.type === 'tap').length,
  };
  if (isNonEmptyString(raw['studyId']) && !idProblem(raw['studyId'])) session.studyId = raw['studyId'];
  if (isNonEmptyString(raw['variantId'])) session.variantId = raw['variantId'].slice(0, 200);
  const label = str(raw['label'], SESSION_LIMITS.label);
  const participant = str(raw['participant'], SESSION_LIMITS.participant);
  const notes = str(raw['notes'], SESSION_LIMITS.notes);
  if (label) session.label = label;
  if (participant) session.participant = participant;
  if (notes) session.notes = notes;
  if (raw['excluded'] === true) session.excluded = true;
  if (Array.isArray(raw['tasks'])) {
    session.tasks = raw['tasks'].filter((t): t is TaskResult => isRecord(t) && isNonEmptyString(t['taskId']));
  }

  const out: SessionExport = { v: 1, exportedAt: num(value['exportedAt'], 0), session, pages, events };
  const study = value['study'];
  if (isRecord(study) && isNonEmptyString(study['id']) && !idProblem(study['id'])) {
    out.study = normalizeStudy(study as unknown as StudyRecord);
  }
  return dropped > 0 ? { ok: true, value: out, dropped } : { ok: true, value: out };
}

// ── Estudios ───────────────────────────────────────────────────────────────────────

/** Un problema de un estudio, dicho para quien lo diseña. */
export interface StudyIssue {
  /** En español, listo para mostrar: "La tarea 2 no tiene instrucción". */
  message: string;
  /** Bloque al que se refiere, si aplica. */
  blockId?: string;
  /**
   * Campo al que se refiere, para pintar el error junto a él. Del estudio: `name`,
   * `prototypeId`, `description`, `welcome`, `consent`, `thanks`, `blocks`, `variants`,
   * `settings`, `closed`. De un bloque: `id`, `kind`, `title`, `instruction`, `startPath`,
   * `success`, `success.path`, `success.selector`, `expectedPath`, `question`, `description`,
   * `required`, `max`, `minLabel`, `maxLabel`, `options`, `multiple`, `placeholder`, `text`.
   */
  field?: string;
  /** 'error' impide guardar o importar; 'warn' es un aviso y no cambia `ok`. */
  level?: 'error' | 'warn';
}

export type StudyValidation =
  /** `value` es el estudio normalizado a v2. `issues` solo trae avisos. */
  | { ok: true; value: Study; issues: StudyIssue[] }
  /** `error` es el primer error (para quien solo muestra uno); `issues` los trae todos, más los avisos. */
  | { ok: false; error: string; issues: StudyIssue[] };

const TEXT_FIELDS = [
  ['description', 'La descripción'],
  ['welcome', 'La bienvenida'],
  ['consent', 'El texto de consentimiento'],
  ['thanks', 'El texto de despedida'],
] as const;

const KIND_LIST = 'context, task, first-click, scale, choice, yesno o text';

/** Cómo nombrar un bloque en una frase: "La tarea 2", "de la tarea 2", "a la tarea 2". */
function blockNames(kind: BlockKind | undefined, n: number): { el: string; del: string; al: string } {
  switch (kind) {
    case 'task':
      return { el: `La tarea ${n}`, del: `de la tarea ${n}`, al: `a la tarea ${n}` };
    case 'first-click':
      return { el: `El primer clic ${n}`, del: `del primer clic ${n}`, al: `al primer clic ${n}` };
    case 'scale':
    case 'choice':
    case 'yesno':
    case 'text':
      return { el: `La pregunta ${n}`, del: `de la pregunta ${n}`, al: `a la pregunta ${n}` };
    case 'context':
      return { el: `El contexto ${n}`, del: `del contexto ${n}`, al: `al contexto ${n}` };
    default:
      return { el: `El bloque ${n}`, del: `del bloque ${n}`, al: `al bloque ${n}` };
  }
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
/** "muy largo" o "muy larga", según el artículo con que empieza la frase. */
const tooLong = (what: string): string => (/^(el|un)\s/i.test(what) ? 'muy largo' : 'muy larga');

type Names = { el: string; del: string; al: string };

/**
 * Valida un archivo de estudio (lo que escribe una IA o una persona, o el borrador del
 * constructor). Acepta v1 (`tasks`) y v2 (`blocks`) y, si está bien, devuelve siempre un
 * `Study` v2 limpio: solo los campos del formato y los textos sin espacios sobrantes.
 *
 * Los números de los mensajes ("La tarea 2") son la posición del bloque en la lista.
 */
export function validateStudy(value: unknown): StudyValidation {
  const issues: StudyIssue[] = [];
  const report = (level: 'error' | 'warn', message: string, blockId?: string, field?: string): void => {
    const issue: StudyIssue = { message, level };
    if (blockId) issue.blockId = blockId;
    if (field) issue.field = field;
    issues.push(issue);
  };
  const error = (message: string, blockId?: string, field?: string): void => report('error', message, blockId, field);
  const warn = (message: string, blockId?: string, field?: string): void => report('warn', message, blockId, field);
  const finish = (study?: Study): StudyValidation => {
    const first = issues.find((i) => i.level === 'error');
    if (first || !study) return { ok: false, error: first?.message ?? 'El estudio no es válido', issues };
    return { ok: true, value: study, issues };
  };

  /**
   * Lee un texto: revisa el tipo y el largo y lo devuelve sin espacios sobrantes ('' si falta).
   * `what` es cómo nombrarlo ("la instrucción de la tarea 2"). Con `missing`, es obligatorio y
   * ese es el mensaje cuando falta.
   */
  const text = (raw: unknown, what: string, max: number, blockId: string | undefined, field: string, missing?: string): string => {
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      error(`${capital(what)} tiene que ser un texto`, blockId, field);
      return '';
    }
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s && missing) error(missing, blockId, field);
    if (s.length > max) error(`${capital(what)} es ${tooLong(what)} (máximo ${max} caracteres, tiene ${s.length})`, blockId, field);
    return s;
  };
  const bool = (raw: unknown, what: string, blockId: string | undefined, field: string): boolean | undefined => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'boolean') {
      error(`${what} tiene que ser true o false`, blockId, field);
      return undefined;
    }
    return raw;
  };

  /** Revisa la regla de éxito de una tarea y la devuelve limpia. */
  const successRule = (raw: unknown, kind: 'task' | 'first-click', names: Names, bid: string | undefined): SuccessRule | undefined => {
    const type = isRecord(raw) ? raw['type'] : undefined;
    if (!isRecord(raw) || type === undefined || type === null || type === '') {
      error(`Elige cómo se sabe que ${lower(names.el)} se logró`, bid, 'success');
      return undefined;
    }
    const onlyTapOrReach = `${names.el} solo se puede medir con «toca un elemento» o «llega a una pantalla»`;
    if (type === 'manual') {
      if (kind === 'first-click') error(onlyTapOrReach, bid, 'success');
      return { type: 'manual' };
    }
    if (type === 'reached') {
      const path = typeof raw['path'] === 'string' ? raw['path'].trim() : '';
      if (!path) error(`${names.el} no dice a qué pantalla hay que llegar`, bid, 'success.path');
      return { type: 'reached', path };
    }
    if (type === 'tapped') {
      const selector = typeof raw['selector'] === 'string' ? raw['selector'].trim() : '';
      if (!selector) error(`${names.el} no dice qué elemento hay que tocar`, bid, 'success.selector');
      return { type: 'tapped', selector };
    }
    if (type === 'visible') {
      const selector = typeof raw['selector'] === 'string' ? raw['selector'].trim() : '';
      const shown = typeof raw['text'] === 'string' ? raw['text'].trim() : '';
      if (kind === 'first-click') error(onlyTapOrReach, bid, 'success');
      else if (!selector && !shown) error(`${names.el} no dice qué texto o elemento tiene que aparecer`, bid, 'success');
      const rule: SuccessRule = { type: 'visible' };
      if (selector) rule.selector = selector;
      if (shown) rule.text = shown;
      return rule;
    }
    error(`${names.el} tiene una regla que no existe (${JSON.stringify(type)}). Usa "reached", "tapped", "visible" o "manual".`, bid, 'success');
    return undefined;
  };

  if (!isRecord(value)) {
    error('El estudio tiene que ser un objeto JSON, así: { "v": 2, "name": "…", "prototypeId": "…", "blocks": [ … ] }');
    return finish();
  }

  const version = value['v'];
  if (version !== undefined && version !== 1 && version !== 2) {
    error(`Este archivo dice ser la versión ${JSON.stringify(version)} del formato de estudio y Taptana solo entiende la 1 y la 2. Pon "v": 2.`);
    return finish();
  }

  // ── Datos del estudio ──
  const name = text(value['name'], 'el nombre del estudio', STUDY_LIMITS.name, undefined, 'name', 'Ponle un nombre al estudio');
  const prototypeId = typeof value['prototypeId'] === 'string' ? value['prototypeId'].trim() : '';
  if (!prototypeId) error('Elige el prototipo que vas a probar', undefined, 'prototypeId');

  const study: Study = { v: 2, name, prototypeId, blocks: [] };
  for (const [key, what] of TEXT_FIELDS) {
    const s = text(value[key], lower(what), STUDY_LIMITS.text, undefined, key);
    if (s) study[key] = s;
  }

  // ── Bloques ──
  const rawBlocks = Array.isArray(value['blocks']) ? value['blocks'] : value['blocks'] === undefined ? value['tasks'] : value['blocks'];
  if (rawBlocks !== undefined && rawBlocks !== null && !Array.isArray(rawBlocks)) {
    error('Los bloques del estudio ("blocks") tienen que ser una lista', undefined, 'blocks');
  } else if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
    error('Agrega al menos un bloque: una tarea o una pregunta', undefined, 'blocks');
  } else if (rawBlocks.length > STUDY_LIMITS.maxBlocks) {
    error(`Un estudio puede tener hasta ${STUDY_LIMITS.maxBlocks} bloques (este tiene ${rawBlocks.length})`, undefined, 'blocks');
  }

  const seenIds = new Map<string, number>();
  const list: unknown[] = Array.isArray(rawBlocks) ? rawBlocks.slice(0, STUDY_LIMITS.maxBlocks) : [];
  list.forEach((raw, index) => {
    const n = index + 1;
    if (!isRecord(raw)) {
      error(`El bloque ${n} tiene que ser un objeto con "id", "kind" y sus campos`, undefined, 'blocks');
      return;
    }
    const rawKind = raw['kind'];
    const kindKnown = rawKind === undefined || (typeof rawKind === 'string' && (BLOCK_KINDS as readonly string[]).includes(rawKind));
    const kind: BlockKind | undefined = kindKnown ? ((rawKind as BlockKind | undefined) ?? 'task') : undefined;
    const names = blockNames(kind, n);

    let id = '';
    if (typeof raw['id'] !== 'string' || !raw['id'].trim()) {
      error(`${capital(names.al)} le falta el "id" (un texto corto y único, por ejemplo "b${n}")`, undefined, 'id');
    } else {
      id = raw['id'].trim();
      if (!/^[A-Za-z0-9_-]+$/.test(id) || id.length > STUDY_LIMITS.id) {
        error(`El id ${names.del} ("${id.slice(0, 40)}") solo puede llevar letras, números, guiones y guion bajo, hasta ${STUDY_LIMITS.id} caracteres`, id, 'id');
      }
      const before = seenIds.get(id);
      if (before !== undefined) {
        error(`El id "${id}" está repetido en los bloques ${before} y ${n}. Cada bloque necesita un id distinto.`, id, 'id');
      } else {
        seenIds.set(id, n);
      }
    }
    const bid = id || undefined;

    if (!kind) {
      error(`El bloque ${n} tiene un tipo que no existe (${JSON.stringify(rawKind)}). Usa ${KIND_LIST}.`, bid, 'kind');
      return;
    }

    if (kind === 'context') {
      const title = text(raw['title'], `el título ${names.del}`, STUDY_LIMITS.name, bid, 'title');
      const body = text(raw['text'], `el texto ${names.del}`, STUDY_LIMITS.text, bid, 'text');
      if (!title && !body) error(`${names.el} está vacío: ponle un título o un texto`, bid, 'title');
      const block: ContextBlock = { id, kind, title, text: body };
      study.blocks.push(block);
      return;
    }

    if (kind === 'task' || kind === 'first-click') {
      const title = text(raw['title'], `el título ${names.del}`, STUDY_LIMITS.name, bid, 'title', `${names.el} no tiene título`);
      const instruction = text(raw['instruction'], `la instrucción ${names.del}`, STUDY_LIMITS.instruction, bid, 'instruction', `${names.el} no tiene instrucción`);
      const success = successRule(raw['success'], kind, names, bid);
      const block: TaskBlock = { id, title, instruction, success: success ?? { type: 'manual' } };
      if (rawKind !== undefined) block.kind = kind;

      const startPath = text(raw['startPath'], `la pantalla de inicio ${names.del}`, 500, bid, 'startPath');
      if (startPath) {
        if (screenParts(startPath).virtual) {
          error(`La pantalla de inicio ${names.del} ("${startPath}") comparte dirección con otras pantallas y no se puede abrir directamente. Elige una pantalla con dirección propia.`, bid, 'startPath');
        }
        block.startPath = startPath;
      }

      const rawPath = raw['expectedPath'];
      if (rawPath !== undefined && rawPath !== null) {
        if (!Array.isArray(rawPath) || !rawPath.every((p) => typeof p === 'string' && p.trim() !== '')) {
          error(`El camino esperado ${names.del} tiene que ser una lista de pantallas, por ejemplo ["/index.html", "/producto.html"]`, bid, 'expectedPath');
        } else if (rawPath.length > 0) {
          const path = (rawPath as string[]).map((p) => p.trim());
          block.expectedPath = path;
          const first = path[0] as string;
          const last = path[path.length - 1] as string;
          if (kind === 'task' && startPath && !sameScreen(first, startPath)) {
            warn(`El camino esperado ${names.del} no empieza en su pantalla de inicio ("${startPath}"): nadie podría seguirlo exacto.`, bid, 'expectedPath');
          }
          if (kind === 'task' && success?.type === 'reached' && success.path && !sameScreen(last, success.path)) {
            warn(`El camino esperado ${names.del} no termina en la pantalla a la que hay que llegar ("${success.path}"): nadie podría seguirlo exacto.`, bid, 'expectedPath');
          }
        }
      }

      if (success?.type === 'reached' && success.path && startPath && sameScreen(startPath, success.path)) {
        warn(`${names.el} empieza en la misma pantalla a la que hay que llegar: se cumpliría sola al empezar.`, bid, 'success.path');
      }
      if (success?.type === 'tapped' && /^[a-z][a-z0-9-]*$/i.test(success.selector)) {
        warn(`${names.el} se cumple al tocar cualquier elemento «${success.selector}». Usa un selector más preciso (un id o una clase) para que no se cumpla por accidente.`, bid, 'success.selector');
      }
      study.blocks.push(block);
      return;
    }

    // Preguntas
    const question = text(raw['question'], `el texto ${names.del}`, STUDY_LIMITS.question, bid, 'question', `${names.el} no tiene texto`);
    const description = text(raw['description'], `la aclaración ${names.del}`, STUDY_LIMITS.instruction, bid, 'description');
    const required = bool(raw['required'], `"required" ${names.del}`, bid, 'required');
    const base: { id: string; question: string; description?: string; required?: boolean } = { id, question };
    if (description) base.description = description;
    if (required !== undefined) base.required = required;

    if (kind === 'scale') {
      const rawMax = raw['max'] ?? 5;
      const valid = (SCALE_SIZES as readonly unknown[]).includes(rawMax);
      if (!valid) error(`La escala ${names.del} tiene que ser de 5, 7 o 10 puntos (dice ${JSON.stringify(rawMax)})`, bid, 'max');
      const block: ScaleBlock = { ...base, kind, max: valid ? (rawMax as 5 | 7 | 10) : 5 };
      const minLabel = text(raw['minLabel'], `la etiqueta del mínimo ${names.del}`, STUDY_LIMITS.label, bid, 'minLabel');
      const maxLabel = text(raw['maxLabel'], `la etiqueta del máximo ${names.del}`, STUDY_LIMITS.label, bid, 'maxLabel');
      if (minLabel) block.minLabel = minLabel;
      if (maxLabel) block.maxLabel = maxLabel;
      study.blocks.push(block);
    } else if (kind === 'choice') {
      const options: string[] = [];
      const rawOptions = raw['options'];
      if (!Array.isArray(rawOptions) || rawOptions.length < STUDY_LIMITS.minOptions || rawOptions.length > STUDY_LIMITS.maxOptions) {
        const have = Array.isArray(rawOptions) ? ` (tiene ${rawOptions.length})` : '';
        error(`${names.el} necesita entre ${STUDY_LIMITS.minOptions} y ${STUDY_LIMITS.maxOptions} opciones${have}`, bid, 'options');
      } else {
        rawOptions.forEach((opt: unknown, i) => {
          const s = typeof opt === 'string' ? opt.trim() : '';
          if (!s) error(`La opción ${i + 1} ${names.del} está vacía`, bid, 'options');
          else if (s.length > STUDY_LIMITS.option) error(`La opción ${i + 1} ${names.del} es muy larga (máximo ${STUDY_LIMITS.option} caracteres)`, bid, 'options');
          else if (options.includes(s)) error(`La opción "${s}" ${names.del} está repetida`, bid, 'options');
          options.push(s);
        });
      }
      const block: ChoiceBlock = { ...base, kind, options };
      const multiple = bool(raw['multiple'], `"multiple" ${names.del}`, bid, 'multiple');
      if (multiple !== undefined) block.multiple = multiple;
      study.blocks.push(block);
    } else if (kind === 'yesno') {
      const block: YesNoBlock = { ...base, kind };
      study.blocks.push(block);
    } else {
      const block: TextBlock = { ...base, kind };
      const placeholder = text(raw['placeholder'], `el texto de ayuda ${names.del}`, STUDY_LIMITS.label, bid, 'placeholder');
      if (placeholder) block.placeholder = placeholder;
      study.blocks.push(block);
    }
  });

  if (study.blocks.length > 0 && study.blocks.every((b) => b.kind === 'context')) {
    warn('El estudio solo tiene bloques de contexto: agrega una tarea o una pregunta para medir algo', undefined, 'blocks');
  }

  // ── Variantes ──
  const rawVariants = value['variants'];
  if (rawVariants !== undefined && rawVariants !== null) {
    if (!Array.isArray(rawVariants)) {
      error('Las variantes ("variants") tienen que ser una lista', undefined, 'variants');
    } else {
      const variants: StudyVariant[] = [];
      const ids = new Set<string>();
      rawVariants.forEach((raw: unknown, i) => {
        const n = i + 1;
        if (!isRecord(raw)) {
          error(`La variante ${n} tiene que ser un objeto con "id" y "name"`, undefined, 'variants');
          return;
        }
        const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
        const vname = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
        if (!id) error(`A la variante ${n} le falta el "id"`, undefined, 'variants');
        else if (id.length > STUDY_LIMITS.id) error(`El id de la variante ${n} es muy largo (máximo ${STUDY_LIMITS.id} caracteres)`, undefined, 'variants');
        else if (ids.has(id)) error(`El id de variante "${id}" está repetido`, undefined, 'variants');
        ids.add(id);
        if (!vname) error(`A la variante ${n} le falta el nombre`, undefined, 'variants');
        else if (vname.length > STUDY_LIMITS.name) error(`El nombre de la variante ${n} es muy largo (máximo ${STUDY_LIMITS.name} caracteres)`, undefined, 'variants');
        const variant: StudyVariant = { id, name: vname };
        for (const key of ['startPath', 'prototypeId'] as const) {
          const v = raw[key];
          if (v === undefined || v === null || v === '') continue;
          if (typeof v !== 'string') error(`"${key}" de la variante ${n} tiene que ser un texto`, undefined, 'variants');
          else variant[key] = v.trim();
        }
        variants.push(variant);
      });
      if (variants.length > 0) study.variants = variants;
    }
  }

  // ── Ajustes ──
  const rawSettings = value['settings'];
  if (rawSettings !== undefined && rawSettings !== null) {
    if (!isRecord(rawSettings)) {
      error('Los ajustes ("settings") tienen que ser un objeto', undefined, 'settings');
    } else {
      const settings: StudySettings = {};
      const advance = rawSettings['advance'];
      if (advance === 'auto' || advance === 'manual') {
        settings.advance = advance;
      } else if (advance !== undefined && advance !== null) {
        error('"settings.advance" tiene que ser "auto" (la tarea termina sola al cumplirse) o "manual" (espera a que toquen "Listo")', undefined, 'settings');
      }
      const askName = bool(rawSettings['askName'], '"settings.askName"', undefined, 'settings');
      if (askName !== undefined) settings.askName = askName;
      if (Object.keys(settings).length > 0) study.settings = settings;
    }
  }

  const closed = bool(value['closed'], '"closed"', undefined, 'closed');
  if (closed !== undefined) study.closed = closed;

  return finish(study);
}

type StoredStudy = Study | StudyV1;
type RecordFields = { id: string; createdAt: number; updatedAt: number };

/**
 * Lleva a v2 un estudio ya guardado (base de datos, IndexedDB, semillas, una sesión
 * exportada): `tasks` pasa a `blocks` y se conservan `id`, `createdAt` y `updatedAt` si
 * vienen. No valida ni rechaza: lo guardado se respeta tal cual. No modifica el original y
 * aplicarla dos veces da lo mismo.
 */
export function normalizeStudy(stored: StoredStudy & RecordFields): StudyRecord;
export function normalizeStudy(stored: StoredStudy): Study;
export function normalizeStudy(stored: StoredStudy | (StoredStudy & RecordFields)): Study | StudyRecord {
  const raw = (isRecord(stored) ? stored : {}) as Record<string, unknown>;
  const rawBlocks = Array.isArray(raw['blocks']) ? raw['blocks'] : Array.isArray(raw['tasks']) ? raw['tasks'] : [];
  const study: Study & Partial<RecordFields> = {
    v: 2,
    name: typeof raw['name'] === 'string' ? raw['name'] : '',
    prototypeId: typeof raw['prototypeId'] === 'string' ? raw['prototypeId'] : '',
    blocks: (rawBlocks as unknown[]).filter((b): b is Block => isRecord(b) && typeof b['id'] === 'string'),
  };
  for (const key of ['description', 'welcome', 'consent', 'thanks'] as const) {
    const v = raw[key];
    if (typeof v === 'string' && v !== '') study[key] = v;
  }
  if (Array.isArray(raw['variants']) && raw['variants'].length > 0) study.variants = raw['variants'] as StudyVariant[];
  if (isRecord(raw['settings'])) study.settings = raw['settings'] as StudySettings;
  if (typeof raw['closed'] === 'boolean') study.closed = raw['closed'];
  if (typeof raw['id'] === 'string') study.id = raw['id'];
  if (isFiniteNumber(raw['createdAt'])) study.createdAt = raw['createdAt'];
  if (isFiniteNumber(raw['updatedAt'])) study.updatedAt = raw['updatedAt'];
  return study as Study | StudyRecord;
}
