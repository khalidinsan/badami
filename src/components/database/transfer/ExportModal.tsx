import { useState, useEffect, useCallback } from "react";
import {
  X,
  Download,
  FileSpreadsheet,
  FileJson,
  FileCode,
  Loader2,
  Archive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { save } from "@tauri-apps/plugin-dialog";
import { useDbTransfer } from "@/hooks/useDbTransfer";
import { useDbSchema } from "@/hooks/useDbSchema";
import { TransferProgress } from "./TransferProgress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ExportFormat = "csv" | "json" | "sql";

interface ExportModalProps {
  poolId: string;
  database?: string;
  onClose: () => void;
  /** Pre-fill with a query (from query editor export) */
  initialQuery?: string;
}

export function ExportModal({
  poolId,
  database,
  onClose,
  initialQuery,
}: ExportModalProps) {
  const { exporting, lastResult, exportCsv, exportJson, exportSql } = useDbTransfer();
  const { tables, listTables } = useDbSchema();

  const [format, setFormat] = useState<ExportFormat>("csv");
  const [mode, setMode] = useState<"query" | "tables">(initialQuery ? "query" : "tables");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [withData, setWithData] = useState(true);
  const [compress, setCompress] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    listTables(poolId, database);
  }, [poolId, database, listTables]);

  const toggleTable = (name: string) => {
    setSelectedTables((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
  };

  const selectAll = () => {
    setSelectedTables(tables.map((t) => t.name));
  };

  const getExtension = () => {
    if (format === "csv") return "csv";
    if (format === "json") return "json";
    return compress ? "sql.gz" : "sql";
  };

  const handleExport = useCallback(async () => {
    const ext = getExtension();
    const path = await save({
      title: "Export Database",
      defaultPath: `export.${ext}`,
      filters: [
        {
          name: format.toUpperCase(),
          extensions: [ext],
        },
      ],
    });

    if (!path) return;

    try {
      if (format === "sql" && mode === "tables") {
        if (selectedTables.length === 0) {
          toast.error("Select at least one table");
          return;
        }
        await exportSql(poolId, database ?? null, selectedTables, path, withData, compress);
      } else {
        const sql =
          mode === "query"
            ? query
            : `SELECT * FROM ${selectedTables[0] ?? "dual"}`;

        if (!sql.trim()) {
          toast.error("Enter a query or select tables");
          return;
        }

        if (format === "csv") {
          await exportCsv(poolId, sql, path);
        } else if (format === "json") {
          await exportJson(poolId, sql, path);
        } else {
          // sql format with query mode — wrap as single-table export
          await exportSql(poolId, database ?? null, selectedTables, path, withData, compress);
        }
      }
      setDone(true);
      toast.success("Export complete");
    } catch (err) {
      toast.error(String(err));
    }
  }, [format, mode, query, selectedTables, withData, compress, poolId, database, exportCsv, exportJson, exportSql]);

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="mx-4 w-full max-w-md rounded-xl border border-white/10 bg-background shadow-2xl">
          <TransferProgress
            type="export"
            running={false}
            result={lastResult}
            onClose={onClose}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-white/10 bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-medium">Export Data</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Format picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Format</label>
            <div className="flex gap-2">
              {([
                { value: "csv" as const, label: "CSV", icon: FileSpreadsheet },
                { value: "json" as const, label: "JSON", icon: FileJson },
                { value: "sql" as const, label: "SQL", icon: FileCode },
              ]).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setFormat(value)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors",
                    format === value
                      ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                      : "border-white/10 hover:bg-white/5",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Mode: Query vs Tables */}
          {format === "sql" ? (
            <>
              {/* Table selection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Tables</label>
                  <button onClick={selectAll} className="text-xs text-blue-400 hover:underline">
                    Select all
                  </button>
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-white/5">
                  {tables.map((t) => (
                    <label
                      key={t.name}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-white/5"
                    >
                      <Checkbox
                        checked={selectedTables.includes(t.name)}
                        onCheckedChange={() => toggleTable(t.name)}
                      />
                      <span className="text-xs">{t.name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {t.row_count != null ? `${t.row_count} rows` : ""}
                      </span>
                    </label>
                  ))}
                  {tables.length === 0 && (
                    <p className="p-3 text-center text-xs text-muted-foreground">
                      No tables found
                    </p>
                  )}
                </div>
              </div>

              {/* Options */}
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={withData}
                    onCheckedChange={(v) => setWithData(v === true)}
                  />
                  <span className="text-xs">Include data</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={compress}
                    onCheckedChange={(v) => setCompress(v === true)}
                  />
                  <span className="flex items-center gap-1 text-xs">
                    <Archive className="h-3 w-3" />
                    Compress (.gz)
                  </span>
                </label>
              </div>
            </>
          ) : (
            <>
              {/* Source mode */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Source</label>
                <Select value={mode} onValueChange={(v) => setMode(v as "query" | "tables")}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="query">Custom Query</SelectItem>
                    <SelectItem value="tables">From Table</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mode === "query" ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    SQL Query
                  </label>
                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-24 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs focus:border-blue-500/50 focus:outline-none"
                    placeholder="SELECT * FROM users WHERE active = 1"
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Table</label>
                  <Select
                    value={selectedTables[0] ?? ""}
                    onValueChange={(v) => setSelectedTables([v])}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Choose table..." />
                    </SelectTrigger>
                    <SelectContent>
                      {tables.map((t) => (
                        <SelectItem key={t.name} value={t.name}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={exporting}
            className="h-8 gap-1.5 text-xs"
          >
            {exporting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            Export
          </Button>
        </div>
      </div>
    </div>
  );
}
