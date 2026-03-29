import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import type { LabelRow } from "@/types/db";

export async function getLabels(): Promise<LabelRow[]> {
  return await db
    .selectFrom("labels")
    .selectAll()
    .orderBy("name", "asc")
    .execute();
}

export async function getLabelById(
  id: string,
): Promise<LabelRow | undefined> {
  return await db
    .selectFrom("labels")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createLabel(data: {
  name: string;
  color?: string;
}): Promise<LabelRow> {
  const id = uuidv4();
  await db
    .insertInto("labels")
    .values({
      id,
      name: data.name,
      color: data.color ?? "#6b7280",
    })
    .execute();

  return (await getLabelById(id))!;
}

export async function updateLabel(
  id: string,
  data: { name?: string; color?: string },
): Promise<LabelRow | undefined> {
  await db
    .updateTable("labels")
    .set(data)
    .where("id", "=", id)
    .execute();

  return await getLabelById(id);
}

export async function deleteLabel(id: string): Promise<void> {
  await db.deleteFrom("labels").where("id", "=", id).execute();
}

export async function getLabelsForTask(
  taskId: string,
): Promise<LabelRow[]> {
  return await db
    .selectFrom("task_labels")
    .innerJoin("labels", "labels.id", "task_labels.label_id")
    .selectAll("labels")
    .where("task_labels.task_id", "=", taskId)
    .execute();
}

export async function addLabelToTask(
  taskId: string,
  labelId: string,
): Promise<void> {
  await db
    .insertInto("task_labels")
    .values({ task_id: taskId, label_id: labelId })
    .execute();
}

export async function removeLabelFromTask(
  taskId: string,
  labelId: string,
): Promise<void> {
  await db
    .deleteFrom("task_labels")
    .where("task_id", "=", taskId)
    .where("label_id", "=", labelId)
    .execute();
}

export async function setTaskLabels(
  taskId: string,
  labelIds: string[],
): Promise<void> {
  await db
    .deleteFrom("task_labels")
    .where("task_id", "=", taskId)
    .execute();

  if (labelIds.length > 0) {
    await db
      .insertInto("task_labels")
      .values(labelIds.map((labelId) => ({ task_id: taskId, label_id: labelId })))
      .execute();
  }
}

export async function getLabelsForTasks(
  taskIds: string[],
): Promise<Map<string, LabelRow[]>> {
  if (taskIds.length === 0) return new Map();

  const rows = await db
    .selectFrom("task_labels")
    .innerJoin("labels", "labels.id", "task_labels.label_id")
    .select(["task_labels.task_id", "labels.id", "labels.name", "labels.color"])
    .where("task_labels.task_id", "in", taskIds)
    .execute();

  const map = new Map<string, LabelRow[]>();
  for (const id of taskIds) map.set(id, []);
  for (const row of rows) {
    const list = map.get(row.task_id)!;
    list.push({ id: row.id, name: row.name, color: row.color });
  }
  return map;
}
