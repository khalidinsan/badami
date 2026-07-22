import { useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  RefreshCw,
  Stethoscope,
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

function FindingRow({ finding }: { finding: DoctorFinding }) {
  const Icon = severityIcon(finding.severity);
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
      </div>
    </div>
  );
}

export function DoctorPanel() {
  const doctorReport = useLocalDevStore((s) => s.doctorReport);
  const doctorBusy = useLocalDevStore((s) => s.doctorBusy);
  const runDoctor = useLocalDevStore((s) => s.runDoctor);
  const loadSettings = useLocalDevStore((s) => s.loadSettings);

  useEffect(() => {
    void loadSettings();
    void runDoctor();
  }, [loadSettings, runDoctor]);

  const report = doctorReport;
  const findings = report?.findings ?? [];
  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;

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
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={doctorBusy}
            onClick={() => void runDoctor()}
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
                  findings.map((f) => <FindingRow key={f.id + f.message} finding={f} />)
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
