import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Plus,
  Search,
  X,
  Server,
  SlidersHorizontal,
  ArrowUpDown,
  Group,
  FolderKanban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { ServerCard } from "@/components/server/ServerCard";
import { ServerForm } from "@/components/server/ServerForm";
import { ServerSessionTabs } from "@/components/server/ServerSessionTabs";
import { useServerStore } from "@/stores/serverStore";
import { invoke } from "@tauri-apps/api/core";
import * as projectQueries from "@/db/queries/projects";
import type { ServerCredentialRow, ProjectRow } from "@/types/db";
import type { ServerEnvironment } from "@/types/server";
import { ENVIRONMENT_LABELS } from "@/types/server";
import { toast } from "sonner";

export const Route = createFileRoute("/servers/")({
  component: ServersPage,
});

type SortKey = "name" | "last_connected" | "created" | "updated";
type GroupKey = "none" | "project" | "protocol";

function ServersPage() {
  const { servers, loading, loadAllServers, deleteServer } = useServerStore();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerCredentialRow | null>(null);
  const [sessionInit, setSessionInit] = useState<{
    server: ServerCredentialRow;
    type: "terminal" | "files";
  } | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [filterEnvironment, setFilterEnvironment] = useState<string>("all");
  const [filterProtocol, setFilterProtocol] = useState<string>("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("last_connected");
  const [groupKey, setGroupKey] = useState<GroupKey>("project");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAllServers();
    projectQueries.getProjects().then(setProjects).catch(() => {});
  }, []);

  // Focus search on printable key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (isEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectRow>();
    for (const p of projects) map.set(p.id, p);
    return map;
  }, [projects]);

  // Filter
  const filtered = useMemo(() => {
    let list = [...servers];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.host.toLowerCase().includes(q) ||
          s.username.toLowerCase().includes(q),
      );
    }

    if (filterEnvironment !== "all") {
      list = list.filter((s) => s.environment === filterEnvironment);
    }

    if (filterProtocol !== "all") {
      list = list.filter((s) => s.protocol === filterProtocol);
    }

    if (filterProject === "none") {
      list = list.filter((s) => !s.project_id);
    } else if (filterProject !== "all") {
      list = list.filter((s) => s.project_id === filterProject);
    }

    return list;
  }, [servers, search, filterEnvironment, filterProtocol, filterProject]);

  // Sort
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name);
        case "last_connected": {
          const aTime = a.last_connected_at ?? "";
          const bTime = b.last_connected_at ?? "";
          return bTime.localeCompare(aTime);
        }
        case "created":
          return b.created_at.localeCompare(a.created_at);
        case "updated":
          return b.updated_at.localeCompare(a.updated_at);
        default:
          return 0;
      }
    });
    return list;
  }, [filtered, sortKey]);

  // Group
  const groups = useMemo(() => {
    if (groupKey === "none") {
      return [{ label: "", servers: sorted }];
    }

    const map = new Map<string, ServerCredentialRow[]>();
    const order: string[] = [];

    for (const s of sorted) {
      let key: string;
      if (groupKey === "project") {
        key = s.project_id ?? "__none__";
      } else {
        key = s.protocol.toUpperCase();
      }
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(s);
    }

    return order.map((key) => {
      let label: string;
      if (groupKey === "project") {
        label = key === "__none__" ? "No Project" : (projectMap.get(key)?.name ?? "Unknown Project");
      } else {
        label = key;
      }
      return { label, servers: map.get(key)! };
    });
  }, [sorted, groupKey, projectMap]);

  const activeFilterCount = [
    filterEnvironment !== "all",
    filterProtocol !== "all",
    filterProject !== "all",
  ].filter(Boolean).length;

  const handleEdit = (server: ServerCredentialRow) => {
    setEditingServer(server);
    setFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    try { await invoke("delete_server_password", { serverId: id }); } catch { /* ignore */ }
    try { await invoke("delete_server_passphrase", { serverId: id }); } catch { /* ignore */ }
    await deleteServer(id);
  };

  const handleOpenTerminal = (server: ServerCredentialRow) => {
    if (server.protocol !== "ssh") {
      toast.error("Terminal is only available for SSH servers");
      return;
    }
    setSessionInit({ server, type: "terminal" });
  };

  const handleOpenFileManager = (server: ServerCredentialRow) => {
    setSessionInit({ server, type: "files" });
  };

  const handleFormClose = useCallback((open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setEditingServer(null);
      loadAllServers();
    }
  }, [loadAllServers]);

  const clearFilters = () => {
    setFilterEnvironment("all");
    setFilterProtocol("all");
    setFilterProject("all");
  };

  // Session view (full page takeover)
  if (sessionInit) {
    return (
      <>
        <ServerSessionTabs
          servers={servers}
          initialServer={sessionInit.server}
          initialType={sessionInit.type}
          onBack={() => setSessionInit(null)}
        />
        <ServerForm
          open={formOpen}
          onOpenChange={handleFormClose}
          server={editingServer}
        />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Servers</h1>
          <p className="text-xs text-muted-foreground">
            {servers.length} server{servers.length !== 1 ? "s" : ""} total
          </p>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => {
            setEditingServer(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Server
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-6 py-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, host, username..."
            className="h-8 pl-8 pr-8 text-xs"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <SlidersHorizontal className="h-3 w-3" />
              Filter
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-3 p-3">
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">Environment</p>
              <Select value={filterEnvironment} onValueChange={setFilterEnvironment}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(Object.entries(ENVIRONMENT_LABELS) as [ServerEnvironment, string][]).map(
                    ([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">Protocol</p>
              <Select value={filterProtocol} onValueChange={setFilterProtocol}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="ssh">SSH</SelectItem>
                  <SelectItem value="ftp">FTP</SelectItem>
                  <SelectItem value="ftps">FTPS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">Project</p>
              <Select value={filterProject} onValueChange={setFilterProject}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {activeFilterCount > 0 && (
              <>
                <Separator />
                <Button variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={clearFilters}>
                  Clear filters
                </Button>
              </>
            )}
          </PopoverContent>
        </Popover>

        {/* Sort */}
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="h-8 w-[150px] text-xs gap-1">
            <ArrowUpDown className="h-3 w-3 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_connected">Last connected</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="updated">Updated</SelectItem>
          </SelectContent>
        </Select>

        {/* Group */}
        <Select value={groupKey} onValueChange={(v) => setGroupKey(v as GroupKey)}>
          <SelectTrigger className="h-8 w-[140px] text-xs gap-1">
            <Group className="h-3 w-3 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No grouping</SelectItem>
            <SelectItem value="project">By project</SelectItem>
            <SelectItem value="protocol">By protocol</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Loading servers...
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Server className="mb-3 h-10 w-10 text-muted-foreground/30" />
            {servers.length === 0 ? (
              <>
                <p className="mb-1 text-sm font-medium text-muted-foreground">No servers yet</p>
                <p className="mb-4 text-xs text-muted-foreground/70">
                  Add a server to connect via SSH, SFTP, or FTP
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    setEditingServer(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Server
                </Button>
              </>
            ) : (
              <>
                <p className="mb-1 text-sm font-medium text-muted-foreground">No matching servers</p>
                <p className="mb-4 text-xs text-muted-foreground/70">
                  Try adjusting your search or filters
                </p>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setSearch(""); clearFilters(); }}>
                  Clear all
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {groups.map((group) => (
              <div key={group.label || "__all__"}>
                {group.label && (
                  <div className="mb-3 flex items-center gap-2">
                    {groupKey === "project" ? (
                      <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Server className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {group.label}
                    </h3>
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      {group.servers.length}
                    </Badge>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.servers.map((server) => (
                    <ServerCard
                      key={server.id}
                      server={server}
                      projectName={server.project_id ? projectMap.get(server.project_id)?.name : null}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onOpenTerminal={handleOpenTerminal}
                      onOpenFileManager={handleOpenFileManager}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form */}
      <ServerForm
        open={formOpen}
        onOpenChange={handleFormClose}
        server={editingServer}
      />
    </div>
  );
}
