-- Badami Initial Migration
-- All tables for the application

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  content     TEXT,
  icon        TEXT,
  color       TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  category    TEXT,
  content     TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  parent_id     TEXT,
  project_id    TEXT,
  title         TEXT NOT NULL,
  content       TEXT,
  status        TEXT NOT NULL DEFAULT 'todo',
  priority      TEXT NOT NULL DEFAULT 'none',
  due_date      TEXT,
  estimated_min INTEGER,
  sort_order    INTEGER DEFAULT 0,
  depth         INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  completed_at  TEXT,
  FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS labels (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6b7280'
);

CREATE TABLE IF NOT EXISTS task_labels (
  task_id   TEXT NOT NULL,
  label_id  TEXT NOT NULL,
  PRIMARY KEY (task_id, label_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_plans (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  task_id     TEXT,
  note        TEXT,
  sort_order  INTEGER DEFAULT 0,
  is_done     INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id            TEXT PRIMARY KEY,
  task_id       TEXT,
  daily_plan_id TEXT,
  duration_min  INTEGER NOT NULL DEFAULT 25,
  break_min     INTEGER NOT NULL DEFAULT 5,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  completed     INTEGER DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (daily_plan_id) REFERENCES daily_plans(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('pomodoro_work_min', '25');
INSERT OR IGNORE INTO settings (key, value) VALUES ('pomodoro_break_min', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('today_window_always_on_top', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('app_theme', 'dark');
