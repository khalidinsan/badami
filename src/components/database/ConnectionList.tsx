import { useState, useMemo } from "react";
import {
  Plus,
  Search,
  Database,
  Plug,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  FolderKanban,
  Eye,
  EyeOff,
  KeySquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useDbConnection } from "@/hooks/useDbConnection";
import { useDbStore } from "@/stores/dbStore";
import { invoke } from "@tauri-apps/api/core";
import type { DbConnectionRow } from "@/types/db";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { toast } from "sonner";

dayjs.extend(relativeTime);

const ENGINE_LABELS: Record<string, string> = {
  mysql: "MySQL",
  mariadb: "MariaDB",
  postgresql: "PostgreSQL",
  sqlite: "SQLite",
};

const ENGINE_COLORS: Record<string, string> = {
  mysql: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  mariadb: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  postgresql: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  sqlite: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};

interface ConnectionListProps {
  onNewConnection: () => void;
  onEditConnection: (conn: DbConnectionRow) => void;
  projectId?: string;
}

export function ConnectionList({
  onNewConnection,
  onEditConnection,
  projectId,
}: ConnectionListProps) {
  const {
    connections,
    loading,
    connecting,
    connect,
    isConnected,
    deleteConnection,
  } = useDbConnection();

  const [search, setSearch] = useState("");

  // Password prompt state
  const [passwordPrompt, setPasswordPrompt] = useState<{
    conn: DbConnectionRow;
    password: string;
    showPassword: boolean;
    saveToKeychain: boolean;
  } | null>(null);

  const filtered = useMemo(() => {
    let list = connections;
    if (projectId) list = list.filter((c) => c.project_id === projectId);
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.engine.toLowerCase().includes(q) ||
        c.host?.toLowerCase().includes(q) ||
        c.database_name?.toLowerCase().includes(q),
    );
  }, [connections, search, projectId]);

  // Group by project_id
  const grouped = useMemo(() => {
    const withProject: DbConnectionRow[] = [];
    const global: DbConnectionRow[] = [];
    for (const c of filtered) {
      if (c.project_id) withProject.push(c);
      else global.push(c);
    }
    return { withProject, global };
  }, [filtered]);

  const handleConnect = async (conn: DbConnectionRow) => {
    // SQLite and credential-linked connections don't need a password prompt
    if (conn.engine === "sqlite" || conn.credential_id) {
      try {
        await connect(conn);
      } catch (err) {
        toast.error(String(err));
      }
      return;
    }

    // Try to get saved keychain password
    try {
      const savedPassword = await invoke<string>("get_db_password", { connectionId: conn.id });
      await connect(conn, savedPassword);
    } catch {
      // No saved password → show prompt
      setPasswordPrompt({ conn, password: "", showPassword: false, saveToKeychain: false });
    }
  };

  const handlePasswordPromptConnect = async () => {
    if (!passwordPrompt) return;
    const { conn, password, saveToKeychain } = passwordPrompt;
    try {
      if (saveToKeychain) {
        await invoke("save_db_password", { connectionId: conn.id, password });
      }
      await connect(conn, password);
      setPasswordPrompt(null);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleDelete = async (id: string) => {
    await invoke("delete_db_password", { connectionId: id }).catch(() => {});
    deleteConnection(id);
  };

  const handleDuplicate = async (conn: DbConnectionRow) => {
    const { createConnection } = useDbStore.getState();
    try {
      await createConnection({
        name: `${conn.name} (Copy)`,
        engine: conn.engine,
        project_id: conn.project_id,
        host: conn.host,
        port: conn.port,
        database_name: conn.database_name,
        username: conn.username,
        credential_id: conn.credential_id,
        credential_field: conn.credential_field,
        use_ssh_tunnel: conn.use_ssh_tunnel,
        ssh_server_id: conn.ssh_server_id,
        ssh_local_port: conn.ssh_local_port,
        use_ssl: conn.use_ssl,
        ssl_mode: conn.ssl_mode,
        ssl_ca_path: conn.ssl_ca_path,
        ssl_cert_path: conn.ssl_cert_path,
        ssl_key_path: conn.ssl_key_path,
        sqlite_file_path: conn.sqlite_file_path,
        color: conn.color,
      });
    } catch {
      // toast handled by store
    }
  };

  return (
    <>
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-[#007AFF] dark:text-[#0A84FF]" />
          <h1 className="text-xl font-semibold">Database</h1>
          <Badge variant="secondary" className="text-xs">
            {connections.length}
          </Badge>
        </div>
        <Button size="sm" onClick={onNewConnection}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Connection
        </Button>
      </div>

      {/* Search */}
      <div className="px-6 pt-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search connections..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Connection cards */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading connections...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Database className="mb-3 h-12 w-12 opacity-30" />
            <p className="text-sm">No database connections yet</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onNewConnection}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Connection
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Project connections */}
            {grouped.withProject.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <FolderKanban className="h-3.5 w-3.5" />
                  Project Connections
                </div>
                <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  {grouped.withProject.map((conn) => (
                    <ConnectionCard
                      key={conn.id}
                      connection={conn}
                      isConnected={isConnected(conn.id)}
                      isConnecting={connecting === conn.id}
                      onConnect={() => handleConnect(conn)}
                      onEdit={() => onEditConnection(conn)}
                      onDuplicate={() => handleDuplicate(conn)}
                      onDelete={() => handleDelete(conn.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Global */}
            {grouped.global.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Database className="h-3.5 w-3.5" />
                  Global Connections
                </div>
                <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  {grouped.global.map((conn) => (
                    <ConnectionCard
                      key={conn.id}
                      connection={conn}
                      isConnected={isConnected(conn.id)}
                      isConnecting={connecting === conn.id}
                      onConnect={() => handleConnect(conn)}
                      onEdit={() => onEditConnection(conn)}
                      onDuplicate={() => handleDuplicate(conn)}
                      onDelete={() => handleDelete(conn.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {/* Password prompt dialog */}
    {passwordPrompt && (
      <Dialog open onOpenChange={() => setPasswordPrompt(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enter Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              No saved password for <span className="font-medium text-foreground">{passwordPrompt.conn.name}</span>. Enter the password to connect.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Password</Label>
              <div className="relative">
                <Input
                  type={passwordPrompt.showPassword ? "text" : "password"}
                  value={passwordPrompt.password}
                  onChange={(e) =>
                    setPasswordPrompt((p) => p ? { ...p, password: e.target.value } : p)
                  }
                  placeholder="Enter password..."
                  className="pr-9"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handlePasswordPromptConnect()}
                />
                <button
                  type="button"
                  onClick={() =>
                    setPasswordPrompt((p) => p ? { ...p, showPassword: !p.showPassword } : p)
                  }
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {passwordPrompt.showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeySquare className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-xs font-normal text-muted-foreground">Save to keychain</Label>
              </div>
              <Switch
                checked={passwordPrompt.saveToKeychain}
                onCheckedChange={(v) =>
                  setPasswordPrompt((p) => p ? { ...p, saveToKeychain: v } : p)
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordPrompt(null)}>
              Cancel
            </Button>
            <Button
              onClick={handlePasswordPromptConnect}
              disabled={connecting === passwordPrompt.conn.id}
            >
              {connecting === passwordPrompt.conn.id ? "Connecting..." : "Connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}

// ── Card ─────────────────────────────────────────────────────────────

interface ConnectionCardProps {
  connection: DbConnectionRow;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function ConnectionCard({
  connection: conn,
  isConnected,
  isConnecting,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
}: ConnectionCardProps) {
  const label = ENGINE_LABELS[conn.engine] ?? conn.engine;
  const colorCls = ENGINE_COLORS[conn.engine] ?? "bg-gray-500/15 text-gray-600";

  const hostDisplay =
    conn.engine === "sqlite"
      ? conn.sqlite_file_path?.split("/").pop() ?? "–"
      : `${conn.host ?? "localhost"}:${conn.port ?? "–"}`;

  return (
    <div className="glass-card group relative flex flex-col gap-2 rounded-xl border border-white/10 p-4 transition-colors hover:border-white/20">
      {/* Top row: name + engine badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 truncate">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                isConnected ? "bg-green-500" : "bg-gray-400",
              )}
            />
            <span className="truncate text-sm font-semibold">{conn.name}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {hostDisplay}
            {conn.database_name && ` · ${conn.database_name}`}
          </div>
        </div>
        <Badge className={cn("shrink-0 text-[10px] font-medium", colorCls)}>{label}</Badge>
      </div>

      {/* Tags row */}
      <div className="flex flex-wrap gap-1.5">
        {conn.use_ssh_tunnel === 1 && (
          <Badge variant="outline" className="text-[10px]">SSH Tunnel</Badge>
        )}
        {conn.use_ssl === 1 && (
          <Badge variant="outline" className="text-[10px]">SSL</Badge>
        )}
      </div>

      {/* Last connected */}
      <div className="text-[11px] text-muted-foreground">
        {conn.last_connected_at
          ? `Last connected ${dayjs(conn.last_connected_at).fromNow()}`
          : "Never connected"}
      </div>

      {/* Actions */}
      <div className="mt-1 flex items-center gap-2">
        <Button
          size="sm"
          variant={isConnected ? "secondary" : "default"}
          className="flex-1"
          disabled={isConnecting}
          onClick={onConnect}
        >
          {isConnecting ? (
            "Connecting..."
          ) : isConnected ? (
            <>
              <Plug className="mr-1.5 h-3.5 w-3.5" />
              Open
            </>
          ) : (
            <>
              <Plug className="mr-1.5 h-3.5 w-3.5" />
              Connect
            </>
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="mr-2 h-4 w-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-500 focus:text-red-500" onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
