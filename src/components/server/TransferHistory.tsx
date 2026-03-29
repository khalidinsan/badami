import { useEffect, useState, useCallback } from "react";
import {
  Download,
  Upload,
  Check,
  X,
  Trash2,
  History,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import * as serverQueries from "@/db/queries/servers";
import type { TransferHistoryRow } from "@/types/db";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

interface TransferHistoryProps {
  serverId: string;
  open: boolean;
  onClose: () => void;
}

export function TransferHistory({ serverId, open, onClose }: TransferHistoryProps) {
  const [entries, setEntries] = useState<TransferHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await serverQueries.getTransferHistory(serverId, 100);
      setEntries(rows);
    } catch { /* ignore */ }
    setLoading(false);
  }, [serverId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleClear = useCallback(async () => {
    await serverQueries.clearTransferHistory(serverId);
    setEntries([]);
  }, [serverId]);

  if (!open) return null;

  return (
    <div className="border-t border-border/40 bg-card/30">
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <History className="h-3 w-3" />
          Transfer History
        </div>
        <div className="flex items-center gap-1">
          {entries.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[10px]"
              onClick={handleClear}
            >
              <Trash2 className="h-2.5 w-2.5" />
              Clear
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <ScrollArea className="max-h-[200px]">
        {loading ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            Loading...
          </div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            No transfer history
          </div>
        ) : (
          <div className="px-2 pb-2 space-y-0.5">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-[11px]"
              >
                {entry.direction === "download" ? (
                  <Download className="h-3 w-3 shrink-0 text-blue-400" />
                ) : (
                  <Upload className="h-3 w-3 shrink-0 text-green-400" />
                )}
                <span className="min-w-0 flex-1 truncate" title={entry.remote_path}>
                  {entry.remote_path.split("/").pop() || entry.remote_path}
                </span>
                {entry.status === "completed" ? (
                  <Check className="h-3 w-3 shrink-0 text-green-500" />
                ) : (
                  <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />
                )}
                <span className="shrink-0 text-[10px] text-muted-foreground/60">
                  {dayjs(entry.transferred_at).fromNow()}
                </span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
