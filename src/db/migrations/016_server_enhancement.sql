-- Migration 016: Server Module v2 Enhancement
-- Adds credential_id link to server_credentials, saved_commands table, and new settings

-- 1. Link server to credential from Credential Manager
ALTER TABLE server_credentials ADD COLUMN credential_id TEXT REFERENCES credentials(id) ON DELETE SET NULL;

-- 2. Saved Commands table
CREATE TABLE IF NOT EXISTS saved_commands (
  id          TEXT PRIMARY KEY,
  server_id   TEXT REFERENCES server_credentials(id) ON DELETE CASCADE,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  command     TEXT NOT NULL,
  description TEXT,
  tags        TEXT DEFAULT '[]',
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 3. Settings for auto-reconnect behavior
INSERT OR IGNORE INTO settings (key, value) VALUES ('ssh_auto_reconnect_max_attempts', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('ssh_keepalive_interval', '30');
