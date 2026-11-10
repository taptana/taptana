/**
 * API bajo /api/v1.
 *
 * Públicas (las usa el recorder del participante, quizá desde otro origen; responden CORS *):
 *   POST /events          lotes de eventos
 *   GET  /studies/:id     el estudio que va a hacer
 * Todo lo demás pasa por la guardia del panel (ver panel-guard.ts). `GET /info` responde a
 * cualquiera, pero solo con la versión si no pasó la guardia.
 *
 * Datos inválidos → 400 con un mensaje en español; cuerpo demasiado grande → 413.
 */

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import {
  API_PREFIX,
  EVENTS_BODY_MAX_BYTES,
  LOCAL_PROTOTYPE_ID,
  PANEL_PATH,
  STUDY_LIMITS,
  UPLOADED_PATH,
  computeStudyReport,
  studyCsv,
  validateEventBatch,
  validateSessionExport,
  validateSessionPatch,
  validateStudy,
  type ApiError,
  type EventBatchResponse,
  type ExampleResponse,
  type Prototype,
  type PrototypeListResponse,
  type PrototypePagesResponse,
  type PrototypeScreensResponse,
  type ReportFilter,
  type ServerInfo,
  type SessionExport,
  type SessionListResponse,
  type StudyListResponse,
} from '@taptana/shared';
import { ExampleError, exampleLoaded, loadExample } from '../example.js';
import { isLoopback } from '../network.js';
import type { PanelGuard } from '../panel-guard.js';
import { PANEL_KEY_PARAM } from '../panel-guard.js';
import { listPrototypePages } from '../prototype-pages.js';
import type { ListSessionsFilter, Store } from '../store/store.js';
import { extractUpload, MAX_UPLOAD_BYTES, prototypeDir as uploadedDir, removePrototypeFiles, UploadError } from '../uploads.js';
import { VERSION } from '../version.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function newPrototypeId(): string {
  let out = '';
  for (const b of randomBytes(8)) out += ALPHABET[b % ALPHABET.length];
  return `pr_${out}`;
}

/** Los prototipos subidos viven en carpetas con este nombre: nada más llega al disco. */
export const UPLOADED_ID = /^pr_[A-Za-z0-9]+$/;

const KB = 1024;
const MB = 1024 * KB;
/** Un estudio con 100 bloques y todos sus textos al tope pesa mucho menos que esto. */
const STUDY_MAX_BYTES = 1 * MB;
/** Cambios de una sesión o de un prototipo: unas notas y poco más. */
const PATCH_MAX_BYTES = 64 * KB;
/** Una sesión exportada trae toda su grabación; las largas pesan decenas de MB. */
const IMPORT_MAX_BYTES = 64 * MB;

const INVALID_JSON = 'El cuerpo de la petición no es JSON válido.';
const NO_SESSION = 'No existe esta sesión.';
const NO_STUDY = 'No existe este estudio.';
const NO_PROTOTYPE = 'No existe este prototipo.';
const STUDY_PROTOTYPE_MISSING = 'Ese prototipo no existe aquí. Elige uno de tus prototipos para este estudio.';

export interface ApiOptions {
  store: Store;
  guard: PanelGuard;
  /** Carpeta del prototipo local, para listar sus páginas. */
  prototypeDir?: string;
  /** Carpeta de datos: los prototipos subidos viven en <dataDir>/prototypes/<id>/. */
  dataDir?: string;
  /** Datos del servidor para el panel (link del participante, nombre del prototipo). */
  info?: ServerInfo | (() => ServerInfo);
  /** Dirección pública fija (`TAPTANA_PUBLIC_URL`). Gana sobre lo que se deduce de la petición. */
  publicUrl?: string;
  /** De dónde sale el ejemplo. Por defecto, del paquete. */
  exampleDir?: string;
  seedDir?: string;
}

function limit(maxSize: number, message: string): MiddlewareHandler {
  return bodyLimit({ maxSize, onError: (c) => c.json<ApiError>({ error: message }, 413) });
}

