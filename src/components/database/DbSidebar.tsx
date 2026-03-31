import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronRight,
  ChevronDown,
  Table2,
  Eye,
  Database,
  RefreshCw,
  Plus,
  Search,
  Columns3,
  GitFork,
  PlusSquare,
  Download,
  Upload,
  Trash2,
  Eraser,
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDbSchema } from "@/hooks/useDbSchema";
import { useDbStore, type DbTab, type DbEngine } from "@/stores/dbStore";
import type { TableInfo } from "@/hooks/useDbSchema";
import { CreateTableWizard } from "@/components/database/schema/CreateTableWizard";
import { ExportModal } from "@/components/database/transfer/ExportModal";
import { ImportModal } from "@/components/database/transfer/ImportModal";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";

interface DbSidebarProps {
  poolId: string;
  connectionName: string;
  engine: string;
}

export function DbSidebar({ poolId, connectionName, engine }: DbSidebarProps) {
  const {
    databases,
    tables,
    loadingTables,
    listDatabases,
    listTables,
  } = useDbSchema();

  const { activeDatabase, setActiveDatabase, openTab } = useDbStore();
  const [search, setSearch] = useState("");
  const [expandedTables, setExpandedTables] = useState(true);
  const [expandedViews, setExpandedViews] = useState(true);
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Load databases on mount
  useEffect(() => {
    listDatabases(poolId);
  }, [poolId, listDatabases]);

  // Auto-select first database or set "main" for SQLite
  useEffect(() => {
    if (databases.length > 0 && !activeDatabase) {
      setActiveDatabase(databases[0].name);
    }
  }, [databases, activeDatabase, setActiveDatabase]);

  // Load tables when database changes
  useEffect(() => {
    if (activeDatabase) {
      listTables(poolId, activeDatabase);
    }
  }, [poolId, activeDatabase, listTables]);

  const refresh = useCallback(() => {
    if (activeDatabase) listTables(poolId, activeDatabase);
  }, [poolId, activeDatabase, listTables]);

  const filteredTables = tables.filter(
    (t) =>
      t.table_type === "table" &&
      (!search || t.name.toLowerCase().includes(search.toLowerCase())),
  );

  const filteredViews = tables.filter(
    (t) =>
      t.table_type === "view" &&
      (!search || t.name.toLowerCase().includes(search.toLowerCase())),
  );

  const handleOpenTable = (table: TableInfo) => {
    const tab: DbTab = {
      id: uuidv4(),
      type: "table",
      title: table.name,
      connectionId: poolId,
      tableName: table.name,
      database: activeDatabase ?? undefined,
    };
    openTab(tab);
  };

  const handleNewQuery = () => {
    const tab: DbTab = {
      id: uuidv4(),
      type: "query",
      title: "Query " + (useDbStore.getState().tabs.filter((t) => t.type === "query").length + 1),
      connectionId: poolId,
      sqlContent: "",
      database: activeDatabase ?? undefined,
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
      database: activeDatabase ?? undefined,
    };
    openTab(tab);
  };

  const handleOpenErDiagram = () => {
    const tab: DbTab = {
      id: uuidv4(),
      type: "er",
      title: `ER: ${activeDatabase ?? "default"}`,
      connectionId: poolId,
      database: activeDatabase ?? undefined,
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
          database: activeDatabase ?? null,
          table: tableName,
        });
        toast.success(`Table "${tableName}" dropped`);
        refresh();
      } catch (err) {
        toast.error(String(err));
      }
    },
    [poolId, activeDatabase, refresh],
  );

  return (
    <div className="flex h-full w-full flex-col border-r border-border bg-background/60">
      {/* Connection header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        <span className="flex-1 truncate text-xs font-semibold">{connectionName}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refresh}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleOpenErDiagram}>
              <GitFork className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>ER Diagram</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowExport(true)}>
              <Download className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowImport(true)}>
              <Upload className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Import</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNewQuery}>
              <Plus className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New Query</TooltipContent>
        </Tooltip>
      </div>

      {/* Database selector (non-SQLite) */}
      {engine !== "sqlite" && databases.length > 1 && (
        <div className="border-b border-border px-3 py-2">
          <Select value={activeDatabase ?? ""} onValueChange={setActiveDatabase}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Select database..." />
            </SelectTrigger>
            <SelectContent>
              {databases.map((d) => (
                <SelectItem key={d.name} value={d.name}>
                  <div className="flex items-center gap-1.5">
                    <Database className="h-3 w-3" />
                    {d.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Object tree */}
      <div className="flex-1 overflow-x-auto overflow-y-auto px-1 pb-2">
        {loadingTables ? (
          <div className="space-y-2 px-2 py-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3.5 w-3.5 rounded" />
              <Skeleton className="h-3 w-16" />
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 pl-5">
                <Skeleton className="h-3 w-3 rounded" />
                <Skeleton className="h-3" style={{ width: `${60 + Math.random() * 80}px` }} />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Tables */}
            <TreeSection
              label="Tables"
              icon={<Table2 className="h-3.5 w-3.5" />}
              count={filteredTables.length}
              expanded={expandedTables}
              onToggle={() => setExpandedTables(!expandedTables)}
              onAction={() => setShowCreateTable(true)}
              actionIcon={<PlusSquare className="h-3 w-3" />}
              actionTooltip="Create Table"
            >
              {filteredTables.map((t) => (
                <ContextMenu key={t.name}>
                  <ContextMenuTrigger asChild>
                    <div>
                      <TreeItem
                        name={t.name}
                        icon={<Table2 className="h-3 w-3 text-blue-400" />}
                        badge={t.row_count != null ? formatCount(t.row_count) : undefined}
                        onClick={() => handleOpenTable(t)}
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => handleOpenTable(t)}>
                      <Table2 className="mr-2 h-3.5 w-3.5" />
                      Open Data
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => handleOpenStructure(t.name)}>
                      <Columns3 className="mr-2 h-3.5 w-3.5" />
                      View Structure
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => handleTruncateTable(t.name)}
                      className="text-orange-400 focus:text-orange-400"
                    >
                      <Eraser className="mr-2 h-3.5 w-3.5" />
                      Truncate Table
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => handleDropTable(t.name)}
                      className="text-red-400 focus:text-red-400"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Drop Table
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </TreeSection>

            {/* Views */}
            {filteredViews.length > 0 && (
              <TreeSection
                label="Views"
                icon={<Eye className="h-3.5 w-3.5" />}
                count={filteredViews.length}
                expanded={expandedViews}
                onToggle={() => setExpandedViews(!expandedViews)}
              >
                {filteredViews.map((v) => (
                  <TreeItem
                    key={v.name}
                    name={v.name}
                    icon={<Eye className="h-3 w-3 text-purple-400" />}
                    onClick={() => handleOpenTable(v)}
                  />
                ))}
              </TreeSection>
            )}
          </>
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

      {/* Export Modal */}
      {showExport && (
        <ExportModal
          poolId={poolId}
          database={activeDatabase ?? undefined}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          poolId={poolId}
          database={activeDatabase ?? undefined}
          onClose={() => setShowImport(false)}
          onComplete={refresh}
        />
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function TreeSection({
  label,
  icon,
  count,
  expanded,
  onToggle,
  onAction,
  actionIcon,
  actionTooltip,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onAction?: () => void;
  actionIcon?: React.ReactNode;
  actionTooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-white/5">
        <button className="flex flex-1 items-center gap-1.5" onClick={onToggle}>
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {icon}
          {label}
          <span className="ml-auto text-[10px]">{count}</span>
        </button>
        {onAction && actionIcon && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); onAction(); }}
              >
                {actionIcon}
              </button>
            </TooltipTrigger>
            {actionTooltip && <TooltipContent>{actionTooltip}</TooltipContent>}
          </Tooltip>
        )}
      </div>
      {expanded && <div className="ml-3">{children}</div>}
    </div>
  );
}

function TreeItem({
  name,
  icon,
  badge,
  onClick,
}: {
  name: string;
  icon: React.ReactNode;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-white/5"
      onClick={onClick}
    >
      {icon}
      <span className="flex-1 truncate text-left">{name}</span>
      {badge && (
        <span className="text-[10px] text-muted-foreground">{badge}</span>
      )}
    </button>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
