import { invoke } from "@tauri-apps/api/core";
import {
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  CompiledQuery,
  QueryResult,
  DatabaseConnection,
  Driver,
  TransactionSettings,
} from "kysely";

/**
 * Custom Kysely Driver that routes all SQL through Tauri invoke commands
 * to the Rust libsql backend (Phase 14 — replacing tauri-plugin-sql).
 */
class LibsqlDriver implements Driver {
  async init(): Promise<void> {
    // DB is initialized via db_init command in initDatabase()
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new LibsqlConnection();
  }

  async beginTransaction(
    connection: DatabaseConnection,
    _settings: TransactionSettings,
  ): Promise<void> {
    await (connection as LibsqlConnection).executeQuery(
      CompiledQuery.raw("BEGIN"),
    );
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as LibsqlConnection).executeQuery(
      CompiledQuery.raw("COMMIT"),
    );
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as LibsqlConnection).executeQuery(
      CompiledQuery.raw("ROLLBACK"),
    );
  }

  async releaseConnection(): Promise<void> {
    // No-op: single connection managed by Rust
  }

  async destroy(): Promise<void> {
    // Connection lifecycle managed by Rust backend
  }
}

interface DbExecuteResult {
  rows_affected: number;
  last_insert_id: number | null;
}

class LibsqlConnection implements DatabaseConnection {
  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const sql = compiledQuery.sql;
    const params = compiledQuery.parameters as unknown[];

    const isSelect =
      sql.trimStart().toUpperCase().startsWith("SELECT") ||
      sql.trimStart().toUpperCase().startsWith("PRAGMA") ||
      sql.trimStart().toUpperCase().startsWith("WITH");

    if (isSelect) {
      const rows = await invoke<R[]>("db_query", { sql, params });
      return { rows };
    } else {
      const result = await invoke<DbExecuteResult>("db_execute", {
        sql,
        params,
      });
      return {
        rows: [],
        numAffectedRows: BigInt(result.rows_affected),
        insertId:
          result.last_insert_id != null
            ? BigInt(result.last_insert_id)
            : undefined,
      };
    }
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("Streaming is not supported with libsql Tauri driver");
  }
}

/**
 * Kysely dialect that uses libsql via Tauri invoke commands.
 * Drop-in replacement for the previous tauri-plugin-sql based dialect.
 */
export const LibsqlDialect = {
  createAdapter: () => new SqliteAdapter(),
  createDriver: () => new LibsqlDriver(),
  createIntrospector: (db: any) => new SqliteIntrospector(db),
  createQueryCompiler: () => new SqliteQueryCompiler(),
};
