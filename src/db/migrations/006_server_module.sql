-- Migration 006: Server Management Module
-- Adds tables for server credentials, PEM keys, file bookmarks, and transfer history

CREATE TABLE IF NOT EXISTS server_credentials (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL,
  name              TEXT NOT NULL,
  environment       TEXT NOT NULL DEFAULT 'development',
  color             TEXT DEFAULT '#6b7280',
  protocol          TEXT NOT NULL,
  host              TEXT NOT NULL,
  port              INTEGER NOT NULL,
  username          TEXT NOT NULL,
  auth_type         TEXT NOT NULL,
  pem_key_id        TEXT,
  pem_file_path     TEXT,
  initial_directory TEXT DEFAULT '/',
  notes_content     TEXT,
  last_connected_at TEXT,
  sort_order        INTEGER DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (pem_key_id) REFERENCES pem_keys(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pem_keys (
  id              TEXT PRIMARY KEY,
  alias           TEXT NOT NULL UNIQUE,
  encrypted_data  BLOB NOT NULL,
  iv              BLOB NOT NULL,
  comment         TEXT,
  fingerprint     TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_bookmarks (
  id          TEXT PRIMARY KEY,
  server_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (server_id) REFERENCES server_credentials(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transfer_history (
  id             TEXT PRIMARY KEY,
  server_id      TEXT NOT NULL,
  direction      TEXT NOT NULL,
  local_path     TEXT NOT NULL,
  remote_path    TEXT NOT NULL,
  file_size      INTEGER,
  status         TEXT NOT NULL,
  error_message  TEXT,
  transferred_at TEXT NOT NULL,
  FOREIGN KEY (server_id) REFERENCES server_credentials(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('ssh_terminal_font_size', '13');
INSERT OR IGNORE INTO settings (key, value) VALUES ('ssh_terminal_font_family', 'JetBrains Mono');
INSERT OR IGNORE INTO settings (key, value) VALUES ('ssh_terminal_theme', 'dark');
INSERT OR IGNORE INTO settings (key, value) VALUES ('ssh_auto_reconnect', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('file_manager_show_hidden', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('file_manager_default_local_path', '~');
