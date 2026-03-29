import { useState } from "react";
import {
  Globe,
  Smartphone,
  Key,
  Database,
  Mail,
  CreditCard,
  Lock,
  Settings,
  Server,
  Pencil,
  Trash2,
  FolderKanban,
  Copy,
  CheckCheck,
} from "lucide-react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
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
import { ExpiryBadge } from "./ExpiryBadge";
import type { CredentialRow } from "@/types/db";
import type { CredentialType, CredentialEnvironment } from "@/types/credential";
import {
  CREDENTIAL_TYPE_LABELS,
  ENVIRONMENT_LABELS,
  ENVIRONMENT_COLORS,
} from "@/types/credential";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Globe, Smartphone, Key, Database, Mail, CreditCard, Lock, Settings, Server,
};

const TYPE_ICON_NAMES: Record<CredentialType, string> = {
  web_login: "Globe",
  app_account: "Smartphone",
  api_key: "Key",
  database: "Database",
  email: "Mail",
  license: "CreditCard",
  secure_note: "Lock",
  env_vars: "Settings",
  server_access: "Server",
};

interface CredentialCardProps {
  credential: CredentialRow;
  projectName?: string | null;
  onEdit: (credential: CredentialRow) => void;
  onDelete: (id: string) => void;
  onClick: (credential: CredentialRow) => void;
}

export function CredentialCard({
  credential,
  projectName,
  onEdit,
  onDelete,
  onClick,
}: CredentialCardProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const type = credential.type as CredentialType;
  const env = (credential.environment ?? "none") as CredentialEnvironment;
  const iconName = TYPE_ICON_NAMES[type] ?? "Key";
  const Icon = ICON_MAP[iconName] ?? Key;
  const envColor = ENVIRONMENT_COLORS[env];

  const handleCopyUsername = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!credential.username) return;
    try {
      await invoke("credential_copy_plain_to_clipboard", { value: credential.username });
      setCopied(true);
      toast.success(`Copied username`, { duration: 2000 });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleCopyUrl = async () => {
    if (!credential.url) return;
    try {
      await invoke("credential_copy_plain_to_clipboard", { value: credential.url });
      toast.success("Copied URL", { duration: 2000 });
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onClick={() => onClick(credential)}
            className="group relative cursor-pointer rounded-xl border border-border/60 bg-card p-4 transition-all hover:border-border hover:shadow-sm"
          >
            {/* Header */}
            <div className="mb-2 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${envColor}15` }}
                >
                  <Icon className="h-4 w-4" style={{ color: envColor }} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold leading-tight">
                    {credential.name}
                  </h3>
                  {credential.username && (
                    <p className="truncate text-xs text-muted-foreground">
                      {credential.username}
                    </p>
                  )}
                </div>
              </div>
              {/* Quick copy username — visible on hover */}
              {credential.username && (
                <button
                  type="button"
                  onClick={handleCopyUsername}
                  className="opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-all"
                  title="Copy username"
                >
                  {copied ? (
                    <CheckCheck className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {CREDENTIAL_TYPE_LABELS[type]}
              </Badge>
              {env !== "none" && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0"
                  style={{ borderColor: `${envColor}40`, color: envColor }}
                >
                  {ENVIRONMENT_LABELS[env]}
                </Badge>
              )}
              {credential.has_totp === 1 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
                  <Key className="h-2.5 w-2.5" />
                  2FA
                </Badge>
              )}
              {projectName && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                  <FolderKanban className="h-2.5 w-2.5" />
                  {projectName}
                </Badge>
              )}
              {credential.expires_at && (
                <ExpiryBadge expiresAt={credential.expires_at} />
              )}
            </div>

            {/* Updated time */}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Updated {dayjs(credential.updated_at).fromNow()}
            </p>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onClick(credential)}>
            View Details
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onEdit(credential)}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit
          </ContextMenuItem>
          {(credential.username || credential.url) && <ContextMenuSeparator />}
          {credential.username && (
            <ContextMenuItem onClick={handleCopyUsername}>
              <Copy className="mr-2 h-3.5 w-3.5" />
              Copy Username
            </ContextMenuItem>
          )}
          {credential.url && (
            <ContextMenuItem onClick={handleCopyUrl}>
              <Copy className="mr-2 h-3.5 w-3.5" />
              Copy URL
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive"
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
            <AlertDialogTitle>Delete credential?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &ldquo;{credential.name}&rdquo; and all its fields.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDelete(credential.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
