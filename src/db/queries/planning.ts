import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type { TaskRow } from "@/types/db";

export async function getTasksForDate(date: string): Promise<TaskRow[]> {
  return await db
    .selectFrom("tasks")
    .selectAll()
    .where("due_date", "=", date)
    .orderBy("sort_order", "asc")
    .orderBy("created_at", "asc")
    .execute();
}

export async function getTasksForDateWithOverdue(date: string): Promise<{
  overdue: TaskRow[];
  today: TaskRow[];
}> {
  const overdue = await db
    .selectFrom("tasks")
    .selectAll()
    .where("due_date", "<", date)
    .where("status", "in", ["todo", "in_progress"])
    .orderBy("due_date", "asc")
    .orderBy("sort_order", "asc")
    .execute();

  const todayTasks = await db
    .selectFrom("tasks")
    .selectAll()
    .where("due_date", "=", date)
    .orderBy("sort_order", "asc")
    .orderBy("created_at", "asc")
    .execute();

  return { overdue, today: todayTasks };
}

export interface CalendarEventData {
  id: string;
  date: string;
  title: string;
  isDone: boolean;
}

export async function getTasksForCalendar(
  startDate: string,
  endDate: string,
): Promise<CalendarEventData[]> {
  const tasks = await db
    .selectFrom("tasks")
    .select(["id", "title", "due_date", "status"])
    .where("due_date", "is not", null)
    .where("due_date", ">=", startDate)
    .where("due_date", "<=", endDate)
    .orderBy("sort_order", "asc")
    .execute();

  return tasks.map((t) => ({
    id: t.id,
    date: t.due_date!,
    title: t.title || "Untitled",
    isDone: t.status === "done" || t.status === "cancelled",
  }));
}

export async function scheduleTask(
  taskId: string,
  date: string,
): Promise<TaskRow | undefined> {
  await db
    .updateTable("tasks")
    .set({ due_date: date, updated_at: now() })
    .where("id", "=", taskId)
    .execute();

  return await db
    .selectFrom("tasks")
    .selectAll()
    .where("id", "=", taskId)
    .executeTakeFirst();
}

export async function unscheduleTask(taskId: string): Promise<void> {
  await db
    .updateTable("tasks")
    .set({ due_date: null, updated_at: now() })
    .where("id", "=", taskId)
    .execute();
}

export async function createScheduledNote(
  date: string,
  note: string,
  projectId?: string | null,
): Promise<TaskRow> {
  const id = uuidv4();
  const timestamp = now();

  const maxOrder = await db
    .selectFrom("tasks")
    .select(db.fn.max("sort_order").as("max_order"))
    .where("due_date", "=", date)
    .executeTakeFirst();

  const sortOrder = ((maxOrder?.max_order as number) ?? -1) + 1;

  await db
    .insertInto("tasks")
    .values({
      id,
      parent_id: null,
      project_id: projectId ?? null,
      title: note,
      content: null,
      status: "todo",
      priority: "none",
      due_date: date,
      estimated_min: null,
      sort_order: sortOrder,
      depth: 0,
      is_starred: 0,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null,
    })
    .execute();

  return (await db
    .selectFrom("tasks")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function toggleTaskStatus(
  taskId: string,
): Promise<TaskRow | undefined> {
  const task = await db
    .selectFrom("tasks")
    .selectAll()
    .where("id", "=", taskId)
    .executeTakeFirst();
  if (!task) return undefined;

  // 3-state cycle: todo → in_progress → done → todo
  const newStatus =
    task.status === "todo"
      ? "in_progress"
      : task.status === "in_progress"
        ? "done"
        : "todo";
  const timestamp = now();

  await db
    .updateTable("tasks")
    .set({
      status: newStatus,
      completed_at: newStatus === "done" ? timestamp : null,
      updated_at: timestamp,
    })
    .where("id", "=", taskId)
    .execute();

  return await db
    .selectFrom("tasks")
    .selectAll()
    .where("id", "=", taskId)
    .executeTakeFirst();
}

export async function importProjectTasks(
  projectId: string,
  date: string,
): Promise<TaskRow[]> {
  const tasks = await db
    .selectFrom("tasks")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("status", "in", ["todo", "in_progress"])
    .where("parent_id", "is", null)
    .where((eb) =>
      eb.or([eb("due_date", "is", null), eb("due_date", "!=", date)]),
    )
    .execute();

  const timestamp = now();
  for (const task of tasks) {
    await db
      .updateTable("tasks")
      .set({ due_date: date, updated_at: timestamp })
      .where("id", "=", task.id)
      .execute();
  }

  return await db
    .selectFrom("tasks")
    .selectAll()
    .where("due_date", "=", date)
    .where("project_id", "=", projectId)
    .execute();
}

export async function getTasksForRange(
  startDate: string,
  endDate: string,
): Promise<TaskRow[]> {
  return await db
    .selectFrom("tasks")
    .selectAll()
    .where("due_date", ">=", startDate)
    .where("due_date", "<=", endDate)
    .orderBy("due_date", "asc")
    .orderBy("sort_order", "asc")
    .execute();
}
