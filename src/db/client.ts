import { invoke } from "@tauri-apps/api/core";
import { Kysely } from "kysely";
import type { Database as DatabaseSchema } from "@/types/db";
import { LibsqlDialect } from "./libsql-dialect";
import migrationSql from "./migrations/001_initial.sql?raw";
import migration002 from "./migrations/002_project_content.sql?raw";
import migration003 from "./migrations/003_remove_daily_plans.sql?raw";
import migration004 from "./migrations/004_project_category.sql?raw";
import migration005 from "./migrations/005_project_categories.sql?raw";
import migration006 from "./migrations/006_server_module.sql?raw";
import migration007 from "./migrations/007_server_optional_project.sql?raw";
import migration008 from "./migrations/008_credential_module.sql?raw";
import migration009 from "./migrations/009_api_module.sql?raw";
import migration010 from "./migrations/010_collection_variables.sql?raw";
import migration011 from "./migrations/011_starred_tasks.sql?raw";
import migration012 from "./migrations/012_due_time.sql?raw";
import migration013 from "./migrations/013_recurring_tasks.sql?raw";
import migration014 from "./migrations/014_reminders.sql?raw";
import migration015 from "./migrations/015_sync_settings.sql?raw";

interface DbInitResult {
  success: boolean;
  sync_enabled: boolean;
}

export async function initDatabase(): Promise<DbInitResult> {
  const migrations = [
    migrationSql,
    migration002,
    migration003,
    migration004,
    migration005,
    migration006,
    migration007,
    migration008,
    migration009,
    migration010,
    migration011,
    migration012,
    migration013,
    migration014,
    migration015,
  ];

  return await invoke<DbInitResult>("db_init", { migrations });
}

export const db = new Kysely<DatabaseSchema>({
  dialect: LibsqlDialect,
});
