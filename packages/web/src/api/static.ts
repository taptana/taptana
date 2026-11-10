/**
 * Modo demo (GitHub Pages). No hay servidor: todo vive en este navegador.
 *
 * - Ejemplo incluido en el sitio, bajo <base>demo/ (lo genera scripts/build-site.mjs):
 *     sessions.json    SessionSummary[] de las sesiones de ejemplo
 *     <id>.json        cada sesión completa (SessionExport)
 *     studies.json     estudios de ejemplo (v1 o v2; se normalizan aquí)
 *     pages.json       [{ path, title }] con los HTML del prototipo de ejemplo
 *     events.json      (opcional) { [sessionId]: eventos propios } para calcular el reporte sin
 *                      bajar cada sesión completa
 *   y el prototipo de ejemplo en <base>prototipo/ con el recorder en modo local.
 * - Prototipos subidos: archivos en IndexedDB, servidos por el service worker (sw.js) en
 *   <base>local/<id>/. Solo funcionan en este navegador.
 * - Sesiones grabadas en este navegador: el recorder (modo local) las guarda en la base
 *   "taptana" de este mismo origen; el panel las lee de ahí.
 * - Estudios, sesiones importadas y lo que el moderador anota de cada sesión (etiqueta, notas,
 *   exclusión, marcas): IndexedDB "taptana-panel".
 *
 * Los resultados, el reporte y el CSV se calculan con las mismas funciones puras de `shared`
 * que usa el servidor.
 */

import {
  EXAMPLE_PROTOTYPE_ID,
  EXAMPLE_PROTOTYPE_NAME,
  EXAMPLE_STUDY_ID,
  SESSION_LIMITS,
  batchesToExport,
  computeAnswers,
  computeStudyReport,
  computeTaskResults,
  countScreens,
  duplicateStudy,
  knownScreens,
  manualMarks,
  normalizeStudy,
  participantName,
  studyCsv,
  validateStudy,
  type EventBatch,
  type ExampleResponse,
  type ManualResults,
  type Prototype,
  type ReportFilter,
  type ReportSession,
  type ScreenInfo,
  type ServerInfo,
  type SessionEventsResponse,
  type SessionExport,
  type SessionPatch,
  type SessionSummary,
  type Study,
  type StudyRecord,
  type StudyReport,
  type TaptanaEvent,
} from '@taptana/shared';
import type { ApiClient, ManualMarks, PrototypePage } from './client.ts';
import { SessionExistsError, UserError } from '@/lib/errors';
import { idbAvailable, idbBatch, idbRequest, openDb } from '@/lib/idb';
import { htmlTitle, unpack } from '@/lib/unzip';

const PANEL_DB = 'taptana-panel';
const SESSIONS = 'sessions';
const STUDIES = 'studies';
const PROTOTYPES = 'prototypes';
const FILES = 'files';
/** Lo que el moderador anota de cada sesión. El almacén se llama 'manual' desde v0.3. */
const META = 'manual';

/** Ids que el prototipo de ejemplo tuvo en versiones anteriores de la demo. */
const EXAMPLE_ALIASES = new Set(['demo-tienda', EXAMPLE_PROTOTYPE_ID]);

/** Qué hacer cuando el navegador no deja guardar: el problema no es el archivo. */
const BLOCKED_FIX = 'No es un problema de tu archivo. Abre esta página en Chrome o Safari, en una ventana normal, o corre Taptana en tu computadora con «pnpm start».';
const NO_STORAGE = `Tu navegador bloqueó el almacenamiento que la demo necesita para guardar prototipos, estudios y sesiones. Pasa en ventanas privadas y en navegadores que se abren dentro de otra app (Instagram, WhatsApp, correo). ${BLOCKED_FIX}`;
const NO_SERVICE_WORKER = `Tu navegador bloqueó una función («service worker») que la demo necesita para mostrar un prototipo subido. Pasa en ventanas privadas y en navegadores que se abren dentro de otra app (Instagram, WhatsApp, correo). ${BLOCKED_FIX}`;

