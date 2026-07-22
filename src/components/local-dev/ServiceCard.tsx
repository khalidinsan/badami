import {
  Play,
  Square,
  Loader2,
  Server,
  Database,
  Globe,
  HardDrive,
  Network,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ServiceStatusReport } from "@/types/localDev";
import {
  isServiceBusy,
  isServiceRunning,
  serviceStatusDetail,
  serviceStatusLabel,
} from "@/types/localDev";

interface ServiceCardProps {
  service: ServiceStatusReport;
  busy?: boolean;
  selected?: boolean;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onSelect: (id: string) => void;
}

function kindIcon(service: ServiceStatusReport) {
  const k = service.kind.kind;
  switch (k) {
    case "nginx":
      return Globe;
    case "maria_db":
    case "my_sql":
      return Database;
    case "redis":
      return HardDrive;
    case "dns_masq":
      return Network;
    case "php_fpm":
      return Server;
    default:
      return Server;
  }
}

function statusBadgeClass(status: ServiceStatusReport["status"]): string {
  switch (status.status) {
    case "running":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "starting":
    case "stopping":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "unhealthy":
    case "error":
      return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400";
    case "unavailable":
      return "border-muted-foreground/30 bg-muted text-muted-foreground";
    default:
      return "border-border text-muted-foreground";
  }
}

export function ServiceCard({
  service,
  busy = false,
  selected = false,
  onStart,
  onStop,
  onSelect,
}: ServiceCardProps) {
  const Icon = kindIcon(service);
  const running = isServiceRunning(service.status);
  const transitional = isServiceBusy(service.status) || busy;
  const detail = serviceStatusDetail(service.status);
  const canStart =
    !transitional &&
    !running &&
    service.status.status !== "unavailable" &&
    service.binary_present;
  const canStop = !transitional && (running || service.status.status === "unhealthy");

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-card p-4 text-left transition-all hover:shadow-sm",
        selected
          ? "border-primary/50 ring-1 ring-primary/30"
          : "border-border/60 hover:border-border",
      )}
    >
      {/* Selectable header — not a nested button around Start/Stop */}
      <button
        type="button"
        onClick={() => onSelect(service.id)}
        className="mb-3 flex w-full items-start justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-pressed={selected}
        aria-label={`Select ${service.label} for logs`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-tight">{service.label}</h3>
            <p className="truncate text-xs text-muted-foreground">{service.id}</p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn("shrink-0 text-[10px] px-1.5 py-0", statusBadgeClass(service.status))}
        >
          {transitional && <Loader2 className="mr-0.5 h-2.5 w-2.5 animate-spin" />}
          {serviceStatusLabel(service.status)}
        </Badge>
      </button>

      {detail && (
        <p className="mb-3 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
          <span className="line-clamp-2">{detail}</span>
        </p>
      )}

      {!service.binary_present && (
        <p className="mb-3 text-[11px] text-muted-foreground">Binary not found</p>
      )}

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={!canStart}
          onClick={() => onStart(service.id)}
        >
          {busy && !running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          Start
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={!canStop}
          onClick={() => onStop(service.id)}
        >
          {busy && running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Square className="h-3 w-3" />
          )}
          Stop
        </Button>
      </div>
    </div>
  );
}
