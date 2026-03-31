-- Migration 007: Make server_credentials.project_id optional (nullable)
-- This allows servers to exist as global (no project) or linked to a project

-- Step 1: Create new table with nullable project_id
CREATE TABLE IF NOT EXISTS server_credentials_new (
  id                TEXT PRIMARY KEY,
  project_id        TEXT,
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
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (pem_key_id) REFERENCES pem_keys(id) ON DELETE SET NULL
);

-- Step 2: Copy existing data using explicit column list.
-- SELECT * is intentionally avoided: after migration 016 added credential_id,
-- SELECT * would produce 21 values for a 20-column table, failing silently
-- and leaving server_credentials_new empty — then DROP TABLE below would wipe
-- all data.  With an explicit list, extra columns in the source are ignored.
INSERT OR IGNORE INTO server_credentials_new (
  id, project_id, name, environment, color, protocol, host, port, username,
  auth_type, pem_key_id, pem_file_path, initial_directory, notes_content,
  last_connected_at, sort_order, created_at, updated_at
)
SELECT
  id, project_id, name, environment, color, protocol, host, port, username,
  auth_type, pem_key_id, pem_file_path, initial_directory, notes_content,
  last_connected_at, sort_order, created_at, updated_at
FROM server_credentials;

-- Step 3: Drop old table
DROP TABLE server_credentials;

-- Step 4: Rename new table
ALTER TABLE server_credentials_new RENAME TO server_credentials;
