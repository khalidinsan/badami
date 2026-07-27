import { Loader2, Play, RotateCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ServiceStatusReport } from "@/types/localDev";
import {
  isServiceBusy,
  isServiceRunning,
  phpVersionOf,
  servicePid,
  serviceStatusDetail,
  serviceStatusShort,
} from "@/types/localDev";

interface PhpPoolRowProps {
  /** All php-fpm services, one per discovered version. */
  pools: ServiceStatusReport[];
  required: Set<string>;
  groupBusy: boolean;
  serviceBusy: Record<string, boolean>;
  selectedServiceId: string | null;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onSelect: (id: string) => void;
}

function chipClass(service: ServiceStatusReport, selected: boolean): string {
  const base =
    "flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const ring = selected ? " ring-1 ring-primary/40" : "";
  switch (service.status.status) {
    case "running":
      return `${base}${ring} border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400`;
    case "starting":
    case "stopping":
      return `${base}${ring} border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400`;
    case "unhealthy":
    case "error":
      return `${base}${ring} border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400`;
    case "unavailable":
      return `${base}${ring} border-dashed border-border text-muted-foreground/60`;
    default:
      return `${base}${ring} border-border text-muted-foreground hover:text-foreground`;
  }
}

function dotClass(service: ServiceStatusReport): string {
  switch (service.status.status) {
    case "running":
      return "bg-emerald-500";
    case "starting":
    case "stopping":
      return "bg-amber-500 animate-pulse";
    case "unhealthy":
    case "error":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/40";
  }
}

/**
 * All PHP-FPM pools on one row.
 *
 * Pools genuinely run **concurrently** — each version listens on its own
 * `php{tag}.sock` and nginx routes per site, which is what makes per-site PHP
 * isolation work. So this is a grouped view, not a mutually exclusive selector:
 * turning versions off would 502 every isolated site. Per-site version choice
 * lives in the Sites tab.
 *
 * One chip per version keeps a Herd install's 6-8 versions to a single line
 * instead of a screenful of cards. Selecting a chip targets it for the log pane
 * and for the action buttons on the right, so every pool stays controllable
 * without N sets of buttons.
 */
export function PhpPoolRow({
  pools,
  required,
  groupBusy,
  serviceBusy,
  selectedServiceId,
  onStart,
  onStop,
  onRestart,
  onSelect,
}: PhpPoolRowProps) {
  const sorted = [...pools].sort((a, b) =>
    (phpVersionOf(a) ?? a.id).localeCompare(phpVersionOf(b) ?? b.id, undefined, {
      numeric: true,
    }),
  );
  const runningCount = sorted.filter((s) => isServiceRunning(s.status)).length;
  const requiredCount = sorted.filter((s) => required.has(s.id)).length;

  // Actions target the selected pool; fall back to the first required one so the
  // buttons are never orphaned when selection sits on another service.
  const target =
    sorted.find((s) => s.id === selectedServiceId) ??
    sorted.find((s) => required.has(s.id)) ??
    sorted[0];
  const targetSelected = target?.id === selectedServiceId;
  const busy = target ? !!serviceBusy[target.id] || groupBusy : groupBusy;
  const st = target?.status.status;
  const transitional = target ? isServiceBusy(target.status) || busy : busy;
  const running = target ? isServiceRunning(target.status) : false;

  const canStart =
    !!target && !transitional && target.binary_present && (st === "stopped" || st === "error");
  const canStop =
    !!target && !transitional && (running || st === "unhealthy" || st === "starting" || st === "stopping");
  const canRestart = !!target && !transitional && target.binary_present && running;

  const targetVersion = target ? (phpVersionOf(target) ?? target.id) : null;
  const detail = target ? serviceStatusDetail(target.status) : null;

  return (
    <div className="border-t border-border/30 px-3 py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="shrink-0 text-xs font-medium">PHP-FPM</span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {runningCount}/{requiredCount || sorted.length} pools
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {sorted.map((pool) => {
              const version = phpVersionOf(pool) ?? pool.id;
              const isRequired = required.has(pool.id);
              const selected = pool.id === selectedServiceId;
              const poolBusy = !!serviceBusy[pool.id];
              return (
                <Tooltip key={pool.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onSelect(pool.id)}
                      aria-pressed={selected}
                      aria-label={`PHP ${version} — ${serviceStatusShort(pool.status)}`}
                      className={chipClass(pool, selected)}
                    >
                      {poolBusy ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <span
                          className={cn("h-1.5 w-1.5 rounded-full", dotClass(pool))}
                          aria-hidden
                        />
                      )}
                      <span className="tabular-nums">{version}</span>
                      {isRequired && <span className="text-[9px] opacity-60">req</span>}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-[10px]">
                    PHP {version} · {serviceStatusShort(pool.status)}
                    {servicePid(pool.status) != null && ` · pid ${servicePid(pool.status)}`}
                    <br />
                    {!pool.binary_present
                      ? "Binary not found"
                      : isRequired
                        ? "Needed by the default catch-all or an isolated site"
                        : "No site uses this version"}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {target && (
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 text-[10px] text-muted-foreground">
              {targetSelected ? "selected" : "default target"}: {targetVersion}
            </span>
            {canStart && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => onStart(target.id)}
              >
                <Play className="h-3 w-3" />
                Start
              </Button>
            )}
            {canRestart && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    aria-label={`Restart PHP ${targetVersion}`}
                    onClick={() => onRestart(target.id)}
                  >
                    <RotateCw className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px]">
                  Restart this pool (after editing php.ini)
                </TooltipContent>
              </Tooltip>
            )}
            {canStop && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => onStop(target.id)}
              >
                <Square className="h-3 w-3" />
                Stop
              </Button>
            )}
            {transitional && !canStart && !canStop && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
        )}
      </div>

      {detail && (
        <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-red-700/90 dark:text-red-400/90">
          {targetVersion}: {detail}
        </p>
      )}
    </div>
  );
}
