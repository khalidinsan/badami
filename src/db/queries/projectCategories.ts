import { db } from "@/db/client";
import type { ProjectCategoryRow } from "@/types/db";

export async function getProjectCategories(): Promise<ProjectCategoryRow[]> {
  return await db
    .selectFrom("project_categories")
    .selectAll()
    .orderBy("sort_order", "asc")
    .orderBy("name", "asc")
    .execute();
}

export async function createProjectCategory(data: {
  id: string;
  name: string;
}): Promise<ProjectCategoryRow> {
  const maxOrder = await db
    .selectFrom("project_categories")
    .select(db.fn.max("sort_order").as("max_order"))
    .executeTakeFirst();

  const sortOrder = ((maxOrder?.max_order as number) ?? -1) + 1;

  await db
    .insertInto("project_categories")
    .values({ id: data.id, name: data.name, sort_order: sortOrder })
    .execute();

  return (await db
    .selectFrom("project_categories")
    .selectAll()
    .where("id", "=", data.id)
    .executeTakeFirst())!;
}

export async function deleteProjectCategory(id: string): Promise<void> {
  await db.deleteFrom("project_categories").where("id", "=", id).execute();
}
