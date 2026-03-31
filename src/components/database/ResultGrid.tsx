import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, Copy, FileJson } from "lucide-react";

interface ResultGridProps {
  columns: string[];
  rows: unknown[][];
  totalRows?: number | null;
  durationMs?: number;
  className?: string;
}

export function ResultGrid({
  columns,
  rows,
  totalRows,
  durationMs,
  className,
}: ResultGridProps) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    row: unknown[];
    colIdx: number;
  } | null>(null);

  const sortedRows = useMemo(() => {
    if (sortCol === null) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va === null || va === undefined) return sortDir === "asc" ? -1 : 1;
      if (vb === null || vb === undefined) return sortDir === "asc" ? 1 : -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      const sa = String(va);
      const sb = String(vb);
      return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }, [rows, sortCol, sortDir]);

  const handleSort = (idx: number) => {
    if (sortCol === idx) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(idx);
      setSortDir("asc");
    }
  };

  const handleContextMenu = (e: React.MouseEvent, row: unknown[], colIdx: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, row, colIdx });
  };

  const copyCell = () => {
    if (!contextMenu) return;
    const val = contextMenu.row[contextMenu.colIdx];
    navigator.clipboard.writeText(val === null ? "NULL" : String(val));
    setContextMenu(null);
  };

  const copyRowAsJson = () => {
    if (!contextMenu) return;
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = contextMenu.row[i];
    });
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    setContextMenu(null);
  };

  if (columns.length === 0) {
    return (
      <div className={cn("flex items-center justify-center p-4 text-sm text-muted-foreground", className)}>
        No results
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-col overflow-hidden", className)}
      onClick={() => setContextMenu(null)}
    >
      {/* Stats bar */}
      <div className="flex items-center gap-3 border-b border-border px-3 py-1 text-xs text-muted-foreground">
        <span>{rows.length} rows returned</span>
        {totalRows !== null && totalRows !== undefined && (
          <span>({totalRows} total)</span>
        )}
        {durationMs !== undefined && <span>{durationMs}ms</span>}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-10 border-b-2 border-r border-b-black/15 border-r-border bg-muted/60 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground dark:border-b-white/20">
                #
              </th>
              {columns.map((col, i) => (
                <th
                  key={col}
                  className="cursor-pointer select-none whitespace-nowrap border-b-2 border-r border-b-black/15 border-r-border bg-muted/60 px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/80 dark:border-b-white/20"
                  onClick={() => handleSort(i)}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate">{col}</span>
                    {sortCol === i &&
                      (sortDir === "asc" ? (
                        <ChevronUp className="h-3 w-3 shrink-0 text-[#007AFF]" />
                      ) : (
                        <ChevronDown className="h-3 w-3 shrink-0 text-[#007AFF]" />
                      ))}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, ri) => (
              <tr
                key={ri}
                className={cn(
                  "transition-colors hover:bg-[#007AFF]/5",
                  ri % 2 === 1 && "bg-muted/40",
                )}
              >
                <td className="border-b border-r border-border px-2 py-1.5 text-center text-muted-foreground/50">
                  {ri + 1}
                </td>
                {row.map((val, ci) => (
                  <td
                    key={ci}
                    className="max-w-[300px] truncate border-b border-r border-border px-2 py-1.5"
                    onContextMenu={(e) => handleContextMenu(e, row, ci)}
                  >
                    {val === null ? (
                      <span className="italic text-muted-foreground/50">NULL</span>
                    ) : typeof val === "boolean" ? (
                      <span className={val ? "text-green-400" : "text-red-400"}>
                        {String(val)}
                      </span>
                    ) : (
                      String(val)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-white/10 bg-popover p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/10"
            onClick={copyCell}
          >
            <Copy className="h-3 w-3" />
            Copy cell
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/10"
            onClick={copyRowAsJson}
          >
            <FileJson className="h-3 w-3" />
            Copy row as JSON
          </button>
        </div>
      )}
    </div>
  );
}
