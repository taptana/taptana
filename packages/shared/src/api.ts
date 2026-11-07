/**
 * Forma de las peticiones y respuestas HTTP entre recorder, panel y server.
 */

import type { TaptanaEvent } from './events.js';
import type { DeviceInfo, PageInfo, SessionPage, SessionSummary } from './session.js';

export const API_PREFIX = '/api/v1';
export const RECORDER_PATH = '/__taptana/recorder.js';
export const PANEL_PATH = '/sessions';
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
}

/**
 * Sesión exportada como archivo. Es lo que produce el recorder en modo local y lo que el
 * panel importa. Misma forma que SessionEventsResponse, con versión para poder cambiarla.
 */
export interface SessionExport {
  v: 1;
  exportedAt: number;
  session: SessionSummary;
  pages: SessionPage[];
  events: TaptanaEvent[];
}

export interface ApiError {
  error: string;
}
