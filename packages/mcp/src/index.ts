export type { ApiRequest, ApiResponse } from './api.js';
export { FriendlyError, fetchInit, readResponse } from './api.js';
export type { JsonRpcResponse, McpHandler, McpHandlerOptions } from './handler.js';
export { createMcpHandler, INSTRUCTIONS, LATEST_PROTOCOL_VERSION, PROTOCOL_VERSIONS, SERVER_NAME, negotiateVersion, packageVersion } from './handler.js';
export type { HttpReply } from './http.js';
export { handleHttpBody } from './http.js';
export type { StdioOptions } from './stdio.js';
export { createFetchRequest, DEFAULT_URL, KEY_HEADER, runStdio, unreachableMessage } from './stdio.js';
export type { ToolDefinition, ToolResult } from './tools.js';
export { TOOLS, LOCKED_HINT } from './tools.js';
export { PROMPTS } from './prompts.js';
export { studyFormatGuide } from './guide.js';
export { summarizeReport } from './summary.js';
/** Ruta del endpoint HTTP en el servidor de Taptana. */
export const MCP_PATH = '/mcp';
