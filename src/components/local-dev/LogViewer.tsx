import { useEffect } from "react";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalDevStore } from "@/stores/localDevStore";
import { cn } from "@/lib/utils";

interface LogViewerProps {
  className?: string;
}

export function LogViewer({ className }: LogViewerProps) {
  const selectedServiceId = useLocalDevStore((s) => s.selectedServiceId);
  const logTail = useLocalDevStore((s) => s.logTail);
  const logLoading = useLocalDevStore((s) => s.logLoading);
  const services = useLocalDevStore((s) => s.services);
  const fetchLogs = useLocalDevStore((s) => s.fetchLogs);

  // selectedServiceId is auto-set on first status refresh; no silent fallback needed
  const selected = selectedServiceId;

  useEffect(() => {
    if (!selected) return;
    void fetchLogs(selected);
  }, [selected, fetchLogs]);

  if (!selected) {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center border-t border-border/40 bg-muted/20 px-4 py-8 text-center",
          className,
        )}
      >
        <FileText className="mb-2 h-8 w-8 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">Select a service to view logs</p>
      </div>
    );
  }

  const label = services.find((s) => s.id === selected)?.label ?? selected;
  const lines = logTail?.service_id === selected ? logTail.lines : [];
  const path = logTail?.service_id === selected ? logTail.path : null;

  return (
    <div className={cn("flex h-full min-h-0 flex-col border-t border-border/40", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">Logs · {label}</p>
          {path && (
            <p className="truncate font-mono text-[10px] text-muted-foreground">{path}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {logTail?.truncated && (
            <span className="text-[10px] text-muted-foreground">truncated</span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={logLoading}
            onClick={() => void fetchLogs(selected)}
          >
            {logLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Reload
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#0d1117] px-3 py-2 font-mono text-[11px] leading-relaxed text-[#c9d1d9]">
        {logLoading && lines.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : lines.length === 0 ? (
          <p className="py-4 text-white/40">No log lines</p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
