import { useEffect } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import * as reminderQueries from "@/db/queries/reminders";
import * as taskQueries from "@/db/queries/tasks";

async function checkAndSendReminders() {
  try {
    let permitted = await isPermissionGranted();
    if (!permitted) {
      const result = await requestPermission();
      permitted = result === "granted";
    }
    if (!permitted) return;

    const due = await reminderQueries.getDueReminders();
    for (const reminder of due) {
      const task = await taskQueries.getTaskById(reminder.task_id);
      sendNotification({
        title: "Task Reminder",
        body: task?.title ?? "You have a task reminder",
      });
      await reminderQueries.markReminderSent(reminder.id);
    }
  } catch (err) {
    console.error("Reminder check failed:", err);
  }
}

export function useReminderChecker() {
  useEffect(() => {
    // Check immediately on mount
    checkAndSendReminders();
    // Then check every 60 seconds
    const interval = setInterval(checkAndSendReminders, 60_000);
    return () => clearInterval(interval);
  }, []);
}
