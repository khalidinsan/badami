import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  Loader2,
  Network,
  RotateCw,
  ShieldCheck,
  Stethoscope,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalDevStore } from "@/stores/localDevStore";
import { computeDnsSetup, DEFAULT_LOCAL_DEV_SETTINGS } from "@/types/localDev";

interface InfraStripProps {
  /** Jump to the Doctor tab (full diagnostics). */
  onOpenDoctor: () => void;
  /** Jump to Settings, where the LaunchDaemon bootstrap lives. */
  onOpenBootstrap: () => void;
}

/**
 * Always-visible infrastructure row: DNS and the HTTP listen mode.
 *
 * Neither is a daily service. Herd and Valet both set DNS up once at install and
 * never expose a toggle — and here `dnsmasq` daemonizes, so it already outlives
 * the app. So DNS gets a **state with one next action**, not Start/Stop. Same for
 * the port: `:8080` vs `:80` is a standing property of the install.
 */
export function InfraStrip({ onOpenDoctor, onOpenBootstrap }: InfraStripProps) {
  const services = useLocalDevStore((s) => s.services);
  const settings = useLocalDevStore((s) => s.settings);
  const sitesResult = useLocalDevStore((s) => s.sitesResult);
  const bootstrapStatus = useLocalDevStore((s) => s.bootstrapStatus);
  const dnsProbe = useLocalDevStore((s) => s.dnsProbe);
  const serviceBusy = useLocalDevStore((s) => s.serviceBusy);
  const fixBusy = useLocalDevStore((s) => s.fixBusy);
  const restartService = useLocalDevStore((s) => s.restartService);
  const startService = useLocalDevStore((s) => s.startService);
  const fixDnsPortMismatch = useLocalDevStore((s) => s.fixDnsPortMismatch);
  const applyHttpPort = useLocalDevStore((s) => s.applyHttpPort);

  const [port80Open, setPort80Open] = useState(false);

  const dns = useMemo(
    () => computeDnsSetup({ services, bootstrap: bootstrapStatus, probe: dnsProbe }),
    [services, bootstrapStatus, dnsProbe],
  );

  const tld = settings.tld || sitesResult?.tld || DEFAULT_LOCAL_DEV_SETTINGS.tld;
  const loopback =
    settings.loopback || sitesResult?.loopback || DEFAULT_LOCAL_DEV_SETTINGS.loopback;
  // The generated conf is the truth about what nginx serves; the setting is only
  // an intent that may not have been applied yet.
  const effectivePort =
    bootstrapStatus?.nginx_listen_port ?? Number(sitesResult?.http_port ?? 8080);
  const modeB = effectivePort === 80;
  const portBusy = !!fixBusy.httpPort;
  const dnsBusy = !!fixBusy.dns || !!serviceBusy["dnsmasq"];

  const ok = dns.kind === "healthy" || dns.kind === "adopted";

  const dnsText = (() => {
    switch (dns.kind) {
      case "healthy":
        return `*.${tld} → ${loopback}`;
      case "adopted":
        return `*.${tld} resolved by an existing listener`;
      case "port_mismatch":
        return `resolver wants :${dns.resolverPort}, dnsmasq.conf binds :${dns.confPort}`;
      case "not_running":
        return "dnsmasq is not running";
      case "no_resolver":
        return `${dns.resolverPath} missing`;
      case "no_binary":
        return "dnsmasq binary not found";
      default:
        return "not resolving";
    }
  })();

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/40 bg-muted/20 px-4 py-2.5">
      {/* DNS — a state, not a switch */}
      <div className="flex min-w-0 items-center gap-2">
        <Network className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {ok ? (
          <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
        ) : (
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
        )}
        <span className="text-[11px] font-medium">DNS</span>
        <span className="truncate text-[11px] text-muted-foreground">{dnsText}</span>
      </div>

      <div className="flex items-center gap-1">
        {/* One action per state. No Start/Stop pair. */}
        {dns.kind === "port_mismatch" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                disabled={dnsBusy}
                onClick={() => void fixDnsPortMismatch()}
              >
                {dnsBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Wrench className="h-3 w-3" />
                )}
                Fix DNS
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[10px]">
              Rewrites dnsmasq.conf to bind :{dns.resolverPort}, matching the
              resolver file macOS already reads, then restarts dnsmasq. No admin
              password needed.
            </TooltipContent>
          </Tooltip>
        )}
        {dns.kind === "not_running" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={dnsBusy}
            onClick={() => void startService("dnsmasq")}
          >
            {dnsBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCw className="h-3 w-3" />
            )}
            Start DNS
          </Button>
        )}
        {dns.kind === "no_resolver" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={onOpenBootstrap}
              >
                <Wrench className="h-3 w-3" />
                Set up DNS
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-[10px]">
              Writing {dns.kind === "no_resolver" ? dns.resolverPath : "the resolver file"} needs
              one admin prompt. After that DNS stays set up.
            </TooltipContent>
          </Tooltip>
        )}
        {/* Recovery only — an unhealthy dnsmasq refuses a plain start. */}
        {dns.kind === "healthy" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                aria-label="Restart dnsmasq"
                disabled={dnsBusy}
                onClick={() => void restartService("dnsmasq")}
              >
                <RotateCw className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              Restart dnsmasq
            </TooltipContent>
          </Tooltip>
        )}
        {!ok && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={onOpenDoctor}
          >
            <Stethoscope className="h-3 w-3" />
            Diagnose
          </Button>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          {modeB ? (
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Globe2 className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-[11px] font-medium">HTTP</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {loopback}:{effectivePort} ({modeB ? "Mode B" : "Mode A"})
          </span>
        </div>
        {modeB ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={portBusy}
            onClick={() => void applyHttpPort(8080)}
          >
            {portBusy && <Loader2 className="h-3 w-3 animate-spin" />}
            Back to :8080
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={portBusy}
            onClick={() => setPort80Open(true)}
          >
            {portBusy && <Loader2 className="h-3 w-3 animate-spin" />}
            Enable port 80
          </Button>
        )}
      </div>

      <AlertDialog open={port80Open} onOpenChange={setPort80Open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Serve on port 80?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                <p>Site URLs drop the <code className="font-mono">:{effectivePort}</code> suffix. Badami will:</p>
                <ol className="list-inside list-decimal space-y-0.5 text-muted-foreground">
                  <li>set the HTTP port to 80</li>
                  <li>regenerate nginx and FPM config (nginx runs as root on :80)</li>
                  <li>
                    re-emit every isolated site&apos;s conf — each carries its own
                    listen port, and missing this is what strands them on the old
                    one
                  </li>
                  <li>restart nginx if it is running</li>
                </ol>
                <p>
                  macOS blocks unprivileged binds below 1024, so :80 also needs the
                  nginx LaunchDaemon from Settings. If it is not installed yet you
                  will be told, and each start will ask for a password until it is.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction className="text-xs" onClick={() => void applyHttpPort(80)}>
              Switch to :80
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
