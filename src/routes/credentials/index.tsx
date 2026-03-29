import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Plus,
  Search,
  X,
  Key,
  SlidersHorizontal,
  ArrowUpDown,
  Group,
  FolderKanban,
  Lock,
  Globe,
  Database,
  Mail,
  Settings,
  ArrowLeftRight,
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
import { CredentialCard } from "@/components/credentials/CredentialCard";
import { CredentialForm } from "@/components/credentials/CredentialForm";
import { CredentialDetail } from "@/components/credentials/CredentialDetail";
import { VaultLockScreen } from "@/components/credentials/VaultLockScreen";
import { EnvDiffView } from "@/components/credentials/EnvDiffView";
import { useCredentialStore } from "@/stores/credentialStore";
import { useVault } from "@/hooks/useVault";
import * as projectQueries from "@/db/queries/projects";
import type { CredentialRow, ProjectRow } from "@/types/db";
import type { CredentialType, CredentialEnvironment } from "@/types/credential";
import {
  CREDENTIAL_TYPE_LABELS,
  ENVIRONMENT_LABELS,
} from "@/types/credential";

export const Route = createFileRoute("/credentials/")({
  component: CredentialsPage,
});

type SortKey = "name" | "type" | "created" | "updated" | "expiry";
type GroupKey = "none" | "project" | "type";

