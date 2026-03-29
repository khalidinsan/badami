-- Migration 010: Collection Variables
-- Phase 11.7 — Variables scoped to a collection (always active, like Postman collection variables)

CREATE TABLE IF NOT EXISTS api_collection_variables (
  id               TEXT PRIMARY KEY,
  collection_id    TEXT NOT NULL,
  var_key          TEXT NOT NULL,
  plain_value      TEXT,
  credential_id    TEXT,
  credential_field TEXT,
  is_secret        INTEGER DEFAULT 0,
  enabled          INTEGER DEFAULT 1,
  FOREIGN KEY (collection_id) REFERENCES api_collections(id) ON DELETE CASCADE,
  FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE SET NULL
)