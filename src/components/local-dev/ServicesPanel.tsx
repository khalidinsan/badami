import { Play, Square, Loader2, RefreshCw, HardDrive, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ServiceCard } from "@/components/local-dev/ServiceCard";
import { useLocalDevStore } from "@/stores/localDevStore";
import { isServiceRunning } from "@/types/localDev";

export function ServicesPanel() {
  const services = useLocalDevStore((s) => s.services);
  const stackBusy = useLocalDevStore((s) => s.stackBusy);
  const serviceBusy = useLocalDevStore((s) => s.serviceBusy);
  const selectedServiceId = useLocalDevStore((s) => s.selectedServiceId);
  const loading = useLocalDevStore((s) => s.loading);
  const error = useLocalDevStore((s) => s.error);
  const startService = useLocalDevStore((s) => s.startService);
  const stopService = useLocalDevStore((s) => s.stopService);
  const startStack = useLocalDevStore((s) => s.startStack);
  const stopStack = useLocalDevStore((s) => s.stopStack);
  const refreshStatus = useLocalDevStore((s) => s.refreshStatus);
  const setSelectedServiceId = useLocalDevStore((s) => s.setSelectedServiceId);

  const runningCount = services.filter((s) => isServiceRunning(s.status)).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Services</span>
          {services.length > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {runningCount}/{services.length} running
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs"
            disabled={stackBusy}
            onClick={() => void refreshStatus()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={stackBusy}
            onClick={() => void startStack()}
          >
            {stackBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Start stack
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={stackBusy}
            onClick={() => void stopStack()}
          >
            {stackBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            Stop stack
          </Button>
        </div>
      </div>

      {error && services.length > 0 && (
        <div className="flex items-start gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-800 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Last status refresh failed</p>
            <p className="mt-0.5 break-words opacity-90">{error}</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2 text-[11px]"
            onClick={() => void refreshStatus()}
          >
            Retry
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {services.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <HardDrive className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="mb-1 text-sm font-medium text-muted-foreground">
              {loading
                ? "Discovering services…"
                : error
                  ? "Could not load services"
                  : "No services reported"}
            </p>
            {error ? (
              <p className="mb-4 max-w-md break-words text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : (
              <p className="mb-4 max-w-sm text-xs text-muted-foreground/70">
                Status comes from the local-dev supervisor. Install runtime resources and generate
                configs if services stay empty.
              </p>
            )}
            <Button size="sm" variant="outline" onClick={() => void refreshStatus()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Retry status
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                busy={!!serviceBusy[service.id] || stackBusy}
                selected={selectedServiceId === service.id}
                onStart={(id) => void startService(id)}
                onStop={(id) => void stopService(id)}
                onSelect={setSelectedServiceId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
