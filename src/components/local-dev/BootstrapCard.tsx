import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Rocket,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalDevStore } from "@/stores/localDevStore";
import type { BootstrapPackageId } from "@/types/localDev";

const PACKAGES: { id: BootstrapPackageId; label: string; description: string }[] = [
  {
    id: "dns_only",
    label: "DNS only (D1 B-lite)",
    description: "dnsmasq LaunchDaemon on :53 — recommended first for hostname URLs",
  },
  {
    id: "dns_high_port",
    label: "DNS high-port (D2)",
    description: "Unprivileged dnsmasq + high-port resolver draft",
  },
  {
    id: "http_80",
    label: "HTTP :80 (Mode B)",
    description: "nginx LaunchDaemon on privileged port 80",
  },
  {
    id: "full",
    label: "Full (DNS + HTTP)",
    description: "dns_only + http_80 packages",
  },
];

export function BootstrapCard() {
  const bootstrapStatus = useLocalDevStore((s) => s.bootstrapStatus);
  const bootstrapResult = useLocalDevStore((s) => s.bootstrapResult);
  const bootstrapBusy = useLocalDevStore((s) => s.bootstrapBusy);
  const settings = useLocalDevStore((s) => s.settings);
  const loadBootstrapStatus = useLocalDevStore((s) => s.loadBootstrapStatus);
  const bootstrapInstall = useLocalDevStore((s) => s.bootstrapInstall);

  const [pkg, setPkg] = useState<BootstrapPackageId>("dns_only");

  useEffect(() => {
    void loadBootstrapStatus(settings.tld || undefined);
  }, [loadBootstrapStatus, settings.tld]);

  useEffect(() => {
    if (bootstrapStatus?.recommended_package) {
      const rec = bootstrapStatus.recommended_package as BootstrapPackageId;
      if (PACKAGES.some((p) => p.id === rec)) setPkg(rec);
    }
  }, [bootstrapStatus?.recommended_package]);

  const status = bootstrapStatus;

  return (
    <Card className="py-4">
      <CardHeader className="px-4 pb-2 pt-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Rocket className="h-4 w-4" />
          Mode B / DNS bootstrap
        </CardTitle>
        <CardDescription className="text-xs">
          Port 80 needs the same kind of elevated helper Herd uses. Scaffold writes plists;
          <strong> Install with admin</strong> registers a Badami LaunchDaemon so Start/Stop
          nginx from the Services tab works without a password every time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        {status && (
          <div className="grid gap-2 sm:grid-cols-2">
            <UnitStatus
              title="dnsmasq unit"
              loaded={status.dnsmasq.loaded}
              systemPresent={status.dnsmasq.system_plist_present}
              scaffold={status.dnsmasq.scaffold_present}
              complete={status.dns_bootstrap_complete}
            />
            <UnitStatus
              title="nginx unit"
              loaded={status.nginx.loaded}
              systemPresent={status.nginx.system_plist_present}
              scaffold={status.nginx.scaffold_present}
              complete={status.http_bootstrap_complete}
            />
            <div className="rounded-lg border border-border/50 px-3 py-2 text-xs sm:col-span-2">
              <p className="font-medium">Resolver</p>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {status.resolver_path}
                {status.resolver_present
                  ? ` · present${status.resolver_port != null ? ` · port ${status.resolver_port}` : ""}`
                  : " · missing"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Recommended package:{" "}
                <Badge variant="secondary" className="h-5 text-[10px]">
                  {status.recommended_package}
                </Badge>
              </p>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-xs font-medium">Package</p>
          <Select value={pkg} onValueChange={(v) => setPkg(v as BootstrapPackageId)}>
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PACKAGES.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {PACKAGES.find((p) => p.id === pkg)?.description}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={bootstrapBusy}
            onClick={() =>
              void bootstrapInstall({
                package: pkg,
                dry_run: false,
                attempt_privileged_install: true,
              })
            }
          >
            {bootstrapBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            Install with admin…
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={bootstrapBusy}
            onClick={() =>
              void bootstrapInstall({
                package: pkg,
                dry_run: true,
                attempt_privileged_install: false,
              })
            }
          >
            {bootstrapBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            Scaffold only
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={bootstrapBusy}
            onClick={() => void loadBootstrapStatus(settings.tld || undefined)}
          >
            Refresh status
          </Button>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            macOS blocks non-root processes from binding :80. Herd solves this with a privileged
            helper; Badami installs its <strong>own</strong> LaunchDaemon (never Herd&apos;s).
            Until installed, Start nginx on :80 will prompt for admin password each time.
          </p>
        </div>

        {bootstrapResult && (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-xs">
            <p className="mb-1 font-medium">
              Last scaffold · {bootstrapResult.package}
              {bootstrapResult.dry_run ? " (dry-run)" : ""}
            </p>
            {bootstrapResult.written.length > 0 && (
              <ul className="mb-2 max-h-24 list-inside list-disc overflow-auto font-mono text-[10px] text-muted-foreground">
                {bootstrapResult.written.map((w) => (
                  <li key={w} className="truncate" title={w}>
                    {w}
                  </li>
                ))}
              </ul>
            )}
            {bootstrapResult.install_instructions.length > 0 && (
              <ol className="mb-2 list-inside list-decimal space-y-0.5 text-[11px] text-muted-foreground">
                {bootstrapResult.install_instructions.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            )}
            {bootstrapResult.install_command && (
              <pre className="overflow-auto rounded bg-[#0d1117] p-2 font-mono text-[10px] text-[#c9d1d9]">
                {bootstrapResult.install_command}
              </pre>
            )}
          </div>
        )}

        {status?.notes && status.notes.length > 0 && (
          <ul className="list-inside list-disc text-[11px] text-muted-foreground">
            {status.notes.slice(0, 3).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function UnitStatus({
  title,
  loaded,
  systemPresent,
  scaffold,
  complete,
}: {
  title: string;
  loaded: boolean;
  systemPresent: boolean;
  scaffold: boolean;
  complete: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/50 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        {complete ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        {title}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        scaffold {scaffold ? "yes" : "no"} · system plist {systemPresent ? "yes" : "no"} · loaded{" "}
        {loaded ? "yes" : "no"}
      </p>
    </div>
  );
}
