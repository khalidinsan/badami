import { useEffect, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  Database,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useLocalDevStore } from "@/stores/localDevStore";

/** Human label per role, kept short so the row fits at narrow widths. */
const ROLE_LABEL: Record<string, string> = {
  nginx: "nginx",
  php: "PHP",
  mariadb: "MariaDB",
  redis: "Redis",
  dnsmasq: "dnsmasq",
};

function bytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function shorten(path: string, max = 48): string {
  if (path.length <= max) return path;
  return `…${path.slice(-(max - 3))}`;
}

/**
 * Runtime panel inside Settings: the binaries and database files this machine
 * runs, and the controls to add, switch, or remove a version.
 */
export function RuntimeCard() {
  const provisionStatus = useLocalDevStore((s) => s.provisionStatus);
  const provisionBusy = useLocalDevStore((s) => s.provisionBusy);
  const updateSources = useLocalDevStore((s) => s.updateSources);
  const migrationPreflight = useLocalDevStore((s) => s.migrationPreflight);
  const migrationResult = useLocalDevStore((s) => s.migrationResult);
  const loadProvisionStatus = useLocalDevStore((s) => s.loadProvisionStatus);
  const loadUpdateSources = useLocalDevStore((s) => s.loadUpdateSources);
  const loadDatadirPreflight = useLocalDevStore((s) => s.loadDatadirPreflight);
  const selectRuntimeVersion = useLocalDevStore((s) => s.selectRuntimeVersion);
  const uninstallRuntimeVersion = useLocalDevStore((s) => s.uninstallRuntimeVersion);
  const installRuntimeFromUpstream = useLocalDevStore((s) => s.installRuntimeFromUpstream);

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ role: string; version: string } | null>(
    null,
  );

  useEffect(() => {
    void loadProvisionStatus();
    void loadUpdateSources();
    void loadDatadirPreflight();
  }, [loadProvisionStatus, loadUpdateSources, loadDatadirPreflight]);

  const roles = provisionStatus?.roles ?? [];
  const ownedCount = roles.reduce((sum, r) => sum + r.installed.length, 0);
  const unverified = roles.flatMap((r) =>
    r.installed.filter((v) => !v.verified).map((v) => `${r.role} ${v.version}`),
  );
  const preflight = migrationPreflight;

  /** Sources not already installed, so the picker never offers a no-op. */
  const installable = updateSources.filter(
    (source) =>
      !roles.some(
        (r) => r.role === source.role && r.installed.some((v) => v.version === source.version),
      ),
  );

  return (
    <Card className="py-4">
      <CardHeader className="px-4 pb-2 pt-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Boxes className="h-4 w-4" />
          Runtime
        </CardTitle>
        <CardDescription className="text-xs">
          The service binaries and database files this machine runs. Add a version,
          switch the one in use, or remove what you no longer need.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={ownedCount > 0 ? "secondary" : "outline"} className="text-[10px]">
            {ownedCount} version{ownedCount === 1 ? "" : "s"} installed
          </Badge>
          {unverified.length > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {unverified.length} failed verification
            </Badge>
          )}
          <Button
            size="sm"
            className="ml-auto h-8 gap-1.5 text-xs"
            disabled={provisionBusy}
            onClick={() => setAddOpen(true)}
          >
            {provisionBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Add version
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs"
            disabled={provisionBusy}
            onClick={() => {
              void loadProvisionStatus();
              void loadUpdateSources();
              void loadDatadirPreflight();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {ownedCount === 0 && (
          <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
            No binaries installed yet. Add a version to get the local stack running.
          </div>
        )}

        {roles.length > 0 && (
          <div className="space-y-2">
            {roles.map((role) => (
              <div key={role.role} className="rounded-lg border border-border/50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-medium">
                    {ROLE_LABEL[role.role] ?? role.role}
                  </span>
                  {role.installed.length === 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {role.missing_reason ?? "not installed"}
                    </span>
                  )}
                </div>

                {role.installed.length > 0 && (
                  <ul className="space-y-1">
                    {role.installed.map((version) => (
                      <li key={version.version} className="flex items-center gap-2 text-xs">
                        {version.verified ? (
                          <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
                        ) : (
                          <XCircle className="h-3 w-3 shrink-0 text-red-600" />
                        )}
                        <span className="font-mono">{version.version}</span>
                        {version.selected && (
                          <Badge variant="secondary" className="text-[9px]">
                            in use
                          </Badge>
                        )}
                        {!version.verified && (
                          <span className="text-[10px] text-red-600">
                            file changed, add it again
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-1">
                          {!version.selected && version.verified && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[10px]"
                              onClick={() =>
                                void selectRuntimeVersion(role.role, version.version)
                              }
                            >
                              Use
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            aria-label={`Remove ${role.role} ${version.version}`}
                            onClick={() =>
                              setRemoveTarget({ role: role.role, version: version.version })
                            }
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-border/40 pt-3">
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Database files</span>
          </div>

          {preflight ? (
            <div className="space-y-2">
              <div className="rounded-md border border-border/50 px-3 py-2">
                <p className="truncate font-mono text-[11px]" title={preflight.dest}>
                  {shorten(preflight.dest)}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {bytes(preflight.source_bytes)}
                  {preflight.source_running && " · in use by a running server"}
                </p>
              </div>

              {preflight.warnings.length > 0 && (
                <ul className="list-inside list-disc text-[10px] text-muted-foreground">
                  {preflight.warnings.slice(0, 3).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Checking where the database lives…
            </p>
          )}

          {migrationResult && !migrationResult.ok && (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100">
              <p className="font-medium">Some files did not verify</p>
              <ul className="mt-1 list-inside list-disc">
                {migrationResult.failed_files.slice(0, 5).map((f) => (
                  <li key={f} className="font-mono text-[10px]">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {provisionStatus?.notes && provisionStatus.notes.length > 0 && (
          <ul className="list-inside list-disc text-[10px] text-muted-foreground">
            {provisionStatus.notes.slice(0, 3).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={addOpen} onOpenChange={setAddOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a version</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                {installable.length === 0 ? (
                  <p>Everything available is already installed.</p>
                ) : (
                  <ul className="space-y-1">
                    {installable.map((source) => (
                      <li key={source.id} className="flex items-center gap-2">
                        <span className="font-medium">
                          {ROLE_LABEL[source.role] ?? source.role}
                        </span>
                        <span className="font-mono text-[11px]">{source.version}</span>
                        {!source.sha256 && (
                          <span className="text-[10px] text-amber-700 dark:text-amber-400">
                            no checksum published
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto h-6 px-2 text-[10px]"
                          disabled={provisionBusy}
                          onClick={() => {
                            setAddOpen(false);
                            void installRuntimeFromUpstream(source.id);
                          }}
                        >
                          Install
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Downloads are checksum-verified before anything is unpacked.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removeTarget ? `${removeTarget.role} ${removeTarget.version}` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The files are deleted from this machine. Anything currently running keeps
              running until it is restarted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = removeTarget;
                setRemoveTarget(null);
                if (target) void uninstallRuntimeVersion(target.role, target.version);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
