import { db } from "@/db/client";
import { sql } from "kysely";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type { PomodoroSessionRow } from "@/types/db";

export async function createPomodoroSession(data: {
  task_id?: string | null;
  duration_min: number;
  break_min: number;
}): Promise<PomodoroSessionRow> {
  const id = uuidv4();
  const started_at = now();

  await db
    .insertInto("pomodoro_sessions")
    .values({
      id,
      task_id: data.task_id ?? null,
      daily_plan_id: null,
      duration_min: data.duration_min,
      break_min: data.break_min,
      started_at,
      completed: 0,
    })
    .execute();

  return (await db
    .selectFrom("pomodoro_sessions")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function completePomodoroSession(
  id: string,
): Promise<PomodoroSessionRow | undefined> {
  await db
    .updateTable("pomodoro_sessions")
    .set({ ended_at: now(), completed: 1 })
    .where("id", "=", id)
    .execute();

  return await db
    .selectFrom("pomodoro_sessions")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function cancelPomodoroSession(id: string): Promise<void> {
  await db
    .updateTable("pomodoro_sessions")
    .set({ ended_at: now(), completed: 0 })
    .where("id", "=", id)
    .execute();
}

export async function getTodaySessions(): Promise<PomodoroSessionRow[]> {
  const todayStr = new Date().toISOString().split("T")[0];
  return await db
    .selectFrom("pomodoro_sessions")
    .selectAll()
    .where("started_at", ">=", todayStr)
    .orderBy("started_at", "desc")
    .execute();
}

// ─── Stats Queries ──────────────────────────────────────────────────

export async function getSessionsForTask(taskId: string): Promise<PomodoroSessionRow[]> {
  return await db
    .selectFrom("pomodoro_sessions")
    .selectAll()
    .where("task_id", "=", taskId)
    .where("completed", "=", 1)
    .orderBy("started_at", "desc")
    .execute();
}

export interface PomodoroStats {
  totalSessions: number;
  totalMinutes: number;
  averageDuration: number;
  streak: number; // consecutive days with at least 1 session
}

export async function getOverallStats(): Promise<PomodoroStats> {
  const result = await sql<{
    count: number;
    total_min: number;
    avg_min: number;
  }>`
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(duration_min), 0) as total_min,
      COALESCE(AVG(duration_min), 0) as avg_min
    FROM pomodoro_sessions
    WHERE completed = 1
  `.execute(db);

  const row = result.rows[0] ?? { count: 0, total_min: 0, avg_min: 0 };

  // Streak calculation
  const days = await sql<{ day: string }>`
    SELECT DISTINCT DATE(started_at) as day
    FROM pomodoro_sessions
    WHERE completed = 1
    ORDER BY day DESC
  `.execute(db);

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < days.rows.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const expectedStr = expected.toISOString().split("T")[0];
    if (days.rows[i].day === expectedStr) {
      streak++;
    } else {
      break;
    }
  }

  return {
    totalSessions: Number(row.count),
    totalMinutes: Number(row.total_min),
    averageDuration: Math.round(Number(row.avg_min)),
    streak,
  };
}

export async function getDailySessionCounts(days: number = 30): Promise<Array<{ date: string; count: number; minutes: number }>> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];

  const result = await sql<{ day: string; count: number; minutes: number }>`
    SELECT DATE(started_at) as day, COUNT(*) as count, SUM(duration_min) as minutes
    FROM pomodoro_sessions
    WHERE completed = 1 AND DATE(started_at) >= ${sinceStr}
    GROUP BY day
    ORDER BY day ASC
  `.execute(db);

  return result.rows.map((r) => ({ date: r.day, count: Number(r.count), minutes: Number(r.minutes) }));
}

export async function getCompletedTasksCountByDay(days: number = 30): Promise<Array<{ date: string; count: number }>> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];

  const result = await sql<{ day: string; count: number }>`
    SELECT DATE(completed_at) as day, COUNT(*) as count
    FROM tasks
    WHERE status = 'done' AND DATE(completed_at) >= ${sinceStr}
    GROUP BY day
    ORDER BY day ASC
  `.execute(db);

  return result.rows.map((r) => ({ date: r.day, count: Number(r.count) }));
}
