import { useState, useEffect, useCallback } from "react";
import {
  X,
  Upload,
  FileSpreadsheet,
  FileCode,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { open } from "@tauri-apps/plugin-dialog";
import { useDbTransfer, type CsvPreview } from "@/hooks/useDbTransfer";
import { useDbSchema, type ColumnInfo } from "@/hooks/useDbSchema";
import { TransferProgress } from "./TransferProgress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ImportFormat = "csv" | "sql";
type Step = "file" | "mapping" | "import";

interface ImportModalProps {
  poolId: string;
  database?: string;
  onClose: () => void;
  onComplete?: () => void;
}

export function ImportModal({
  poolId,
  database,
  onClose,
  onComplete,
}: ImportModalProps) {
  const { importing, lastResult, importCsv, importSql, previewCsv } = useDbTransfer();
  const { tables, listTables, getTableStructure } = useDbSchema();

  const [format, setFormat] = useState<ImportFormat>("csv");
  const [step, setStep] = useState<Step>("file");
  const [filePath, setFilePath] = useState("");
  const [delimiter, setDelimiter] = useState(",");
  const [targetTable, setTargetTable] = useState("");
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [tableColumns, setTableColumns] = useState<ColumnInfo[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    listTables(poolId, database);
  }, [poolId, database, listTables]);

  const handlePickFile = useCallback(async () => {
    const extensions = format === "csv" ? ["csv", "tsv", "txt"] : ["sql", "sql.gz"];
    const path = await open({
      title: `Select ${format.toUpperCase()} file`,
      filters: [{ name: format.toUpperCase(), extensions }],
    });
    if (path) {
      setFilePath(path);
      if (format === "csv") {
        try {
          const preview = await previewCsv(path, delimiter, 5);
          setCsvPreview(preview);
          // Auto-map columns by name match
          const autoMap: Record<string, string> = {};
          preview.headers.forEach((h) => {
            autoMap[h] = h;
          });
          setColumnMapping(autoMap);
        } catch (err) {
          toast.error(`Preview failed: ${err}`);
        }
      }
    }
  }, [format, delimiter, previewCsv]);

  const handleTableSelect = useCallback(
    async (tableName: string) => {
      setTargetTable(tableName);
      try {
        const structure = await getTableStructure(poolId, tableName, database);
        setTableColumns(structure.columns);
        // Re-map: try to match CSV headers to table columns
        if (csvPreview) {
          const autoMap: Record<string, string> = {};
          csvPreview.headers.forEach((h) => {
            const match = structure.columns.find(
              (c) => c.name.toLowerCase() === h.toLowerCase(),
            );
            if (match) {
              autoMap[h] = match.name;
            }
          });
          setColumnMapping(autoMap);
        }
      } catch {
        setTableColumns([]);
      }
    },
    [poolId, database, csvPreview, getTableStructure],
  );

  const updateMapping = (csvCol: string, dbCol: string) => {
    setColumnMapping((prev) => {
      if (!dbCol) {
        const next = { ...prev };
        delete next[csvCol];
        return next;
      }
      return { ...prev, [csvCol]: dbCol };
    });
  };

  const handleImport = useCallback(async () => {
    try {
      if (format === "csv") {
        if (!targetTable) {
          toast.error("Select a target table");
          return;
        }
        if (Object.keys(columnMapping).length === 0) {
          toast.error("Map at least one column");
          return;
        }
        await importCsv(poolId, targetTable, filePath, columnMapping, true, delimiter);
      } else {
        await importSql(poolId, filePath);
      }
      setDone(true);
      setStep("import");
      onComplete?.();
    } catch (err) {
      toast.error(String(err));
    }
  }, [format, targetTable, columnMapping, filePath, delimiter, poolId, importCsv, importSql, onComplete]);

  // Done state — show result
  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="mx-4 w-full max-w-md rounded-xl border border-white/10 bg-background shadow-2xl">
          <TransferProgress
            type="import"
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
      <div className="mx-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-white/10 bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-green-400" />
            <h3 className="text-sm font-medium">
              Import Data
              {step === "mapping" && " — Column Mapping"}
            </h3>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {step === "file" && (
            <>
              {/* Format */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Format</label>
                <div className="flex gap-2">
                  {([
                    { value: "csv" as const, label: "CSV", icon: FileSpreadsheet },
                    { value: "sql" as const, label: "SQL", icon: FileCode },
                  ]).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => {
                        setFormat(value);
                        setFilePath("");
                        setCsvPreview(null);
                      }}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors",
                        format === value
                          ? "border-green-500/50 bg-green-500/10 text-green-400"
                          : "border-white/10 hover:bg-white/5",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* File picker */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">File</label>
                <div className="flex gap-2">
                  <Input
                    value={filePath}
                    readOnly
                    placeholder="No file selected"
                    className="h-8 flex-1 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handlePickFile}
                    className="h-8 text-xs"
                  >
                    Browse
                  </Button>
                </div>
              </div>

              {/* CSV options */}
              {format === "csv" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Delimiter
                    </label>
                    <Select value={delimiter} onValueChange={setDelimiter}>
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value=",">Comma (,)</SelectItem>
                        <SelectItem value="	">Tab (\t)</SelectItem>
                        <SelectItem value=";">Semicolon (;)</SelectItem>
                        <SelectItem value="|">Pipe (|)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Target table */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Target Table
                    </label>
                    <Select value={targetTable} onValueChange={handleTableSelect}>
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

                  {/* CSV Preview */}
                  {csvPreview && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        Preview ({csvPreview.total_rows} total rows)
                      </label>
                      <div className="overflow-x-auto rounded-lg border border-white/10">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-white/10 bg-white/5">
                              {csvPreview.headers.map((h) => (
                                <th key={h} className="px-2 py-1 text-left font-medium">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {csvPreview.rows.map((row, i) => (
                              <tr
                                key={i}
                                className="border-b border-white/5 hover:bg-white/5"
                              >
                                {row.map((cell, j) => (
                                  <td
                                    key={j}
                                    className="max-w-[150px] truncate px-2 py-1 text-muted-foreground"
                                  >
                                    {cell || (
                                      <span className="italic text-muted-foreground/50">
                                        NULL
                                      </span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {step === "mapping" && csvPreview && (
            <>
              <p className="text-xs text-muted-foreground">
                Map CSV columns to database columns in <strong>{targetTable}</strong>
              </p>
              <div className="space-y-1">
                {csvPreview.headers.map((header) => (
                  <div
                    key={header}
                    className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"
                  >
                    <span className="w-1/3 truncate text-xs font-medium">{header}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <Select
                      value={columnMapping[header] ?? "__skip__"}
                      onValueChange={(v) =>
                        updateMapping(header, v === "__skip__" ? "" : v)
                      }
                    >
                      <SelectTrigger className="h-7 flex-1 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">
                          <span className="text-muted-foreground">Skip</span>
                        </SelectItem>
                        {tableColumns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            {col.name}{" "}
                            <span className="text-muted-foreground">({col.data_type})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
          <div>
            {step === "mapping" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep("file")}
                className="h-8 gap-1 text-xs"
              >
                <ArrowLeft className="h-3 w-3" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs">
              Cancel
            </Button>
            {step === "file" && format === "csv" && filePath && targetTable && (
              <Button
                size="sm"
                onClick={() => setStep("mapping")}
                className="h-8 gap-1 text-xs"
              >
                Next
                <ArrowRight className="h-3 w-3" />
              </Button>
            )}
            {step === "file" && format === "sql" && filePath && (
              <Button
                size="sm"
                onClick={handleImport}
                disabled={importing}
                className="h-8 gap-1.5 text-xs"
              >
                {importing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3" />
                )}
                Import SQL
              </Button>
            )}
            {step === "mapping" && (
              <Button
                size="sm"
                onClick={handleImport}
                disabled={importing || Object.keys(columnMapping).length === 0}
                className="h-8 gap-1.5 text-xs"
              >
                {importing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3" />
                )}
                Import CSV
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
