import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ColumnInfo, IndexInfo, ForeignKeyInfo, TableStructure } from "@/hooks/useDbSchema";

export function useSchemaManager() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeDdl = useCallback(async (poolId: string, sql: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<string>("dbc_execute_ddl", { poolId, sql });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const dropTable = useCallback(
    async (poolId: string, table: string, database?: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await invoke<string>("dbc_drop_table", {
          poolId,
          database: database ?? null,
          table,
        });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const getTableStructure = useCallback(
    async (poolId: string, table: string, database?: string) => {
      setLoading(true);
      try {
        const result = await invoke<TableStructure>("dbc_get_table_structure", {
          poolId,
          database: database ?? null,
          table,
        });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { loading, error, executeDdl, dropTable, getTableStructure };
}

export type { ColumnInfo, IndexInfo, ForeignKeyInfo, TableStructure };
