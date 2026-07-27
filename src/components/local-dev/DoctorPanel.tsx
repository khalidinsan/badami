import { useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  RefreshCw,
  Stethoscope,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocalDevStore } from "@/stores/localDevStore";
import {
  formatBytes,
  type DoctorFinding,
  type FindingSeverity,
  type MariadbPreflight,
} from "@/types/localDev";
import { cn } from "@/lib/utils";

function mariadbPreflightDetail(result: MariadbPreflight): string {
  switch (result.kind) {
    case "ok_to_start":
      return "Ok to start";
    case "adopt":
      return `Adopt: ${result.reason}`;
    case "hard_fail":
      return result.reason;
  }
}

function severityIcon(severity: FindingSeverity) {
  switch (severity) {
    case "error":
      return XCircle;
    case "warn":
      return AlertTriangle;
    default:
      return Info;
  }
}

function severityClass(severity: FindingSeverity): string {
  switch (severity) {
    case "error":
      return "border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-100";
    case "warn":
      return "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100";
    default:
      return "border-border/60 bg-muted/30 text-foreground";
  }
}

function overallBadge(overall: string) {
  const o = overall.toLowerCase();
  if (o.includes("error") || o === "fail" || o === "failed") {
    return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400";
  }
  if (o.includes("warn")) {
    return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  }
  return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
}

interface FindingFix {
  label: string;
  /** Key into the store's `fixBusy` map, when the action tracks progress. */
  busyKey?: string;
  run: () => void;
}

/**
 * Turn a finding into a button.
 *
 * Doctor already emits stable machine-readable ids plus a prose `hint`; leaving
 * the hint as unclickable text is what made Doctor a tab you had to remember to
 * visit. Ids not listed here stay informational — no fabricated fix.
 */
function fixesFor(finding: DoctorFinding, actions: FixActions): FindingFix[] {
  switch (true) {
    // Specific beats generic: when the two halves of DNS name different ports,
    // the fix is a conf rewrite, not the LaunchDaemon `dns.unhealthy` suggests.
    case finding.id === "dns.port_mismatch":
      return [{ label: "Match resolver port", busyKey: "dns", run: actions.fixDnsPort }];
    case finding.id === "dns.unhealthy" || finding.id === "dns.resolver_without_nameserver":
      return [
        ...(actions.dnsStartable
          ? [{ label: "Start dnsmasq", busyKey: "dnsmasq", run: actions.startDnsmasq }]
          : []),
        { label: "DNS bootstrap…", run: actions.openBootstrap },
      ];
    case finding.id === "nginx.test_failed":
      return [
        { label: "Regenerate configs", busyKey: "configs", run: actions.generateConfigs },
        { label: "View nginx log", run: actions.showNginxLog },
      ];
    case finding.id === "runtime.valet_server.missing":
      return [
        {
          label: "Install runtime resources",
          busyKey: "resources",
          run: actions.installResources,
        },
      ];
    case finding.id === "mariadb.hard_fail":
      // Almost always a live mysqld on the same datadir — usually Herd's.
      return [{ label: "Check Herd processes", run: actions.recheckHerd }];
    case finding.id === "logs.total_large" || finding.id.startsWith("logs.file_large."):
      return [{ label: "Reveal logs folder", run: actions.revealLogs }];
    default:
      return [];
  }
}

interface FixActions {
  dnsStartable: boolean;
  startDnsmasq: () => void;
  fixDnsPort: () => void;
  openBootstrap: () => void;
  generateConfigs: () => void;
  installResources: () => void;
  showNginxLog: () => void;
  recheckHerd: () => void;
  revealLogs: () => void;
}

