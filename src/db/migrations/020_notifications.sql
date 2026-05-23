CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  ref_id TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
