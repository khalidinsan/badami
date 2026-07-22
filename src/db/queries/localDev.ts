import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type {
  LocalDevSettingRow,
  LocalDevBinaryRow,
  LocalDevServiceRow,
  LocalDevParkPathRow,
  LocalDevSiteRow,
  LocalDevEventRow,
} from "@/types/db";
import type {
  BinaryRole,
  BinarySource,
  EventLevel,
  LocalDevSettingKey,
  ServiceKind,
  SiteKind,
} from "@/types/localDev";

/** Strip trailing slashes for park-path uniqueness (Herd config.json duplicates). */
function normalizeParkPath(path: string): string {
  const stripped = path.replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

// ─── Settings ───────────────────────────────────────────────────────

export async function getLocalDevSetting(
  key: LocalDevSettingKey,
): Promise<string | null> {
  const row = await db
    .selectFrom("local_dev_settings")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  return row?.value ?? null;
}

export async function setLocalDevSetting(
  key: LocalDevSettingKey,
  value: string,
): Promise<void> {
  const existing = await getLocalDevSetting(key);
  if (existing !== null) {
    await db
      .updateTable("local_dev_settings")
      .set({ value })
      .where("key", "=", key)
      .execute();
  } else {
    await db
      .insertInto("local_dev_settings")
      .values({ key, value })
      .execute();
  }
}

export async function getLocalDevSettings(
  keys?: LocalDevSettingKey[],
): Promise<Record<string, string>> {
  let query = db.selectFrom("local_dev_settings").select(["key", "value"]);
  if (keys && keys.length > 0) {
    query = query.where("key", "in", keys);
  }
  const rows = await query.execute();
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export async function getAllLocalDevSettings(): Promise<LocalDevSettingRow[]> {
  return db.selectFrom("local_dev_settings").selectAll().execute();
}

// ─── Binaries ───────────────────────────────────────────────────────

export async function getBinaries(
  role?: BinaryRole,
): Promise<LocalDevBinaryRow[]> {
  let query = db
    .selectFrom("local_dev_binaries")
    .selectAll()
    .orderBy("role", "asc")
    .orderBy("created_at", "desc");

  if (role) {
    query = query.where("role", "=", role);
  }

  return query.execute();
}

export async function getBinaryById(
  id: string,
): Promise<LocalDevBinaryRow | undefined> {
  return db
    .selectFrom("local_dev_binaries")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function getSelectedBinary(
  role: BinaryRole,
): Promise<LocalDevBinaryRow | undefined> {
  return db
    .selectFrom("local_dev_binaries")
    .selectAll()
    .where("role", "=", role)
    .where("is_selected", "=", 1)
    .executeTakeFirst();
}

/**
 * Insert a binary. Always stores is_selected=0; call selectBinary to select.
 * (Avoids multiple selected rows for the same role.)
 */
export async function createBinary(data: {
  role: BinaryRole;
  path: string;
  source: BinarySource;
  version?: string | null;
  arch?: string | null;
  meta_json?: string | null;
}): Promise<LocalDevBinaryRow> {
  const id = uuidv4();
  const timestamp = now();

  await db
    .insertInto("local_dev_binaries")
    .values({
      id,
      role: data.role,
      path: data.path,
      source: data.source,
      version: data.version ?? null,
      arch: data.arch ?? null,
      is_selected: 0,
      meta_json: data.meta_json ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();

  return (await getBinaryById(id))!;
}

export async function updateBinary(
  id: string,
  data: Partial<{
    role: BinaryRole;
    path: string;
    source: BinarySource;
    version: string | null;
    arch: string | null;
    meta_json: string | null;
  }>,
): Promise<LocalDevBinaryRow | undefined> {
  await db
    .updateTable("local_dev_binaries")
    .set({ ...data, updated_at: now() })
    .where("id", "=", id)
    .execute();

  return getBinaryById(id);
}

/**
 * Select one binary for a role (clears other selections for that role).
 * No-ops if binaryId does not belong to role (avoids clearing selection on bad id).
 * If the second update fails after clear, callers should treat as "none selected" and re-run.
 */
export async function selectBinary(
  role: BinaryRole,
  binaryId: string,
): Promise<void> {
  const binary = await getBinaryById(binaryId);
  if (!binary || binary.role !== role) {
    return;
  }

  await db
    .updateTable("local_dev_binaries")
    .set({ is_selected: 0, updated_at: now() })
    .where("role", "=", role)
    .execute();

  await db
    .updateTable("local_dev_binaries")
    .set({ is_selected: 1, updated_at: now() })
    .where("id", "=", binaryId)
    .where("role", "=", role)
    .execute();
}

export async function deleteBinary(id: string): Promise<void> {
  await db.deleteFrom("local_dev_binaries").where("id", "=", id).execute();
}

// ─── Services ───────────────────────────────────────────────────────

export async function getServices(): Promise<LocalDevServiceRow[]> {
  return db
    .selectFrom("local_dev_services")
    .selectAll()
    .orderBy("display_name", "asc")
    .execute();
}

export async function getServiceById(
  id: string,
): Promise<LocalDevServiceRow | undefined> {
  return db
    .selectFrom("local_dev_services")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function getServiceByKind(
  kind: ServiceKind,
): Promise<LocalDevServiceRow | undefined> {
  return db
    .selectFrom("local_dev_services")
    .selectAll()
    .where("kind", "=", kind)
    .executeTakeFirst();
}

export async function createService(data: {
  id?: string;
  kind: ServiceKind;
  display_name: string;
  enabled?: number;
  auto_start?: number;
  auto_restart?: number;
  binary_id?: string | null;
  config_path?: string | null;
  pid_file?: string | null;
  log_file?: string | null;
  data_dir?: string | null;
  port?: number | null;
  socket_path?: string | null;
  extra_json?: string | null;
  last_status?: string | null;
}): Promise<LocalDevServiceRow> {
  const id = data.id ?? uuidv4();
  const timestamp = now();

  await db
    .insertInto("local_dev_services")
    .values({
      id,
      kind: data.kind,
      display_name: data.display_name,
      enabled: data.enabled ?? 1,
      auto_start: data.auto_start ?? 0,
      auto_restart: data.auto_restart ?? 0,
      binary_id: data.binary_id ?? null,
      config_path: data.config_path ?? null,
      pid_file: data.pid_file ?? null,
      log_file: data.log_file ?? null,
      data_dir: data.data_dir ?? null,
      port: data.port ?? null,
      socket_path: data.socket_path ?? null,
      extra_json: data.extra_json ?? null,
      last_status: data.last_status ?? null,
      last_error: null,
      last_started_at: null,
      updated_at: timestamp,
    })
    .execute();

  return (await getServiceById(id))!;
}

export async function updateService(
  id: string,
  data: Partial<{
    kind: ServiceKind;
    display_name: string;
    enabled: number;
    auto_start: number;
    auto_restart: number;
    binary_id: string | null;
    config_path: string | null;
    pid_file: string | null;
    log_file: string | null;
    data_dir: string | null;
    port: number | null;
    socket_path: string | null;
    extra_json: string | null;
    last_status: string | null;
    last_error: string | null;
    last_started_at: string | null;
  }>,
): Promise<LocalDevServiceRow | undefined> {
  await db
    .updateTable("local_dev_services")
    .set({ ...data, updated_at: now() })
    .where("id", "=", id)
    .execute();

  return getServiceById(id);
}

export async function deleteService(id: string): Promise<void> {
  await db.deleteFrom("local_dev_services").where("id", "=", id).execute();
}

// ─── Park Paths ─────────────────────────────────────────────────────

export async function getParkPaths(): Promise<LocalDevParkPathRow[]> {
  return db
    .selectFrom("local_dev_park_paths")
    .selectAll()
    .orderBy("sort_order", "asc")
    .orderBy("created_at", "asc")
    .execute();
}

export async function getParkPathById(
  id: string,
): Promise<LocalDevParkPathRow | undefined> {
  return db
    .selectFrom("local_dev_park_paths")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createParkPath(path: string): Promise<LocalDevParkPathRow> {
  const id = uuidv4();
  const timestamp = now();
  const normalized = normalizeParkPath(path);

  const maxOrder = await db
    .selectFrom("local_dev_park_paths")
    .select(db.fn.max("sort_order").as("max_order"))
    .executeTakeFirst();

  const sortOrder = ((maxOrder?.max_order as number) ?? -1) + 1;

  await db
    .insertInto("local_dev_park_paths")
    .values({
      id,
      path: normalized,
      sort_order: sortOrder,
      created_at: timestamp,
    })
    .execute();

  return (await getParkPathById(id))!;
}

export async function deleteParkPath(id: string): Promise<void> {
  await db.deleteFrom("local_dev_park_paths").where("id", "=", id).execute();
}

export async function updateParkPathSortOrder(
  id: string,
  sortOrder: number,
): Promise<void> {
  await db
    .updateTable("local_dev_park_paths")
    .set({ sort_order: sortOrder })
    .where("id", "=", id)
    .execute();
}

// ─── Sites ──────────────────────────────────────────────────────────

export async function getSites(): Promise<LocalDevSiteRow[]> {
  return db
    .selectFrom("local_dev_sites")
    .selectAll()
    .orderBy("sort_order", "asc")
    .orderBy("name", "asc")
    .execute();
}

export async function getSiteById(
  id: string,
): Promise<LocalDevSiteRow | undefined> {
  return db
    .selectFrom("local_dev_sites")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function getSiteByNameTld(
  name: string,
  tld: string,
): Promise<LocalDevSiteRow | undefined> {
  return db
    .selectFrom("local_dev_sites")
    .selectAll()
    .where("name", "=", name)
    .where("tld", "=", tld)
    .executeTakeFirst();
}

export async function getSitesByProject(
  projectId: string,
): Promise<LocalDevSiteRow[]> {
  return db
    .selectFrom("local_dev_sites")
    .selectAll()
    .where("project_id", "=", projectId)
    .orderBy("sort_order", "asc")
    .execute();
}

export async function createSite(data: {
  name: string;
  path: string;
  kind: SiteKind;
  tld?: string;
  php_version?: string | null;
  secured?: number;
  project_id?: string | null;
  driver?: string | null;
  notes?: string | null;
}): Promise<LocalDevSiteRow> {
  const id = uuidv4();
  const timestamp = now();

  const maxOrder = await db
    .selectFrom("local_dev_sites")
    .select(db.fn.max("sort_order").as("max_order"))
    .executeTakeFirst();

  const sortOrder = ((maxOrder?.max_order as number) ?? -1) + 1;

  await db
    .insertInto("local_dev_sites")
    .values({
      id,
      name: data.name,
      tld: data.tld ?? "test",
      path: data.path,
      kind: data.kind,
      php_version: data.php_version ?? null,
      secured: data.secured ?? 0,
      project_id: data.project_id ?? null,
      driver: data.driver ?? null,
      notes: data.notes ?? null,
      sort_order: sortOrder,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .execute();

  return (await getSiteById(id))!;
}

export async function updateSite(
  id: string,
  data: Partial<{
    name: string;
    tld: string;
    path: string;
    kind: SiteKind;
    php_version: string | null;
    secured: number;
    project_id: string | null;
    driver: string | null;
    notes: string | null;
    sort_order: number;
  }>,
): Promise<LocalDevSiteRow | undefined> {
  await db
    .updateTable("local_dev_sites")
    .set({ ...data, updated_at: now() })
    .where("id", "=", id)
    .execute();

  return getSiteById(id);
}

export async function deleteSite(id: string): Promise<void> {
  await db.deleteFrom("local_dev_sites").where("id", "=", id).execute();
}

// ─── Events ─────────────────────────────────────────────────────────

export async function getEvents(
  options: {
    serviceId?: string;
    limit?: number;
  } = {},
): Promise<LocalDevEventRow[]> {
  const limit = options.limit ?? 100;
  let query = db
    .selectFrom("local_dev_events")
    .selectAll()
    .orderBy("created_at", "desc")
    .limit(limit);

  if (options.serviceId) {
    query = query.where("service_id", "=", options.serviceId);
  }

  return query.execute();
}

export async function addEvent(data: {
  service_id?: string | null;
  level: EventLevel;
  message: string;
}): Promise<LocalDevEventRow> {
  const id = uuidv4();
  const created_at = now();

  await db
    .insertInto("local_dev_events")
    .values({
      id,
      service_id: data.service_id ?? null,
      level: data.level,
      message: data.message,
      created_at,
    })
    .execute();

  return (await db
    .selectFrom("local_dev_events")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst())!;
}

export async function clearEvents(serviceId?: string): Promise<void> {
  if (serviceId) {
    await db
      .deleteFrom("local_dev_events")
      .where("service_id", "=", serviceId)
      .execute();
  } else {
    await db.deleteFrom("local_dev_events").execute();
  }
}
