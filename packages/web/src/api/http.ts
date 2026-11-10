import {
  API_PREFIX,
  type ExampleResponse,
  type ManualResults,
  type Prototype,
  type PrototypeListResponse,
  type PrototypePagesResponse,
  type PrototypeScreensResponse,
  type ReportFilter,
  type ScreenInfo,
  type ServerInfo,
  type SessionEventsResponse,
  type SessionExport,
  type SessionListResponse,
  type SessionPatch,
  type SessionSummary,
  type Study,
  type StudyListResponse,
  type StudyRecord,
  type StudyReport,
} from '@taptana/shared';
import type { ApiClient, PrototypePage } from './client.ts';
import { SessionExistsError, UserError, statusMessage } from '@/lib/errors';

const OFFLINE = 'No pudimos conectar con Taptana. Revisa que siga abierta la terminal donde lo arrancaste y recarga la página.';

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_PREFIX}${path}`, init);
  } catch {
    throw new UserError(OFFLINE);
  }
}

/** El mensaje del servidor (ya viene en español) o uno propio según el código. */
async function failure(res: Response): Promise<{ message: string; body: Record<string, unknown> }> {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    /* sin cuerpo JSON (por ejemplo, la página 401 de la guardia) */
  }
  const fromServer = typeof body['error'] === 'string' && res.status !== 401 && res.status !== 403 ? (body['error'] as string) : '';
  return { message: fromServer || statusMessage(res.status), body };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init);
  if (!res.ok) throw new UserError((await failure(res)).message, res.status);
  try {
    return (await res.json()) as T;
  } catch {
    throw new UserError('Taptana respondió algo que el panel no entiende. Recarga la página.');
  }
}

/** Como `request`, pero un 404 es una respuesta válida (null). */
async function requestOrNull<T>(path: string): Promise<T | null> {
  const res = await send(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new UserError((await failure(res)).message, res.status);
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const id = encodeURIComponent;

export class HttpClient implements ApiClient {
  readonly mode = 'http' as const;
  readonly canUpload = true;
  readonly canServeAtRoot = true;

  async uploadProblem(): Promise<null> {
    return null;
  }

  info(): Promise<ServerInfo> {
    return request<ServerInfo>('/info');
  }

  loadExample(): Promise<ExampleResponse> {
    return request<ExampleResponse>('/example', { method: 'POST' });
  }

  // ── Sesiones ─────────────────────────────────────────────────────────

  async listSessions(studyId?: string): Promise<SessionSummary[]> {
    const q = studyId ? `?study=${id(studyId)}` : '';
    return (await request<SessionListResponse>(`/sessions${q}`)).sessions;
  }

  getSessionEvents(sessionId: string): Promise<SessionEventsResponse | null> {
    return requestOrNull<SessionEventsResponse>(`/sessions/${id(sessionId)}/events`);
  }

  async importSession(data: SessionExport, opts: { replace?: boolean } = {}): Promise<{ id: string; replaced: boolean }> {
    const res = await send(`/sessions/import${opts.replace ? '?replace=1' : ''}`, json('POST', data));
    if (res.status === 409) throw new SessionExistsError(data.session.id);
    if (!res.ok) throw new UserError((await failure(res)).message, res.status);
    const body = (await res.json()) as { id?: string; replaced?: boolean };
    return { id: body.id ?? data.session.id, replaced: body.replaced === true };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await request(`/sessions/${id(sessionId)}`, { method: 'DELETE' });
  }

  patchSession(sessionId: string, patch: SessionPatch): Promise<SessionSummary> {
    return request<SessionSummary>(`/sessions/${id(sessionId)}`, json('PATCH', patch));
  }

  setManualResults(sessionId: string, manual: ManualResults): Promise<SessionSummary> {
    return this.patchSession(sessionId, { manual });
  }

  // ── Estudios ─────────────────────────────────────────────────────────

  async listStudies(): Promise<StudyRecord[]> {
    return (await request<StudyListResponse>('/studies')).studies;
  }

  getStudy(studyId: string): Promise<StudyRecord | null> {
    return requestOrNull<StudyRecord>(`/studies/${id(studyId)}`);
  }

  saveStudy(study: Study, studyId?: string): Promise<StudyRecord> {
    return studyId ? request<StudyRecord>(`/studies/${id(studyId)}`, json('PUT', study)) : request<StudyRecord>('/studies', json('POST', study));
  }

  async deleteStudy(studyId: string): Promise<void> {
    await request(`/studies/${id(studyId)}`, { method: 'DELETE' });
  }

  duplicateStudy(studyId: string): Promise<StudyRecord> {
    return request<StudyRecord>(`/studies/${id(studyId)}/duplicate`, { method: 'POST' });
  }

  getStudyReport(studyId: string, filter: ReportFilter = {}): Promise<StudyReport | null> {
    const q = new URLSearchParams();
    if (filter.variantId) q.set('variant', filter.variantId);
    if (filter.device) q.set('device', filter.device);
    const qs = q.toString();
    return requestOrNull<StudyReport>(`/studies/${id(studyId)}/report${qs ? `?${qs}` : ''}`);
  }

  async exportStudyCsv(studyId: string): Promise<string | null> {
    const res = await send(`/studies/${id(studyId)}/export.csv`);
    if (res.status === 404) return null;
    if (!res.ok) throw new UserError((await failure(res)).message, res.status);
    return res.text();
  }

  // ── Prototipos ───────────────────────────────────────────────────────

  async listPrototypes(): Promise<Prototype[]> {
    return (await request<PrototypeListResponse>('/prototypes')).prototypes;
  }

  uploadPrototype(file: File, opts: { name?: string; id?: string } = {}): Promise<Prototype> {
    const form = new FormData();
    form.append('file', file);
    if (opts.name) form.append('name', opts.name);
    return opts.id ? request<Prototype>(`/prototypes/${id(opts.id)}`, { method: 'PUT', body: form }) : request<Prototype>('/prototypes', { method: 'POST', body: form });
  }

  renamePrototype(prototypeId: string, name: string): Promise<Prototype> {
    return request<Prototype>(`/prototypes/${id(prototypeId)}`, json('PATCH', { name }));
  }

  setPrototypeRoot(prototypeId: string, root: boolean): Promise<Prototype> {
    return request<Prototype>(`/prototypes/${id(prototypeId)}`, json('PATCH', { root }));
  }

  async deletePrototype(prototypeId: string): Promise<void> {
    await request(`/prototypes/${id(prototypeId)}`, { method: 'DELETE' });
  }

  async listPrototypeScreens(prototypeId: string): Promise<ScreenInfo[]> {
    return (await request<PrototypeScreensResponse>(`/prototypes/${id(prototypeId)}/screens`)).screens;
  }

  async listPrototypePages(prototypeId: string): Promise<PrototypePage[]> {
    return (await request<PrototypePagesResponse>(`/prototypes/${id(prototypeId)}/pages`)).pages;
  }

  qrImageUrl(text: string): string | null {
    return text.length > 2000 ? null : `${API_PREFIX}/qr.svg?text=${id(text)}`;
  }
}
