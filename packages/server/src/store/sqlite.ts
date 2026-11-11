/**
 * Store con node:sqlite (DatabaseSync). Sin dependencias nativas que compilar.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  computeAnswers,
  computeTaskResults,
  countScreens,
  deviceLabel,
  duplicateStudy,
  knownScreens,
  manualMarks,
  applyManualPatch,
  normalizeStudy,
  participantName,
  SESSION_LIMITS,
  type AnswerResult,
  type EventBatch,
  type ManualResults,
  type Prototype,
  type ReportSession,
  type ScreenInfo,
  type SessionEventsResponse,
  type SessionExport,
  type SessionPage,
  type SessionPatch,
  type SessionSummary,
  type Study,
  type StudyRecord,
  type TaptanaEvent,
  type TaskResult,
} from '@taptana/shared';
import { COLUMNS, eventsTable, INDEXES, pagesTable, TABLES } from './schema.js';
import type { ListSessionsFilter, Store } from './store.js';

/** Nombre del prototipo que se crea al importar una sesión de un prototipo que aquí no existe. */
export const IMPORTED_PROTOTYPE_NAME = 'Importado';

interface SessionRow {
  id: string;
  prototype_id: string;
  started_at: number;
  last_seen_at: number;
  user_agent: string | null;
  device_label: string | null;
  viewport_w: number | null;
  viewport_h: number | null;
  touch: number | null;
  entry_path: string | null;
  study_id: string | null;
  variant_id: string | null;
  manual_results: string | null;
  label: string | null;
  participant: string | null;
  notes: string | null;
  excluded: number | null;
  page_count: number;
  tap_count: number;
}

interface PrototypeRow {
  id: string;
  name: string;
  created_at: number;
  source: string | null;
  entry_path: string | null;
  root: number | null;
  absolute_urls: number | null;
  source_url: string | null;
  session_count: number;
}

interface StudyRow {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
}

/** Lo que se calcula de los eventos de una sesión. Es lo que guarda la caché. */
interface Derived {
  screenCount: number;
  tasks?: TaskResult[];
  answers?: AnswerResult[];
}

const SESSION_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM pages p WHERE p.session_id = s.id) AS page_count,
    (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type = 'tap') AS tap_count
  FROM sessions s
`;

const PROTOTYPE_SELECT = `
  SELECT p.*, (SELECT COUNT(*) FROM sessions s WHERE s.prototype_id = p.id) AS session_count
  FROM prototypes p
