/**
 * Interfaz Store: lo poco que el servidor necesita de una base de datos.
 * Hoy la implementa SQLite (sqlite.ts). Mañana, Postgres o D1, sin tocar las rutas.
 */

import type {
  EventBatch,
  Prototype,
  ReportSession,
  ScreenInfo,
  SessionEventsResponse,
  SessionExport,
  SessionPatch,
  SessionSummary,
  Study,
  StudyRecord,
} from '@taptana/shared';

export interface ListSessionsFilter {
  prototypeId?: string;
  studyId?: string;
}

export interface Store {
  /** Crea el prototipo si no existe. */
  ensurePrototype(prototype: Prototype): void;
  /** Crea o actualiza (nombre, origen, entrada, rutas absolutas) un prototipo. No toca `root`. */
  savePrototype(prototype: Prototype): Prototype;
  /** Los prototipos sin archivos (creados al importar una sesión) vienen sin `source`. */
  listPrototypes(): Prototype[];
  getPrototype(id: string): Prototype | null;
  /** Deja `id` como el único prototipo servido en "/". Con null, ninguno. */
  setRootPrototype(id: string | null): void;
  /** El prototipo subido que se sirve en "/", si hay uno. */
  getRootPrototype(): Prototype | null;
  /** Borra el prototipo con sus sesiones y estudios. */
  deletePrototype(id: string): boolean;

  /**
   * Guarda un lote de eventos. Crea la sesión y la página si hacen falta. Un lote repetido
   * (misma sesión, página y `seq`) se ignora: `received: 0`.
   */
  ingestBatch(batch: EventBatch): { received: number };
  /** Resúmenes con `tasks`, `answers` y `screenCount`. No lee los eventos de rrweb. */
  listSessions(filter?: ListSessionsFilter): SessionSummary[];
  getSession(id: string): SessionSummary | null;
  hasSession(id: string): boolean;
  /** Sesión completa con páginas, eventos y estudio, para el reproductor. */
  getSessionEvents(id: string): SessionEventsResponse | null;
  /**
   * Importa una sesión exportada (ya validada con `validateSessionExport`). Reemplaza la que
   * tenga el mismo id. Si su prototipo no existe, lo crea visible con el nombre "Importado".
   */
  importSession(data: SessionExport): void;
  /** Etiqueta, notas, exclusión y marcas manuales (estas se suman a las que ya había). */
  setSessionFields(sessionId: string, patch: SessionPatch): boolean;
  deleteSession(id: string): boolean;
  /** Las sesiones de un estudio con sus eventos propios (sin rrweb), para el reporte y el CSV. */
  listReportSessions(studyId: string): ReportSession[];
  /**
   * Pantallas conocidas de un prototipo: sus archivos HTML (los pasa quien llama, que es quien
   * sabe dónde están) más las pantallas vistas en sus sesiones.
   */
  listScreens(prototypeId: string, files?: ReadonlyArray<{ path: string; title?: string }>): ScreenInfo[];

  /** Siempre en formato v2 (`blocks`), aunque se hayan guardado como v1. */
  listStudies(prototypeId?: string): StudyRecord[];
  getStudy(id: string): StudyRecord | null;
  /** Crea (sin id, o con un id que no existe) o reemplaza un estudio. Devuelve el registro guardado. */
  saveStudy(study: Study, id?: string): StudyRecord;
  /** Copia un estudio ("Copia de …") con ids de bloque nuevos. null si no existe. */
  duplicateStudy(id: string): StudyRecord | null;
  deleteStudy(id: string): boolean;

  close(): void;
}
