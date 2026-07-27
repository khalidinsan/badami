import { useCallback, useRef, useState } from "react";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface UpdaterState {
  status: UpdaterStatus;
  /** Remote version string when an update is available */
  version: string | null;
  notes: string | null;
  /** 0–100 while downloading; null otherwise */
  progress: number | null;
  error: string | null;
}

const INITIAL: UpdaterState = {
  status: "idle",
  version: null,
  notes: null,
  progress: null,
  error: null,
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err ?? "Unknown error");
  }
}

/**
 * In-app updater backed by GitHub Releases (`latest.json`).
 *
 * Flow: check → downloadAndInstall → relaunch.
 * Signing is verified against the pubkey in `tauri.conf.json`.
 */
export function useAppUpdater() {
  const [state, setState] = useState<UpdaterState>(INITIAL);
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);

  const checkForUpdates = useCallback(async (opts?: { silent?: boolean }) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setState((s) => ({
      ...s,
      status: "checking",
      error: null,
      progress: null,
    }));

    try {
      const update = await check();
      if (!update) {
        setState({
          status: "up-to-date",
          version: null,
          notes: null,
          progress: null,
          error: null,
        });
        updateRef.current = null;
        return null;
      }

      updateRef.current = update;
      setState({
        status: "available",
        version: update.version,
        notes: update.body ?? null,
        progress: null,
        error: null,
      });
      return update;
    } catch (err) {
      // In dev / unsigned builds, check often fails — surface only when not silent.
      const msg = errorMessage(err);
      setState({
        status: "error",
        version: null,
        notes: null,
        progress: null,
        error: opts?.silent ? null : msg,
      });
      if (!opts?.silent) {
        // keep status error for UI
      }
      return null;
    } finally {
      busyRef.current = false;
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!update || busyRef.current) return;
    busyRef.current = true;

    setState((s) => ({
      ...s,
      status: "downloading",
      progress: 0,
      error: null,
    }));

    try {
      let contentLength: number | undefined;
      let downloaded = 0;

      await update.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength;
            setState((s) => ({ ...s, status: "downloading", progress: 0 }));
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength && contentLength > 0) {
              const pct = Math.min(100, Math.round((downloaded / contentLength) * 100));
              setState((s) => ({ ...s, progress: pct }));
            }
            break;
          case "Finished":
            setState((s) => ({ ...s, status: "installing", progress: 100 }));
            break;
        }
      });

      // Install finished — relaunch into the new binary.
      await relaunch();
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: errorMessage(err),
        progress: null,
      }));
    } finally {
      busyRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    updateRef.current = null;
    setState(INITIAL);
  }, []);

  return {
    ...state,
    checkForUpdates,
    downloadAndInstall,
    reset,
  };
}
