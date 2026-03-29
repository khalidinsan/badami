-- Migration 009: REST API Tool Module
-- Phase 11 — API collections, folders, requests, environments, variables, history

CREATE TABLE IF NOT EXISTS api_collections (
  id          TEXT PRIMARY KEY,
  project_id  TEXT,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS api_folders (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  sort_order    INTEGER DEFAULT 0,
  FOREIGN KEY (collection_id) REFERENCES api_collections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_requests (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  folder_id     TEXT,
  name          TEXT NOT NULL,
  method        TEXT NOT NULL DEFAULT 'GET',
  url           TEXT NOT NULL DEFAULT '',
  headers       TEXT,
  params        TEXT,
  body_type     TEXT DEFAULT 'none',
  body_content  TEXT,
  auth_type     TEXT DEFAULT 'none',
  auth_config   TEXT,
  description   TEXT,
  sort_order    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (collection_id) REFERENCES api_collections(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES api_folders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS api_environments (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  is_active     INTEGER DEFAULT 0,
  sort_order    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (collection_id) REFERENCES api_collections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_env_variables (
  id               TEXT PRIMARY KEY,
  environment_id   TEXT NOT NULL,
  var_key          TEXT NOT NULL,
  plain_value      TEXT,
  credential_id    TEXT,
  credential_field TEXT,
  is_secret        INTEGER DEFAULT 0,
  enabled          INTEGER DEFAULT 1,
  FOREIGN KEY (environment_id) REFERENCES api_environments(id) ON DELETE CASCADE,
  FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS api_history (
  id               TEXT PRIMARY KEY,
  request_id       TEXT,
  collection_id    TEXT,
  method           TEXT NOT NULL,
  url              TEXT NOT NULL,
  request_headers  TEXT,
  request_body     TEXT,
  auth_type        TEXT,
  status_code      INTEGER,
  response_headers TEXT,
  response_body    TEXT,
  response_size    INTEGER,
  elapsed_ms       INTEGER,
  sent_at          TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES api_requests(id) ON DELETE SET NULL,
  FOREIGN KEY (collection_id) REFERENCES api_collections(id) ON DELETE SET NULL
)