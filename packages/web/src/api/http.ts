import {
  API_PREFIX,
  type ManualResults,
  type Prototype,
  type PrototypeListResponse,
  type PrototypePagesResponse,
  type ServerInfo,
  type SessionEventsResponse,
  type SessionExport,
  type SessionListResponse,
  type SessionSummary,
  type Study,
  type StudyListResponse,
  type StudyRecord,
  type StudyReport,
} from '@taptana/shared';
import type { ApiClient, PrototypePage } from './client.ts';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, init);
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* sin cuerpo */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export class HttpClient implements ApiClient {
  readonly mode = 'http' as const;
  readonly canUpload = true;

  info(): Promise<ServerInfo> {
    return request<ServerInfo>('/info');
  }

  async listSessions(studyId?: string): Promise<SessionSummary[]> {
    const q = studyId ? `?study=${encodeURIComponent(studyId)}` : '';
    return (await request<SessionListResponse>(`/sessions${q}`)).sessions;
  }

  async getSessionEvents(id: string): Promise<SessionEventsResponse | null> {
    const res = await fetch(`${API_PREFIX}/sessions/${encodeURIComponent(id)}/events`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`No se pudo cargar la sesión (${res.status})`);
    return (await res.json()) as SessionEventsResponse;
  }

  async importSession(data: SessionExport): Promise<void> {
    await request('/sessions/import', json('POST', data));
  }

  async deleteSession(id: string): Promise<void> {
    await request(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  setManualResults(id: string, manual: ManualResults): Promise<SessionSummary> {
    return request<SessionSummary>(`/sessions/${encodeURIComponent(id)}`, json('PATCH', { manual }));
  }

  async listStudies(): Promise<StudyRecord[]> {
    return (await request<StudyListResponse>('/studies')).studies;
  }

  async getStudy(id: string): Promise<StudyRecord | null> {
    const res = await fetch(`${API_PREFIX}/studies/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`No se pudo cargar el estudio (${res.status})`);
    return (await res.json()) as StudyRecord;
  }

  saveStudy(study: Study, id?: string): Promise<StudyRecord> {
    return id ? request<StudyRecord>(`/studies/${encodeURIComponent(id)}`, json('PUT', study)) : request<StudyRecord>('/studies', json('POST', study));
  }

  async deleteStudy(id: string): Promise<void> {
    await request(`/studies/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async getStudyReport(id: string): Promise<StudyReport | null> {
    const res = await fetch(`${API_PREFIX}/studies/${encodeURIComponent(id)}/report`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`No se pudo cargar el reporte (${res.status})`);
    return (await res.json()) as StudyReport;
  }

  async listPrototypePages(prototypeId: string): Promise<PrototypePage[]> {
    return (await request<PrototypePagesResponse>(`/prototypes/${encodeURIComponent(prototypeId)}/pages`)).pages;
  }

  async listPrototypes(): Promise<Prototype[]> {
    return (await request<PrototypeListResponse>('/prototypes')).prototypes;
  }

  uploadPrototype(file: File, opts: { name?: string; id?: string } = {}): Promise<Prototype> {
    const form = new FormData();
    form.append('file', file);
    if (opts.name) form.append('name', opts.name);
    return opts.id
      ? request<Prototype>(`/prototypes/${encodeURIComponent(opts.id)}`, { method: 'PUT', body: form })
      : request<Prototype>('/prototypes', { method: 'POST', body: form });
  }

  async deletePrototype(id: string): Promise<void> {
    await request(`/prototypes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  qrImageUrl(text: string): string {
    return `${API_PREFIX}/qr.svg?text=${encodeURIComponent(text)}`;
  }
}
