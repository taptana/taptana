/**
 * Forma de las peticiones y respuestas HTTP entre recorder, panel y server.
 */

import type { TaptanaEvent } from './events.js';
import type { DeviceInfo, PageInfo, Prototype, SessionPage, SessionSummary } from './session.js';
import type { ManualResults, StudyRecord } from './study.js';

export const API_PREFIX = '/api/v1';
export const RECORDER_PATH = '/__taptana/recorder.js';
export const PANEL_PATH = '/sessions';
/** Prototipos subidos se sirven en /p/<id>/. */
export const UPLOADED_PATH = '/p';
export const DEFAULT_PORT = 4321;
export const DEFAULT_HOST = '0.0.0.0';

/** Cada cuánto manda el recorder un lote, y a partir de cuántos eventos lo manda antes. */
export const BATCH_INTERVAL_MS = 3000;
export const BATCH_MAX_EVENTS = 200;
/** Límite práctico de navigator.sendBeacon. */
export const BEACON_MAX_BYTES = 60_000;

/** Lo que el recorder manda a POST /api/v1/events. */
export interface EventBatch {
  v: 1;
  prototypeId: string;
  sessionId: string;
  pageId: string;
  /** 0, 1, 2... número del lote dentro de la página. */
  seq: number;
  sentAt: number;
  events: TaptanaEvent[];
  /** Solo en el primer lote de cada página (seq === 0). */
  page?: PageInfo;
  /** Solo en el primer lote de cada página (seq === 0). */
  device?: DeviceInfo;
}

export interface EventBatchResponse {
  ok: true;
  received: number;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
}

export interface SessionEventsResponse {
  session: SessionSummary;
  pages: SessionPage[];
  events: TaptanaEvent[];
  /** El estudio, si la sesión pertenece a uno. */
  study?: StudyRecord;
}

export interface StudyListResponse {
  studies: StudyRecord[];
}

export interface PrototypeListResponse {
  prototypes: Prototype[];
}

/** Páginas HTML del prototipo, para los desplegables del constructor. */
export interface PrototypePagesResponse {
  pages: Array<{ path: string; title: string }>;
}

/** GET /api/v1/info: lo que el panel necesita saber del servidor. */
export interface ServerInfo {
  version: string;
  /** URL que abre el participante (IP de la red local). */
  participantUrl: string;
  prototypeId: string;
  prototypeName: string;
}

/** PATCH /api/v1/sessions/:id */
export interface SessionPatch {
  manual?: ManualResults;
}

/**
 * Sesión exportada como archivo. Es lo que produce el recorder en modo local y lo que el
 * panel importa. Misma forma que SessionEventsResponse, con versión para poder cambiarla.
 */
export interface SessionExport extends SessionEventsResponse {
  v: 1;
  exportedAt: number;
}

export interface ApiError {
  error: string;
}
