import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { v4 as uuidv4 } from "uuid";

export type SshConnectionStatus = "idle" | "connecting" | "connected" | "disconnected";

interface UseSshSessionOptions {
  host: string;
  port: number;
  username: string;
  authType: string;
  onOutput: (data: string) => void;
  onStatusChange?: (status: SshConnectionStatus) => void;
}

export function useSshSession({
  host,
  port,
  username,
  authType,
  onOutput,
  onStatusChange,
}: UseSshSessionOptions) {
  const [status, setStatus] = useState<SshConnectionStatus>("idle");
  const [sessionId] = useState(() => uuidv4());
  const [connectedAt, setConnectedAt] = useState<number | null>(null);

  // statusRef lets write/resize/connect avoid stale closures without
  // needing `status` in their dependency arrays.
  const statusRef = useRef<SshConnectionStatus>("idle");
  // Keep callbacks fresh without re-creating dependent functions
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const updateStatus = useCallback((s: SshConnectionStatus) => {
    statusRef.current = s;
    setStatus(s);
    onStatusChangeRef.current?.(s);
  }, []);

  // Register Tauri event listeners once per sessionId — NOT inside connect().
  // This prevents duplicate listener accumulation on React StrictMode re-runs.
  useEffect(() => {
    let active = true;
    let unlistenOutput: UnlistenFn | undefined;
    let unlistenStatus: UnlistenFn | undefined;

    (async () => {
      unlistenOutput = await listen<string>(`ssh-output-${sessionId}`, (event) => {
        if (active) onOutputRef.current(event.payload);
      });
      unlistenStatus = await listen<string>(`ssh-status-${sessionId}`, (event) => {
        if (!active) return;
        if (event.payload === "connected") {
          updateStatus("connected");
          setConnectedAt(Date.now());
        } else if (event.payload === "disconnected") {
          // Ignore the spurious "disconnected" emitted by our own
          // ssh_disconnect during cleanup if we never actually connected.
          if (statusRef.current !== "idle") {
            updateStatus("disconnected");
          }
          setConnectedAt(null);
        }
      });
    })();

    return () => {
      active = false;
      unlistenOutput?.();
      unlistenStatus?.();
      invoke("ssh_disconnect", { sessionId }).catch(() => {});
    };
  }, [sessionId, updateStatus]);

  const connect = useCallback(
    async (password?: string, pemContent?: string, passphrase?: string) => {
      // Guard: prevent double-connect (e.g. React StrictMode double-effect)
      if (statusRef.current === "connecting" || statusRef.current === "connected") return;
      updateStatus("connecting");
      try {
        await invoke("ssh_connect", {
          sessionId,
          host,
          port,
          username,
          authType,
          password: password ?? null,
          pemContent: pemContent ?? null,
          passphrase: passphrase ?? null,
          cols: 80,
          rows: 24,
        });
      } catch (err) {
        updateStatus("disconnected");
        throw err;
      }
    },
    [sessionId, host, port, username, authType, updateStatus],
  );

  // Stable write — depends only on sessionId; reads status via statusRef so
  // the xterm onData closure never goes stale even though it captures this
  // function once at terminal init time.
  const write = useCallback(
    async (data: string) => {
      if (statusRef.current !== "connected") return;
      await invoke("ssh_write", { sessionId, data });
    },
    [sessionId],
  );

  // Stable resize — same pattern as write.
  const resize = useCallback(
    async (cols: number, rows: number) => {
      if (statusRef.current !== "connected") return;
      try {
        await invoke("ssh_resize", { sessionId, cols, rows });
      } catch {
        // ignore transient resize errors
      }
    },
    [sessionId],
  );

  const disconnect = useCallback(async () => {
    try {
      await invoke("ssh_disconnect", { sessionId });
    } catch {
      // ignore
    }
    updateStatus("disconnected");
    setConnectedAt(null);
  }, [sessionId, updateStatus]);

  return {
    sessionId,
    status,
    connectedAt,
    connect,
    write,
    resize,
    disconnect,
  };
}
