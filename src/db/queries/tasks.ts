import { db } from "@/db/client";
import { sql } from "kysely";
import { v4 as uuidv4 } from "uuid";
import { now, today } from "@/lib/dateUtils";
import type { TaskRow } from "@/types/db";
import type { SmartListCounts, SmartListType, TaskSortBy } from "@/types/task";
import dayjs from "dayjs";

export async function getTasks(filters?: {
  status?: string;
  priority?: string;
  project_id?: string | null;
  parent_id?: string | null;
  label_id?: string;
  search?: string;
  is_starred?: boolean;
  smart_list?: SmartListType;
  hide_completed?: boolean;
  date_from?: string;
  date_to?: string;
  sort_by?: TaskSortBy;
}): Promise<TaskRow[]> {
  let query = db
    .selectFrom("tasks")
    .selectAll("tasks");

  // Label filter — JOIN to task_labels
  if (filters?.label_id) {
    query = query
      .innerJoin("task_labels", "task_labels.task_id", "tasks.id")
      .where("task_labels.label_id", "=", filters.label_id) as any;
  }

  // Search filter
  if (filters?.search) {
    const term = `%${filters.search}%`;
    query = query.where("tasks.title", "like", term);
  }

  // Starred filter
  if (filters?.is_starred) {
    query = query.where("tasks.is_starred", "=", 1);
  }

  // Smart list filters
  if (filters?.smart_list) {
    const todayStr = today();
    const tomorrowStr = dayjs().add(1, "day").format("YYYY-MM-DD");
    const next7Str = dayjs().add(7, "day").format("YYYY-MM-DD");

    switch (filters.smart_list) {
      case "inbox":
        query = query
          .where("tasks.due_date", "is", null)
          .where("tasks.project_id", "is", null);
        break;
      case "starred":
        query = query
          .where("tasks.is_starred", "=", 1);
        break;
      case "today":
        query = query
          .where("tasks.due_date", "=", todayStr);
        break;
      case "tomorrow":
        query = query
          .where("tasks.due_date", "=", tomorrowStr);
        break;
      case "next7days":
        query = query
          .where("tasks.due_date", ">", todayStr)
          .where("tasks.due_date", "<=", next7Str);
        break;
      case "overdue":
        query = query
          .where("tasks.due_date", "<", todayStr)
          .where("tasks.status", "not in", ["done", "cancelled"]);
        break;
    }
  }

  // Hide completed tasks
  if (filters?.hide_completed) {
    query = query.where("tasks.status", "not in", ["done", "cancelled"]);
  }

  // Date range filter (on due_date)
  if (filters?.date_from) {
    query = query.where("tasks.due_date", ">=", filters.date_from);
  }
  if (filters?.date_to) {
    query = query.where("tasks.due_date", "<=", filters.date_to);
  }

  if (filters?.status && !filters?.smart_list) {
    query = query.where("tasks.status", "=", filters.status);
  }
  if (filters?.priority) {
    query = query.where("tasks.priority", "=", filters.priority);
  }
  if (filters?.project_id !== undefined) {
    if (filters.project_id === null) {
      query = query.where("tasks.project_id", "is", null);
    } else {
      query = query.where("tasks.project_id", "=", filters.project_id);
    }
  }
  if (filters?.parent_id !== undefined) {
    if (filters.parent_id === null) {
      query = query.where("tasks.parent_id", "is", null);
    } else {
      query = query.where("tasks.parent_id", "=", filters.parent_id);
    }
  }

  // Sort
  const sortBy = filters?.sort_by ?? "manual";
  switch (sortBy) {
    case "due_date":
      query = query.orderBy("tasks.due_date", "asc").orderBy("tasks.sort_order", "asc");
      break;
    case "priority":
      query = query.orderBy(
        sql`CASE WHEN tasks.priority = 'urgent' THEN 0 WHEN tasks.priority = 'high' THEN 1 WHEN tasks.priority = 'medium' THEN 2 WHEN tasks.priority = 'low' THEN 3 ELSE 4 END`
      ).orderBy("tasks.sort_order", "asc") as any;
      break;
    case "title":
      query = query.orderBy("tasks.title", "asc");
      break;
    case "created_at":
      query = query.orderBy("tasks.created_at", "desc");
      break;
    default:
      query = query.orderBy("tasks.sort_order", "asc").orderBy("tasks.created_at", "desc");
      break;
  }

  return await query.execute();
}

export async function getRootTasks(filters?: {
  status?: string;
  priority?: string;
  project_id?: string;
  label_id?: string;
  search?: string;
  is_starred?: boolean;
  smart_list?: SmartListType;
  hide_completed?: boolean;
  date_from?: string;
  date_to?: string;
  sort_by?: TaskSortBy;
}): Promise<TaskRow[]> {
  return getTasks({ ...filters, parent_id: null });
}

