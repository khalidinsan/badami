import { useState, useEffect } from "react";
import {
  RefreshCw,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Wifi,
  WifiOff,
  Info,
  Rocket,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSync } from "@/hooks/useSync";
import { TursoDatabaseCreator } from "./TursoDatabaseCreator";
import { invoke } from "@tauri-apps/api/core";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

type SetupTab = "quick" | "manual";

export function SyncSettingsPanel() {
  const {
    status,
    lastSyncedAt,
    errorMessage,
    durationMs,
    syncEnabled,
    syncUrl,
    syncInterval,
    syncOnLaunch,
    syncOnClose,
    showStatus,
    triggerSync,
    testConnection,
    enableSync,
    disableSync,
    updateSyncInterval,
    setSyncOnLaunch,
    setSyncOnClose,
    setShowStatus,
  } = useSync();

  const [url, setUrl] = useState(syncUrl);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latency_ms?: number;
    error?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [showSetupInfo, setShowSetupInfo] = useState(false);
  const [setupTab, setSetupTab] = useState<SetupTab>("quick");
  const [syncDbSize, setSyncDbSize] = useState<number | null>(null);

  // Fetch sync stats when enabled
  useEffect(() => {
    if (!syncEnabled) return;
    invoke<{ sync_db_size?: number }>("db_get_sync_status")
      .then((r) => setSyncDbSize(r.sync_db_size ?? null))
      .catch(() => {});
  }, [syncEnabled, status]);

  const handleTest = async () => {
    if (!url || !token) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(url, token);
      setTestResult(result);
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleEnable = async () => {
    if (!url || !token) {
      setSaveError("URL and token are required");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await enableSync(url, token, syncInterval);
      setToken(""); // Clear token from state after saving to keychain
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    setDisabling(true);
    try {
      await disableSync();
      setUrl("");
      setToken("");
      setTestResult(null);
      setShowDisableConfirm(false);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setDisabling(false);
    }
  };

  const statusIndicator = () => {
    switch (status) {
      case "synced":
        return (
          <span className="flex items-center gap-1.5 text-xs text-green-500">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Synced
          </span>
        );
      case "syncing":
        return (
          <span className="flex items-center gap-1.5 text-xs text-blue-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Syncing...
          </span>
        );
      case "pending":
        return (
          <span className="flex items-center gap-1.5 text-xs text-yellow-500">
            <span className="h-2 w-2 rounded-full bg-yellow-500" />
            Pending
          </span>
        );
      case "offline":
        return (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <WifiOff className="h-3 w-3" />
            Offline
          </span>
        );
      case "error":
        return (
          <span className="flex items-center gap-1.5 text-xs text-red-500">
            <AlertCircle className="h-3 w-3" />
            Error
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
            Not configured
          </span>
        );
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Status</span>
        </div>
        {statusIndicator()}
      </div>

      {syncEnabled && lastSyncedAt && (
        <p className="text-xs text-muted-foreground">
          Last synced: {dayjs(lastSyncedAt).fromNow()}
          {durationMs != null && ` (${durationMs}ms)`}
        </p>
      )}

      {syncEnabled && errorMessage && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <p className="text-xs text-red-500">{formatSyncError(errorMessage)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {getSyncErrorHint(errorMessage)}
          </p>
        </div>
      )}

      <Separator />

      {!syncEnabled ? (
        <>
          {/* Setup tabs */}
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Sync your data across devices using Turso (SQLite cloud).
            </p>

            {/* Tab switcher */}
            <div className="flex gap-1 rounded-lg bg-muted/30 p-0.5">
              <button
                onClick={() => setSetupTab("quick")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  setupTab === "quick"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Rocket className="h-3 w-3" />
                Quick Setup
              </button>
              <button
                onClick={() => setSetupTab("manual")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  setupTab === "manual"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Settings2 className="h-3 w-3" />
                Manual Setup
              </button>
            </div>

            {setupTab === "quick" ? (
              <TursoDatabaseCreator
                onUseDatabase={(dbUrl, dbToken) => {
                  setUrl(dbUrl);
                  setToken(dbToken);
                  setSetupTab("manual");
                  setTestResult(null);
                  setSaveError("");
                }}
              />
            ) : (
              <>
                <div className="flex items-center justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs"
                    onClick={() => setShowSetupInfo(!showSetupInfo)}
                  >
                    <Info className="h-3 w-3" />
                    How to setup
                  </Button>
                </div>

                {showSetupInfo && (
                  <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">Setup guide:</p>
                    <ol className="list-decimal list-inside space-y-0.5">
                      <li>
                        Create a free account at{" "}
                        <span className="font-mono text-primary">turso.tech</span>
                      </li>
                      <li>Create a new database from the Turso dashboard</li>
                      <li>Generate an auth token for that database</li>
                      <li>Paste the database URL and token below</li>
                    </ol>
                    <p className="pt-1">
                      Use the same URL and token on all your devices to sync data
                      between them.
                    </p>
                  </div>
                )}

            <div>
              <Label htmlFor="sync-url" className="text-xs">
                Turso Database URL
              </Label>
              <Input
                id="sync-url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setTestResult(null);
                  setSaveError("");
                }}
                placeholder="libsql://your-db.turso.io"
                className="mt-1 h-8 text-sm font-mono"
              />
            </div>

            <div>
              <Label htmlFor="sync-token" className="text-xs">
                Auth Token
              </Label>
              <div className="relative mt-1">
                <Input
                  id="sync-token"
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setTestResult(null);
                    setSaveError("");
                  }}
                  placeholder="eyJhbGciOiJFZERTQSIs..."
                  className="h-8 pr-9 text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Test result */}
            {testResult && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  testResult.ok
                    ? "border-green-500/20 bg-green-500/5 text-green-600 dark:text-green-400"
                    : "border-red-500/20 bg-red-500/5 text-red-500"
                }`}
              >
                {testResult.ok ? (
                  <span className="flex items-center gap-1.5">
                    <Check className="h-3 w-3" />
                    Connected ({testResult.latency_ms}ms latency)
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="h-3 w-3" />
                    {testResult.error}
                  </span>
                )}
              </div>
            )}

            {saveError && (
              <p className="text-xs text-red-500">{saveError}</p>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={handleTest}
                disabled={testing || !url || !token}
              >
                {testing ? (
                  <>
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Wifi className="mr-1.5 h-3 w-3" />
                    Test Connection
                  </>
                )}
              </Button>
              <Button
                size="sm"
                className="text-xs"
                onClick={handleEnable}
                disabled={saving || !url || !token}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    Enabling...
                  </>
                ) : (
                  "Save & Enable Sync"
                )}
              </Button>
            </div>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Sync enabled — show config + controls */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">Database</p>
                <p className="text-xs text-muted-foreground font-mono truncate max-w-[300px]">
                  {syncUrl}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={triggerSync}
                  disabled={status === "syncing"}
                >
                  {status === "syncing" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Sync Now
                </Button>
              </div>
            </div>

            {/* Sync stats */}
            {(durationMs != null || syncDbSize != null) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {durationMs != null && (
                  <span>Last sync: {durationMs}ms</span>
                )}
                {syncDbSize != null && syncDbSize > 0 && (
                  <span>Database: {formatBytes(syncDbSize)}</span>
                )}
              </div>
            )}

            <Separator />

            {/* Sync interval */}
            <div className="flex items-center justify-between">
              <Label className="text-sm">Sync interval</Label>
              <Select
                value={String(syncInterval)}
                onValueChange={(v) => updateSyncInterval(parseInt(v))}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Manual only</SelectItem>
                  <SelectItem value="1">Every 1 min</SelectItem>
                  <SelectItem value="5">Every 5 min</SelectItem>
                  <SelectItem value="15">Every 15 min</SelectItem>
                  <SelectItem value="30">Every 30 min</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Toggles */}
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="sync-on-launch" className="text-sm">
                  Sync on app launch
                </Label>
                <p className="text-xs text-muted-foreground">
                  Pull latest data when Badami starts
                </p>
              </div>
              <Switch
                id="sync-on-launch"
                checked={syncOnLaunch}
                onCheckedChange={setSyncOnLaunch}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="sync-on-close" className="text-sm">
                  Sync on app close
                </Label>
                <p className="text-xs text-muted-foreground">
                  Push changes before Badami quits
                </p>
              </div>
              <Switch
                id="sync-on-close"
                checked={syncOnClose}
                onCheckedChange={setSyncOnClose}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="sync-show-status" className="text-sm">
                  Show sync status in sidebar
                </Label>
                <p className="text-xs text-muted-foreground">
                  Display sync indicator at the bottom of the sidebar
                </p>
              </div>
              <Switch
                id="sync-show-status"
                checked={showStatus}
                onCheckedChange={setShowStatus}
              />
            </div>

            <Separator />

            {/* Disable sync */}
            {!showDisableConfirm ? (
              <Button
                variant="outline"
                size="sm"
                className="text-xs text-destructive hover:text-destructive"
                onClick={() => setShowDisableConfirm(true)}
              >
                Disable Sync
              </Button>
            ) : (
              <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs text-destructive font-medium">
                  Disable sync? Your data will remain stored locally — nothing
                  will be deleted.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => setShowDisableConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="text-xs"
                    onClick={handleDisable}
                    disabled={disabling}
                  >
                    {disabling ? (
                      <>
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        Disabling...
                      </>
                    ) : (
                      "Confirm Disable"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function formatSyncError(error: string): string {
  if (error.includes("Token not found")) return "Auth token missing or expired";
  if (error.includes("Connection failed")) return "Cannot connect to Turso database";
  if (error.includes("Failed to open replica")) return "Failed to open sync replica";
  if (error.includes("Sync failed")) return "Sync failed — check your connection";
  return error;
}

function getSyncErrorHint(error: string): string {
  if (error.includes("Token not found"))
    return "Re-enter your token or generate a new one from Turso dashboard.";
  if (error.includes("Connection failed"))
    return "Check your database URL and internet connection.";
  if (error.includes("Failed to open replica"))
    return "The database URL may be invalid. Try disabling and re-enabling sync.";
  if (error.includes("Sync failed"))
    return "Will retry automatically. You can also try 'Sync Now' manually.";
  return "Try 'Sync Now' or check your Turso dashboard for details.";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
