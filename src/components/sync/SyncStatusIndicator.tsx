import { useState, useRef, useEffect } from "react";
import {
  RefreshCw,
  Loader2,
  WifiOff,
  AlertCircle,
  Check,
  CloudOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSyncStore, SyncStatus } from "@/stores/syncStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { SyncEventPayload } from "@/stores/syncStore";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

dayjs.extend(relativeTime);

interface SyncStatusIndicatorProps {
  collapsed: boolean;
}

export function SyncStatusIndicator({ collapsed }: SyncStatusIndicatorProps) {
  const { status, lastSyncedAt, errorMessage, handleSyncEvent, setStatus, setError } =
    useSyncStore();
  const { getSetting } = useSettingsStore();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const showStatus = getSetting("sync_show_status", "true") === "true";
  const syncEnabled = getSetting("sync_enabled", "false") === "true";

  // Listen for sync events
  useEffect(() => {
    let cancelled = false;
    listen<SyncEventPayload>("sync-status-changed", (event) => {
      if (!cancelled) {
        handleSyncEvent(event.payload);
        if (event.payload.status !== "syncing") {
          setSyncing(false);
        }
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    });

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, [handleSyncEvent]);

  // Close popover on click outside — handled by Radix Popover

  if (!showStatus || !syncEnabled) return null;

  const handleSyncNow = async () => {
    setSyncing(true);
    setStatus("syncing");
    try {
      await invoke("db_sync");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSyncing(false);
    }
  };

  const dotColor = getDotColor(status);
  const Icon = getIcon(status);

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            "text-white/60 hover:bg-white/10 hover:text-white",
            collapsed && "justify-center px-0",
          )}
        >
          {status === "syncing" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full", dotColor)}
            />
          )}
          {!collapsed && (
            <span className="truncate">
              {getStatusLabel(status)}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        side={collapsed ? "right" : "top"}
        align="start"
        className="w-64 p-3"
        sideOffset={6}
      >
        <div className="space-y-2.5">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Sync Status</span>
            <span className="flex items-center gap-1.5 text-xs">
              <Icon className="h-3 w-3" />
              {getStatusLabel(status)}
            </span>
          </div>

          {/* Last synced */}
          {lastSyncedAt && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Last synced</span>
              <span>{dayjs(lastSyncedAt).fromNow()}</span>
            </div>
          )}

          {/* Error */}
          {errorMessage && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1.5">
              <p className="line-clamp-2 text-xs text-red-500">
                {errorMessage}
              </p>
            </div>
          )}

          {/* Sync Now */}
          <button
            onClick={handleSyncNow}
            disabled={syncing}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              "bg-primary/10 text-primary hover:bg-primary/20",
              syncing && "cursor-not-allowed opacity-50",
            )}
          >
            {syncing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="h-3 w-3" />
                Sync Now
              </>
            )}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getDotColor(status: SyncStatus): string {
  switch (status) {
    case "synced":
      return "bg-green-500";
    case "syncing":
      return "bg-blue-500";
    case "pending":
      return "bg-yellow-500";
    case "offline":
      return "bg-gray-400";
    case "error":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}

function getIcon(status: SyncStatus) {
  switch (status) {
    case "synced":
      return Check;
    case "syncing":
      return Loader2;
    case "pending":
      return RefreshCw;
    case "offline":
      return WifiOff;
    case "error":
      return AlertCircle;
    default:
      return CloudOff;
  }
}

function getStatusLabel(status: SyncStatus): string {
  switch (status) {
    case "synced":
      return "Synced";
    case "syncing":
      return "Syncing...";
    case "pending":
      return "Pending";
    case "offline":
      return "Offline";
    case "error":
      return "Sync Error";
    default:
      return "Disabled";
  }
}
