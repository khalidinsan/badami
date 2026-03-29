import { db } from "@/db/client";

export async function getSetting(key: string): Promise<string | null> {
  const row = await db
    .selectFrom("settings")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const existing = await getSetting(key);
  if (existing !== null) {
    await db
      .updateTable("settings")
      .set({ value })
      .where("key", "=", key)
      .execute();
  } else {
    await db.insertInto("settings").values({ key, value }).execute();
  }
}

export async function getSettings(
  keys: string[],
): Promise<Record<string, string>> {
  const rows = await db
    .selectFrom("settings")
    .select(["key", "value"])
    .where("key", "in", keys)
    .execute();
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
