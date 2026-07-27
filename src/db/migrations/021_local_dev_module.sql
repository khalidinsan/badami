-- Migration 021: Local Dev Module (Herd-replacement orchestrator)

CREATE TABLE IF NOT EXISTS local_dev_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_dev_binaries (
  id          TEXT PRIMARY KEY,
  role        TEXT NOT NULL,
  version     TEXT,
  path        TEXT NOT NULL,
  source      TEXT NOT NULL,
  arch        TEXT,
  is_selected INTEGER NOT NULL DEFAULT 0,
  meta_json   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_dev_services (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  auto_start      INTEGER NOT NULL DEFAULT 0,
  auto_restart    INTEGER NOT NULL DEFAULT 0,
  binary_id       TEXT,
  config_path     TEXT,
  pid_file        TEXT,
  log_file        TEXT,
  data_dir        TEXT,
  port            INTEGER,
  socket_path     TEXT,
  extra_json      TEXT,
  -- telemetry only (runtime truth is supervisor):
  last_status     TEXT,
  last_error      TEXT,
  last_started_at TEXT,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (binary_id) REFERENCES local_dev_binaries(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS local_dev_park_paths (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_dev_sites (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  tld             TEXT NOT NULL DEFAULT 'test',
  path            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  php_version     TEXT,
  secured         INTEGER NOT NULL DEFAULT 0,
  project_id      TEXT,
  driver          TEXT,
  notes           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(name, tld),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS local_dev_events (
  id          TEXT PRIMARY KEY,
  service_id  TEXT,
  level       TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

INSERT OR IGNORE INTO local_dev_settings (key, value) VALUES
  ('tld', 'test'),
  ('loopback', '127.0.0.1'),
  ('http_port', '8080'),
  ('http_mode', 'unprivileged'),
  ('dns_mode', 'auto'),              -- auto | adopt | badami_dnsmasq_53 | high_port | degraded
  ('dns_port', '53'),                -- 53 or high port e.g. 53535 for D2
  ('default_php_version', '8.4'),
  ('adopt_existing_processes', 'true'),
  ('mariadb_datadir_policy', 'reuse_herd'),
  ('bootstrap_complete', 'false'),
  ('dns_bootstrap_complete', 'false'),
  ('herd_import_path', ''),
  ('mariadb_connection_id', '');

-- Feature flag SoT (Key Decision 25): only in global settings, not local_dev_settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('local_dev_enabled', 'true');
