-- ──────────────────────────────────────────────────
-- Migration 017: Database Client Module (Phase 17)
-- ──────────────────────────────────────────────────

-- Connections to external databases (MySQL, PostgreSQL, SQLite)
CREATE TABLE IF NOT EXISTS db_connections (
  id                TEXT PRIMARY KEY,
  project_id        TEXT,
  name              TEXT NOT NULL,
  engine            TEXT NOT NULL,        -- mysql | mariadb | postgresql | sqlite
  host              TEXT,
  port              INTEGER,
  database_name     TEXT,
  username          TEXT,
  credential_id     TEXT,
  credential_field  TEXT,
  use_ssh_tunnel    INTEGER DEFAULT 0,
  ssh_server_id     TEXT,
  ssh_local_port    INTEGER,
  use_ssl           INTEGER DEFAULT 0,
  ssl_mode          TEXT DEFAULT 'prefer',
  ssl_ca_path       TEXT,
  ssl_cert_path     TEXT,
  ssl_key_path      TEXT,
  sqlite_file_path  TEXT,
  color             TEXT DEFAULT '#6b7280',
  last_connected_at TEXT,
  sort_order        INTEGER DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE SET NULL,
  FOREIGN KEY (ssh_server_id) REFERENCES server_credentials(id) ON DELETE SET NULL
);

-- Saved queries with optional connection & folder linkage
CREATE TABLE IF NOT EXISTS db_saved_queries (
  id             TEXT PRIMARY KEY,
  connection_id  TEXT,
  folder_id      TEXT,
  name           TEXT NOT NULL,
  description    TEXT,
  sql_content    TEXT NOT NULL,
  tags           TEXT,                    -- JSON array
  sort_order     INTEGER DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES db_connections(id) ON DELETE SET NULL
);

-- Folders to organise saved queries
CREATE TABLE IF NOT EXISTS db_saved_query_folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0
);

-- Auto-saved query execution history
CREATE TABLE IF NOT EXISTS db_query_history (
  id              TEXT PRIMARY KEY,
  connection_id   TEXT,
  database_name   TEXT,
  sql_content     TEXT NOT NULL,
  status          TEXT NOT NULL,          -- success | error
  error_message   TEXT,
  rows_affected   INTEGER,
  duration_ms     INTEGER,
  executed_at     TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES db_connections(id) ON DELETE SET NULL
);

-- Persist ER diagram node positions per connection + database
CREATE TABLE IF NOT EXISTS db_er_layouts (
  id             TEXT PRIMARY KEY,
  connection_id  TEXT NOT NULL,
  database_name  TEXT NOT NULL,
  layout_data    TEXT NOT NULL,           -- JSON: { tableId: {x, y} }
  updated_at     TEXT NOT NULL,
  UNIQUE(connection_id, database_name),
  FOREIGN KEY (connection_id) REFERENCES db_connections(id) ON DELETE CASCADE
);
