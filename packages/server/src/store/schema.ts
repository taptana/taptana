/**
 * Esquema SQLite: prototypes, studies, sessions, pages, events, batches.
 * Un evento por fila, con el JSON completo en `data` y `kind`/`type` fuera para filtrar rápido.
 *
 * Abrir una base tiene tres pasos, en este orden (ver SqliteStore.migrate):
 *   1. TABLES   crea las tablas que falten, con la forma actual.
 *   2. COLUMNS  agrega a las tablas de versiones anteriores las columnas nuevas, y
 *               reconstruye `pages` y `events` si todavía usan la clave vieja.
 *   3. INDEXES  crea los índices. Van al final porque algunos usan columnas migradas: crearlos
 *               antes hacía que una base de v0.1 no abriera ("no such column: study_id").
 */
export const TABLES = `
CREATE TABLE IF NOT EXISTS prototypes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  source        TEXT NOT NULL DEFAULT 'folder',  -- 'folder' | 'upload' | 'url' | 'import' (sin archivos)
  entry_path    TEXT,
  root          INTEGER NOT NULL DEFAULT 0,      -- 1: servido también en "/" (uno a la vez)
  absolute_urls INTEGER NOT NULL DEFAULT 0,      -- 1: su HTML de entrada usa rutas absolutas
  source_url    TEXT                             -- solo 'url': el sitio que Taptana sirve en /p/<id>/
);

CREATE TABLE IF NOT EXISTS studies (
  id            TEXT PRIMARY KEY,
  prototype_id  TEXT NOT NULL REFERENCES prototypes(id),
  name          TEXT NOT NULL,
  data          TEXT NOT NULL,        -- el Study completo en JSON (v2; lo antiguo se normaliza al leer)
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
  manual_results  TEXT,               -- JSON { taskId: 'success' | 'failure' }
  label           TEXT,               -- etiqueta del moderador
  participant     TEXT,               -- alias que escribió el participante
  notes           TEXT,               -- notas del moderador
  excluded        INTEGER NOT NULL DEFAULT 0
);

${pagesTable('pages')}

${eventsTable('events')}

-- Lotes ya recibidos: un lote reintentado no se guarda dos veces.
CREATE TABLE IF NOT EXISTS batches (
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page_id       TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  events        INTEGER NOT NULL DEFAULT 0,   -- cuántos eventos traía
  PRIMARY KEY (session_id, page_id, seq)
) WITHOUT ROWID;
`;

/** El id de página lo elige el recorder: solo es único dentro de su sesión. */
export function pagesTable(name: string): string {
  return `CREATE TABLE IF NOT EXISTS ${name} (
  id            TEXT NOT NULL,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  title         TEXT,
  referrer      TEXT,
  started_at    INTEGER NOT NULL,
  PRIMARY KEY (session_id, id)
);`;
}

export function eventsTable(name: string): string {
  return `CREATE TABLE IF NOT EXISTS ${name} (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  page_id       TEXT NOT NULL,
  t             INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  type          TEXT,                 -- solo en eventos propios; NULL en los de rrweb
  data          TEXT NOT NULL,
  FOREIGN KEY (session_id, page_id) REFERENCES pages(session_id, id) ON DELETE CASCADE
);`;
}

export const INDEXES = `
CREATE INDEX IF NOT EXISTS events_session_t ON events (session_id, t);
CREATE INDEX IF NOT EXISTS events_session_type ON events (session_id, type);
CREATE INDEX IF NOT EXISTS pages_session ON pages (session_id, started_at);
CREATE INDEX IF NOT EXISTS sessions_prototype ON sessions (prototype_id, started_at);
CREATE INDEX IF NOT EXISTS sessions_study ON sessions (study_id, started_at);
CREATE INDEX IF NOT EXISTS studies_prototype ON studies (prototype_id);
`;

/**
 * Columnas agregadas después de v0.1. Las bases viejas se actualizan al abrir.
 * Formato: [tabla, columna, definición].
 */
export const COLUMNS: Array<[string, string, string]> = [
  ['sessions', 'study_id', 'TEXT'],
  ['sessions', 'variant_id', 'TEXT'],
  ['sessions', 'manual_results', 'TEXT'],
  ['sessions', 'label', 'TEXT'],
  ['sessions', 'participant', 'TEXT'],
  ['sessions', 'notes', 'TEXT'],
  ['sessions', 'excluded', 'INTEGER NOT NULL DEFAULT 0'],
  ['prototypes', 'source', "TEXT NOT NULL DEFAULT 'folder'"],
  ['prototypes', 'entry_path', 'TEXT'],
  ['prototypes', 'root', 'INTEGER NOT NULL DEFAULT 0'],
  ['prototypes', 'absolute_urls', 'INTEGER NOT NULL DEFAULT 0'],
  ['prototypes', 'source_url', 'TEXT'],
];
