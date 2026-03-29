import { useState, useCallback } from "react";
import {
  ArrowLeft,
  X,
  Plus,
  Terminal,
  FolderOpen,
  Loader2,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SshTerminal } from "./SshTerminal";
import { FileManager } from "./FileManager";
import type { ServerCredentialRow } from "@/types/db";
import type { SshConnectionStatus } from "@/hooks/useSshSession";

type SessionType = "terminal" | "files";
type SessionStatus = SshConnectionStatus;

interface SessionTab {
  id: string;
  server: ServerCredentialRow;
  type: SessionType;
  status: SessionStatus;
  /** If a terminal tab should `cd` into a path after connecting */
  initialCdPath?: string;
}

interface ServerSessionTabsProps {
  servers: ServerCredentialRow[];
  initialServer: ServerCredentialRow;
  initialType: SessionType;
  onBack: () => void;
}

export function ServerSessionTabs({
  servers,
  initialServer,
  initialType,
  onBack,
}: ServerSessionTabsProps) {
  const [tabs, setTabs] = useState<SessionTab[]>(() => [
    {
      id: `${initialServer.id}-${initialType}-${Date.now()}`,
      server: initialServer,
      type: initialType,
      status: "idle",
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(
    tabs[0].id,
  );
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);

  const addTab = useCallback(
    (server: ServerCredentialRow, type: SessionType, initialCdPath?: string) => {
      const tabId = `${server.id}-${type}-${Date.now()}`;
      setTabs((prev) => [
        ...prev,
        { id: tabId, server, type, status: "idle", initialCdPath },
      ]);
      setActiveTabId(tabId);
      setAddPopoverOpen(false);
      return tabId;
    },
    [],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (next.length === 0) {
          onBack();
          return prev;
        }
        if (activeTabId === tabId) {
          setActiveTabId(next[next.length - 1].id);
        }
        return next;
      });
    },
    [activeTabId, onBack],
  );

  const updateTabStatus = useCallback(
    (tabId: string, status: SessionStatus) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, status } : t)),
      );
    },
    [],
  );

  /** Open a terminal tab for the same server, cd to the given path */
  const handleOpenTerminalFromFM = useCallback(
    (server: ServerCredentialRow, path: string) => {
      addTab(server, "terminal", path);
    },
    [addTab],
  );

  /** Open a file manager tab for the same server */
  const handleOpenFileManagerFromTerminal = useCallback(
    (server: ServerCredentialRow) => {
      addTab(server, "files");
    },
    [addTab],
  );

  const StatusDot = ({ status }: { status: SessionStatus }) => {
    if (status === "connected")
      return <span className="h-1.5 w-1.5 rounded-full bg-green-500" />;
    if (status === "connecting")
      return <Loader2 className="h-2.5 w-2.5 animate-spin text-yellow-500" />;
    return <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border/40 bg-card/50">
        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 border-r border-border/30 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Servers
        </button>

        {/* Tabs */}
        <div className="flex flex-1 items-center overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                "group flex items-center gap-1.5 border-r border-border/30 px-3 py-1.5 text-xs transition-colors",
                activeTabId === tab.id
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
              )}
            >
              <StatusDot status={tab.status} />
              {tab.type === "terminal" ? (
                <Terminal className="h-3 w-3 shrink-0" />
              ) : (
                <FolderOpen className="h-3 w-3 shrink-0" />
              )}
              <span className="max-w-[120px] truncate">{tab.server.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </button>
          ))}
        </div>

        {/* Add tab */}
        <div className="flex items-center px-2">
          <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Plus className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <p className="mb-2 px-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Open Session
              </p>
              {servers.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No servers available
                </p>
              ) : (
                <div className="space-y-1">
                  {servers.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Server
                          className="h-3.5 w-3.5 shrink-0"
                          style={{ color: s.color ?? "#6b7280" }}
                        />
                        <span className="truncate text-xs font-medium">
                          {s.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {s.protocol === "ssh" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 px-1.5 text-[10px]"
                            onClick={() => addTab(s, "terminal")}
                          >
                            <Terminal className="h-3 w-3" />
                            SSH
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-1.5 text-[10px]"
                          onClick={() => addTab(s, "files")}
                        >
                          <FolderOpen className="h-3 w-3" />
                          Files
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Content panels */}
      <div className="relative flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0",
              activeTabId === tab.id ? "visible z-10" : "invisible pointer-events-none z-0",
            )}
          >
            {tab.type === "terminal" ? (
              <SshTerminal
                server={tab.server}
                onStatusChange={(s) => updateTabStatus(tab.id, s)}
                onOpenFileManager={() => handleOpenFileManagerFromTerminal(tab.server)}
                initialCdPath={tab.initialCdPath}
              />
            ) : (
              <FileManager
                server={tab.server}
                onOpenTerminal={(path) => handleOpenTerminalFromFM(tab.server, path)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
