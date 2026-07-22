import { useState } from "react";
import { Database, Loader2, ExternalLink, Eye, EyeOff } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
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
import { useLocalDevStore } from "@/stores/localDevStore";
import { useDbStore } from "@/stores/dbStore";
import { useAppTabStore } from "@/stores/appTabStore";
import { DEFAULT_LOCAL_DEV_SETTINGS } from "@/types/localDev";

interface RegisterMariaDbButtonProps {
  /** Compact size for ServiceCard */
  compact?: boolean;
  className?: string;
  /** Show only when MariaDB appears healthy; parent may gate visibility */
  disabled?: boolean;
}

/**
 * Register local MariaDB as a Database connection (keychain-aware).
 * Probe empty root password first; prompt only if needed.
 */
export function RegisterMariaDbButton({
  compact = false,
  className,
  disabled = false,
}: RegisterMariaDbButtonProps) {
  const registerBusy = useLocalDevStore((s) => s.registerBusy);
  const registerMariaDb = useLocalDevStore((s) => s.registerMariaDb);
  const settings = useLocalDevStore((s) => s.settings);
  const navigate = useNavigate();

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [lastConnectionId, setLastConnectionId] = useState<string | null>(
    () =>
      settings.mariadb_connection_id ||
      DEFAULT_LOCAL_DEV_SETTINGS.mariadb_connection_id ||
      null,
  );

  const alreadyRegistered = !!(
    settings.mariadb_connection_id || lastConnectionId
  );

  const openDatabase = (connectionId: string) => {
    useDbStore.getState().setActiveConnection(connectionId);
    useDbStore.getState().setViewMode("connections");
    void useDbStore.getState().loadConnections();
    useAppTabStore.getState().openTab({
      type: "database",
      title: "Database",
      icon: "Database",
      route: "/database",
    });
    void navigate({ to: "/database" });
  };

  const runRegister = async (pwd: string) => {
    const result = await registerMariaDb(pwd);
    if (!result) return;
    if (result.connectionId) {
      setLastConnectionId(result.connectionId);
      setPasswordOpen(false);
      setPassword("");
    } else if (result.needsPassword) {
      setPasswordOpen(true);
    }
  };

  return (
    <>
      <div className={className}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={compact ? "outline" : "default"}
            className={
              compact
                ? "h-7 gap-1 px-2 text-[11px]"
                : "h-8 gap-1.5 text-xs"
            }
            disabled={disabled || registerBusy}
            onClick={() => void runRegister("")}
          >
            {registerBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Database className="h-3 w-3" />
            )}
            {alreadyRegistered ? "Re-register in Database" : "Register in Database"}
          </Button>
          {alreadyRegistered && (settings.mariadb_connection_id || lastConnectionId) && (
            <Button
              size="sm"
              variant="ghost"
              className={
                compact
                  ? "h-7 gap-1 px-2 text-[11px]"
                  : "h-8 gap-1.5 text-xs"
              }
              onClick={() =>
                openDatabase(
                  settings.mariadb_connection_id || lastConnectionId || "",
                )
              }
            >
              <ExternalLink className="h-3 w-3" />
              Open Database
            </Button>
          )}
        </div>
      </div>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>MariaDB root password</DialogTitle>
            <DialogDescription>
              Empty root password was rejected. Enter the password for{" "}
              <span className="font-mono">root@127.0.0.1:3306</span>. It is stored
              only in the OS keychain (never in SQLite).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="mariadb-root-password" className="text-xs">
              Password
            </Label>
            <div className="relative">
              <Input
                id="mariadb-root-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-9 text-xs"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && password) {
                    void runRegister(password);
                  }
                }}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Leave empty only if you want to retry empty-password auth. Password
              is saved via <code className="text-[10px]">save_db_password</code>{" "}
              when non-empty.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPasswordOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={registerBusy}
              onClick={() => void runRegister(password)}
            >
              {registerBusy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Probe &amp; register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Optional: clear keychain entry for a connection (not used in happy path). */
export async function deleteMariaDbKeychain(connectionId: string): Promise<void> {
  await invoke("delete_db_password", { connectionId }).catch(() => {});
}
