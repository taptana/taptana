/**
 * El panel nunca accede a datos directamente: siempre a través de esta interfaz.
 * Así el modo demo (JSON estáticos, GitHub Pages) y el modo real (API) son intercambiables.
 * Cada método existe en `http.ts` y en `static.ts`.
 *
 * Los métodos lanzan `UserError` (mensaje en español, listo para mostrar) cuando el fallo es
 * conocido; para cualquier otro error usa `friendlyError(e)` de `@/lib/errors`.
 */

import {
  validateSessionExport,
  type ExampleResponse,
  type Prototype,
  type ReportFilter,
  type ScreenInfo,
  type ServerInfo,
  type SessionEventsResponse,
  type SessionExport,
  type SessionPatch,
  type SessionSummary,
  type Study,
  type StudyRecord,
  type StudyReport,
} from '@taptana/shared';
import { UserError } from '@/lib/errors';

/**
 * Marcas del moderador que se mandan a la API: 'success', 'failure' o `null` para quitar la marca
 * (la tarea vuelve a "por revisar"). Más ancho que `ManualResults` de `shared` a propósito, para
 * compilar igual con o sin la versión de `shared` que ya acepta null.
 */
export type ManualMarks = Record<string, 'success' | 'failure' | null>;

/** Página HTML de un prototipo. Queda por compatibilidad: usa `listPrototypeScreens`. */
export interface PrototypePage {
  path: string;
  title: string;
}

export interface ApiClient {
  readonly mode: 'http' | 'static';
  /** Se pueden subir prototipos desde el panel. */
  readonly canUpload: boolean;
  /**
   * Si en este navegador no se puede subir ni guardar (demo sin service worker o sin
   * IndexedDB), la explicación en español; si todo está bien, null.
   */
  uploadProblem(): Promise<string | null>;

  info(): Promise<ServerInfo>;
  /** Carga el ejemplo (prototipo + estudio + sesiones). Idempotente. En la demo ya viene incluido. */
  loadExample(): Promise<ExampleResponse>;

  // ── Sesiones ──
  listSessions(studyId?: string): Promise<SessionSummary[]>;
  getSessionEvents(id: string): Promise<SessionEventsResponse | null>;
  /** Lanza `SessionExistsError` si la sesión ya existe y no se pidió `replace`. */
  importSession(data: SessionExport, opts?: { replace?: boolean }): Promise<{ id: string; replaced: boolean }>;
  deleteSession(id: string): Promise<void>;
  /** Etiqueta, notas, exclusión y marcas manuales. Solo cambia lo que viene. */
  patchSession(id: string, patch: SessionPatch): Promise<SessionSummary>;
  /** Atajo de `patchSession(id, { manual })`. Un valor `null` quita la marca de esa tarea. */
  setManualResults(id: string, manual: ManualMarks): Promise<SessionSummary>;

  // ── Estudios ──
  listStudies(): Promise<StudyRecord[]>;
  getStudy(id: string): Promise<StudyRecord | null>;
  saveStudy(study: Study, id?: string): Promise<StudyRecord>;
  deleteStudy(id: string): Promise<void>;
  /** Copia el estudio ("Copia de …") con ids de bloque nuevos. */
  duplicateStudy(id: string): Promise<StudyRecord>;
  getStudyReport(id: string, filter?: ReportFilter): Promise<StudyReport | null>;
  /** El CSV del estudio (una fila por participante) como texto, o null si el estudio no existe. */
  exportStudyCsv(id: string): Promise<string | null>;

  // ── Prototipos ──
  listPrototypes(): Promise<Prototype[]>;
  /** Sube un .html o .zip. Con `id`, reemplaza los archivos de ese prototipo. */
  uploadPrototype(file: File, opts?: { name?: string; id?: string }): Promise<Prototype>;
  renamePrototype(id: string, name: string): Promise<Prototype>;
  /** "Abrir en la raíz" (solo con el servidor local; ver `canServeAtRoot`). */
  setPrototypeRoot(id: string, root: boolean): Promise<Prototype>;
  readonly canServeAtRoot: boolean;
  deletePrototype(id: string): Promise<void>;
  /** Pantallas conocidas: archivos HTML + pantallas vistas en sesiones. */
  listPrototypeScreens(prototypeId: string): Promise<ScreenInfo[]>;
  /** Solo los archivos HTML (compatibilidad). */
  listPrototypePages(prototypeId: string): Promise<PrototypePage[]>;

  /** URL de una imagen QR para ese texto, o null si no hay forma de generarlo. */
  qrImageUrl(text: string): string | null;
}

declare const __TAPTANA_MODE__: 'http' | 'static';

/** Modo del panel, conocido al compilar: no hace falta esperar al cliente para saberlo. */
export const PANEL_MODE: 'http' | 'static' = __TAPTANA_MODE__;
export const IS_DEMO = PANEL_MODE === 'static';

let client: Promise<ApiClient> | null = null;

export function getClient(): Promise<ApiClient> {
  if (!client) {
    client =
      __TAPTANA_MODE__ === 'static'
        ? import('./static.ts').then((m): ApiClient => new m.StaticClient(import.meta.env.BASE_URL))
        : import('./http.ts').then((m): ApiClient => new m.HttpClient());
    client.catch(() => {
      client = null;
    });
  }
  return client;
}

/** Lee y valida un archivo de sesión exportado. Lanza `UserError` si no lo es. */
export function parseSessionFile(text: string): SessionExport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UserError('Este archivo no es una sesión exportada de Taptana (no es un JSON válido).');
  }
  const result = validateSessionExport(raw);
  if (!result.ok) throw new UserError(result.error);
  return result.value;
}
