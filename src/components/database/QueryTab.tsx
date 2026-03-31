import { useState, useCallback, useRef, useEffect } from "react";
import { QueryEditor } from "./QueryEditor";
import { QueryToolbar } from "./QueryToolbar";
import { ResultGrid } from "./ResultGrid";
import { QueryHistory } from "./QueryHistory";
import { SavedQueries } from "./SavedQueries";
import { useQueryEditor } from "@/hooks/useQueryEditor";
import { useDbSchema, type TableInfo } from "@/hooks/useDbSchema";
import { useDbStore, type DbEngine } from "@/stores/dbStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2 } from "lucide-react";

interface QueryTabProps {
  poolId: string;
  connectionId: string;
  engine: DbEngine;
  initialSql?: string;
  database?: string;
  tabId: string;
}

export function QueryTab({
  poolId,
  connectionId,
  engine,
  initialSql = "",
  database,
  tabId,
}: QueryTabProps) {
  const { updateTabSql } = useDbStore();
  const [sqlContent, setSqlContent] = useState(initialSql);
  const [sidePanel, setSidePanel] = useState<"history" | "saved" | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Per-tab database — initialised from prop, updated by the toolbar selector.
  // Does NOT derive from global activeDatabase so tabs are independent.
  const [selectedDb, setSelectedDb] = useState<string | undefined>(
    database ?? useDbStore.getState().activeDatabase ?? undefined,
  );

  const { results, executing, activeResultIdx, setActiveResultIdx, runQuery, stop } =
    useQueryEditor();
  const { tables, listTables, listDatabases } = useDbSchema();
  const [dbList, setDbList] = useState<string[]>([]);

  // Load databases and tables for autocomplete
  useEffect(() => {
    listDatabases(poolId)
      .then((dbs) => setDbList(dbs.map((d) => d.name)))
      .catch(() => {});
    listTables(poolId, selectedDb).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId, selectedDb]);

  const tableNames = tables.map((t: TableInfo) => t.name);

  const handleChange = useCallback(
    (val: string) => {
      setSqlContent(val);
      updateTabSql(tabId, val);
    },
    [tabId, updateTabSql],
  );

  const handleRun = useCallback(() => {
    if (!sqlContent.trim()) return;
    runQuery(poolId, sqlContent, connectionId, selectedDb ?? null);
  }, [sqlContent, poolId, connectionId, selectedDb, runQuery]);

  const handleRunSelection = useCallback(() => {
    // Get selected text from the editor
    const editorEl = editorContainerRef.current?.querySelector("[data-query-editor]") as
      | (HTMLDivElement & { getSelectedText?: () => string })
      | null;
    const selected = editorEl?.getSelectedText?.() ?? sqlContent;
    if (!selected.trim()) return;
    runQuery(poolId, selected, connectionId, selectedDb ?? null);
  }, [sqlContent, poolId, connectionId, selectedDb, runQuery]);

  const handleSave = useCallback(() => {
    // Will open save dialog — handled by SavedQueries panel
    setSidePanel("saved");
  }, []);

  const handleDatabaseChange = useCallback(
    (newDb: string) => {
      setSelectedDb(newDb);
      listTables(poolId, newDb).catch(() => {});
    },
    [poolId, listTables],
  );

  const handleExplain = useCallback(() => {
    const sql = sqlContent.trim();
    if (!sql) return;
    const explainSql = `EXPLAIN ${sql}`;
    runQuery(poolId, explainSql, connectionId, selectedDb ?? null);
  }, [sqlContent, poolId, connectionId, selectedDb, runQuery]);

  const handleLoadFromHistory = useCallback(
    (sql: string) => {
      setSqlContent(sql);
      updateTabSql(tabId, sql);
      setSidePanel(null);
    },
    [tabId, updateTabSql],
  );

  // Export helpers
  const activeResult = results[activeResultIdx];

  const exportCsv = useCallback(() => {
    if (!activeResult?.queryResult) return;
    const { columns, rows } = activeResult.queryResult;
    const header = columns.join(",");
    const body = rows.map((r) =>
      r.map((v) => {
        if (v === null) return "";
        const s = String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(","),
    );
    const csv = [header, ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "query_result.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported as CSV");
  }, [activeResult]);

  const exportJson = useCallback(() => {
    if (!activeResult?.queryResult) return;
    const { columns, rows } = activeResult.queryResult;
    const data = rows.map((r) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[col] = r[i];
      });
      return obj;
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "query_result.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported as JSON");
  }, [activeResult]);

  const exportSqlInsert = useCallback(() => {
    if (!activeResult?.queryResult) return;
    const { columns, rows } = activeResult.queryResult;
    const tableName = "table_name"; // Generic placeholder
    const inserts = rows.map((r) => {
      const vals = r.map((v) => {
        if (v === null) return "NULL";
        if (typeof v === "number") return String(v);
        if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      return `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${vals.join(", ")});`;
    });
    const blob = new Blob([inserts.join("\n")], { type: "text/sql" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "query_result.sql";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported as SQL INSERT");
  }, [activeResult]);

  return (
    <div className="flex h-full overflow-hidden" ref={editorContainerRef}>
      {/* Side panel */}
      {sidePanel && (
        <div className="w-72 shrink-0 overflow-hidden border-r border-white/10">
          {sidePanel === "history" ? (
            <QueryHistory
              connectionId={connectionId}
              onSelect={handleLoadFromHistory}
              onClose={() => setSidePanel(null)}
            />
          ) : (
            <SavedQueries
              connectionId={connectionId}
              currentSql={sqlContent}
              onSelect={handleLoadFromHistory}
              onClose={() => setSidePanel(null)}
            />
          )}
        </div>
      )}

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <QueryToolbar
          onRun={handleRun}
          onRunSelection={handleRunSelection}
          onStop={stop}
          onSave={handleSave}
          onToggleHistory={() => setSidePanel((p) => (p === "history" ? null : "history"))}
          onToggleSaved={() => setSidePanel((p) => (p === "saved" ? null : "saved"))}
          onExportCsv={exportCsv}
          onExportJson={exportJson}
          onExportSqlInsert={exportSqlInsert}
          onExplain={handleExplain}
          executing={executing}
          databases={dbList}
          activeDatabase={selectedDb}
          onDatabaseChange={handleDatabaseChange}
          hasResult={!!(activeResult?.queryResult && activeResult.queryResult.rows.length > 0)}
        />

        {/* Editor (resizable top) */}
        <div className="flex min-h-[120px] flex-1 flex-col">
          <QueryEditor
            value={sqlContent}
            onChange={handleChange}
            engine={engine}
            tableNames={tableNames}
            onRun={handleRun}
            onRunSelection={handleRunSelection}
            className="flex-1"
          />
        </div>

        {/* Results (bottom) */}
        {results.length > 0 && (
          <div className="flex flex-col border-t border-white/10" style={{ height: "40%" }}>
            {/* Result tabs (for multi-statement) */}
            {results.length > 1 && (
              <div className="flex items-center gap-0.5 border-b border-white/10 px-2 py-0.5">
                {results.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveResultIdx(i)}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs transition-colors",
                      i === activeResultIdx ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5",
                      r.error ? "text-red-400" : "",
                    )}
                  >
                    Result {i + 1}
                    {r.error && " ✕"}
                  </button>
                ))}
              </div>
            )}

            {/* Active result */}
            {activeResult && (
              <div className="flex-1 overflow-hidden">
                {activeResult.error ? (
                  <div className="flex items-start gap-2 p-3 text-sm text-red-400">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-medium">Error</p>
                      <pre className="mt-1 whitespace-pre-wrap text-xs opacity-80">
                        {activeResult.error}
                      </pre>
                      <code className="mt-2 block text-xs text-muted-foreground">
                        {activeResult.sql}
                      </code>
                    </div>
                  </div>
                ) : activeResult.type === "query" && activeResult.queryResult ? (
                  <ResultGrid
                    columns={activeResult.queryResult.columns}
                    rows={activeResult.queryResult.rows}
                    totalRows={activeResult.queryResult.total_rows}
                    durationMs={activeResult.queryResult.duration_ms}
                    className="h-full"
                  />
                ) : activeResult.executeResult ? (
                  <div className="flex items-center gap-2 p-3 text-sm text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      {activeResult.executeResult.rows_affected} row(s) affected
                      <span className="ml-2 text-muted-foreground">
                        ({activeResult.executeResult.duration_ms}ms)
                      </span>
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
