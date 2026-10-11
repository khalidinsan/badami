import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Rocket,
  RotateCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalDevStore } from "@/stores/localDevStore";
import type {
  BootstrapPackageId,
  BootstrapUninstallPackageId,
} from "@/types/localDev";

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
  {
    id: "resync",
    label: "Resync (Mode B)",
    description:
      "Re-copies user-side nginx + dnsmasq configs into the root staging dir. Needed after isolate / secure site changes under Mode B — root-staged nginx cannot see files inside your home directory.",
  },
];

type UninstallKind = BootstrapUninstallPackageId;

const UNINSTALL_PACKAGES: { id: UninstallKind; label: string; description: string }[] = [
  {
    id: "dns_only",
    label: "DNS unit",
    description: "Unload + remove the Badami dnsmasq LaunchDaemon and its root staging dir.",
  },
  {
    id: "http_80",
    label: "HTTP :80 unit",
    description:
      "Unload + remove the Badami nginx LaunchDaemon. Mode A on :8080 keeps running.",
  },
  {
    id: "full",
    label: "DNS + HTTP units",
    description: "Both LaunchDaemons at once — leaves the resolver file alone by default.",
  },
  {
    id: "resolver",
    label: "/etc/resolver only",
    description:
      "Removes /etc/resolver/<tld>. Protected by the `# managed-by: badami` marker unless you tick the opt-in below.",
  },
];

