/**
 * Crea la app Hono y monta las rutas.
 *
 *   /__taptana/recorder.js   el script de grabación
 *   /api/v1/...              la API (recorder y panel)
 *   /mcp                     el MCP para herramientas de IA (POST), detrás de la guardia
 *   /panel, /panel/...       el panel compilado (packages/web), detrás de la guardia
 *   /sessions...             la dirección antigua del panel: redirige a /panel
 *   /p/<id>/...              prototipos subidos, con el recorder inyectado en cada HTML
 *   /*                       lo que esté montado en la raíz: la carpeta de `taptana dev <carpeta>`
 *                            o el prototipo subido marcado "abrir en la raíz"
 *
 * Direcciones reservadas: un prototipo en la raíz no puede usar /panel, /sessions, /api, /p,
 * /mcp ni /__taptana para sus propias páginas.
 */

import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  API_PREFIX,
  LEGACY_PANEL_PATH,
  PANEL_PATH,
  RECORDER_PATH,
  STUDY_PARAM,
  UPLOADED_PATH,
  type ApiError,
  type ServerInfo,
} from '@taptana/shared';
import { injectRecorder } from './inject.js';
import { lostPage, notFoundPage, panelPlaceholderPage } from './pages.js';
import { createPanelGuard, loadPanelKey } from './panel-guard.js';
import { apiRoutes, UPLOADED_ID } from './routes/api.js';
import { mountMcp } from './routes/mcp.js';
import { mimeFor, parseRange, readFile, readRange, resolveFile, type ResolvedFile } from './static.js';
import type { Store } from './store/store.js';
import { prototypeDir as uploadedDir } from './uploads.js';
import { PACKAGE_ROOT } from './version.js';

export interface AppOptions {
  store: Store;
  /** Carpeta de `taptana dev <carpeta>`. Sin ella, solo se usan prototipos subidos. */
  prototypeDir?: string;
  prototypeId: string;
  /** Carpeta de datos. Habilita subir prototipos (<dataDir>/prototypes/<id>/) y la llave del panel. */
  dataDir?: string;
  recordSelf?: boolean;
  /** Carpeta public/ con recorder.js y panel/. Por defecto la del paquete. */
  publicDir?: string;
  /** Datos para el panel: link del participante, nombre del prototipo. */
  info?: ServerInfo | (() => ServerInfo);
  /** Llave del panel. Por defecto, la de <dataDir>/panel.key (se crea si no existe). */
  panelKey?: string;
  /** Panel abierto a toda la red (`--open-panel`, `TAPTANA_PANEL=open`). */
  openPanel?: boolean;
  /** De dónde viene cada conexión. Solo para pruebas; por defecto, el socket de Node. */
  remoteAddress?: (c: Context) => string | undefined;
  /** Dirección pública fija (`TAPTANA_PUBLIC_URL`), para links y QR. */
  publicUrl?: string;
  /** De dónde sale el ejemplo (`POST /api/v1/example`). Por defecto, del paquete. */
  exampleDir?: string;
  seedDir?: string;
}

const PANEL_PROTOTYPE_ID = 'taptana-panel';

/** Un lugar de donde se sirven archivos de un prototipo. */
interface Mount {
  dir: string;
  prototypeId: string;
  /** Página de entrada dentro de la carpeta ("/" busca index.html). */
  entry: string;
  /** Prefijo de la URL ("/p/pr_abc"). Vacío en la raíz. */
  base: string;
}

const wantsHtml = (c: Context): boolean => (c.req.header('accept') ?? '').includes('text/html');
/** "/css/app.css" tiene extensión; "/checkout" y "/producto/42" no (son rutas de una app). */
const hasExtension = (path: string): boolean => /\.[A-Za-z0-9]{1,8}$/.test(path.split('/').pop() ?? '');
const searchOf = (c: Context): string => new URL(c.req.url).search;

