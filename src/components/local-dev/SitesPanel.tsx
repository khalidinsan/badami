import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useLocalDevStore } from "@/stores/localDevStore";
import type { SiteInfo } from "@/types/localDev";
import * as projectQueries from "@/db/queries/projects";
import type { ProjectRow } from "@/types/db";

export function SitesPanel() {
  const sitesResult = useLocalDevStore((s) => s.sitesResult);
  const sitesBusy = useLocalDevStore((s) => s.sitesBusy);
  const discovery = useLocalDevStore((s) => s.discovery);
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
  const [isolateSite, setIsolateSite] = useState<SiteInfo | null>(null);
  const [projectLinkSite, setProjectLinkSite] = useState<SiteInfo | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [parkInput, setParkInput] = useState("");
  const [linkName, setLinkName] = useState("");
  const [linkPath, setLinkPath] = useState("");
  const [phpVersion, setPhpVersion] = useState("8.4");

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
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs"
            disabled={sitesBusy}
            onClick={() => void listSites()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={sitesBusy}
            onClick={() => setParkOpen(true)}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Park path
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={sitesBusy}
            onClick={() => setLinkOpen(true)}
          >
            <Link2 className="h-3.5 w-3.5" />
            Link site
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={sitesBusy}
            onClick={() => void reloadNginx()}
          >
            {sitesBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
            Reload nginx
          </Button>
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
                  <span className="truncate font-mono text-[11px]">{p}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-[11px] text-destructive"
                    disabled={sitesBusy}
                    onClick={() => void unparkPath(p)}
                  >
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
              {sitesBusy ? "Loading sites…" : "No sites yet"}
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
                {sites.map((site) => (
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
                    <td className="px-3 py-2.5">
                      {site.isolated && site.php_version ? (
                        <Badge
                          variant="secondary"
                          className="h-5 gap-1 text-[10px]"
                        >
                          <Code2 className="h-2.5 w-2.5" />
                          {site.php_version}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">default</span>
                      )}
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                      {site.path}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-[11px]"
                          disabled={sitesBusy}
                          onClick={() => void openSiteUrl(site.name)}
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          disabled={sitesBusy}
                          onClick={() => {
                            setIsolateSite(site);
                            setPhpVersion(site.php_version || phpOptions[0] || "8.4");
                          }}
                        >
                          Isolate
                        </Button>
                        {site.isolated && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            disabled={sitesBusy}
                            onClick={() => void unisolatePhp(site.name)}
                          >
                            Unisolate
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-[11px]"
                          disabled={sitesBusy}
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
                            disabled={sitesBusy}
                            onClick={() => void unlinkSite(site.name)}
                          >
                            <Unlink className="h-3 w-3" />
                            Unlink
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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
            <Input
              id="park-path"
              value={parkInput}
              onChange={(e) => setParkInput(e.target.value)}
              placeholder="/Users/you/Sites"
              className="font-mono text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setParkOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!parkInput.trim() || sitesBusy}
              onClick={async () => {
                await parkPath(parkInput.trim());
                setParkInput("");
                setParkOpen(false);
              }}
            >
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
              <Input
                id="link-path"
                value={linkPath}
                onChange={(e) => setLinkPath(e.target.value)}
                placeholder="/Users/you/code/my-app"
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!linkName.trim() || !linkPath.trim() || sitesBusy}
              onClick={async () => {
                await linkSite(linkName.trim(), linkPath.trim());
                setLinkName("");
                setLinkPath("");
                setLinkOpen(false);
              }}
            >
              Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Isolate dialog */}
      <Dialog open={!!isolateSite} onOpenChange={(o) => !o && setIsolateSite(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Isolate PHP · {isolateSite?.name}</DialogTitle>
            <DialogDescription>
              Writes a Badami nginx conf with a static FPM socket. Refuses if the PHP binary is
              missing. Reload nginx after applying.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">PHP version</Label>
            <Select value={phpVersion} onValueChange={setPhpVersion}>
              <SelectTrigger className="w-full text-xs">
                <SelectValue placeholder="PHP version" />
              </SelectTrigger>
              <SelectContent>
                {phpOptions.map((v) => (
                  <SelectItem key={v} value={v} className="text-xs">
                    PHP {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsolateSite(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!isolateSite || sitesBusy}
              onClick={async () => {
                if (!isolateSite) return;
                await isolatePhp(isolateSite.name, phpVersion);
                setIsolateSite(null);
              }}
            >
              Isolate
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
              disabled={!projectLinkSite || sitesBusy}
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
              disabled={!projectLinkSite || !selectedProjectId || sitesBusy}
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
