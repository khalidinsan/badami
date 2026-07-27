import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  FileText,
  Filter,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  X,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalDevStore } from "@/stores/localDevStore";
import { cn } from "@/lib/utils";
import { phpVersionOf, serviceStatusShort } from "@/types/localDev";

interface LogViewerProps {
  className?: string;
  /**
   * The pane is actually on screen.
   *
   * The Local Dev page stays mounted under tab keep-alive, and sibling sub-tabs
   * only hide it with CSS — so without this the follow timer would keep tailing
   * log files while the user is somewhere else entirely.
   */
  active: boolean;
}

/** How often to re-tail while following. Matches the status poller's cadence. */
const FOLLOW_MS = 2500;

type LineLevel = "error" | "warn" | null;

/**
 * Classify a log line so failures are visible without reading every line.
 *
 * Mirrors `classify_log_line` in supervisor.rs, which does the same job for the
 * Problems scan. Covers the three formats this stack produces: nginx
 * (`[error]`), PHP-FPM / PHP (`PHP Fatal error`, `WARNING:`), MariaDB (`[ERROR]`).
 */
function lineLevel(line: string): LineLevel {
  if (/\[(error|crit|alert|emerg)\]|\[ERROR\]|PHP (Fatal error|Parse error)|\bFATAL\b/i.test(line)) {
    return "error";
  }
  if (/\[warn\]|\[Warning\]|^WARNING:|PHP Warning|\bdeprecated\b/i.test(line)) {
    return "warn";
  }
  return null;
}

const LEVEL_CLASS: Record<Exclude<LineLevel, null>, string> = {
  error: "text-red-400",
  warn: "text-amber-300",
};

/** Split a line around case-insensitive matches so they can be marked. */
function highlightParts(text: string, query: string): Array<{ s: string; hit: boolean }> {
  if (!query) return [{ s: text, hit: false }];
  const parts: Array<{ s: string; hit: boolean }> = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lowerText.indexOf(lowerQuery, from);
    if (at === -1) break;
    if (at > from) parts.push({ s: text.slice(from, at), hit: false });
    parts.push({ s: text.slice(at, at + query.length), hit: true });
    from = at + query.length;
  }
  if (from < text.length) parts.push({ s: text.slice(from), hit: false });
  return parts;
}

function LogLine({ text, level, query }: { text: string; level: LineLevel; query: string }) {
  return (
    <div className={cn("whitespace-pre-wrap break-all", level && LEVEL_CLASS[level])}>
      {highlightParts(text, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-amber-400/30 text-inherit">
            {p.s}
          </mark>
        ) : (
          <span key={i}>{p.s}</span>
        ),
      )}
    </div>
  );
}

