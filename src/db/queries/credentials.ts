import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type {
  CredentialRow,
  CredentialFieldRow,
  CredentialTotpRow,
  CredentialEnvVarRow,
  VaultConfigRow,
} from "@/types/db";

// ─── Credentials ────────────────────────────────────────────────────

export async function getAllSensitiveFields(): Promise<CredentialFieldRow[]> {
  return await db
    .selectFrom("credential_fields")
    .selectAll()
    .where("is_sensitive", "=", 1)
    .execute();
}

export async function getAllTotpRecords(): Promise<CredentialTotpRow[]> {
  return await db.selectFrom("credential_totp").selectAll().execute();
}

export async function getAllEnvVars(): Promise<CredentialEnvVarRow[]> {
  return await db.selectFrom("credential_env_vars").selectAll().execute();
}

export async function updateFieldEncryption(
  id: string,
  encryptedValue: unknown,
  iv: unknown,
): Promise<void> {
  await db
    .updateTable("credential_fields")
    .set({ encrypted_value: encryptedValue, iv })
    .where("id", "=", id)
    .execute();
}

export async function updateTotpEncryption(
  id: string,
  encryptedSecret: unknown,
  iv: unknown,
): Promise<void> {
  await db
    .updateTable("credential_totp")
    .set({ encrypted_secret: encryptedSecret, iv })
    .where("id", "=", id)
    .execute();
}

export async function updateEnvVarEncryption(
  id: string,
  encryptedValue: unknown,
  iv: unknown,
): Promise<void> {
  await db
    .updateTable("credential_env_vars")
    .set({ encrypted_value: encryptedValue, iv })
    .where("id", "=", id)
    .execute();
}

export async function getAllCredentials(): Promise<CredentialRow[]> {
  return await db
    .selectFrom("credentials")
    .selectAll()
    .orderBy("sort_order", "asc")
    .orderBy("created_at", "desc")
    .execute();
}

export async function getCredentialsByProject(
  projectId: string,
): Promise<CredentialRow[]> {
  return await db
    .selectFrom("credentials")
    .selectAll()
    .where("project_id", "=", projectId)
    .orderBy("sort_order", "asc")
    .orderBy("created_at", "desc")
    .execute();
}

