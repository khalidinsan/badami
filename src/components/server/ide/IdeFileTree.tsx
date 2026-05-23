import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Folder, FolderOpen, File, ChevronRight, Loader2, FileJson, FileCode, FileText, FileImage, Settings, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdeStore } from "@/stores/ideStore";

const FILE_ICON_MAP: Record<string, { icon: typeof File; color: string }> = {
  ts: { icon: FileCode, color: "#3178c6" },
  tsx: { icon: FileCode, color: "#3178c6" },
  js: { icon: FileCode, color: "#f7df1e" },
  jsx: { icon: FileCode, color: "#f7df1e" },
  py: { icon: FileCode, color: "#3572a5" },
  rs: { icon: FileCode, color: "#dea584" },
  go: { icon: FileCode, color: "#00add8" },
  json: { icon: FileJson, color: "#cbcb41" },
  yaml: { icon: Settings, color: "#cb171e" },
  yml: { icon: Settings, color: "#cb171e" },
  toml: { icon: Settings, color: "#9c4121" },
  md: { icon: FileText, color: "#519aba" },
  txt: { icon: FileText, color: "#89a" },
  html: { icon: FileCode, color: "#e34c26" },
  css: { icon: FileCode, color: "#563d7c" },
  scss: { icon: FileCode, color: "#c6538c" },
  sql: { icon: Database, color: "#e38c00" },
  sh: { icon: FileCode, color: "#89e051" },
  bash: { icon: FileCode, color: "#89e051" },
  png: { icon: FileImage, color: "#a074c4" },
  jpg: { icon: FileImage, color: "#a074c4" },
  svg: { icon: FileImage, color: "#ffb13b" },
  lock: { icon: File, color: "#555" },
};

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICON_MAP[ext] || { icon: File, color: "#999" };
}

interface FileEntry {
  name: string;
  path: string;
  kind: string;
  size: number;
  modified_at: string;
}

interface TreeNode {
  children?: FileEntry[];
  expanded: boolean;
  loading: boolean;
}

interface Props {
  serverId: string;
  workingDir: string;
  onFileSelect: (path: string, name: string, preview: boolean) => void;
  onAttachFile?: (path: string, name: string) => void;
  onDragStateChange?: (dragging: boolean) => void;
  expandToPath?: string | null;
}