export function LogViewer({ className, active }: LogViewerProps) {
  const selectedServiceId = useLocalDevStore((s) => s.selectedServiceId);
  const logTail = useLocalDevStore((s) => s.logTail);
  const logLoading = useLocalDevStore((s) => s.logLoading);
  const logsOpen = useLocalDevStore((s) => s.logsOpen);
  const logFollow = useLocalDevStore((s) => s.logFollow);
  const logMode = useLocalDevStore((s) => s.logMode);
  const problemsReport = useLocalDevStore((s) => s.problemsReport);
  const problemsLoading = useLocalDevStore((s) => s.problemsLoading);
  const services = useLocalDevStore((s) => s.services);
  const fetchLogs = useLocalDevStore((s) => s.fetchLogs);
  const fetchProblems = useLocalDevStore((s) => s.fetchProblems);
  const setLogsOpen = useLocalDevStore((s) => s.setLogsOpen);
  const setLogFollow = useLocalDevStore((s) => s.setLogFollow);
  const setLogMode = useLocalDevStore((s) => s.setLogMode);
  const revealServiceLog = useLocalDevStore((s) => s.revealServiceLog);

  const [errorsOnly, setErrorsOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** Sticky bottom until the user scrolls up — then stop yanking them back. */
  const stickToBottom = useRef(true);

  const selected = selectedServiceId;
  const tailMode = logMode === "tail";

  // Fetch on open / source change. A collapsed pane never reads a log file.
  useEffect(() => {
    if (!logsOpen || !active || !tailMode || !selected) return;
    void fetchLogs(selected);
  }, [selected, logsOpen, active, tailMode, fetchLogs]);

  useEffect(() => {
    if (!logsOpen || !active || tailMode) return;
    void fetchProblems();
  }, [logsOpen, active, tailMode, fetchProblems]);

  // Follow mode: re-tail on an interval so "Reload" stops being a chore.
  useEffect(() => {
    if (!logsOpen || !logFollow || !active) return;
    const timer = window.setInterval(() => {
      const store = useLocalDevStore.getState();
      if (store.logMode === "problems") void store.fetchProblems();
      else if (store.selectedServiceId) void store.fetchLogs(store.selectedServiceId);
    }, FOLLOW_MS);
    return () => window.clearInterval(timer);
  }, [logsOpen, logFollow, active, logMode, selected]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }, []);

  const lines = logTail?.service_id === selected ? logTail.lines : [];
  const path = logTail?.service_id === selected ? logTail.path : null;

  const visibleLines = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines
      .map((text, i) => ({ text, i, level: lineLevel(text) }))
      .filter((l) => (errorsOnly ? l.level !== null : true))
      .filter((l) => (q ? l.text.toLowerCase().includes(q) : true));
  }, [lines, errorsOnly, query]);

  const errorCount = useMemo(
    () => lines.reduce((n, l) => (lineLevel(l) === "error" ? n + 1 : n), 0),
    [lines],
  );

  // Pin to the newest line after each refresh, unless the user scrolled away.
  useLayoutEffect(() => {
    if (!logsOpen || !stickToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleLines, logsOpen]);

  const label = selected
    ? (services.find((s) => s.id === selected)?.label ?? selected)
    : null;

  /** Services worth offering as a source, most useful first. */
  const sources = useMemo(() => {
    const rank = (id: string, kind: string) => {
      if (kind === "nginx" || id === "nginx") return 0;
      if (id.startsWith("php-fpm-")) return 1;
      if (id === "mariadb" || id === "mysql") return 2;
      if (id === "redis") return 3;
      return 4;
    };
    return [...services].sort(
      (a, b) => rank(a.id, a.kind.kind) - rank(b.id, b.kind.kind) || a.id.localeCompare(b.id),
    );
  }, [services]);

  const problemTotal = problemsReport
    ? problemsReport.total_errors + problemsReport.total_warnings
    : 0;
  const loading = tailMode ? logLoading : problemsLoading;

  const header = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border/40 px-4 py-2">
      <button
        type="button"
        onClick={() => setLogsOpen(!logsOpen)}
        aria-expanded={logsOpen}
        className="flex min-w-0 items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            !logsOpen && "-rotate-90",
          )}
        />
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium">
          Logs{!logsOpen && tailMode && label ? ` · ${label}` : ""}
        </span>
      </button>

      {logsOpen && (
        <>
          {/* Tail answers "what is this service saying"; Problems answers
              "what is broken" without needing to know which service to open. */}
          <div className="flex shrink-0 items-center rounded-md border border-border/60 p-0.5">
            {(["tail", "problems"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={logMode === mode}
                onClick={() => setLogMode(mode)}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] capitalize transition-colors",
                  logMode === mode
                    ? "bg-primary/10 font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode}
              </button>
            ))}
          </div>

          {tailMode && sources.length > 0 && (
            <Select
              value={selected ?? undefined}
              onValueChange={(v) => {
                stickToBottom.current = true;
                useLocalDevStore.getState().setSelectedServiceId(v);
              }}
            >
              <SelectTrigger size="sm" className="h-7 w-[180px] text-[11px]">
                <SelectValue placeholder="Choose a service" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => {
                  const php = phpVersionOf(s);
                  return (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            s.status.status === "running"
                              ? "bg-emerald-500"
                              : s.status.status === "unhealthy" || s.status.status === "error"
                                ? "bg-red-500"
                                : "bg-muted-foreground/40",
                          )}
                          aria-hidden
                        />
                        {php ? `PHP-FPM ${php}` : s.label}
                        <span className="text-[10px] text-muted-foreground">
                          {serviceStatusShort(s.status)}
                        </span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}

          {tailMode && searchOpen && (
            <div className="flex min-w-0 items-center gap-1">
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQuery("");
                    setSearchOpen(false);
                  }
                }}
                placeholder="Filter lines…"
                className="h-7 w-[150px] text-[11px]"
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                aria-label="Close search"
                onClick={() => {
                  setQuery("");
                  setSearchOpen(false);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {tailMode && errorCount > 0 && (
              <span className="text-[10px] tabular-nums text-red-600 dark:text-red-400">
                {errorCount} error{errorCount === 1 ? "" : "s"}
              </span>
            )}
            {!tailMode && problemsReport && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {problemsReport.total_errors} error
                {problemsReport.total_errors === 1 ? "" : "s"} ·{" "}
                {problemsReport.total_warnings} warning
                {problemsReport.total_warnings === 1 ? "" : "s"}
              </span>
            )}
            {tailMode && !searchOpen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    aria-label="Search log"
                    onClick={() => setSearchOpen(true)}
                  >
                    <Search className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px]">
                  Filter lines by text
                </TooltipContent>
              </Tooltip>
            )}
            {tailMode && (
              <Button
                size="sm"
                variant={errorsOnly ? "secondary" : "ghost"}
                className="h-7 gap-1 px-2 text-[11px]"
                aria-pressed={errorsOnly}
                onClick={() => setErrorsOnly((v) => !v)}
              >
                <Filter className="h-3 w-3" />
                Errors
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={logFollow ? "secondary" : "ghost"}
                  className="h-7 gap-1 px-2 text-[11px]"
                  aria-pressed={logFollow}
                  onClick={() => setLogFollow(!logFollow)}
                >
                  {logFollow ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  Follow
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">
                {logFollow ? `Auto-refreshing every ${FOLLOW_MS / 1000}s` : "Paused"}
              </TooltipContent>
            </Tooltip>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label="Reload"
              disabled={loading}
              onClick={() => {
                stickToBottom.current = true;
                if (tailMode && selected) void fetchLogs(selected);
                if (!tailMode) void fetchProblems();
              }}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );

  if (!logsOpen) {
    return <div className={cn("border-t border-border/40", className)}>{header}</div>;
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col border-t border-border/40", className)}>
      {header}
      {tailMode && path && (
        <p className="truncate border-b border-border/30 px-4 py-1 font-mono text-[10px] text-muted-foreground">
          {path}
          {logTail?.truncated ? " · truncated" : ""}
        </p>
      )}

      {!tailMode ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {problemsLoading && !problemsReport ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Scanning logs…
            </div>
          ) : problemTotal === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CircleAlert className="mb-2 h-8 w-8 text-emerald-600/40" />
              <p className="text-xs font-medium text-muted-foreground">No problems found</p>
              <p className="mt-0.5 max-w-sm text-[11px] text-muted-foreground/70">
                {problemsReport?.notes[problemsReport.notes.length - 1] ??
                  "Scanned the tail of every service log"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {problemsReport?.services.map((svc) => (
                <div
                  key={svc.service_id}
                  className="overflow-hidden rounded-lg border border-border/60"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/40 bg-muted/30 px-3 py-1.5">
                    <span className="text-xs font-medium">{svc.label}</span>
                    {svc.errors > 0 && (
                      <span className="text-[10px] tabular-nums text-red-600 dark:text-red-400">
                        {svc.errors} error{svc.errors === 1 ? "" : "s"}
                      </span>
                    )}
                    {svc.warnings > 0 && (
                      <span className="text-[10px] tabular-nums text-amber-700 dark:text-amber-400">
                        {svc.warnings} warning{svc.warnings === 1 ? "" : "s"}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      of {svc.scanned} lines
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-6 px-2 text-[10px]"
                      onClick={() => revealServiceLog(svc.service_id)}
                    >
                      Open log
                    </Button>
                  </div>
                  <div className="bg-[#0d1117] px-3 py-1.5 font-mono text-[11px] leading-relaxed text-[#c9d1d9]">
                    {svc.problems.map((p, i) => (
                      <div
                        key={i}
                        className={cn(
                          "whitespace-pre-wrap break-all",
                          p.level === "error" ? LEVEL_CLASS.error : LEVEL_CLASS.warn,
                        )}
                      >
                        {p.text}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : !selected ? (
        <div className="flex flex-1 flex-col items-center justify-center bg-muted/20 px-4 py-8 text-center">
          <FileText className="mb-2 h-8 w-8 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">Choose a service above to view its log</p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto bg-[#0d1117] px-3 py-2 font-mono text-[11px] leading-relaxed text-[#c9d1d9]"
        >
          {logLoading && lines.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-white/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : visibleLines.length === 0 ? (
            <p className="py-4 text-white/40">
              {lines.length === 0
                ? "No log lines"
                : `No matching lines in the last ${lines.length}`}
            </p>
          ) : (
            visibleLines.map((line) => (
              <LogLine
                key={line.i}
                text={line.text}
                level={line.level}
                query={query.trim()}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
