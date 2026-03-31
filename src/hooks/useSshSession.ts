import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { v4 as uuidv4 } from "uuid";

export type SshConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "reconnecting";

const BACKOFF_DELAYS = [2000, 5000, 10000, 30000, 30000]; // ms

interface UseSshSessionOptions {
  host: string;
  port: number;
  username: string;
  authType: string;
  onOutput: (data: string) => void;
  onStatusChange?: (status: SshConnectionStatus) => void;
  /** Enable auto-reconnect on unexpected disconnect. Default: true */
  autoReconnect?: boolean;
  /** Max reconnect attempts. Default: 5 */
  maxReconnectAttempts?: number;
}

export function useSshSession({
  host,
  port,
  username,
  authType,
  onOutput,
  onStatusChange,
  autoReconnect = true,
  maxReconnectAttempts = 5,
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

  // Auto-reconnect state
  const manualDisconnectRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateStatus = useCallback((s: SshConnectionStatus) => {
    statusRef.current = s;
    setStatus(s);
    onStatusChangeRef.current?.(s);
  }, []);

  const cancelReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
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
          // Reset reconnect counter on successful connection
          reconnectAttemptRef.current = 0;
        } else if (event.payload === "disconnected") {
          // Ignore the spurious "disconnected" emitted by our own
          // ssh_disconnect during cleanup if we never actually connected.
          if (statusRef.current === "idle") return;

          const wasConnected = statusRef.current === "connected";
          updateStatus("disconnected");
          setConnectedAt(null);

          // Auto-reconnect if appropriate
          if (
            wasConnected &&
            autoReconnect &&
            !manualDisconnectRef.current &&
            reconnectAttemptRef.current < maxReconnectAttempts
          ) {
            const attempt = reconnectAttemptRef.current;
            const delay = BACKOFF_DELAYS[Math.min(attempt, BACKOFF_DELAYS.length - 1)];
            reconnectAttemptRef.current = attempt + 1;

            // Show countdown in terminal
            const delaySec = Math.round(delay / 1000);
            onOutputRef.current(
              `\r\n\x1b[33mReconnecting in ${delaySec}s... (attempt ${attempt + 1}/${maxReconnectAttempts})\x1b[0m\r\n`,
            );
            updateStatus("reconnecting");

            reconnectTimerRef.current = setTimeout(async () => {
              if (!active || manualDisconnectRef.current) return;
              try {
                await invoke("ssh_connect", {
                  sessionId,
                  host,
                  port,
                  username,
                  authType,
                  password: null,
                  pemContent: null,
                  passphrase: null,
                  cols: 80,
                  rows: 24,
                });
              } catch {
                // Connection will emit "disconnected" event again, which
                // will trigger the next backoff attempt automatically.
                if (active && !manualDisconnectRef.current) {
                  updateStatus("disconnected");
                }
              }
            }, delay);
          }
        }
      });
    })();

    return () => {
      active = false;
      cancelReconnect();
      unlistenOutput?.();
      unlistenStatus?.();
      invoke("ssh_disconnect", { sessionId }).catch(() => {});
    };
  }, [sessionId, updateStatus, autoReconnect, maxReconnectAttempts, host, port, username, authType, cancelReconnect]);

  const connect = useCallback(
    async (password?: string, pemContent?: string, passphrase?: string) => {
      // Guard: prevent double-connect (e.g. React StrictMode double-effect)
      if (statusRef.current === "connecting" || statusRef.current === "connected") return;
      manualDisconnectRef.current = false;
      cancelReconnect();
      reconnectAttemptRef.current = 0;
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
    [sessionId, host, port, username, authType, updateStatus, cancelReconnect],
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
    manualDisconnectRef.current = true;
    cancelReconnect();
    try {
      await invoke("ssh_disconnect", { sessionId });
    } catch {
      // ignore
    }
    updateStatus("disconnected");
    setConnectedAt(null);
  }, [sessionId, updateStatus, cancelReconnect]);

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