export function createApp(opts: AppOptions): Hono {
  const publicDir = opts.publicDir ?? join(PACKAGE_ROOT, 'public');
  const recorderPath = join(publicDir, 'recorder.js');
  const panelDir = join(publicDir, 'panel');
  const { store, dataDir } = opts;
  const app = new Hono();

  const panelKey = opts.panelKey ?? (dataDir ? loadPanelKey(dataDir) : undefined);
  const guard = createPanelGuard({
    ...(panelKey && { key: panelKey }),
    ...(opts.openPanel && { open: true }),
    ...(opts.remoteAddress && { remoteAddress: opts.remoteAddress }),
  });

  const notFound = (c: Context, message = 'No encontrado'): Response => (wantsHtml(c) ? c.html(notFoundPage(), 404) : c.text(message, 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    if (c.req.path.startsWith(API_PREFIX)) {
      return c.json<ApiError>({ error: 'Algo falló dentro de Taptana. Mira la terminal donde está corriendo para ver el detalle.' }, 500);
    }
    return c.text('Algo falló dentro de Taptana.', 500);
  });
  app.notFound((c) => (c.req.path.startsWith(API_PREFIX) ? c.json<ApiError>({ error: 'No existe esta ruta de la API.' }, 404) : notFound(c)));

  // ── Recorder ───────────────────────────────────────────────────────
  const sendPublicFile = async (c: Context, path: string, type: string): Promise<Response> => {
    try {
      const body = await readFile(path);
      c.header('content-type', type);
      c.header('cache-control', 'no-cache');
      return c.body(body);
    } catch {
      return c.text('El recorder no está compilado. Corre «pnpm build».', 404);
    }
  };
  app.get(RECORDER_PATH, (c) => sendPublicFile(c, recorderPath, 'text/javascript; charset=utf-8'));
  app.get(`${RECORDER_PATH}.map`, (c) => sendPublicFile(c, `${recorderPath}.map`, 'application/json'));

  // ── API ────────────────────────────────────────────────────────────
  app.route(
    API_PREFIX,
    apiRoutes({
      store,
      guard,
      ...(opts.prototypeDir && { prototypeDir: opts.prototypeDir }),
      ...(dataDir && { dataDir }),
      ...(opts.info && { info: opts.info }),
      ...(opts.publicUrl && { publicUrl: opts.publicUrl }),
      ...(opts.exampleDir && { exampleDir: opts.exampleDir }),
      ...(opts.seedDir && { seedDir: opts.seedDir }),
    }),
  );

  // ── MCP ────────────────────────────────────────────────────────────
  mountMcp(app, { guard, publicUrl: opts.publicUrl });

  // ── Archivos de un prototipo ───────────────────────────────────────
  const sendFile = async (c: Context, file: ResolvedFile, mount: Mount): Promise<Response> => {
    c.header('cache-control', 'no-cache');
    if (file.isHtml) {
      const html = await fs.readFile(file.absolute, 'utf8');
      c.header('content-type', 'text/html; charset=utf-8');
      return c.body(injectRecorder(html, { prototypeId: mount.prototypeId, ...(mount.base && { base: mount.base }) }));
    }
    // Con ETag el celular no vuelve a bajar lo que no cambió; con Range reproduce video y audio.
    const etag = `W/"${file.size.toString(16)}-${Math.round(file.mtimeMs).toString(16)}"`;
    c.header('content-type', mimeFor(file.absolute));
    c.header('etag', etag);
    c.header('accept-ranges', 'bytes');
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    const range = parseRange(c.req.header('range'), file.size);
    if (range === 'invalid') {
      c.header('content-range', `bytes */${file.size}`);
      return c.body(null, 416);
    }
    if (range) {
      c.header('content-range', `bytes ${range.start}-${range.end}/${file.size}`);
      return c.body(await readRange(file.absolute, range.start, range.end), 206);
    }
    return c.body(await readFile(file.absolute));
  };

  /**
   * Responde `rel` desde un prototipo, o null si no hay nada que servir. Con `spa`, una ruta sin
   * extensión que no existe y pide HTML recibe la página de entrada: así funcionan las apps de
   * una sola página que cambian la URL con la History API ("/checkout" al recargar).
   */
  const serveFrom = async (c: Context, mount: Mount, rel: string, spa: boolean): Promise<Response | null> => {
    const entry = mount.entry === '/index.html' ? '/' : mount.entry;
    if (rel === '/' && entry !== '/') {
      // La entrada no es index.html: se va a su archivo para que la ruta grabada sea la real.
      return c.redirect(`${mount.base}${entry}${searchOf(c)}`, 302);
    }
    const direct = await resolveFile(mount.dir, rel);
    if (direct?.needsSlash) return c.redirect(`${c.req.path}/${searchOf(c)}`, 302);
    if (direct) return sendFile(c, direct, mount);
    if (spa && wantsHtml(c) && !hasExtension(rel)) {
      const page = await resolveFile(mount.dir, entry);
      if (page) return sendFile(c, page, mount);
    }
    return null;
  };

  const uploadedMount = (id: string, entryPath: string | undefined): Mount => ({
    dir: uploadedDir(dataDir as string, id),
    prototypeId: id,
    entry: entryPath ?? '/',
    base: `${UPLOADED_PATH}/${id}`,
  });

  /** Lo que se sirve en "/": la carpeta local, o el prototipo subido marcado "abrir en la raíz". */
  const rootMount = (): Mount | null => {
    if (opts.prototypeDir) return { dir: opts.prototypeDir, prototypeId: opts.prototypeId, entry: '/', base: '' };
    if (!dataDir) return null;
    const proto = store.getRootPrototype();
    return proto && UPLOADED_ID.test(proto.id) ? { ...uploadedMount(proto.id, proto.entryPath), base: '' } : null;
  };

  // Un formulario del prototipo con method="post" no tiene servidor que lo reciba: se trata
  // como una navegación a esa misma dirección. Lo que traía el formulario se descarta.
  const formPost = (c: Context): Response => c.redirect(`${c.req.path}${searchOf(c)}`, 303);

  // ── Prototipos subidos: /p/<id>/... ─────────────────────────────────
  if (dataDir) {
    app.get(`${UPLOADED_PATH}/:id`, (c) => c.redirect(`${UPLOADED_PATH}/${c.req.param('id')}/${searchOf(c)}`, 301));
    app.get(`${UPLOADED_PATH}/:id/*`, async (c) => {
      const id = c.req.param('id');
      const proto = UPLOADED_ID.test(id) ? store.getPrototype(id) : null;
      if (!proto || proto.source !== 'upload') return notFound(c, 'No existe este prototipo');
      const mount = uploadedMount(id, proto.entryPath);
      const rel = c.req.path.slice(mount.base.length) || '/';
      return (await serveFrom(c, mount, rel, true)) ?? notFound(c);
    });
    app.post(`${UPLOADED_PATH}/:id/*`, formPost);
  }

  // ── Panel ──────────────────────────────────────────────────────────
  if (opts.recordSelf) {
    store.ensurePrototype({ id: PANEL_PROTOTYPE_ID, name: 'Panel de Taptana', createdAt: Date.now() });
  }
  const panelIndex = join(panelDir, 'index.html');
  const sendPanel = async (c: Context): Promise<Response> => {
    c.header('cache-control', 'no-cache');
    c.header('x-frame-options', 'SAMEORIGIN'); // el panel no se incrusta en páginas de otros sitios
    let html: string;
    try {
      html = await fs.readFile(panelIndex, 'utf8');
    } catch {
      return c.html(panelPlaceholderPage());
    }
    if (opts.recordSelf) html = injectRecorder(html, { prototypeId: PANEL_PROTOTYPE_ID });
    return c.html(html);
  };
  app.use(PANEL_PATH, guard.pages);
  app.use(`${PANEL_PATH}/*`, guard.pages);
  app.get(PANEL_PATH, sendPanel);
  app.get(`${PANEL_PATH}/*`, async (c) => {
    const rel = c.req.path.slice(PANEL_PATH.length);
    const file = await resolveFile(panelDir, rel);
    if (file && !file.isHtml) {
      c.header('content-type', mimeFor(file.absolute));
      c.header('cache-control', rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return c.body(await readFile(file.absolute));
    }
    // Un archivo compilado que ya no existe es un 404 de verdad; lo demás son rutas del panel
    // (/panel/studies/…) y las resuelve la propia aplicación.
    if (rel.startsWith('/assets/')) return c.text('No encontrado', 404);
    return sendPanel(c);
  });

  // La dirección antigua del panel (/sessions) sigue funcionando para links guardados.
  const legacyPanel = (c: Context): Response => {
    const rest = c.req.path.slice(LEGACY_PANEL_PATH.length).replace(/\/+$/, '');
    const first = rest.split('/')[1] ?? '';
    let target: string = PANEL_PATH;
    if (['studies', 'prototypes', 'assets'].includes(first)) target = `${PANEL_PATH}${rest}`;
    else if (first) target = `${PANEL_PATH}/recordings${rest}`;
    return c.redirect(`${target}${searchOf(c)}`, 302);
  };
  app.get(LEGACY_PANEL_PATH, legacyPanel);
  app.get(`${LEGACY_PANEL_PATH}/*`, legacyPanel);

  // ── La raíz ────────────────────────────────────────────────────────
  /** Direcciones nuestras: si ninguna ruta de arriba las atendió, no existen (no son del prototipo). */
  const isReserved = (path: string): boolean => path.startsWith('/api/') || path.startsWith('/__taptana/');

  app.get('/*', async (c) => {
    const path = c.req.path;
    if (isReserved(path)) return c.notFound();
    const mount = rootMount();

    // Un link de estudio que apunta a la raíz pero cuyo prototipo vive en /p/<id>/ (o no hay
    // nada en la raíz): se manda al participante a su prototipo, con el link intacto.
    const studyId = path === '/' ? c.req.query(STUDY_PARAM) : undefined;
    if (studyId) {
      const study = store.getStudy(studyId);
      if (study && study.prototypeId !== mount?.prototypeId && dataDir && UPLOADED_ID.test(study.prototypeId)) {
        if (store.getPrototype(study.prototypeId)?.source === 'upload') {
          return c.redirect(`${UPLOADED_PATH}/${study.prototypeId}/${searchOf(c)}`, 302);
        }
      }
    }

    if (mount) {
      const direct = await serveFrom(c, mount, path, false);
      if (direct) return direct;
    }

    // Rutas absolutas de un prototipo subido ("/css/app.css", "/checkout/"): se salen de
    // /p/<id>/, pero la página que las pide dice de dónde viene.
    const referer = c.req.header('referer');
    if (referer && dataDir) {
      const from = /^\/p\/(pr_[A-Za-z0-9]+)\//.exec(pathOf(referer));
      if (from && store.getPrototype(from[1] as string)?.source === 'upload') {
        return c.redirect(`${UPLOADED_PATH}/${from[1]}${path}${searchOf(c)}`, 307);
      }
    }

    if (mount) {
      const fallback = await serveFrom(c, mount, path, true);
      if (fallback) return fallback;
      return notFound(c);
    }

    // Nada en la raíz: casi seguro un participante con el link incompleto. El panel solo se
    // le ofrece a quien está en la computadora de Taptana.
    if (path === '/') {
      c.header('cache-control', 'no-store');
      const page = lostPage({ showPanelLink: guard.isLocal(c), ...(studyId && { brokenStudyLink: true }) });
      return c.html(page, studyId ? 404 : 200);
    }
    return notFound(c);
  });
  app.post('/*', (c) => (!isReserved(c.req.path) && rootMount() ? formPost(c) : c.notFound()));

  return app;
}

/** La ruta de una URL completa ("http://host/p/pr_1/index.html" → "/p/pr_1/index.html"). */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}
