import { useState } from "react";
import {
  Terminal,
  FolderOpen,
  Pencil,
  Trash2,
  Clock,
  Server,
  FolderKanban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import type { ServerCredentialRow } from "@/types/db";
import {
  ENVIRONMENT_LABELS,
  type ServerEnvironment,
} from "@/types/server";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

interface ServerCardProps {
  server: ServerCredentialRow;
  projectName?: string | null;
  onEdit: (server: ServerCredentialRow) => void;
  onDelete: (id: string) => void;
  onOpenTerminal?: (server: ServerCredentialRow) => void;
  onOpenFileManager?: (server: ServerCredentialRow) => void;
}

export function ServerCard({
  server,
  projectName,
  onEdit,
  onDelete,
  onOpenTerminal,
  onOpenFileManager,
}: ServerCardProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const env = server.environment as ServerEnvironment;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="group relative rounded-xl border border-border/60 bg-card p-4 transition-all hover:border-border hover:shadow-sm cursor-default"
          >
            {/* Header */}
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${server.color ?? "#6b7280"}20` }}
                >
                  <Server
                    className="h-4 w-4"
                    style={{ color: server.color ?? "#6b7280" }}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold leading-tight">{server.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {server.host} · port {server.port} · {server.username}
                  </p>
                </div>
              </div>
            </div>

            {/* Meta */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {server.protocol.toUpperCase()}
              </Badge>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0"
                style={{ borderColor: `${server.color ?? "#6b7280"}40`, color: server.color ?? "#6b7280" }}
              >
                {ENVIRONMENT_LABELS[env] ?? env}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
                {server.auth_type.replace("_", " ")}
              </Badge>
              {projectName && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                  <FolderKanban className="h-2.5 w-2.5" />
                  {projectName}
                </Badge>
              )}
            </div>

            {/* Last connected */}
            {server.last_connected_at && (
              <div className="mb-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                Last connected {dayjs(server.last_connected_at).fromNow()}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => onOpenTerminal?.(server)}
                disabled={server.protocol !== "ssh"}
              >
                <Terminal className="h-3 w-3" />
                Terminal
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={() => onOpenFileManager?.(server)}
              >
                <FolderOpen className="h-3 w-3" />
                Files
              </Button>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onEdit(server)}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Server</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{server.name}&quot;? This will remove the credential
              and all associated bookmarks. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onDelete(server.id);
                setDeleteOpen(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
