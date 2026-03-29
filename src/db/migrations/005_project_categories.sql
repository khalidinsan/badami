CREATE TABLE IF NOT EXISTS project_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO project_categories (id, name, sort_order) VALUES
  ('development', 'Development', 0),
  ('design', 'Design', 1),
  ('marketing', 'Marketing', 2),
  ('research', 'Research', 3),
  ('personal', 'Personal', 4),
  ('education', 'Education', 5),
  ('finance', 'Finance', 6),
  ('other', 'Other', 7)
