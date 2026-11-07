/**
 * API bajo /api/v1. Responde CORS para que un recorder en otro origen pueda enviar lotes.
 */

import { Hono, type Context } from 'hono';
import { randomBytes } from 'node:crypto';
import { cors } from 'hono/cors';
import QRCode from 'qrcode';
import {
  LOCAL_PROTOTYPE_ID,
  validateEventBatch,
  validateStudy,
  type ApiError,
  type EventBatchResponse,
  type PrototypePagesResponse,
  type Prototype,
  type PrototypeListResponse,
  UPLOADED_PATH,
  type ServerInfo,
  type SessionExport,
  type SessionListResponse,
  type SessionPatch,
  type StudyListResponse,
} from '@taptana/shared';
import type { ListSessionsFilter, Store } from '../store/store.js';
import { listPrototypePages } from '../prototype-pages.js';
import { extractUpload, MAX_UPLOAD_BYTES, prototypeDir as uploadedDir, removePrototypeFiles, UploadError } from '../uploads.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function newPrototypeId(): string {
  let out = '';
  for (const b of randomBytes(8)) out += ALPHABET[b % ALPHABET.length];
  return `pr_${out}`;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export interface ApiOptions {
  store: Store;
  /** Carpeta del prototipo local, para listar sus páginas. */
  prototypeDir?: string;
  /** Carpeta de datos: los prototipos subidos viven en <dataDir>/prototypes/<id>/. */
  dataDir?: string;
  /** Datos del servidor para el panel (link del participante, nombre del prototipo). */
  info?: ServerInfo;
}

