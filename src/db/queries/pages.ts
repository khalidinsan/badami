import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type { PageRow } from "@/types/db";

export async function getPagesByProject(
  projectId: string,
): Promise<PageRow[]> {
  return await db
    .selectFrom("pages")
    .selectAll()
    .where("project_id", "=", projectId)
    .orderBy("sort_order", "asc")
    .orderBy("created_at", "asc")
    .execute();
}

export async function getPageById(
  id: string,
): Promise<PageRow | undefined> {
  return await db
    .selectFrom("pages")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createPage(data: {
  project_id: string;
  title: string;
  category?: string | null;
  content?: string | null;
}): Promise<PageRow> {
  const id = uuidv4();
  const timestamp = now();

  const maxOrder = await db
    .selectFrom("pages")
    .select(db.fn.max("sort_order").as("max_order"))
    .where("project_id", "=", data.project_id)
    .executeTakeFirst();

  const sortOrder = ((maxOrder?.max_order as number) ?? -1) + 1;

  await db
    .insertInto("pages")
    .values({
      id,
      project_id: data.project_id,
      title: data.title,
      category: data.category ?? "notes",
      content: data.content ?? null,
      sort_order: sortOrder,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();

  return (await getPageById(id))!;
}

export async function updatePage(
  id: string,
  data: {
    title?: string;
    content?: string | null;
    category?: string | null;
    sort_order?: number;
  },
): Promise<PageRow | undefined> {
  await db
    .updateTable("pages")
    .set({
      ...data,
      updated_at: now(),
    })
    .where("id", "=", id)
    .execute();

  return await getPageById(id);
}

export async function deletePage(id: string): Promise<void> {
  await db.deleteFrom("pages").where("id", "=", id).execute();
}
