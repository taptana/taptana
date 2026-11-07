/**
 * Esquema SQLite: prototypes, studies, sessions, pages, events.
 * Un evento por fila, con el JSON completo en `data` y `kind`/`type` fuera para filtrar rápido.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS prototypes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS studies (
  id            TEXT PRIMARY KEY,
  prototype_id  TEXT NOT NULL REFERENCES prototypes(id),
  name          TEXT NOT NULL,
  data          TEXT NOT NULL,        -- el Study completo en JSON
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  prototype_id    TEXT NOT NULL REFERENCES prototypes(id),
  started_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  user_agent      TEXT,
  device_label    TEXT,
  screen_w        INTEGER,
  screen_h        INTEGER,
  viewport_w      INTEGER,
  viewport_h      INTEGER,
  dpr             REAL,
  touch           INTEGER,
  language        TEXT,
  entry_path      TEXT,
  study_id        TEXT,
  variant_id      TEXT,
  manual_results  TEXT                -- JSON { taskId: 'success' | 'failure' }
);

CREATE TABLE IF NOT EXISTS pages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  title         TEXT,
  referrer      TEXT,
  started_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page_id       TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  t             INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  type          TEXT,
  data          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_session_t ON events (session_id, t);
CREATE INDEX IF NOT EXISTS events_session_type ON events (session_id, type);
CREATE INDEX IF NOT EXISTS pages_session ON pages (session_id, started_at);
CREATE INDEX IF NOT EXISTS sessions_prototype ON sessions (prototype_id, started_at);
CREATE INDEX IF NOT EXISTS sessions_study ON sessions (study_id, started_at);
`;

/**
 * Columnas agregadas después de v0.1. Las bases viejas se actualizan al abrir.
 * Formato: [tabla, columna, definición].
 */
export const MIGRATIONS: Array<[string, string, string]> = [
  ['sessions', 'study_id', 'TEXT'],
  ['sessions', 'variant_id', 'TEXT'],
  ['sessions', 'manual_results', 'TEXT'],
];
