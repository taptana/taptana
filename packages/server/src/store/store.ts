/**
 * Interfaz Store: lo poco que el servidor necesita de una base de datos.
 * Hoy la implementa SQLite (sqlite.ts). Mañana, Postgres o D1, sin tocar las rutas.
 */

import type {
  EventBatch,
  Prototype,
  SessionEventsResponse,
  SessionExport,
  SessionSummary,
} from '@taptana/shared';

export interface Store {
  /** Crea el prototipo si no existe. */
  ensurePrototype(prototype: Prototype): void;
  /** Guarda un lote de eventos. Crea la sesión y la página si hacen falta. */
  ingestBatch(batch: EventBatch): { received: number };
  listSessions(prototypeId?: string): SessionSummary[];
  getSession(id: string): SessionSummary | null;
  /** Sesión completa con páginas y eventos, para el reproductor. */
  getSessionEvents(id: string): SessionEventsResponse | null;
  /** Importa una sesión exportada (modo local o de otra instalación). Reemplaza si ya existe. */
  importSession(data: SessionExport): void;
  deleteSession(id: string): boolean;
  close(): void;
}