async function readJson(c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

/** "Compra en Verde" → "compra-en-verde": para nombres de archivo de descarga. */
export function fileSlug(value: string, max = 60): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

function hostNameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(1, Math.max(1, host.indexOf(']')));
  const colon = host.lastIndexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

export function apiRoutes({ store, guard, prototypeDir, dataDir, info, publicUrl, exampleDir, seedDir }: ApiOptions): Hono {
  const api = new Hono();

  // ── Quién entra ──────────────────────────────────────────────────────
  const publicCors = cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], maxAge: 86400 });
  api.use('*', async (c, next) => {
    const path = c.req.path.startsWith(API_PREFIX) ? c.req.path.slice(API_PREFIX.length) : c.req.path;
    const method = c.req.method;
    const read = method === 'GET' || method === 'HEAD';
    if (path === '/events' && (method === 'POST' || method === 'OPTIONS')) return publicCors(c, next);
    if (/^\/studies\/[^/]+$/.test(path) && (read || method === 'OPTIONS')) return publicCors(c, next);
    if (path === '/info' && read) return next(); // decide la propia ruta cuánto contar
    return guard.api(c, next);
  });

  // ── Datos del servidor ───────────────────────────────────────────────
  /**
   * La dirección que sirve desde otro dispositivo. Si la petición llegó por un proxy o un túnel
   * (Codespaces, ngrok), es la dirección pública de ese túnel; si no, la IP de la red local
   * que detectó el CLI.
   */
  const publicBase = (c: Context, configured: string): string => {
    if (publicUrl) return publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`;
    const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
    const proxied = proto !== undefined || c.req.header('x-forwarded-for') !== undefined || c.req.header('x-forwarded-host') !== undefined;
    const host = (c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '').split(',')[0]?.trim() ?? '';
    if (proxied && host && !isLoopback(hostNameOf(host)) && hostNameOf(host) !== 'localhost') return `${proto ?? 'https'}://${host}/`;
    if (configured) return configured;
    const url = new URL(c.req.url);
    return `${url.protocol}//${url.host}/`;
  };

  api.get('/info', (c) => {
    const base = typeof info === 'function' ? info() : info;
    const version = base?.version ?? VERSION;
    c.header('cache-control', 'no-store');
    // Quien no pasó la guardia (un participante, otra página web) solo se entera de la versión.
    if (!guard.allows(c)) return c.json({ version, mode: 'local' as const });
    const participantUrl = publicBase(c, base?.participantUrl ?? '');
    const full: ServerInfo = {
      version,
      participantUrl,
      prototypeId: base?.prototypeId ?? (prototypeDir ? LOCAL_PROTOTYPE_ID : ''),
      prototypeName: base?.prototypeName ?? '',
      mode: 'local',
      exampleLoaded: exampleLoaded(store),
    };
    // El link con la llave solo se le dice a quien está en la computadora de Taptana.
    if (guard.isLocal(c)) {
      const url = new URL(PANEL_PATH, participantUrl);
      if (guard.key && !guard.open) url.searchParams.set(PANEL_KEY_PARAM, guard.key);
      full.panelKeyUrl = url.toString();
    }
    return c.json<ServerInfo>(full);
  });

  // ── Eventos ──────────────────────────────────────────────────────────
  const warned = new Set<string>();
  api.post('/events', limit(EVENTS_BODY_MAX_BYTES, 'El lote pesa más de 16 MB.'), async (c) => {
    const body = await readJson(c);
    if (!body.ok) return c.json<ApiError>({ error: INVALID_JSON }, 400);
    const result = validateEventBatch(body.value);
    if (!result.ok) return c.json<ApiError>({ error: result.error }, 400);
    if (result.dropped && !warned.has(result.value.sessionId) && warned.size < 1000) {
      // Un recorder más nuevo que este servidor manda tipos de evento que aquí no se conocen.
      warned.add(result.value.sessionId);
      console.warn(`  aviso: se descartaron ${result.dropped} eventos que esta versión no entiende (sesión ${result.value.sessionId})`);
    }
    const { received } = store.ingestBatch(result.value);
    return c.json<EventBatchResponse>({ ok: true, received });
  });

  // ── Sesiones ─────────────────────────────────────────────────────────
  api.get('/sessions', (c) => {
    const filter: ListSessionsFilter = {};
    const prototypeId = c.req.query('prototype');
    const studyId = c.req.query('study');
    if (prototypeId) filter.prototypeId = prototypeId;
    if (studyId) filter.studyId = studyId;
    return c.json<SessionListResponse>({ sessions: store.listSessions(filter) });
  });

  api.get('/sessions/:id', (c) => {
    const session = store.getSession(c.req.param('id'));
    if (!session) return c.json<ApiError>({ error: NO_SESSION }, 404);
    return c.json(session);
  });

  api.get('/sessions/:id/events', (c) => {
    const data = store.getSessionEvents(c.req.param('id'));
    if (!data) return c.json<ApiError>({ error: NO_SESSION }, 404);
    return c.json(data);
  });

  /** Descarga la sesión en el mismo formato que exporta el recorder local. */
  api.get('/sessions/:id/export', (c) => {
    const data = store.getSessionEvents(c.req.param('id'));
    if (!data) return c.json<ApiError>({ error: NO_SESSION }, 404);
    const file: SessionExport = { v: 1, exportedAt: Date.now(), ...data };
    const who = fileSlug(data.session.label ?? data.session.participant ?? '', 40) || fileSlug(data.session.id, 40) || 'sesion';
    const day = new Date(data.session.startedAt).toISOString().slice(0, 10);
    c.header('content-disposition', `attachment; filename="taptana-${who}-${day}.json"`);
    return c.json(file);
  });

  /**
   * Importa un archivo exportado (modo local, o de otra instalación). Si la sesión ya existe
   * responde 409; con `?replace=1` la reemplaza.
   */
  api.post('/sessions/import', limit(IMPORT_MAX_BYTES, 'El archivo de la sesión pesa más de 64 MB.'), async (c) => {
    const body = await readJson(c);
    if (!body.ok) return c.json<ApiError>({ error: 'Este archivo no es una sesión exportada de Taptana (no es JSON válido).' }, 400);
    const result = validateSessionExport(body.value);
    if (!result.ok) return c.json<ApiError>({ error: result.error }, 400);
    const id = result.value.session.id;
    const replace = ['1', 'true'].includes(c.req.query('replace') ?? '');
    const exists = store.hasSession(id);
    if (exists && !replace) {
      return c.json({ error: 'Esta sesión ya está aquí. Si quieres reemplazarla con la del archivo, impórtala de nuevo eligiendo «Reemplazar».', id }, 409);
    }
    store.importSession(result.value);
    return c.json({ ok: true, id, replaced: exists });
  });

  /** Etiqueta, notas, exclusión y marcas manuales: { label?, notes?, excluded?, manual? } */
  api.patch('/sessions/:id', limit(PATCH_MAX_BYTES, 'El cambio es demasiado grande.'), async (c) => {
    const body = await readJson(c);
    if (!body.ok) return c.json<ApiError>({ error: INVALID_JSON }, 400);
    const result = validateSessionPatch(body.value);
    if (!result.ok) return c.json<ApiError>({ error: result.error }, 400);
    if (!store.setSessionFields(c.req.param('id'), result.value)) return c.json<ApiError>({ error: NO_SESSION }, 404);
    const session = store.getSession(c.req.param('id'));
    return session ? c.json(session) : c.json<ApiError>({ error: NO_SESSION }, 404);
  });

  api.delete('/sessions/:id', (c) => {
    const deleted = store.deleteSession(c.req.param('id'));
    return deleted ? c.json({ ok: true }) : c.json<ApiError>({ error: NO_SESSION }, 404);
  });

  // ── Estudios ─────────────────────────────────────────────────────────
  api.get('/studies', (c) => {
    const prototypeId = c.req.query('prototype');
    return c.json<StudyListResponse>({ studies: store.listStudies(prototypeId || undefined) });
  });

  const studyLimit = limit(STUDY_MAX_BYTES, 'El estudio pesa más de 1 MB.');

  /** Lee y valida el estudio del cuerpo. Los errores traen `issues` para pintarlos junto al campo. */
  const readStudy = async (c: Context) => {
    const body = await readJson(c);
    if (!body.ok) return { ok: false as const, response: c.json<ApiError>({ error: INVALID_JSON }, 400) };
    const result = validateStudy(body.value);
    if (!result.ok) return { ok: false as const, response: c.json({ error: result.error, issues: result.issues }, 400) };
    return { ok: true as const, value: result.value };
  };

  /**
   * Un estudio apunta a un prototipo de esta instalación. Si el que trae no existe (un
   * study.json escrito para otra computadora), se rechaza con un mensaje claro, salvo con
   * `?allowMissingPrototype=1` (para importar primero y subir el prototipo después).
   */
  const missingPrototype = (c: Context, prototypeId: string): Response | null => {
    if (['1', 'true'].includes(c.req.query('allowMissingPrototype') ?? '')) return null;
    // La carpeta que se está sirviendo existe aunque todavía no tenga sesiones.
    if (store.getPrototype(prototypeId) || (prototypeId === LOCAL_PROTOTYPE_ID && prototypeDir)) return null;
    return c.json({ error: STUDY_PROTOTYPE_MISSING, code: 'prototype-missing', issues: [{ message: STUDY_PROTOTYPE_MISSING, field: 'prototypeId' }] }, 400);
  };

  api.post('/studies', studyLimit, async (c) => {
    const result = await readStudy(c);
    if (!result.ok) return result.response;
    const missing = missingPrototype(c, result.value.prototypeId);
    if (missing) return missing;
    return c.json(store.saveStudy(result.value), 201);
  });

  /** Pública: el recorder del participante la pide para mostrar el estudio. Incluye `closed`. */
  api.get('/studies/:id', (c) => {
    const study = store.getStudy(c.req.param('id'));
    c.header('cache-control', 'no-store');
    return study ? c.json(study) : c.json<ApiError>({ error: NO_STUDY }, 404);
  });

  /** Reporte del estudio (ver computeStudyReport). Filtros: ?variant=<id>&device=touch|desktop */
  api.get('/studies/:id/report', async (c) => {
    const study = store.getStudy(c.req.param('id'));
    if (!study) return c.json<ApiError>({ error: NO_STUDY }, 404);
    const filter: ReportFilter = {};
    const variant = c.req.query('variant');
    const device = c.req.query('device');
    if (variant) filter.variantId = variant;
    if (device) {
      if (device !== 'touch' && device !== 'desktop') return c.json<ApiError>({ error: 'El filtro "device" tiene que ser "touch" o "desktop".' }, 400);
      filter.device = device;
    }
    // Las pantallas del prototipo dan los nombres: el reporte dice lo mismo que el constructor.
    const screens = store.listScreens(study.prototypeId, await htmlFiles(study.prototypeId));
    return c.json(computeStudyReport(study, store.listReportSessions(study.id), filter, { screens }));
  });

  /** El estudio como CSV, una fila por participante, para abrir en una hoja de cálculo. */
  api.get('/studies/:id/export.csv', (c) => {
    const study = store.getStudy(c.req.param('id'));
    if (!study) return c.json<ApiError>({ error: NO_STUDY }, 404);
    c.header('content-type', 'text/csv; charset=utf-8');
    c.header('content-disposition', `attachment; filename="${fileSlug(study.name) || 'estudio'}.csv"`);
    c.header('cache-control', 'no-store');
    return c.body(studyCsv(study, store.listReportSessions(study.id)));
  });

  /** Copia el estudio ("Copia de …") con ids de bloque nuevos, para editar sin tocar el original. */
  api.post('/studies/:id/duplicate', (c) => {
    const copy = store.duplicateStudy(c.req.param('id'));
    return copy ? c.json(copy, 201) : c.json<ApiError>({ error: NO_STUDY }, 404);
  });

  api.put('/studies/:id', studyLimit, async (c) => {
    const result = await readStudy(c);
    if (!result.ok) return result.response;
    const current = store.getStudy(c.req.param('id'));
    if (!current) return c.json<ApiError>({ error: NO_STUDY }, 404);
    // Solo se revisa si cambia de prototipo: un estudio cuyo prototipo se borró se puede seguir editando.
    if (result.value.prototypeId !== current.prototypeId) {
      const missing = missingPrototype(c, result.value.prototypeId);
      if (missing) return missing;
    }
    return c.json(store.saveStudy(result.value, c.req.param('id')));
  });

  api.delete('/studies/:id', (c) => {
    const deleted = store.deleteStudy(c.req.param('id'));
    return deleted ? c.json({ ok: true }) : c.json<ApiError>({ error: NO_STUDY }, 404);
  });

  // ── Prototipos ───────────────────────────────────────────────────────
  const isLocalFolder = (p: Prototype): boolean => p.id === LOCAL_PROTOTYPE_ID && !!prototypeDir;

  /**
   * Cómo ve el panel un prototipo: con `url` si se puede abrir. Un subido marcado "en la raíz"
   * se abre en "/" (salvo que haya una carpeta local, que es la dueña de la raíz). Los que no
   * tienen archivos (creados al importar una sesión) van sin `source` ni `url`.
   */
  const present = (p: Prototype): Prototype => {
    const out: Prototype = { ...p };
    delete out.root;
    if (isLocalFolder(p)) {
      out.url = '/';
    } else if (p.source === 'upload') {
      const root = p.root === true && !prototypeDir;
      if (root) out.root = true;
      out.url = root ? '/' : `${UPLOADED_PATH}/${p.id}/`;
    } else {
      delete out.source;
      delete out.entryPath;
    }
    return out;
  };

  /** Carpeta en disco de un prototipo, o null si no tiene archivos. */
  const dirFor = (id: string): string | null => {
    if (id === LOCAL_PROTOTYPE_ID) return prototypeDir ?? null;
    if (!dataDir || !UPLOADED_ID.test(id)) return null;
    return uploadedDir(dataDir, id);
  };

  api.get('/prototypes', (c) => {
    const prototypes = store
      .listPrototypes()
      // La carpeta local (si hay), los subidos y los que llegaron con una sesión importada.
      .filter((p) => isLocalFolder(p) || p.source === 'upload' || (p.source === undefined && p.id !== LOCAL_PROTOTYPE_ID) || (p.source === undefined && !prototypeDir))
      .map(present);
    return c.json<PrototypeListResponse>({ prototypes });
  });

  const uploadLimit = limit(MAX_UPLOAD_BYTES + MB, 'El archivo pesa más de 50 MB.');

  /** Sube un .html o .zip (multipart, campo "file"; opcional "name"). Con :id reemplaza los archivos. */
  const upload = async (c: Context, existing: Prototype | null) => {
    if (!dataDir) return c.json<ApiError>({ error: 'Este servidor no tiene carpeta de datos: no se pueden subir prototipos.' }, 400);
    let form: Record<string, string | File | (string | File)[]>;
    try {
      form = await c.req.parseBody();
    } catch {
      return c.json<ApiError>({ error: 'Envía el archivo como multipart/form-data.' }, 400);
    }
    const file = form['file'];
    if (!(file instanceof File)) return c.json<ApiError>({ error: 'Falta el archivo.' }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return c.json<ApiError>({ error: 'El archivo pesa más de 50 MB.' }, 413);
    const fileName = file.name.split(/[\\/]/).pop() ?? '';
    const rawName = typeof form['name'] === 'string' ? form['name'].trim().slice(0, STUDY_LIMITS.name) : '';
    const id = existing?.id ?? newPrototypeId();
    try {
      const { entryPath, absoluteUrls } = await extractUpload(fileName, new Uint8Array(await file.arrayBuffer()), uploadedDir(dataDir, id));
      const name = rawName || existing?.name || fileName.replace(/\.(zip|html?)$/i, '').slice(0, STUDY_LIMITS.name) || 'Prototipo';
      const saved = store.savePrototype({ id, name, createdAt: existing?.createdAt ?? Date.now(), source: 'upload', entryPath, absoluteUrls });
      return c.json(present(saved), existing ? 200 : 201);
    } catch (err) {
      // Si el archivo no sirve, la versión anterior queda como estaba (ver extractUpload).
      if (err instanceof UploadError) return c.json<ApiError>({ error: err.message }, 400);
      throw err;
    }
  };

  api.post('/prototypes', uploadLimit, (c) => upload(c, null));

  api.put('/prototypes/:id', uploadLimit, (c) => {
    const existing = store.getPrototype(c.req.param('id'));
    if (!existing || existing.source !== 'upload' || !UPLOADED_ID.test(existing.id)) return c.json<ApiError>({ error: NO_PROTOTYPE }, 404);
    return upload(c, existing);
  });

  /** Renombrar (`name`) y abrir en la raíz (`root`: solo uno a la vez). */
  api.patch('/prototypes/:id', limit(PATCH_MAX_BYTES, 'El cambio es demasiado grande.'), async (c) => {
    const existing = store.getPrototype(c.req.param('id'));
    if (!existing) return c.json<ApiError>({ error: NO_PROTOTYPE }, 404);
    const body = await readJson(c);
    if (!body.ok) return c.json<ApiError>({ error: INVALID_JSON }, 400);
    const patch = (typeof body.value === 'object' && body.value !== null ? body.value : {}) as { name?: unknown; root?: unknown };
    if (patch.name === undefined && patch.root === undefined) return c.json<ApiError>({ error: 'Indica qué cambiar: "name" o "root".' }, 400);

    let name: string | undefined;
    if (patch.name !== undefined) {
      if (typeof patch.name !== 'string' || !patch.name.trim()) return c.json<ApiError>({ error: 'Ponle un nombre al prototipo.' }, 400);
      name = patch.name.trim();
      if (name.length > STUDY_LIMITS.name) return c.json<ApiError>({ error: `El nombre no puede pasar de ${STUDY_LIMITS.name} caracteres.` }, 400);
    }
    if (patch.root !== undefined) {
      if (typeof patch.root !== 'boolean') return c.json<ApiError>({ error: '"root" tiene que ser true o false.' }, 400);
      if (existing.source !== 'upload') return c.json<ApiError>({ error: 'Solo un prototipo subido se puede abrir en la raíz.' }, 400);
      if (patch.root && prototypeDir) {
        return c.json<ApiError>({ error: 'La raíz ya la ocupa la carpeta que estás sirviendo. Arranca Taptana sin carpeta para abrir en la raíz un prototipo subido.' }, 400);
      }
    }

    if (name !== undefined) store.savePrototype({ ...existing, name });
    if (patch.root === true) store.setRootPrototype(existing.id);
    else if (patch.root === false && existing.root) store.setRootPrototype(null);
    return c.json(present(store.getPrototype(existing.id)!));
  });

  api.delete('/prototypes/:id', async (c) => {
    const id = c.req.param('id');
    const existing = store.getPrototype(id);
    if (!existing) return c.json<ApiError>({ error: NO_PROTOTYPE }, 404);
    if (isLocalFolder(existing) || existing.source === 'folder') {
      return c.json<ApiError>({ error: 'Este prototipo es una carpeta de tu computadora: Taptana no la borra. Solo se pueden borrar prototipos subidos o importados.' }, 400);
    }
    store.deletePrototype(id);
    if (dataDir && UPLOADED_ID.test(id)) await removePrototypeFiles(dataDir, id);
    return c.json({ ok: true });
  });

  const htmlFiles = async (id: string): Promise<Array<{ path: string; title: string }>> => {
    const dir = dirFor(id);
    return dir ? listPrototypePages(dir) : [];
  };

  /** Pantallas conocidas: los archivos HTML del prototipo más las pantallas vistas en sus sesiones. */
  api.get('/prototypes/:id/screens', async (c) => {
    const id = c.req.param('id');
    return c.json<PrototypeScreensResponse>({ screens: store.listScreens(id, await htmlFiles(id)) });
  });

  /** Alias anterior a v1: solo los archivos HTML. */
  api.get('/prototypes/:id/pages', async (c) => {
    return c.json<PrototypePagesResponse>({ pages: await htmlFiles(c.req.param('id')) });
  });

  // ── Ejemplo ──────────────────────────────────────────────────────────
  // De a una: dos clics seguidos en "Ver un ejemplo" no copian los archivos a la vez.
  let exampleQueue: Promise<unknown> = Promise.resolve();
  api.post('/example', async (c) => {
    if (!dataDir) return c.json<ApiError>({ error: 'Este servidor no tiene carpeta de datos: no se puede cargar el ejemplo.' }, 400);
    const run = exampleQueue.then(() =>
      loadExample({ store, dataDir, ...(exampleDir && { exampleDir }), ...(seedDir && { seedDir }) }),
    );
    exampleQueue = run.catch(() => undefined);
    try {
      const { prototypeId, studyId } = await run;
      return c.json<ExampleResponse>({ prototypeId, studyId });
    } catch (err) {
      if (err instanceof ExampleError) return c.json<ApiError>({ error: err.message }, 503);
      throw err;
    }
  });

  // ── QR ───────────────────────────────────────────────────────────────
  api.get('/qr.svg', async (c) => {
    const text = c.req.query('text') ?? '';
    if (!text || text.length > 2000) return c.json<ApiError>({ error: 'Falta el texto del QR ("text", hasta 2000 caracteres).' }, 400);
    let svg: string;
    try {
      svg = await QRCode.toString(text, { type: 'svg', margin: 1, width: 240 });
    } catch {
      return c.json<ApiError>({ error: 'Ese texto no cabe en un código QR.' }, 400);
    }
    c.header('content-type', 'image/svg+xml');
    c.header('cache-control', 'private, max-age=3600');
    return c.body(svg);
  });

  return api;
}
