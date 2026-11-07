/**
 * Store con node:sqlite (DatabaseSync). Sin dependencias nativas que compilar.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  deviceLabel,
  type EventBatch,
  type Prototype,
  type SessionEventsResponse,
  type SessionExport,
  type SessionPage,
  type SessionSummary,
  type TaptanaEvent,
} from '@taptana/shared';
import { SCHEMA } from './schema.js';
import type { Store } from './store.js';

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
  page_count: number;
  tap_count: number;
}

const SESSION_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM pages p WHERE p.session_id = s.id) AS page_count,
    (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.type = 'tap') AS tap_count
  FROM sessions s
`;

function rowToSummary(row: SessionRow): SessionSummary {
  return {
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
}

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  ensurePrototype(prototype: Prototype): void {
    this.db
      .prepare('INSERT OR IGNORE INTO prototypes (id, name, created_at) VALUES (?, ?, ?)')
      .run(prototype.id, prototype.name, prototype.createdAt);
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

  listSessions(prototypeId?: string): SessionSummary[] {
    const rows = (
      prototypeId
        ? this.db.prepare(`${SESSION_SELECT} WHERE s.prototype_id = ? ORDER BY s.started_at DESC`).all(prototypeId)
        : this.db.prepare(`${SESSION_SELECT} ORDER BY s.started_at DESC`).all()
    ) as unknown as SessionRow[];
    return rows.map(rowToSummary);
  }

  getSession(id: string): SessionSummary | null {
    const row = this.db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as unknown as SessionRow | undefined;
    return row ? rowToSummary(row) : null;
  }

  getSessionEvents(id: string): SessionEventsResponse | null {
    const session = this.getSession(id);
    if (!session) return null;
    const pages = (
      this.db
        .prepare('SELECT id, path, title, referrer, started_at FROM pages WHERE session_id = ? ORDER BY started_at')
        .all(id) as unknown as Array<{ id: string; path: string; title: string | null; referrer: string | null; started_at: number }>
    ).map<SessionPage>((p) => ({ id: p.id, path: p.path, title: p.title ?? '', referrer: p.referrer ?? '', startedAt: p.started_at }));
    const events = (
      this.db.prepare('SELECT data FROM events WHERE session_id = ? ORDER BY t, id').all(id) as unknown as Array<{ data: string }>
    ).map((r) => JSON.parse(r.data) as TaptanaEvent);
    return { session, pages, events };
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
             viewport_w, viewport_h, touch, entry_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(s.id, s.prototypeId, s.startedAt, s.lastSeenAt, s.deviceLabel, s.viewport.width, s.viewport.height, s.touch ? 1 : 0, s.entryPath);
      const insertPage = this.db.prepare(
        'INSERT INTO pages (id, session_id, path, title, referrer, started_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const pageIds = new Set<string>();
      for (const p of data.pages) {
        insertPage.run(p.id, s.id, p.path, p.title, p.referrer, p.startedAt);
        pageIds.add(p.id);
      }
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

  deleteSession(id: string): boolean {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}
