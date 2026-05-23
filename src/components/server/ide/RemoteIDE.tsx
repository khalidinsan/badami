import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PanelLeft, Bot, Loader2, FolderOpen, Folder, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdeStore } from "@/stores/ideStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { IdeFileTree } from "./IdeFileTree";
import { IdeEditor } from "./IdeEditor";
import { IdeStatusBar } from "./IdeStatusBar";
import { IdeAiSidebar } from "./IdeAiSidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ideFileCache } from "@/lib/ideFileCache";
import { IdeQuickOpen } from "./IdeQuickOpen";

const extToLang: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", rs: "rust", go: "go", json: "json", md: "markdown",
  html: "html", css: "css", scss: "scss", yaml: "yaml", yml: "yaml",
  toml: "toml", sql: "sql", sh: "shell", bash: "shell", xml: "xml",
};

function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return extToLang[ext] ?? "plaintext";
}

interface Props {
  server: { id: string; host: string; port?: number | null; username?: string | null; auth_type?: string | null; pem_key_id?: string | null; [key: string]: any };
}

export function RemoteIDE({ server }: Props) {
  const store = useIdeStore();
  const { getSetting, setSetting } = useSettingsStore();
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState("");
  const savedDir = getSetting(`ide_workdir_${server.id}`, "");
  const [workingDir, setWorkingDir] = useState<string | null>(savedDir || null);
  const lastWorkingDirRef = useRef<string | null>(savedDir || null);
  const [attachedFiles, setAttachedFiles] = useState<{path: string, name: string}[]>([]);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [fileDragging, setFileDragging] = useState(false);
  const [revealPath, setRevealPath] = useState<string | null>(null);
  const [treeWidth, setTreeWidth] = useState(220);
  const [aiWidth, setAiWidth] = useState(320);
  const [reconnecting, setReconnecting] = useState(false);
  const connectedRef = useRef(false);
  const sessionId = `ide-${server.id}`;
  const sshSessionId = `ide-ssh-${server.id}`;

  // Persist working dir when it changes
  const handleSetWorkingDir = (dir: string | null) => {
    setWorkingDir(dir);
    if (dir) setSetting(`ide_workdir_${server.id}`, dir);
  };

  // Reset IDE state when switching servers
  useEffect(() => {
    store.reset();
    const saved = getSetting(`ide_workdir_${server.id}`, "");
    setWorkingDir(saved || null);
    lastWorkingDirRef.current = saved || null;
    setConnected(false);
    setConnectError("");
  }, [server.id]);

  // Reconnect helper — re-establishes SFTP using the same credentials
  const reconnect = useCallback(async () => {
    setReconnecting(true);
    try {
      let password: string | null = null;
      let pemContent: string | null = null;
      let passphrase: string | null = null;

      if (server.auth_type === "password") {
        password = await invoke<string>("get_server_password", { serverId: server.id }).catch(() => "");
      } else if (server.auth_type === "pem_saved" && server.pem_key_id) {
        const pemKey = await invoke<{ content: string; iv: string }>("get_pem_key_content", { keyId: server.pem_key_id });
        pemContent = await invoke<string>("decrypt_pem_content", { encrypted: pemKey.content, iv: pemKey.iv });
      } else if (server.auth_type === "pem_passphrase") {
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        pemContent = await readTextFile((server as any).pem_file_path ?? "");
        passphrase = await invoke<string>("get_server_passphrase", { serverId: server.id }).catch(() => null);
      }

      await invoke("sftp_connect", {
        sessionId,
        host: server.host,
        port: server.port ?? 22,
        username: server.username ?? "root",
        authType: server.auth_type ?? "password",
        password,
        pemContent,
        passphrase,
      });

      connectedRef.current = true;
    } finally {
      setReconnecting(false);
    }
  }, [server, sessionId]);

  // Establish SFTP connection on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let password: string | null = null;
        let pemContent: string | null = null;
        let passphrase: string | null = null;

        if (server.auth_type === "password") {
          password = await invoke<string>("get_server_password", { serverId: server.id }).catch(() => "");
        } else if (server.auth_type === "pem_saved" && server.pem_key_id) {
          const pemKey = await invoke<{ content: string; iv: string }>("get_pem_key_content", { keyId: server.pem_key_id });
          pemContent = await invoke<string>("decrypt_pem_content", { encrypted: pemKey.content, iv: pemKey.iv });
        } else if (server.auth_type === "pem_passphrase") {
          const { readTextFile } = await import("@tauri-apps/plugin-fs");
          pemContent = await readTextFile((server as any).pem_file_path ?? "");
          passphrase = await invoke<string>("get_server_passphrase", { serverId: server.id }).catch(() => null);
        }

        await invoke("sftp_connect", {
          sessionId,
          host: server.host,
          port: server.port ?? 22,
          username: server.username ?? "root",
          authType: server.auth_type ?? "password",
          password,
          pemContent,
          passphrase,
        });

        // Also connect SSH for shell command execution
        await invoke("ssh_connect", {
          sessionId: sshSessionId,
          host: server.host,
          port: server.port ?? 22,
          username: server.username ?? "root",
          authType: server.auth_type ?? "password",
          password,
          pemContent,
          passphrase,
          cols: 80,
          rows: 24,
        }).catch(() => {}); // Non-critical — tools degrade gracefully

        if (!cancelled) { setConnected(true); connectedRef.current = true; }
      } catch (e: any) {
        if (!cancelled) setConnectError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [server.id]);

  // Keepalive: ping SFTP every 30s to prevent timeout
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(async () => {
      try {
        await invoke("sftp_list_dir", { sessionId, path: "." });
      } catch {
        connectedRef.current = false;
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [connected, sessionId]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!workingDir) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "p") {
        e.preventDefault();
        setQuickOpenOpen(true);
      } else if (mod && e.key === "w") {
        e.preventDefault();
        if (store.activeFile) store.closeTab(store.activeFile);
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const tabs = store.tabs;
        if (tabs.length > 1) {
          const idx = tabs.findIndex(t => t.path === store.activeFile);
          const next = tabs[(idx + 1) % tabs.length];
          store.setActiveFile(next.path);
        }
      } else if (mod && !e.shiftKey && e.key === "b") {
        e.preventDefault();
        store.toggleSidebar();
      } else if (e.metaKey && e.shiftKey && e.key === "b") {
        e.preventDefault();
        store.toggleAiSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [workingDir, store.activeFile, store.tabs]);

  const activeTab = store.tabs.find((t) => t.path === store.activeFile);

  const handleFileSelect = async (path: string, name: string, preview: boolean) => {
    // Check cache first
    const cached = ideFileCache.get(path);
    if (cached) {
      store.openFile(path, name, cached, detectLanguage(path), preview);
      return;
    }
    try {
      const content = await invoke<string>("sftp_read_file", { sessionId, path });
      ideFileCache.set(path, content);
      store.openFile(path, name, content, detectLanguage(path), preview);
    } catch {
      try {
        await reconnect();
        const content = await invoke<string>("sftp_read_file", { sessionId, path });
        ideFileCache.set(path, content);
        store.openFile(path, name, content, detectLanguage(path), preview);
      } catch (retryErr: any) {
        console.error("Failed to read file after reconnect:", retryErr);
      }
    }
  };

  const handleSave = async (path: string, content: string) => {
    try {
      await invoke("sftp_write_file", { sessionId, path, content });
    } catch {
      await reconnect();
      await invoke("sftp_write_file", { sessionId, path, content });
    }
    store.markSaved(path, content);
    ideFileCache.set(path, content);
  };

  const handleOpenFileFromAgent = async (path: string) => {
    setRevealPath(path);
    const name = path.split('/').pop() || path;
    await handleFileSelect(path, name, false);
  };

  if (connectError) {
    return (
      <div className="flex h-full items-center justify-center bg-[#1e1e1e] text-sm text-red-400">
        Connection failed: {connectError}
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-[#1e1e1e] text-sm text-[#999]">
        <Loader2 className="h-4 w-4 animate-spin" /> Connecting to {server.host}...
      </div>
    );
  }

  // Folder picker screen
  if (!workingDir) {
    return <FolderPicker sessionId={sessionId} serverHost={server.host} initialPath={lastWorkingDirRef.current} onSelect={handleSetWorkingDir} />;
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {reconnecting && (
        <div className="flex items-center gap-2 px-3 py-1 bg-yellow-900/50 text-yellow-300 text-[11px]">
          <WifiOff className="h-3 w-3" /> Reconnecting to {server.host}...
        </div>
      )}
      {/* Toolbar */}
      <div className="flex items-center h-8 px-2 gap-1 bg-[#333333] border-b border-[#252526]">
        <button onClick={() => store.toggleSidebar()} className={cn("p-1 rounded hover:bg-white/10", store.sidebarOpen && "bg-white/10")}>
          <PanelLeft className="w-3.5 h-3.5 text-[#ccc]" />
        </button>
        <button onClick={() => store.toggleAiSidebar()} className={cn("p-1 rounded hover:bg-white/10", store.aiSidebarOpen && "bg-white/10")}>
          <Bot className="w-3.5 h-3.5 text-[#ccc]" />
        </button>
        <span className="ml-2 text-[11px] text-[#888]">{workingDir}</span>
        <button onClick={() => { lastWorkingDirRef.current = workingDir; store.reset(); setWorkingDir(null); }} className="ml-auto text-[10px] text-[#888] hover:text-white px-1.5 py-0.5 rounded hover:bg-white/10">
          Change Folder
        </button>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {store.sidebarOpen && (
          <>
            <div style={{ width: treeWidth }} className="shrink-0 overflow-auto bg-[#252526]">
              <IdeFileTree serverId={sessionId} workingDir={workingDir} onFileSelect={handleFileSelect} onAttachFile={(path, name) => setAttachedFiles(prev => prev.some(f => f.path === path) ? prev : [...prev, { path, name }])} onDragStateChange={setFileDragging} expandToPath={revealPath} />
            </div>
            <ResizeHandle onResize={(delta) => setTreeWidth(w => Math.max(150, Math.min(400, w + delta)))} />
          </>
        )}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
          <IdeEditor onSave={handleSave} onCursorChange={(line, col) => setCursor({ line, col })} />
          <IdeStatusBar
            language={activeTab?.language ?? "plaintext"}
            line={cursor.line}
            col={cursor.col}
            filePath={activeTab?.path ?? ""}
            isDirty={activeTab?.isDirty ?? false}
          />
        </div>
        {store.aiSidebarOpen && (
          <>
            <ResizeHandle onResize={(delta) => setAiWidth(w => Math.max(250, Math.min(500, w - delta)))} />
            <div style={{ width: aiWidth }} className="shrink-0">
              <IdeAiSidebar
                serverId={sessionId}
                sshSessionId={sshSessionId}
                currentFile={activeTab?.path ?? null}
                currentContent={activeTab?.content ?? null}
                attachedFiles={attachedFiles}
                onApplyEdit={(path, content) => store.updateContent(path, content)}
                onClearAttachment={(path) => setAttachedFiles(prev => prev.filter(f => f.path !== path))}
                showDropZone={fileDragging}
                workingDir={workingDir!}
                serverHost={server.host}
                onOpenFile={handleOpenFileFromAgent}
              />
            </div>
          </>
        )}
      </div>
      <IdeQuickOpen
        open={quickOpenOpen}
        onClose={() => setQuickOpenOpen(false)}
        sftpSessionId={sessionId}
        sshSessionId={sshSessionId}
        workingDir={workingDir!}
        onSelect={(path, name) => { handleFileSelect(path, name, false); setQuickOpenOpen(false); }}
      />
    </div>
  );
}

// ── Resize Handle ───────────────────────────────────────────────────

function ResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    let lastX = e.clientX;
    const handleMove = (ev: PointerEvent) => {
      const delta = ev.clientX - lastX;
      lastX = ev.clientX;
      onResize(delta);
    };
    const handleUp = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  };

  return (
    <div
      className="w-[3px] shrink-0 cursor-col-resize hover:bg-[#0a84ff]/50 active:bg-[#0a84ff] transition-colors"
      onPointerDown={handlePointerDown}
    />
  );
}

