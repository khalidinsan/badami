import { useState, useMemo } from "react";
import {
  Search,
  Trash2,
  X,
  Filter,
  Clock,
  RotateCcw,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useApiHistory } from "@/hooks/useApiHistory";
import { getStatusColor, METHOD_COLORS, HTTP_METHODS } from "@/types/api";
import { generateCurl } from "@/lib/curlExporter";
import type { HttpMethod } from "@/types/api";
import type { ApiHistoryRow } from "@/types/db";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { toast } from "sonner";

dayjs.extend(relativeTime);

interface HistoryPanelProps {
  onRestore: (entry: ApiHistoryRow) => void;
  onClose: () => void;
}

type StatusFilter = "all" | "2xx" | "3xx" | "4xx" | "5xx" | "error";

export function HistoryPanel({ onRestore, onClose }: HistoryPanelProps) {
  const { history, deleteEntry, clearAll } = useApiHistory();
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    let items = history;

    if (search) {
      const q = search.toLowerCase();
      items = items.filter((h) => h.url.toLowerCase().includes(q));
    }

    if (methodFilter !== "all") {
      items = items.filter((h) => h.method === methodFilter);
    }

    if (statusFilter !== "all") {
      items = items.filter((h) => {
        if (statusFilter === "error") return !h.status_code || h.status_code === 0;
        const prefix = statusFilter.charAt(0);
        return h.status_code && String(h.status_code).charAt(0) === prefix;
      });
    }

    return items;
  }, [history, search, methodFilter, statusFilter]);

  const handleCopyCurl = (entry: ApiHistoryRow, e: React.MouseEvent) => {
    e.stopPropagation();
    const curl = generateCurl({
      method: entry.method,
      url: entry.url,
      headers: entry.request_headers ? JSON.parse(entry.request_headers) : [],
      body: entry.request_body,
      authType: entry.auth_type ?? "none",
    });
    navigator.clipboard.writeText(curl);
    toast.success("cURL copied to clipboard");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-[#007AFF]" />
          <h3 className="text-xs font-semibold">History</h3>
          <span className="rounded-full bg-muted/60 px-1.5 py-px text-[10px] text-muted-foreground">
            {filtered.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-[10px] text-muted-foreground hover:text-destructive"
              onClick={clearAll}
            >
              Clear All
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="space-y-2 border-b border-white/5 px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search URL..."
            className="h-7 border-white/10 bg-white/5 pl-7 text-xs"
          />
        </div>
        <div className="flex gap-2">
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="h-6 w-24 border-white/10 bg-white/5 text-[10px]">
              <Filter className="mr-1 h-2.5 w-2.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Methods</SelectItem>
              {HTTP_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  <span style={{ color: METHOD_COLORS[m] }}>{m}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger className="h-6 w-20 border-white/10 bg-white/5 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="2xx">
                <span className="text-green-500">2xx</span>
              </SelectItem>
              <SelectItem value="3xx">
                <span className="text-blue-500">3xx</span>
              </SelectItem>
              <SelectItem value="4xx">
                <span className="text-yellow-500">4xx</span>
              </SelectItem>
              <SelectItem value="5xx">
                <span className="text-red-500">5xx</span>
              </SelectItem>
              <SelectItem value="error">
                <span className="text-gray-500">Error</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* History list */}
      <ScrollArea className="flex-1">
        <div className="px-2 pb-2">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {history.length === 0 ? "No history yet" : "No matching entries"}
            </p>
          ) : (
            filtered.map((entry) => {
              const method = entry.method as HttpMethod;
              const statusColor = entry.status_code
                ? getStatusColor(entry.status_code)
                : "#6b7280";

              return (
                <button
                  key={entry.id}
                  onClick={() => onRestore(entry)}
                  className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5"
                >
                  {entry.status_code ? (
                    <span
                      className="shrink-0 rounded px-1 py-0.5 text-[10px] font-bold text-white"
                      style={{ backgroundColor: statusColor }}
                    >
                      {entry.status_code}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded bg-gray-500 px-1 py-0.5 text-[10px] font-bold text-white">
                      ERR
                    </span>
                  )}
                  <span
                    className="w-9 shrink-0 text-[10px] font-bold"
                    style={{ color: METHOD_COLORS[method] || "#6b7280" }}
                  >
                    {method}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                    {entry.url}
                  </span>
                  {entry.elapsed_ms != null && entry.elapsed_ms > 0 && (
                    <span className="shrink-0 text-[10px] text-muted-foreground/40">
                      {entry.elapsed_ms}ms
                    </span>
                  )}
                  <span className="shrink-0 text-[10px] text-muted-foreground/50">
                    {dayjs(entry.sent_at).fromNow()}
                  </span>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => handleCopyCurl(entry, e)}
                      title="Copy as cURL"
                    >
                      <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRestore(entry);
                      }}
                      title="Restore to builder"
                    >
                      <RotateCcw className="h-3 w-3 text-muted-foreground hover:text-[#007AFF]" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteEntry(entry.id);
                      }}
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
