-- Migration 008: Credential Manager Module (Phase 10)

-- Main credentials table
CREATE TABLE IF NOT EXISTS credentials (
  id            TEXT PRIMARY KEY,
  project_id    TEXT,
  type          TEXT NOT NULL,
  name          TEXT NOT NULL,
  username      TEXT,
  url           TEXT,
  service_name  TEXT,
  environment   TEXT DEFAULT 'none',
  tags          TEXT,
  expires_at    TEXT,
  has_totp      INTEGER DEFAULT 0,
  notes         TEXT,
  sort_order    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- Per-field storage (sensitive fields encrypted, plain fields in plain_value)
CREATE TABLE IF NOT EXISTS credential_fields (
  id               TEXT PRIMARY KEY,
  credential_id    TEXT NOT NULL,
  field_key        TEXT NOT NULL,
  field_label      TEXT NOT NULL,
  encrypted_value  BLOB,
  iv               BLOB,
  plain_value      TEXT,
  is_sensitive     INTEGER DEFAULT 1,
  field_order      INTEGER DEFAULT 0,
  FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE
);

-- TOTP secrets per credential
CREATE TABLE IF NOT EXISTS credential_totp (
  id               TEXT PRIMARY KEY,
  credential_id    TEXT NOT NULL UNIQUE,
  encrypted_secret BLOB NOT NULL,
  iv               BLOB NOT NULL,
  digits           INTEGER DEFAULT 6,
  period_seconds   INTEGER DEFAULT 30,
  algorithm        TEXT DEFAULT 'SHA1',
  FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE
);

-- Environment variables (key-value, values encrypted)
CREATE TABLE IF NOT EXISTS credential_env_vars (
  id               TEXT PRIMARY KEY,
  credential_id    TEXT NOT NULL,
  var_key          TEXT NOT NULL,
  encrypted_value  BLOB NOT NULL,
  iv               BLOB NOT NULL,
  var_order        INTEGER DEFAULT 0,
  FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE
);

-- Vault config (singleton row)
CREATE TABLE IF NOT EXISTS vault_config (
  id                   TEXT PRIMARY KEY DEFAULT 'singleton',
  has_master_password  INTEGER DEFAULT 0,
  password_hint        TEXT,
  argon2_salt          BLOB,
  auto_lock_minutes    INTEGER DEFAULT 15,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

-- Insert default vault config if not exists
INSERT OR IGNORE INTO vault_config (id, has_master_password, auto_lock_minutes, created_at, updated_at)
VALUES ('singleton', 0, 15, datetime('now'), datetime('now'));

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_credentials_project_id ON credentials(project_id);
CREATE INDEX IF NOT EXISTS idx_credentials_type ON credentials(type);
CREATE INDEX IF NOT EXISTS idx_credentials_environment ON credentials(environment);
CREATE INDEX IF NOT EXISTS idx_credential_fields_credential_id ON credential_fields(credential_id);
CREATE INDEX IF NOT EXISTS idx_credential_env_vars_credential_id ON credential_env_vars(credential_id);
CREATE INDEX IF NOT EXISTS idx_credential_totp_credential_id ON credential_totp(credential_id);
