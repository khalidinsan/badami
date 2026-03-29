export interface PomodoroSession {
  id: string;
  task_id: string | null;
  daily_plan_id: string | null;
  duration_min: number;
  break_min: number;
  started_at: string;
  ended_at: string | null;
  completed: number;
}
