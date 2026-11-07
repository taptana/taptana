/**
 * Modo demo (GitHub Pages): lee sesiones de JSON incluidos en el sitio y guarda las importadas
 * en IndexedDB del navegador de quien mira.
 *
 *   <base>/demo/sessions.json      lista de SessionSummary
 *   <base>/demo/<id>.json          SessionExport de cada una
 */

import type { SessionEventsResponse, SessionExport, SessionSummary } from '@taptana/shared';
import type { ApiClient } from './client.ts';

const DB_NAME = 'taptana-panel';
const STORE = 'sessions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'session.id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class StaticClient implements ApiClient {
  readonly mode = 'static' as const;
  private readonly base: string;

  constructor(base: string) {
    this.base = base.endsWith('/') ? base : `${base}/`;
  }

  private async bundled(): Promise<SessionSummary[]> {
    try {
      const res = await fetch(`${this.base}demo/sessions.json`, { cache: 'no-cache' });
      if (!res.ok) return [];
      return (await res.json()) as SessionSummary[];
    } catch {
      return [];
    }
  }

  private async imported(): Promise<SessionExport[]> {
    try {
      return await withStore<SessionExport[]>('readonly', (s) => s.getAll() as IDBRequest<SessionExport[]>);
    } catch {
      return [];
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    const [bundled, imported] = await Promise.all([this.bundled(), this.imported()]);
    const all = [...imported.map((i) => i.session), ...bundled.filter((b) => !imported.some((i) => i.session.id === b.id))];
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  async getSessionEvents(id: string): Promise<SessionEventsResponse | null> {
    const local = (await this.imported()).find((i) => i.session.id === id);
    if (local) return { session: local.session, pages: local.pages, events: local.events };
    try {
      const res = await fetch(`${this.base}demo/${encodeURIComponent(id)}.json`);
      if (!res.ok) return null;
      const data = (await res.json()) as SessionExport;
      return { session: data.session, pages: data.pages, events: data.events };
    } catch {
      return null;
    }
  }

  async importSession(data: SessionExport): Promise<void> {
    await withStore('readwrite', (s) => s.put(data));
  }

  async deleteSession(id: string): Promise<void> {
    await withStore('readwrite', (s) => s.delete(id));
  }
}
