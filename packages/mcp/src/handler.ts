/**
 * El núcleo del MCP: recibe un mensaje JSON-RPC 2.0 y devuelve la respuesta (o `null` si era
 * una notificación). No sabe de transportes: stdio y HTTP lo usan igual.
 *
 * Implementa solo lo que Taptana necesita del protocolo: `initialize` (con negociación de
 * versión), `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `prompts/list` y
 * `prompts/get`. Es sin estado: cada mensaje se atiende solo.
 */

import { readFileSync } from 'node:fs';
import type { ApiRequest } from './api.js';
import { PROMPTS, promptMessages } from './prompts.js';
import { runTool, TOOLS, type ToolContext } from './tools.js';

/** Versiones del protocolo que conocemos, de la más nueva a la más vieja. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const LATEST_PROTOCOL_VERSION = PROTOCOL_VERSIONS[0];

export const SERVER_NAME = 'taptana';

export const INSTRUCTIONS =
  'Taptana es una herramienta de pruebas de usabilidad para prototipos HTML en celulares reales. ' +
  'Con estas herramientas puedes ver los prototipos y sus pantallas, escribir un estudio (formato v2, por bloques), revisarlo, guardarlo y leer su reporte. ' +
  'Para armar un estudio: get_study_format → list_prototypes → list_screens → get_screen_html → escribe el estudio → validate_study → create_study → entrega el link tryout. ' +
  'Usa solo pantallas de list_screens y selectores o textos que veas en get_screen_html; no los inventes. Escribe los textos para participantes en español, de tú. ' +
  'No hay herramientas para borrar ni para ver grabaciones.';

export const JSONRPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

type Id = string | number | null;

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: Id;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpHandlerOptions extends Omit<ToolContext, 'request'> {
  request: ApiRequest;
}

export interface McpHandler {
  /** Un mensaje o un lote (arreglo). `null`: no hay nada que responder (solo notificaciones). */
  handle(message: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null>;
}

let version: string | undefined;
export function packageVersion(): string {
  if (version === undefined) {
    try {
      version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
    } catch {
      version = '0.0.0';
    }
  }
  return version;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const ok = (id: Id, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
export const rpcError = (id: Id, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, ...(data !== undefined && { data }) },
});

export function negotiateVersion(requested: unknown): string {
  return typeof requested === 'string' && (PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
}

export function createMcpHandler(opts: McpHandlerOptions): McpHandler {
  const ctx: ToolContext = { request: opts.request, ...(opts.panelUrl && { panelUrl: opts.panelUrl }) };

  const one = async (message: unknown): Promise<JsonRpcResponse | null> => {
    if (!isRecord(message) || message['jsonrpc'] !== '2.0' || typeof message['method'] !== 'string') {
      // Una respuesta del cliente (no pedimos nada, así que se ignora) o algo que no es JSON-RPC.
      if (isRecord(message) && message['jsonrpc'] === '2.0' && ('result' in message || 'error' in message)) return null;
      const id = isRecord(message) && (typeof message['id'] === 'string' || typeof message['id'] === 'number') ? message['id'] : null;
      return rpcError(id, JSONRPC_ERRORS.invalidRequest, 'Invalid Request');
    }
    const method = message['method'];
    const hasId = 'id' in message;
    const id = (hasId ? message['id'] : null) as Id;
    const params = isRecord(message['params']) ? message['params'] : {};

    // Notificaciones: no llevan respuesta.
    if (!hasId) return null;

    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: negotiateVersion(params['protocolVersion']),
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, title: 'Taptana', version: packageVersion() },
          instructions: INSTRUCTIONS,
        });
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, {
          tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...t.annotations } })),
        });
      case 'tools/call': {
        const name = params['name'];
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) return rpcError(id, JSONRPC_ERRORS.invalidParams, `Unknown tool: ${String(name)}`);
        const args = isRecord(params['arguments']) ? params['arguments'] : {};
        return ok(id, await runTool(tool, args, ctx));
      }
      case 'prompts/list':
        return ok(id, { prompts: PROMPTS });
      case 'prompts/get': {
        const name = params['name'];
        const prompt = PROMPTS.find((p) => p.name === name);
        if (!prompt) return rpcError(id, JSONRPC_ERRORS.invalidParams, `Unknown prompt: ${String(name)}`);
        const args = isRecord(params['arguments']) ? params['arguments'] : {};
        return ok(id, promptMessages(prompt.name, args));
      }
      default:
        return rpcError(id, JSONRPC_ERRORS.methodNotFound, `Method not found: ${method}`);
    }
  };

  const safe = async (message: unknown): Promise<JsonRpcResponse | null> => {
    try {
      return await one(message);
    } catch (err) {
      const id = isRecord(message) && (typeof message['id'] === 'string' || typeof message['id'] === 'number') ? message['id'] : null;
      return rpcError(id, JSONRPC_ERRORS.internal, err instanceof Error ? err.message : 'Internal error');
    }
  };

  return {
    async handle(message) {
      if (!Array.isArray(message)) return safe(message);
      if (message.length === 0) return rpcError(null, JSONRPC_ERRORS.invalidRequest, 'Invalid Request');
      const out = (await Promise.all(message.map(safe))).filter((r): r is JsonRpcResponse => r !== null);
      return out.length > 0 ? out : null;
    },
  };
}