export function IdeFileTree({ serverId, workingDir, onFileSelect, onAttachFile, onDragStateChange, expandToPath }: Props) {
  const [roots, setRoots] = useState<FileEntry[]>([]);
  const [nodes, setNodes] = useState<Record<string, TreeNode>>({});
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState<{ path: string; name: string } | null>(null);
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [contextMenu]);

  const fetchDir = useCallback(
    async (path: string) => {
      const items = await invoke<FileEntry[]>("sftp_list_dir", {
        sessionId: serverId,
        path,
      });
      return items.sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1
      );
    },
    [serverId]
  );

  useEffect(() => {
    setLoading(true);
    fetchDir(workingDir)
      .then(setRoots)
      .catch(() => setRoots([]))
      .finally(() => setLoading(false));
  }, [fetchDir, workingDir]);

  // Expand tree to reveal a specific file path
  useEffect(() => {
    if (!expandToPath || !workingDir) return;
    const relativePath = expandToPath.startsWith(workingDir) ? expandToPath.slice(workingDir.length).replace(/^\//, '') : expandToPath;
    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length <= 1) return;

    // Expand each folder segment sequentially
    (async () => {
      let current = workingDir.replace(/\/$/, '');
      for (let i = 0; i < parts.length - 1; i++) {
        current += '/' + parts[i];
        const existing = nodes[current];
        if (!existing?.expanded) {
          const children = await fetchDir(current);
          setNodes((prev) => ({ ...prev, [current]: { expanded: true, loading: false, children } }));
        }
      }
    })();
  }, [expandToPath]);

  const toggleFolder = async (entry: FileEntry) => {
    const existing = nodes[entry.path];
    if (existing?.expanded) {
      setNodes((prev) => ({ ...prev, [entry.path]: { ...existing, expanded: false } }));
      return;
    }
    setNodes((prev) => ({ ...prev, [entry.path]: { expanded: true, loading: true, children: existing?.children } }));
    if (!existing?.children) {
      const children = await fetchDir(entry.path);
      setNodes((prev) => ({ ...prev, [entry.path]: { expanded: true, loading: false, children } }));
    } else {
      setNodes((prev) => ({ ...prev, [entry.path]: { ...existing, expanded: true, loading: false } }));
    }
  };

  // Pointer-based drag (bypasses Tauri DnD interception)
  const startDrag = (e: React.PointerEvent, entry: FileEntry) => {
    if (entry.kind === "directory") return;
    const startX = e.clientX;
    const startY = e.clientY;
    let isDragging = false;

    const handleMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 6) {
        isDragging = true;
        setDragging({ path: entry.path, name: entry.name });
        onDragStateChange?.(true);
        document.body.style.cursor = "copy";
        document.body.style.userSelect = "none";
      }
      if (isDragging) {
        setGhostPos({ x: ev.clientX, y: ev.clientY });
      }
    };

    const handleUp = (ev: PointerEvent) => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      if (isDragging) {
        // Check if dropped over AI sidebar (detect by element under pointer)
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const dropZone = el?.closest("[data-ide-drop-zone]");
        if (dropZone && onAttachFile) {
          onAttachFile(entry.path, entry.name);
        }
        setDragging(null);
        onDragStateChange?.(false);
      }
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  };

  const { activeFile } = useIdeStore();

  // File/folder operations — inline input
  const [inlineInput, setInlineInput] = useState<{ type: 'new_file' | 'new_folder' | 'rename'; dirPath: string; entry?: FileEntry } | null>(null);
  const [inlineValue, setInlineValue] = useState('');
  const inlineRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (inlineInput) setTimeout(() => inlineRef.current?.focus(), 50); }, [inlineInput]);

  const refreshDir = async (dirPath: string) => {
    const children = await fetchDir(dirPath);
    if (dirPath === workingDir) setRoots(children);
    else setNodes((prev) => ({ ...prev, [dirPath]: { expanded: true, loading: false, children } }));
  };

  const handleNewFile = (dirPath: string) => {
    // Auto-expand folder
    if (dirPath !== workingDir && !nodes[dirPath]?.expanded) {
      toggleFolder({ path: dirPath, name: '', kind: 'directory', size: 0, modified_at: '' });
    }
    setInlineInput({ type: 'new_file', dirPath }); setInlineValue('');
  };
  const handleNewFolder = (dirPath: string) => {
    if (dirPath !== workingDir && !nodes[dirPath]?.expanded) {
      toggleFolder({ path: dirPath, name: '', kind: 'directory', size: 0, modified_at: '' });
    }
    setInlineInput({ type: 'new_folder', dirPath }); setInlineValue('');
  };
  const handleRename = (entry: FileEntry) => { setInlineInput({ type: 'rename', dirPath: entry.path.split('/').slice(0, -1).join('/'), entry }); setInlineValue(entry.name); };

  const handleDelete = async (entry: FileEntry) => {
    const parentDir = entry.path.split('/').slice(0, -1).join('/');
    try {
      if (entry.kind === 'directory') {
        await invoke('ssh_exec_command', { sessionId: serverId.replace('ide-', 'ide-ssh-'), command: `rm -rf "${entry.path}"` });
      } else {
        await invoke('sftp_delete_file', { sessionId: serverId, path: entry.path });
      }
      await refreshDir(parentDir);
    } catch {}
  };

  const submitInline = async () => {
    if (!inlineInput || !inlineValue.trim()) { setInlineInput(null); return; }
    const { type, dirPath, entry } = inlineInput;
    setInlineInput(null);
    try {
      if (type === 'new_file') {
        await invoke('sftp_write_file', { sessionId: serverId, path: `${dirPath}/${inlineValue}`, content: '' });
      } else if (type === 'new_folder') {
        await invoke('ssh_exec_command', { sessionId: serverId.replace('ide-', 'ide-ssh-'), command: `mkdir -p "${dirPath}/${inlineValue}"` });
      } else if (type === 'rename' && entry) {
        const newPath = `${dirPath}/${inlineValue}`;
        await invoke('sftp_rename', { sessionId: serverId, oldPath: entry.path, newPath });
      }
      await refreshDir(dirPath);
    } catch {}
  };

  const renderEntry = (entry: FileEntry, level: number) => {
    const node = nodes[entry.path];
    const expanded = node?.expanded;
    const isActive = entry.kind !== "directory" && entry.path === activeFile;
    const fileIcon = entry.kind !== "directory" ? getFileIcon(entry.name) : null;
    const FileIconComp = fileIcon?.icon ?? File;

    return (
      <div key={entry.path}>
        <button
          className={cn(
            "flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs text-left",
            isActive ? "bg-[#37373d] text-white" : "text-[#cccccc] hover:bg-[#2a2d2e]",
          )}
          style={{ paddingLeft: `${level * 12 + 4}px` }}
          onClick={() => (entry.kind === "directory" ? toggleFolder(entry) : onFileSelect(entry.path, entry.name, true))}
          onDoubleClick={() => (entry.kind !== "directory" && onFileSelect(entry.path, entry.name, false))}
          onPointerDown={(e) => startDrag(e, entry)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, entry }); }}
        >
          {entry.kind === "directory" ? (
            <ChevronRight className={cn("h-3 w-3 shrink-0 text-[#999] transition-transform", expanded && "rotate-90")} />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {entry.kind === "directory" ? (
            expanded ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#dcb67a]" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-[#dcb67a]" />
          ) : (
            <FileIconComp className="h-3.5 w-3.5 shrink-0" style={{ color: fileIcon?.color }} />
          )}
          {inlineInput?.type === 'rename' && inlineInput.entry?.path === entry.path ? (
            <input
              ref={inlineRef}
              value={inlineValue}
              onChange={(e) => setInlineValue(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submitInline(); if (e.key === 'Escape') setInlineInput(null); }}
              onBlur={submitInline}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-[#3c3c3c] border border-[#0a84ff] rounded px-1 text-xs text-[#ccc] outline-none min-w-0"
            />
          ) : (
            <span className="truncate">{entry.name}</span>
          )}
        </button>
        {entry.kind === "directory" && expanded && (
          <div>
            {node?.loading ? (
              <div className="flex items-center gap-1 py-0.5 text-xs text-[#888]" style={{ paddingLeft: `${(level + 1) * 12 + 4}px` }}>
                <Loader2 className="h-3 w-3 animate-spin" />
              </div>
            ) : (
              <>
                {node?.children?.map((child) => renderEntry(child, level + 1))}
                {inlineInput && inlineInput.type !== 'rename' && inlineInput.dirPath === entry.path && (
                  <div style={{ paddingLeft: `${(level + 1) * 12 + 4}px` }} className="py-0.5">
                    <input
                      ref={inlineRef}
                      value={inlineValue}
                      onChange={(e) => setInlineValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitInline(); if (e.key === 'Escape') setInlineInput(null); }}
                      onBlur={submitInline}
                      className="w-full bg-[#3c3c3c] border border-[#0a84ff] rounded px-1 py-0.5 text-xs text-[#ccc] outline-none"
                      placeholder={inlineInput.type === 'new_file' ? 'filename' : inlineInput.type === 'new_folder' ? 'folder name' : 'new name'}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-[#999]">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading...
      </div>
    );
  }

  return (
    <>
      <div className="py-1">
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#888]">
          {workingDir.split("/").pop() || workingDir}
        </div>
        {roots.length === 0 ? (
          <div className="px-2 py-2 text-xs text-[#888]">Empty folder</div>
        ) : (
          roots.map((entry) => renderEntry(entry, 0))
        )}
        {/* Inline input for new file/folder at root level */}
        {inlineInput && inlineInput.type !== 'rename' && inlineInput.dirPath === workingDir && (
          <div style={{ paddingLeft: `${0 * 12 + 4}px` }} className="py-0.5 pr-2">
            <input
              ref={inlineRef}
              value={inlineValue}
              onChange={(e) => setInlineValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitInline(); if (e.key === 'Escape') setInlineInput(null); }}
              onBlur={submitInline}
              className="w-full bg-[#3c3c3c] border border-[#0a84ff] rounded px-1 py-0.5 text-xs text-[#ccc] outline-none"
              placeholder={inlineInput.type === 'new_file' ? 'filename' : inlineInput.type === 'new_folder' ? 'folder name' : 'new name'}
            />
          </div>
        )}
      </div>
      {/* Drag ghost */}
      {dragging && (
        <div
          className="fixed pointer-events-none z-[200] flex items-center gap-1 rounded bg-[#0a84ff] px-2 py-1 text-[11px] text-white shadow-lg"
          style={{ left: ghostPos.x + 12, top: ghostPos.y - 8 }}
        >
          <File className="h-3 w-3" />
          {dragging.name}
        </div>
      )}
      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[300] bg-[#252526] border border-[#454545] rounded shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.entry.kind === 'directory' ? (
            <>
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { handleNewFile(contextMenu.entry.path); setContextMenu(null); }}>New File</button>
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { handleNewFolder(contextMenu.entry.path); setContextMenu(null); }}>New Folder</button>
              <div className="h-px bg-[#454545] my-0.5" />
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { toggleFolder(contextMenu.entry); setContextMenu(null); }}>Expand</button>
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { setNodes((prev) => ({ ...prev, [contextMenu.entry.path]: { ...prev[contextMenu.entry.path], expanded: false } })); setContextMenu(null); }}>Collapse</button>
              <div className="h-px bg-[#454545] my-0.5" />
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { handleRename(contextMenu.entry); setContextMenu(null); }}>Rename</button>
              <button className="w-full text-left px-3 py-1 text-xs text-[#e55] hover:bg-[#37373d]" onClick={() => { handleDelete(contextMenu.entry); setContextMenu(null); }}>Delete</button>
              <div className="h-px bg-[#454545] my-0.5" />
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { navigator.clipboard.writeText(contextMenu.entry.path); setContextMenu(null); }}>Copy Path</button>
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { const rel = contextMenu.entry.path.startsWith(workingDir) ? contextMenu.entry.path.slice(workingDir.length).replace(/^\//, '') : contextMenu.entry.path; navigator.clipboard.writeText(rel); setContextMenu(null); }}>Copy Relative Path</button>
            </>
          ) : (
            <>
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { onFileSelect(contextMenu.entry.path, contextMenu.entry.name, true); setContextMenu(null); }}>Open</button>
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { onFileSelect(contextMenu.entry.path, contextMenu.entry.name, false); setContextMenu(null); }}>Open to Side</button>
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { onAttachFile?.(contextMenu.entry.path, contextMenu.entry.name); setContextMenu(null); }}>Attach to AI</button>
              <div className="h-px bg-[#454545] my-0.5" />
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { handleRename(contextMenu.entry); setContextMenu(null); }}>Rename</button>
              <button className="w-full text-left px-3 py-1 text-xs text-[#e55] hover:bg-[#37373d]" onClick={() => { handleDelete(contextMenu.entry); setContextMenu(null); }}>Delete</button>
              <div className="h-px bg-[#454545] my-0.5" />
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { navigator.clipboard.writeText(contextMenu.entry.path); setContextMenu(null); }}>Copy Path</button>
              <button className="w-full text-left px-3 py-1 text-xs text-[#ccc] hover:bg-[#37373d]" onClick={() => { const rel = contextMenu.entry.path.startsWith(workingDir) ? contextMenu.entry.path.slice(workingDir.length).replace(/^\//, '') : contextMenu.entry.path; navigator.clipboard.writeText(rel); setContextMenu(null); }}>Copy Relative Path</button>
            </>
          )}
        </div>
      )}
    </>
  );
}
