import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type {
  DbConnectionRow,
  DbSavedQueryRow,
  DbSavedQueryFolderRow,
  DbQueryHistoryRow,
  DbErLayoutRow,
} from "@/types/db";

// ─── Connections ────────────────────────────────────────────────────

export async function getConnections(): Promise<DbConnectionRow[]> {
  return db
    .selectFrom("db_connections")
    .selectAll()
    .orderBy("sort_order", "asc")
    .orderBy("created_at", "desc")
    .execute();
}

export async function getConnectionsByProject(
  projectId: string,
): Promise<DbConnectionRow[]> {
  return db
    .selectFrom("db_connections")
    .selectAll()
    .where("project_id", "=", projectId)
    .orderBy("sort_order", "asc")
    .execute();
}

export async function getConnectionById(
  id: string,
): Promise<DbConnectionRow | undefined> {
  return db
    .selectFrom("db_connections")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createConnection(data: {
  name: string;
  engine: string;
  project_id?: string | null;
  host?: string | null;
  port?: number | null;
  database_name?: string | null;
  username?: string | null;
  credential_id?: string | null;
  credential_field?: string | null;
  use_ssh_tunnel?: number;
  ssh_server_id?: string | null;
  ssh_local_port?: number | null;
  use_ssl?: number;
  ssl_mode?: string;
  ssl_ca_path?: string | null;
  ssl_cert_path?: string | null;
  ssl_key_path?: string | null;
  sqlite_file_path?: string | null;
  color?: string;
}): Promise<DbConnectionRow> {
  const id = uuidv4();
  const timestamp = now();

  const maxOrder = await db
    .selectFrom("db_connections")
    .select(db.fn.max("sort_order").as("max_order"))
    .executeTakeFirst();

  const sortOrder = ((maxOrder?.max_order as number) ?? -1) + 1;

  await db
    .insertInto("db_connections")
    .values({
      id,
      name: data.name,
      engine: data.engine,
      project_id: data.project_id ?? null,
      host: data.host ?? null,
      port: data.port ?? null,
      database_name: data.database_name ?? null,
      username: data.username ?? null,
      credential_id: data.credential_id ?? null,
      credential_field: data.credential_field ?? null,
      use_ssh_tunnel: data.use_ssh_tunnel ?? 0,
      ssh_server_id: data.ssh_server_id ?? null,
      ssh_local_port: data.ssh_local_port ?? null,
      use_ssl: data.use_ssl ?? 0,
      ssl_mode: data.ssl_mode ?? "prefer",
      ssl_ca_path: data.ssl_ca_path ?? null,
      ssl_cert_path: data.ssl_cert_path ?? null,
      ssl_key_path: data.ssl_key_path ?? null,
      sqlite_file_path: data.sqlite_file_path ?? null,
      color: data.color ?? "#6b7280",
      sort_order: sortOrder,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();

  return (await getConnectionById(id))!;
}

export async function updateConnection(
  id: string,
  data: Partial<{
    name: string;
    engine: string;
    project_id: string | null;
    host: string | null;
    port: number | null;
    database_name: string | null;
    username: string | null;
    credential_id: string | null;
    credential_field: string | null;
    use_ssh_tunnel: number;
    ssh_server_id: string | null;
    ssh_local_port: number | null;
    use_ssl: number;
    ssl_mode: string;
    ssl_ca_path: string | null;
    ssl_cert_path: string | null;
    ssl_key_path: string | null;
    sqlite_file_path: string | null;
    color: string;
    last_connected_at: string | null;
    sort_order: number;
  }>,
): Promise<DbConnectionRow | undefined> {
  await db
    .updateTable("db_connections")
    .set({ ...data, updated_at: now() })
    .where("id", "=", id)
    .execute();

  return getConnectionById(id);
}

export async function deleteConnection(id: string): Promise<void> {
  await db.deleteFrom("db_connections").where("id", "=", id).execute();
}

export async function touchConnectionConnected(id: string): Promise<void> {
  await db
    .updateTable("db_connections")
    .set({ last_connected_at: now(), updated_at: now() })
    .where("id", "=", id)
    .execute();
}

// ─── Query History ──────────────────────────────────────────────────

export async function getQueryHistory(
  connectionId?: string,
  limit = 100,
): Promise<DbQueryHistoryRow[]> {
  let query = db
    .selectFrom("db_query_history")
    .selectAll()
    .orderBy("executed_at", "desc")
    .limit(limit);

  if (connectionId) {
    query = query.where("connection_id", "=", connectionId);
  }

  return query.execute();
}

export async function addQueryHistory(data: {
  connection_id: string | null;
  database_name: string | null;
  sql_content: string;
  status: string;
  error_message?: string | null;
  rows_affected?: number | null;
  duration_ms?: number | null;
}): Promise<DbQueryHistoryRow> {
  const id = uuidv4();
  const executed_at = now();

  await db
    .insertInto("db_query_history")
    .values({
      id,
      connection_id: data.connection_id,
      database_name: data.database_name,
      sql_content: data.sql_content,
      status: data.status,
      error_message: data.error_message ?? null,
      rows_affected: data.rows_affected ?? null,
      duration_ms: data.duration_ms ?? null,
      executed_at,
    })
    .execute();

  return (await db
    .selectFrom("db_query_history")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function clearQueryHistory(
  connectionId?: string,
): Promise<void> {
  let query = db.deleteFrom("db_query_history");
  if (connectionId) {
    query = query.where("connection_id", "=", connectionId);
  }
  await query.execute();
}

// ─── Saved Queries ──────────────────────────────────────────────────

export async function getSavedQueries(
  connectionId?: string,
): Promise<DbSavedQueryRow[]> {
  let query = db
    .selectFrom("db_saved_queries")
    .selectAll()
    .orderBy("sort_order", "asc");

  if (connectionId) {
    query = query.where("connection_id", "=", connectionId);
  }

  return query.execute();
}

export async function createSavedQuery(data: {
  connection_id?: string | null;
  folder_id?: string | null;
  name: string;
  description?: string | null;
  sql_content: string;
  tags?: string | null;
}): Promise<DbSavedQueryRow> {
  const id = uuidv4();
  const timestamp = now();

  await db
    .insertInto("db_saved_queries")
    .values({
      id,
      connection_id: data.connection_id ?? null,
      folder_id: data.folder_id ?? null,
      name: data.name,
      description: data.description ?? null,
      sql_content: data.sql_content,
      tags: data.tags ?? null,
      sort_order: 0,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();

  return (await db
    .selectFrom("db_saved_queries")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function updateSavedQuery(
  id: string,
  data: Partial<{
    name: string;
    description: string | null;
    sql_content: string;
    folder_id: string | null;
    tags: string | null;
    sort_order: number;
  }>,
): Promise<DbSavedQueryRow | undefined> {
  await db
    .updateTable("db_saved_queries")
    .set({ ...data, updated_at: now() })
    .where("id", "=", id)
    .execute();

  return db
    .selectFrom("db_saved_queries")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function deleteSavedQuery(id: string): Promise<void> {
  await db.deleteFrom("db_saved_queries").where("id", "=", id).execute();
}

// ─── Saved Query Folders ────────────────────────────────────────────

export async function getSavedQueryFolders(): Promise<DbSavedQueryFolderRow[]> {
  return db
    .selectFrom("db_saved_query_folders")
    .selectAll()
    .orderBy("sort_order", "asc")
    .execute();
}

export async function createSavedQueryFolder(
  name: string,
): Promise<DbSavedQueryFolderRow> {
  const id = uuidv4();
  await db
    .insertInto("db_saved_query_folders")
    .values({ id, name, sort_order: 0 })
    .execute();

  return (await db
    .selectFrom("db_saved_query_folders")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function deleteSavedQueryFolder(id: string): Promise<void> {
  await db
    .deleteFrom("db_saved_query_folders")
    .where("id", "=", id)
    .execute();
}

// ─── ER Layouts ─────────────────────────────────────────────────────

export async function getErLayout(
  connectionId: string,
  databaseName: string,
): Promise<DbErLayoutRow | undefined> {
  return db
    .selectFrom("db_er_layouts")
    .selectAll()
    .where("connection_id", "=", connectionId)
    .where("database_name", "=", databaseName)
    .executeTakeFirst();
}

export async function saveErLayout(
  connectionId: string,
  databaseName: string,
  layoutData: string,
): Promise<void> {
  const existing = await getErLayout(connectionId, databaseName);
  if (existing) {
    await db
      .updateTable("db_er_layouts")
      .set({ layout_data: layoutData, updated_at: now() })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await db
      .insertInto("db_er_layouts")
      .values({
        id: uuidv4(),
        connection_id: connectionId,
        database_name: databaseName,
        layout_data: layoutData,
        updated_at: now(),
      })
      .execute();
  }
}
