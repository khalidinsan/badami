-- Migration 019: Recreate pomodoro_sessions without daily_plan_id FK
CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id            TEXT PRIMARY KEY,
  task_id       TEXT,
  duration_min  INTEGER NOT NULL DEFAULT 25,
  break_min     INTEGER NOT NULL DEFAULT 5,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  completed     INTEGER DEFAULT 0
);