// ── Folder Picker ───────────────────────────────────────────────────

interface FolderEntry { name: string; path: string; kind: string; }

function FolderPicker({ sessionId, serverHost, initialPath, onSelect }: { sessionId: string; serverHost: string; initialPath?: string | null; onSelect: (path: string) => void }) {
  const [currentPath, setCurrentPath] = useState(initialPath || ".");
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const items = await invoke<FolderEntry[]>("sftp_list_dir", { sessionId, path });
      const dirs = items.filter((i) => i.kind === "directory").sort((a, b) => a.name.localeCompare(b.name));
      setFolders(dirs);
      setCurrentPath(path);
    } catch {
      setFolders([]);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { loadDir("."); }, [loadDir]);

  const goUp = () => {
    const parent = currentPath.includes("/") ? currentPath.split("/").slice(0, -1).join("/") || "/" : "/";
    loadDir(parent);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-[#1e1e1e] px-8">
      <FolderOpen className="h-12 w-12 text-[#555] mb-4" />
      <h2 className="text-sm font-medium text-[#ccc] mb-1">Open Folder</h2>
      <p className="text-xs text-[#888] mb-4">Select a working directory on {serverHost}</p>

      <div className="w-full max-w-sm rounded-lg border border-[#3c3c3c] bg-[#252526] overflow-hidden">
        {/* Path bar */}
        <div className="flex items-center gap-1 border-b border-[#3c3c3c] px-3 py-1.5">
          <button onClick={goUp} className="text-[11px] text-[#0a84ff] hover:underline">↑ Up</button>
          <span className="flex-1 text-[11px] text-[#ccc] truncate text-right">{currentPath}</span>
        </div>

        {/* Folder list */}
        <ScrollArea className="h-[200px]">
          {loading ? (
            <div className="flex items-center gap-2 p-3 text-xs text-[#888]">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading...
            </div>
          ) : folders.length === 0 ? (
            <div className="p-3 text-xs text-[#888]">No subfolders</div>
          ) : (
            <div className="py-1">
              {folders.map((f) => (
                <button
                  key={f.path}
                  className="flex w-full items-center gap-2 px-3 py-1 text-xs text-[#ccc] hover:bg-[#2a2d2e]"
                  onDoubleClick={() => loadDir(f.path)}
                  onClick={() => loadDir(f.path)}
                >
                  <Folder className="h-3.5 w-3.5 text-[#dcb67a]" />
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Open button */}
      <button
        onClick={() => onSelect(currentPath)}
        className="mt-4 rounded-md bg-[#0a84ff] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0a84ff]/90"
      >
        Open Folder
      </button>
    </div>
  );
}
