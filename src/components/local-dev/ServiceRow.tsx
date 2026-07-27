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
import { RegisterMariaDbButton } from "@/components/local-dev/RegisterMariaDbButton";

interface ServiceRowProps {
  service: ServiceStatusReport;
  /** Part of the group's required set — drives the "not required" hint. */
  required: boolean;
  busy?: boolean;
  selected?: boolean;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onSelect: (id: string) => void;
}

function statusDotClass(service: ServiceStatusReport): string {
  switch (service.status.status) {
    case "running":
      return "bg-emerald-500";
    case "starting":
    case "stopping":
      return "bg-amber-500 animate-pulse";
    case "unhealthy":
    case "error":
      return "bg-red-500";
    case "unavailable":
      return "bg-muted-foreground/30";
    default:
      return "bg-muted-foreground/40";
  }
}

function statusTextClass(service: ServiceStatusReport): string {
  switch (service.status.status) {
    case "running":
      return "text-emerald-700 dark:text-emerald-400";
    case "unhealthy":
    case "error":
      return "text-red-700 dark:text-red-400";
    case "starting":
    case "stopping":
      return "text-amber-700 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

/** Secondary line: PHP version, or why the service can't run. */
function metaLine(service: ServiceStatusReport, required: boolean): string | null {
  if (!service.binary_present) return "binary not found";
  const php = phpVersionOf(service);
  if (php) return required ? `PHP ${php}` : `PHP ${php} · not required`;
  if (!required && !isServiceRunning(service.status)) return "not required";
  return null;
}

export function ServiceRow({
  service,
  required,
  busy = false,
  selected = false,
  onStart,
  onStop,
  onRestart,
  onSelect,
}: ServiceRowProps) {
  const st = service.status.status;
  const running = isServiceRunning(service.status);
  const transitional = isServiceBusy(service.status) || busy;
  const detail = serviceStatusDetail(service.status);
  const pid = servicePid(service.status);
  const meta = metaLine(service, required);

  // Exclusive actions — Start and Stop are never both enabled.
  // unhealthy = process/port half-alive, so only Stop (to recover).
  const canStart = !transitional && service.binary_present && (st === "stopped" || st === "error");
  const canStop =
    !transitional && (running || st === "unhealthy" || st === "starting" || st === "stopping");
  const canRestart = !transitional && service.binary_present && running;

  const isMariaDb =
    service.kind.kind === "maria_db" || service.id === "mariadb" || service.id === "maria_db";
  const showRegister = isMariaDb && (running || st === "unhealthy");

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/30 px-3 py-2 first:border-t-0",
        selected && "bg-primary/5",
      )}
    >
      {/* Left region doubles as the "show my logs" selector */}
      <button
        type="button"
        onClick={() => onSelect(service.id)}
        aria-pressed={selected}
        aria-label={`Show ${service.label} logs`}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", statusDotClass(service))}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-xs font-medium">{service.label}</span>
            {meta && (
              <span className="truncate text-[10px] text-muted-foreground">{meta}</span>
            )}
          </span>
          {detail && (
            <span className="mt-0.5 line-clamp-2 block text-[10px] leading-snug text-red-700/90 dark:text-red-400/90">
              {detail}
            </span>
          )}
        </span>
      </button>

      {/* Status word — pid moved to a tooltip; it is noise in the primary badge */}
      {pid != null ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "shrink-0 cursor-default text-[11px] tabular-nums",
                statusTextClass(service),
              )}
            >
              {serviceStatusShort(service.status)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" className="font-mono text-[10px]">
            pid {pid}
            {service.binary_path ? ` · ${service.binary_path}` : ""}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className={cn("shrink-0 text-[11px]", statusTextClass(service))}>
          {serviceStatusShort(service.status)}
        </span>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {showRegister && <RegisterMariaDbButton compact disabled={transitional} />}
        {canStart && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => onStart(service.id)}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
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
                aria-label={`Restart ${service.label}`}
                onClick={() => onRestart(service.id)}
              >
                <RotateCw className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              Restart (after editing config)
            </TooltipContent>
          </Tooltip>
        )}
        {canStop && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => onStop(service.id)}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
            Stop
          </Button>
        )}
        {transitional && !canStop && !canStart && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
