import { useEffect, useState, useCallback, useRef } from "react";
import {
  ArrowUp,
  FolderPlus,
  Upload,
  RefreshCw,
  Loader2,
  WifiOff,
  Wifi,
  Home,
  ChevronRight,
  X,
  EyeOff,
  Eye,
  FolderOpen,
  FileUp,
  History,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { FileEntryRow } from "./FileEntryRow";
import { TransferQueue } from "./TransferQueue";
import { TransferHistory } from "./TransferHistory";
import { RemoteCodeEditor } from "./RemoteCodeEditor";
import { useFileManager } from "@/hooks/useFileManager";
import { openInCodeEditor } from "@/lib/osOpen";
import type { ServerCredentialRow } from "@/types/db";
import type { FileEntry } from "@/types/server";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settingsStore";
import { classifyConnectionError } from "@/lib/serverErrors";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface FileManagerProps {
  server: ServerCredentialRow;
  onClose?: () => void;
  onOpenTerminal?: (path: string) => void;
}

export function FileManager({ server, onClose, onOpenTerminal }: FileManagerProps) {
  const { getSetting } = useSettingsStore();
  const showHidden = getSetting("file_manager_show_hidden", "false") === "true";
  const [showHiddenLocal, setShowHiddenLocal] = useState(showHidden);
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [pendingDropPaths, setPendingDropPaths] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingFile, setEditingFile] = useState<{
    path: string;
    content: string;
    readOnly: boolean;
  } | null>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const connectedRef = useRef(false);
  // Tracks files opened in editor: watchId -> { remotePath, localPath }
  const watchedFilesRef = useRef<Map<string, { remotePath: string; localPath: string }>>(
    new Map(),
  );
  // Pending debounce timers per watchId
  const uploadTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const fm = useFileManager({ server });
  // Always-current fm reference — used in event callbacks to avoid stale closures
  const fmRef = useRef(fm);
  fmRef.current = fm;

  // Auto-connect
  useEffect(() => {
    if (connectedRef.current) return;
    connectedRef.current = true;
    fm.connect().catch((err) => {
      const { title, detail } = classifyConnectionError(err);
      toast.error(`${title}: ${detail}`);
    });
  }, []);

  // Global listener for file-watch-changed events (debounced auto-upload).
  // Runs only once ([] deps). Uses fmRef so it always calls the current fm.upload
  // without being torn down on every render (which would kill the Rust watcher).
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    listen<{ watch_id: string; path: string }>("file-watch-changed", ({ payload }) => {
      const entry = watchedFilesRef.current.get(payload.watch_id);
      if (!entry) return;

      // Debounce: wait 1.5s of inactivity before uploading
      const existing = uploadTimersRef.current.get(payload.watch_id);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        uploadTimersRef.current.delete(payload.watch_id);
        try {
          // Use fmRef.current so we always get the latest upload function with
          // the correct currentPath — prevents stale closure navigating to "/"
          await fmRef.current.upload(entry.localPath, entry.remotePath);
          toast.success(`Auto-uploaded "${entry.localPath.split("/").pop()}" to server`);
        } catch (err) {
          toast.error(`Auto-upload failed: ${err}`);
        }
      }, 1500);

      uploadTimersRef.current.set(payload.watch_id, timer);
    }).then((unlisten) => {
      unlistenFn = unlisten;
    });

    return () => {
      // Stop listening and clean up all Rust-side watchers on component unmount
      unlistenFn?.();
      for (const timer of uploadTimersRef.current.values()) clearTimeout(timer);
      for (const watchId of watchedFilesRef.current.keys()) {
        invoke("unwatch_file", { watchId }).catch(() => {});
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tauri native drag-drop listener — use position to detect if drop is over the file zone
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const zone = dropZoneRef.current;
        if (!zone) return;
        const payload = event.payload;
        if (payload.type === "over") {
          const rect = zone.getBoundingClientRect();
          const { x, y } = payload.position;
          setIsDragging(
            x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
          );
        } else if (payload.type === "drop") {
          setIsDragging(false);
          const rect = zone.getBoundingClientRect();
          const { x, y } = payload.position;
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            setPendingDropPaths(payload.paths);
          }
        } else {
          setIsDragging(false);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  // Open file in code editor (download to Rust-managed temp dir, then open & watch)
  const handleOpenInEditor = useCallback(
    async (entry: FileEntry) => {
      try {
        // Rust creates $TEMP/badami-fm/ and returns the full local path
        const localPath = await invoke<string>("ensure_temp_dir", { filename: entry.name });
        await fm.download(entry.path, localPath);
        await openInCodeEditor(localPath);

        // Start watching for changes → auto-upload on save
        const watchId = `${entry.name}-${Date.now()}`;
        await invoke("watch_file", { watchId, path: localPath });
        watchedFilesRef.current.set(watchId, { remotePath: entry.path, localPath });
        toast.info(`Watching "${entry.name}" — changes will be auto-uploaded`);
      } catch (err) {
        toast.error(`Open in editor failed: ${err}`);
      }
    },
    [fm],
  );

  // Open file in built-in Monaco editor (read via SFTP)
  const handleEditFile = useCallback(
    async (entry: FileEntry) => {
      if (entry.size > 5 * 1024 * 1024) {
        toast.error("File too large for built-in editor (max 5MB)");
        return;
      }
      try {
        const content = await fm.readFile(entry.path);
        setEditingFile({ path: entry.path, content, readOnly: false });
      } catch (err) {
        toast.error(`Failed to open file: ${err}`);
      }
    },
    [fm],
  );

  // Save edited file back to server via SFTP
  const handleSaveEditedFile = useCallback(
    async (content: string) => {
      if (!editingFile) return;
      await fm.writeFile(editingFile.path, content);
      toast.success(`Saved ${editingFile.path.split("/").pop()}`);
    },
    [fm, editingFile],
  );

  // Confirm and execute drop upload
  const handleConfirmDrop = useCallback(async () => {
    const paths = pendingDropPaths;
    setPendingDropPaths([]);
    for (const localPath of paths) {
      const fileName = localPath.split("/").pop() || "file";
      const remotePath = fm.currentPath.endsWith("/")
        ? `${fm.currentPath}${fileName}`
        : `${fm.currentPath}/${fileName}`;
      try {
        await fm.upload(localPath, remotePath);
      } catch (err) {
        toast.error(`Upload failed: ${err}`);
      }
    }
    if (paths.length > 0) {
      toast.success(`Uploaded ${paths.length} file(s)`);
    }
  }, [fm, pendingDropPaths]);

  // Filter hidden files
  const visibleEntries = showHiddenLocal
    ? fm.entries
    : fm.entries.filter((e) => !e.is_hidden);

  // Navigation
  const handleNavigate = useCallback(
    (entry: FileEntry) => {
      if (entry.kind === "directory" || entry.kind === "symlink") {
        fm.navigateTo(entry.path).catch((err) => toast.error(`${err}`));
      }
    },
    [fm],
  );

  // Upload via Tauri dialog
  const handleUpload = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: true });
      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];
      for (const filePath of files) {
        const localPath = typeof filePath === "string" ? filePath : String(filePath);
        const fileName = localPath.split("/").pop() || "file";
        const remotePath = fm.currentPath.endsWith("/")
          ? `${fm.currentPath}${fileName}`
          : `${fm.currentPath}/${fileName}`;
        await fm.upload(localPath, remotePath);
      }
      toast.success(`Uploaded ${files.length} file(s)`);
    } catch (err) {
      toast.error(`Upload failed: ${err}`);
    }
  }, [fm]);

  // Download via Tauri dialog
  const handleDownload = useCallback(
    async (entry: FileEntry) => {
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const localPath = await save({
          defaultPath: entry.name,
        });
        if (!localPath) return;
        await fm.download(entry.path, localPath);
        toast.success(`Downloaded ${entry.name}`);
      } catch (err) {
        toast.error(`Download failed: ${err}`);
      }
    },
    [fm],
  );

  // Preview (SFTP only, text files < 1MB)
  const handlePreview = useCallback(
    async (entry: FileEntry) => {
      if (entry.size > 1024 * 1024) {
        toast.error("File too large to preview (max 1MB)");
        return;
      }
      try {
        const content = await fm.readFile(entry.path);
        setPreviewContent(content);
        setPreviewName(entry.name);
      } catch (err) {
        toast.error(`Preview failed: ${err}`);
      }
    },
    [fm],
  );

  // Mkdir
  const handleMkdir = useCallback(async () => {
    if (!mkdirName.trim()) return;
    try {
      await fm.mkdir(mkdirName.trim());
      toast.success(`Created folder: ${mkdirName.trim()}`);
    } catch (err) {
      toast.error(`${err}`);
    }
    setMkdirName("");
    setMkdirOpen(false);
  }, [fm, mkdirName]);

  // Rename
  const handleRename = useCallback(async () => {
    if (!renameTarget || !renameName.trim()) return;
    try {
      await fm.rename(renameTarget.path, renameName.trim());
      toast.success("Renamed successfully");
    } catch (err) {
      toast.error(`${err}`);
    }
    setRenameTarget(null);
    setRenameName("");
  }, [fm, renameTarget, renameName]);

  // Delete
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === "directory") {
        await fm.deleteDir(deleteTarget.path);
      } else {
        await fm.deleteFile(deleteTarget.path);
      }
      toast.success(`Deleted ${deleteTarget.name}`);
    } catch (err) {
      toast.error(`${err}`);
    }
    setDeleteTarget(null);
  }, [fm, deleteTarget]);

  // Breadcrumb parts
  const pathParts = fm.currentPath.split("/").filter(Boolean);

  const StatusIcon = fm.status === "connected" ? Wifi : fm.status === "connecting" ? Loader2 : WifiOff;

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 bg-card/50 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-1.5 text-[11px] font-medium",
              fm.status === "connected"
                ? "text-green-500"
                : fm.status === "connecting"
                  ? "text-yellow-500"
                  : "text-muted-foreground/50",
            )}
          >
            <StatusIcon className={cn("h-3 w-3", fm.status === "connecting" && "animate-spin")} />
            <span className="capitalize">{fm.status}</span>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {server.name} — {server.protocol.toUpperCase()}
          </span>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-border/40 bg-card/30 px-2 py-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => fm.navigateUp().catch((e) => toast.error(`${e}`))}
          disabled={fm.currentPath === "/" || fm.status !== "connected"}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => fm.navigateTo("/").catch((e) => toast.error(`${e}`))}
          disabled={fm.status !== "connected"}
        >
          <Home className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => fm.refresh().catch((e) => toast.error(`${e}`))}
          disabled={fm.status !== "connected"}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", fm.loading && "animate-spin")} />
        </Button>

        {/* Breadcrumb */}
        <div className="flex flex-1 items-center gap-0.5 overflow-hidden px-2">
          <button
            className="shrink-0 text-[12px] text-muted-foreground hover:text-foreground"
            onClick={() => fm.navigateTo("/").catch((e) => toast.error(`${e}`))}
          >
            /
          </button>
          {pathParts.map((part, i) => {
            const fullPath = "/" + pathParts.slice(0, i + 1).join("/");
            return (
              <span key={fullPath} className="flex items-center gap-0.5">
                <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                <button
                  className="truncate text-[12px] text-muted-foreground hover:text-foreground"
                  onClick={() => fm.navigateTo(fullPath).catch((e) => toast.error(`${e}`))}
                >
                  {part}
                </button>
              </span>
            );
          })}
        </div>

        {/* Right toolbar */}
        {onOpenTerminal && server.protocol === "ssh" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onOpenTerminal(fm.currentPath)}
            disabled={fm.status !== "connected"}
            title="Open in Terminal"
          >
            <Terminal className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setHistoryOpen(!historyOpen)}
          title="Transfer history"
        >
          <History className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setShowHiddenLocal(!showHiddenLocal)}
          title={showHiddenLocal ? "Hide hidden files" : "Show hidden files"}
        >
          {showHiddenLocal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setMkdirOpen(true)}
          disabled={fm.status !== "connected"}
          title="New folder"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleUpload}
          disabled={fm.status !== "connected"}
          title="Upload file"
        >
          <Upload className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* File list — drop zone */}
      <div
        ref={dropZoneRef}
        className={cn(
          "flex-1 overflow-hidden relative",
          isDragging && "ring-2 ring-inset ring-primary/50 bg-primary/5",
        )}
      >
        {isDragging && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-primary/5 pointer-events-none">
            <FileUp className="mb-2 h-8 w-8 text-primary/60" />
            <p className="text-sm font-medium text-primary/80">
              Drop files to upload to {fm.currentPath}
            </p>
          </div>
        )}
        <ScrollArea className="h-full">
        {fm.status !== "connected" ? (
          <div className="flex flex-col items-center justify-center py-16 animate-in fade-in duration-300">
            {fm.status === "connecting" ? (
              <>
                <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary/40" />
                <p className="text-sm font-medium text-muted-foreground">Connecting to {server.name}...</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  {server.host}:{server.port} via {server.protocol.toUpperCase()}
                </p>
              </>
            ) : fm.status === "disconnected" ? (
              <>
                <WifiOff className="mb-3 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm font-medium text-muted-foreground">Disconnected</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Connection to {server.host} was lost
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    connectedRef.current = false;
                    fm.connect().catch((e) => {
                      const { title, detail } = classifyConnectionError(e);
                      toast.error(`${title}: ${detail}`);
                    });
                  }}
                >
                  Reconnect
                </Button>
              </>
            ) : (
              <>
                <FolderOpen className="mb-3 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Not connected</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => fm.connect().catch((e) => {
                    const { title, detail } = classifyConnectionError(e);
                    toast.error(`${title}: ${detail}`);
                  })}
                >
                  Connect
                </Button>
              </>
            )}
          </div>
        ) : fm.loading ? (
          <div className="flex flex-col items-center justify-center py-16 animate-in fade-in duration-200">
            <Loader2 className="h-6 w-6 animate-spin text-primary/40" />
            <p className="mt-2 text-xs text-muted-foreground/60">Loading directory...</p>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 animate-in fade-in duration-200">
            <FolderOpen className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">Empty directory</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              {!showHiddenLocal && fm.entries.length > 0
                ? `${fm.entries.length} hidden file(s) — toggle visibility to show`
                : "No files or folders here"}
            </p>
          </div>
        ) : (
          <div className="p-1.5">
            {visibleEntries.map((entry) => (
              <FileEntryRow
                key={entry.path}
                entry={entry}
                selected={selectedEntry?.path === entry.path}
                onNavigate={handleNavigate}
                onSelect={setSelectedEntry}
                onRename={(e) => {
                  setRenameTarget(e);
                  setRenameName(e.name);
                }}
                onDelete={setDeleteTarget}
                onDownload={handleDownload}
                onPreview={server.protocol === "ssh" ? handlePreview : undefined}
                onOpenInEditor={handleOpenInEditor}
                onEditFile={server.protocol === "ssh" ? handleEditFile : undefined}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      </div>

      {/* Transfer queue */}
      {fm.transfers.length > 0 && (
        <TransferQueue
          transfers={fm.transfers}
          onClear={fm.clearCompletedTransfers}
        />
      )}

      {/* Transfer history */}
      <TransferHistory
        serverId={server.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      {/* Mkdir dialog */}
      <AlertDialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Create a new folder in {fm.currentPath}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={mkdirName}
            onChange={(e) => setMkdirName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleMkdir()}
            placeholder="Folder name"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMkdir}>Create</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename dialog */}
      <AlertDialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename</AlertDialogTitle>
            <AlertDialogDescription>
              Rename &quot;{renameTarget?.name}&quot;
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            placeholder="New name"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRename}>Rename</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.kind === "directory" ? "Folder" : "File"}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Preview dialog */}
      <AlertDialog open={previewContent !== null} onOpenChange={(o) => !o && setPreviewContent(null)}>
        <AlertDialogContent className="max-w-2xl max-h-[80vh]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-sm">{previewName}</AlertDialogTitle>
          </AlertDialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-4 text-xs font-mono">
              {previewContent}
            </pre>
          </ScrollArea>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Drop upload confirmation */}
      <AlertDialog open={pendingDropPaths.length > 0} onOpenChange={(o) => { if (!o) setPendingDropPaths([]); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Upload {pendingDropPaths.length} file{pendingDropPaths.length > 1 ? "s" : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Upload to <span className="font-mono text-foreground">{fm.currentPath}</span>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-40 overflow-auto rounded-lg bg-muted/50 p-3">
            {pendingDropPaths.map((p) => (
              <div key={p} className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
                <FileUp className="h-3 w-3 shrink-0" />
                <span className="truncate">{p.split("/").pop()}</span>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDrop}>Upload</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Built-in code editor overlay */}
      {editingFile && (
        <div className="absolute inset-0 z-20 bg-background">
          <RemoteCodeEditor
            remotePath={editingFile.path}
            initialContent={editingFile.content}
            readOnly={editingFile.readOnly}
            onSave={handleSaveEditedFile}
            onClose={() => setEditingFile(null)}
          />
        </div>
      )}
    </div>
  );
}
