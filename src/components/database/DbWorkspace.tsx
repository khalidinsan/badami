import { ArrowLeft, Unplug, PanelLeft } from "lucide-react";
import { useEffect, useCallback, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useDbStore, type DbEngine } from "@/stores/dbStore";
import { useDbConnection } from "@/hooks/useDbConnection";
import { DbSidebar } from "@/components/database/DbSidebar";
import { DbTabBar } from "@/components/database/DbTabBar";
import { TableViewer } from "@/components/database/TableViewer";
import { QueryTab } from "@/components/database/QueryTab";
import { TableStructureEditor } from "@/components/database/schema/TableStructureEditor";
import { ErDiagram } from "@/components/database/er/ErDiagram";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";

interface DbWorkspaceProps {
  onBackToList: () => void;
}

export function DbWorkspace({ onBackToList }: DbWorkspaceProps) {
  const { activeConnectionId, tabs, activeTabId, activeDatabase } = useDbStore();
  const { connections, disconnect } = useDbConnection();

  const conn = connections.find((c) => c.id === activeConnectionId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Keyboard shortcuts: Cmd+W (close tab), Cmd+T (new query tab)
  const handleNewQueryTab = useCallback(() => {
    if (!activeConnectionId) return;
    const tab = {
      id: uuidv4(),
      type: "query" as const,
      title: "Query " + (tabs.filter((t) => t.type === "query").length + 1),
      connectionId: activeConnectionId,
      sqlContent: "",
      database: activeDatabase ?? undefined,
    };
    useDbStore.getState().openTab(tab);
  }, [activeConnectionId, activeDatabase, tabs]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      if (e.key === "w" && !e.shiftKey) {
        e.preventDefault();
        if (activeTabId) {
          useDbStore.getState().closeTab(activeTabId);
        }
      }

      if (e.key === "t" && !e.shiftKey) {
        e.preventDefault();
        handleNewQueryTab();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabId, handleNewQueryTab]);

  const MIN_W = 200;
  const MAX_W = 480;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = sidebarWidth;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [sidebarWidth]);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + e.clientX - startX.current));
    setSidebarWidth(next);
  }, []);

  const onDragEnd = useCallback(() => { dragging.current = false; }, []);

  if (!conn || !activeConnectionId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No active connection
      </div>
    );
  }

  const handleDisconnect = async () => {
    try {
      await disconnect(activeConnectionId);
    } catch (err) {
      toast.error(String(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBackToList}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSidebarOpen((o) => !o)}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">{conn.name}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-red-500 hover:text-red-500"
          onClick={handleDisconnect}
        >
          <Unplug className="mr-1.5 h-3.5 w-3.5" />
          Disconnect
        </Button>
      </div>

      {/* Main area: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Resizable sidebar */}
        <div
          className="relative shrink-0 overflow-hidden transition-[width] duration-200"
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
        >
          <DbSidebar
            poolId={activeConnectionId}
            connectionName={conn.name}
            engine={conn.engine}
          />
          {/* Resize handle */}
          <div
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#007AFF]/30 active:bg-[#007AFF]/50"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <DbTabBar />

          {/* Content area */}
          <div className="flex-1 overflow-hidden">
            {activeTab ? (
              activeTab.type === "table" && activeTab.tableName ? (
                <TableViewer
                  poolId={activeConnectionId}
                  tableName={activeTab.tableName}
                  engine={conn.engine}
                  database={activeTab.database ?? activeDatabase ?? undefined}
                />
              ) : activeTab.type === "query" ? (
                <QueryTab
                  key={activeTab.id}
                  poolId={activeConnectionId}
                  connectionId={activeConnectionId}
                  engine={(conn.engine ?? "mysql") as DbEngine}
                  initialSql={activeTab.sqlContent ?? ""}
                  database={activeTab.database ?? activeDatabase ?? undefined}
                  tabId={activeTab.id}
                />
              ) : activeTab.type === "structure" && activeTab.tableName ? (
                <TableStructureEditor
                  poolId={activeConnectionId}
                  tableName={activeTab.tableName}
                  engine={(conn.engine ?? "mysql") as DbEngine}
                  database={activeTab.database ?? activeDatabase ?? undefined}
                />
              ) : activeTab.type === "er" ? (
                <ErDiagram
                  poolId={activeConnectionId}
                  connectionId={activeConnectionId}
                  database={activeTab.database ?? activeDatabase ?? undefined}
                />
              ) : null
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                <p className="text-sm">Open a table or create a new query</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
