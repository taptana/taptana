/**
 * Modo demo (GitHub Pages): lee sesiones de JSON incluidos en el sitio y guarda lo que la
 * persona importa o crea (sesiones, estudios) en IndexedDB de su navegador.
 *
 *   <base>/demo/sessions.json      lista de SessionSummary
 *   <base>/demo/<id>.json          SessionExport de cada una
 *   <base>/demo/pages.json         páginas del prototipo de ejemplo
 */

import type {
  ManualResults,
  Prototype,
  ServerInfo,
  SessionEventsResponse,
  SessionExport,
  SessionSummary,
  Study,
  StudyRecord,
} from '@taptana/shared';
import type { ApiClient, PrototypePage } from './client.ts';

const DB_NAME = 'taptana-panel';
const SESSIONS = 'sessions';
const STUDIES = 'studies';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'session.id' });
      if (!db.objectStoreNames.contains(STUDIES)) db.createObjectStore(STUDIES, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(name: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(name, mode).objectStore(name));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function createId(prefix: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}_${out}`;
}

export class StaticClient implements ApiClient {
  readonly mode = 'static' as const;
  readonly canUpload = false;
  private readonly base: string;

  constructor(base: string) {
    this.base = base.endsWith('/') ? base : `${base}/`;
  }

  async info(): Promise<ServerInfo> {
    return { version: 'demo', participantUrl: `${location.origin}${this.base}prototipo/`, prototypeId: 'demo-tienda', prototypeName: 'tienda (demo)' };
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

  private async imported(): Promise<SessionExport[]> {
    try {
      return await withStore<SessionExport[]>(SESSIONS, 'readonly', (s) => s.getAll() as IDBRequest<SessionExport[]>);
    } catch {
      return [];
    }
  }

  async listSessions(studyId?: string): Promise<SessionSummary[]> {
    const [bundled, imported] = await Promise.all([this.fetchJson<SessionSummary[]>('demo/sessions.json', []), this.imported()]);
    const all = [...imported.map((i) => i.session), ...bundled.filter((b) => !imported.some((i) => i.session.id === b.id))];
    return all.filter((s) => !studyId || s.studyId === studyId).sort((a, b) => b.startedAt - a.startedAt);
  }

  async getSessionEvents(id: string): Promise<SessionEventsResponse | null> {
    const local = (await this.imported()).find((i) => i.session.id === id);
    if (local) return local;
    const data = await this.fetchJson<SessionExport | null>(`demo/${encodeURIComponent(id)}.json`, null);
    return data;
  }

  async importSession(data: SessionExport): Promise<void> {
    await withStore(SESSIONS, 'readwrite', (s) => s.put(data));
  }

  async deleteSession(id: string): Promise<void> {
    await withStore(SESSIONS, 'readwrite', (s) => s.delete(id));
  }

  async setManualResults(id: string, manual: ManualResults): Promise<SessionSummary> {
    const data = await this.getSessionEvents(id);
    if (!data) throw new Error('No existe la sesión');
    // En modo demo no recalculamos resultados: solo guardamos la marca junto a la sesión.
    const tasks = (data.session.tasks ?? []).map((t) => {
      const m = manual[t.taskId];
      return m ? { ...t, manual: m, outcome: m === 'success' ? ('success' as const) : ('failed' as const) } : t;
    });
    const updated: SessionExport = { ...data, v: 1, exportedAt: Date.now(), session: { ...data.session, tasks } };
    await withStore(SESSIONS, 'readwrite', (s) => s.put(updated));
    return updated.session;
  }

  async listStudies(): Promise<StudyRecord[]> {
    try {
      const list = await withStore<StudyRecord[]>(STUDIES, 'readonly', (s) => s.getAll() as IDBRequest<StudyRecord[]>);
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async getStudy(id: string): Promise<StudyRecord | null> {
    try {
      return (await withStore<StudyRecord | undefined>(STUDIES, 'readonly', (s) => s.get(id) as IDBRequest<StudyRecord | undefined>)) ?? null;
    } catch {
      return null;
    }
  }

  async saveStudy(study: Study, id?: string): Promise<StudyRecord> {
    const existing = id ? await this.getStudy(id) : null;
    const now = Date.now();
    const record: StudyRecord = { ...study, id: id ?? createId('st'), createdAt: existing?.createdAt ?? now, updatedAt: now };
    await withStore(STUDIES, 'readwrite', (s) => s.put(record));
    return record;
  }

  async deleteStudy(id: string): Promise<void> {
    await withStore(STUDIES, 'readwrite', (s) => s.delete(id));
  }

  listPrototypePages(): Promise<PrototypePage[]> {
    return this.fetchJson<PrototypePage[]>('demo/pages.json', []);
  }

  async listPrototypes(): Promise<Prototype[]> {
    return [{ id: 'demo-tienda', name: 'Tienda (demo)', createdAt: 0, source: 'upload', entryPath: '/index.html', url: `${this.base}prototipo/` }];
  }

  uploadPrototype(): Promise<Prototype> {
    return Promise.reject(new Error('En la demo no se suben archivos. Corre Taptana en tu computadora para probar tus propios prototipos.'));
  }

  deletePrototype(): Promise<void> {
    return Promise.reject(new Error('No disponible en la demo.'));
  }

  qrImageUrl(): null {
    return null;
  }
}