export async function getSubtasks(parentId: string): Promise<TaskRow[]> {
  return getTasks({ parent_id: parentId });
}

export async function getTaskById(
  id: string,
): Promise<TaskRow | undefined> {
  return await db
    .selectFrom("tasks")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createTask(data: {
  title: string;
  parent_id?: string | null;
  project_id?: string | null;
  content?: string | null;
  status?: string;
  priority?: string;
  due_date?: string | null;
  due_time?: string | null;
  estimated_min?: number | null;
  depth?: number;
  recurrence_rule?: string | null;
  recurrence_parent_id?: string | null;
}): Promise<TaskRow> {
  const id = uuidv4();
  const timestamp = now();

  const maxOrder = await db
    .selectFrom("tasks")
    .select(db.fn.max("sort_order").as("max_order"))
    .where(
      "parent_id",
      data.parent_id ? "=" : "is",
      data.parent_id ?? null,
    )
    .executeTakeFirst();

  const sortOrder = ((maxOrder?.max_order as number) ?? -1) + 1;

  await db
    .insertInto("tasks")
    .values({
      id,
      parent_id: data.parent_id ?? null,
      project_id: data.project_id ?? null,
      title: data.title,
      content: data.content ?? null,
      status: data.status ?? "todo",
      priority: data.priority ?? "none",
      due_date: data.due_date ?? null,
      due_time: data.due_time ?? null,
      estimated_min: data.estimated_min ?? null,
      sort_order: sortOrder,
      depth: data.depth ?? 0,
      is_starred: 0,
      recurrence_rule: data.recurrence_rule ?? null,
      recurrence_parent_id: data.recurrence_parent_id ?? null,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null,
    })
    .execute();

  return (await getTaskById(id))!;
}

export async function updateTask(
  id: string,
  data: {
    title?: string;
    content?: string | null;
    status?: string;
    priority?: string;
    due_date?: string | null;
    due_time?: string | null;
    estimated_min?: number | null;
    project_id?: string | null;
    parent_id?: string | null;
    sort_order?: number;
    is_starred?: number;
    recurrence_rule?: string | null;
    recurrence_parent_id?: string | null;
  },
): Promise<TaskRow | undefined> {
  const updates: Record<string, unknown> = {
    ...data,
    updated_at: now(),
  };

  // Auto-set completed_at
  if (data.status === "done" || data.status === "cancelled") {
    updates.completed_at = now();
  } else if (data.status === "todo" || data.status === "in_progress") {
    updates.completed_at = null;
  }

  await db
    .updateTable("tasks")
    .set(updates)
    .where("id", "=", id)
    .execute();

  return await getTaskById(id);
}

export async function completeTask(id: string): Promise<TaskRow | undefined> {
  return updateTask(id, { status: "done" });
}

/** Complete a task AND all its subtasks recursively (one level deep for now). */
export async function completeTaskCascade(id: string): Promise<TaskRow | undefined> {
  const ts = now();
  // Update the task itself
  await db
    .updateTable("tasks")
    .set({ status: "done", completed_at: ts, updated_at: ts })
    .where("id", "=", id)
    .execute();
  // Update all descendants (tasks whose parent chain includes this id)
  // Simple approach: update all tasks with parent_id = id (one level)
  // and recursively their children too
  const cascade = async (parentId: string) => {
    const children = await db
      .selectFrom("tasks")
      .select("id")
      .where("parent_id", "=", parentId)
      .execute();
    if (children.length === 0) return;
    const ids = children.map((c) => c.id);
    await db
      .updateTable("tasks")
      .set({ status: "done", completed_at: ts, updated_at: ts })
      .where("id", "in", ids)
      .execute();
    for (const child of children) await cascade(child.id);
  };
  await cascade(id);
  return await getTaskById(id);
}

export async function uncompleteTask(id: string): Promise<TaskRow | undefined> {
  return updateTask(id, { status: "todo" });
}

export async function deleteTask(id: string): Promise<void> {
  await db.deleteFrom("tasks").where("id", "=", id).execute();
}

export async function getTaskWithSubtasks(
  taskId: string,
): Promise<{ task: TaskRow; subtasks: TaskRow[] } | undefined> {
  const task = await getTaskById(taskId);
  if (!task) return undefined;
  const subtasks = await getSubtasks(taskId);
  return { task, subtasks };
}

/** Returns the subset of `taskIds` that have at least one child task. */
export async function getParentIdsAmong(taskIds: string[]): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const rows = await db
    .selectFrom("tasks")
    .select("parent_id")
    .where("parent_id", "in", taskIds)
    .execute();
  return [...new Set(rows.map((r) => r.parent_id!))];
}

