/**
 * Crea la app Hono y monta las rutas.
 *
 *   /__taptana/recorder.js   el script de grabación
 *   /api/v1/...              la API (recorder y panel)
 *   /sessions, /sessions/:id el panel compilado (packages/web)
 *   /*                       el prototipo, con el recorder inyectado en cada HTML
 */

import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_PREFIX, PANEL_PATH, RECORDER_PATH, UPLOADED_PATH, type ServerInfo } from '@taptana/shared';
import { prototypeDir as uploadedDir } from './uploads.js';
import { injectRecorder } from './inject.js';
import { apiRoutes } from './routes/api.js';
import { mimeFor, readFile, resolveFile } from './static.js';
import type { Store } from './store/store.js';

export interface AppOptions {
  store: Store;
  /** Carpeta de `taptana dev <carpeta>`. Sin ella, solo se usan prototipos subidos. */
  prototypeDir?: string;
  prototypeId: string;
  /** Carpeta de datos. Habilita subir prototipos (<dataDir>/prototypes/<id>/). */
  dataDir?: string;
  recordSelf?: boolean;
  /** Carpeta public/ con recorder.js y panel/. Por defecto la del paquete. */
  publicDir?: string;
  /** Datos para el panel: link del participante, nombre del prototipo. */
  info?: ServerInfo;
}

const PANEL_PROTOTYPE_ID = 'taptana-panel';

export function createApp(opts: AppOptions): Hono {
  const publicDir = opts.publicDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const recorderPath = join(publicDir, 'recorder.js');
  const panelDir = join(publicDir, 'panel');
  const app = new Hono();

  // ── Recorder ───────────────────────────────────────────────────────
  app.get(RECORDER_PATH, async (c) => {
    if (!existsSync(recorderPath)) return c.text('recorder.js not built', 404);
    c.header('content-type', 'text/javascript; charset=utf-8');
    c.header('cache-control', 'no-cache');
    return c.body(await readFile(recorderPath));
  });
  app.get(`${RECORDER_PATH}.map`, async (c) => {
    const map = `${recorderPath}.map`;
    if (!existsSync(map)) return c.text('not found', 404);
    c.header('content-type', 'application/json');
    return c.body(await readFile(map));
  });

  // ── API ────────────────────────────────────────────────────────────
  app.route(
    API_PREFIX,
    apiRoutes({
      store: opts.store,
      ...(opts.prototypeDir && { prototypeDir: opts.prototypeDir }),
      ...(opts.dataDir && { dataDir: opts.dataDir }),
      ...(opts.info && { info: opts.info }),
    }),
  );

  // ── Prototipos subidos: /p/<id>/... ─────────────────────────────────
  if (opts.dataDir) {
    const dataDir = opts.dataDir;
    app.get(`${UPLOADED_PATH}/:id`, (c) => c.redirect(`${UPLOADED_PATH}/${c.req.param('id')}/${new URL(c.req.url).search}`, 301));
    app.get(`${UPLOADED_PATH}/:id/*`, async (c) => {
      const id = c.req.param('id');
      const proto = /^pr_[A-Za-z0-9]+$/.test(id) ? opts.store.getPrototype(id) : null;
      if (!proto || proto.source !== 'upload') return c.text('No existe este prototipo', 404);
      const base = `${UPLOADED_PATH}/${id}`;
      const rel = c.req.path.slice(base.length) || '/';
      const file = await resolveFile(uploadedDir(dataDir, id), rel === '/' ? (proto.entryPath ?? '/') : rel);
      if (!file) return c.text('No encontrado', 404);
      c.header('cache-control', 'no-cache');
      if (file.isHtml) {
        c.header('content-type', 'text/html; charset=utf-8');
        return c.body(injectRecorder(readFileSync(file.absolute, 'utf8'), { prototypeId: id, base }));
      }
      c.header('content-type', mimeFor(file.absolute));
      return c.body(await readFile(file.absolute));
    });
  }

  // ── Panel ──────────────────────────────────────────────────────────
  if (opts.recordSelf) {
    opts.store.ensurePrototype({ id: PANEL_PROTOTYPE_ID, name: 'Panel de Taptana', createdAt: Date.now() });
  }
  const panelIndex = join(panelDir, 'index.html');
  const servePanelIndex = (): Response => {
    if (!existsSync(panelIndex)) {
      return new Response(placeholderPanel(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    let html = readFileSync(panelIndex, 'utf8');
    if (opts.recordSelf) html = injectRecorder(html, { prototypeId: PANEL_PROTOTYPE_ID });
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
  };
  app.get(PANEL_PATH, () => servePanelIndex());
  app.get(`${PANEL_PATH}/*`, async (c) => {
    const rel = c.req.path.slice(PANEL_PATH.length);
    const file = await resolveFile(panelDir, rel);
    if (file && !file.isHtml) {
      c.header('content-type', mimeFor(file.absolute));
      c.header('cache-control', rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return c.body(await readFile(file.absolute));
    }
    return servePanelIndex(); // rutas del panel (/sessions/:id): la SPA decide
  });

  // ── Prototipo ──────────────────────────────────────────────────────
  app.get('/*', async (c) => {
    // Sin carpeta local: la raíz lleva al panel, a subir un prototipo.
    if (!opts.prototypeDir) return c.req.path === '/' ? c.redirect(`${PANEL_PATH}/prototypes`) : c.text('No encontrado', 404);
    const file = await resolveFile(opts.prototypeDir, c.req.path);
    if (!file) return c.text('No encontrado', 404);
    c.header('cache-control', 'no-cache');
    if (file.isHtml) {
      const html = readFileSync(file.absolute, 'utf8');
      c.header('content-type', 'text/html; charset=utf-8');
      return c.body(injectRecorder(html, { prototypeId: opts.prototypeId }));
    }
    c.header('content-type', mimeFor(file.absolute));
    return c.body(await readFile(file.absolute));
  });

  return app;
}

function placeholderPanel(): string {
  return `<!doctype html><meta charset="utf-8"><title>Taptana</title>
<body style="font:16px system-ui;padding:2rem;max-width:40rem">
<h1>Taptana</h1>
<p>El panel todavía no está compilado. Corre <code>pnpm build</code> en la raíz del repo.</p>
<p>Mientras tanto, la API funciona: <a href="${API_PREFIX}/sessions">${API_PREFIX}/sessions</a></p>`;
}
