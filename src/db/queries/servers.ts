import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type { ServerCredentialRow, PemKeyRow, FileBookmarkRow, TransferHistoryRow } from "@/types/db";

// ─── Server Credentials ─────────────────────────────────────────────

export async function getAllServers(): Promise<ServerCredentialRow[]> {
  return await db
    .selectFrom("server_credentials")
    .selectAll()
    .orderBy("last_connected_at", "desc")
    .orderBy("created_at", "desc")
    .execute();
}

export async function getServersByProject(
  projectId: string,
): Promise<ServerCredentialRow[]> {
  return await db
    .selectFrom("server_credentials")
    .selectAll()
    .where("project_id", "=", projectId)
    .orderBy("sort_order", "asc")
    .orderBy("created_at", "desc")
    .execute();
}

export async function getServerById(
  id: string,
): Promise<ServerCredentialRow | undefined> {
  return await db
    .selectFrom("server_credentials")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createServer(data: {
  project_id?: string | null;
  name: string;
  environment?: string;
  color?: string | null;
  protocol: string;
  host: string;
  port: number;
  username: string;
  auth_type: string;
  pem_key_id?: string | null;
  pem_file_path?: string | null;
  credential_id?: string | null;
  initial_directory?: string;
  notes_content?: string | null;
}): Promise<ServerCredentialRow> {
  const id = uuidv4();
  const timestamp = now();

  let maxOrder: { max_order: unknown } | undefined;
  if (data.project_id) {
    maxOrder = await db
      .selectFrom("server_credentials")
      .select(db.fn.max("sort_order").as("max_order"))
      .where("project_id", "=", data.project_id)
      .executeTakeFirst();
  } else {
    maxOrder = await db
      .selectFrom("server_credentials")
      .select(db.fn.max("sort_order").as("max_order"))
      .where("project_id", "is", null)
      .executeTakeFirst();
  }

  const sortOrder = ((maxOrder?.max_order as number) ?? -1) + 1;

  await db
    .insertInto("server_credentials")
    .values({
      id,
      project_id: data.project_id ?? null,
      name: data.name,
      environment: data.environment ?? "development",
      color: data.color ?? "#6b7280",
      protocol: data.protocol,
      host: data.host,
      port: data.port,
      username: data.username,
      auth_type: data.auth_type,
      pem_key_id: data.pem_key_id ?? null,
      pem_file_path: data.pem_file_path ?? null,
      credential_id: data.credential_id ?? null,
      initial_directory: data.initial_directory ?? "/",
      notes_content: data.notes_content ?? null,
      sort_order: sortOrder,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();

  return (await getServerById(id))!;
}

export async function updateServer(
  id: string,
  data: {
    project_id?: string | null;
    name?: string;
    environment?: string;
    color?: string | null;
    protocol?: string;
    host?: string;
    port?: number;
    username?: string;
    auth_type?: string;
    pem_key_id?: string | null;
    pem_file_path?: string | null;
    credential_id?: string | null;
    initial_directory?: string;
    notes_content?: string | null;
    last_connected_at?: string | null;
    sort_order?: number;
  },
): Promise<ServerCredentialRow | undefined> {
  await db
    .updateTable("server_credentials")
    .set({ ...data, updated_at: now() })
    .where("id", "=", id)
    .execute();

  return await getServerById(id);
}

export async function deleteServer(id: string): Promise<void> {
  await db
    .deleteFrom("server_credentials")
    .where("id", "=", id)
    .execute();
}

export async function touchServerConnected(id: string): Promise<void> {
  await db
    .updateTable("server_credentials")
    .set({ last_connected_at: now(), updated_at: now() })
    .where("id", "=", id)
    .execute();
}

// ─── PEM Keys ────────────────────────────────────────────────────────

export async function getPemKeys(): Promise<PemKeyRow[]> {
  return await db
    .selectFrom("pem_keys")
    .selectAll()
    .orderBy("created_at", "desc")
    .execute();
}

export async function getPemKeyById(
  id: string,
): Promise<PemKeyRow | undefined> {
  return await db
    .selectFrom("pem_keys")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createPemKey(data: {
  alias: string;
  encrypted_data: unknown;
  iv: unknown;
  comment?: string | null;
  fingerprint?: string | null;
}): Promise<PemKeyRow> {
  const id = uuidv4();
  const timestamp = now();

  await db
    .insertInto("pem_keys")
    .values({
      id,
      alias: data.alias,
      encrypted_data: data.encrypted_data,
      iv: data.iv,
      comment: data.comment ?? null,
      fingerprint: data.fingerprint ?? null,
      created_at: timestamp,
    })
    .execute();

  return (await getPemKeyById(id))!;
}

export async function deletePemKey(id: string): Promise<void> {
  await db.deleteFrom("pem_keys").where("id", "=", id).execute();
}

// ─── File Bookmarks ──────────────────────────────────────────────────

export async function getBookmarksByServer(
  serverId: string,
): Promise<FileBookmarkRow[]> {
  return await db
    .selectFrom("file_bookmarks")
    .selectAll()
    .where("server_id", "=", serverId)
    .orderBy("sort_order", "asc")
    .execute();
}

export async function createBookmark(data: {
  server_id: string;
  name: string;
  remote_path: string;
}): Promise<FileBookmarkRow> {
  const id = uuidv4();
  const timestamp = now();

  await db
    .insertInto("file_bookmarks")
    .values({
      id,
      server_id: data.server_id,
      name: data.name,
      remote_path: data.remote_path,
      created_at: timestamp,
    })
    .execute();

  return (await db
    .selectFrom("file_bookmarks")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function deleteBookmark(id: string): Promise<void> {
  await db.deleteFrom("file_bookmarks").where("id", "=", id).execute();
}

// ─── Transfer History ────────────────────────────────────────────────

export async function getTransferHistory(
  serverId: string,
  limit = 50,
): Promise<TransferHistoryRow[]> {
  return await db
    .selectFrom("transfer_history")
    .selectAll()
    .where("server_id", "=", serverId)
    .orderBy("transferred_at", "desc")
    .limit(limit)
    .execute();
}

export async function createTransferEntry(data: {
  server_id: string;
  direction: "upload" | "download";
  local_path: string;
  remote_path: string;
  file_size: number | null;
  status: "completed" | "failed" | "cancelled";
  error_message?: string | null;
}): Promise<void> {
  await db
    .insertInto("transfer_history")
    .values({
      id: uuidv4(),
      server_id: data.server_id,
      direction: data.direction,
      local_path: data.local_path,
      remote_path: data.remote_path,
      file_size: data.file_size ?? null,
      status: data.status,
      error_message: data.error_message ?? null,
      transferred_at: now(),
    })
    .execute();
}

export async function clearTransferHistory(serverId: string): Promise<void> {
  await db
    .deleteFrom("transfer_history")
    .where("server_id", "=", serverId)
    .execute();
}