export async function getCredentialById(
  id: string,
): Promise<CredentialRow | undefined> {
  return await db
    .selectFrom("credentials")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createCredential(data: {
  project_id?: string | null;
  type: string;
  name: string;
  username?: string | null;
  url?: string | null;
  service_name?: string | null;
  environment?: string;
  tags?: string[] | null;
  expires_at?: string | null;
  notes?: string | null;
}): Promise<CredentialRow> {
  const id = uuidv4();
  const timestamp = now();

  const maxOrder = await db
    .selectFrom("credentials")
    .select(db.fn.max("sort_order").as("max_order"))
    .where("project_id", data.project_id ? "=" : "is", data.project_id ?? null)
    .executeTakeFirst();

  const sortOrder = ((maxOrder?.max_order as number) ?? -1) + 1;

  await db
    .insertInto("credentials")
    .values({
      id,
      project_id: data.project_id ?? null,
      type: data.type,
      name: data.name,
      username: data.username ?? null,
      url: data.url ?? null,
      service_name: data.service_name ?? null,
      environment: data.environment ?? "none",
      tags: data.tags ? JSON.stringify(data.tags) : null,
      expires_at: data.expires_at ?? null,
      has_totp: 0,
      notes: data.notes ?? null,
      sort_order: sortOrder,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();

  return (await getCredentialById(id))!;
}

export async function updateCredential(
  id: string,
  data: {
    name?: string;
    username?: string | null;
    url?: string | null;
    service_name?: string | null;
    environment?: string;
    tags?: string[] | null;
    expires_at?: string | null;
    notes?: string | null;
    project_id?: string | null;
    has_totp?: number;
  },
): Promise<CredentialRow | undefined> {
  const timestamp = now();

  const values: Record<string, unknown> = { updated_at: timestamp };
  if (data.name !== undefined) values.name = data.name;
  if (data.username !== undefined) values.username = data.username;
  if (data.url !== undefined) values.url = data.url;
  if (data.service_name !== undefined) values.service_name = data.service_name;
  if (data.environment !== undefined) values.environment = data.environment;
  if (data.tags !== undefined)
    values.tags = data.tags ? JSON.stringify(data.tags) : null;
  if (data.expires_at !== undefined) values.expires_at = data.expires_at;
  if (data.notes !== undefined) values.notes = data.notes;
  if (data.project_id !== undefined) values.project_id = data.project_id;
  if (data.has_totp !== undefined) values.has_totp = data.has_totp;

  await db
    .updateTable("credentials")
    .set(values)
    .where("id", "=", id)
    .execute();

  return getCredentialById(id);
}

export async function deleteCredential(id: string): Promise<void> {
  await db.deleteFrom("credentials").where("id", "=", id).execute();
}

// ─── Credential Fields ──────────────────────────────────────────────

export async function getFieldsByCredential(
  credentialId: string,
): Promise<CredentialFieldRow[]> {
  return await db
    .selectFrom("credential_fields")
    .selectAll()
    .where("credential_id", "=", credentialId)
    .orderBy("field_order", "asc")
    .execute();
}

export async function createCredentialField(data: {
  credential_id: string;
  field_key: string;
  field_label: string;
  encrypted_value?: unknown | null;
  iv?: unknown | null;
  plain_value?: string | null;
  is_sensitive?: number;
  field_order?: number;
}): Promise<CredentialFieldRow> {
  const id = uuidv4();

  await db
    .insertInto("credential_fields")
    .values({
      id,
      credential_id: data.credential_id,
      field_key: data.field_key,
      field_label: data.field_label,
      encrypted_value: data.encrypted_value ?? null,
      iv: data.iv ?? null,
      plain_value: data.plain_value ?? null,
      is_sensitive: data.is_sensitive ?? 1,
      field_order: data.field_order ?? 0,
    })
    .execute();

  return (await db
    .selectFrom("credential_fields")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function updateCredentialField(
  id: string,
  data: {
    encrypted_value?: unknown | null;
    iv?: unknown | null;
    plain_value?: string | null;
    field_label?: string;
  },
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (data.encrypted_value !== undefined)
    values.encrypted_value = data.encrypted_value;
  if (data.iv !== undefined) values.iv = data.iv;
  if (data.plain_value !== undefined) values.plain_value = data.plain_value;
  if (data.field_label !== undefined) values.field_label = data.field_label;

  await db
    .updateTable("credential_fields")
    .set(values)
    .where("id", "=", id)
    .execute();
}

export async function deleteFieldsByCredential(
  credentialId: string,
): Promise<void> {
  await db
    .deleteFrom("credential_fields")
    .where("credential_id", "=", credentialId)
    .execute();
}

// ─── Credential TOTP ────────────────────────────────────────────────

export async function getTotpByCredential(
  credentialId: string,
): Promise<CredentialTotpRow | undefined> {
  return await db
    .selectFrom("credential_totp")
    .selectAll()
    .where("credential_id", "=", credentialId)
    .executeTakeFirst();
}

export async function upsertCredentialTotp(data: {
  credential_id: string;
  encrypted_secret: unknown;
  iv: unknown;
  digits?: number;
  period_seconds?: number;
  algorithm?: string;
}): Promise<void> {
  const existing = await getTotpByCredential(data.credential_id);
  if (existing) {
    await db
      .updateTable("credential_totp")
      .set({
        encrypted_secret: data.encrypted_secret,
        iv: data.iv,
        digits: data.digits ?? 6,
        period_seconds: data.period_seconds ?? 30,
        algorithm: data.algorithm ?? "SHA1",
      })
      .where("credential_id", "=", data.credential_id)
      .execute();
  } else {
    const id = uuidv4();
    await db
      .insertInto("credential_totp")
      .values({
        id,
        credential_id: data.credential_id,
        encrypted_secret: data.encrypted_secret,
        iv: data.iv,
        digits: data.digits ?? 6,
        period_seconds: data.period_seconds ?? 30,
        algorithm: data.algorithm ?? "SHA1",
      })
      .execute();
  }

  // Mark credential as having TOTP
  await db
    .updateTable("credentials")
    .set({ has_totp: 1, updated_at: now() })
    .where("id", "=", data.credential_id)
    .execute();
}

export async function deleteCredentialTotp(
  credentialId: string,
): Promise<void> {
  await db
    .deleteFrom("credential_totp")
    .where("credential_id", "=", credentialId)
    .execute();
  await db
    .updateTable("credentials")
    .set({ has_totp: 0, updated_at: now() })
    .where("id", "=", credentialId)
    .execute();
}

// ─── Environment Variables ──────────────────────────────────────────

export async function getEnvVarsByCredential(
  credentialId: string,
): Promise<CredentialEnvVarRow[]> {
  return await db
    .selectFrom("credential_env_vars")
    .selectAll()
    .where("credential_id", "=", credentialId)
    .orderBy("var_order", "asc")
    .execute();
}

export async function createEnvVar(data: {
  credential_id: string;
  var_key: string;
  encrypted_value: unknown;
  iv: unknown;
  var_order?: number;
}): Promise<CredentialEnvVarRow> {
  const id = uuidv4();

  await db
    .insertInto("credential_env_vars")
    .values({
      id,
      credential_id: data.credential_id,
      var_key: data.var_key,
      encrypted_value: data.encrypted_value,
      iv: data.iv,
      var_order: data.var_order ?? 0,
    })
    .execute();

  return (await db
    .selectFrom("credential_env_vars")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function updateEnvVar(
  id: string,
  data: {
    var_key?: string;
    encrypted_value?: unknown;
    iv?: unknown;
  },
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (data.var_key !== undefined) values.var_key = data.var_key;
  if (data.encrypted_value !== undefined)
    values.encrypted_value = data.encrypted_value;
  if (data.iv !== undefined) values.iv = data.iv;

  await db
    .updateTable("credential_env_vars")
    .set(values)
    .where("id", "=", id)
    .execute();
}

export async function deleteEnvVar(id: string): Promise<void> {
  await db
    .deleteFrom("credential_env_vars")
    .where("id", "=", id)
    .execute();
}

export async function deleteEnvVarsByCredential(
  credentialId: string,
): Promise<void> {
  await db
    .deleteFrom("credential_env_vars")
    .where("credential_id", "=", credentialId)
    .execute();
}

// ─── Vault Config ───────────────────────────────────────────────────

export async function getVaultConfig(): Promise<VaultConfigRow | undefined> {
  return await db
    .selectFrom("vault_config")
    .selectAll()
    .where("id", "=", "singleton")
    .executeTakeFirst();
}

export async function updateVaultConfig(data: {
  has_master_password?: number;
  password_hint?: string | null;
  argon2_salt?: unknown | null;
  auto_lock_minutes?: number;
}): Promise<void> {
  const values: Record<string, unknown> = { updated_at: now() };
  if (data.has_master_password !== undefined)
    values.has_master_password = data.has_master_password;
  if (data.password_hint !== undefined)
    values.password_hint = data.password_hint;
  if (data.argon2_salt !== undefined) values.argon2_salt = data.argon2_salt;
  if (data.auto_lock_minutes !== undefined)
    values.auto_lock_minutes = data.auto_lock_minutes;

  await db
    .updateTable("vault_config")
    .set(values)
    .where("id", "=", "singleton")
    .execute();
}
