/**
 * Store con node:sqlite (DatabaseSync). Sin dependencias nativas que compilar.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  deviceLabel,
  type EventBatch,
  type ManualResults,
  type Prototype,
  type SessionEventsResponse,
  type SessionExport,
  type SessionPage,
  type SessionSummary,
  type Study,
  type StudyRecord,
  type TaptanaEvent,
} from '@taptana/shared';
import { MIGRATIONS, SCHEMA } from './schema.js';
import type { ListSessionsFilter, Store } from './store.js';
import { computeTaskResults } from '../results.js';

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
  page_count: number;
  tap_count: number;
}

interface PrototypeRow {
  id: string;
  name: string;
  created_at: number;
  source: string | null;
  entry_path: string | null;
  session_count: number;
}

function rowToPrototype(row: PrototypeRow): Prototype {
  const p: Prototype = {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    source: row.source === 'upload' ? 'upload' : 'folder',
    sessionCount: Number(row.session_count),
  };
  if (row.entry_path) p.entryPath = row.entry_path;
  return p;
}

interface StudyRow {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
}

const SESSION_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM pages p WHERE p.session_id = s.id) AS page_count,
    (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type = 'tap') AS tap_count
  FROM sessions s
`;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function createId(prefix: string, length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
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
  return s;
}

function parseManual(raw: string | null): ManualResults {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ManualResults;
  } catch {
    return {};
  }
}

function rowToStudy(row: StudyRow): StudyRecord {
  const data = JSON.parse(row.data) as Study;
  return { ...data, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
}

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Agrega columnas nuevas a bases creadas por versiones anteriores. */
  private migrate(): void {
    for (const [table, column, definition] of MIGRATIONS) {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
  }

  ensurePrototype(prototype: Prototype): void {
    this.db
      .prepare('INSERT OR IGNORE INTO prototypes (id, name, created_at) VALUES (?, ?, ?)')
      .run(prototype.id, prototype.name, prototype.createdAt);
  }

  savePrototype(p: Prototype): Prototype {
    this.db
      .prepare(
        `INSERT INTO prototypes (id, name, created_at, source, entry_path) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, source = excluded.source, entry_path = excluded.entry_path`,
      )
      .run(p.id, p.name, p.createdAt, p.source ?? 'folder', p.entryPath ?? null);
    return this.getPrototype(p.id)!;
  }

  listPrototypes(): Prototype[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM sessions s WHERE s.prototype_id = p.id) AS session_count
         FROM prototypes p ORDER BY p.created_at DESC`,
      )
      .all() as unknown as PrototypeRow[];
    return rows.map(rowToPrototype);
  }

  getPrototype(id: string): Prototype | null {
    const row = this.db
      .prepare(`SELECT p.*, (SELECT COUNT(*) FROM sessions s WHERE s.prototype_id = p.id) AS session_count FROM prototypes p WHERE p.id = ?`)
      .get(id) as unknown as PrototypeRow | undefined;
    return row ? rowToPrototype(row) : null;
  }

  deletePrototype(id: string): boolean {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM sessions WHERE prototype_id = ?').run(id);
      this.db.prepare('DELETE FROM studies WHERE prototype_id = ?').run(id);
      const result = this.db.prepare('DELETE FROM prototypes WHERE id = ?').run(id);
      this.db.exec('COMMIT');
      return Number(result.changes) > 0;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  ingestBatch(batch: EventBatch): { received: number } {
    const times = batch.events.map((e) => e.t);
    const minT = times.length ? Math.min(...times) : batch.sentAt;
    const maxT = times.length ? Math.max(...times) : batch.sentAt;

    this.db.exec('BEGIN');
    try {
      this.ensurePrototype({ id: batch.prototypeId, name: batch.prototypeId, createdAt: minT });

      const existing = this.db.prepare('SELECT id, user_agent FROM sessions WHERE id = ?').get(batch.sessionId) as
        | { id: string; user_agent: string | null }
        | undefined;

      if (!existing) {
        const d = batch.device;
        this.db
          .prepare(
            `INSERT INTO sessions (id, prototype_id, started_at, last_seen_at, user_agent, device_label,
               screen_w, screen_h, viewport_w, viewport_h, dpr, touch, language, entry_path)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
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
            batch.page?.path ?? null,
          );
      } else {
        this.db
          .prepare(
            `UPDATE sessions SET started_at = MIN(started_at, ?), last_seen_at = MAX(last_seen_at, ?) WHERE id = ?`,
          )
          .run(minT, maxT, batch.sessionId);
        if (!existing.user_agent && batch.device) {
          const d = batch.device;
          this.db
            .prepare(
              `UPDATE sessions SET user_agent = ?, device_label = ?, screen_w = ?, screen_h = ?,
                 viewport_w = ?, viewport_h = ?, dpr = ?, touch = ?, language = ?,
                 entry_path = COALESCE(entry_path, ?) WHERE id = ?`,
            )
            .run(
              d.userAgent,
              deviceLabel(d.userAgent),
              d.screen.width,
              d.screen.height,
              d.viewport.width,
              d.viewport.height,
              d.dpr,
              d.touch ? 1 : 0,
              d.language,
              batch.page?.path ?? null,
              batch.sessionId,
            );
        }
      }

      // Si el lote trae el inicio de un estudio, la sesión queda ligada a él.
      for (const ev of batch.events) {
        if (ev.kind === 'taptana' && ev.type === 'study' && ev.action === 'start') {
          this.db
            .prepare('UPDATE sessions SET study_id = ?, variant_id = COALESCE(?, variant_id) WHERE id = ?')
            .run(ev.studyId, ev.variantId ?? null, batch.sessionId);
        }
      }

      const page = batch.page;
      this.db
        .prepare(
          `INSERT INTO pages (id, session_id, path, title, referrer, started_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             path = COALESCE(excluded.path, pages.path),
             title = COALESCE(excluded.title, pages.title)`,
        )
        .run(batch.pageId, batch.sessionId, page?.path ?? '', page?.title ?? null, page?.referrer ?? null, page?.startedAt ?? minT);

      const insert = this.db.prepare(
        'INSERT INTO events (session_id, page_id, t, kind, type, data) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const ev of batch.events) {
        insert.run(batch.sessionId, batch.pageId, ev.t, ev.kind, ev.kind === 'taptana' ? ev.type : null, JSON.stringify(ev));
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { received: batch.events.length };
  }

  private withTasks(row: SessionRow): SessionSummary {
    const summary = rowToSummary(row);
    if (row.study_id) {
      const study = this.getStudy(row.study_id);
      if (study) {
        const events = this.readEvents(row.id, true);
        summary.tasks = computeTaskResults(study, events, parseManual(row.manual_results), row.last_seen_at);
      }
    }
    return summary;
  }

  /** Eventos de una sesión. Con `onlyTaptana`, salta los de rrweb (más liviano para resultados). */
  private readEvents(sessionId: string, onlyTaptana = false): TaptanaEvent[] {
    const sql = onlyTaptana
      ? "SELECT data FROM events WHERE session_id = ? AND kind = 'taptana' ORDER BY t, id"
      : 'SELECT data FROM events WHERE session_id = ? ORDER BY t, id';
    return (this.db.prepare(sql).all(sessionId) as unknown as Array<{ data: string }>).map((r) => JSON.parse(r.data) as TaptanaEvent);
  }

  listSessions(filter: ListSessionsFilter = {}): SessionSummary[] {
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
    const sql = `${SESSION_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.started_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as unknown as SessionRow[];
    return rows.map((row) => this.withTasks(row));
  }

  getSession(id: string): SessionSummary | null {
    const row = this.db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as unknown as SessionRow | undefined;
    return row ? this.withTasks(row) : null;
  }

  getSessionEvents(id: string): SessionEventsResponse | null {
    const session = this.getSession(id);
    if (!session) return null;
    const pages = (
      this.db
        .prepare('SELECT id, path, title, referrer, started_at FROM pages WHERE session_id = ? ORDER BY started_at')
        .all(id) as unknown as Array<{ id: string; path: string; title: string | null; referrer: string | null; started_at: number }>
    ).map<SessionPage>((p) => ({ id: p.id, path: p.path, title: p.title ?? '', referrer: p.referrer ?? '', startedAt: p.started_at }));
    const events = this.readEvents(id);
    const out: SessionEventsResponse = { session, pages, events };
    if (session.studyId) {
      const study = this.getStudy(session.studyId);
      if (study) out.study = study;
    }
    return out;
  }

  importSession(data: SessionExport): void {
    const s = data.session;
    this.db.exec('BEGIN');
    try {
      this.ensurePrototype({ id: s.prototypeId, name: s.prototypeId, createdAt: s.startedAt });
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
      this.db
        .prepare(
          `INSERT INTO sessions (id, prototype_id, started_at, last_seen_at, device_label,
             viewport_w, viewport_h, touch, entry_path, study_id, variant_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
        );
      if (data.study) {
        const exists = this.db.prepare('SELECT id FROM studies WHERE id = ?').get(data.study.id);
        if (!exists) this.saveStudy(data.study, data.study.id);
      }
      const insertPage = this.db.prepare(
        'INSERT INTO pages (id, session_id, path, title, referrer, started_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const p of data.pages) insertPage.run(p.id, s.id, p.path, p.title, p.referrer, p.startedAt);
      // Los eventos exportados no traen pageId: se asignan por tiempo a la página vigente.
      const sortedPages = [...data.pages].sort((a, b) => a.startedAt - b.startedAt);
      let fallbackPage = sortedPages[0]?.id;
      if (!fallbackPage) {
        fallbackPage = `${s.id}_p0`;
        insertPage.run(fallbackPage, s.id, s.entryPath, '', '', s.startedAt);
      }
      const insert = this.db.prepare(
        'INSERT INTO events (session_id, page_id, t, kind, type, data) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const ev of data.events) {
        let pageId = fallbackPage;
        for (const p of sortedPages) if (p.startedAt <= ev.t) pageId = p.id;
        insert.run(s.id, pageId, ev.t, ev.kind, ev.kind === 'taptana' ? ev.type : null, JSON.stringify(ev));
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  setManualResults(sessionId: string, manual: ManualResults): boolean {
    const row = this.db.prepare('SELECT manual_results FROM sessions WHERE id = ?').get(sessionId) as
      | { manual_results: string | null }
      | undefined;
    if (!row) return false;
    const merged = { ...parseManual(row.manual_results), ...manual };
    this.db.prepare('UPDATE sessions SET manual_results = ? WHERE id = ?').run(JSON.stringify(merged), sessionId);
    return true;
  }

  deleteSession(id: string): boolean {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  // ── Estudios ─────────────────────────────────────────────────────────

  listStudies(prototypeId?: string): StudyRecord[] {
    const rows = (
      prototypeId
        ? this.db.prepare('SELECT * FROM studies WHERE prototype_id = ? ORDER BY updated_at DESC').all(prototypeId)
        : this.db.prepare('SELECT * FROM studies ORDER BY updated_at DESC').all()
    ) as unknown as StudyRow[];
    return rows.map(rowToStudy);
  }

  getStudy(id: string): StudyRecord | null {
    const row = this.db.prepare('SELECT * FROM studies WHERE id = ?').get(id) as unknown as StudyRow | undefined;
    return row ? rowToStudy(row) : null;
  }

  saveStudy(study: Study, id?: string): StudyRecord {
    const now = Date.now();
    this.ensurePrototype({ id: study.prototypeId, name: study.prototypeId, createdAt: now });
    const existing = id ? this.getStudy(id) : null;
    const finalId = id ?? createId('st');
    // Se guarda el Study limpio, sin id ni fechas, para que exportarlo sea trivial.
    const { v, name, description, prototypeId, welcome, consent, tasks, variants } = study;
    const clean: Study = { v, name, prototypeId, tasks };
    if (description !== undefined) clean.description = description;
    if (welcome !== undefined) clean.welcome = welcome;
    if (consent !== undefined) clean.consent = consent;
    if (variants !== undefined) clean.variants = variants;
    const createdAt = existing?.createdAt ?? now;
    this.db
      .prepare(
        `INSERT INTO studies (id, prototype_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET prototype_id = excluded.prototype_id, name = excluded.name,
           data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(finalId, prototypeId, name, JSON.stringify(clean), createdAt, now);
    return { ...clean, id: finalId, createdAt, updatedAt: now };
  }

  deleteStudy(id: string): boolean {
    const result = this.db.prepare('DELETE FROM studies WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}
