import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { v4 as uuidv4 } from "uuid";

export type SshConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

const BACKOFF_DELAYS = [2000, 5000, 10000, 30000, 30000]; // ms

interface CachedCredentials {
  password: string | null;
  pemContent: string | null;
  passphrase: string | null;
}

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
  /** SSH keepalive interval in seconds. Default: 30 */
  keepaliveSecs?: number;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err ?? "unknown error");
  }
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
  keepaliveSecs = 30,
}: UseSshSessionOptions) {
  const [status, setStatus] = useState<SshConnectionStatus>("idle");
  const [sessionId] = useState(() => uuidv4());
  const [connectedAt, setConnectedAt] = useState<number | null>(null);

  const statusRef = useRef<SshConnectionStatus>("idle");
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // Cached secrets for auto-reconnect (cleared on manual disconnect / cleanup).
  const credentialsRef = useRef<CachedCredentials | null>(null);
  // Last known PTY size — updated on every resize().
  const terminalSizeRef = useRef({ cols: 80, rows: 24 });

  // Connection params as refs so the listener effect does not tear down the
  // session when settings (e.g. keepaliveSecs) change mid-session.
  const connectParamsRef = useRef({
    host,
    port,
    username,
    authType,
    autoReconnect,
    maxReconnectAttempts,
    keepaliveSecs,
  });
  connectParamsRef.current = {
    host,
    port,
    username,
    authType,
    autoReconnect,
    maxReconnectAttempts,
    keepaliveSecs,
  };

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

  const clearCredentials = useCallback(() => {
    credentialsRef.current = null;
  }, []);

  // Listeners once per sessionId. Params/creds read from refs so settings
  // changes do not re-run this effect and kill the live session.
  useEffect(() => {
    let active = true;
    let unlistenOutput: UnlistenFn | undefined;
    let unlistenStatus: UnlistenFn | undefined;

    const scheduleReconnect = () => {
      if (!active || manualDisconnectRef.current) return;

      const {
        autoReconnect: shouldReconnect,
        maxReconnectAttempts: maxAttempts,
        host: h,
        port: p,
        username: u,
        authType: a,
        keepaliveSecs: ka,
      } = connectParamsRef.current;

      if (!shouldReconnect || reconnectAttemptRef.current >= maxAttempts) {
        updateStatus("disconnected");
        return;
      }

      if (!credentialsRef.current) {
        onOutputRef.current(
          "\r\n\x1b[31mAuto-reconnect failed: credentials not available. Click Reconnect to try again.\x1b[0m\r\n",
        );
        reconnectAttemptRef.current = maxAttempts;
        updateStatus("disconnected");
        return;
      }

      const attempt = reconnectAttemptRef.current;
      const delay = BACKOFF_DELAYS[Math.min(attempt, BACKOFF_DELAYS.length - 1)];
      reconnectAttemptRef.current = attempt + 1;

      const delaySec = Math.round(delay / 1000);
      onOutputRef.current(
        `\r\n\x1b[33mReconnecting in ${delaySec}s... (attempt ${attempt + 1}/${maxAttempts})\x1b[0m\r\n`,
      );
      updateStatus("reconnecting");

      reconnectTimerRef.current = setTimeout(async () => {
        if (!active || manualDisconnectRef.current) return;

        const creds = credentialsRef.current;
        if (!creds) {
          onOutputRef.current(
            "\r\n\x1b[31mAuto-reconnect failed: credentials not available. Click Reconnect to try again.\x1b[0m\r\n",
          );
          reconnectAttemptRef.current = connectParamsRef.current.maxReconnectAttempts;
          updateStatus("disconnected");
          return;
        }

        const { cols, rows } = terminalSizeRef.current;
        // Backend only knows password/pem_*; "credential" is a UI auth source
        // that already resolved to a password in memory.
        const effectiveAuth = a === "credential" ? "password" : a;
        try {
          await invoke("ssh_connect", {
            sessionId,
            host: h,
            port: p,
            username: u,
            authType: effectiveAuth,
            password: creds.password,
            pemContent: creds.pemContent,
            passphrase: creds.passphrase,
            cols,
            rows,
            keepaliveSecs: ka,
          });
          // Success → backend emits "connected" (counter resets there).
        } catch (err) {
          // ssh_connect failed before a session existed, so no backend
          // "disconnected" event will fire. Re-schedule the next attempt.
          if (!active || manualDisconnectRef.current) return;
          onOutputRef.current(
            `\r\n\x1b[31mReconnect failed: ${errorMessage(err)}\x1b[0m\r\n`,
          );
          scheduleReconnect();
        }
      }, delay);
    };

    (async () => {
      unlistenOutput = await listen<string>(`ssh-output-${sessionId}`, (event) => {
        if (active) onOutputRef.current(event.payload);
      });
      unlistenStatus = await listen<string>(`ssh-status-${sessionId}`, (event) => {
        if (!active) return;
        if (event.payload === "connected") {
          updateStatus("connected");
          setConnectedAt(Date.now());
          reconnectAttemptRef.current = 0;
        } else if (event.payload === "disconnected") {
          // Ignore spurious "disconnected" from our own cleanup while idle.
          if (statusRef.current === "idle") return;

          const wasConnected = statusRef.current === "connected";
          updateStatus("disconnected");
          setConnectedAt(null);

          if (
            wasConnected &&
            connectParamsRef.current.autoReconnect &&
            !manualDisconnectRef.current
          ) {
            scheduleReconnect();
          }
        }
      });
    })();

    return () => {
      active = false;
      cancelReconnect();
      clearCredentials();
      unlistenOutput?.();
      unlistenStatus?.();
      invoke("ssh_disconnect", { sessionId }).catch(() => {});
    };
  }, [sessionId, updateStatus, cancelReconnect, clearCredentials]);

  const connect = useCallback(
    async (password?: string, pemContent?: string, passphrase?: string) => {
      // Guard: prevent double-connect (e.g. React StrictMode double-effect)
      if (statusRef.current === "connecting" || statusRef.current === "connected") return;
      manualDisconnectRef.current = false;
      cancelReconnect();
      reconnectAttemptRef.current = 0;

      // Cache credentials for auto-reconnect.
      credentialsRef.current = {
        password: password ?? null,
        pemContent: pemContent ?? null,
        passphrase: passphrase ?? null,
      };

      updateStatus("connecting");
      const { cols, rows } = terminalSizeRef.current;
      const params = connectParamsRef.current;
      const effectiveAuth =
        params.authType === "credential" ? "password" : params.authType;
      try {
        await invoke("ssh_connect", {
          sessionId,
          host: params.host,
          port: params.port,
          username: params.username,
          authType: effectiveAuth,
          password: password ?? null,
          pemContent: pemContent ?? null,
          passphrase: passphrase ?? null,
          cols,
          rows,
          keepaliveSecs: params.keepaliveSecs,
        });
      } catch (err) {
        updateStatus("disconnected");
        throw err;
      }
    },
    [sessionId, updateStatus, cancelReconnect],
  );

  // Coalesce rapid keystrokes into one IPC call. Per-char invoke() was a
  // major source of typing lag (Tauri bridge + Rust lock per key).
  const writeQueueRef = useRef("");
  const writeFlushScheduledRef = useRef(false);

  const flushWriteQueue = useCallback(async () => {
    writeFlushScheduledRef.current = false;
    if (statusRef.current !== "connected") {
      writeQueueRef.current = "";
      return;
    }
    const payload = writeQueueRef.current;
    writeQueueRef.current = "";
    if (!payload) return;
    try {
      await invoke("ssh_write", { sessionId, data: payload });
    } catch {
      // Drop on failure; status listener handles disconnect.
    }
    // If more typed while we were in flight, schedule another flush.
    if (writeQueueRef.current && !writeFlushScheduledRef.current) {
      writeFlushScheduledRef.current = true;
      queueMicrotask(() => {
        void flushWriteQueue();
      });
    }
  }, [sessionId]);

  const write = useCallback(
    (data: string) => {
      if (statusRef.current !== "connected") return;
      writeQueueRef.current += data;
      if (!writeFlushScheduledRef.current) {
        writeFlushScheduledRef.current = true;
        queueMicrotask(() => {
          void flushWriteQueue();
        });
      }
    },
    [flushWriteQueue],
  );

  const resize = useCallback(
    async (cols: number, rows: number) => {
      terminalSizeRef.current = { cols, rows };
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
    clearCredentials();
    try {
      await invoke("ssh_disconnect", { sessionId });
    } catch {
      // ignore
    }
    updateStatus("disconnected");
    setConnectedAt(null);
  }, [sessionId, updateStatus, cancelReconnect, clearCredentials]);

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
