/**
 * API bajo /api/v1. Responde CORS para que un recorder en otro origen pueda enviar lotes.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  validateEventBatch,
  type ApiError,
  type EventBatchResponse,
  type SessionExport,
  type SessionListResponse,
} from '@taptana/shared';
import type { Store } from '../store/store.js';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export function apiRoutes(store: Store): Hono {
  const api = new Hono();

  api.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], maxAge: 86400 }));

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

  api.get('/sessions', (c) => {
    const prototypeId = c.req.query('prototype');
    const sessions = store.listSessions(prototypeId || undefined);
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

  api.delete('/sessions/:id', (c) => {
    const deleted = store.deleteSession(c.req.param('id'));
    return deleted ? c.json({ ok: true }) : c.json<ApiError>({ error: 'not found' }, 404);
  });

  return api;
}