`;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function createId(prefix: string, length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

function rowToPrototype(row: PrototypeRow): Prototype {
  const p: Prototype = { id: row.id, name: row.name, createdAt: row.created_at, sessionCount: Number(row.session_count) };
  // 'import' (sin archivos) queda sin `source`: no es ni la carpeta local ni un archivo subido.
  if (row.source === 'upload' || row.source === 'folder' || row.source === 'url') p.source = row.source;
  if (row.source === 'url' && row.source_url) p.sourceUrl = row.source_url;
  if (row.entry_path) p.entryPath = row.entry_path;
  if (row.root === 1) p.root = true;
  if (row.absolute_urls === 1) p.absoluteUrls = true;
  return p;
}

function rowToSummary(row: SessionRow): SessionSummary {
  const s: SessionSummary = {
    id: row.id,
    prototypeId: row.prototype_id,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    durationMs: Math.max(0, row.last_seen_at - row.started_at),
    deviceLabel: row.device_label ?? 'Desconocido',
    viewport: { width: row.viewport_w ?? 0, height: row.viewport_h ?? 0 },
    touch: row.touch === 1,
    entryPath: row.entry_path ?? '',
    pageCount: Number(row.page_count),
    tapCount: Number(row.tap_count),
  };
  if (row.study_id) s.studyId = row.study_id;
  if (row.variant_id) s.variantId = row.variant_id;
  if (row.label) s.label = row.label;
  if (row.participant) s.participant = row.participant;
  if (row.notes) s.notes = row.notes;
  if (row.excluded === 1) s.excluded = true;
  return s;
}

function parseManual(raw: string | null): ManualResults {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as ManualResults) : {};
  } catch {
    return {};
  }
}

/** Lo guardado puede ser v1 (`tasks`) o v2 (`blocks`): siempre sale v2. */
function rowToStudy(row: StudyRow): StudyRecord {
  let data: unknown;
  try {
    data = JSON.parse(row.data);
  } catch {
    data = {};
  }
  return normalizeStudy({ ...(data as Study), id: row.id, createdAt: row.created_at, updatedAt: row.updated_at });
}

function parseEvent(data: string): TaptanaEvent | null {
  try {
    return JSON.parse(data) as TaptanaEvent;
  } catch {
    return null;
  }
}

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  /**
   * Resultados por sesión (tareas, respuestas, pantallas), para no recalcularlos en cada
   * listado. Se invalida al cambiar la sesión (lote nuevo, marca, importación, borrado) o
   * cualquier estudio, y entera si otro proceso escribió en la base (`taptana seed`).
   */
  private readonly derived = new Map<string, Derived>();
  private dataVersion = -1;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  /** Crea lo que falte y actualiza bases de versiones anteriores. Los índices van al final. */
  private migrate(): void {
    this.db.exec(TABLES);
    for (const [table, column, definition] of COLUMNS) {
      if (!this.columnsOf(table).some((c) => c.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
    // Antes el id de página era único en toda la base y dos sesiones podían chocar.
    const pageKey = this.columnsOf('pages').filter((c) => c.pk > 0).map((c) => c.name);
    if (!pageKey.includes('session_id')) this.rebuildPagesAndEvents();
    this.db.exec(INDEXES);
  }

  private columnsOf(table: string): Array<{ name: string; pk: number }> {
    return this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string; pk: number }>;
  }

  /**
   * SQLite no deja cambiar una clave primaria: se crean las tablas nuevas, se copian los datos
   * y se reemplazan las viejas (el procedimiento que recomienda su documentación).
   */
  private rebuildPagesAndEvents(): void {
    this.db.exec('PRAGMA foreign_keys = OFF;');
    this.db.exec('BEGIN');
    try {
      this.db.exec(`
        DROP TABLE IF EXISTS pages_new;
        DROP TABLE IF EXISTS events_new;
        ${pagesTable('pages_new')}
        INSERT INTO pages_new (id, session_id, path, title, referrer, started_at)
          SELECT id, session_id, path, title, referrer, started_at FROM pages;
        DROP TABLE pages;
        ALTER TABLE pages_new RENAME TO pages;
        ${eventsTable('events_new')}
        INSERT INTO events_new (id, session_id, page_id, t, kind, type, data)
          SELECT id, session_id, page_id, t, kind, type, data FROM events;
        DROP TABLE events;
        ALTER TABLE events_new RENAME TO events;
      `);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON;');
    }
  }

  /** Sentencia preparada, reutilizada entre llamadas. */
  private q(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ── Prototipos ───────────────────────────────────────────────────────

  ensurePrototype(prototype: Prototype): void {
    this.q('INSERT OR IGNORE INTO prototypes (id, name, created_at) VALUES (?, ?, ?)').run(prototype.id, prototype.name, prototype.createdAt);
  }

  savePrototype(p: Prototype): Prototype {
    const existing = this.getPrototype(p.id);
    const absoluteUrls = p.absoluteUrls ?? existing?.absoluteUrls ?? false;
    this.q(
      `INSERT INTO prototypes (id, name, created_at, source, entry_path, absolute_urls, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, source = excluded.source,
         entry_path = excluded.entry_path, absolute_urls = excluded.absolute_urls, source_url = excluded.source_url`,
    ).run(p.id, p.name, p.createdAt, p.source ?? 'import', p.entryPath ?? null, absoluteUrls ? 1 : 0, p.source === 'url' ? (p.sourceUrl ?? null) : null);
    return this.getPrototype(p.id)!;
  }

  listPrototypes(): Prototype[] {
    const rows = this.q(`${PROTOTYPE_SELECT} ORDER BY p.created_at DESC`).all() as unknown as PrototypeRow[];
    return rows.map(rowToPrototype);
  }

  getPrototype(id: string): Prototype | null {
    const row = this.q(`${PROTOTYPE_SELECT} WHERE p.id = ?`).get(id) as unknown as PrototypeRow | undefined;
    return row ? rowToPrototype(row) : null;
  }

  setRootPrototype(id: string | null): void {
    this.q('UPDATE prototypes SET root = CASE WHEN id = ? THEN 1 ELSE 0 END').run(id);
  }

  getRootPrototype(): Prototype | null {
    const row = this.q(`${PROTOTYPE_SELECT} WHERE p.root = 1 AND p.source IN ('upload', 'url') LIMIT 1`).get() as unknown as PrototypeRow | undefined;
    return row ? rowToPrototype(row) : null;
  }

  deletePrototype(id: string): boolean {
    const deleted = this.transaction(() => {
      this.q('DELETE FROM sessions WHERE prototype_id = ?').run(id);
      this.q('DELETE FROM studies WHERE prototype_id = ?').run(id);
      return Number(this.q('DELETE FROM prototypes WHERE id = ?').run(id).changes) > 0;
    });
    this.derived.clear();
    return deleted;
  }

  // ── Eventos ──────────────────────────────────────────────────────────

  ingestBatch(batch: EventBatch): { received: number } {
    // Un lote repetido (reintento cuya primera copia sí llegó) no se guarda dos veces. Si la
    // copia trae más eventos que la primera (así reintentaba el recorder anterior a v1: lo que
    // falló más lo nuevo, con el mismo `seq`), solo se guardan los que faltaban.
    const known = this.q('SELECT events FROM batches WHERE session_id = ? AND page_id = ? AND seq = ?').get(batch.sessionId, batch.pageId, batch.seq) as
      | { events: number }
      | undefined;
    if (known && batch.events.length <= known.events) return { received: 0 };
    const events = known ? batch.events.slice(known.events) : batch.events;

    let minT = batch.sentAt;
    let maxT = batch.sentAt;
    if (events.length > 0) {
      minT = Infinity;
      maxT = -Infinity;
      for (const e of events) {
        if (e.t < minT) minT = e.t;
        if (e.t > maxT) maxT = e.t;
      }
    }

    this.transaction(() => {
      const d = batch.device;
      const page = batch.page;
      const existing = this.q('SELECT user_agent FROM sessions WHERE id = ?').get(batch.sessionId) as { user_agent: string | null } | undefined;

      if (!existing) {
        this.ensurePrototype({ id: batch.prototypeId, name: batch.prototypeId, createdAt: minT });
        this.q(
          `INSERT INTO sessions (id, prototype_id, started_at, last_seen_at, user_agent, device_label,
             screen_w, screen_h, viewport_w, viewport_h, dpr, touch, language, entry_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          batch.sessionId,
          batch.prototypeId,
          minT,
          maxT,
          d?.userAgent ?? null,
          d ? deviceLabel(d.userAgent) : null,
          d?.screen.width ?? null,
          d?.screen.height ?? null,
          d?.viewport.width ?? null,
          d?.viewport.height ?? null,
          d?.dpr ?? null,
          d ? (d.touch ? 1 : 0) : null,
          d?.language ?? null,
          page?.path ?? null,
        );
      } else {
        // La entrada es la página más antigua: vale la de este lote si aún no hay, o si es anterior.
        if (page) {
          this.q('UPDATE sessions SET entry_path = ? WHERE id = ? AND (entry_path IS NULL OR ? < started_at)').run(page.path, batch.sessionId, minT);
        }
        this.q('UPDATE sessions SET started_at = MIN(started_at, ?), last_seen_at = MAX(last_seen_at, ?) WHERE id = ?').run(minT, maxT, batch.sessionId);
        if (!existing.user_agent && d) {
          this.q(
            `UPDATE sessions SET user_agent = ?, device_label = ?, screen_w = ?, screen_h = ?,
               viewport_w = ?, viewport_h = ?, dpr = ?, touch = ?, language = ? WHERE id = ?`,
          ).run(d.userAgent, deviceLabel(d.userAgent), d.screen.width, d.screen.height, d.viewport.width, d.viewport.height, d.dpr, d.touch ? 1 : 0, d.language, batch.sessionId);
        }
      }

      // Si el lote trae el inicio de un estudio, la sesión queda ligada a él (y a su alias).
      for (const ev of events) {
        if (ev.kind === 'taptana' && ev.type === 'study' && ev.action === 'start') {
          const alias = typeof ev.participant === 'string' ? ev.participant.trim().slice(0, SESSION_LIMITS.participant) : '';
          this.q('UPDATE sessions SET study_id = ?, variant_id = COALESCE(?, variant_id), participant = COALESCE(?, participant) WHERE id = ?').run(
            ev.studyId,
            ev.variantId ?? null,
            alias || null,
            batch.sessionId,
          );
        }
      }

      // Los datos de la página vienen solo en su primer lote; los demás no deben borrarlos.
      if (page) {
        this.q(
          `INSERT INTO pages (id, session_id, path, title, referrer, started_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id, id) DO UPDATE SET path = excluded.path, title = excluded.title,
             referrer = excluded.referrer, started_at = excluded.started_at`,
        ).run(batch.pageId, batch.sessionId, page.path, page.title, page.referrer, page.startedAt);
      } else {
        this.q("INSERT OR IGNORE INTO pages (id, session_id, path, started_at) VALUES (?, ?, '', ?)").run(batch.pageId, batch.sessionId, minT);
      }

      const insert = this.q('INSERT INTO events (session_id, page_id, t, kind, type, data) VALUES (?, ?, ?, ?, ?, ?)');
      for (const ev of events) {
        insert.run(batch.sessionId, batch.pageId, ev.t, ev.kind, ev.kind === 'taptana' ? ev.type : null, JSON.stringify(ev));
      }
      this.q(
        `INSERT INTO batches (session_id, page_id, seq, events) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, page_id, seq) DO UPDATE SET events = excluded.events`,
      ).run(batch.sessionId, batch.pageId, batch.seq, batch.events.length);
    });
    this.derived.delete(batch.sessionId);
    return { received: events.length };
  }

  // ── Sesiones ─────────────────────────────────────────────────────────

  /**
   * Eventos propios de una sesión, en orden. Nunca toca los de rrweb (que son casi todo el
   * peso): `type` solo existe en los propios y el índice (session_id, type) los separa.
   */
  private ownEvents(sessionId: string): TaptanaEvent[] {
    const rows = this.q("SELECT data FROM events WHERE session_id = ? AND type >= '' ORDER BY t, id").all(sessionId) as unknown as Array<{ data: string }>;
    const out: TaptanaEvent[] = [];
    for (const row of rows) {
      const ev = parseEvent(row.data);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** Vacía la caché si otra conexión (otro proceso) escribió en la base desde la última lectura. */
  private syncCache(): void {
    const row = this.q('PRAGMA data_version').get() as { data_version: number } | undefined;
    const version = row?.data_version ?? 0;
    if (version !== this.dataVersion) {
      this.dataVersion = version;
      this.derived.clear();
    }
  }

  private summarize(row: SessionRow, studies: Map<string, StudyRecord | null>): SessionSummary {
    const summary = rowToSummary(row);
    let derived = this.derived.get(row.id);
    if (!derived) {
      const events = this.ownEvents(row.id);
      derived = { screenCount: countScreens(events) };
      if (row.study_id) {
        if (!studies.has(row.study_id)) studies.set(row.study_id, this.getStudy(row.study_id));
        const study = studies.get(row.study_id);
        if (study) {
          derived.tasks = computeTaskResults(study, events, parseManual(row.manual_results), row.last_seen_at);
          derived.answers = computeAnswers(study, events);
        }
      }
      this.derived.set(row.id, derived);
    }
    summary.screenCount = derived.screenCount;
    if (derived.tasks) summary.tasks = derived.tasks;
    if (derived.answers) summary.answers = derived.answers;
    return summary;
  }

  private sessionRows(filter: ListSessionsFilter): SessionRow[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.prototypeId) {
      where.push('s.prototype_id = ?');
      params.push(filter.prototypeId);
    }
    if (filter.studyId) {
      where.push('s.study_id = ?');
      params.push(filter.studyId);
    }
    const sql = `${SESSION_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.started_at DESC, s.id`;
    return this.q(sql).all(...params) as unknown as SessionRow[];
  }

  listSessions(filter: ListSessionsFilter = {}): SessionSummary[] {
    this.syncCache();
    const studies = new Map<string, StudyRecord | null>();
    return this.sessionRows(filter).map((row) => this.summarize(row, studies));
  }

  getSession(id: string): SessionSummary | null {
    this.syncCache();
    const row = this.q(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as unknown as SessionRow | undefined;
    return row ? this.summarize(row, new Map()) : null;
  }

  hasSession(id: string): boolean {
    return this.q('SELECT 1 FROM sessions WHERE id = ?').get(id) !== undefined;
  }

  getSessionEvents(id: string): SessionEventsResponse | null {
    const session = this.getSession(id);
    if (!session) return null;
    const pages = (
      this.q('SELECT id, path, title, referrer, started_at FROM pages WHERE session_id = ? ORDER BY started_at, id').all(id) as unknown as Array<{
        id: string;
        path: string;
        title: string | null;
        referrer: string | null;
        started_at: number;
      }>
    ).map<SessionPage>((p) => ({ id: p.id, path: p.path, title: p.title ?? '', referrer: p.referrer ?? '', startedAt: p.started_at }));

    const rows = this.q('SELECT page_id, data FROM events WHERE session_id = ? ORDER BY t, id').all(id) as unknown as Array<{ page_id: string; data: string }>;
    const events: TaptanaEvent[] = [];
    const firstScreen = new Map<string, string>();
    for (const row of rows) {
      const ev = parseEvent(row.data);
      if (!ev) continue;
      events.push(ev);
      if (ev.kind === 'taptana' && ev.type === 'navigation' && !firstScreen.has(row.page_id)) firstScreen.set(row.page_id, ev.to);
    }
    // Grabaciones anteriores a v1 perdían la ruta de la página al llegar su segundo lote: se
    // recupera de la primera navegación de esa página.
    for (const page of pages) {
      if (!page.path) page.path = firstScreen.get(page.id) ?? '';
    }

    const out: SessionEventsResponse = { session, pages, events };
    if (session.studyId) {
      const study = this.getStudy(session.studyId);
      if (study) out.study = study;
    }
    return out;
  }

  importSession(data: SessionExport): void {
    const s = data.session;
    const events = [...data.events].sort((a, b) => a.t - b.t);
    this.transaction(() => {
      this.ensureImportedPrototype(s.prototypeId, s.startedAt);
      this.q('DELETE FROM sessions WHERE id = ?').run(s.id);
      const participant = s.participant ?? participantName(events);
      const manual = manualMarks(s.tasks);
      this.q(
        `INSERT INTO sessions (id, prototype_id, started_at, last_seen_at, device_label, viewport_w, viewport_h,
           touch, entry_path, study_id, variant_id, manual_results, label, participant, notes, excluded)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        s.id,
        s.prototypeId,
        s.startedAt,
        s.lastSeenAt,
        s.deviceLabel,
        s.viewport.width,
        s.viewport.height,
        s.touch ? 1 : 0,
        s.entryPath,
        s.studyId ?? null,
        s.variantId ?? null,
        Object.keys(manual).length > 0 ? JSON.stringify(manual) : null,
        s.label ?? null,
        participant ? participant.slice(0, SESSION_LIMITS.participant) : null,
        s.notes ?? null,
        s.excluded ? 1 : 0,
      );

      // El estudio que viene en el archivo solo se guarda si aquí no existe: no pisa ediciones.
      if (data.study && !this.q('SELECT 1 FROM studies WHERE id = ?').get(data.study.id)) {
        this.ensureImportedPrototype(data.study.prototypeId, s.startedAt);
        this.saveStudy(data.study, data.study.id);
      }

      const insertPage = this.q('INSERT OR IGNORE INTO pages (id, session_id, path, title, referrer, started_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const p of data.pages) insertPage.run(p.id, s.id, p.path, p.title, p.referrer, p.startedAt);
      const pages = [...new Map(data.pages.map((p) => [p.id, p])).values()].sort((a, b) => a.startedAt - b.startedAt);
      if (pages.length === 0) {
        const fallback: SessionPage = { id: `${s.id}_p0`, path: s.entryPath, title: '', referrer: '', startedAt: s.startedAt };
        insertPage.run(fallback.id, s.id, fallback.path, fallback.title, fallback.referrer, fallback.startedAt);
        pages.push(fallback);
      }

      // Los eventos exportados no traen pageId: cada uno va a la página vigente en su momento.
      const insert = this.q('INSERT INTO events (session_id, page_id, t, kind, type, data) VALUES (?, ?, ?, ?, ?, ?)');
      let current = 0;
      for (const ev of events) {
        while (current + 1 < pages.length && (pages[current + 1] as SessionPage).startedAt <= ev.t) current++;
        insert.run(s.id, (pages[current] as SessionPage).id, ev.t, ev.kind, ev.kind === 'taptana' ? ev.type : null, JSON.stringify(ev));
      }
    });
    this.derived.clear();
  }

  /** Un prototipo que solo conocemos por una importación: visible, con nombre claro y sin archivos. */
  private ensureImportedPrototype(id: string, createdAt: number): void {
    this.q("INSERT OR IGNORE INTO prototypes (id, name, created_at, source) VALUES (?, ?, ?, 'import')").run(id, IMPORTED_PROTOTYPE_NAME, createdAt);
  }

  setSessionFields(sessionId: string, patch: SessionPatch): boolean {
    const row = this.q('SELECT manual_results FROM sessions WHERE id = ?').get(sessionId) as { manual_results: string | null } | undefined;
    if (!row) return false;
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (patch.label !== undefined) {
      sets.push('label = ?');
      params.push(patch.label || null);
    }
    if (patch.notes !== undefined) {
      sets.push('notes = ?');
      params.push(patch.notes || null);
    }
    if (patch.excluded !== undefined) {
      sets.push('excluded = ?');
      params.push(patch.excluded ? 1 : 0);
    }
    if (patch.manual !== undefined) {
      sets.push('manual_results = ?');
      // `null` quita la marca: la tarea vuelve a "por revisar".
      const marks = applyManualPatch(parseManual(row.manual_results), patch.manual);
      params.push(Object.keys(marks).length > 0 ? JSON.stringify(marks) : null);
    }
    if (sets.length > 0) {
      this.q(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params, sessionId);
      this.derived.delete(sessionId);
    }
    return true;
  }

  deleteSession(id: string): boolean {
    const result = this.q('DELETE FROM sessions WHERE id = ?').run(id);
    this.derived.delete(id);
    return Number(result.changes) > 0;
  }

  listReportSessions(studyId: string): ReportSession[] {
    return this.sessionRows({ studyId }).map((row) => ({
      session: rowToSummary(row),
      events: this.ownEvents(row.id),
      manual: parseManual(row.manual_results),
    }));
  }

  listScreens(prototypeId: string, files: ReadonlyArray<{ path: string; title?: string }> = []): ScreenInfo[] {
    const rows = this.q(
      `SELECT e.data FROM events e JOIN sessions s ON s.id = e.session_id
       WHERE s.prototype_id = ? AND e.type = 'navigation' ORDER BY e.t, e.id`,
    ).all(prototypeId) as unknown as Array<{ data: string }>;
    const navigations: TaptanaEvent[] = [];
    for (const row of rows) {
      const ev = parseEvent(row.data);
      if (ev) navigations.push(ev);
    }
    return knownScreens(files, navigations);
  }

  // ── Estudios ─────────────────────────────────────────────────────────

  listStudies(prototypeId?: string): StudyRecord[] {
    const rows = (
      prototypeId
        ? this.q('SELECT * FROM studies WHERE prototype_id = ? ORDER BY updated_at DESC, id').all(prototypeId)
        : this.q('SELECT * FROM studies ORDER BY updated_at DESC, id').all()
    ) as unknown as StudyRow[];
    return rows.map(rowToStudy);
  }

  getStudy(id: string): StudyRecord | null {
    const row = this.q('SELECT * FROM studies WHERE id = ?').get(id) as unknown as StudyRow | undefined;
    return row ? rowToStudy(row) : null;
  }

  saveStudy(study: Study, id?: string): StudyRecord {
    const now = Date.now();
    // Se guarda el Study limpio y en v2, sin id ni fechas, para que exportarlo sea trivial.
    const clean: Study & { id?: string; createdAt?: number; updatedAt?: number } = normalizeStudy(study);
    delete clean.id;
    delete clean.createdAt;
    delete clean.updatedAt;
    this.ensurePrototype({ id: clean.prototypeId, name: clean.prototypeId, createdAt: now });
    const existing = id ? (this.q('SELECT created_at FROM studies WHERE id = ?').get(id) as { created_at: number } | undefined) : undefined;
    const finalId = id ?? createId('st');
    const createdAt = existing?.created_at ?? now;
    this.q(
      `INSERT INTO studies (id, prototype_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET prototype_id = excluded.prototype_id, name = excluded.name,
         data = excluded.data, updated_at = excluded.updated_at`,
    ).run(finalId, clean.prototypeId, clean.name, JSON.stringify(clean), createdAt, now);
    this.derived.clear();
    return { ...clean, id: finalId, createdAt, updatedAt: now };
  }

  duplicateStudy(id: string): StudyRecord | null {
    const original = this.getStudy(id);
    return original ? this.saveStudy(duplicateStudy(original)) : null;
  }

  deleteStudy(id: string): boolean {
    const result = this.q('DELETE FROM studies WHERE id = ?').run(id);
    this.derived.clear();
    return Number(result.changes) > 0;
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }
}
