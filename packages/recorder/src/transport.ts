/**
 * Cómo salen los lotes del celular.
 *
 * - http: fetch a /api/v1/events, con tiempo límite; al cerrar la página, sendBeacon.
 * - local: IndexedDB del navegador + botón "Terminar y exportar" (sin servidor).
 */

import { API_PREFIX, REQUEST_TIMEOUT_MS, type EventBatch } from '@taptana/shared';

/**
 * - ok: entregado y confirmado.
 * - sent: entregado al navegador para que lo mande al cerrar (sin confirmación).
 * - retry: no llegó (sin red, tiempo agotado, error del servidor): se reintenta igual.
 * - reject: el servidor no lo acepta (400 / 413) y no lo aceptará: no se reintenta igual.
 */
export type SendResult = 'ok' | 'sent' | 'retry' | 'reject';

/** Un lote listo para viajar: su texto JSON ya armado. */
export interface Wire {
  sessionId: string;
  pageId: string;
  seq: number;
  /** El EventBatch completo, serializado. */
  json: string;
  /**
   * La petición puede seguir viva aunque la página se cierre (`keepalive`). El transporte lo
   * apaga si el navegador no la aceptó así.
   */
  keepalive: boolean;
}

export interface Transport {
  /** `final`: la página se está cerrando o escondiendo y puede no haber otra oportunidad. */
  send(wire: Wire, final: boolean): Promise<SendResult>;
}

// ── HTTP ────────────────────────────────────────────────────────────────

export class HttpTransport implements Transport {
  private readonly url: string;

  constructor(endpoint: string) {
    this.url = `${endpoint}${API_PREFIX}/events`;
  }

  async send(wire: Wire, final: boolean): Promise<SendResult> {
    if (final) return this.beacon(wire.json);
    let result = await this.post(wire.json, wire.keepalive);
    if (result === 'refused') {
      // El navegador limita cuánto puede quedar "vivo" a la vez: se manda como petición normal.
      wire.keepalive = false;
      result = await this.post(wire.json, false);
    }
    return result === 'refused' ? 'retry' : result;
  }

  private async post(body: string, keepalive: boolean): Promise<SendResult | 'refused'> {
    const abort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive,
        credentials: 'omit',
        signal: abort.signal,
      });
      if (res.ok) return 'ok';
      return res.status === 400 || res.status === 413 ? 'reject' : 'retry';
    } catch {
      return keepalive && !timedOut && navigator.onLine !== false ? 'refused' : 'retry';
    } finally {
      clearTimeout(timer);
    }
  }

  private beacon(body: string): SendResult {
    try {
      if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(this.url, new Blob([body], { type: 'application/json' }))) {
        return 'sent';
      }
      void fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'omit' }).catch(
        () => {},
      );
      return 'sent';
    } catch {
      return 'retry';
    }
  }
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

/**
 * IndexedDB es asíncrono: al cerrar la página, la escritura puede no terminar. Por eso el lote
 * final se guarda primero en localStorage (síncrono) y se vuelca a IndexedDB en la siguiente
 * carga de página o al exportar.
 */
const PENDING_PREFIX = 'taptana:pending:';

export class LocalTransport implements Transport {
  private db: Promise<IDBDatabase> | null = null;

  constructor() {
    void this.drainPending();
  }

  private getDb(): Promise<IDBDatabase> {
    if (!this.db) this.db = openDb();
    return this.db;
  }

  /** La clave es (sessionId, pageId, seq): guardar dos veces el mismo lote no lo duplica. */
  private put(batch: EventBatch): Promise<void> {
    return this.getDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(batch);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  }

  /** Mueve a IndexedDB los lotes que quedaron en localStorage al cerrar una página. */
  private async drainPending(): Promise<void> {
    const keys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(PENDING_PREFIX)) keys.push(key);
      }
    } catch {
      return;
    }
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) await this.put(JSON.parse(raw) as EventBatch);
        localStorage.removeItem(key);
      } catch {
        /* se reintenta en la próxima carga */
      }
    }
  }

  async send(wire: Wire, final: boolean): Promise<SendResult> {
    let batch: EventBatch;
    try {
      batch = JSON.parse(wire.json) as EventBatch;
    } catch {
      return 'reject';
    }
    if (final) {
      const key = `${PENDING_PREFIX}${wire.sessionId}:${wire.pageId}:${wire.seq}`;
      try {
        localStorage.setItem(key, wire.json);
      } catch {
        /* sin espacio: igual intentamos IndexedDB */
      }
      void this.put(batch).then(
        () => {
          try {
            localStorage.removeItem(key);
          } catch {
            /* nada */
          }
        },
        () => {},
      );
      return 'sent';
    }
    try {
      await this.put(batch);
      return 'ok';
    } catch {
      return 'retry';
    }
  }

  async readSession(sessionId: string): Promise<EventBatch[]> {
    await this.drainPending();
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
