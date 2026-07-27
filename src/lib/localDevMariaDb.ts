/**
 * Register local MariaDB as a Badami Database connection.
 *
 * Password model (design KD17):
 * - `db_connections` has **no password column**
 * - Passwords live only in OS keychain via `save_db_password`
 * - Probe empty root password first; only call `save_db_password` when non-empty
 * - Never deletes Herd data
 */

import { invoke } from "@tauri-apps/api/core";
import {
  createConnection,
  getConnectionById,
  getConnections,
  updateConnection,
} from "@/db/queries/dbClient";
import {
  getLocalDevSetting,
  setLocalDevSetting,
} from "@/db/queries/localDev";
import {
  LOCAL_DEV_MARIADB_CONNECTION_NAME,
  type MariadbAuthProbe,
  type MariadbAuthProbeRequest,
  type RegisterMariaDbResult,
} from "@/types/localDev";
import type { DbConnectionRow } from "@/types/db";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3306;
const DEFAULT_USER = "root";
const CONNECTION_COLOR = "#10b981";

interface TestResult {
  success: boolean;
  message: string;
  latency_ms: number;
}

export async function probeMariaDbAuth(
  request: MariadbAuthProbeRequest = {},
): Promise<MariadbAuthProbe> {
  return invoke<MariadbAuthProbe>("ld_probe_mariadb_auth", {
    request: {
      host: request.host ?? DEFAULT_HOST,
      port: request.port ?? DEFAULT_PORT,
      username: request.username ?? DEFAULT_USER,
      password: request.password ?? "",
      socket: request.socket ?? null,
      skip_live: request.skip_live ?? null,
    },
  });
}

/** Also used as a secondary probe path matching the Database module. */
export async function testMariaDbConnection(password = ""): Promise<TestResult> {
  return invoke<TestResult>("dbc_test_connection", {
    params: {
      connection_id: "local-dev-mariadb-probe",
      engine: "mariadb",
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      database_name: null,
      username: DEFAULT_USER,
      password: password || null,
      sqlite_file_path: null,
      use_ssl: false,
      ssl_mode: "prefer",
      ssl_ca_path: null,
      tunnel_local_port: null,
    },
  });
}

async function findExistingMariaDbConnection(): Promise<DbConnectionRow | undefined> {
  const storedId = await getLocalDevSetting("mariadb_connection_id");
  if (storedId) {
    const byId = await getConnectionById(storedId);
    if (byId) return byId;
  }
  const all = await getConnections();
  return all.find(
    (c) =>
      c.name === LOCAL_DEV_MARIADB_CONNECTION_NAME ||
      (c.engine === "mariadb" &&
        c.host === DEFAULT_HOST &&
        c.port === DEFAULT_PORT &&
        (c.username === DEFAULT_USER || c.username === "root")),
  );
}

/**
 * Probe auth → upsert `db_connections` card → conditional keychain save →
 * store id in `local_dev_settings.mariadb_connection_id`.
 *
 * Does **not** open the Database workspace (caller may navigate).
 */
export async function registerLocalMariaDbConnection(
  password = "",
): Promise<RegisterMariaDbResult> {
  // 1. Prefer Rust probe (TCP/socket + empty-password auth); fall back to dbc_test.
  let probeOk = false;
  let needsPassword = false;
  let probeMessage = "";

  try {
    const probe = await probeMariaDbAuth({ password });
    probeOk = probe.ok;
    needsPassword = probe.needs_password;
    probeMessage = probe.message;
  } catch {
    // Rust command may be unavailable in web-only; use dbc_test_connection.
    try {
      const test = await testMariaDbConnection(password);
      probeOk = test.success;
      probeMessage = test.message;
      if (!test.success && !password) {
        const lower = test.message.toLowerCase();
        needsPassword =
          lower.includes("access denied") ||
          lower.includes("password") ||
          lower.includes("1045");
      }
    } catch (err) {
      return {
        connectionId: "",
        created: false,
        passwordSaved: false,
        needsPassword: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (!probeOk) {
    return {
      connectionId: "",
      created: false,
      passwordSaved: false,
      needsPassword,
      message: probeMessage || "Could not authenticate to MariaDB",
    };
  }

  // 2. Upsert connection (no password column)
  const existing = await findExistingMariaDbConnection();
  let connection: DbConnectionRow;
  let created = false;

  if (existing) {
    connection =
      (await updateConnection(existing.id, {
        name: LOCAL_DEV_MARIADB_CONNECTION_NAME,
        engine: "mariadb",
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        username: DEFAULT_USER,
        database_name: null,
        color: CONNECTION_COLOR,
      })) ?? existing;
  } else {
    connection = await createConnection({
      name: LOCAL_DEV_MARIADB_CONNECTION_NAME,
      engine: "mariadb",
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      username: DEFAULT_USER,
      database_name: null,
      color: CONNECTION_COLOR,
    });
    created = true;
  }

  // 3. Keychain only when password is non-empty (empty root = leave keychain empty)
  let passwordSaved = false;
  if (password.length > 0) {
    await invoke("save_db_password", {
      connectionId: connection.id,
      password,
    });
    passwordSaved = true;
  }

  // 4. Persist connection id for stable lookup
  await setLocalDevSetting("mariadb_connection_id", connection.id);

  return {
    connectionId: connection.id,
    created,
    passwordSaved,
    needsPassword: false,
    message: created
      ? `Registered “${LOCAL_DEV_MARIADB_CONNECTION_NAME}”`
      : `Updated “${LOCAL_DEV_MARIADB_CONNECTION_NAME}”`,
  };
}
