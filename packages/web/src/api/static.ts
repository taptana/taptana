/**
 * Modo demo (GitHub Pages). No hay servidor: todo vive en este navegador.
 *
 * - Sesiones de ejemplo: JSON incluidos en el sitio (<base>demo/...).
 * - Prototipos subidos: archivos en IndexedDB, servidos por el service worker (sw.js) en
 *   <base>local/<id>/. Solo funcionan en este navegador.
 * - Sesiones grabadas sobre esos prototipos: el recorder (modo local) las guarda en la base
 *   "taptana" de este mismo origen; el panel las lee de ahí y calcula los resultados.
 * - Estudios, marcas manuales y sesiones importadas: IndexedDB "taptana-panel".
 */

import {
  batchesToExport,
  computeTaskResults,
  type EventBatch,
  type ManualResults,
  type Prototype,
  type ServerInfo,
  type SessionEventsResponse,
  type SessionExport,
  type SessionSummary,
  type Study,
  type StudyRecord,
} from '@taptana/shared';
import type { ApiClient, PrototypePage } from './client.ts';
import { htmlTitle, unpack } from '@/lib/unzip';

const PANEL_DB = 'taptana-panel';
const SESSIONS = 'sessions';
const STUDIES = 'studies';
const PROTOTYPES = 'prototypes';
const FILES = 'files';
const MANUAL = 'manual';
const DEMO_PROTOTYPE_ID = 'demo-tienda';

function openPanelDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PANEL_DB, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'session.id' });
      if (!db.objectStoreNames.contains(STUDIES)) db.createObjectStore(STUDIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PROTOTYPES)) db.createObjectStore(PROTOTYPES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: ['protoId', 'path'] }).createIndex('byProto', 'protoId');
      if (!db.objectStoreNames.contains(MANUAL)) db.createObjectStore(MANUAL, { keyPath: 'sessionId' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

/** La base del recorder (modo local). Se abre con su mismo esquema para no estorbarle. */
function openRecorderDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('taptana', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('batches')) {
        db.createObjectStore('batches', { keyPath: ['sessionId', 'pageId', 'seq'] }).createIndex('bySession', 'sessionId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function panel<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return run(await openPanelDb(), store, mode, fn);
}

function createId(prefix: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(8))) out += alphabet[b % alphabet.length];
  return `${prefix}_${out}`;
}

interface StoredFile {
  protoId: string;
  path: string;
  data: Uint8Array;
}

export class StaticClient implements ApiClient {
  readonly mode = 'static' as const;
  readonly canUpload = true;
  private readonly base: string;

  constructor(base: string) {
    this.base = base.endsWith('/') ? base : `${base}/`;
  }

  async info(): Promise<ServerInfo> {
    return { version: 'demo', participantUrl: `${location.origin}${this.base}`, prototypeId: DEMO_PROTOTYPE_ID, prototypeName: 'Tienda (demo)' };
  }

  private async fetchJson<T>(path: string, fallback: T): Promise<T> {
    try {
      const res = await fetch(`${this.base}${path}`, { cache: 'no-cache' });
      if (!res.ok) return fallback;
      return (await res.json()) as T;
    } catch {
      return fallback;
    }
  }

  // ── Sesiones ─────────────────────────────────────────────────────────

  private async imported(): Promise<SessionExport[]> {
    try {
      return await panel<SessionExport[]>(SESSIONS, 'readonly', (s) => s.getAll() as IDBRequest<SessionExport[]>);
    } catch {
      return [];
    }
  }

  /** Sesiones grabadas en este navegador sobre prototipos subidos (recorder en modo local). */
  private async recorded(): Promise<SessionEventsResponse[]> {
    let batches: EventBatch[] = [];
    try {
      const db = await openRecorderDb();
      batches = await run<EventBatch[]>(db, 'batches', 'readonly', (s) => s.getAll() as IDBRequest<EventBatch[]>);
      db.close();
    } catch {
      return [];
    }
    const bySession = new Map<string, EventBatch[]>();
    for (const b of batches) {
      if (b.prototypeId === DEMO_PROTOTYPE_ID) continue; // las del prototipo de ejemplo se exportan a mano
      bySession.set(b.sessionId, [...(bySession.get(b.sessionId) ?? []), b]);
    }
    const out: SessionEventsResponse[] = [];
    for (const list of bySession.values()) {
      list.sort((a, b) => a.sentAt - b.sentAt || a.seq - b.seq);
      const data = batchesToExport(list);
      if (data) out.push(await this.withResults(data));
    }
    return out;
  }

  /** Liga la sesión a su estudio (si tiene) y calcula los resultados por tarea. */
  private async withResults(data: SessionEventsResponse): Promise<SessionEventsResponse> {
    const session: SessionSummary = { ...data.session };
    const start = data.events.find((e) => e.kind === 'taptana' && e.type === 'study' && e.action === 'start');
    if (start && start.kind === 'taptana' && start.type === 'study') {
      session.studyId = start.studyId;
      if (start.variantId) session.variantId = start.variantId;
    }
    const study = session.studyId ? ((await this.getStudy(session.studyId)) ?? data.study) : undefined;
    if (study) {
      let manual: ManualResults = {};
      try {
        manual = ((await panel<{ manual: ManualResults } | undefined>(MANUAL, 'readonly', (s) => s.get(session.id))) ?? { manual: {} }).manual;
      } catch {
        /* sin marcas */
      }
      session.tasks = computeTaskResults(study, data.events, manual, session.lastSeenAt);
    }
    return { ...data, session, ...(study ? { study } : {}) };
  }

  private async all(): Promise<SessionEventsResponse[]> {
    const [bundled, imported, recorded] = await Promise.all([
      this.fetchJson<SessionSummary[]>('demo/sessions.json', []),
      this.imported(),
      this.recorded(),
    ]);
    const own = [...recorded, ...(await Promise.all(imported.map((i) => this.withResults(i))))];
    const ids = new Set(own.map((o) => o.session.id));
    return [...own, ...bundled.filter((b) => !ids.has(b.id)).map((session) => ({ session, pages: [], events: [] }))];
  }

  async listSessions(studyId?: string): Promise<SessionSummary[]> {
    return (await this.all())
      .map((d) => d.session)
      .filter((s) => !studyId || s.studyId === studyId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  async getSessionEvents(id: string): Promise<SessionEventsResponse | null> {
    const own = (await Promise.all([this.recorded(), this.imported()])).flat().find((d) => d.session.id === id);
    if (own) return this.withResults(own);
    return this.fetchJson<SessionExport | null>(`demo/${encodeURIComponent(id)}.json`, null);
  }

  async importSession(data: SessionExport): Promise<void> {
    await panel(SESSIONS, 'readwrite', (s) => s.put(data));
  }

  async deleteSession(id: string): Promise<void> {
    await panel(SESSIONS, 'readwrite', (s) => s.delete(id));
    try {
      const db = await openRecorderDb();
      const keys = await run<IDBValidKey[]>(db, 'batches', 'readonly', (s) => s.index('bySession').getAllKeys(id));
      for (const k of keys) await run(db, 'batches', 'readwrite', (s) => s.delete(k));
      db.close();
    } catch {
      /* nada que borrar */
    }
  }

  async setManualResults(id: string, manual: ManualResults): Promise<SessionSummary> {
    const prev = ((await panel<{ manual: ManualResults } | undefined>(MANUAL, 'readonly', (s) => s.get(id))) ?? { manual: {} }).manual;
    await panel(MANUAL, 'readwrite', (s) => s.put({ sessionId: id, manual: { ...prev, ...manual } }));
    const data = await this.getSessionEvents(id);
    if (!data) throw new Error('No existe la sesión');
    return data.session;
  }

  // ── Estudios ─────────────────────────────────────────────────────────

  async listStudies(): Promise<StudyRecord[]> {
    try {
      const list = await panel<StudyRecord[]>(STUDIES, 'readonly', (s) => s.getAll() as IDBRequest<StudyRecord[]>);
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async getStudy(id: string): Promise<StudyRecord | null> {
    try {
      return (await panel<StudyRecord | undefined>(STUDIES, 'readonly', (s) => s.get(id) as IDBRequest<StudyRecord | undefined>)) ?? null;
    } catch {
      return null;
    }
  }

  async saveStudy(study: Study, id?: string): Promise<StudyRecord> {
    const existing = id ? await this.getStudy(id) : null;
    const now = Date.now();
    const record: StudyRecord = { ...study, id: id ?? createId('st'), createdAt: existing?.createdAt ?? now, updatedAt: now };
    await panel(STUDIES, 'readwrite', (s) => s.put(record));
    return record;
  }

  async deleteStudy(id: string): Promise<void> {
    await panel(STUDIES, 'readwrite', (s) => s.delete(id));
  }

  // ── Prototipos ───────────────────────────────────────────────────────

  private demoPrototype(): Prototype {
    return { id: DEMO_PROTOTYPE_ID, name: 'Tienda (demo)', createdAt: 0, source: 'folder', entryPath: '/index.html', url: `${this.base}prototipo/` };
  }

  async listPrototypes(): Promise<Prototype[]> {
    let own: Prototype[] = [];
    try {
      own = await panel<Prototype[]>(PROTOTYPES, 'readonly', (s) => s.getAll() as IDBRequest<Prototype[]>);
    } catch {
      /* nada subido */
    }
    const sessions = await this.listSessions();
    const count = (id: string): number => sessions.filter((s) => s.prototypeId === id).length;
    return [
      ...own.sort((a, b) => b.createdAt - a.createdAt).map((p) => ({ ...p, url: `${this.base}local/${p.id}/`, sessionCount: count(p.id) })),
      { ...this.demoPrototype(), sessionCount: count(DEMO_PROTOTYPE_ID) },
    ];
  }

  async uploadPrototype(file: File, opts: { name?: string; id?: string } = {}): Promise<Prototype> {
    await ensureServiceWorker(this.base);
    const { files, entryPath } = await unpack(file);
    const id = opts.id ?? createId('pr');
    const prev = opts.id ? await panel<Prototype | undefined>(PROTOTYPES, 'readonly', (s) => s.get(id)) : undefined;
    await this.removeFiles(id);
    const db = await openPanelDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FILES, 'readwrite');
      for (const f of files) tx.objectStore(FILES).put({ protoId: id, path: f.path, data: f.data } satisfies StoredFile);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const proto: Prototype = {
      id,
      name: opts.name || prev?.name || file.name.replace(/\.(zip|html?)$/i, '') || 'Prototipo',
      createdAt: prev?.createdAt ?? Date.now(),
      source: 'upload',
      entryPath,
    };
    await run(db, PROTOTYPES, 'readwrite', (s) => s.put(proto));
    return { ...proto, url: `${this.base}local/${id}/` };
  }

  private async removeFiles(id: string): Promise<void> {
    const keys = await panel<IDBValidKey[]>(FILES, 'readonly', (s) => s.index('byProto').getAllKeys(id));
    const db = await openPanelDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FILES, 'readwrite');
      for (const k of keys) tx.objectStore(FILES).delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deletePrototype(id: string): Promise<void> {
    if (id === DEMO_PROTOTYPE_ID) throw new Error('El prototipo de ejemplo no se puede borrar.');
    await this.removeFiles(id);
    await panel(PROTOTYPES, 'readwrite', (s) => s.delete(id));
    for (const s of (await this.listSessions()).filter((x) => x.prototypeId === id)) await this.deleteSession(s.id);
    for (const st of (await this.listStudies()).filter((x) => x.prototypeId === id)) await this.deleteStudy(st.id);
  }

  async listPrototypePages(prototypeId: string): Promise<PrototypePage[]> {
    if (prototypeId === DEMO_PROTOTYPE_ID) return this.fetchJson<PrototypePage[]>('demo/pages.json', []);
    try {
      const files = await panel<StoredFile[]>(FILES, 'readonly', (s) => s.index('byProto').getAll(prototypeId) as IDBRequest<StoredFile[]>);
      return files
        .filter((f) => /\.html?$/i.test(f.path))
        .map((f) => ({ path: f.path, title: htmlTitle(f.data) }))
        .sort((a, b) => (a.path === '/index.html' ? -1 : b.path === '/index.html' ? 1 : a.path.localeCompare(b.path)));
    } catch {
      return [];
    }
  }

  qrImageUrl(): null {
    return null;
  }
}

/** Registra el service worker que sirve los prototipos subidos. */
export async function ensureServiceWorker(base: string): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('Este navegador no soporta service workers; no se pueden subir prototipos en la demo.');
  const scope = base.endsWith('/') ? base : `${base}/`;
  const reg = await navigator.serviceWorker.register(`${scope}sw.js`, { scope });
  if (!reg.active) {
    await new Promise<void>((resolve) => {
      const worker = reg.installing ?? reg.waiting;
      if (!worker) return resolve();
      worker.addEventListener('statechange', () => worker.state === 'activated' && resolve());
    });
  }
}
