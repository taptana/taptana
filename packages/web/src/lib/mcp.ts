/**
 * La configuración que el diseñador copia en su herramienta de IA para conectarla a Taptana por
 * MCP (ver docs/mcp.md). Dos formas: con la dirección (`/mcp` de este servidor) o con un
 * comando (stdio). El formato `mcpServers` lo entienden Claude Desktop, Cursor y LM Studio.
 */

export const MCP_DOC_URL = 'https://github.com/taptana/taptana/blob/main/docs/mcp.md';
/** Cuando el panel no sabe dónde quedó instalado Taptana. */
export const MCP_BIN_PLACEHOLDER = '/ruta/a/taptana/packages/mcp/dist/bin.js';
export const KEY_PLACEHOLDER = '<tu llave del panel>';

export interface McpSnippets {
  url: string;
  /** JSON con la dirección. */
  http: string;
  /** JSON con el comando. */
  stdio: string;
  /** Una línea para la terminal de Claude Code. */
  claudeCode: string;
}

/**
 * `origin`: la dirección del panel ("http://localhost:4321"). `local`: el panel está abierto en
 * la computadora de Taptana; si no, hace falta la llave y la configuración la lleva.
 */
export function mcpSnippets(opts: { origin: string; local: boolean; bin?: string | undefined }): McpSnippets {
  const origin = opts.origin.replace(/\/+$/, '');
  const url = `${origin}/mcp`;
  const headers = opts.local ? {} : { headers: { Authorization: `Bearer ${KEY_PLACEHOLDER}` } };
  const env = opts.local ? { TAPTANA_URL: origin } : { TAPTANA_URL: origin, TAPTANA_KEY: KEY_PLACEHOLDER };
  const json = (server: unknown): string => JSON.stringify({ mcpServers: { taptana: server } }, null, 2);
  return {
    url,
    http: json({ url, ...headers }),
    stdio: json({ command: 'node', args: [opts.bin ?? MCP_BIN_PLACEHOLDER], env }),
    claudeCode: `claude mcp add --transport http taptana ${url}${opts.local ? '' : ` --header "Authorization: Bearer ${KEY_PLACEHOLDER}"`}`,
  };
}
