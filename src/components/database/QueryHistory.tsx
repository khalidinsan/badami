import { useState, useEffect, useCallback } from "react";
import { X, Search, Trash2, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as dbQueries from "@/db/queries/dbClient";
import type { DbQueryHistoryRow } from "@/types/db";
import { cn } from "@/lib/utils";

interface QueryHistoryProps {
  connectionId: string;
  onSelect: (sql: string) => void;
  onClose: () => void;
}

export function QueryHistory({ connectionId, onSelect, onClose }: QueryHistoryProps) {
  const [items, setItems] = useState<DbQueryHistoryRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await dbQueries.getQueryHistory(connectionId, 200);
      setItems(rows);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleClear = async () => {
    await dbQueries.clearQueryHistory(connectionId);
    setItems([]);
  };

  const filtered = search
    ? items.filter((item) => item.sql_content.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Clock className="h-3.5 w-3.5" />
          Query History
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={handleClear}
            title="Clear history"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-white/10 px-2 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history..."
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-3 text-xs text-muted-foreground">Loading...</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">
            {search ? "No matching queries" : "No query history yet"}
          </div>
        )}
        {filtered.map((item) => (
          <button
            key={item.id}
            className="flex w-full flex-col gap-0.5 border-b border-white/5 px-3 py-2 text-left hover:bg-white/5"
            onClick={() => onSelect(item.sql_content)}
          >
            <div className="flex items-center gap-1.5">
              {item.status === "success" ? (
                <CheckCircle2 className="h-3 w-3 shrink-0 text-green-400" />
              ) : (
                <AlertCircle className="h-3 w-3 shrink-0 text-red-400" />
              )}
              <span className="truncate text-xs font-mono">{item.sql_content}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{formatTime(item.executed_at)}</span>
              {item.duration_ms !== null && <span>{item.duration_ms}ms</span>}
              {item.rows_affected !== null && <span>{item.rows_affected} rows</span>}
              {item.database_name && (
                <span className={cn("rounded bg-white/5 px-1")}>{item.database_name}</span>
              )}
            </div>
            {item.error_message && (
              <span className="truncate text-[10px] text-red-400/70">{item.error_message}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}
