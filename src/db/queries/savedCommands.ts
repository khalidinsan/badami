import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type { SavedCommandRow } from "@/types/db";

// ─── Saved Commands ──────────────────────────────────────────────────

export async function getSavedCommands(
  serverId?: string | null,
  projectId?: string | null,
): Promise<SavedCommandRow[]> {
  let query = db
    .selectFrom("saved_commands")
    .selectAll()
    .orderBy("sort_order", "asc")
    .orderBy("created_at", "desc");

  if (serverId) {
    // Return commands for this server + global (server_id IS NULL)
    query = query.where((eb) =>
      eb.or([
        eb("server_id", "=", serverId),
        eb("server_id", "is", null),
      ]),
    );
  }

  if (projectId) {
    query = query.where((eb) =>
      eb.or([
        eb("project_id", "=", projectId),
        eb("project_id", "is", null),
      ]),
    );
  }

  return await query.execute();
}

export async function getSavedCommandById(
  id: string,
): Promise<SavedCommandRow | undefined> {
  return await db
    .selectFrom("saved_commands")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createSavedCommand(data: {
  server_id?: string | null;
  project_id?: string | null;
  name: string;
  command: string;
  description?: string | null;
  tags?: string[];
}): Promise<SavedCommandRow> {
  const id = uuidv4();
  const timestamp = now();

  const maxOrder = await db
    .selectFrom("saved_commands")
    .select(db.fn.max("sort_order").as("max_order"))
    .executeTakeFirst();

  const sortOrder = ((maxOrder?.max_order as number) ?? -1) + 1;

  await db
    .insertInto("saved_commands")
    .values({
      id,
      server_id: data.server_id ?? null,
      project_id: data.project_id ?? null,
      name: data.name,
      command: data.command,
      description: data.description ?? null,
      tags: JSON.stringify(data.tags ?? []),
      sort_order: sortOrder,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();

  return (await getSavedCommandById(id))!;
}

export async function updateSavedCommand(
  id: string,
  data: {
    name?: string;
    command?: string;
    description?: string | null;
    tags?: string[];
    sort_order?: number;
  },
): Promise<SavedCommandRow | undefined> {
  const values: Record<string, unknown> = { updated_at: now() };
  if (data.name !== undefined) values.name = data.name;
  if (data.command !== undefined) values.command = data.command;
  if (data.description !== undefined) values.description = data.description;
  if (data.tags !== undefined) values.tags = JSON.stringify(data.tags);
  if (data.sort_order !== undefined) values.sort_order = data.sort_order;

  await db
    .updateTable("saved_commands")
    .set(values)
    .where("id", "=", id)
    .execute();

  return await getSavedCommandById(id);
}

export async function deleteSavedCommand(id: string): Promise<void> {
  await db
    .deleteFrom("saved_commands")
    .where("id", "=", id)
    .execute();
}