function CredentialsPage() {
  const {
    credentials,
    loading,
    loaded,
    loadAllCredentials,
    deleteCredential,
  } = useCredentialStore();
  const { isVaultLocked, hasMasterPassword, initVault, lockVault } = useVault();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<CredentialRow | null>(null);
  const [viewingCredential, setViewingCredential] = useState<CredentialRow | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterEnvironment, setFilterEnvironment] = useState<string>("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [groupKey, setGroupKey] = useState<GroupKey>("project");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    initVault();
    loadAllCredentials();
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;

      // Cmd+N → Add new
      if ((e.metaKey || e.ctrlKey) && e.key === "n" && !formOpen) {
        e.preventDefault();
        setEditingCredential(null);
        setFormOpen(true);
        return;
      }

      if (isEditable) return;

      // Escape → clear search / close
      if (e.key === "Escape") {
        if (search) setSearch("");
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [formOpen, search]);

  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectRow>();
    for (const p of projects) map.set(p.id, p);
    return map;
  }, [projects]);

  // Filter
  const filtered = useMemo(() => {
    let list = [...credentials];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.username && c.username.toLowerCase().includes(q)) ||
          (c.url && c.url.toLowerCase().includes(q)) ||
          (c.service_name && c.service_name.toLowerCase().includes(q)),
      );
    }

    if (filterType !== "all") {
      list = list.filter((c) => c.type === filterType);
    }

    if (filterEnvironment !== "all") {
      list = list.filter((c) => c.environment === filterEnvironment);
    }

    if (filterProject === "none") {
      list = list.filter((c) => !c.project_id);
    } else if (filterProject !== "all") {
      list = list.filter((c) => c.project_id === filterProject);
    }

    return list;
  }, [credentials, search, filterType, filterEnvironment, filterProject]);

  // Sort
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name);
        case "type":
          return a.type.localeCompare(b.type);
        case "created":
          return b.created_at.localeCompare(a.created_at);
        case "updated":
          return b.updated_at.localeCompare(a.updated_at);
        case "expiry": {
          const aExp = a.expires_at ?? "9999";
          const bExp = b.expires_at ?? "9999";
          return aExp.localeCompare(bExp);
        }
        default:
          return 0;
      }
    });
    return list;
  }, [filtered, sortKey]);

  // Group
  const groups = useMemo(() => {
    if (groupKey === "none") {
      return [{ label: "", credentials: sorted }];
    }

    const map = new Map<string, CredentialRow[]>();
    const order: string[] = [];

    for (const c of sorted) {
      let key: string;
      if (groupKey === "project") {
        key = c.project_id ?? "__none__";
      } else {
        key = c.type;
      }
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(c);
    }

    return order.map((key) => {
      let label: string;
      if (groupKey === "project") {
        label =
          key === "__none__"
            ? "Global"
            : (projectMap.get(key)?.name ?? "Unknown Project");
      } else {
        label = CREDENTIAL_TYPE_LABELS[key as CredentialType] ?? key;
      }
      return { label, credentials: map.get(key)! };
    });
  }, [sorted, groupKey, projectMap]);

  const activeFilterCount = [
    filterType !== "all",
    filterEnvironment !== "all",
    filterProject !== "all",
  ].filter(Boolean).length;

  const envCredentials = useMemo(
    () => credentials.filter((c) => c.type === "env_vars"),
    [credentials],
  );

  const handleEdit = (cred: CredentialRow) => {
    setEditingCredential(cred);
    setFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    await deleteCredential(id);
  };

  const handleFormClose = useCallback(
    (open: boolean) => {
      setFormOpen(open);
      if (!open) {
        setEditingCredential(null);
        loadAllCredentials();
      }
    },
    [loadAllCredentials],
  );

  const clearFilters = () => {
    setFilterType("all");
    setFilterEnvironment("all");
    setFilterProject("all");
  };

  // Vault lock screen
  if (hasMasterPassword && isVaultLocked) {
    return <VaultLockScreen />;
  }

  // Detail view
  if (viewingCredential) {
    const fresh = credentials.find((c) => c.id === viewingCredential.id);
    return (
      <>
        <CredentialDetail
          credential={fresh ?? viewingCredential}
          onBack={() => setViewingCredential(null)}
          onEdit={(cred) => {
            setViewingCredential(null);
            handleEdit(cred);
          }}
        />
        <CredentialForm
          open={formOpen}
          onOpenChange={handleFormClose}
          credential={editingCredential}
          onSaved={() => loadAllCredentials()}
        />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Credentials</h1>
          <p className="text-xs text-muted-foreground">
            {credentials.length} credential{credentials.length !== 1 ? "s" : ""} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasMasterPassword && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={lockVault}
            >
              <Lock className="h-3.5 w-3.5" />
              Lock
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              setEditingCredential(null);
              setFormOpen(true);
            }}
            title="Add Credential (⌘N)"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Credential
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-6 py-2">
        {/* Search */}
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, username, URL..."
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
              <p className="text-[11px] font-medium text-muted-foreground">Type</p>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(
                    Object.entries(CREDENTIAL_TYPE_LABELS) as [CredentialType, string][]
                  ).map(([val, label]) => (
                    <SelectItem key={val} value={val}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">Environment</p>
              <Select value={filterEnvironment} onValueChange={setFilterEnvironment}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(
                    Object.entries(ENVIRONMENT_LABELS) as [CredentialEnvironment, string][]
                  ).map(([val, label]) => (
                    <SelectItem key={val} value={val}>
                      {label}
                    </SelectItem>
                  ))}
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
                  <SelectItem value="none">Global (no project)</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {activeFilterCount > 0 && (
              <>
                <Separator />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full text-xs"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              </>
            )}
          </PopoverContent>
        </Popover>

        {/* Sort */}
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="h-8 w-[140px] gap-1 text-xs">
            <ArrowUpDown className="h-3 w-3 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Updated</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="type">Type</SelectItem>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="expiry">Expiry</SelectItem>
          </SelectContent>
        </Select>

        {/* Group */}
        <Select value={groupKey} onValueChange={(v) => setGroupKey(v as GroupKey)}>
          <SelectTrigger className="h-8 w-[140px] gap-1 text-xs">
            <Group className="h-3 w-3 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No grouping</SelectItem>
            <SelectItem value="project">By project</SelectItem>
            <SelectItem value="type">By type</SelectItem>
          </SelectContent>
        </Select>

        {/* Compare .env */}
        {envCredentials.length >= 2 && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-8 gap-1.5 text-xs"
            onClick={() => setDiffOpen(true)}
            title="Compare env variables side-by-side"
          >
            <ArrowLeftRight className="h-3 w-3" />
            Compare .env
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {!loaded && loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Loading credentials...
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            {credentials.length === 0 ? (
              <>
                <div className="mb-4 flex items-center gap-3">
                  {[Globe, Key, Database, Mail, Settings].map((Icon, i) => (
                    <div
                      key={i}
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/40"
                      style={{ opacity: 0.4 + i * 0.15 }}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))}
                </div>
                <p className="mb-1 text-sm font-medium text-muted-foreground">
                  No credentials yet
                </p>
                <p className="mb-4 max-w-xs text-center text-xs text-muted-foreground/70">
                  Store web logins, API keys, database passwords, licenses, env vars, and more — all encrypted.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    setEditingCredential(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Credential
                </Button>
              </>
            ) : (
              <>
                <p className="mb-1 text-sm font-medium text-muted-foreground">
                  No matching credentials
                </p>
                <p className="mb-4 text-xs text-muted-foreground/70">
                  Try adjusting your search or filters
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setSearch("");
                    clearFilters();
                  }}
                >
                  Clear all
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-6 p-6">
            {groups.map((group) => (
              <div key={group.label || "__all__"}>
                {group.label && (
                  <div className="mb-3 flex items-center gap-2">
                    {groupKey === "project" ? (
                      <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Key className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.label}
                    </h3>
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      {group.credentials.length}
                    </Badge>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.credentials.map((cred) => (
                    <CredentialCard
                      key={cred.id}
                      credential={cred}
                      projectName={
                        cred.project_id
                          ? projectMap.get(cred.project_id)?.name
                          : null
                      }
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onClick={setViewingCredential}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form */}
      <CredentialForm
        open={formOpen}
        onOpenChange={handleFormClose}
        credential={editingCredential}
        onSaved={() => loadAllCredentials()}
      />

      {/* Env Diff Dialog */}
      <EnvDiffView
        open={diffOpen}
        onOpenChange={setDiffOpen}
        envCredentials={envCredentials}
      />
    </div>
  );
}