export async function getTaskCountsByStatus(): Promise<
  Record<string, number>
> {
  const rows = await db
    .selectFrom("tasks")
    .select(["status", db.fn.count("id").as("count")])
    .groupBy("status")
    .execute();

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = Number(row.count);
  }
  return counts;
}

// ─── Smart List Counts ──────────────────────────────────────────────

export async function getSmartListCounts(): Promise<SmartListCounts> {
  const todayStr = today();
  const tomorrowStr = dayjs().add(1, "day").format("YYYY-MM-DD");
  const next7Str = dayjs().add(7, "day").format("YYYY-MM-DD");

  const result = await sql<{
    inbox: number;
    starred: number;
    today: number;
    tomorrow: number;
    next7days: number;
    overdue: number;
  }>`
    SELECT
      SUM(CASE WHEN due_date IS NULL AND project_id IS NULL AND parent_id IS NULL AND status IN ('todo','in_progress') THEN 1 ELSE 0 END) as inbox,
      SUM(CASE WHEN is_starred = 1 AND parent_id IS NULL AND status IN ('todo','in_progress') THEN 1 ELSE 0 END) as starred,
      SUM(CASE WHEN due_date = ${todayStr} AND parent_id IS NULL AND status IN ('todo','in_progress') THEN 1 ELSE 0 END) as today,
      SUM(CASE WHEN due_date = ${tomorrowStr} AND parent_id IS NULL AND status IN ('todo','in_progress') THEN 1 ELSE 0 END) as tomorrow,
      SUM(CASE WHEN due_date > ${todayStr} AND due_date <= ${next7Str} AND parent_id IS NULL AND status IN ('todo','in_progress') THEN 1 ELSE 0 END) as next7days,
      SUM(CASE WHEN due_date < ${todayStr} AND parent_id IS NULL AND status IN ('todo','in_progress') THEN 1 ELSE 0 END) as overdue
    FROM tasks
  `.execute(db);

  const row = result.rows[0];
  return {
    inbox: Number(row?.inbox ?? 0),
    starred: Number(row?.starred ?? 0),
    today: Number(row?.today ?? 0),
    tomorrow: Number(row?.tomorrow ?? 0),
    next7days: Number(row?.next7days ?? 0),
    overdue: Number(row?.overdue ?? 0),
  };
}

// ─── Subtask Progress Batch ─────────────────────────────────────────

export async function getSubtaskProgressBatch(
  parentIds: string[],
): Promise<Map<string, { done: number; total: number }>> {
  const result = new Map<string, { done: number; total: number }>();
  if (parentIds.length === 0) return result;

  const rows = await db
    .selectFrom("tasks")
    .select([
      "parent_id",
      db.fn.count<number>("id").as("total"),
      db.fn.sum<number>(
        sql`CASE WHEN status IN ('done','cancelled') THEN 1 ELSE 0 END` as any
      ).as("done"),
    ])
    .where("parent_id", "in", parentIds)
    .groupBy("parent_id")
    .execute();

  for (const row of rows) {
    if (row.parent_id) {
      result.set(row.parent_id, {
        done: Number(row.done ?? 0),
        total: Number(row.total ?? 0),
      });
    }
  }
  return result;
}

// ─── Star / Unstar ──────────────────────────────────────────────────

export async function starTask(id: string): Promise<TaskRow | undefined> {
  await db
    .updateTable("tasks")
    .set({ is_starred: 1, updated_at: now() })
    .where("id", "=", id)
    .execute();
  return await getTaskById(id);
}

export async function unstarTask(id: string): Promise<TaskRow | undefined> {
  await db
    .updateTable("tasks")
    .set({ is_starred: 0, updated_at: now() })
    .where("id", "=", id)
    .execute();
  return await getTaskById(id);
}

// ─── Reorder Tasks ──────────────────────────────────────────────────

export async function reorderTasks(
  updates: Array<{ id: string; sort_order: number }>,
): Promise<void> {
  const ts = now();
  for (const u of updates) {
    await db
      .updateTable("tasks")
      .set({ sort_order: u.sort_order, updated_at: ts })
      .where("id", "=", u.id)
      .execute();
  }
}

// ─── Bulk Operations ────────────────────────────────────────────────

export async function bulkUpdateTasks(
  ids: string[],
  data: { status?: string; priority?: string; project_id?: string | null },
): Promise<void> {
  if (ids.length === 0) return;
  const ts = now();
  const updates: Record<string, unknown> = { ...data, updated_at: ts };
  if (data.status === "done" || data.status === "cancelled") {
    updates.completed_at = ts;
  }
  await db
    .updateTable("tasks")
    .set(updates)
    .where("id", "in", ids)
    .execute();
}

export async function bulkDeleteTasks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.deleteFrom("tasks").where("id", "in", ids).execute();
}