function FindingRow({
  finding,
  actions,
  fixBusy,
}: {
  finding: DoctorFinding;
  actions: FixActions;
  fixBusy: Record<string, boolean>;
}) {
  const Icon = severityIcon(finding.severity);
  const fixes = fixesFor(finding, actions);
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        severityClass(finding.severity),
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{finding.message}</span>
          <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase">
            {finding.category}
          </Badge>
          <span className="font-mono text-[10px] opacity-60">{finding.id}</span>
        </div>
        {finding.hint && (
          <p className="mt-0.5 text-[11px] opacity-80">{finding.hint}</p>
        )}
        {fixes.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {fixes.map((fix) => {
              const busy = fix.busyKey ? !!fixBusy[fix.busyKey] : false;
              return (
                <Button
                  key={fix.label}
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 bg-background/60 px-2 text-[11px]"
                  disabled={busy}
                  onClick={fix.run}
                >
                  {busy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wrench className="h-3 w-3" />
                  )}
                  {fix.label}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function relativeTime(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

interface DoctorPanelProps {
  /** Jump to Settings, where the DNS / Mode B bootstrap card lives. */
  onOpenBootstrap?: () => void;
  /** Select a service and show the Services tab so its log is visible. */
  onShowServiceLog?: (serviceId: string) => void;
}

export function DoctorPanel({ onOpenBootstrap, onShowServiceLog }: DoctorPanelProps = {}) {
  const doctorReport = useLocalDevStore((s) => s.doctorReport);
  const doctorRanAt = useLocalDevStore((s) => s.doctorRanAt);
  const doctorBusy = useLocalDevStore((s) => s.doctorBusy);
  const fixBusy = useLocalDevStore((s) => s.fixBusy);
  const services = useLocalDevStore((s) => s.services);
  const serviceBusy = useLocalDevStore((s) => s.serviceBusy);
  const runDoctor = useLocalDevStore((s) => s.runDoctor);
  const loadSettings = useLocalDevStore((s) => s.loadSettings);
  const startService = useLocalDevStore((s) => s.startService);
  const restartService = useLocalDevStore((s) => s.restartService);
  const fixDnsPortMismatch = useLocalDevStore((s) => s.fixDnsPortMismatch);
  const generateConfigs = useLocalDevStore((s) => s.generateConfigs);
  const installRuntimeResources = useLocalDevStore((s) => s.installRuntimeResources);
  const revealLogsDir = useLocalDevStore((s) => s.revealLogsDir);
  const loadHerdStatus = useLocalDevStore((s) => s.loadHerdStatus);

  // No `force` on mount: doctor probes ports and shells out to `nginx -t`, so
  // re-running it on every tab visit stalled the panel. The store reuses a
  // report younger than its TTL; the button below always forces.
  useEffect(() => {
    void loadSettings();
    void runDoctor();
  }, [loadSettings, runDoctor]);

  const report = doctorReport;
  const findings = report?.findings ?? [];
  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;

  const dnsService = services.find((s) => s.id === "dnsmasq");
  // An unhealthy service refuses a plain start (see ServiceRow's rule), so the
  // recovery path is restart. Offering "Start" there was a button that could not
  // succeed.
  const dnsNeedsRestart =
    dnsService?.status.status === "unhealthy" ||
    dnsService?.status.status === "starting" ||
    dnsService?.status.status === "stopping";
  const fixActions: FixActions = {
    dnsStartable:
      !!dnsService && dnsService.binary_present && dnsService.status.status !== "running",
    startDnsmasq: () =>
      void (dnsNeedsRestart ? restartService("dnsmasq") : startService("dnsmasq")),
    fixDnsPort: () => void fixDnsPortMismatch(),
    openBootstrap: () => onOpenBootstrap?.(),
    generateConfigs: () => void generateConfigs(),
    installResources: () => void installRuntimeResources(),
    showNginxLog: () => onShowServiceLog?.("nginx"),
    recheckHerd: () => void loadHerdStatus(),
    revealLogs: () => void revealLogsDir(),
  };
  const mergedFixBusy = { ...fixBusy, dnsmasq: !!serviceBusy["dnsmasq"] };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Stethoscope className="h-4 w-4" />
              Doctor
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Read-only diagnostics. Never deletes Herd datadir or invokes the Herd helper.
              {doctorRanAt ? ` · ran ${relativeTime(doctorRanAt)}` : ""}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={doctorBusy}
            onClick={() => void runDoctor({ force: true })}
          >
            {doctorBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Run doctor
          </Button>
        </div>

        {!report && doctorBusy && (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running diagnostics…
          </div>
        )}

        {report && (
          <>
            <Card className="py-4">
              <CardHeader className="px-4 pb-2 pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-sm">Overall</CardTitle>
                  <Badge
                    variant="outline"
                    className={cn("h-5 text-[10px] uppercase", overallBadge(report.overall))}
                  >
                    {report.overall}
                  </Badge>
                  {errors > 0 && (
                    <Badge variant="destructive" className="h-5 text-[10px]">
                      {errors} error{errors === 1 ? "" : "s"}
                    </Badge>
                  )}
                  {warns > 0 && (
                    <Badge variant="secondary" className="h-5 text-[10px]">
                      {warns} warning{warns === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-xs">
                  DNS healthy: {report.dns_healthy ? "yes" : "no"} · MariaDB ready:{" "}
                  {report.ready_for_mariadb_start ? "yes" : "no"}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 px-4 sm:grid-cols-2">
                <CheckLine
                  ok={report.dns_healthy}
                  label="DNS resolve probe"
                  detail={`${report.dns.hostname} → ${report.dns.resolved.join(", ") || "—"} · mode ${report.dns.mode}`}
                />
                <CheckLine
                  ok={report.ready_for_mariadb_start}
                  label="MariaDB preflight"
                  detail={mariadbPreflightDetail(report.mariadb.result)}
                />
                <CheckLine
                  ok={report.nginx_test.ok || !report.nginx_test.ran}
                  label="nginx -t"
                  detail={
                    report.nginx_test.ran
                      ? report.nginx_test.ok
                        ? "Config OK"
                        : report.nginx_test.stderr || "Failed"
                      : report.nginx_test.skip_reason || "Skipped"
                  }
                />
                <CheckLine
                  ok={!report.logs.total_warn}
                  label="Log directory size"
                  detail={`${formatBytes(report.logs.total_bytes)} · ${report.logs.logs_dir}`}
                />
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardHeader className="px-4 pb-2 pt-0">
                <CardTitle className="text-sm">Checklist · findings</CardTitle>
                <CardDescription className="text-xs">
                  Grouped machine-readable ids for repair guidance
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 px-4">
                {findings.length === 0 ? (
                  <p className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    No findings
                  </p>
                ) : (
                  findings.map((f) => (
                    <FindingRow
                      key={f.id + f.message}
                      finding={f}
                      actions={fixActions}
                      fixBusy={mergedFixBusy}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardHeader className="px-4 pb-2 pt-0">
                <CardTitle className="text-sm">Binaries & ports</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-4">
                <div className="flex flex-wrap gap-1.5">
                  {report.binaries.map((b) => (
                    <Badge
                      key={b.service_id}
                      variant={b.present ? "secondary" : "outline"}
                      className={cn(
                        "h-5 text-[10px]",
                        !b.present && "border-red-500/40 text-red-700 dark:text-red-400",
                      )}
                      title={b.path ?? undefined}
                    >
                      {b.role}
                      {b.present ? "" : " · missing"}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {report.ports.map((p) => (
                    <Badge
                      key={`${p.port}-${p.label}`}
                      variant="outline"
                      className="h-5 text-[10px]"
                    >
                      :{p.port} {p.label}
                      {p.listening ? " · listening" : ""}
                    </Badge>
                  ))}
                </div>
                {report.herd_helper.present && (
                  <p className="text-[11px] text-muted-foreground">
                    Herd helper present at {report.herd_helper.path} — reported only, never
                    invoked. {report.herd_helper.note}
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function CheckLine({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        )}
        {label}
      </div>
      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}