export function BootstrapCard() {
  const bootstrapStatus = useLocalDevStore((s) => s.bootstrapStatus);
  const bootstrapResult = useLocalDevStore((s) => s.bootstrapResult);
  const bootstrapUninstallResult = useLocalDevStore((s) => s.bootstrapUninstallResult);
  const bootstrapBusy = useLocalDevStore((s) => s.bootstrapBusy);
  const settings = useLocalDevStore((s) => s.settings);
  const loadBootstrapStatus = useLocalDevStore((s) => s.loadBootstrapStatus);
  const bootstrapInstall = useLocalDevStore((s) => s.bootstrapInstall);
  const bootstrapUninstall = useLocalDevStore((s) => s.bootstrapUninstall);

  const [pkg, setPkg] = useState<BootstrapPackageId>("dns_only");
  const [uninstallOpen, setUninstallOpen] = useState<UninstallKind | null>(null);
  /**
   * Opt-in required for removing a resolver file that does **not** carry the
   * `# managed-by: badami` marker (or a hand-rolled one). Separate from
   * the AlertDialog `confirm` button so the user has to physically agree
   * before the dangerous argv is included in the admin prompt.
   */
  const [confirmResolver, setConfirmResolver] = useState(false);

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

  const uninstallMeta = useMemo(
    () => (uninstallOpen ? UNINSTALL_PACKAGES.find((p) => p.id === uninstallOpen) : null),
    [uninstallOpen],
  );
  const isResolverUninstall = uninstallOpen === "resolver";

  return (
    <Card className="py-4">
      <CardHeader className="px-4 pb-2 pt-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Rocket className="h-4 w-4" />
          Mode B / DNS bootstrap
        </CardTitle>
        <CardDescription className="text-xs">
          Port 80 needs an elevated helper. Scaffold writes plists;
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
            ) : pkg === "resync" ? (
              <RotateCw className="h-3.5 w-3.5" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            {pkg === "resync" ? "Resync with admin…" : "Install with admin…"}
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
            macOS blocks non-root processes from binding :80, so this installs a
            LaunchDaemon with a privileged helper.
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

        {/* ── Uninstall section ─────────────────────────────────────── */}
        <div className="rounded-lg border border-border/60 bg-background/40 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-medium">Uninstall</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Removes only Badami-written LaunchDaemon labels and the root staging dir under{" "}
                <code className="font-mono">/Library/Application Support/Badami/local-dev-root/</code>.
              </p>
            </div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {UNINSTALL_PACKAGES.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant="outline"
                className="h-auto justify-start gap-2 whitespace-normal py-2 text-left text-[11px]"
                disabled={bootstrapBusy}
                onClick={() => {
                  setConfirmResolver(false);
                  setUninstallOpen(item.id);
                }}
              >
                <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <span className="flex-1">
                  <span className="block font-medium">{item.label}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {item.description}
                  </span>
                </span>
              </Button>
            ))}
          </div>
          {bootstrapUninstallResult && (
            <div className="mt-2 rounded-lg border border-border/50 bg-muted/20 p-3 text-xs">
              <p className="mb-1 font-medium">
                Last uninstall · {bootstrapUninstallResult.package}
                {bootstrapUninstallResult.dry_run ? " (dry-run)" : ""}
                {bootstrapUninstallResult.executed ? " · executed" : " · pending admin"}
              </p>
              {bootstrapUninstallResult.labels.length > 0 && (
                <p className="mb-1 text-[11px] text-muted-foreground">
                  Labels: {bootstrapUninstallResult.labels.join(" · ")}
                </p>
              )}
              {bootstrapUninstallResult.steps.length > 0 && (
                <pre className="max-h-32 overflow-auto rounded bg-[#0d1117] p-2 font-mono text-[10px] text-[#c9d1d9]">
                  {bootstrapUninstallResult.steps.join("\n")}
                </pre>
              )}
            </div>
          )}
        </div>
      </CardContent>

      <AlertDialog
        open={uninstallOpen !== null}
        onOpenChange={(open) => {
          if (!open) {
            setUninstallOpen(null);
            setConfirmResolver(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Uninstall {uninstallMeta?.label ?? "package"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                <p>{uninstallMeta?.description}</p>
                <p className="text-muted-foreground">
                  macOS will prompt once for your administrator password. Rust composes the
                  argv locally — no user-writable script is executed as root.
                </p>
                {isResolverUninstall && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2">
                    <p className="font-medium text-amber-900 dark:text-amber-100">
                      Resolver files not written by Badami are protected
                    </p>
                    <p className="mt-0.5 text-amber-800/90 dark:text-amber-200/90">
                      <code className="font-mono">/etc/resolver/{settings.tld || "test"}</code>{" "}
                      is removed only when it carries the{" "}
                      <code className="font-mono"># managed-by: badami</code> marker. Tick the
                      box below to force removal, which is what a hand-rolled resolver file uses
                      too.
                    </p>
                    <label className="mt-2 flex items-start gap-2 text-amber-900 dark:text-amber-100">
                      <Checkbox
                        checked={confirmResolver}
                        onCheckedChange={(v) => setConfirmResolver(v === true)}
                        className="mt-0.5"
                      />
                      <span className="text-[11px]">
                        Remove the resolver file even without the Badami marker (my choice)
                      </span>
                    </label>
                  </div>
                )}
                {(uninstallOpen === "dns_only" || uninstallOpen === "full") && (
                  <p className="text-muted-foreground">
                    After uninstall, Badami will reset{" "}
                    <code className="font-mono">dns_bootstrap_complete=false</code>.
                  </p>
                )}
                {(uninstallOpen === "http_80" || uninstallOpen === "full") && (
                  <p className="text-muted-foreground">
                    After uninstall, Badami will step the HTTP tier back to Mode A{" "}
                    <code className="font-mono">:8080</code> (unprivileged).
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="text-xs"
              disabled={bootstrapBusy || (isResolverUninstall && !confirmResolver)}
              onClick={() => {
                if (!uninstallOpen) return;
                const pkgId = uninstallOpen;
                setUninstallOpen(null);
                const resolverFlag = confirmResolver;
                setConfirmResolver(false);
                void bootstrapUninstall({
                  package: pkgId,
                  dry_run: false,
                  confirm_resolver: resolverFlag,
                });
              }}
            >
              Uninstall
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
