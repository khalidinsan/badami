import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type { ProjectRow } from "@/types/db";

export async function getProjects(
  status?: string,
): Promise<ProjectRow[]> {
  let query = db
    .selectFrom("projects")
    .selectAll()
    .orderBy("sort_order", "asc")
    .orderBy("created_at", "desc");

  if (status) {
    query = query.where("status", "=", status);
  }

  return await query.execute();
}

export async function getProjectById(
  id: string,
): Promise<ProjectRow | undefined> {
  return await db
    .selectFrom("projects")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createProject(data: {
  name: string;
  description?: string | null;
  content?: string | null;
  icon?: string | null;
  color?: string | null;
  category?: string | null;
}): Promise<ProjectRow> {
  const id = uuidv4();
  const timestamp = now();

  const maxOrder = await db
    .selectFrom("projects")
    .select(db.fn.max("sort_order").as("max_order"))
    .executeTakeFirst();

  const sortOrder = ((maxOrder?.max_order as number) ?? -1) + 1;

  await db
    .insertInto("projects")
    .values({
      id,
      name: data.name,
      description: data.description ?? null,
      content: data.content ?? null,
      icon: data.icon ?? null,
      color: data.color ?? null,
      category: data.category ?? null,
      status: "active",
      sort_order: sortOrder,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();

  return (await getProjectById(id))!;
}

export async function updateProject(
  id: string,
  data: {
    name?: string;
    description?: string | null;
    content?: string | null;
    icon?: string | null;
    color?: string | null;
    category?: string | null;
    status?: string;
    sort_order?: number;
  },
): Promise<ProjectRow | undefined> {
  await db
    .updateTable("projects")
    .set({
      ...data,
      updated_at: now(),
    })
    .where("id", "=", id)
    .execute();

  return await getProjectById(id);
}

export async function archiveProject(id: string): Promise<void> {
  await db
    .updateTable("projects")
    .set({ status: "archived", updated_at: now() })
    .where("id", "=", id)
    .execute();
}

export async function deleteProject(id: string): Promise<void> {
  await db.deleteFrom("projects").where("id", "=", id).execute();
}
