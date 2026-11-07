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
import { API_PREFIX, PANEL_PATH, RECORDER_PATH } from '@taptana/shared';
import { injectRecorder } from './inject.js';
import { apiRoutes } from './routes/api.js';
import { mimeFor, readFile, resolveFile } from './static.js';
import type { Store } from './store/store.js';

export interface AppOptions {
  store: Store;
  prototypeDir: string;
  prototypeId: string;
  recordSelf?: boolean;
  /** Carpeta public/ con recorder.js y panel/. Por defecto la del paquete. */
  publicDir?: string;
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
  app.route(API_PREFIX, apiRoutes(opts.store));

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
