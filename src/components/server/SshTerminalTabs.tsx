import { useState, useCallback } from "react";
import {
  X,
  Plus,
  Terminal,
  Wifi,
  WifiOff,
  Loader2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SshTerminal } from "./SshTerminal";
import type { ServerCredentialRow } from "@/types/db";
import type { SshConnectionStatus } from "@/hooks/useSshSession";

interface TerminalTab {
  id: string;
  server: ServerCredentialRow;
  status: SshConnectionStatus;
}

interface SshTerminalTabsProps {
  servers: ServerCredentialRow[];
  initialServerId?: string;
  onClose?: () => void;
}

export function SshTerminalTabs({
  servers,
  initialServerId,
  onClose,
}: SshTerminalTabsProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => {
    const initial = servers.find((s) => s.id === initialServerId);
    if (initial) {
      return [{ id: `${initial.id}-${Date.now()}`, server: initial, status: "idle" }];
    }
    return [];
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(
    tabs[0]?.id ?? null,
  );
  const [isMaximized, setIsMaximized] = useState(false);

  const sshServers = servers.filter((s) => s.protocol === "ssh");

  const addTab = useCallback(
    (server: ServerCredentialRow) => {
      const tabId = `${server.id}-${Date.now()}`;
      setTabs((prev) => [
        ...prev,
        { id: tabId, server, status: "idle" },
      ]);
      setActiveTabId(tabId);
    },
    [],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          setActiveTabId(next[next.length - 1]?.id ?? null);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const updateTabStatus = useCallback(
    (tabId: string, status: SshConnectionStatus) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, status } : t)),
      );
    },
    [],
  );

  if (tabs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-card/30">
        <Terminal className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No terminal sessions</p>
        {sshServers.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {sshServers.map((s) => (
              <Button
                key={s.id}
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={() => addTab(s)}
              >
                <Terminal className="h-3 w-3" />
                {s.name}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/50">
            Add an SSH server to start a terminal session
          </p>
        )}
      </div>
    );
  }

  const StatusIcon = ({ status }: { status: SshConnectionStatus }) => {
    if (status === "connected") return <Wifi className="h-2.5 w-2.5 text-green-500" />;
    if (status === "connecting") return <Loader2 className="h-2.5 w-2.5 animate-spin text-yellow-500" />;
    return <WifiOff className="h-2.5 w-2.5 text-muted-foreground/40" />;
  };

  return (
    <div className={cn("flex h-full flex-col", isMaximized && "fixed inset-0 z-50 bg-background")}>
      {/* Tab bar */}
      <div className="flex items-center border-b border-border/40 bg-card/50">
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
              <StatusIcon status={tab.status} />
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
        <div className="flex items-center gap-0.5 px-2">
          {/* Add new tab dropdown */}
          {sshServers.length > 0 && (
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  // Open new tab with first available SSH server
                  // A dropdown could be added here for multiple servers
                  if (sshServers.length === 1) {
                    addTab(sshServers[0]);
                  } else {
                    // For multiple servers, pick the first one not already open,
                    // or the first one if all are open
                    const openServerIds = new Set(tabs.map((t) => t.server.id));
                    const next =
                      sshServers.find((s) => !openServerIds.has(s.id)) ?? sshServers[0];
                    addTab(next);
                  }
                }}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsMaximized(!isMaximized)}
          >
            {isMaximized ? (
              <Minimize2 className="h-3 w-3" />
            ) : (
              <Maximize2 className="h-3 w-3" />
            )}
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClose}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Terminal panels */}
      <div className="relative flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0",
              activeTabId === tab.id ? "visible" : "invisible",
            )}
          >
            <SshTerminal
              server={tab.server}
              onStatusChange={(s) => updateTabStatus(tab.id, s)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
