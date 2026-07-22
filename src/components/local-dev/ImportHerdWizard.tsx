import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderTree,
  Import,
  Loader2,
  Package,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useLocalDevStore } from "@/stores/localDevStore";
import { formatBytes } from "@/types/localDev";

type Step = "discover" | "review" | "confirm" | "done";

export function ImportHerdWizard() {
  const discovery = useLocalDevStore((s) => s.discovery);
  const loading = useLocalDevStore((s) => s.loading);
  const importBusy = useLocalDevStore((s) => s.importBusy);
  const importResult = useLocalDevStore((s) => s.importResult);
  const discover = useLocalDevStore((s) => s.discover);
  const importHerd = useLocalDevStore((s) => s.importHerd);
  const settings = useLocalDevStore((s) => s.settings);

  const [step, setStep] = useState<Step>("discover");
  const [installResources, setInstallResources] = useState(true);
  const [generateConfigs, setGenerateConfigs] = useState(true);
  const [writeIsolates, setWriteIsolates] = useState(true);

  useEffect(() => {
    if (!discovery) void discover();
  }, [discovery, discover]);

  const herd = discovery?.herd;
  const parks = herd?.park_paths ?? [];
  const phpVersions = herd?.php_versions ?? [];
  const mariadb = useMemo(() => {
    const list = herd?.mariadb_candidates ?? [];
    if (list.length === 0) return null;
    return [...list].sort((a, b) => b.score - a.score)[0];
  }, [herd?.mariadb_candidates]);

  const httpPort = Number(settings.http_port || "8080") || 8080;

  const runImport = async (dryRun: boolean) => {
    const result = await importHerd({
      install_resources: installResources,
      generate_configs: generateConfigs,
      write_isolated_sites: writeIsolates,
      http_port: httpPort,
      dry_run: dryRun,
    });
    if (result && !dryRun) setStep("done");
    else if (result && dryRun) setStep("review");
  };

  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Import from Herd</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Read-only against Herd. Never copies the MariaDB datadir or kills processes.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={loading}
            onClick={() => void discover()}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
            Re-scan
          </Button>
        </div>

        {/* Safety notes */}
        <Card className="border-emerald-500/30 bg-emerald-500/5 py-4">
          <CardHeader className="px-4 pb-2 pt-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4 text-emerald-600" />
              Safety guarantees
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 px-4 text-xs text-muted-foreground">
            <p className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              No kill of Herd processes — import never stops or signals Herd services
            </p>
            <p className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              No MariaDB datadir copy/delete — ~15GB data stays in place (reuse policy)
            </p>
            <p className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              Never invokes Herd privileged helper · never starts stack services
            </p>
          </CardContent>
        </Card>

        {/* Inventory */}
        <Card className="py-4">
          <CardHeader className="px-4 pb-2 pt-0">
            <CardTitle className="text-sm">Inventory</CardTitle>
            <CardDescription className="text-xs">
              {herd?.detected
                ? `Herd detected${herd.home_path ? ` · ${herd.home_path}` : ""}`
                : "Herd not detected — you can still run import (may yield empty inventory)"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 px-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <FolderTree className="h-3.5 w-3.5" />
                Parks
              </div>
              {parks.length === 0 ? (
                <p className="text-xs text-muted-foreground">None found</p>
              ) : (
                <ul className="max-h-28 space-y-1 overflow-auto font-mono text-[11px]">
                  {parks.map((p) => (
                    <li key={p} className="truncate" title={p}>
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-border/60 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Database className="h-3.5 w-3.5" />
                MariaDB datadir
              </div>
              {mariadb ? (
                <div className="space-y-1 text-xs">
                  <p className="break-all font-mono text-[11px]">{mariadb.path}</p>
                  <Badge variant="secondary" className="h-5 text-[10px]">
                    {formatBytes(mariadb.bytes)} · reuse in place
                  </Badge>
                  {!mariadb.has_ibdata1 && (
                    <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" />
                      Missing ibdata1 marker
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No candidate scored</p>
              )}
            </div>

            <div className="rounded-lg border border-border/60 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Package className="h-3.5 w-3.5" />
                PHP versions
              </div>
              {phpVersions.length === 0 ? (
                <p className="text-xs text-muted-foreground">None found</p>
              ) : (
                <ul className="space-y-1">
                  {phpVersions.map((v) => (
                    <li key={v.tag} className="flex items-center justify-between text-xs">
                      <span>PHP {v.version}</span>
                      <Badge
                        variant="outline"
                        className={
                          v.available
                            ? "h-5 border-emerald-500/40 text-[10px] text-emerald-700 dark:text-emerald-400"
                            : "h-5 text-[10px] text-muted-foreground"
                        }
                      >
                        {v.available ? "available" : "missing"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Options */}
        <Card className="py-4">
          <CardHeader className="px-4 pb-2 pt-0">
            <CardTitle className="text-sm">Import options</CardTitle>
            <CardDescription className="text-xs">
              HTTP port Mode A: {httpPort}. Writes only under Badami local-dev/.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={installResources}
                onCheckedChange={(v) => setInstallResources(v === true)}
              />
              <span>Install valet-server resources</span>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={generateConfigs}
                onCheckedChange={(v) => setGenerateConfigs(v === true)}
              />
              <span>Generate nginx / FPM / valet configs</span>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={writeIsolates}
                onCheckedChange={(v) => setWriteIsolates(v === true)}
              />
              <span>Write isolated-site nginx confs</span>
            </label>
            <p className="text-[11px] text-muted-foreground">
              Label: <strong>non-destructive import</strong> — no datadir copy, no process kill.
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={importBusy}
            onClick={() => {
              setStep("confirm");
              void runImport(false);
            }}
          >
            {importBusy && step === "confirm" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Import className="h-3.5 w-3.5" />
            )}
            Import from Herd
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={importBusy}
            onClick={() => void runImport(true)}
          >
            {importBusy && step !== "confirm" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Dry-run snapshot only
          </Button>
        </div>

        {importResult && (
          <Card className="py-4">
            <CardHeader className="px-4 pb-2 pt-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                {importResult.herd_detected ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                Last import result
              </CardTitle>
              <CardDescription className="font-mono text-[11px]">
                {importResult.snapshot_path}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 px-4 text-xs">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{importResult.parks.length} parks</Badge>
                <Badge variant="secondary">{importResult.sites.length} sites</Badge>
                <Badge variant="secondary">{importResult.binaries.length} binaries</Badge>
                <Badge variant="secondary">{importResult.services.length} services</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  services_started={String(importResult.services_started)}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  herd_processes_killed={String(importResult.herd_processes_killed)}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  mariadb_datadir_copied={String(importResult.mariadb_datadir_copied)}
                </Badge>
              </div>
              {importResult.selected_mariadb && (
                <p className="text-muted-foreground">
                  MariaDB datadir (in-place):{" "}
                  <span className="font-mono">
                    {importResult.selected_mariadb.path} (
                    {formatBytes(importResult.selected_mariadb.bytes)})
                  </span>
                </p>
              )}
              {importResult.warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-900 dark:text-amber-100">
                  <p className="mb-1 font-medium">Warnings</p>
                  <ul className="list-inside list-disc space-y-0.5">
                    {importResult.warnings.slice(0, 8).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {importResult.notes.length > 0 && (
                <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                  {importResult.notes.slice(0, 6).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* Silence unused Label import if tree-shaken — keep for a11y pattern */}
        <Label className="sr-only">Import wizard</Label>
      </div>
    </div>
  );
}
