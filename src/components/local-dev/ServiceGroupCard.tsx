import { useState } from "react";
import {
  ChevronDown,
  Database,
  Globe,
  Loader2,
  Network,
  Play,
  RotateCw,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ServiceRow } from "@/components/local-dev/ServiceRow";
import { PhpPoolRow } from "@/components/local-dev/PhpPoolRow";
import { cn } from "@/lib/utils";
import type { GroupSummary, ServiceGroupId, ServiceStatusReport } from "@/types/localDev";
import { isServiceRunning, phpVersionOf } from "@/types/localDev";

interface ServiceGroupCardProps {
  summary: GroupSummary;
  required: Set<string>;
  busy: boolean;
  serviceBusy: Record<string, boolean>;
  selectedServiceId: string | null;
  onStartGroup: (group: ServiceGroupId) => void;
  onStopGroup: (group: ServiceGroupId) => void;
  onRestartGroup: (group: ServiceGroupId) => void;
  onStartService: (id: string) => void;
  onStopService: (id: string) => void;
  onRestartService: (id: string) => void;
  onSelectService: (id: string) => void;
}

interface GroupMeta {
  title: string;
  blurb: string;
  icon: typeof Globe;
}

const GROUP_META: Record<ServiceGroupId, GroupMeta> = {
  // One control rather than two, because half-started is always broken.
  web: {
    title: "Web",
    blurb: "nginx + PHP-FPM — nginx without a pool returns 502, so they move together",
    icon: Globe,
  },
  data: {
    title: "Data",
    blurb: "MariaDB + Redis — independent, so the DB can stay up while web is down",
    icon: Database,
  },
  dns: {
    title: "DNS",
    blurb: "dnsmasq — shared infrastructure",
    icon: Network,
  },
};

function countTone(summary: GroupSummary): string {
  if (summary.requiredTotal === 0) return "text-muted-foreground";
  if (summary.healthy) return "text-emerald-700 dark:text-emerald-400";
  if (summary.requiredRunning === 0) return "text-muted-foreground";
  return "text-amber-700 dark:text-amber-400";
}

export function ServiceGroupCard({
  summary,
  required,
  busy,
  serviceBusy,
  selectedServiceId,
  onStartGroup,
  onStopGroup,
  onRestartGroup,
  onStartService,
  onStopService,
  onRestartService,
  onSelectService,
}: ServiceGroupCardProps) {
  const meta = GROUP_META[summary.group];
  const Icon = meta.icon;
  const [showAll, setShowAll] = useState(false);

  // PHP-FPM pools collapse into a single chip row (they run concurrently — one
  // socket per version — so they are a set, not a list of peers).
  const pools = summary.members.filter((s) => phpVersionOf(s) != null);
  const plain = summary.members.filter((s) => phpVersionOf(s) == null);

  /** Rows worth showing unprompted: required, running, or broken. */
  const isPrimary = (s: ServiceStatusReport) =>
    required.has(s.id) ||
    isServiceRunning(s.status) ||
    s.status.status === "unhealthy" ||
    s.status.status === "error";

  const primary = plain.filter(isPrimary);
  const secondary = plain.filter((s) => !isPrimary(s));
  const visible = showAll ? [...primary, ...secondary] : primary;

  const anythingRunning = summary.members.some((s) => isServiceRunning(s.status));
  // Nothing has a usable binary — a Start button here could never do anything,
  // so state the reason instead of rendering a permanently disabled control.
  const nothingStartable = summary.requiredTotal === 0;
  const canStart = !busy && !summary.transitional && !summary.healthy && !nothingStartable;
  const canStop = !busy && !summary.transitional && anythingRunning;
  const canRestart = !busy && !summary.transitional && anythingRunning;

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/40 px-3 py-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{meta.title}</h3>
            {summary.requiredTotal > 0 ? (
              <Badge
                variant="outline"
                className={cn("h-5 px-1.5 text-[10px] tabular-nums", countTone(summary))}
              >
                {summary.requiredRunning}/{summary.requiredTotal}
              </Badge>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="h-5 cursor-default px-1.5 text-[10px] text-amber-700 dark:text-amber-400"
                  >
                    binaries missing
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-[10px]">
                  No binary was found for any service in this group. Set paths in
                  Settings, or run Import from Herd.
                </TooltipContent>
              </Tooltip>
            )}
            {summary.extraRunning > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="h-5 cursor-default px-1.5 text-[10px]">
                    +{summary.extraRunning} extra
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-[10px]">
                  Running but not needed by any site. Counted separately so the
                  required total stays honest.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{meta.blurb}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {canRestart && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  aria-label={`Restart ${meta.title}`}
                  onClick={() => onRestartGroup(summary.group)}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">
                Restart {meta.title}
              </TooltipContent>
            </Tooltip>
          )}
          {canStop && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => onStopGroup(summary.group)}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              Stop
            </Button>
          )}
          {canStart && (
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => onStartGroup(summary.group)}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Start
            </Button>
          )}
          {(busy || summary.transitional) && !canStart && !canStop && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      <div>
        {visible.map((service) => (
          <ServiceRow
            key={service.id}
            service={service}
            required={required.has(service.id)}
            busy={!!serviceBusy[service.id] || busy}
            selected={selectedServiceId === service.id}
            onStart={onStartService}
            onStop={onStopService}
            onRestart={onRestartService}
            onSelect={onSelectService}
          />
        ))}
        {pools.length > 0 && (
          <PhpPoolRow
            pools={pools}
            required={required}
            groupBusy={busy}
            serviceBusy={serviceBusy}
            selectedServiceId={selectedServiceId}
            onStart={onStartService}
            onStop={onStopService}
            onRestart={onRestartService}
            onSelect={onSelectService}
          />
        )}
        {secondary.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex w-full items-center justify-center gap-1 border-t border-border/30 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", showAll && "rotate-180")}
            />
            {showAll
              ? "Hide idle services"
              : `${secondary.length} more service${secondary.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}
