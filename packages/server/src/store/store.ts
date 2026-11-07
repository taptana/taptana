/**
 * Interfaz Store: lo poco que el servidor necesita de una base de datos.
 * Hoy la implementa SQLite (sqlite.ts). Mañana, Postgres o D1, sin tocar las rutas.
 */

import type {
  EventBatch,
  ManualResults,
  Prototype,
  SessionEventsResponse,
  SessionExport,
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
  /** Crea o actualiza (nombre, origen, entrada) un prototipo. */
  savePrototype(prototype: Prototype): Prototype;
  listPrototypes(): Prototype[];
  getPrototype(id: string): Prototype | null;
  /** Borra el prototipo con sus sesiones y estudios. */
  deletePrototype(id: string): boolean;
  /** Guarda un lote de eventos. Crea la sesión y la página si hacen falta. */
  ingestBatch(batch: EventBatch): { received: number };
  listSessions(filter?: ListSessionsFilter): SessionSummary[];
  getSession(id: string): SessionSummary | null;
  /** Sesión completa con páginas, eventos y estudio, para el reproductor. */
  getSessionEvents(id: string): SessionEventsResponse | null;
  /** Importa una sesión exportada (modo local o de otra instalación). Reemplaza si ya existe. */
  importSession(data: SessionExport): void;
  /** Marcas manuales del moderador por tarea. Se mezclan con las existentes. */
  setManualResults(sessionId: string, manual: ManualResults): boolean;
  deleteSession(id: string): boolean;

  listStudies(prototypeId?: string): StudyRecord[];
  getStudy(id: string): StudyRecord | null;
  /** Crea (sin id) o reemplaza (con id) un estudio. Devuelve el registro guardado. */
  saveStudy(study: Study, id?: string): StudyRecord;
  deleteStudy(id: string): boolean;

  close(): void;
}
