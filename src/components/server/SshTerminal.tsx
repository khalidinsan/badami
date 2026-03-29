import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import {
  Wifi,
  WifiOff,
  Loader2,
  Clock,
  Search,
  X,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getTerminalTheme } from "@/lib/terminalThemes";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  useSshSession,
  type SshConnectionStatus,
} from "@/hooks/useSshSession";
import { invoke } from "@tauri-apps/api/core";
import type { ServerCredentialRow } from "@/types/db";
import * as serverQueries from "@/db/queries/servers";
import { classifyConnectionError } from "@/lib/serverErrors";

interface SshTerminalProps {
  server: ServerCredentialRow;
  onStatusChange?: (status: SshConnectionStatus) => void;
  onOpenFileManager?: () => void;
  /** Auto-cd into this path after connecting */
  initialCdPath?: string;
}

export function SshTerminal({ server, onStatusChange, onOpenFileManager, initialCdPath }: SshTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [elapsedStr, setElapsedStr] = useState("");

  // Tracks which server.id we have already initiated a connection for.
  // React StrictMode in dev fires effects twice for the same props; the ref
  // persists through that cycle so we connect only once per server.
  const connectedForRef = useRef<string>("");

  const { getSetting } = useSettingsStore();
  const fontSize = Number(getSetting("ssh_terminal_font_size", "13"));
  const fontFamily = getSetting("ssh_terminal_font_family", "JetBrains Mono");
  const themeName = getSetting("ssh_terminal_theme", "dark");

  const handleOutput = useCallback((data: string) => {
    xtermRef.current?.write(data);
  }, []);

  const {
    status,
    connectedAt,
    connect,
    write,
    resize,
    disconnect,
  } = useSshSession({
    host: server.host,
    port: server.port,
    username: server.username,
    authType: server.auth_type,
    onOutput: handleOutput,
    onStatusChange,
  });

  // Initialize xterm
  useEffect(() => {
    if (!termRef.current) return;

    const theme = getTerminalTheme(themeName);
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize,
      fontFamily: `"${fontFamily}", "Menlo", "Courier New", monospace`,
      theme,
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    term.open(termRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Forward user input to SSH
    const inputDisposable = term.onData((data) => {
      write(data);
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        resize(term.cols, term.rows);
      } catch {
        // ignore resize errors during mount/unmount
      }
    });
    resizeObserver.observe(termRef.current);

    return () => {
      inputDisposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [fontSize, fontFamily, themeName]);

  // Auto-connect on mount
  useEffect(() => {
    // Skip if we already initiated a connection for this server.
    // This prevents the double-connect that React StrictMode causes in dev.
    if (connectedForRef.current === server.id) return;
    connectedForRef.current = server.id;

    // Clear terminal output when switching to a different server.
    xtermRef.current?.clear();

    const doConnect = async () => {
      try {
        let password: string | undefined;
        let pemContent: string | undefined;
        let passphrase: string | undefined;

        if (server.auth_type === "password") {
          try {
            password = await invoke<string>("get_server_password", {
              serverId: server.id,
            });
          } catch {
            xtermRef.current?.write(
              "\r\n\x1b[31mNo password found in keychain. Please edit the server and save a password.\x1b[0m\r\n",
            );
            return;
          }
        } else if (server.auth_type === "pem_file" && server.pem_file_path) {
          const { readTextFile } = await import("@tauri-apps/plugin-fs");
          pemContent = await readTextFile(server.pem_file_path);
        } else if (server.auth_type === "pem_saved" && server.pem_key_id) {
          const pemKey = await serverQueries.getPemKeyById(server.pem_key_id);
          if (pemKey) {
            pemContent = await invoke<string>("decrypt_pem_key", {
              encryptedData: pemKey.encrypted_data,
              iv: pemKey.iv,
            });
          }
        } else if (server.auth_type === "pem_passphrase" && server.pem_file_path) {
          const { readTextFile } = await import("@tauri-apps/plugin-fs");
          pemContent = await readTextFile(server.pem_file_path);
          try {
            passphrase = await invoke<string>("get_server_passphrase", {
              serverId: server.id,
            });
          } catch {
            // passphrase might not be saved
          }
        }

        xtermRef.current?.write(
          `\x1b[33mConnecting to ${server.host}:${server.port}...\x1b[0m\r\n`,
        );
        await connect(password, pemContent, passphrase);

        // Auto-cd if initialCdPath was requested
        if (initialCdPath) {
          setTimeout(() => {
            write(`cd ${initialCdPath}\n`);
          }, 300);
        }

        // Update last_connected_at
        serverQueries.touchServerConnected(server.id);
      } catch (err) {
        const { title, detail } = classifyConnectionError(err);
        xtermRef.current?.write(
          `\r\n\x1b[31m${title}: ${detail}\x1b[0m\r\n`,
        );
      }
    };
    doConnect();

    return () => {
      disconnect();
    };
  }, [server.id]);

  // Elapsed time ticker
  useEffect(() => {
    if (!connectedAt) {
      setElapsedStr("");
      return;
    }
    const update = () => {
      const secs = Math.floor((Date.now() - connectedAt) / 1000);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      setElapsedStr(
        h > 0
          ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
          : `${m}:${String(s).padStart(2, "0")}`,
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [connectedAt]);

  // Search
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query) {
      searchAddonRef.current?.findNext(query, { incremental: true });
    }
  };

  const handleSearchNext = () => searchAddonRef.current?.findNext(searchQuery);
  const handleSearchPrev = () => searchAddonRef.current?.findPrevious(searchQuery);

  return (
    <div className="flex h-full flex-col">
      {/* Status bar */}
      <div className="flex items-center justify-between border-b border-border/40 bg-card/50 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-1.5 text-[11px] font-medium",
              status === "connected"
                ? "text-green-500"
                : status === "connecting"
                  ? "text-yellow-500"
                  : "text-muted-foreground/50",
            )}
          >
            {status === "connected" && <Wifi className="h-3 w-3" />}
            {status === "connecting" && <Loader2 className="h-3 w-3 animate-spin" />}
            {(status === "disconnected" || status === "idle") && (
              <WifiOff className="h-3 w-3" />
            )}
            <span className="capitalize">{status}</span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {server.username}@{server.host}:{server.port}
          </span>
          {elapsedStr && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <Clock className="h-2.5 w-2.5" />
              {elapsedStr}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onOpenFileManager && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onOpenFileManager}
              title="Open File Manager"
            >
              <FolderOpen className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search className="h-3 w-3" />
          </Button>
          {status === "disconnected" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => {
                xtermRef.current?.clear();
                // Re-trigger connect by remounting — simplest approach
                window.location.reload();
              }}
            >
              Reconnect
            </Button>
          )}
        </div>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border/40 bg-card/30 px-3 py-1.5">
          <Search className="h-3 w-3 text-muted-foreground" />
          <Input
            autoFocus
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.shiftKey ? handleSearchPrev() : handleSearchNext();
              }
              if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchQuery("");
              }
            }}
            placeholder="Search terminal..."
            className="h-6 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Terminal */}
      <div ref={termRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
