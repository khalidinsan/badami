import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type { ReminderRow } from "@/types/db";

export async function getRemindersForTask(taskId: string): Promise<ReminderRow[]> {
  return await db
    .selectFrom("reminders")
    .selectAll()
    .where("task_id", "=", taskId)
    .orderBy("remind_at", "asc")
    .execute();
}

export async function createReminder(data: {
  task_id: string;
  remind_at: string;
}): Promise<ReminderRow> {
  const id = uuidv4();
  await db
    .insertInto("reminders")
    .values({
      id,
      task_id: data.task_id,
      remind_at: data.remind_at,
      is_sent: 0,
      created_at: now(),
    })
    .execute();
  return (await db
    .selectFrom("reminders")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function deleteReminder(id: string): Promise<void> {
  await db.deleteFrom("reminders").where("id", "=", id).execute();
}

export async function getDueReminders(): Promise<ReminderRow[]> {
  const currentTime = now();
  return await db
    .selectFrom("reminders")
    .selectAll()
    .where("remind_at", "<=", currentTime)
    .where("is_sent", "=", 0)
    .execute();
}

export async function markReminderSent(id: string): Promise<void> {
  await db
    .updateTable("reminders")
    .set({ is_sent: 1 })
    .where("id", "=", id)
    .execute();
}
