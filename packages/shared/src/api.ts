/**
 * Forma de las peticiones y respuestas HTTP entre recorder, panel y server.
 */

import type { TaptanaEvent } from './events.js';
import type { DeviceInfo, PageInfo, Prototype, SessionPage, SessionSummary } from './session.js';
import type { ManualPatch, StudyRecord } from './study.js';

export const API_PREFIX = '/api/v1';
export const RECORDER_PATH = '/__taptana/recorder.js';
/** Donde vive el panel. Antes era '/sessions' (ver LEGACY_PANEL_PATH). */
export const PANEL_PATH = '/panel';
/** Ruta antigua del panel: el servidor la redirige a PANEL_PATH. */
export const LEGACY_PANEL_PATH = '/sessions';
/** Prototipos subidos se sirven en /p/<id>/. */
export const UPLOADED_PATH = '/p';
export const DEFAULT_PORT = 4321;
export const DEFAULT_HOST = '0.0.0.0';

/** Cada cuánto manda el recorder un lote, y a partir de cuántos eventos lo manda antes. */
export const BATCH_INTERVAL_MS = 3000;
export const BATCH_MAX_EVENTS = 200;
/** Límite práctico de navigator.sendBeacon. */
export const BEACON_MAX_BYTES = 60_000;
/** El recorder parte los lotes para que ninguno pase de este tamaño (un evento más grande viaja solo). */
export const BATCH_MAX_BYTES = 500_000;
/** Tiempo límite de cada petición del recorder. */
export const REQUEST_TIMEOUT_MS = 15_000;
/** Tamaño máximo del cuerpo que el servidor acepta en POST /events. */
export const EVENTS_BODY_MAX_BYTES = 16 * 1024 * 1024;

/** Ids del ejemplo que carga `POST /api/v1/example` (y que trae la demo). */
export const EXAMPLE_PROTOTYPE_ID = 'pr_ejemplo';
export const EXAMPLE_PROTOTYPE_NAME = 'Tienda de ejemplo';
export const EXAMPLE_STUDY_ID = 'st_demo_compra';

/** Lo que el recorder manda a POST /api/v1/events. */
export interface EventBatch {
  v: 1;
  prototypeId: string;
  sessionId: string;
  pageId: string;
  /** 0, 1, 2... número del lote dentro de la página. Un lote repetido se ignora. */
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
  /** Eventos guardados. 0 si el lote ya se había recibido. */
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

/** Páginas HTML del prototipo. Queda por compatibilidad: usa PrototypeScreensResponse. */
export interface PrototypePagesResponse {
  pages: Array<{ path: string; title: string }>;
}

/** Una pantalla conocida de un prototipo, para elegirla en el constructor. */
export interface ScreenInfo {
  /** ScreenId (ver screen.ts): "/producto.html", "/index.html#/carrito", "/index.html~checkout". */
  id: string;
  /** Nombre corto: "producto", "carrito", "checkout" (`screenLabel`). */
  label: string;
  /**
   * El nombre para mostrar, UNO por pantalla y el mismo en el constructor y en el reporte
   * (`screenName`): el título estable si lo hay, y si no `label`. `knownScreens` siempre lo pone.
   */
  name?: string;
  /** Título estable (ver `screenTitles`): el `<title>` del archivo, o el encabezado si no cambia entre visitas. */
  title?: string;
  /** 'file': un archivo HTML del prototipo. 'seen': vista en alguna sesión. */
  source: 'file' | 'seen';
}

/** GET /api/v1/prototypes/:id/screens */
export interface PrototypeScreensResponse {
  screens: ScreenInfo[];
}

/** GET /api/v1/info: lo que el panel necesita saber del servidor. */
export interface ServerInfo {
  version: string;
  /** URL que abre el participante (IP de la red local). */
  participantUrl: string;
  prototypeId: string;
  prototypeName: string;
  /** Link del panel con la llave, para abrirlo desde otro dispositivo. Solo se entrega a quien ya pasó la guardia. */
  panelKeyUrl?: string;
  /** El ejemplo ya está cargado. */
  exampleLoaded?: boolean;
  /** 'local': servidor real. 'demo': sitio estático, los datos viven en este navegador. */
  mode?: 'local' | 'demo';
}

/** PATCH /api/v1/sessions/:id. Solo cambia los campos que vienen (`validateSessionPatch`). */
export interface SessionPatch {
  /**
   * Marcas del moderador por tarea. Se suman a las que ya había (una marca nueva reemplaza la
   * anterior de esa tarea); `null` quita la marca y la tarea vuelve a "por revisar"
   * (`applyManualPatch`).
   */
  manual?: ManualPatch;
  /** Etiqueta del moderador. Vacía la borra. */
  label?: string;
  /** Notas del moderador. Vacías las borra. */
  notes?: string;
  /** true: la sesión no cuenta en el reporte. */
  excluded?: boolean;
}

/** POST /api/v1/example: carga el ejemplo (prototipo + estudio + sesiones). Idempotente. */
export interface ExampleResponse {
  prototypeId: string;
  studyId: string;
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
