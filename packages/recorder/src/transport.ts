/**
 * Cómo salen los lotes del celular.
 *
 * - http: fetch a /api/v1/events; al cerrar la página, sendBeacon.
 * - local: IndexedDB del navegador + botón "Terminar y exportar" (sin servidor).
 */

import { API_PREFIX, BEACON_MAX_BYTES, type EventBatch } from '@taptana/shared';

export interface Transport {
  /**
   * Envía un lote. `final` es true cuando la página se está cerrando y no habrá otra
   * oportunidad. Devuelve true si se puede dar por entregado.
   */
  send(batch: EventBatch, final: boolean): Promise<boolean>;
}

// ── HTTP ────────────────────────────────────────────────────────────────

export class HttpTransport implements Transport {
  private readonly url: string;

  constructor(endpoint: string) {
    this.url = `${endpoint}${API_PREFIX}/events`;
  }

  async send(batch: EventBatch, final: boolean): Promise<boolean> {
    const body = JSON.stringify(batch);
    if (final) return this.beacon(batch, body);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: body.length < BEACON_MAX_BYTES,
        credentials: 'omit',
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private beacon(batch: EventBatch, body: string): boolean {
    if (typeof navigator.sendBeacon !== 'function') {
      void fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
      return true;
    }
    if (body.length <= BEACON_MAX_BYTES) {
      return navigator.sendBeacon(this.url, new Blob([body], { type: 'application/json' }));
    }
    // Más grande que el límite de sendBeacon: partir en varios lotes con el mismo seq base.
    let ok = true;
    const chunks = splitBatch(batch, BEACON_MAX_BYTES);
    for (const chunk of chunks) {
      const b = new Blob([JSON.stringify(chunk)], { type: 'application/json' });
      ok = navigator.sendBeacon(this.url, b) && ok;
    }
    return ok;
  }
}

/** Divide un lote en varios que quepan en `maxBytes`. Un evento más grande que el límite va solo. */
export function splitBatch(batch: EventBatch, maxBytes: number): EventBatch[] {
  const out: EventBatch[] = [];
  const base = { ...batch, events: [] as EventBatch['events'] };
  const overhead = JSON.stringify(base).length;
  let current: EventBatch = { ...base, events: [] };
  let size = overhead;
  let seq = batch.seq;
  for (const ev of batch.events) {
    const evSize = JSON.stringify(ev).length + 1;
    if (current.events.length > 0 && size + evSize > maxBytes) {
      out.push(current);
      seq += 1;
      // page y device solo viajan en el primer trozo.
      const { page: _p, device: _d, ...rest } = base;
      current = { ...rest, seq, events: [] };
      size = JSON.stringify(current).length;
    }
    current.events.push(ev);
    size += evSize;
  }
  out.push(current);
  return out;
}

// ── Local (sin servidor) ───────────────────────────────────────────────

const DB_NAME = 'taptana';
const STORE = 'batches';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ['sessionId', 'pageId', 'seq'] });
        store.createIndex('bySession', 'sessionId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class LocalTransport implements Transport {
  private db: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (!this.db) this.db = openDb();
    return this.db;
  }

  async send(batch: EventBatch): Promise<boolean> {
    try {
      const db = await this.getDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(batch);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch {
      return false;
    }
  }

  async readSession(sessionId: string): Promise<EventBatch[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('bySession').getAll(sessionId);
      req.onsuccess = () => {
        const batches = req.result as EventBatch[];
        batches.sort((a, b) => a.sentAt - b.sentAt || a.seq - b.seq);
        resolve(batches);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clearSession(sessionId: string): Promise<void> {
    const db = await this.getDb();
    const batches = await this.readSession(sessionId);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const b of batches) store.delete([b.sessionId, b.pageId, b.seq]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
