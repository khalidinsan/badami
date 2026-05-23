import { db } from '@/db/client';
import { v4 as uuidv4 } from 'uuid';
import { now } from '@/lib/dateUtils';

export async function getNotifications(limit = 50) {
  return await db.selectFrom('notifications').selectAll().orderBy('created_at', 'desc').limit(limit).execute();
}

export async function getUnreadCount(): Promise<number> {
  const result = await db.selectFrom('notifications').select(db.fn.countAll().as('count')).where('read', '=', 0).executeTakeFirst();
  return Number(result?.count ?? 0);
}

export async function createNotification(data: { type: string; title: string; body?: string; ref_id?: string }) {
  const id = uuidv4();
  await db.insertInto('notifications').values({ id, type: data.type, title: data.title, body: data.body ?? null, ref_id: data.ref_id ?? null, read: 0, created_at: now() }).execute();
  return { id, ...data, read: 0, created_at: now() };
}

export async function markAsRead(id: string) {
  await db.updateTable('notifications').set({ read: 1 }).where('id', '=', id).execute();
}

export async function markAllAsRead() {
  await db.updateTable('notifications').set({ read: 1 }).where('read', '=', 0).execute();
}

export async function deleteNotification(id: string) {
  await db.deleteFrom('notifications').where('id', '=', id).execute();
}

export async function clearAll() {
  await db.deleteFrom('notifications').execute();
}
