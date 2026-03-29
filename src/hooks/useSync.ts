import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useSyncStore, SyncEventPayload } from "@/stores/syncStore";
import { useSettingsStore } from "@/stores/settingsStore";

export function useSync() {
  const { status, lastSyncedAt, errorMessage, durationMs, handleSyncEvent, setStatus, setError } =
    useSyncStore();
  const { getSetting, setSetting, loaded, loadSettings } = useSettingsStore();
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Listen for sync status events from Rust backend
  useEffect(() => {
    let cancelled = false;
    listen<SyncEventPayload>("sync-status-changed", (event) => {
      if (!cancelled) {
        handleSyncEvent(event.payload);
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    });

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, [handleSyncEvent]);

  // Load settings on mount
  useEffect(() => {
    if (!loaded) loadSettings();
  }, [loaded, loadSettings]);

  const syncEnabled = getSetting("sync_enabled", "false") === "true";
  const syncUrl = getSetting("sync_turso_url", "");
  const syncInterval = getSetting("sync_interval_minutes", "5");
  const syncOnLaunch = getSetting("sync_on_launch", "true") === "true";
  const syncOnClose = getSetting("sync_on_close", "true") === "true";
  const showStatus = getSetting("sync_show_status", "true") === "true";

  const triggerSync = useCallback(async () => {
    try {
      setStatus("syncing");
      await invoke("db_sync");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [setStatus, setError]);

  const testConnection = useCallback(async (url: string, token: string) => {
    return await invoke<{ ok: boolean; latency_ms: number }>("test_sync_connection", {
      url,
      token,
    });
  }, []);

  const enableSync = useCallback(
    async (url: string, token: string, intervalMinutes: number) => {
      // Save token to keychain
      await invoke("save_sync_token", { token });

      // Save settings — these go to badami.db (still the active connection)
      await setSetting("sync_turso_url", url);
      await setSetting("sync_interval_minutes", String(intervalMinutes));
      await setSetting("sync_enabled", "true");

      // Enable sync in Rust backend — switches active connection to badami_sync.db
      const result = await invoke<{ success: boolean; duration_ms: number }>(
        "db_enable_sync",
        {
          url,
          syncIntervalMinutes: intervalMinutes,
        },
      );

      // Connection is now to badami_sync.db. Re-write ALL settings that were
      // previously in badami.db so they survive reload — otherwise loadSettings()
      // on next launch/reload reads from badami_sync.db which is empty at this point.
      const allSettings = useSettingsStore.getState().settings;
      for (const [key, value] of Object.entries(allSettings)) {
        await setSetting(key, value);
      }

      setStatus("synced");
      return result;
    },
    [setSetting, setStatus],
  );

  const disableSync = useCallback(async () => {
    // Snapshot settings before connection switches back to badami.db
    const currentSettings = { ...useSettingsStore.getState().settings };

    await invoke("db_disable_sync");
    await invoke("delete_sync_token");

    // Connection is now to badami.db. Re-write all settings from the sync DB
    // so nothing is lost (tasks/projects data caveat is separate, but settings
    // like pomodoro config, theme, etc. should be preserved).
    for (const [key, value] of Object.entries(currentSettings)) {
      if (key !== "sync_enabled") {
        await setSetting(key, value);
      }
    }
    await setSetting("sync_enabled", "false");

    setStatus("disabled");
  }, [setSetting, setStatus]);

  const updateSyncInterval = useCallback(
    async (minutes: number) => {
      await setSetting("sync_interval_minutes", String(minutes));
      // If sync is enabled, re-enable with new interval
      if (syncEnabled && syncUrl) {
        try {
          const token = await invoke<string | null>("get_sync_token");
          if (token) {
            await invoke("db_enable_sync", {
              url: syncUrl,
              syncIntervalMinutes: minutes,
            });
          }
        } catch {
          // If re-enable fails, keep the setting change
        }
      }
    },
    [setSetting, syncEnabled, syncUrl],
  );

  return {
    // State
    status: syncEnabled ? status : "disabled",
    lastSyncedAt,
    errorMessage,
    durationMs,
    syncEnabled,
    syncUrl,
    syncInterval: parseInt(syncInterval) || 5,
    syncOnLaunch,
    syncOnClose,
    showStatus,

    // Actions
    triggerSync,
    testConnection,
    enableSync,
    disableSync,
    updateSyncInterval,
    setSyncOnLaunch: (v: boolean) => setSetting("sync_on_launch", v ? "true" : "false"),
    setSyncOnClose: (v: boolean) => setSetting("sync_on_close", v ? "true" : "false"),
    setShowStatus: (v: boolean) => setSetting("sync_show_status", v ? "true" : "false"),
  };
}
