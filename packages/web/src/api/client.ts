/**
 * El panel nunca accede a datos directamente: siempre a través de esta interfaz.
 * Así el modo demo (JSON estáticos, GitHub Pages) y el modo real (API) son intercambiables.
 */

import type {
  ManualResults,
  ServerInfo,
  SessionEventsResponse,
  SessionExport,
  SessionSummary,
  Study,
  StudyRecord,
} from '@taptana/shared';

export interface PrototypePage {
  path: string;
  title: string;
}

export interface ApiClient {
  readonly mode: 'http' | 'static';
  info(): Promise<ServerInfo>;

  listSessions(studyId?: string): Promise<SessionSummary[]>;
  getSessionEvents(id: string): Promise<SessionEventsResponse | null>;
  importSession(data: SessionExport): Promise<void>;
  deleteSession(id: string): Promise<void>;
  setManualResults(id: string, manual: ManualResults): Promise<SessionSummary>;

  listStudies(): Promise<StudyRecord[]>;
  getStudy(id: string): Promise<StudyRecord | null>;
  saveStudy(study: Study, id?: string): Promise<StudyRecord>;
  deleteStudy(id: string): Promise<void>;

  listPrototypePages(prototypeId: string): Promise<PrototypePage[]>;
  /** URL de una imagen QR para ese texto, o null si no hay forma de generarlo. */
  qrImageUrl(text: string): string | null;
}

declare const __TAPTANA_MODE__: 'http' | 'static';

let client: ApiClient | null = null;

export async function getClient(): Promise<ApiClient> {
  if (client) return client;
  if (__TAPTANA_MODE__ === 'static') {
    const { StaticClient } = await import('./static.ts');
    client = new StaticClient(import.meta.env.BASE_URL);
  } else {
    const { HttpClient } = await import('./http.ts');
    client = new HttpClient();
  }
  return client;
}

export function parseSessionFile(text: string): SessionExport {
  const data = JSON.parse(text) as Partial<SessionExport>;
  if (data?.v !== 1 || !data.session?.id || !Array.isArray(data.events)) {
    throw new Error('Este archivo no es una sesión de Taptana.');
  }
  return data as SessionExport;
}
