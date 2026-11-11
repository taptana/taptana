/**
 * `POST /mcp`: el MCP de Taptana por HTTP ("Streamable HTTP" mínimo y sin estado), para que una
 * herramienta de IA en esta computadora se conecte con solo la dirección.
 *
 * Pasa por la guardia del panel igual que la API (conexión local, o la llave en
 * `x-taptana-key` o `Authorization: Bearer`), y rechaza lo que venga de otro sitio web. Las
 * herramientas llaman a la propia app con `app.request`: un solo camino, el mismo de la API.
 */

import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMcpHandler, fetchInit, handleHttpBody, MCP_PATH, readResponse } from '@taptana/mcp';
import type { PanelGuard } from '../panel-guard.js';

/** Un estudio pesa mucho menos; un prototipo de una página con imágenes adentro, a veces más. */
const MCP_MAX_BYTES = 16 * 1024 * 1024;

export function mountMcp(app: Hono, opts: { guard: PanelGuard; publicUrl?: string | undefined }): void {
  const request = async (method: string, path: string, body?: unknown) => readResponse(await app.request(path, fetchInit(method, body)));

  app.use(MCP_PATH, opts.guard.mcp);
  app.post(
    MCP_PATH,
    bodyLimit({ maxSize: MCP_MAX_BYTES, onError: (c) => c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'El mensaje pesa más de 16 MB.' } }, 413) }),
    async (c: Context) => {
      // Los links del panel salen con la dirección con que nos llamaron.
      const panelUrl = opts.publicUrl ?? `${new URL(c.req.url).origin}/`;
      const handler = createMcpHandler({ request, panelUrl });
      const reply = await handleHttpBody(handler, await c.req.text());
      c.header('cache-control', 'no-store');
      if (reply.status === 202) return c.body(null, 202);
      return c.json(reply.json, reply.status);
    },
  );
  // Sin estado: no hay flujo de eventos que abrir ni sesión que cerrar.
  const notAllowed = (c: Context): Response => {
    c.header('allow', 'POST');
    return c.json({ error: 'El MCP de Taptana solo acepta POST.' }, 405);
  };
  app.get(MCP_PATH, notAllowed);
  app.delete(MCP_PATH, notAllowed);
}
