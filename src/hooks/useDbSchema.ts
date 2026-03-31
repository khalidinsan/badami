import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface TableInfo {
  name: string;
  table_type: string;
  row_count: number | null;
}

interface DatabaseInfo {
  name: string;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  default_value: string | null;
  extra: string | null;
  ordinal_position: number;
}

export interface IndexInfo {
  name: string;
  index_type: string;
  columns: string[];
}

export interface ForeignKeyInfo {
  name: string;
  column: string;
  ref_table: string;
  ref_column: string;
  on_delete: string | null;
  on_update: string | null;
}

export interface TableStructure {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreign_keys: ForeignKeyInfo[];
}

interface QueryResult {
  columns: string[];
  rows: unknown[][];
  total_rows: number | null;
  duration_ms: number;
}

interface ExecuteResult {
  rows_affected: number;
  duration_ms: number;
}

export function useDbSchema() {
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [structure, setStructure] = useState<TableStructure | null>(null);
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingStructure, setLoadingStructure] = useState(false);

  const listDatabases = useCallback(async (poolId: string) => {
    setLoadingDbs(true);
    try {
      const result = await invoke<DatabaseInfo[]>("dbc_list_databases", { poolId });
      setDatabases(result);
      return result;
    } finally {
      setLoadingDbs(false);
    }
  }, []);

  const listTables = useCallback(async (poolId: string, database?: string) => {
    setLoadingTables(true);
    try {
      const result = await invoke<TableInfo[]>("dbc_list_tables", {
        poolId,
        database: database ?? null,
      });
      setTables(result);
      return result;
    } finally {
      setLoadingTables(false);
    }
  }, []);

  const getTableStructure = useCallback(
    async (poolId: string, table: string, database?: string) => {
      setLoadingStructure(true);
      try {
        const result = await invoke<TableStructure>("dbc_get_table_structure", {
          poolId,
          database: database ?? null,
          table,
        });
        setStructure(result);
        return result;
      } finally {
        setLoadingStructure(false);
      }
    },
    [],
  );

  const getCreateStatement = useCallback(
    async (poolId: string, table: string, database?: string) => {
      return invoke<string>("dbc_get_create_statement", {
        poolId,
        database: database ?? null,
        table,
      });
    },
    [],
  );

  return {
    databases,
    tables,
    structure,
    loadingDbs,
    loadingTables,
    loadingStructure,
    listDatabases,
    listTables,
    getTableStructure,
    getCreateStatement,
  };
}

export function useDbData() {
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runQuery = useCallback(
    async (poolId: string, sql: string, page?: number, pageSize?: number, database?: string) => {
      setExecuting(true);
      setError(null);
      try {
        const result = await invoke<QueryResult>("dbc_query", {
          poolId,
          sql,
          database: database ?? null,
          page: page ?? 1,
          pageSize: pageSize ?? 100,
        });
        setQueryResult(result);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setExecuting(false);
      }
    },
    [],
  );

  const executeSql = useCallback(async (poolId: string, sql: string) => {
    setExecuting(true);
    setError(null);
    try {
      const result = await invoke<ExecuteResult>("dbc_execute", { poolId, sql });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setExecuting(false);
    }
  }, []);

  const updateCell = useCallback(
    async (
      poolId: string,
      table: string,
      pkColumn: string,
      pkValue: unknown,
      column: string,
      value: unknown,
    ) => {
      return invoke("dbc_update_cell", {
        poolId,
        table,
        pkColumn,
        pkValue,
        column,
        value,
      });
    },
    [],
  );

  const insertRow = useCallback(
    async (poolId: string, table: string, data: Record<string, unknown>) => {
      return invoke("dbc_insert_row", { poolId, table, data });
    },
    [],
  );

  const deleteRows = useCallback(
    async (poolId: string, table: string, pkColumn: string, pkValues: unknown[]) => {
      return invoke<number>("dbc_delete_rows", { poolId, table, pkColumn, pkValues });
    },
    [],
  );

  return {
    queryResult,
    executing,
    error,
    runQuery,
    executeSql,
    updateCell,
    insertRow,
    deleteRows,
    setQueryResult,
    setError,
  };
}

export type { DatabaseInfo, QueryResult, ExecuteResult };
