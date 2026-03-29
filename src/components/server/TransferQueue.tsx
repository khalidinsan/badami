import {
  Download,
  Upload,
  Check,
  X,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TransferItem } from "@/hooks/useFileManager";

interface TransferQueueProps {
  transfers: TransferItem[];
  onClear: () => void;
}

export function TransferQueue({ transfers, onClear }: TransferQueueProps) {
  const active = transfers.filter((t) => t.status === "transferring" || t.status === "pending");
  const completed = transfers.filter((t) => t.status === "completed" || t.status === "failed");

  return (
    <div className="border-t border-border/40 bg-card/30">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px]">
        <span className="font-medium text-muted-foreground">
          Transfers
          {active.length > 0 && (
            <span className="ml-1 text-primary">({active.length} active)</span>
          )}
        </span>
        {completed.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-[10px]"
            onClick={onClear}
          >
            <Trash2 className="h-2.5 w-2.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Items */}
      <div className="max-h-[120px] overflow-auto px-2 pb-2">
        {transfers.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-[11px]"
          >
            {/* Direction icon */}
            {item.direction === "download" ? (
              <Download className="h-3 w-3 shrink-0 text-blue-400" />
            ) : (
              <Upload className="h-3 w-3 shrink-0 text-green-400" />
            )}

            {/* File name */}
            <span className="min-w-0 flex-1 truncate">{item.fileName}</span>

            {/* Status */}
            {item.status === "transferring" && (
              <div className="flex items-center gap-1.5">
                <div className="h-1 w-16 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              </div>
            )}
            {item.status === "completed" && (
              <Check className="h-3 w-3 text-green-500" />
            )}
            {item.status === "failed" && (
              <X className="h-3 w-3 text-destructive" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
