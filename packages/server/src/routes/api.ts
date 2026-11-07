/**
 * API bajo /api/v1. Responde CORS para que un recorder en otro origen pueda enviar lotes.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import QRCode from 'qrcode';
import {
  LOCAL_PROTOTYPE_ID,
  validateEventBatch,
  validateStudy,
  type ApiError,
  type EventBatchResponse,
  type PrototypePagesResponse,
  type ServerInfo,
  type SessionExport,
  type SessionListResponse,
  type SessionPatch,
  type StudyListResponse,
} from '@taptana/shared';
import type { ListSessionsFilter, Store } from '../store/store.js';
import { listPrototypePages } from '../prototype-pages.js';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export interface ApiOptions {
  store: Store;
  /** Carpeta del prototipo local, para listar sus páginas. */
  prototypeDir?: string;
  /** Datos del servidor para el panel (link del participante, nombre del prototipo). */
  info?: ServerInfo;
}

export function apiRoutes({ store, prototypeDir, info }: ApiOptions): Hono {
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
  api.get('/prototypes/:id/pages', async (c) => {
    if (c.req.param('id') !== LOCAL_PROTOTYPE_ID || !prototypeDir) return c.json<PrototypePagesResponse>({ pages: [] });
    return c.json<PrototypePagesResponse>({ pages: await listPrototypePages(prototypeDir) });
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
