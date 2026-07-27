import { useMemo } from "react";
import { AlertTriangle, HardDrive, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServiceGroupCard } from "@/components/local-dev/ServiceGroupCard";
import { StackHeroBar } from "@/components/local-dev/StackHeroBar";
import { InfraStrip } from "@/components/local-dev/InfraStrip";
import { useLocalDevStore } from "@/stores/localDevStore";
import { computeStackHealth, DEFAULT_LOCAL_DEV_SETTINGS } from "@/types/localDev";

interface ServicesPanelProps {
  onOpenDoctor: () => void;
  onOpenBootstrap: () => void;
}

export function ServicesPanel({ onOpenDoctor, onOpenBootstrap }: ServicesPanelProps) {
  const services = useLocalDevStore((s) => s.services);
  const sitesResult = useLocalDevStore((s) => s.sitesResult);
  const settings = useLocalDevStore((s) => s.settings);
  const dnsProbe = useLocalDevStore((s) => s.dnsProbe);
  const bootstrapStatus = useLocalDevStore((s) => s.bootstrapStatus);
  const stackBusy = useLocalDevStore((s) => s.stackBusy);
  const serviceBusy = useLocalDevStore((s) => s.serviceBusy);
  const groupBusy = useLocalDevStore((s) => s.groupBusy);
  const selectedServiceId = useLocalDevStore((s) => s.selectedServiceId);
  const loading = useLocalDevStore((s) => s.loading);
  const error = useLocalDevStore((s) => s.error);
  const startService = useLocalDevStore((s) => s.startService);
  const stopService = useLocalDevStore((s) => s.stopService);
  const restartService = useLocalDevStore((s) => s.restartService);
  const startGroup = useLocalDevStore((s) => s.startGroup);
  const stopGroup = useLocalDevStore((s) => s.stopGroup);
  const restartGroup = useLocalDevStore((s) => s.restartGroup);
  const startStack = useLocalDevStore((s) => s.startStack);
  const stopStack = useLocalDevStore((s) => s.stopStack);
  const refreshStatus = useLocalDevStore((s) => s.refreshStatus);
  const setSelectedServiceId = useLocalDevStore((s) => s.setSelectedServiceId);

  // Derived, never stored — cannot go stale against services/sites/settings.
  const health = useMemo(
    () =>
      computeStackHealth({
        services,
        sites: sitesResult?.sites ?? [],
        defaultPhpVersion:
          settings.default_php_version || DEFAULT_LOCAL_DEV_SETTINGS.default_php_version,
        dnsProbe,
        bootstrap: bootstrapStatus,
      }),
    [services, sitesResult, settings, dnsProbe, bootstrapStatus],
  );

  const anyBusy = stackBusy || Object.keys(serviceBusy).length > 0;

  if (services.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
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
            Status comes from the local-dev supervisor. Import from Herd, then install runtime
            resources and generate configs if services stay empty.
          </p>
        )}
        <Button size="sm" variant="outline" onClick={() => void refreshStatus()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Retry status
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <StackHeroBar
        health={health}
        stackBusy={stackBusy}
        anyBusy={anyBusy}
        onStartStack={() => void startStack()}
        onStopStack={() => void stopStack()}
        onRefresh={() => void refreshStatus()}
      />

      {error && (
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

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-3">
          {(["web", "data"] as const).map((group) => {
            const summary = group === "web" ? health.web : health.data;
            if (summary.members.length === 0) return null;
            return (
              <ServiceGroupCard
                key={group}
                summary={summary}
                required={health.requiredIds}
                busy={!!groupBusy[group] || stackBusy}
                serviceBusy={serviceBusy}
                selectedServiceId={selectedServiceId}
                onStartGroup={(g) => void startGroup(g)}
                onStopGroup={(g) => void stopGroup(g)}
                onRestartGroup={(g) => void restartGroup(g)}
                onStartService={(id) => void startService(id)}
                onStopService={(id) => void stopService(id)}
                onRestartService={(id) => void restartService(id)}
                onSelectService={setSelectedServiceId}
              />
            );
          })}
        </div>
      </div>

      <InfraStrip onOpenDoctor={onOpenDoctor} onOpenBootstrap={onOpenBootstrap} />
    </div>
  );
}
