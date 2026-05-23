import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  Save,
  Undo2,
  Trash2,
  Filter,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  Copy,
  ClipboardCopy,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useDbSchema, useDbData } from "@/hooks/useDbSchema";
import { useDbStore } from "@/stores/dbStore";
import * as historyQueries from "@/db/queries/dbClient";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";

interface TableViewerProps {
  poolId: string;
  tableName: string;
  database?: string;
  engine?: string;
}

interface PendingEdit {
  rowIdx: number;
  column: string;
  newValue: unknown;
}

interface ContextMenuState {
  x: number;
  y: number;
  rowIdx: number;
  colIdx?: number;
}

export function TableViewer({ poolId, tableName, database, engine }: TableViewerProps) {
  const { structure, getTableStructure } = useDbSchema();
  const { queryResult, executing, error, runQuery, updateCell, deleteRows } = useDbData();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; column: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterColumn, setFilterColumn] = useState("");
  const [filterOp, setFilterOp] = useState("contains");
  const [filterValue, setFilterValue] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [newRows, setNewRows] = useState<Record<string, unknown>[]>([]);
  const [newRowErrors, setNewRowErrors] = useState<Set<string>>(new Set()); // "rowIdx-colName"

  const editInputRef = useRef<HTMLInputElement>(null);

  // Close context menu on click outside or escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  // Load structure + data on mount
  useEffect(() => {
    getTableStructure(poolId, tableName, database);
    loadData();
    setNewRows([]);
    setNewRowErrors(new Set());
    setPendingEdits([]);
    setSelectedRows(new Set());
  }, [poolId, tableName, database]);

  // Cmd+D → open structure
  const { openTab } = useDbStore();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        openTab({ id: `struct-${tableName}`, type: 'structure', title: `Structure: ${tableName}`, connectionId: poolId, tableName, database });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tableName, poolId, database, openTab]);

  const isMysql = engine === "mysql" || engine === "mariadb";

  const quoteId = (name: string) =>
    isMysql ? `\`${name.replace(/`/g, "``")}\`` : `"${name.replace(/"/g, '""')}"`;
  const fullTable = database ? `${quoteId(database)}.${quoteId(tableName)}` : quoteId(tableName);
  const buildSql = useCallback(() => {
    let sql = `SELECT * FROM ${fullTable}`;
    if (filterColumn && filterValue) {
      const col = quoteId(filterColumn);
      switch (filterOp) {
        case "equals":
          sql += ` WHERE ${col} = '${filterValue.replace(/'/g, "''")}'`;
          break;
        case "contains":
          sql += ` WHERE ${col} LIKE '%${filterValue.replace(/'/g, "''")}%'`;
          break;
        case "starts_with":
          sql += ` WHERE ${col} LIKE '${filterValue.replace(/'/g, "''")}%'`;
          break;
        case "is_null":
          sql += ` WHERE ${col} IS NULL`;
          break;
        case "is_not_null":
          sql += ` WHERE ${col} IS NOT NULL`;
          break;
        case "gt":
          sql += ` WHERE ${col} > '${filterValue.replace(/'/g, "''")}'`;
          break;
        case "lt":
          sql += ` WHERE ${col} < '${filterValue.replace(/'/g, "''")}'`;
          break;
      }
    }
    if (sortColumn) {
      sql += ` ORDER BY ${quoteId(sortColumn)} ${sortDir.toUpperCase()}`;
    }
    return sql;
  }, [tableName, sortColumn, sortDir, filterColumn, filterOp, filterValue, isMysql]);

  const loadData = useCallback(async () => {
    try {
      const sql = buildSql();
      const result = await runQuery(poolId, sql, page, pageSize, database);
      if (result) {
        historyQueries.addQueryHistory({
          connection_id: poolId,
          database_name: database ?? null,
          sql_content: sql,
          status: "success",
          rows_affected: null,
          duration_ms: result.duration_ms,
        }).catch(console.error);
      }
    } catch (err) {
      historyQueries.addQueryHistory({
        connection_id: poolId,
        database_name: database ?? null,
        sql_content: buildSql(),
        status: "error",
        error_message: String(err),
      }).catch(console.error);
    }
  }, [poolId, buildSql, page, pageSize, database, runQuery]);

  useEffect(() => { loadData(); }, [page, pageSize, sortColumn, sortDir]);

  const pkColumn = structure?.columns.find((c) => c.is_primary_key)?.name;

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDir("asc");
    }
  };

  const startEdit = (rowIdx: number, column: string, currentValue: unknown) => {
    setEditingCell({ rowIdx, column });
    setEditValue(currentValue == null ? "" : String(currentValue));
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { rowIdx, column } = editingCell;
    const currentRow = queryResult?.rows[rowIdx];
    const colIdx = queryResult?.columns.indexOf(column) ?? -1;
    const currentVal = currentRow ? currentRow[colIdx] : undefined;
    if (String(currentVal ?? "") !== editValue) {
      const newValue = editValue === "" ? null : editValue;
      setPendingEdits((prev) => [
        ...prev.filter((e) => !(e.rowIdx === rowIdx && e.column === column)),
        { rowIdx, column, newValue },
      ]);
    }
    setEditingCell(null);
  };

  const cancelEdit = () => { setEditingCell(null); };

  const applyChanges = async () => {
    if (!pkColumn) return;
    const pkIdx = queryResult?.columns.indexOf(pkColumn) ?? -1;
    if (pkIdx === -1 && pendingEdits.length > 0) {
      toast.error("Cannot determine primary key column");
      return;
    }

    let successCount = 0;

    // Apply pending edits
    for (const edit of pendingEdits) {
      const row = queryResult?.rows[edit.rowIdx];
      if (!row) continue;
      const pkValue = row[pkIdx];
      try {
        await updateCell(poolId, tableName, pkColumn, pkValue, edit.column, edit.newValue);
        successCount++;
      } catch (err) {
        toast.error(`Failed to update row: ${err}`);
      }
    }

    // Apply new rows
    for (let nrIdx = 0; nrIdx < newRows.length; nrIdx++) {
      const newRow = newRows[nrIdx];
      // Validate NOT NULL columns
      if (structure?.columns) {
        const notNullCols = structure.columns.filter((s: any) => s.is_nullable === false && !s.extra?.includes('auto_increment') && s.default_value == null);
        const missing = notNullCols.filter((s: any) => newRow[s.name] == null || newRow[s.name] === '');
        if (missing.length > 0) {
          const errs = new Set(newRowErrors);
          missing.forEach((m: any) => errs.add(`${nrIdx}-${m.name}`));
          setNewRowErrors(errs);
          toast.error(`Fill required fields`);
          continue;
        }
      }
      const cols = Object.keys(newRow).filter((k) => newRow[k] != null && newRow[k] !== "");
      if (cols.length === 0) { toast.error('Row is empty'); continue; }
      const colNames = cols.map((c) => quoteId(c)).join(", ");
      const values = cols.map((c) => {
        const v = newRow[c];
        return v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
      }).join(", ");
      const sql = `INSERT INTO ${fullTable} (${colNames}) VALUES (${values})`;
      try {
        await invoke("dbc_execute", { poolId, sql, database: database ?? null });
        successCount++;
      } catch (err) {
        toast.error(`Failed to insert row: ${err}`);
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} change(s) applied`);
      setPendingEdits([]);
      setNewRows([]);
      loadData();
    }
  };

  const rollback = () => {
    setPendingEdits([]);
    setNewRows([]);
  };

  const handleDeleteSelected = async () => {
    if (!pkColumn || selectedRows.size === 0) return;
    const pkIdx = queryResult?.columns.indexOf(pkColumn) ?? -1;
    if (pkIdx === -1) return;
    const pkValues = Array.from(selectedRows)
      .map((idx) => queryResult?.rows[idx]?.[pkIdx])
      .filter((v) => v != null);
    try {
      const count = await deleteRows(poolId, tableName, pkColumn, pkValues);
      toast.success(`${count} row(s) deleted`);
      setSelectedRows(new Set());
      loadData();
    } catch (err) {
      toast.error(`Delete failed: ${err}`);
    }
  };

  const addNewRow = () => {
    const emptyRow: Record<string, unknown> = {};
    queryResult?.columns.forEach((col) => { emptyRow[col] = null; });
    setNewRows((prev) => [...prev, emptyRow]);
    // Auto-scroll to bottom and focus first cell after React renders
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (tableScrollRef.current) {
          const inputs = tableScrollRef.current.querySelectorAll<HTMLInputElement>('[data-new-row] input');
          const last = inputs[inputs.length - (queryResult?.columns.length ?? 1)];
          last?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          last?.focus();
        }
      }, 50);
    });
  };

  // SQL generation helpers for context menu
  const sqlLiteral = (v: unknown) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

  const buildWhereClause = (row: unknown[]) => {
    if (!queryResult) return "";
    if (pkColumn) {
      const pkIdx = queryResult.columns.indexOf(pkColumn);
      const pkVal = row[pkIdx];
      return `WHERE ${quoteId(pkColumn)} = ${sqlLiteral(pkVal)}`;
    }
    // Fallback: all columns
    return "WHERE " + queryResult.columns.map((col, i) => {
      const v = row[i];
      return v == null ? `${quoteId(col)} IS NULL` : `${quoteId(col)} = ${sqlLiteral(v)}`;
    }).join(" AND ");
  };

  const generateInsert = (row: unknown[]) => {
    if (!queryResult) return "";
    const cols = queryResult.columns.map((c) => quoteId(c)).join(", ");
    const vals = row.map((v) => sqlLiteral(v)).join(", ");
    return `INSERT INTO ${fullTable} (${cols}) VALUES (${vals});`;
  };

  const generateUpdate = (row: unknown[]) => {
    if (!queryResult) return "";
    const sets = queryResult.columns.map((col, i) => `${quoteId(col)} = ${sqlLiteral(row[i])}`).join(", ");
    return `UPDATE ${fullTable} SET ${sets} ${buildWhereClause(row)};`;
  };

  const generateDelete = (row: unknown[]) => {
    if (!queryResult) return "";
    return `DELETE FROM ${fullTable} ${buildWhereClause(row)};`;
  };

  const handleContextMenuAction = async (action: string) => {
    if (!contextMenu || !queryResult) return;
    const row = queryResult.rows[contextMenu.rowIdx];
    if (!row) return;

    switch (action) {
      case "copy_row": {
        const text = row.map((v) => (v == null ? "NULL" : String(v))).join("\t");
        navigator.clipboard.writeText(text);
        toast.success("Row copied");
        break;
      }
      case "copy_insert":
        navigator.clipboard.writeText(generateInsert(row));
        toast.success("INSERT copied");
        break;
      case "copy_update":
        navigator.clipboard.writeText(generateUpdate(row));
        toast.success("UPDATE copied");
        break;
      case "copy_delete":
        navigator.clipboard.writeText(generateDelete(row));
        toast.success("DELETE copied");
        break;
      case "clone_row": {
        const sql = generateInsert(row).replace(/;$/, "");
        try {
          await invoke("dbc_execute", { poolId, sql, database: database ?? null });
          toast.success("Row cloned");
          loadData();
        } catch (err) {
          toast.error(`Clone failed: ${err}`);
        }
        break;
      }
      case "delete_row": {
        const sql = generateDelete(row).replace(/;$/, "");
        try {
          await invoke("dbc_execute", { poolId, sql, database: database ?? null });
          toast.success("Row deleted");
          loadData();
        } catch (err) {
          toast.error(`Delete failed: ${err}`);
        }
        break;
      }
      case "set_null": {
        if (contextMenu.colIdx != null) {
          const col = queryResult.columns[contextMenu.colIdx];
          setPendingEdits((prev) => [
            ...prev.filter((e) => !(e.rowIdx === contextMenu.rowIdx && e.column === col)),
            { rowIdx: contextMenu.rowIdx, column: col, newValue: null },
          ]);
          toast.success(`${col} set to NULL (pending)`);
        }
        break;
      }
    }
    setContextMenu(null);
  };


  const totalRows = queryResult?.total_rows ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const hasPendingChanges = pendingEdits.length > 0 || newRows.length > 0;

  const getPendingValue = (rowIdx: number, col: string): unknown | undefined => {
    const edit = pendingEdits.find((e) => e.rowIdx === rowIdx && e.column === col);
    return edit?.newValue;
  };

  const isEdited = (rowIdx: number, col: string) =>
    pendingEdits.some((e) => e.rowIdx === rowIdx && e.column === col);

  const handleApplyFilter = () => { setPage(1); loadData(); setFilterOpen(false); };

  const clearFilter = () => {
    setFilterColumn("");
    setFilterOp("contains");
    setFilterValue("");
    setPage(1);
    setTimeout(loadData, 0);
    setFilterOpen(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFilterOpen(!filterOpen)}>
              <Filter className={cn("h-3.5 w-3.5", filterColumn && "text-[#007AFF]")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Filter</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={loadData} disabled={executing}>
              <RefreshCw className={cn("h-3.5 w-3.5", executing && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={addNewRow}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add Row</TooltipContent>
        </Tooltip>

        {selectedRows.size > 0 && pkColumn && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-red-500 hover:text-red-500"
                onClick={handleDeleteSelected}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete Selected ({selectedRows.size})</TooltipContent>
          </Tooltip>
        )}

        <div className="mx-1 h-4 w-px bg-white/10" />

        {hasPendingChanges && (
          <>
            <Button size="sm" variant="default" className="h-7 text-xs" onClick={applyChanges}>
              <Save className="mr-1 h-3 w-3" />
              Apply ({pendingEdits.length + newRows.length})
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={rollback}>
              <Undo2 className="mr-1 h-3 w-3" />
              Discard
            </Button>
          </>
        )}

        <div className="flex-1" />

        <span className="text-[11px] text-muted-foreground">
          {queryResult && `${totalRows.toLocaleString()} rows`}
          {queryResult && ` · ${queryResult.duration_ms}ms`}
        </span>

        {/* Pagination */}
        <div className="flex items-center gap-1">
          <Select
            value={String(pageSize)}
            onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
          >
            <SelectTrigger className="h-7 w-[80px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="500">500</SelectItem>
              <SelectItem value="1000">1000</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground">{page}/{totalPages}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      {filterOpen && (
        <div className="flex items-center gap-2 border-b border-white/10 bg-background/80 px-3 py-1.5">
          <Select value={filterColumn} onValueChange={setFilterColumn}>
            <SelectTrigger className="h-7 w-[150px] text-xs">
              <SelectValue placeholder="Column..." />
            </SelectTrigger>
            <SelectContent>
              {queryResult?.columns.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterOp} onValueChange={setFilterOp}>
            <SelectTrigger className="h-7 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="equals">Equals</SelectItem>
              <SelectItem value="contains">Contains</SelectItem>
              <SelectItem value="starts_with">Starts with</SelectItem>
              <SelectItem value="gt">Greater than</SelectItem>
              <SelectItem value="lt">Less than</SelectItem>
              <SelectItem value="is_null">Is NULL</SelectItem>
              <SelectItem value="is_not_null">Is NOT NULL</SelectItem>
            </SelectContent>
          </Select>
          {!["is_null", "is_not_null"].includes(filterOp) && (
            <Input
              className="h-7 w-48 text-xs"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              placeholder="Value..."
              onKeyDown={(e) => e.key === "Enter" && handleApplyFilter()}
            />
          )}
          <Button size="sm" variant="default" className="h-7 text-xs" onClick={handleApplyFilter}>
            Apply
          </Button>
          {filterColumn && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearFilter}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      <div ref={tableScrollRef} className="flex-1 overflow-auto">
        {error ? (
          <div className="flex items-center justify-center p-6 text-sm text-red-500">{error}</div>
        ) : !queryResult ? (
          <div className="space-y-0.5">
            <div className="flex border-b border-white/10 bg-background">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex-1 border-r border-white/10 px-3 py-2">
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex border-b border-white/5">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="flex-1 border-r border-white/5 px-3 py-2">
                    <Skeleton className="h-3" style={{ width: `${40 + Math.random() * 60}%` }} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : queryResult.rows.length === 0 && newRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
            <ArrowUpDown className="h-8 w-8 opacity-30" />
            <p className="text-sm">No rows found</p>
            <p className="text-xs opacity-60">This table is empty or the filter returned no results</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-background">
              <tr>
                {pkColumn && (
                  <th className="w-8 border-b-2 border-r border-b-black/15 border-r-border bg-muted/60 px-2 py-1.5 text-center dark:border-b-white/20">
                    <input
                      type="checkbox"
                      checked={queryResult.rows.length > 0 && selectedRows.size === queryResult.rows.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedRows(new Set(queryResult.rows.map((_, i) => i)));
                        } else {
                          setSelectedRows(new Set());
                        }
                      }}
                      className="h-3 w-3"
                    />
                  </th>
                )}
                {queryResult.columns.map((col) => {
                  const isEditingThisCol = editingCell?.column === col;
                  return (
                    <th
                      key={col}
                      className={cn(
                        "cursor-pointer select-none whitespace-nowrap border-b-2 border-r px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider transition-colors hover:bg-muted/80",
                        isEditingThisCol
                          ? "border-b-[#007AFF] border-r-border bg-[#007AFF]/10 text-[#007AFF] dark:text-[#0A84FF]"
                          : "border-b-black/15 border-r-border bg-muted/60 text-muted-foreground dark:border-b-white/20",
                      )}
                      onClick={() => handleSort(col)}
                    >
                      <div className="flex items-center gap-1">
                        {col}
                        {structure?.columns.find((c) => c.name === col)?.is_primary_key && (
                          <Badge className="h-3.5 bg-yellow-500/15 px-1 text-[9px] text-yellow-600">PK</Badge>
                        )}
                        {sortColumn === col ? (
                          sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-[#007AFF]" /> : <ArrowDown className="h-3 w-3 text-[#007AFF]" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-20" />
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {queryResult.rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className={cn(
                    "transition-colors hover:bg-[#007AFF]/5",
                    rowIdx % 2 === 1 && "bg-muted/40",
                    selectedRows.has(rowIdx) && "!bg-[#007AFF]/10",
                  )}
                >
                  {pkColumn && (
                    <td className="border-b border-r border-border px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={selectedRows.has(rowIdx)}
                        onChange={(e) => {
                          setSelectedRows((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(rowIdx);
                            else next.delete(rowIdx);
                            return next;
                          });
                        }}
                        className="h-3 w-3"
                      />
                    </td>
                  )}
                  {queryResult.columns.map((col, colIdx) => {
                    const rawValue = row[colIdx];
                    const isEditedCell = isEdited(rowIdx, col);
                    const displayValue = isEditedCell ? getPendingValue(rowIdx, col) : rawValue;
                    const isNull = displayValue == null;
                    const isCurrentlyEditing = editingCell?.rowIdx === rowIdx && editingCell?.column === col;
                    const isEditingThisCol = editingCell?.column === col;

                    return (
                      <td
                        key={col}
                        className={cn(
                          "max-w-[300px] truncate border-b border-r border-border px-3 py-1.5",
                          isEditedCell && "bg-yellow-500/10",
                          isEditingThisCol && !isCurrentlyEditing && "bg-[#007AFF]/5",
                          isCurrentlyEditing ? "p-0" : "cursor-text",
                        )}
                        onClick={() => !isCurrentlyEditing && startEdit(rowIdx, col, displayValue)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, rowIdx, colIdx });
                        }}
                      >
                        {isCurrentlyEditing ? (
                          <input
                            ref={editInputRef}
                            className="h-full w-full bg-[#007AFF]/10 px-3 py-1.5 text-xs outline-none ring-2 ring-inset ring-[#007AFF]"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                              if (e.key === "Escape") cancelEdit();
                              if (e.key === "Tab") {
                                e.preventDefault();
                                commitEdit();
                                // Focus next/prev cell input
                                const inputs = tableScrollRef.current?.querySelectorAll<HTMLInputElement>('td input');
                                if (inputs) {
                                  const arr = Array.from(inputs);
                                  const idx = arr.indexOf(e.currentTarget);
                                  const next = e.shiftKey ? arr[idx - 1] : arr[idx + 1];
                                  next?.focus();
                                  next?.select();
                                }
                              }
                            }}
                          />
                        ) : isNull ? (
                          <span className="italic text-muted-foreground/50">NULL</span>
                        ) : (
                          String(displayValue)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* New rows */}
              {newRows.map((newRow, nrIdx) => (
                <tr key={`new-${nrIdx}`} className="bg-green-500/5" data-new-row>
                  {pkColumn && <td className="border-b border-r border-border px-2 py-1.5 text-center">
                    <Badge className="h-3.5 bg-green-500/15 px-1 text-[9px] text-green-600">NEW</Badge>
                  </td>}
                  {queryResult.columns.map((col) => {
                    const val = newRow[col];
                    return (
                      <td
                        key={col}
                        className={`max-w-[300px] truncate border-b border-r border-border px-3 py-1.5 cursor-text ${newRowErrors.has(`${nrIdx}-${col}`) ? 'bg-red-500/20' : ''}`}
                        onClick={() => {
                          const input = document.getElementById(`new-${nrIdx}-${col}`) as HTMLInputElement;
                          input?.focus();
                        }}
                      >
                        <input
                          id={`new-${nrIdx}-${col}`}
                          className={`w-full bg-transparent text-xs outline-none placeholder:italic placeholder:text-muted-foreground/50`}
                          placeholder="NULL"
                          value={val == null ? "" : String(val)}
                          onChange={(e) => {
                            setNewRowErrors((prev) => { const n = new Set(prev); n.delete(`${nrIdx}-${col}`); return n; });
                            setNewRows((prev) => prev.map((r, i) =>
                              i === nrIdx ? { ...r, [col]: e.target.value || null } : r
                            ));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Tab") {
                              e.preventDefault();
                              const inputs = tableScrollRef.current?.querySelectorAll<HTMLInputElement>('[data-new-row] input');
                              if (inputs) {
                                const arr = Array.from(inputs);
                                const idx = arr.indexOf(e.currentTarget);
                                const next = e.shiftKey ? arr[idx - 1] : arr[idx + 1];
                                next?.focus(); next?.select();
                              }
                            }
                            if (e.key === "Enter") { e.preventDefault(); applyChanges(); }
                            if (e.key === "Escape") { setNewRows((prev) => prev.filter((_, i) => i !== nrIdx)); }
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] bg-popover border border-border rounded-lg shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-xs hover:bg-muted cursor-pointer flex items-center gap-2" onClick={() => handleContextMenuAction("copy_row")}>
            <Copy className="h-3 w-3" /> Copy Row
          </div>
          <div className="px-3 py-1.5 text-xs hover:bg-muted cursor-pointer flex items-center gap-2" onClick={() => handleContextMenuAction("copy_insert")}>
            <ClipboardCopy className="h-3 w-3" /> Copy as INSERT
          </div>
          <div className="px-3 py-1.5 text-xs hover:bg-muted cursor-pointer flex items-center gap-2" onClick={() => handleContextMenuAction("copy_update")}>
            <ClipboardCopy className="h-3 w-3" /> Copy as UPDATE
          </div>
          <div className="px-3 py-1.5 text-xs hover:bg-muted cursor-pointer flex items-center gap-2" onClick={() => handleContextMenuAction("copy_delete")}>
            <ClipboardCopy className="h-3 w-3" /> Copy as DELETE
          </div>
          <div className="mx-2 my-1 h-px bg-border" />
          <div className="px-3 py-1.5 text-xs hover:bg-muted cursor-pointer flex items-center gap-2" onClick={() => handleContextMenuAction("clone_row")}>
            <Plus className="h-3 w-3" /> Clone Row
          </div>
          <div className="px-3 py-1.5 text-xs hover:bg-muted cursor-pointer flex items-center gap-2 text-red-500" onClick={() => handleContextMenuAction("delete_row")}>
            <Trash2 className="h-3 w-3" /> Delete Row
          </div>
          {contextMenu.colIdx != null && (
            <>
              <div className="mx-2 my-1 h-px bg-border" />
              <div className="px-3 py-1.5 text-xs hover:bg-muted cursor-pointer flex items-center gap-2" onClick={() => handleContextMenuAction("set_null")}>
                <Ban className="h-3 w-3" /> Set NULL
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
