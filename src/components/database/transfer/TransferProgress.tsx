import { CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExportResult, ImportResult } from "@/hooks/useDbTransfer";

interface TransferProgressProps {
  type: "export" | "import";
  running: boolean;
  result: ExportResult | ImportResult | null;
  onClose: () => void;
}

export function TransferProgress({ type, running, result, onClose }: TransferProgressProps) {
  const isImport = type === "import";
  const importResult = result as ImportResult | null;

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Status */}
      <div className="flex items-center gap-2">
        {running ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            <span className="text-sm">{isImport ? "Importing..." : "Exporting..."}</span>
          </>
        ) : result ? (
          <>
            {isImport && importResult && importResult.rows_failed > 0 ? (
              <AlertCircle className="h-4 w-4 text-yellow-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-400" />
            )}
            <span className="text-sm font-medium">
              {isImport ? "Import" : "Export"} complete
            </span>
          </>
        ) : null}
      </div>

      {/* Result details */}
      {result && !running && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {isImport && importResult ? (
              <>
                <span>
                  <span className="text-green-400">{importResult.rows_imported}</span> imported
                </span>
                {importResult.rows_failed > 0 && (
                  <span>
                    <span className="text-red-400">{importResult.rows_failed}</span> failed
                  </span>
                )}
              </>
            ) : (
              <span>
                <span className="text-foreground">
                  {(result as ExportResult).rows_exported}
                </span>{" "}
                rows exported
              </span>
            )}
            <span>{result.duration_ms}ms</span>
          </div>

          {/* Error log */}
          {isImport && importResult && importResult.errors.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-red-500/20 bg-red-500/5 p-2">
              <p className="mb-1 text-xs font-medium text-red-400">
                Errors ({importResult.errors.length})
              </p>
              {importResult.errors.map((err, i) => (
                <p key={i} className="text-xs text-red-300/80">
                  {err}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Close button */}
      {!running && result && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 gap-1 text-xs">
            <X className="h-3 w-3" />
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