export function apiRoutes({ store, prototypeDir, dataDir, info }: ApiOptions): Hono {
  const api = new Hono();

  api.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], maxAge: 86400 }));

  api.get('/info', (c) =>
    c.json<ServerInfo>(
      info ?? { version: '0.1.0', participantUrl: '', prototypeId: LOCAL_PROTOTYPE_ID, prototypeName: 'local' },
    ),
  );

  // ── Eventos ──────────────────────────────────────────────────────────
  api.post('/events', async (c) => {
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) return c.json<ApiError>({ error: 'batch too large' }, 413);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json<ApiError>({ error: 'invalid json' }, 400);
    }
    const result = validateEventBatch(body);
    if (!result.ok) return c.json<ApiError>({ error: result.error }, 400);
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
    const sessions = store.listSessions(filter);
    return c.json<SessionListResponse>({ sessions });
  });

  api.get('/sessions/:id', (c) => {
    const session = store.getSession(c.req.param('id'));
    if (!session) return c.json<ApiError>({ error: 'not found' }, 404);
    return c.json(session);
  });

  api.get('/sessions/:id/events', (c) => {
    const data = store.getSessionEvents(c.req.param('id'));
    if (!data) return c.json<ApiError>({ error: 'not found' }, 404);
    return c.json(data);
  });

  /** Descarga la sesión en el mismo formato que exporta el recorder local. */
  api.get('/sessions/:id/export', (c) => {
    const data = store.getSessionEvents(c.req.param('id'));
    if (!data) return c.json<ApiError>({ error: 'not found' }, 404);
    const file: SessionExport = { v: 1, exportedAt: Date.now(), ...data };
    c.header('content-disposition', `attachment; filename="taptana-${data.session.id}.json"`);
    return c.json(file);
  });

  /** Importa un archivo exportado (modo local, o de otra instalación). */
  api.post('/sessions/import', async (c) => {
    let body: SessionExport;
    try {
      body = (await c.req.json()) as SessionExport;
    } catch {
      return c.json<ApiError>({ error: 'invalid json' }, 400);
    }
    if (body?.v !== 1 || !body.session?.id || !Array.isArray(body.events)) {
      return c.json<ApiError>({ error: 'not a taptana session file' }, 400);
    }
    store.importSession(body);
    return c.json({ ok: true, id: body.session.id });
  });

  /** Marcas manuales del moderador: { manual: { taskId: 'success' | 'failure' } } */
  api.patch('/sessions/:id', async (c) => {
    let body: SessionPatch;
    try {
      body = (await c.req.json()) as SessionPatch;
    } catch {
      return c.json<ApiError>({ error: 'invalid json' }, 400);
    }
    if (body.manual) {
      for (const v of Object.values(body.manual)) {
        if (v !== 'success' && v !== 'failure') return c.json<ApiError>({ error: 'manual values must be success or failure' }, 400);
      }
      if (!store.setManualResults(c.req.param('id'), body.manual)) return c.json<ApiError>({ error: 'not found' }, 404);
    }
    const session = store.getSession(c.req.param('id'));
    return session ? c.json(session) : c.json<ApiError>({ error: 'not found' }, 404);
  });

  api.delete('/sessions/:id', (c) => {
    const deleted = store.deleteSession(c.req.param('id'));
    return deleted ? c.json({ ok: true }) : c.json<ApiError>({ error: 'not found' }, 404);
  });

  // ── Estudios ─────────────────────────────────────────────────────────
  api.get('/studies', (c) => {
    const prototypeId = c.req.query('prototype');
    return c.json<StudyListResponse>({ studies: store.listStudies(prototypeId || undefined) });
  });

  const readStudy = async (c: { req: { json(): Promise<unknown> } }) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return { ok: false as const, error: 'invalid json' };
    }
    return validateStudy(body);
  };

  api.post('/studies', async (c) => {
    const result = await readStudy(c);
    if (!result.ok) return c.json<ApiError>({ error: result.error }, 400);
    return c.json(store.saveStudy(result.value), 201);
  });

  api.get('/studies/:id', (c) => {
    const study = store.getStudy(c.req.param('id'));
    return study ? c.json(study) : c.json<ApiError>({ error: 'not found' }, 404);
  });

  api.put('/studies/:id', async (c) => {
    const result = await readStudy(c);
    if (!result.ok) return c.json<ApiError>({ error: result.error }, 400);
    if (!store.getStudy(c.req.param('id'))) return c.json<ApiError>({ error: 'not found' }, 404);
    return c.json(store.saveStudy(result.value, c.req.param('id')));
  });

  api.delete('/studies/:id', (c) => {
    const deleted = store.deleteStudy(c.req.param('id'));
    return deleted ? c.json({ ok: true }) : c.json<ApiError>({ error: 'not found' }, 404);
  });

  // ── Prototipos ───────────────────────────────────────────────────────
  const withUrl = (p: Prototype): Prototype => ({ ...p, url: p.source === 'upload' ? `${UPLOADED_PATH}/${p.id}/` : '/' });

  /** Carpeta en disco de un prototipo, o null si no tiene archivos. */
  const dirFor = (id: string): string | null => {
    if (id === LOCAL_PROTOTYPE_ID) return prototypeDir ?? null;
    if (!dataDir || !/^pr_[A-Za-z0-9]+$/.test(id)) return null;
    return uploadedDir(dataDir, id);
  };

  api.get('/prototypes', (c) => {
    const prototypes = store
      .listPrototypes()
      // Solo los que se pueden abrir: la carpeta local (si hay) y los subidos.
      .filter((p) => (p.id === LOCAL_PROTOTYPE_ID ? !!prototypeDir : p.source === 'upload'))
      .map(withUrl);
    return c.json<PrototypeListResponse>({ prototypes });
  });

  /** Sube un .html o .zip (multipart, campo "file"; opcional "name"). Con :id reemplaza los archivos. */
  const upload = async (c: Context, existing: Prototype | null) => {
    if (!dataDir) return c.json<ApiError>({ error: 'uploads are disabled' }, 400);
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_UPLOAD_BYTES + 1024 * 1024) return c.json<ApiError>({ error: 'El archivo pesa más de 50 MB.' }, 413);
    let form: Record<string, string | File | (string | File)[]>;
    try {
      form = await c.req.parseBody();
    } catch {
      return c.json<ApiError>({ error: 'Envía el archivo como multipart/form-data.' }, 400);
    }
    const file = form['file'];
    if (!(file instanceof File)) return c.json<ApiError>({ error: 'Falta el archivo.' }, 400);
    const rawName = typeof form['name'] === 'string' ? form['name'].trim() : '';
    const id = existing?.id ?? newPrototypeId();
    try {
      const { entryPath } = extractUpload(file.name, new Uint8Array(await file.arrayBuffer()), uploadedDir(dataDir, id));
      const name = rawName || existing?.name || file.name.replace(/\.(zip|html?)$/i, '') || 'Prototipo';
      const saved = store.savePrototype({ id, name, createdAt: existing?.createdAt ?? Date.now(), source: 'upload', entryPath });
      return c.json(withUrl(saved), existing ? 200 : 201);
    } catch (err) {
      if (!existing) removePrototypeFiles(dataDir, id);
      if (err instanceof UploadError) return c.json<ApiError>({ error: err.message }, 400);
      throw err;
    }
  };

  api.post('/prototypes', (c) => upload(c, null));

  api.put('/prototypes/:id', (c) => {
    const existing = store.getPrototype(c.req.param('id'));
    if (!existing || existing.source !== 'upload') return c.json<ApiError>({ error: 'not found' }, 404);
    return upload(c, existing);
  });

  /** Renombrar. */
  api.patch('/prototypes/:id', async (c) => {
    const existing = store.getPrototype(c.req.param('id'));
    if (!existing) return c.json<ApiError>({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    if (typeof body.name !== 'string' || !body.name.trim()) return c.json<ApiError>({ error: 'name is required' }, 400);
    return c.json(withUrl(store.savePrototype({ ...existing, name: body.name.trim() })));
  });

  api.delete('/prototypes/:id', (c) => {
    const id = c.req.param('id');
    const existing = store.getPrototype(id);
    if (!existing || existing.source !== 'upload') return c.json<ApiError>({ error: 'Solo se pueden borrar prototipos subidos.' }, 400);
    store.deletePrototype(id);
    if (dataDir) removePrototypeFiles(dataDir, id);
    return c.json({ ok: true });
  });

  api.get('/prototypes/:id/pages', async (c) => {
    const dir = dirFor(c.req.param('id'));
    if (!dir) return c.json<PrototypePagesResponse>({ pages: [] });
    return c.json<PrototypePagesResponse>({ pages: await listPrototypePages(dir) });
  });

  // ── QR ───────────────────────────────────────────────────────────────
  api.get('/qr.svg', async (c) => {
    const text = c.req.query('text') ?? '';
    if (!text || text.length > 2000) return c.json<ApiError>({ error: 'text is required' }, 400);
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, width: 240 });
    c.header('content-type', 'image/svg+xml');
    c.header('cache-control', 'public, max-age=3600');
    return c.body(svg);
  });

  return api;
}
