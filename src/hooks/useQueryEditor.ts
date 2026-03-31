import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { splitStatements } from "@/lib/sqlDialect";
import * as dbQueries from "@/db/queries/dbClient";
import type { QueryResult, ExecuteResult } from "@/hooks/useDbSchema";

export interface StatementResult {
  sql: string;
  type: "query" | "execute";
  queryResult?: QueryResult;
  executeResult?: ExecuteResult;
  error?: string;
}

export function useQueryEditor() {
  const [results, setResults] = useState<StatementResult[]>([]);
  const [executing, setExecuting] = useState(false);
  const [activeResultIdx, setActiveResultIdx] = useState(0);
  const cancelRef = useRef(false);

  const runQuery = useCallback(
    async (
      poolId: string,
      sqlText: string,
      connectionId: string | null,
      databaseName: string | null,
    ) => {
      const stmts = splitStatements(sqlText);
      if (stmts.length === 0) return;

      setExecuting(true);
      cancelRef.current = false;
      const newResults: StatementResult[] = [];

      for (const stmt of stmts) {
        if (cancelRef.current) break;

        const upper = stmt.trimStart().toUpperCase();
        const isSelect =
          upper.startsWith("SELECT") ||
          upper.startsWith("SHOW") ||
          upper.startsWith("DESCRIBE") ||
          upper.startsWith("DESC") ||
          upper.startsWith("EXPLAIN") ||
          upper.startsWith("PRAGMA") ||
          upper.startsWith("WITH");

        try {
          if (isSelect) {
            const result = await invoke<QueryResult>("dbc_query", {
              poolId,
              sql: stmt,
              database: databaseName ?? null,
              page: 1,
              pageSize: 1000,
            });
            newResults.push({ sql: stmt, type: "query", queryResult: result });
          } else {
            const result = await invoke<ExecuteResult>("dbc_execute", {
              poolId,
              sql: stmt,
            });
            newResults.push({ sql: stmt, type: "execute", executeResult: result });
          }

          // Log to history — success
          dbQueries
            .addQueryHistory({
              connection_id: connectionId,
              database_name: databaseName,
              sql_content: stmt,
              status: "success",
              rows_affected: isSelect
                ? (newResults[newResults.length - 1].queryResult?.rows.length ?? null)
                : (newResults[newResults.length - 1].executeResult?.rows_affected ?? null),
              duration_ms: isSelect
                ? (newResults[newResults.length - 1].queryResult?.duration_ms ?? null)
                : (newResults[newResults.length - 1].executeResult?.duration_ms ?? null),
            })
            .catch(console.error);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          newResults.push({ sql: stmt, type: isSelect ? "query" : "execute", error: msg });

          // Log to history — error
          dbQueries
            .addQueryHistory({
              connection_id: connectionId,
              database_name: databaseName,
              sql_content: stmt,
              status: "error",
              error_message: msg,
            })
            .catch(console.error);
        }
      }

      setResults(newResults);
      setActiveResultIdx(0);
      setExecuting(false);
    },
    [],
  );

  const stop = useCallback(() => {
    cancelRef.current = true;
  }, []);

  return {
    results,
    executing,
    activeResultIdx,
    setActiveResultIdx,
    runQuery,
    stop,
    setResults,
  };
}
