-- Migration 003: Remove daily_plans table
-- Planning and Today views now use tasks.due_date for scheduling

-- 1. Set due_date on tasks that were scheduled via daily_plans (keep most recent date)
UPDATE tasks SET due_date = (
  SELECT dp.date FROM daily_plans dp
  WHERE dp.task_id = tasks.id
  ORDER BY dp.date DESC LIMIT 1
) WHERE id IN (
  SELECT task_id FROM daily_plans WHERE task_id IS NOT NULL
) AND due_date IS NULL;

-- 2. Convert note-only daily_plans into tasks
INSERT INTO tasks (id, title, status, priority, due_date, sort_order, depth, created_at, updated_at)
SELECT
  id,
  note,
  CASE WHEN is_done = 1 THEN 'done' ELSE 'todo' END,
  'none',
  date,
  sort_order,
  0,
  created_at,
  created_at
FROM daily_plans WHERE task_id IS NULL AND note IS NOT NULL;

-- 3. Clear daily_plan_id references in pomodoro_sessions
UPDATE pomodoro_sessions SET daily_plan_id = NULL WHERE daily_plan_id IS NOT NULL;

-- 4. Drop the daily_plans table
DROP TABLE IF EXISTS daily_plans
