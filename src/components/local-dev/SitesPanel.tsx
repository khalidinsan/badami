import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  Link2,
  Loader2,
  RefreshCw,
  RotateCw,
  Unlink,
  Globe,
  Code2,
  FolderKanban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  parkActionKey,
  siteActionKey,
  SITE_ACTION_LINK,
  SITE_ACTION_NGINX,
  SITE_ACTION_PARK,
  useLocalDevStore,
} from "@/stores/localDevStore";
import type { SiteInfo } from "@/types/localDev";
import * as projectQueries from "@/db/queries/projects";
import type { ProjectRow } from "@/types/db";
import { pickDirectory } from "@/lib/pickDirectory";

/** Sentinel for "no isolation" — Select cannot hold an empty string value. */
const PHP_DEFAULT = "__default__";

export function SitesPanel() {
  const sitesResult = useLocalDevStore((s) => s.sitesResult);
  /** List fetch only — must never disable row actions. */
  const sitesLoading = useLocalDevStore((s) => s.sitesLoading);
  /** Keyed per action, so parking a path leaves every other row usable. */
  const siteBusy = useLocalDevStore((s) => s.siteBusy);
  const discovery = useLocalDevStore((s) => s.discovery);
  const services = useLocalDevStore((s) => s.services);
  const listSites = useLocalDevStore((s) => s.listSites);
  const parkPath = useLocalDevStore((s) => s.parkPath);
  const unparkPath = useLocalDevStore((s) => s.unparkPath);
  const linkSite = useLocalDevStore((s) => s.linkSite);
  const unlinkSite = useLocalDevStore((s) => s.unlinkSite);
  const isolatePhp = useLocalDevStore((s) => s.isolatePhp);
  const unisolatePhp = useLocalDevStore((s) => s.unisolatePhp);
  const openSiteUrl = useLocalDevStore((s) => s.openSiteUrl);
  const reloadNginx = useLocalDevStore((s) => s.reloadNginx);
  const linkSiteToProject = useLocalDevStore((s) => s.linkSiteToProject);

  const [parkOpen, setParkOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [projectLinkSite, setProjectLinkSite] = useState<SiteInfo | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [parkInput, setParkInput] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkPath, setLinkPath] = useState("");

  useEffect(() => {
    void listSites();
  }, [listSites]);

  useEffect(() => {
    if (projectLinkSite) {
      projectQueries
        .getProjects("active")
        .then(setProjects)
        .catch(() => setProjects([]));
    }
  }, [projectLinkSite]);

  const phpOptions = useMemo(() => {
    const fromDiscovery =
      discovery?.herd.php_versions
        ?.filter((v) => v.available)
        .map((v) => v.version) ?? [];
    const defaults = ["8.4", "8.3", "8.2", "8.1", "8.0", "7.4"];
    return Array.from(new Set([...fromDiscovery, ...defaults]));
  }, [discovery]);

  const sites = sitesResult?.sites ?? [];
  const parkPaths = sitesResult?.park_paths ?? [];

  const nginxRunning =
    services.find((s) => s.id === "nginx")?.status.status === "running";

  /**
   * Apply a per-site PHP version.
   *
   * Isolating writes an nginx conf pointing at that version's static FPM socket,
   * so the change is inert until nginx re-reads config — the old dialog just
   * told the user to "reload nginx after applying". With an inline control that
   * would be a silent no-op, so reload here when nginx is actually up.
   */
  const applyPhpVersion = async (site: SiteInfo, value: string) => {
    const target = value === PHP_DEFAULT ? null : value;
    const current = site.isolated ? site.php_version : null;
    if (target === current) return;

    if (target === null) {
      await unisolatePhp(site.name);
    } else {
      await isolatePhp(site.name, target);
    }
    if (nginxRunning) await reloadNginx();
  };

  /** Open the native folder picker and feed the result into a path field. */
  const browseInto = async (apply: (path: string) => void, title: string) => {
    try {
      const picked = await pickDirectory({ title });
      if (picked) apply(picked);
    } catch (err) {
      toast.error("Could not open folder picker", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Sites</span>
          {sitesResult && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {sites.length} site{sites.length === 1 ? "" : "s"} · *.{sitesResult.tld} · :
              {sitesResult.http_port}
            </Badge>
          )}
          {/* One visible truth instead of quietly-dead row actions: with nginx
              down, every URL in this table refuses connections. */}
          {!nginxRunning && (
            <Badge
              variant="outline"
              className="h-5 gap-1 px-1.5 text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              nginx stopped — sites will not respond
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs"
            disabled={sitesLoading}
            onClick={() => void listSites()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", sitesLoading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setParkOpen(true)}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Park path
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setLinkOpen(true)}
          >
            <Link2 className="h-3.5 w-3.5" />
            Link site
          </Button>
          {/* `ld_reload_nginx` refuses without a live master pid, so an enabled
              button here was a UI-only promise the backend never accepted. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={!!siteBusy[SITE_ACTION_NGINX] || !nginxRunning}
                  onClick={() => void reloadNginx()}
                >
                  {siteBusy[SITE_ACTION_NGINX] ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCw className="h-3.5 w-3.5" />
                  )}
                  Reload nginx
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-[10px]">
              {nginxRunning
                ? "Re-reads site configs without dropping connections"
                : "nginx is not running — start the Web group from the Services tab"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {parkPaths.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Park paths
            </p>
            <div className="flex flex-col gap-1.5">
              {parkPaths.map((p) => (
                <div
                  key={p}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card px-3 py-2"
                >
                  <span className="truncate font-mono text-[11px]" title={p}>
                    {p}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 gap-1 px-2 text-[11px] text-destructive"
                    disabled={!!siteBusy[parkActionKey(p)]}
                    onClick={() => void unparkPath(p)}
                  >
                    {siteBusy[parkActionKey(p)] && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    Unpark
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {sites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Globe className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="mb-1 text-sm font-medium text-muted-foreground">
              {sitesLoading ? "Loading sites…" : "No sites yet"}
            </p>
            <p className="mb-4 max-w-sm text-xs text-muted-foreground/70">
              Park a directory or link a project path. Import from Herd to seed parks and
              isolates.
            </p>
            <Button size="sm" variant="outline" onClick={() => void listSites()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Retry list
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/50 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">PHP</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => {
                  const rowBusy = !!siteBusy[siteActionKey(site.name)];
                  return (
                  <tr
                    key={`${site.kind}:${site.name}:${site.path}`}
                    className="border-b border-border/30 last:border-0"
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium">{site.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {site.url}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="h-5 text-[10px]">
                        {site.kind}
                      </Badge>
                    </td>
                    {/* Per-site PHP version, inline. This is `ld_isolate_php` —
                        previously reachable only through an "Isolate" dialog,
                        which made a feature that already existed feel missing. */}
                    <td className="px-3 py-2.5">
                      <Select
                        value={site.isolated && site.php_version ? site.php_version : PHP_DEFAULT}
                        disabled={rowBusy}
                        onValueChange={(v) => void applyPhpVersion(site, v)}
                      >
                        <SelectTrigger
                          size="sm"
                          className={cn(
                            "h-7 w-[120px] text-[11px]",
                            site.isolated && "border-primary/40",
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={PHP_DEFAULT} className="text-xs">
                            Default
                          </SelectItem>
                          {phpOptions.map((v) => (
                            <SelectItem key={v} value={v} className="text-xs">
                              <span className="flex items-center gap-1.5">
                                <Code2 className="h-2.5 w-2.5" />
                                PHP {v}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td
                      className="max-w-[200px] truncate px-3 py-2.5 font-mono text-[11px] text-muted-foreground"
                      title={site.path}
                    >
                      {site.path}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {rowBusy && (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-[11px]"
                          onClick={() => void openSiteUrl(site.name)}
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-[11px]"
                          onClick={() => {
                            setProjectLinkSite(site);
                            setSelectedProjectId("");
                          }}
                        >
                          <FolderKanban className="h-3 w-3" />
                          Project
                        </Button>
                        {site.kind === "linked" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-[11px] text-destructive"
                            disabled={rowBusy}
                            onClick={() => void unlinkSite(site.name)}
                          >
                            <Unlink className="h-3 w-3" />
                            Unlink
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {sitesResult?.notes && sitesResult.notes.length > 0 && (
          <ul className="mt-4 list-inside list-disc text-[11px] text-muted-foreground">
            {sitesResult.notes.slice(0, 4).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Park dialog */}
      <Dialog open={parkOpen} onOpenChange={setParkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Park path</DialogTitle>
            <DialogDescription>
              Add a directory whose subfolders become sites under *.{sitesResult?.tld ?? "test"}.
              Non-destructive — only updates Badami valet config.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="park-path" className="text-xs">
              Absolute path
            </Label>
            <div className="flex gap-2">
              <Input
                id="park-path"
                value={parkInput}
                onChange={(e) => setParkInput(e.target.value)}
                placeholder="/Users/you/Sites"
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5 text-xs"
                onClick={() => void browseInto(setParkInput, "Choose a park directory")}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Browse
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setParkOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!parkInput.trim() || !!siteBusy[SITE_ACTION_PARK]}
              onClick={async () => {
                await parkPath(parkInput.trim());
                setParkInput("");
                setParkOpen(false);
              }}
            >
              {siteBusy[SITE_ACTION_PARK] && (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              )}
              Park
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link site</DialogTitle>
            <DialogDescription>
              Create a Valet-style symlink under config/valet/Sites/. Does not modify project
              source trees.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="link-name" className="text-xs">
                Site name
              </Label>
              <Input
                id="link-name"
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
                placeholder="my-app"
                className="text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="link-path" className="text-xs">
                Project path
              </Label>
              <div className="flex gap-2">
                <Input
                  id="link-path"
                  value={linkPath}
                  onChange={(e) => setLinkPath(e.target.value)}
                  placeholder="/Users/you/code/my-app"
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 text-xs"
                  onClick={() =>
                    // Default the site name from the folder when it is still blank —
                    // it is what the user would have typed anyway.
                    void browseInto(
                      (path) => {
                        setLinkPath(path);
                        if (!linkName.trim()) {
                          const base = path.split("/").filter(Boolean).pop();
                          if (base) setLinkName(base);
                        }
                      },
                      "Choose the project directory",
                    )
                  }
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Browse
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!linkName.trim() || !linkPath.trim() || !!siteBusy[SITE_ACTION_LINK]}
              onClick={async () => {
                await linkSite(linkName.trim(), linkPath.trim());
                setLinkName("");
                setLinkPath("");
                setLinkOpen(false);
              }}
            >
              {siteBusy[SITE_ACTION_LINK] && (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              )}
              Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link site → Badami project (local_dev_sites.project_id) */}
      <Dialog
        open={!!projectLinkSite}
        onOpenChange={(o) => !o && setProjectLinkSite(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link to project · {projectLinkSite?.name}</DialogTitle>
            <DialogDescription>
              Sets <span className="font-mono text-[11px]">local_dev_sites.project_id</span> so
              the site appears on the project&apos;s Local sites tab. Does not modify Herd.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Project</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="w-full text-xs">
                <SelectValue placeholder="Choose a project…" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!projectLinkSite}
              onClick={async () => {
                if (!projectLinkSite) return;
                await linkSiteToProject(projectLinkSite, null);
                setProjectLinkSite(null);
              }}
            >
              Clear link
            </Button>
            <Button
              size="sm"
              disabled={!projectLinkSite || !selectedProjectId}
              onClick={async () => {
                if (!projectLinkSite || !selectedProjectId) return;
                await linkSiteToProject(projectLinkSite, selectedProjectId);
                setProjectLinkSite(null);
              }}
            >
              Link to project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
