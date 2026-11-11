/**
 * Cómo habla el MCP con Taptana: una función chiquita, parecida a fetch, contra la API REST
 * (`/api/v1/...`). La pone cada transporte: stdio la arma con `fetch` hacia un Taptana que ya
 * está corriendo; el servidor la arma con su propia app Hono, sin pasar por la red.
 */

export interface ApiResponse {
  status: number;
  /** El JSON de la respuesta (o `null` si no trajo JSON). */
  data: unknown;
}

/**
 * `path` empieza con `/api/v1/`. `body` se manda como JSON, salvo un `FormData` (subir un
 * prototipo), que va tal cual.
 */
export type ApiRequest = (method: string, path: string, body?: unknown) => Promise<ApiResponse>;

/** Un problema que se le puede contar tal cual a quien usa la IA. */
export class FriendlyError extends Error {}

/** El mensaje de error que trae una respuesta de la API, o uno genérico. */
export function apiError(res: ApiResponse, fallback: string): string {
  const data = res.data as { error?: unknown } | null;
  if (data && typeof data.error === 'string') return data.error;
  return `${fallback} (Taptana respondió ${res.status}).`;
}

/** Arma la petición para `fetch`: JSON o FormData. */
export function fetchInit(method: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  const init: RequestInit = { method, headers: { accept: 'application/json', ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  return init;
}

/** Lee la respuesta como JSON si se puede. */
export async function readResponse(res: Response): Promise<ApiResponse> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data };
}
