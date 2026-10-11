import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  History,
  Info,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  clearPersistedEvents,
  useLocalDevStore,
  type RecentServiceEvent,
} from "@/stores/localDevStore";
import { cn } from "@/lib/utils";

/**
 * In-memory supervisor transition log.
 *
 * Fed by `acquireServiceEvents`, which listens on the `ld://service-*` topics
 * plus `ld://mariadb-crashed`. Capped at the store's `MAX_RECENT_EVENTS`.
 * "Clear" wipes both the in-memory list and `local_dev_events` on disk — the
 * authoritative audit lives in that table, not here.
 */
export function RecentEventsCard() {
  const events = useLocalDevStore((s) => s.recentEvents);
  const clearRecentEvents = useLocalDevStore((s) => s.clearRecentEvents);
  const services = useLocalDevStore((s) => s.services);
  const revealServiceLog = useLocalDevStore((s) => s.revealServiceLog);
  const [open, setOpen] = useState(false);

  const summary = useLocalDevStore((s) => {
    const errors = s.recentEvents.filter((e) => e.level === "error").length;
    const warnings = s.recentEvents.filter((e) => e.level === "warn").length;
    return { errors, warnings, total: s.recentEvents.length };
  });

  const serviceLabel = (id: string): string =>
    services.find((s) => s.id === id)?.label ?? id;

  return (
    <Card className="py-4">
      <CardHeader className="px-4 pb-2 pt-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                !open && "-rotate-90",
              )}
            />
            <History className="h-4 w-4 shrink-0" />
            <CardTitle className="truncate text-sm">Recent events</CardTitle>
            {summary.errors > 0 && (
              <Badge variant="destructive" className="h-5 text-[10px]">
                {summary.errors} error{summary.errors === 1 ? "" : "s"}
              </Badge>
            )}
            {summary.warnings > 0 && (
              <Badge variant="secondary" className="h-5 text-[10px]">
                {summary.warnings} warning{summary.warnings === 1 ? "" : "s"}
              </Badge>
            )}
            {summary.total === 0 && (
              <Badge variant="outline" className="h-5 text-[10px]">
                none
              </Badge>
            )}
          </button>
          {events.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => {
                clearRecentEvents();
                // Fire-and-forget: the persisted audit lives in a separate
                // table and should match what the user just emptied in the UI.
                void clearPersistedEvents();
              }}
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>
        {open && (
          <CardDescription className="text-xs">
            Status transitions, crashes and auto-restart attempts from the supervisor health
            loop. The authoritative audit lives in <code className="font-mono">local_dev_events</code>.
          </CardDescription>
        )}
      </CardHeader>
      {open && (
        <CardContent className="px-4">
          {events.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-6 text-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-600/40" />
              <p className="text-xs text-muted-foreground">
                No supervisor events yet — services look stable.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  label={serviceLabel(event.service_id)}
                  onOpenLog={() => revealServiceLog(event.service_id)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function EventRow({
  event,
  label,
  onOpenLog,
}: {
  event: RecentServiceEvent;
  label: string;
  onOpenLog: () => void;
}) {
  const Icon =
    event.level === "error"
      ? XCircle
      : event.level === "warn"
        ? AlertTriangle
        : Info;
  const tone =
    event.level === "error"
      ? "text-red-700 dark:text-red-400"
      : event.level === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <li className="flex items-start gap-2 rounded-md border border-border/40 bg-background/40 px-2 py-1.5 text-xs">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{label}</span>
          <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase">
            {event.topic}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatEventTime(event.at)}
          </span>
        </div>
        <p className="mt-0.5 break-words text-[11px] opacity-90">{event.message}</p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 px-2 text-[10px]"
        onClick={onOpenLog}
      >
        Log
      </Button>
    </li>
  );
}

/** Format an ISO timestamp into a short local-time string. */
function formatEventTime(at: string): string {
  try {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return at;
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return at;
  }
}
