import { useEffect, useState, useCallback, useRef } from 'react';
import * as notifQueries from '@/db/queries/notifications';
import * as planningQueries from '@/db/queries/planning';
import { today } from '@/lib/dateUtils';
import { sendNotification } from '@tauri-apps/plugin-notification';
import { db } from '@/db/client';
import { sql } from 'kysely';
import * as settingsQueries from '@/db/queries/settings';

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

async function generateNotifText(context: string, fallback: string): Promise<string> {
  try {
    const settings = await settingsQueries.getSettings(["openrouter_api_key", "ai_model"]);
    const apiKey = settings.openrouter_api_key;
    if (!apiKey) return fallback;

    const model = settings.ai_model || "deepseek/deepseek-v4-flash";
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Kamu generate teks notifikasi singkat (1 kalimat, max 60 karakter) untuk productivity app. Gaya bahasa: santai, personal, memotivasi, bahasa Indonesia casual. Boleh pakai 1 emoji di akhir. Langsung jawab teks-nya aja tanpa penjelasan." },
          { role: "user", content: context },
        ],
        max_tokens: 60,
        temperature: 0.9,
      }),
    });

    if (!res.ok) return fallback;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const checkedRef = useRef(false);

  const refresh = useCallback(async () => {
    const [count, notifs] = await Promise.all([
      notifQueries.getUnreadCount(),
      notifQueries.getNotifications(30),
    ]);
    setUnreadCount(count);
    setNotifications(notifs);
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    await notifQueries.markAsRead(id);
    refresh();
  }, [refresh]);

  const markAllAsRead = useCallback(async () => {
    await notifQueries.markAllAsRead();
    refresh();
  }, [refresh]);

  const clearAll = useCallback(async () => {
    await notifQueries.clearAll();
    refresh();
  }, [refresh]);

  // Background checker - runs once on mount then every 5 min
  useEffect(() => {
    const check = async () => {
      if (checkedRef.current) return;
      checkedRef.current = true;

      try {
        // 1. Daily summary (only once per day)
        const todayStr = today();
        const existing = await db.selectFrom('notifications').selectAll()
          .where('type', '=', 'daily_summary')
          .where('created_at', '>=', todayStr)
          .executeTakeFirst();

        if (!existing) {
          const result = await planningQueries.getTasksForDateWithOverdue(todayStr);
          const todayCount = result.today.filter(t => t.status !== 'done' && t.status !== 'cancelled').length;
          const overdueCount = result.overdue.length;

          if (todayCount > 0 || overdueCount > 0) {
            const fallback = overdueCount > 0
              ? `${todayCount} tasks today, ${overdueCount} overdue`
              : `${todayCount} tasks today`;
            const context = `User punya ${todayCount} task hari ini dan ${overdueCount} task overdue. Buat notif penyemangat pagi.`;
            const body = await generateNotifText(context, fallback);
            await notifQueries.createNotification({ type: 'daily_summary', title: 'Daily Planning', body });
            try { sendNotification({ title: 'Daily Planning', body }); } catch {}
          }
        }

        // 2. Overdue tasks
        const overdueResult = await planningQueries.getTasksForDateWithOverdue(todayStr);
        if (overdueResult.overdue.length > 0) {
          const existingOverdue = await db.selectFrom('notifications').selectAll()
            .where('type', '=', 'overdue')
            .where('created_at', '>=', todayStr)
            .executeTakeFirst();
          if (!existingOverdue) {
            const count = overdueResult.overdue.length;
            const fallback = `${count} tasks past due date`;
            const context = `User punya ${count} task yang sudah lewat deadline. Ingatkan dengan santai tapi tegas.`;
            const body = await generateNotifText(context, fallback);
            await notifQueries.createNotification({ type: 'overdue', title: 'Task Overdue', body });
            try { sendNotification({ title: 'Task Overdue', body }); } catch {}
          }
        }

        // 3. Task reminders (check reminders table)
        const nowStr = new Date().toISOString();
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const dueReminders = await sql<{id: string; task_id: string; remind_at: string}>`
          SELECT r.id, r.task_id, r.remind_at FROM reminders r
          JOIN tasks t ON t.id = r.task_id
          WHERE r.remind_at <= ${nowStr}
          AND r.remind_at >= ${fiveMinAgo}
          AND t.status != 'done' AND t.status != 'cancelled'
          AND r.id NOT IN (SELECT ref_id FROM notifications WHERE type = 'reminder' AND ref_id IS NOT NULL)
        `.execute(db);

        for (const rem of dueReminders.rows) {
          const task = await db.selectFrom('tasks').selectAll().where('id', '=', rem.task_id).executeTakeFirst();
          if (task) {
            await notifQueries.createNotification({ type: 'reminder', title: 'Reminder', body: task.title, ref_id: rem.id });
            try { sendNotification({ title: 'Reminder', body: task.title }); } catch {}
          }
        }
      } catch (e) {
        console.error('[notifications] check error:', e);
      }

      refresh();
    };

    check();
    const interval = setInterval(() => { checkedRef.current = false; check(); }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Initial load
  useEffect(() => { refresh(); }, [refresh]);

  return { unreadCount, notifications, markAsRead, markAllAsRead, clearAll, refresh };
}
