/**
 * El transporte HTTP ("Streamable HTTP" mínimo y sin estado): el servidor de Taptana lo monta en
 * `POST /mcp`. Una petición JSON-RPC recibe su respuesta como `application/json`; un mensaje
 * que solo trae notificaciones recibe 202 sin cuerpo.
 */

import { JSONRPC_ERRORS, rpcError, type McpHandler } from './handler.js';

export interface HttpReply {
  status: 200 | 202 | 400;
  /** Sin cuerpo cuando es 202. */
  json?: unknown;
}

export async function handleHttpBody(handler: McpHandler, body: string): Promise<HttpReply> {
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return { status: 400, json: rpcError(null, JSONRPC_ERRORS.parse, 'Parse error') };
  }
  const reply = await handler.handle(message);
  return reply === null ? { status: 202 } : { status: 200, json: reply };
}