/** ¿El navegador ofrece service workers? En algunos contextos, solo preguntar ya lanza un error. */
function serviceWorkerAvailable(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && Boolean(navigator.serviceWorker) && window.isSecureContext !== false;
  } catch {
    return false;
  }
}

function panelDb(): Promise<IDBDatabase> {
  if (!idbAvailable()) return Promise.reject(new UserError(NO_STORAGE));
  return openDb(PANEL_DB, 3, (db) => {
    if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'session.id' });
    if (!db.objectStoreNames.contains(STUDIES)) db.createObjectStore(STUDIES, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(PROTOTYPES)) db.createObjectStore(PROTOTYPES, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: ['protoId', 'path'] }).createIndex('byProto', 'protoId');
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'sessionId' });
  });
}

/** La base del recorder (modo local). Se abre con su mismo esquema para no estorbarle. */
function recorderDb(): Promise<IDBDatabase> {
  if (!idbAvailable()) return Promise.reject(new UserError(NO_STORAGE));
  return openDb('taptana', 1, (db) => {
    if (!db.objectStoreNames.contains('batches')) {
      db.createObjectStore('batches', { keyPath: ['sessionId', 'pageId', 'seq'] }).createIndex('bySession', 'sessionId', { unique: false });
    }
  });
}

async function panel<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idbRequest(await panelDb(), store, mode, fn);
}

