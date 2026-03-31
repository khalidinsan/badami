import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  Eye,
  Key,
  X,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSchemaManager } from "@/hooks/useSchemaManager";
import type { ColumnInfo, IndexInfo, ForeignKeyInfo } from "@/hooks/useDbSchema";
import {
  generateAddColumn,
  generateDropColumn,
  generateAddIndex,
  generateDropIndex,
  generateAddForeignKey,
  generateDropForeignKey,
  type ColumnDef,
  type IndexDef,
  type ForeignKeyDef,
} from "@/lib/ddlGenerator";
import type { DbEngine } from "@/stores/dbStore";
import { DdlPreviewModal } from "./DdlPreviewModal";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TableStructureEditorProps {
  poolId: string;
  tableName: string;
  engine: DbEngine;
  database?: string;
  onRefresh?: () => void;
}

type TabType = "columns" | "indexes" | "foreign_keys";

export function TableStructureEditor({
  poolId,
  tableName,
  engine,
  database,
  onRefresh,
}: TableStructureEditorProps) {
  const { getTableStructure, executeDdl, loading } = useSchemaManager();
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("columns");
  const [ddlPreview, setDdlPreview] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // New items pending
  const [newColumns, setNewColumns] = useState<ColumnDef[]>([]);
  const [newIndexes, setNewIndexes] = useState<IndexDef[]>([]);
  const [newFks, setNewFks] = useState<ForeignKeyDef[]>([]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const structure = await getTableStructure(poolId, tableName, database);
      setColumns(structure.columns);
      setIndexes(structure.indexes);
      setForeignKeys(structure.foreign_keys);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
    }
  }, [poolId, tableName, database, getTableStructure]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Column operations ─────────────────────────────

  const addNewColumn = () => {
    setNewColumns((prev) => [
      ...prev,
      {
        name: "",
        dataType: "VARCHAR(255)",
        nullable: true,
        isPrimaryKey: false,
        defaultValue: null,
        extra: null,
        isNew: true,
      },
    ]);
  };

  const updateNewColumn = (idx: number, field: keyof ColumnDef, value: unknown) => {
    setNewColumns((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)),
    );
  };

  const removeNewColumn = (idx: number) => {
    setNewColumns((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDropColumn = async (colName: string) => {
    const sql = generateDropColumn(tableName, colName, engine);
    setDdlPreview(sql);
  };

  // ── Index operations ──────────────────────────────

  const addNewIndex = () => {
    setNewIndexes((prev) => [
      ...prev,
      { name: `idx_${tableName}_new`, type: "INDEX", columns: [], isNew: true },
    ]);
  };

  const updateNewIndex = (idx: number, field: keyof IndexDef, value: unknown) => {
    setNewIndexes((prev) =>
      prev.map((ix, i) => (i === idx ? { ...ix, [field]: value } : ix)),
    );
  };

  const removeNewIndex = (idx: number) => {
    setNewIndexes((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDropIndex = async (indexName: string) => {
    const sql = generateDropIndex(tableName, indexName, engine);
    setDdlPreview(sql);
  };

  // ── FK operations ─────────────────────────────────

  const addNewFk = () => {
    setNewFks((prev) => [
      ...prev,
      {
        name: `fk_${tableName}_new`,
        column: "",
        refTable: "",
        refColumn: "",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
        isNew: true,
      },
    ]);
  };

  const updateNewFk = (idx: number, field: keyof ForeignKeyDef, value: unknown) => {
    setNewFks((prev) =>
      prev.map((fk, i) => (i === idx ? { ...fk, [field]: value } : fk)),
    );
  };

  const removeNewFk = (idx: number) => {
    setNewFks((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDropFk = async (fkName: string) => {
    const sql = generateDropForeignKey(tableName, fkName, engine);
    setDdlPreview(sql);
  };

  // ── Apply all pending ─────────────────────────────

  const generatePendingDdl = (): string => {
    const stmts: string[] = [];
    for (const col of newColumns) {
      if (col.name.trim()) {
        stmts.push(generateAddColumn(tableName, col, engine));
      }
    }
    for (const idx of newIndexes) {
      if (idx.columns.length > 0) {
        stmts.push(generateAddIndex(tableName, idx, engine));
      }
    }
    for (const fk of newFks) {
      if (fk.column && fk.refTable && fk.refColumn) {
        stmts.push(generateAddForeignKey(tableName, fk, engine));
      }
    }
    return stmts.join("\n");
  };

  const handlePreviewAll = () => {
    const ddl = generatePendingDdl();
    if (!ddl) {
      toast.info("No pending changes");
      return;
    }
    setDdlPreview(ddl);
  };

  const handleExecuteDdl = async (sql: string) => {
    try {
      await executeDdl(poolId, sql);
      toast.success("DDL executed");
      setDdlPreview(null);
      setNewColumns([]);
      setNewIndexes([]);
      setNewFks([]);
      await load();
      onRefresh?.();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const tabs: { key: TabType; label: string; count: number }[] = [
    { key: "columns", label: "Columns", count: columns.length },
    { key: "indexes", label: "Indexes", count: indexes.length },
    { key: "foreign_keys", label: "Foreign Keys", count: foreignKeys.length },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">
          Structure: <span className="text-[#007AFF]">{tableName}</span>
          {database && <span className="ml-1.5 text-xs text-muted-foreground">({database})</span>}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={load}
            disabled={loading}
            title="Reload structure"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={handlePreviewAll}
            disabled={newColumns.length === 0 && newIndexes.length === 0 && newFks.length === 0}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview DDL
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "border-b-2 px-3 py-1.5 text-xs transition-colors",
              activeTab === tab.key
                ? "border-[#007AFF] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}{" "}
            <span className="text-muted-foreground">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Error banner */}
      {loadError && (
        <div className="flex items-start gap-2 border-b border-border bg-red-500/10 px-3 py-2 text-xs text-red-500">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Failed to load structure</p>
            <p className="mt-0.5 opacity-80">{loadError}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-red-500" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "columns" && (
          <ColumnsPanel
            columns={columns}
            newColumns={newColumns}
            engine={engine}
            onAdd={addNewColumn}
            onUpdate={updateNewColumn}
            onRemove={removeNewColumn}
            onDrop={handleDropColumn}
          />
        )}
        {activeTab === "indexes" && (
          <IndexesPanel
            indexes={indexes}
            newIndexes={newIndexes}
            availableColumns={columns.map((c) => c.name)}
            onAdd={addNewIndex}
            onUpdate={updateNewIndex}
            onRemove={removeNewIndex}
            onDrop={handleDropIndex}
          />
        )}
        {activeTab === "foreign_keys" && (
          <ForeignKeysPanel
            foreignKeys={foreignKeys}
            newFks={newFks}
            availableColumns={columns.map((c) => c.name)}
            onAdd={addNewFk}
            onUpdate={updateNewFk}
            onRemove={removeNewFk}
            onDrop={handleDropFk}
          />
        )}
      </div>

      {/* DDL Preview Modal */}
      {ddlPreview && (
        <DdlPreviewModal
          sql={ddlPreview}
          onExecute={() => handleExecuteDdl(ddlPreview)}
          onClose={() => setDdlPreview(null)}
          loading={loading}
        />
      )}
    </div>
  );
}

// ── Data type lists per engine ──────────────────────────────────────

const MYSQL_TYPES = [
  "INT", "BIGINT", "SMALLINT", "TINYINT", "MEDIUMINT",
  "FLOAT", "DOUBLE", "DECIMAL",
  "VARCHAR", "CHAR", "TEXT", "MEDIUMTEXT", "LONGTEXT", "TINYTEXT",
  "DATE", "DATETIME", "TIMESTAMP", "TIME", "YEAR",
  "BOOLEAN", "BOOL",
  "JSON", "BLOB", "MEDIUMBLOB", "LONGBLOB", "BINARY", "VARBINARY",
  "ENUM", "SET",
];

const PG_TYPES = [
  "INTEGER", "BIGINT", "SMALLINT", "SERIAL", "BIGSERIAL",
  "FLOAT", "DOUBLE PRECISION", "DECIMAL", "NUMERIC", "REAL",
  "VARCHAR", "CHAR", "TEXT",
  "DATE", "TIMESTAMP", "TIMESTAMPTZ", "TIME", "TIMETZ", "INTERVAL",
  "BOOLEAN",
  "JSON", "JSONB", "UUID", "BYTEA",
  "ARRAY",
];

const SQLITE_TYPES = [
  "INTEGER", "TEXT", "REAL", "BLOB", "NUMERIC",
];

function getTypesForEngine(engine: DbEngine): string[] {
  if (engine === "mysql" || engine === "mariadb") return MYSQL_TYPES;
  if (engine === "postgresql") return PG_TYPES;
  return SQLITE_TYPES;
}

// ── Helper: split "varchar(255)" → { base: "VARCHAR", length: "255" } ──

function splitDataType(raw: string): { base: string; length: string } {
  const m = raw.trim().match(/^([A-Z _]+?)(?:\(([^)]*)\))?$/i);
  if (!m) return { base: raw.toUpperCase(), length: "" };
  return { base: m[1].trim().toUpperCase(), length: m[2] ?? "" };
}

// ── Columns Panel ───────────────────────────────────────────────────

function ColumnsPanel({
  columns,
  newColumns,
  engine,
  onAdd,
  onUpdate,
  onRemove,
  onDrop,
}: {
  columns: ColumnInfo[];
  newColumns: ColumnDef[];
  engine: DbEngine;
  onAdd: () => void;
  onUpdate: (idx: number, field: keyof ColumnDef, value: unknown) => void;
  onRemove: (idx: number) => void;
  onDrop: (colName: string) => void;
}) {
  const typeOptions = getTypesForEngine(engine);
  const lengthTypes = new Set([
    "VARCHAR", "CHAR", "VARBINARY", "BINARY", "DECIMAL", "NUMERIC",
    "FLOAT", "DOUBLE", "REAL",
  ]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-b-black/10 bg-muted/60 dark:border-b-white/15">
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">#</th>
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Length</th>
            <th className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">PK</th>
            <th className="px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Null</th>
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Default</th>
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Extra</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {columns.map((col, i) => {
            const { base, length } = splitDataType(col.data_type);
            return (
              <tr key={col.name} className="border-b border-border hover:bg-muted/40">
                <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                <td className="px-2 py-1 font-medium">
                  {col.is_primary_key && (
                    <Key className="mr-1 inline h-3 w-3 text-yellow-500" />
                  )}
                  {col.name}
                </td>
                <td className="px-2 py-1">
                  <span className="rounded bg-[#007AFF]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#007AFF]">
                    {base}
                  </span>
                </td>
                <td className="px-2 py-1 text-muted-foreground">{length || "—"}</td>
                <td className="px-2 py-1 text-center">
                  {col.is_primary_key && <span className="font-medium text-yellow-500">PK</span>}
                </td>
                <td className="px-2 py-1 text-center">
                  {col.is_nullable ? (
                    <span className="text-green-500">YES</span>
                  ) : (
                    <span className="text-red-500">NO</span>
                  )}
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  {col.default_value ?? <span className="italic opacity-40">none</span>}
                </td>
                <td className="px-2 py-1 text-muted-foreground">{col.extra ?? ""}</td>
                <td className="px-2 py-1">
                  <button
                    className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onDrop(col.name)}
                    title="Drop column"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            );
          })}

          {/* New columns */}
          {newColumns.map((col, i) => {
            const { base, length: lenVal } = splitDataType(col.dataType);
            const showLength = lengthTypes.has(base);
            return (
              <tr key={`new-${i}`} className="border-b border-border bg-green-500/5">
                <td className="px-2 py-1 font-medium text-green-500">+</td>
                <td className="px-2 py-1">
                  <Input
                    value={col.name}
                    onChange={(e) => onUpdate(i, "name", e.target.value)}
                    placeholder="column_name"
                    className="h-6 text-xs"
                  />
                </td>
                <td className="px-2 py-1">
                  <Select
                    value={base}
                    onValueChange={(v) => {
                      const newFull = showLength && lenVal ? `${v}(${lenVal})` : v;
                      onUpdate(i, "dataType", newFull);
                    }}
                  >
                    <SelectTrigger className="h-6 min-w-[110px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {typeOptions.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1">
                  {showLength ? (
                    <Input
                      value={lenVal}
                      onChange={(e) => {
                        const newFull = e.target.value ? `${base}(${e.target.value})` : base;
                        onUpdate(i, "dataType", newFull);
                      }}
                      placeholder="255"
                      className="h-6 w-16 text-xs"
                    />
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
                <td className="px-2 py-1 text-center">
                  <Checkbox
                    checked={col.isPrimaryKey}
                    onCheckedChange={(v) => onUpdate(i, "isPrimaryKey", v)}
                  />
                </td>
                <td className="px-2 py-1 text-center">
                  <Checkbox
                    checked={col.nullable}
                    onCheckedChange={(v) => onUpdate(i, "nullable", v)}
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={col.defaultValue ?? ""}
                    onChange={(e) => onUpdate(i, "defaultValue", e.target.value || null)}
                    placeholder="default"
                    className="h-6 text-xs"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={col.extra ?? ""}
                    onChange={(e) => onUpdate(i, "extra", e.target.value || null)}
                    placeholder="extra"
                    className="h-6 text-xs"
                  />
                </td>
                <td className="px-2 py-1">
                  <button
                    className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onRemove(i)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="p-2">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onAdd}>
          <Plus className="h-3 w-3" />
          Add Column
        </Button>
      </div>
    </div>
  );
}

// ── Indexes Panel ───────────────────────────────────────────────────

function IndexesPanel({
  indexes,
  newIndexes,
  availableColumns: _availableColumns,
  onAdd,
  onUpdate,
  onRemove,
  onDrop,
}: {
  indexes: IndexInfo[];
  newIndexes: IndexDef[];
  availableColumns: string[];
  onAdd: () => void;
  onUpdate: (idx: number, field: keyof IndexDef, value: unknown) => void;
  onRemove: (idx: number) => void;
  onDrop: (indexName: string) => void;
}) {
  return (
    <div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-b-black/10 bg-muted/60 dark:border-b-white/15">
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Columns</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {indexes.map((idx) => (
            <tr key={idx.name} className="border-b border-border hover:bg-muted/40">
              <td className="px-2 py-1 font-medium">{idx.name}</td>
              <td className="px-2 py-1">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium",
                    idx.index_type === "PRIMARY"
                      ? "bg-yellow-500/15 text-yellow-500"
                      : idx.index_type === "UNIQUE"
                        ? "bg-blue-500/15 text-blue-500"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {idx.index_type}
                </span>
              </td>
              <td className="px-2 py-1 text-muted-foreground">{idx.columns.join(", ")}</td>
              <td className="px-2 py-1">
                {idx.index_type !== "PRIMARY" && (
                  <button
                    className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => onDrop(idx.name)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </td>
            </tr>
          ))}

          {/* New indexes */}
          {newIndexes.map((idx, i) => (
            <tr key={`new-${i}`} className="border-b border-border bg-green-500/5">
              <td className="px-2 py-1">
                <Input
                  value={idx.name}
                  onChange={(e) => onUpdate(i, "name", e.target.value)}
                  placeholder="index_name"
                  className="h-6 text-xs"
                />
              </td>
              <td className="px-2 py-1">
                <Select
                  value={idx.type}
                  onValueChange={(v) => onUpdate(i, "type", v)}
                >
                  <SelectTrigger className="h-6 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INDEX">INDEX</SelectItem>
                    <SelectItem value="UNIQUE">UNIQUE</SelectItem>
                    <SelectItem value="PRIMARY">PRIMARY</SelectItem>
                  </SelectContent>
                </Select>
              </td>
              <td className="px-2 py-1">
                <Input
                  value={idx.columns.join(", ")}
                  onChange={(e) =>
                    onUpdate(
                      i,
                      "columns",
                      e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                  placeholder="col1, col2"
                  className="h-6 text-xs"
                />
              </td>
              <td className="px-2 py-1">
                <button
                  className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onRemove(i)}
                >
                  <X className="h-3 w-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="p-2">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onAdd}>
          <Plus className="h-3 w-3" />
          Add Index
        </Button>
      </div>
    </div>
  );
}

// ── Foreign Keys Panel ──────────────────────────────────────────────

function ForeignKeysPanel({
  foreignKeys,
  newFks,
  availableColumns: _availableColumns,
  onAdd,
  onUpdate,
  onRemove,
  onDrop,
}: {
  foreignKeys: ForeignKeyInfo[];
  newFks: ForeignKeyDef[];
  availableColumns: string[];
  onAdd: () => void;
  onUpdate: (idx: number, field: keyof ForeignKeyDef, value: unknown) => void;
  onRemove: (idx: number) => void;
  onDrop: (fkName: string) => void;
}) {
  return (
    <div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-b-black/10 bg-muted/60 dark:border-b-white/15">
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Column</th>
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">References</th>
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">On Delete</th>
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">On Update</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {foreignKeys.map((fk) => (
            <tr key={fk.name} className="border-b border-border hover:bg-muted/40">
              <td className="px-2 py-1 font-medium">{fk.name}</td>
              <td className="px-2 py-1">{fk.column}</td>
              <td className="px-2 py-1 text-muted-foreground">
                {fk.ref_table}.{fk.ref_column}
              </td>
              <td className="px-2 py-1 text-muted-foreground">{fk.on_delete ?? "—"}</td>
              <td className="px-2 py-1 text-muted-foreground">{fk.on_update ?? "—"}</td>
              <td className="px-2 py-1">
                <button
                  className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onDrop(fk.name)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </td>
            </tr>
          ))}

          {/* New FKs */}
          {newFks.map((fk, i) => (
            <tr key={`new-${i}`} className="border-b border-border bg-green-500/5">
              <td className="px-2 py-1">
                <Input
                  value={fk.name}
                  onChange={(e) => onUpdate(i, "name", e.target.value)}
                  placeholder="fk_name"
                  className="h-6 text-xs"
                />
              </td>
              <td className="px-2 py-1">
                <Input
                  value={fk.column}
                  onChange={(e) => onUpdate(i, "column", e.target.value)}
                  placeholder="column"
                  className="h-6 text-xs"
                />
              </td>
              <td className="px-2 py-1">
                <div className="flex gap-1">
                  <Input
                    value={fk.refTable}
                    onChange={(e) => onUpdate(i, "refTable", e.target.value)}
                    placeholder="ref_table"
                    className="h-6 flex-1 text-xs"
                  />
                  <Input
                    value={fk.refColumn}
                    onChange={(e) => onUpdate(i, "refColumn", e.target.value)}
                    placeholder="ref_col"
                    className="h-6 flex-1 text-xs"
                  />
                </div>
              </td>
              <td className="px-2 py-1">
                <Select
                  value={fk.onDelete}
                  onValueChange={(v) => onUpdate(i, "onDelete", v)}
                >
                  <SelectTrigger className="h-6 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASCADE">CASCADE</SelectItem>
                    <SelectItem value="SET NULL">SET NULL</SelectItem>
                    <SelectItem value="RESTRICT">RESTRICT</SelectItem>
                    <SelectItem value="NO ACTION">NO ACTION</SelectItem>
                  </SelectContent>
                </Select>
              </td>
              <td className="px-2 py-1">
                <Select
                  value={fk.onUpdate}
                  onValueChange={(v) => onUpdate(i, "onUpdate", v)}
                >
                  <SelectTrigger className="h-6 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASCADE">CASCADE</SelectItem>
                    <SelectItem value="SET NULL">SET NULL</SelectItem>
                    <SelectItem value="RESTRICT">RESTRICT</SelectItem>
                    <SelectItem value="NO ACTION">NO ACTION</SelectItem>
                  </SelectContent>
                </Select>
              </td>
              <td className="px-2 py-1">
                <button
                  className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onRemove(i)}
                >
                  <X className="h-3 w-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="p-2">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onAdd}>
          <Plus className="h-3 w-3" />
          Add Foreign Key
        </Button>
      </div>
    </div>
  );
}
