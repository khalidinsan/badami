import { AlertTriangle, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StackHealth, StackPhase } from "@/types/localDev";

interface StackHeroBarProps {
  health: StackHealth;
  stackBusy: boolean;
  anyBusy: boolean;
  onStartStack: () => void;
  onStopStack: () => void;
  onRefresh: () => void;
}

const PHASE_STYLES: Record<StackPhase, { dot: string; text: string }> = {
  serving: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  partial: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  starting: { dot: "bg-amber-500 animate-pulse", text: "text-amber-700 dark:text-amber-400" },
  stopping: { dot: "bg-amber-500 animate-pulse", text: "text-amber-700 dark:text-amber-400" },
  broken: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400" },
  stopped: { dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

/**
 * The one state a human should have to read.
 *
 * Everything below this bar is detail. Only the **web** group decides
 * serving/stopped — Data is reported alongside and DNS is a degradation, which
 * mirrors how `ld_stack_start` treats a dnsmasq failure as non-fatal.
 */
export function StackHeroBar({
  health,
  stackBusy,
  anyBusy,
  onStartStack,
  onStopStack,
  onRefresh,
}: StackHeroBarProps) {
  const style = PHASE_STYLES[health.phase];
  const transitional = health.phase === "starting" || health.phase === "stopping";

  // "Stop all" must stay reachable whenever *anything* is alive — including a
  // half-dead service in a broken stack, which is exactly the state a user
  // needs to stop. Keying this off `phase` alone would hide the button behind
  // `broken` and strand a stuck nginx.
  const anythingAlive = [...health.web.members, ...health.data.members, ...health.dns.members].some(
    (s) =>
      s.status.status === "running" ||
      s.status.status === "unhealthy" ||
      s.status.status === "starting" ||
      s.status.status === "stopping",
  );
  const showStop = anythingAlive;
  const showStart = health.phase !== "serving";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/40 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", style.dot)}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn("text-sm font-semibold", style.text)}>{health.label}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              web {health.web.requiredRunning}/{health.web.requiredTotal}
              {/* Same denominator rule as the group badge: services with no
                  binary are excluded rather than counted as perpetually down. */}
              {health.data.requiredTotal > 0 &&
                ` · data ${health.data.requiredRunning}/${health.data.requiredTotal}`}
            </span>
          </div>
          {health.detail && (
            <p className="mt-0.5 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
              {health.phase !== "serving" && (
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
              )}
              <span className="line-clamp-2">{health.detail}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-xs"
          disabled={stackBusy}
          onClick={onRefresh}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
        {showStop && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={anyBusy || transitional}
            onClick={onStopStack}
          >
            {stackBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            Stop all
          </Button>
        )}
        {showStart && (
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={anyBusy || transitional}
            onClick={onStartStack}
          >
            {stackBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Start all
          </Button>
        )}
      </div>
    </div>
  );
}
