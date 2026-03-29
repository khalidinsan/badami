import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type {
  ApiCollectionRow,
  ApiFolderRow,
  ApiRequestRow,
  ApiEnvironmentRow,
  ApiEnvVariableRow,
  ApiHistoryRow,
  ApiCollectionVariableRow,
} from "@/types/db";

// ─── Collections ────────────────────────────────────────────────────

export async function getAllCollections(): Promise<ApiCollectionRow[]> {
  return db
    .selectFrom("api_collections")
    .selectAll()
    .orderBy("sort_order", "asc")
    .orderBy("created_at", "desc")
    .execute();
}

export async function getCollectionsByProject(
  projectId: string,
): Promise<ApiCollectionRow[]> {
  return db
    .selectFrom("api_collections")
    .selectAll()
    .where("project_id", "=", projectId)
    .orderBy("sort_order", "asc")
    .execute();
}

export async function getCollectionById(
  id: string,
): Promise<ApiCollectionRow | undefined> {
  return db
    .selectFrom("api_collections")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createCollection(data: {
  project_id?: string | null;
  name: string;
  description?: string | null;
}): Promise<ApiCollectionRow> {
  const id = uuidv4();
  const timestamp = now();
  await db
    .insertInto("api_collections")
    .values({
      id,
      project_id: data.project_id ?? null,
      name: data.name,
      description: data.description ?? null,
      sort_order: 0,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();
  return (await getCollectionById(id))!;
}

export async function updateCollection(
  id: string,
  data: { name?: string; description?: string | null; sort_order?: number },
): Promise<void> {
  await db
    .updateTable("api_collections")
    .set({ ...data, updated_at: now() })
    .where("id", "=", id)
    .execute();
}

export async function deleteCollection(id: string): Promise<void> {
  await db.deleteFrom("api_collections").where("id", "=", id).execute();
}

export async function duplicateCollection(id: string): Promise<ApiCollectionRow> {
  const original = await getCollectionById(id);
  if (!original) throw new Error("Collection not found");
  const newCol = await createCollection({
    project_id: original.project_id,
    name: `${original.name} (Copy)`,
    description: original.description,
  });

  // Duplicate folders & requests
  const folders = await getFoldersByCollection(id);
  const requests = await getRequestsByCollection(id);
  const folderMap: Record<string, string> = {};

  for (const folder of folders) {
    const newFolder = await createFolder({
      collection_id: newCol.id,
      name: folder.name,
    });
    folderMap[folder.id] = newFolder.id;
  }

  for (const req of requests) {
    await createRequest({
      collection_id: newCol.id,
      folder_id: req.folder_id ? folderMap[req.folder_id] ?? null : null,
      name: req.name,
      method: req.method,
      url: req.url,
      headers: req.headers,
      params: req.params,
      body_type: req.body_type,
      body_content: req.body_content,
      auth_type: req.auth_type,
      auth_config: req.auth_config,
      description: req.description,
    });
  }

  return newCol;
}

// ─── Folders ────────────────────────────────────────────────────────

export async function getFoldersByCollection(
  collectionId: string,
): Promise<ApiFolderRow[]> {
  return db
    .selectFrom("api_folders")
    .selectAll()
    .where("collection_id", "=", collectionId)
    .orderBy("sort_order", "asc")
    .execute();
}

export async function getFolderById(
  id: string,
): Promise<ApiFolderRow | undefined> {
  return db
    .selectFrom("api_folders")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createFolder(data: {
  collection_id: string;
  name: string;
}): Promise<ApiFolderRow> {
  const id = uuidv4();
  await db
    .insertInto("api_folders")
    .values({ id, collection_id: data.collection_id, name: data.name, sort_order: 0 })
    .execute();
  return (await getFolderById(id))!;
}

export async function updateFolder(
  id: string,
  data: { name?: string; sort_order?: number },
): Promise<void> {
  await db
    .updateTable("api_folders")
    .set(data)
    .where("id", "=", id)
    .execute();
}

export async function deleteFolder(id: string): Promise<void> {
  await db.deleteFrom("api_folders").where("id", "=", id).execute();
}

// ─── Requests ───────────────────────────────────────────────────────

export async function getRequestsByCollection(
  collectionId: string,
): Promise<ApiRequestRow[]> {
  return db
    .selectFrom("api_requests")
    .selectAll()
    .where("collection_id", "=", collectionId)
    .orderBy("sort_order", "asc")
    .execute();
}

export async function getRequestsByFolder(
  folderId: string,
): Promise<ApiRequestRow[]> {
  return db
    .selectFrom("api_requests")
    .selectAll()
    .where("folder_id", "=", folderId)
    .orderBy("sort_order", "asc")
    .execute();
}

export async function getRequestById(
  id: string,
): Promise<ApiRequestRow | undefined> {
  return db
    .selectFrom("api_requests")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createRequest(data: {
  collection_id: string;
  folder_id?: string | null;
  name: string;
  method?: string;
  url?: string;
  headers?: string | null;
  params?: string | null;
  body_type?: string;
  body_content?: string | null;
  auth_type?: string;
  auth_config?: string | null;
  description?: string | null;
}): Promise<ApiRequestRow> {
  const id = uuidv4();
  const timestamp = now();
  await db
    .insertInto("api_requests")
    .values({
      id,
      collection_id: data.collection_id,
      folder_id: data.folder_id ?? null,
      name: data.name,
      method: data.method ?? "GET",
      url: data.url ?? "",
      headers: data.headers ?? null,
      params: data.params ?? null,
      body_type: data.body_type ?? "none",
      body_content: data.body_content ?? null,
      auth_type: data.auth_type ?? "none",
      auth_config: data.auth_config ?? null,
      description: data.description ?? null,
      sort_order: 0,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();
  return (await getRequestById(id))!;
}

export async function updateRequest(
  id: string,
  data: {
    folder_id?: string | null;
    name?: string;
    method?: string;
    url?: string;
    headers?: string | null;
    params?: string | null;
    body_type?: string;
    body_content?: string | null;
    auth_type?: string;
    auth_config?: string | null;
    description?: string | null;
    sort_order?: number;
  },
): Promise<void> {
  await db
    .updateTable("api_requests")
    .set({ ...data, updated_at: now() })
    .where("id", "=", id)
    .execute();
}

export async function deleteRequest(id: string): Promise<void> {
  await db.deleteFrom("api_requests").where("id", "=", id).execute();
}

export async function moveRequestToFolder(
  requestId: string,
  folderId: string | null,
): Promise<void> {
  await db
    .updateTable("api_requests")
    .set({ folder_id: folderId, updated_at: now() })
    .where("id", "=", requestId)
    .execute();
}

// ─── Environments ───────────────────────────────────────────────────

export async function getEnvironmentsByCollection(
  collectionId: string,
): Promise<ApiEnvironmentRow[]> {
  return db
    .selectFrom("api_environments")
    .selectAll()
    .where("collection_id", "=", collectionId)
    .orderBy("sort_order", "asc")
    .execute();
}

export async function getEnvironmentById(
  id: string,
): Promise<ApiEnvironmentRow | undefined> {
  return db
    .selectFrom("api_environments")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createEnvironment(data: {
  collection_id: string;
  name: string;
}): Promise<ApiEnvironmentRow> {
  const id = uuidv4();
  const timestamp = now();
  await db
    .insertInto("api_environments")
    .values({
      id,
      collection_id: data.collection_id,
      name: data.name,
      is_active: 0,
      sort_order: 0,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();
  return (await getEnvironmentById(id))!;
}

export async function updateEnvironment(
  id: string,
  data: { name?: string; is_active?: number; sort_order?: number },
): Promise<void> {
  await db
    .updateTable("api_environments")
    .set({ ...data, updated_at: now() })
    .where("id", "=", id)
    .execute();
}

export async function setActiveEnvironment(
  collectionId: string,
  environmentId: string,
): Promise<void> {
  // Deactivate all
  await db
    .updateTable("api_environments")
    .set({ is_active: 0, updated_at: now() })
    .where("collection_id", "=", collectionId)
    .execute();
  // Activate selected
  await db
    .updateTable("api_environments")
    .set({ is_active: 1, updated_at: now() })
    .where("id", "=", environmentId)
    .execute();
}

export async function deleteEnvironment(id: string): Promise<void> {
  await db.deleteFrom("api_environments").where("id", "=", id).execute();
}

// ─── Env Variables ──────────────────────────────────────────────────

export async function getEnvVariablesByEnvironment(
  environmentId: string,
): Promise<ApiEnvVariableRow[]> {
  return db
    .selectFrom("api_env_variables")
    .selectAll()
    .where("environment_id", "=", environmentId)
    .execute();
}

export async function createEnvVariable(data: {
  environment_id: string;
  var_key: string;
  plain_value?: string | null;
  credential_id?: string | null;
  credential_field?: string | null;
  is_secret?: number;
}): Promise<ApiEnvVariableRow> {
  const id = uuidv4();
  await db
    .insertInto("api_env_variables")
    .values({
      id,
      environment_id: data.environment_id,
      var_key: data.var_key,
      plain_value: data.plain_value ?? null,
      credential_id: data.credential_id ?? null,
      credential_field: data.credential_field ?? null,
      is_secret: data.is_secret ?? 0,
      enabled: 1,
    })
    .execute();
  return (await db
    .selectFrom("api_env_variables")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function updateEnvVariable(
  id: string,
  data: {
    var_key?: string;
    plain_value?: string | null;
    credential_id?: string | null;
    credential_field?: string | null;
    is_secret?: number;
    enabled?: number;
  },
): Promise<void> {
  await db
    .updateTable("api_env_variables")
    .set(data)
    .where("id", "=", id)
    .execute();
}

export async function deleteEnvVariable(id: string): Promise<void> {
  await db.deleteFrom("api_env_variables").where("id", "=", id).execute();
}

// ─── History ────────────────────────────────────────────────────────

export async function getHistory(limit = 100): Promise<ApiHistoryRow[]> {
  return db
    .selectFrom("api_history")
    .selectAll()
    .orderBy("sent_at", "desc")
    .limit(limit)
    .execute();
}

export async function getHistoryByCollection(
  collectionId: string,
): Promise<ApiHistoryRow[]> {
  return db
    .selectFrom("api_history")
    .selectAll()
    .where("collection_id", "=", collectionId)
    .orderBy("sent_at", "desc")
    .execute();
}

export async function createHistoryEntry(data: {
  request_id?: string | null;
  collection_id?: string | null;
  method: string;
  url: string;
  request_headers?: string | null;
  request_body?: string | null;
  auth_type?: string | null;
  status_code?: number | null;
  response_headers?: string | null;
  response_body?: string | null;
  response_size?: number | null;
  elapsed_ms?: number | null;
}): Promise<ApiHistoryRow> {
  const id = uuidv4();
  await db
    .insertInto("api_history")
    .values({
      id,
      request_id: data.request_id ?? null,
      collection_id: data.collection_id ?? null,
      method: data.method,
      url: data.url,
      request_headers: data.request_headers ?? null,
      request_body: data.request_body ?? null,
      auth_type: data.auth_type ?? null,
      status_code: data.status_code ?? null,
      response_headers: data.response_headers ?? null,
      response_body: data.response_body ?? null,
      response_size: data.response_size ?? null,
      elapsed_ms: data.elapsed_ms ?? null,
      sent_at: now(),
    })
    .execute();
  return (await db
    .selectFrom("api_history")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  await db.deleteFrom("api_history").where("id", "=", id).execute();
}

export async function clearHistory(): Promise<void> {
  await db.deleteFrom("api_history").execute();
}

// ─── Collection Variables ───────────────────────────────────────────

export async function getCollectionVariables(
  collectionId: string,
): Promise<ApiCollectionVariableRow[]> {
  return db
    .selectFrom("api_collection_variables")
    .selectAll()
    .where("collection_id", "=", collectionId)
    .execute();
}

export async function createCollectionVariable(data: {
  collection_id: string;
  var_key: string;
  plain_value?: string | null;
  credential_id?: string | null;
  credential_field?: string | null;
  is_secret?: number;
}): Promise<ApiCollectionVariableRow> {
  const id = uuidv4();
  await db
    .insertInto("api_collection_variables")
    .values({
      id,
      collection_id: data.collection_id,
      var_key: data.var_key,
      plain_value: data.plain_value ?? null,
      credential_id: data.credential_id ?? null,
      credential_field: data.credential_field ?? null,
      is_secret: data.is_secret ?? 0,
      enabled: 1,
    })
    .execute();
  return (await db
    .selectFrom("api_collection_variables")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function updateCollectionVariable(
  id: string,
  data: {
    var_key?: string;
    plain_value?: string | null;
    credential_id?: string | null;
    credential_field?: string | null;
    is_secret?: number;
    enabled?: number;
  },
): Promise<void> {
  await db
    .updateTable("api_collection_variables")
    .set(data)
    .where("id", "=", id)
    .execute();
}

export async function deleteCollectionVariable(id: string): Promise<void> {
  await db.deleteFrom("api_collection_variables").where("id", "=", id).execute();
}

export async function upsertCollectionVariables(
  collectionId: string,
  vars: { key: string; value: string }[],
): Promise<void> {
  // Get existing variables for this collection
  const existing = await getCollectionVariables(collectionId);
  const existingKeys = new Map(existing.map((v) => [v.var_key, v]));

  for (const v of vars) {
    const ex = existingKeys.get(v.key);
    if (ex) {
      // Update if value changed
      if (ex.plain_value !== v.value) {
        await updateCollectionVariable(ex.id, { plain_value: v.value });
      }
    } else {
      // Insert new
      await createCollectionVariable({
        collection_id: collectionId,
        var_key: v.key,
        plain_value: v.value,
      });
    }
  }
}
