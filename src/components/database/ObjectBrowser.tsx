import { useState, useEffect, useCallback } from "react";
import {
  Table2,
  Eye,
  Search,
  RefreshCw,
  Columns3,
  Eraser,
  Trash2,
  PlusSquare,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDbSchema, type TableInfo } from "@/hooks/useDbSchema";
import { useDbStore, type DbTab, type DbEngine } from "@/stores/dbStore";
import { CreateTableWizard } from "@/components/database/schema/CreateTableWizard";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ObjectBrowserProps {
  poolId: string;
  engine: string;
  database?: string;
}

type ObjectFilter = "tables" | "views";
type SortField = "name" | "row_count" | "data_length" | "engine" | "created_at" | "updated_at" | "collation" | "comment";
type SortDir = "asc" | "desc";

export function ObjectBrowser({ poolId, engine, database }: ObjectBrowserProps) {
  const { tables, loadingTables, listTables } = useDbSchema();
  const { openTab, activeDatabase } = useDbStore();
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ObjectFilter>("tables");
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const db = database ?? activeDatabase ?? undefined;

  useEffect(() => {
    if (db) {
      listTables(poolId, db);
    }
  }, [poolId, db, listTables]);

  const refresh = useCallback(() => {
    if (db) listTables(poolId, db);
  }, [poolId, db, listTables]);

  const filteredItems = tables
    .filter((t) => {
      const matchType =
        activeFilter === "tables" ? t.table_type === "table" : t.table_type === "view";
      const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase());
      return matchType && matchSearch;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "row_count":
          cmp = (a.row_count ?? 0) - (b.row_count ?? 0);
          break;
        case "data_length":
          cmp = (a.data_length ?? 0) - (b.data_length ?? 0);
          break;
        case "engine":
          cmp = (a.engine ?? "").localeCompare(b.engine ?? "");
          break;
        case "created_at":
          cmp = (a.created_at ?? "").localeCompare(b.created_at ?? "");
          break;
        case "updated_at":
          cmp = (a.updated_at ?? "").localeCompare(b.updated_at ?? "");
          break;
        case "collation":
          cmp = (a.collation ?? "").localeCompare(b.collation ?? "");
          break;
        case "comment":
          cmp = (a.comment ?? "").localeCompare(b.comment ?? "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const handleOpenTable = (table: TableInfo) => {
    const tab: DbTab = {
      id: uuidv4(),
      type: "table",
      title: table.name,
      connectionId: poolId,
      tableName: table.name,
      database: db,
    };
    openTab(tab);
  };

  const handleOpenStructure = (tableName: string) => {
    const tab: DbTab = {
      id: uuidv4(),
      type: "structure",
      title: `Structure: ${tableName}`,
      connectionId: poolId,
      tableName,
      database: db,
    };
    openTab(tab);
  };

  const handleTruncateTable = useCallback(
    async (tableName: string) => {
      if (!confirm(`Truncate table "${tableName}"? This will delete all rows.`)) return;
      try {
        await invoke("dbc_execute_ddl", {
          poolId,
          sql: `TRUNCATE TABLE ${engine === "mysql" || engine === "mariadb" ? `\`${tableName}\`` : `"${tableName}"`}`,
        });
        toast.success(`Table "${tableName}" truncated`);
        refresh();
      } catch (err) {
        toast.error(String(err));
      }
    },
    [poolId, engine, refresh],
  );

  const handleDropTable = useCallback(
    async (tableName: string) => {
      if (!confirm(`Drop table "${tableName}"? This action cannot be undone.`)) return;
      try {
        await invoke("dbc_drop_table", {
          poolId,
          database: db ?? null,
          table: tableName,
        });
        toast.success(`Table "${tableName}" dropped`);
        refresh();
      } catch (err) {
        toast.error(String(err));
      }
    },
    [poolId, db, refresh],
  );

  const tableCount = tables.filter((t) => t.table_type === "table").length;
  const viewCount = tables.filter((t) => t.table_type === "view").length;

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
        {/* Filter tabs */}
        <div className="flex items-center gap-0.5 rounded-md bg-muted/50 p-0.5">
          <button
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              activeFilter === "tables"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveFilter("tables")}
          >
            <Table2 className="h-3 w-3" />
            Tables
            <span className="ml-0.5 text-[10px] text-muted-foreground">{tableCount}</span>
          </button>
          <button
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              activeFilter === "views"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveFilter("views")}
          >
            <Eye className="h-3 w-3" />
            Views
            <span className="ml-0.5 text-[10px] text-muted-foreground">{viewCount}</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter objects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          {activeFilter === "tables" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setShowCreateTable(true)}
            >
              <PlusSquare className="h-3 w-3" />
              Create Table
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Table content */}
      <div className="flex-1 overflow-auto">
        {loadingTables ? (
          <div className="space-y-1 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <p className="text-sm">
              {search
                ? `No ${activeFilter} matching "${search}"`
                : `No ${activeFilter} found`}
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
              <tr className="border-b border-border/40">
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">
                  <button className="flex items-center gap-1" onClick={() => handleSort("name")}>
                    Name <SortIcon field="name" />
                  </button>
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-muted-foreground">
                  <button className="ml-auto flex items-center gap-1" onClick={() => handleSort("row_count")}>
                    Rows <SortIcon field="row_count" />
                  </button>
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-muted-foreground">
                  <button className="ml-auto flex items-center gap-1" onClick={() => handleSort("data_length")}>
                    Data Length <SortIcon field="data_length" />
                  </button>
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">
                  <button className="flex items-center gap-1" onClick={() => handleSort("engine")}>
                    Engine <SortIcon field="engine" />
                  </button>
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">
                  <button className="flex items-center gap-1" onClick={() => handleSort("created_at")}>
                    Created <SortIcon field="created_at" />
                  </button>
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">
                  <button className="flex items-center gap-1" onClick={() => handleSort("updated_at")}>
                    Modified <SortIcon field="updated_at" />
                  </button>
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">
                  <button className="flex items-center gap-1" onClick={() => handleSort("collation")}>
                    Collation <SortIcon field="collation" />
                  </button>
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">
                  <button className="flex items-center gap-1" onClick={() => handleSort("comment")}>
                    Comment <SortIcon field="comment" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <ContextMenu key={item.name}>
                  <ContextMenuTrigger asChild>
                    <tr
                      className="cursor-pointer border-b border-border/20 transition-colors hover:bg-white/5"
                      onClick={() => handleOpenTable(item)}
                    >
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex items-center gap-2">
                          {item.table_type === "table" ? (
                            <Table2 className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                          ) : (
                            <Eye className="h-3.5 w-3.5 shrink-0 text-purple-400" />
                          )}
                          <span className="font-medium">{item.name}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-muted-foreground">
                        {item.row_count != null ? formatNumber(item.row_count) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-muted-foreground">
                        {item.data_length != null ? formatBytes(item.data_length) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {item.engine ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {item.created_at ? formatDate(item.created_at) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {item.updated_at ? formatDate(item.updated_at) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {item.collation ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground max-w-[200px] truncate">
                        {item.comment || "—"}
                      </td>
                    </tr>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => handleOpenTable(item)}>
                      <Table2 className="mr-2 h-3.5 w-3.5" />
                      Open Data
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleOpenStructure(item.name)}>
                      <Columns3 className="mr-2 h-3.5 w-3.5" />
                      View Structure
                    </ContextMenuItem>
                    {item.table_type === "table" && (
                      <>
                        <ContextMenuItem
                          onClick={() => handleTruncateTable(item.name)}
                          className="text-orange-400 focus:text-orange-400"
                        >
                          <Eraser className="mr-2 h-3.5 w-3.5" />
                          Truncate Table
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => handleDropTable(item.name)}
                          className="text-red-400 focus:text-red-400"
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Drop Table
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Table Wizard */}
      {showCreateTable && (
        <CreateTableWizard
          poolId={poolId}
          engine={(engine ?? "mysql") as DbEngine}
          onClose={() => setShowCreateTable(false)}
          onCreated={() => {
            setShowCreateTable(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}
