/**
 * El transporte stdio: la herramienta de IA arranca este proceso y le habla por la entrada y la
 * salida estándar, un mensaje JSON por línea. Por la salida solo sale protocolo; los avisos van
 * a stderr. Las herramientas llaman por HTTP a un Taptana que ya está corriendo.
 */

import { createInterface } from 'node:readline';
import { DEFAULT_PORT } from '@taptana/shared';
import { fetchInit, FriendlyError, readResponse, type ApiRequest } from './api.js';
import { createMcpHandler, JSONRPC_ERRORS, rpcError } from './handler.js';

export const DEFAULT_URL = `http://localhost:${DEFAULT_PORT}`;
/** Cabecera con la llave del panel (la misma que acepta la guardia). */
export const KEY_HEADER = 'x-taptana-key';
const TIMEOUT_MS = 30_000;

export function unreachableMessage(url: string): string {
  return `No pude conectarme con Taptana en ${url}. ¿Está corriendo? Abre una terminal en la carpeta de Taptana y corre «pnpm start» (o «taptana start»). Si usa otro puerto o está en otra computadora, cambia TAPTANA_URL en la configuración del MCP.`;
}

/** `request` contra un Taptana por HTTP. Si no responde, el error se le explica a la persona. */
export function createFetchRequest(opts: { url: string; key?: string | undefined }): ApiRequest {
  const base = opts.url.replace(/\/+$/, '');
  const headers: Record<string, string> = opts.key ? { [KEY_HEADER]: opts.key } : {};
  return async (method, path, body) => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { ...fetchInit(method, body, headers), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new FriendlyError(unreachableMessage(base));
    }
    return readResponse(res);
  };
}

export interface StdioOptions {
  url?: string | undefined;
  key?: string | undefined;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Para pruebas: otra forma de llegar a la API. */
  request?: ApiRequest;
}

/** Atiende mensajes hasta que se cierra la entrada. */
export async function runStdio(opts: StdioOptions = {}): Promise<void> {
  const url = (opts.url || DEFAULT_URL).replace(/\/+$/, '');
  const handler = createMcpHandler({ request: opts.request ?? createFetchRequest({ url, key: opts.key }), panelUrl: `${url}/` });
  const output = opts.output ?? process.stdout;
  const write = (value: unknown): void => {
    output.write(`${JSON.stringify(value)}\n`);
  };
  const lines = createInterface({ input: opts.input ?? process.stdin, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write(rpcError(null, JSONRPC_ERRORS.parse, 'Parse error'));
      continue;
    }
    // Cada mensaje se atiende por su cuenta: una herramienta lenta no traba un ping.
    const job = handler.handle(message).then((reply) => {
      if (reply !== null) write(reply);
    });
    pending.add(job);
    void job.finally(() => pending.delete(job));
  }
  await Promise.all(pending);
}