/** Lectura que no debe tumbar la pantalla: si el navegador no deja leer, devuelve `fallback`. */
async function read<T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>, fallback: T): Promise<T> {
  try {
    return (await panel(store, 'readonly', fn)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Escritura: si falla, explica por qué en español. */
async function write<T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  try {
    return await panel(store, 'readwrite', fn);
  } catch (e) {
    if (e instanceof UserError) throw e;
    const name = (e as { name?: string } | null)?.name;
    if (name === 'QuotaExceededError') throw new UserError('Este navegador se quedó sin espacio para guardar. Borra prototipos o sesiones que ya no uses e intenta de nuevo.');
    throw new UserError(NO_STORAGE);
  }
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

/** Lo que el moderador anotó de una sesión (y si borró una de las de ejemplo). */
/** Marcas guardadas: null es "se quitó la marca" (tapa la que traiga una sesión de ejemplo). */
type StoredMarks = Record<string, 'success' | 'failure' | null>;

interface SessionMeta {
  sessionId: string;
  manual?: StoredMarks;
  label?: string;
  notes?: string;
  excluded?: boolean;
  deleted?: boolean;
}

/** Un estudio guardado, o la marca de que se borró uno de los de ejemplo. */
type StoredStudy = StudyRecord | { id: string; deleted: true };
const isDeleted = (s: StoredStudy): s is { id: string; deleted: true } => (s as { deleted?: boolean }).deleted === true;

/** Una sesión con lo necesario para calcular resultados, sin los eventos de rrweb. */
interface Light {
  session: SessionSummary;
  own: TaptanaEvent[];
  /** El estudio que venía dentro del archivo, por si aquí ya no existe. */
  study?: StudyRecord;
  origin: 'bundled' | 'imported' | 'recorded';
}

const ownOnly = (events: readonly TaptanaEvent[]): TaptanaEvent[] => events.filter((e) => e && e.kind === 'taptana');
const canonProto = (id: string): string => (EXAMPLE_ALIASES.has(id) ? EXAMPLE_PROTOTYPE_ID : id);

function embeddedStudy(raw: unknown): StudyRecord | undefined {
  if (typeof raw !== 'object' || raw === null || typeof (raw as { id?: unknown }).id !== 'string') return undefined;
  try {
    const r = raw as StudyRecord;
    return normalizeStudy({ ...r, id: r.id, createdAt: r.createdAt ?? 0, updatedAt: r.updatedAt ?? 0 });
  } catch {
    return undefined;
  }
}

export class StaticClient implements ApiClient {
  readonly mode = 'static' as const;
  readonly canUpload = true;
  readonly canServeAtRoot = false;
  private readonly base: string;
  private bundledCache: Promise<Light[]> | null = null;
  private demoStudiesCache: Promise<StudyRecord[]> | null = null;

  constructor(base: string) {
    this.base = base.endsWith('/') ? base : `${base}/`;
  }

  async uploadProblem(): Promise<string | null> {
    if (!serviceWorkerAvailable()) return NO_SERVICE_WORKER;
    try {
      // Abrir la base no basta: en algunos navegadores abre pero no deja leer.
      const db = await panelDb();
      await idbRequest(db, PROTOTYPES, 'readonly', (s) => s.count());
    } catch {
      return NO_STORAGE;
    }
    return null;
  }

  async info(): Promise<ServerInfo> {
    return {
      version: 'demo',
      participantUrl: `${location.origin}${this.base}`,
      prototypeId: EXAMPLE_PROTOTYPE_ID,
      prototypeName: EXAMPLE_PROTOTYPE_NAME,
      mode: 'demo',
      exampleLoaded: true,
    };
  }

  async loadExample(): Promise<ExampleResponse> {
    const demo = await this.demoStudies();
    const study = demo.find((s) => s.id === EXAMPLE_STUDY_ID) ?? demo[0];
    const studyId = study?.id ?? EXAMPLE_STUDY_ID;
    // Si se había borrado el estudio de ejemplo, vuelve.
    const stored = await read<StoredStudy | undefined>(STUDIES, (s) => s.get(studyId) as IDBRequest<StoredStudy | undefined>, undefined);
    if (stored && isDeleted(stored)) await write(STUDIES, (s) => s.delete(studyId));
    return { prototypeId: EXAMPLE_PROTOTYPE_ID, studyId };
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

  /** Sesiones de ejemplo incluidas en el sitio, con sus eventos propios. Se bajan una vez. */
  private bundled(): Promise<Light[]> {
    this.bundledCache ??= (async () => {
      const [summaries, events] = await Promise.all([
        this.fetchJson<SessionSummary[]>('demo/sessions.json', []),
        this.fetchJson<Record<string, TaptanaEvent[]> | null>('demo/events.json', null),
      ]);
      const list = Array.isArray(summaries) ? summaries.filter((s) => s && typeof s.id === 'string') : [];
      return Promise.all(
        list.map(async (summary): Promise<Light> => {
          const session = { ...summary, prototypeId: EXAMPLE_PROTOTYPE_ID };
          const light = events?.[summary.id];
          if (Array.isArray(light)) return { session, own: ownOnly(light), origin: 'bundled' };
          const full = await this.fetchJson<SessionExport | null>(`demo/${encodeURIComponent(summary.id)}.json`, null);
          const study = embeddedStudy(full?.study);
          return { session, own: ownOnly(full?.events ?? []), origin: 'bundled', ...(study ? { study } : {}) };
        }),
      );
    })();
    return this.bundledCache;
  }

  private imported(): Promise<SessionExport[]> {
    return read<SessionExport[]>(SESSIONS, (s) => s.getAll() as IDBRequest<SessionExport[]>, []);
  }

  /** Sesiones grabadas en este navegador (recorder en modo local). */
  private async recorded(): Promise<SessionExport[]> {
    let batches: EventBatch[] = [];
    try {
      batches = await idbRequest<EventBatch[]>(await recorderDb(), 'batches', 'readonly', (s) => s.getAll() as IDBRequest<EventBatch[]>);
    } catch {
      return [];
    }
    const bySession = new Map<string, EventBatch[]>();
    for (const b of batches) {
      if (!b || typeof b.sessionId !== 'string') continue;
      const list = bySession.get(b.sessionId);
      if (list) list.push(b);
      else bySession.set(b.sessionId, [b]);
    }
    const out: SessionExport[] = [];
    for (const list of bySession.values()) {
      list.sort((a, b) => a.sentAt - b.sentAt || a.seq - b.seq);
      const data = batchesToExport(list);
      if (data) out.push(data);
    }
    return out;
  }

  private toLight(data: SessionExport, origin: Light['origin']): Light {
    const study = embeddedStudy(data.study);
    return { session: { ...data.session, prototypeId: canonProto(data.session.prototypeId) }, own: ownOnly(data.events), origin, ...(study ? { study } : {}) };
  }

  private async metas(): Promise<Map<string, SessionMeta>> {
    const list = await read<SessionMeta[]>(META, (s) => s.getAll() as IDBRequest<SessionMeta[]>, []);
    return new Map(list.map((m) => [m.sessionId, m]));
  }

  /** Estudios por id, para ligar sesiones (los guardados aquí y los de ejemplo). */
  private async studyMap(): Promise<Map<string, StudyRecord>> {
    return new Map((await this.listStudies()).map((s) => [s.id, s]));
  }

  /** Completa el resumen: estudio, resultados por tarea, respuestas y lo que anotó el moderador. */
  private hydrate(light: Light, studies: Map<string, StudyRecord>, meta: SessionMeta | undefined): { session: SessionSummary; study?: StudyRecord; manual: ManualResults } {
    const session: SessionSummary = { ...light.session };
    const start = light.own.find((e) => e.kind === 'taptana' && e.type === 'study' && e.action === 'start');
    if (start && start.kind === 'taptana' && start.type === 'study') {
      session.studyId = start.studyId;
      if (start.variantId) session.variantId = start.variantId;
    }
    const study = session.studyId ? (studies.get(session.studyId) ?? light.study) : undefined;
    // Una marca guardada como null es "quitar la marca": tapa la que traiga la sesión de ejemplo.
    const manual: ManualResults = { ...manualMarks(session.tasks) };
    for (const [taskId, value] of Object.entries(meta?.manual ?? {})) {
      if (value === 'success' || value === 'failure') manual[taskId] = value;
      else delete manual[taskId];
    }
    if (study) {
      session.tasks = computeTaskResults(study, light.own, manual, session.lastSeenAt);
      session.answers = computeAnswers(study, light.own);
    } else {
      delete session.tasks;
    }
    const screens = countScreens(light.own);
    if (screens > 0) session.screenCount = screens;
    const who = participantName(light.own);
    if (who) session.participant = who;
    if (meta) {
      for (const key of ['label', 'notes'] as const) {
        if (meta[key] !== undefined) {
          if (meta[key]) session[key] = meta[key] as string;
          else delete session[key];
        }
      }
      if (meta.excluded !== undefined) session.excluded = meta.excluded;
    }
    return { session, manual, ...(study ? { study } : {}) };
  }

  /** Todas las sesiones visibles (las propias tapan a las de ejemplo con el mismo id). */
  private async lights(): Promise<{ lights: Light[]; metas: Map<string, SessionMeta> }> {
    const [bundled, imported, recorded, metas] = await Promise.all([this.bundled(), this.imported(), this.recorded(), this.metas()]);
    const byId = new Map<string, Light>();
    for (const l of bundled) if (!metas.get(l.session.id)?.deleted) byId.set(l.session.id, l);
    for (const d of imported) byId.set(d.session.id, this.toLight(d, 'imported'));
    for (const d of recorded) byId.set(d.session.id, this.toLight(d, 'recorded'));
    return { lights: [...byId.values()], metas };
  }

  private async hydrated(studyId?: string): Promise<Array<ReturnType<StaticClient['hydrate']> & { light: Light }>> {
    const [{ lights, metas }, studies] = await Promise.all([this.lights(), this.studyMap()]);
    return lights
      .map((light) => ({ ...this.hydrate(light, studies, metas.get(light.session.id)), light }))
      .filter((h) => !studyId || h.session.studyId === studyId);
  }

  async listSessions(studyId?: string): Promise<SessionSummary[]> {
    return (await this.hydrated(studyId)).map((h) => h.session).sort((a, b) => b.startedAt - a.startedAt);
  }

  async getSessionEvents(id: string): Promise<SessionEventsResponse | null> {
    const [imported, recorded, metas, studies] = await Promise.all([this.imported(), this.recorded(), this.metas(), this.studyMap()]);
    let data: SessionExport | null = recorded.find((d) => d.session.id === id) ?? imported.find((d) => d.session.id === id) ?? null;
    let origin: Light['origin'] = 'imported';
    if (!data) {
      if (metas.get(id)?.deleted) return null;
      if (!(await this.bundled()).some((l) => l.session.id === id)) return null;
      data = await this.fetchJson<SessionExport | null>(`demo/${encodeURIComponent(id)}.json`, null);
      if (!data || !data.session || !Array.isArray(data.events)) return null;
      data = { ...data, session: { ...data.session, prototypeId: EXAMPLE_PROTOTYPE_ID } };
      origin = 'bundled';
    }
    const { session, study } = this.hydrate(this.toLight(data, origin), studies, metas.get(id));
    return { session, pages: data.pages ?? [], events: data.events, ...(study ? { study } : {}) };
  }

  async importSession(data: SessionExport, opts: { replace?: boolean } = {}): Promise<{ id: string; replaced: boolean }> {
    const id = data.session.id;
    const exists = (await this.lights()).lights.some((l) => l.session.id === id);
    if (exists && !opts.replace) throw new SessionExistsError(id);
    await write(SESSIONS, (s) => s.put(data));
    // Una sesión de ejemplo borrada que se vuelve a importar deja de estar oculta.
    const meta = (await this.metas()).get(id);
    if (meta?.deleted) await write(META, (s) => s.put({ ...meta, deleted: false }));
    return { id, replaced: exists };
  }

  async deleteSession(id: string): Promise<void> {
    await write(SESSIONS, (s) => s.delete(id));
    try {
      const db = await recorderDb();
      const keys = await idbRequest<IDBValidKey[]>(db, 'batches', 'readonly', (s) => s.index('bySession').getAllKeys(id));
      if (keys.length) await idbBatch(db, 'batches', (s) => keys.forEach((k) => s.delete(k)));
    } catch {
      /* nada grabado aquí */
    }
    if ((await this.bundled()).some((l) => l.session.id === id)) await write(META, (s) => s.put({ sessionId: id, deleted: true } satisfies SessionMeta));
    else await write(META, (s) => s.delete(id));
  }

  async patchSession(id: string, patch: SessionPatch): Promise<SessionSummary> {
    const prev = (await this.metas()).get(id) ?? { sessionId: id };
    const next: SessionMeta = { ...prev };
    if (patch.manual) {
      const marks: StoredMarks = { ...(prev.manual ?? {}) };
      // null (o cualquier otra cosa) quita la marca: la tarea vuelve a "por revisar".
      for (const [taskId, value] of Object.entries(patch.manual as Record<string, unknown>)) marks[taskId] = value === 'success' || value === 'failure' ? value : null;
      next.manual = marks;
    }
    if (patch.label !== undefined) next.label = patch.label.trim().slice(0, SESSION_LIMITS.label);
    if (patch.notes !== undefined) next.notes = patch.notes.slice(0, SESSION_LIMITS.notes);
    if (patch.excluded !== undefined) next.excluded = patch.excluded;
    await write(META, (s) => s.put(next));
    const session = (await this.hydrated()).find((h) => h.session.id === id)?.session;
    if (!session) throw new UserError('Esta sesión ya no existe. Puede que se haya borrado.', 404);
    return session;
  }

  setManualResults(id: string, manual: ManualMarks): Promise<SessionSummary> {
    return this.patchSession(id, { manual: manual as SessionPatch['manual'] });
  }

  // ── Estudios ─────────────────────────────────────────────────────────

  /** Estudios de ejemplo incluidos en el sitio, ya en v2 y apuntando al prototipo de ejemplo. */
  private demoStudies(): Promise<StudyRecord[]> {
    this.demoStudiesCache ??= this.fetchJson<unknown[]>('demo/studies.json', []).then((list) =>
      (Array.isArray(list) ? list : [])
        .map(embeddedStudy)
        .filter((s): s is StudyRecord => s !== undefined)
        .map((s) => ({ ...s, prototypeId: canonProto(s.prototypeId) })),
    );
    return this.demoStudiesCache;
  }

  private storedStudies(): Promise<StoredStudy[]> {
    return read<StoredStudy[]>(STUDIES, (s) => s.getAll() as IDBRequest<StoredStudy[]>, []);
  }

  async listStudies(): Promise<StudyRecord[]> {
    const [stored, demo] = await Promise.all([this.storedStudies(), this.demoStudies()]);
    const taken = new Set(stored.map((s) => s.id));
    const own = stored.filter((s): s is StudyRecord => !isDeleted(s)).map((s) => embeddedStudy(s) ?? s);
    return [...own, ...demo.filter((d) => !taken.has(d.id))].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getStudy(id: string): Promise<StudyRecord | null> {
    return (await this.listStudies()).find((s) => s.id === id) ?? null;
  }

  async saveStudy(study: Study, id?: string): Promise<StudyRecord> {
    const result = validateStudy(study);
    if (!result.ok) throw new UserError(result.error, 400);
    const existing = id ? await this.getStudy(id) : null;
    if (id && !existing) throw new UserError('Este estudio ya no existe. Puede que se haya borrado.', 404);
    const now = Date.now();
    const record: StudyRecord = { ...result.value, id: id ?? createId('st'), createdAt: existing?.createdAt ?? now, updatedAt: now };
    await write(STUDIES, (s) => s.put(record));
    return record;
  }

  async deleteStudy(id: string): Promise<void> {
    if ((await this.demoStudies()).some((s) => s.id === id)) await write(STUDIES, (s) => s.put({ id, deleted: true } satisfies StoredStudy));
    else await write(STUDIES, (s) => s.delete(id));
  }

  async duplicateStudy(id: string): Promise<StudyRecord> {
    const study = await this.getStudy(id);
    if (!study) throw new UserError('Este estudio ya no existe. Puede que se haya borrado.', 404);
    const now = Date.now();
    const record: StudyRecord = { ...duplicateStudy(study), id: createId('st'), createdAt: now, updatedAt: now };
    await write(STUDIES, (s) => s.put(record));
    return record;
  }

  private async reportSessions(studyId: string): Promise<ReportSession[]> {
    return (await this.hydrated(studyId)).map((h) => ({ session: h.session, events: h.light.own, manual: h.manual }));
  }

  async getStudyReport(id: string, filter?: ReportFilter): Promise<StudyReport | null> {
    const study = await this.getStudy(id);
    if (!study) return null;
    return computeStudyReport(study, await this.reportSessions(id), filter);
  }

  async exportStudyCsv(id: string): Promise<string | null> {
    const study = await this.getStudy(id);
    if (!study) return null;
    return studyCsv(study, await this.reportSessions(id));
  }

  // ── Prototipos ───────────────────────────────────────────────────────

  private examplePrototype(): Prototype {
    return { id: EXAMPLE_PROTOTYPE_ID, name: EXAMPLE_PROTOTYPE_NAME, createdAt: 0, source: 'folder', entryPath: '/index.html', url: `${this.base}prototipo/` };
  }

  private ownPrototypes(): Promise<Prototype[]> {
    return read<Prototype[]>(PROTOTYPES, (s) => s.getAll() as IDBRequest<Prototype[]>, []);
  }

  async listPrototypes(): Promise<Prototype[]> {
    const [own, sessions] = await Promise.all([this.ownPrototypes(), this.listSessions()]);
    const counts = new Map<string, number>();
    for (const s of sessions) counts.set(s.prototypeId, (counts.get(s.prototypeId) ?? 0) + 1);
    const count = (id: string): number => counts.get(id) ?? 0;
    const known = new Set([EXAMPLE_PROTOTYPE_ID, ...own.map((p) => p.id)]);
    // Sesiones importadas de un prototipo que no está en este navegador.
    const foreign = [...counts.keys()].filter((id) => !known.has(id)).map((id): Prototype => ({ id, name: 'Importado', createdAt: 0, sessionCount: count(id) }));
    return [
      ...own.sort((a, b) => b.createdAt - a.createdAt).map((p) => ({ ...p, url: `${this.base}local/${p.id}/`, sessionCount: count(p.id) })),
      { ...this.examplePrototype(), sessionCount: count(EXAMPLE_PROTOTYPE_ID) },
      ...foreign,
    ];
  }

  async uploadPrototype(file: File, opts: { name?: string; id?: string } = {}): Promise<Prototype> {
    const problem = await this.uploadProblem();
    if (problem) throw new UserError(problem);
    await ensureServiceWorker(this.base);
    let unpacked: Awaited<ReturnType<typeof unpack>>;
    try {
      unpacked = await unpack(file);
    } catch (e) {
      throw new UserError(e instanceof Error && e.message ? e.message : 'No se pudo leer el archivo.');
    }
    const { files, entryPath } = unpacked;
    const id = opts.id ?? createId('pr');
    const prev = opts.id ? (await this.ownPrototypes()).find((p) => p.id === id) : undefined;
    if (opts.id && !prev) throw new UserError('Este prototipo ya no existe en este navegador.', 404);
    const entry = files.find((f) => f.path === entryPath);
    const absoluteUrls = entry ? /\s(?:src|href|action)\s*=\s*["']\/(?!\/)/i.test(new TextDecoder().decode(entry.data.subarray(0, 200_000))) : false;
    try {
      await this.removeFiles(id);
      await idbBatch(await panelDb(), FILES, (s) => {
        for (const f of files) s.put({ protoId: id, path: f.path, data: f.data } satisfies StoredFile);
      });
    } catch (e) {
      if (e instanceof UserError) throw e;
      throw new UserError(
        (e as { name?: string } | null)?.name === 'QuotaExceededError'
          ? 'El prototipo no cabe en el espacio que este navegador le da a la demo. Prueba con un zip más liviano o corre Taptana en tu computadora.'
          : NO_STORAGE,
      );
    }
    const proto: Prototype = {
      id,
      name: (opts.name || prev?.name || file.name.replace(/\.(zip|html?)$/i, '') || 'Prototipo').slice(0, 120),
      createdAt: prev?.createdAt ?? Date.now(),
      source: 'upload',
      entryPath,
      ...(absoluteUrls ? { absoluteUrls: true } : {}),
    };
    await write(PROTOTYPES, (s) => s.put(proto));
    return { ...proto, url: `${this.base}local/${id}/` };
  }

  private async removeFiles(id: string): Promise<void> {
    const db = await panelDb();
    const keys = await idbRequest<IDBValidKey[]>(db, FILES, 'readonly', (s) => s.index('byProto').getAllKeys(id));
    if (keys.length) await idbBatch(db, FILES, (s) => keys.forEach((k) => s.delete(k)));
  }

  async renamePrototype(id: string, name: string): Promise<Prototype> {
    const clean = name.trim();
    if (!clean) throw new UserError('Ponle un nombre al prototipo.', 400);
    if (clean.length > 120) throw new UserError('El nombre no puede pasar de 120 caracteres.', 400);
    const proto = (await this.ownPrototypes()).find((p) => p.id === id);
    if (!proto) throw new UserError(id === EXAMPLE_PROTOTYPE_ID ? 'El prototipo de ejemplo no se puede renombrar.' : 'Este prototipo ya no existe en este navegador.', 400);
    const next = { ...proto, name: clean };
    await write(PROTOTYPES, (s) => s.put(next));
    return { ...next, url: `${this.base}local/${id}/` };
  }

  async setPrototypeRoot(): Promise<Prototype> {
    throw new UserError('«Abrir en la raíz» solo existe cuando corres Taptana en tu computadora.', 400);
  }

  async deletePrototype(id: string): Promise<void> {
    if (id === EXAMPLE_PROTOTYPE_ID) throw new UserError('El prototipo de ejemplo viene con la demo y no se puede borrar.', 400);
    for (const s of (await this.listSessions()).filter((x) => x.prototypeId === id)) await this.deleteSession(s.id);
    for (const st of (await this.listStudies()).filter((x) => x.prototypeId === id)) await this.deleteStudy(st.id);
    try {
      await this.removeFiles(id);
    } catch {
      /* sin archivos */
    }
    await write(PROTOTYPES, (s) => s.delete(id));
  }

  async listPrototypePages(prototypeId: string): Promise<PrototypePage[]> {
    if (prototypeId === EXAMPLE_PROTOTYPE_ID) {
      const pages = await this.fetchJson<PrototypePage[]>('demo/pages.json', []);
      return Array.isArray(pages) ? pages : [];
    }
    try {
      const files = await idbRequest<StoredFile[]>(await panelDb(), FILES, 'readonly', (s) => s.index('byProto').getAll(prototypeId) as IDBRequest<StoredFile[]>);
      return files
        .filter((f) => /\.html?$/i.test(f.path))
        .map((f) => ({ path: f.path, title: htmlTitle(f.data) }))
        .sort((a, b) => (a.path === '/index.html' ? -1 : b.path === '/index.html' ? 1 : a.path.localeCompare(b.path)));
    } catch {
      return [];
    }
  }

  async listPrototypeScreens(prototypeId: string): Promise<ScreenInfo[]> {
    const [pages, { lights }] = await Promise.all([this.listPrototypePages(prototypeId), this.lights()]);
    const events = lights.filter((l) => l.session.prototypeId === prototypeId).flatMap((l) => l.own.filter((e) => e.kind === 'taptana' && e.type === 'navigation'));
    return knownScreens(pages, events);
  }

  /** En la demo el link solo sirve en este navegador: un QR no ayudaría. */
  qrImageUrl(): null {
    return null;
  }
}

/** Registra el service worker que sirve los prototipos subidos (y el estudio al recorder). */
export async function ensureServiceWorker(base: string): Promise<void> {
  if (!serviceWorkerAvailable()) throw new UserError(NO_SERVICE_WORKER);
  const scope = base.endsWith('/') ? base : `${base}/`;
  let reg: ServiceWorkerRegistration;
  try {
    reg = await navigator.serviceWorker.register(`${scope}sw.js`, { scope });
  } catch {
    throw new UserError(NO_SERVICE_WORKER);
  }
  if (reg.active) return;
  await new Promise<void>((resolve, reject) => {
    const worker = reg.installing ?? reg.waiting;
    if (!worker) return resolve();
    const timer = setTimeout(() => reject(new UserError('La demo no terminó de prepararse en este navegador. Recarga la página e intenta de nuevo.')), 10_000);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        clearTimeout(timer);
        resolve();
      } else if (worker.state === 'redundant') {
        clearTimeout(timer);
        reject(new UserError(NO_SERVICE_WORKER));
      }
    });
  });
}
