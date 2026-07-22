import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Globe,
  Link2,
  Loader2,
  RefreshCw,
  Unlink,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalDevStore } from "@/stores/localDevStore";
import type { LocalDevSiteRow } from "@/types/db";
import type { SiteInfo } from "@/types/localDev";
import { isMacOS } from "@/lib/platform";

interface ProjectSitePanelProps {
  projectId: string;
}

/**
 * Project detail: local_dev_sites linked via project_id.
 * Open URL, show PHP version, link/unlink runtime sites.
 */
export function ProjectSitePanel({ projectId }: ProjectSitePanelProps) {
  const sitesResult = useLocalDevStore((s) => s.sitesResult);
  const sitesBusy = useLocalDevStore((s) => s.sitesBusy);
  const listSites = useLocalDevStore((s) => s.listSites);
  const openSiteUrl = useLocalDevStore((s) => s.openSiteUrl);
  const linkSiteToProject = useLocalDevStore((s) => s.linkSiteToProject);
  const getProjectSites = useLocalDevStore((s) => s.getProjectSites);

  const [linked, setLinked] = useState<LocalDevSiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkBusy, setLinkBusy] = useState(false);
  const [pickSite, setPickSite] = useState<string>("");

  const reload = useCallback(async () => {
    setLoading(true);
    if (isMacOS()) {
      await listSites().catch(() => {});
    }
    const rows = await getProjectSites(projectId);
    setLinked(rows);
    setLoading(false);
  }, [getProjectSites, listSites, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runtimeSites: SiteInfo[] = sitesResult?.sites ?? [];
  const linkedKeys = useMemo(
    () => new Set(linked.map((s) => `${s.name}::${s.tld}`)),
    [linked],
  );

  const availableToLink = runtimeSites.filter(
    (s) => !linkedKeys.has(`${s.name}::${s.tld || sitesResult?.tld || "test"}`),
  );

  const handleLink = async () => {
    if (!pickSite) return;
    const site = runtimeSites.find((s) => `${s.name}::${s.path}` === pickSite);
    if (!site) return;
    setLinkBusy(true);
    await linkSiteToProject(site, projectId);
    setPickSite("");
    await reload();
    setLinkBusy(false);
  };

  const handleUnlink = async (row: LocalDevSiteRow) => {
    setLinkBusy(true);
    const asInfo: SiteInfo = {
      name: row.name,
      tld: row.tld,
      url: `http://${row.name}.${row.tld}`,
      path: row.path,
      kind: row.kind,
      php_version: row.php_version,
      isolated: !!row.php_version,
      secured: row.secured === 1,
      conf_path: null,
      park_path: null,
    };
    await linkSiteToProject(asInfo, null);
    await reload();
    setLinkBusy(false);
  };

  if (!isMacOS()) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Globe className="mb-2 h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">
          Local Dev sites are available on macOS only.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Local sites</span>
          {linked.length > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {linked.length}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-xs"
          disabled={loading || sitesBusy}
          onClick={() => void reload()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : linked.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Globe className="mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="mb-1 text-sm text-muted-foreground">No linked local sites</p>
            <p className="max-w-sm text-xs text-muted-foreground/70">
              Link a Valet-style site from Local Dev so you can open its URL and see the
              PHP version here.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/50 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">PHP</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {linked.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border/30 last:border-0"
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-medium">
                        {row.name}.{row.tld}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {row.path}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="h-5 text-[10px]">
                        {row.kind}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      {row.php_version ? (
                        <Badge variant="secondary" className="h-5 gap-1 text-[10px]">
                          <Code2 className="h-2.5 w-2.5" />
                          {row.php_version}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">default</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-[11px]"
                          disabled={linkBusy || sitesBusy}
                          onClick={() => void openSiteUrl(row.name)}
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-[11px] text-destructive"
                          disabled={linkBusy}
                          onClick={() => void handleUnlink(row)}
                        >
                          <Unlink className="h-3 w-3" />
                          Unlink
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Link another runtime site to this project */}
        <div className="mt-4 rounded-xl border border-border/60 bg-card p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Link site to this project
          </p>
          {availableToLink.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {runtimeSites.length === 0
                ? "No Local Dev sites discovered yet. Open Local Dev → Sites or import from Herd."
                : "All discovered sites are already linked here."}
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <Select value={pickSite} onValueChange={setPickSite}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Choose a site…" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableToLink.map((s) => (
                      <SelectItem
                        key={`${s.name}:${s.path}`}
                        value={`${s.name}::${s.path}`}
                        className="text-xs"
                      >
                        {s.name}.{s.tld} · {s.kind}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={!pickSite || linkBusy}
                onClick={() => void handleLink()}
              >
                {linkBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                Link
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
