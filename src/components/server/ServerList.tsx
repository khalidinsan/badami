import { useEffect, useState } from "react";
import { Plus, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerCard } from "./ServerCard";
import { ServerForm } from "./ServerForm";
import { ServerSessionTabs } from "./ServerSessionTabs";
import { useServerStore } from "@/stores/serverStore";
import { invoke } from "@tauri-apps/api/core";
import type { ServerCredentialRow } from "@/types/db";
import { toast } from "sonner";

interface ServerListProps {
  projectId?: string;
}

export function ServerList({ projectId }: ServerListProps) {
  const { servers, loading, loadServers, loadAllServers, deleteServer } = useServerStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerCredentialRow | null>(null);
  const [sessionInit, setSessionInit] = useState<{
    server: ServerCredentialRow;
    type: "terminal" | "files";
  } | null>(null);

  const reload = () => {
    if (projectId) {
      loadServers(projectId);
    } else {
      loadAllServers();
    }
  };

  useEffect(() => {
    reload();
  }, [projectId]);

  const handleEdit = (server: ServerCredentialRow) => {
    setEditingServer(server);
    setFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_server_password", { serverId: id });
    } catch { /* ignore */ }
    try {
      await invoke("delete_server_passphrase", { serverId: id });
    } catch { /* ignore */ }
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

  const handleFormClose = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setEditingServer(null);
      reload();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Loading servers...
      </div>
    );
  }

  // Full-content session view
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
          projectId={projectId}
          server={editingServer}
        />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <div className="p-6">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Servers
            </h2>
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => {
                setEditingServer(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-3 w-3" />
              Add Server
            </Button>
          </div>

          {/* List */}
          {servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 py-12">
              <Server className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="mb-1 text-sm font-medium text-muted-foreground">
                No servers yet
              </p>
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
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {servers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onOpenTerminal={handleOpenTerminal}
                  onOpenFileManager={handleOpenFileManager}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Form */}
      <ServerForm
        open={formOpen}
        onOpenChange={handleFormClose}
        projectId={projectId}
        server={editingServer}
      />
    </div>
  );
}
