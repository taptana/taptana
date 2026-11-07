import {
  API_PREFIX,
  type SessionEventsResponse,
  type SessionExport,
  type SessionListResponse,
  type SessionSummary,
} from '@taptana/shared';
import type { ApiClient } from './client.ts';

export class HttpClient implements ApiClient {
  readonly mode = 'http' as const;

  async listSessions(): Promise<SessionSummary[]> {
    const res = await fetch(`${API_PREFIX}/sessions`);
    if (!res.ok) throw new Error(`No se pudo cargar la lista (${res.status})`);
    return ((await res.json()) as SessionListResponse).sessions;
  }

  async getSessionEvents(id: string): Promise<SessionEventsResponse | null> {
    const res = await fetch(`${API_PREFIX}/sessions/${encodeURIComponent(id)}/events`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`No se pudo cargar la sesión (${res.status})`);
    return (await res.json()) as SessionEventsResponse;
  }

  async importSession(data: SessionExport): Promise<void> {
    const res = await fetch(`${API_PREFIX}/sessions/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`No se pudo importar (${res.status})`);
  }

  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`${API_PREFIX}/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`No se pudo borrar (${res.status})`);
  }
}
