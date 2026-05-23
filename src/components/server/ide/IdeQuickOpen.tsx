import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { File, Search } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string, name: string) => void;
  sftpSessionId: string;
  sshSessionId: string;
  workingDir: string;
}

export function IdeQuickOpen({ open, onClose, onSelect, sftpSessionId: _sftpSessionId, sshSessionId, workingDir }: Props) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setLoading(true);
    setTimeout(() => inputRef.current?.focus(), 50);

    // Try SSH find command first, fallback to basic list
    invoke<string>("ssh_exec_command", {
      sessionId: sshSessionId,
      command: `find ${workingDir} -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/__pycache__/*' 2>/dev/null | head -300`,
    })
      .then((output) => {
        const list = output.split("\n").filter(Boolean);
        setFiles(list.length > 0 ? list : []);
      })
      .catch(() => {
        // Fallback: just show empty, user can still type
        setFiles([]);
      })
      .finally(() => setLoading(false));
  }, [open, sshSessionId, workingDir]);

  const filtered = query
    ? files.filter((f) => {
        const name = f.split("/").pop()?.toLowerCase() ?? "";
        const q = query.toLowerCase();
        return name.includes(q) || f.toLowerCase().includes(q);
      }).slice(0, 15)
    : files.slice(0, 15);

  useEffect(() => { setActiveIndex(0); }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered[activeIndex]) {
        e.preventDefault();
        const fullPath = filtered[activeIndex];
        onSelect(fullPath, fullPath.split("/").pop() || fullPath);
        onClose();
      }
    },
    [filtered, activeIndex, onSelect, onClose]
  );

  if (!open) return null;

  const relative = (path: string) =>
    path.startsWith(workingDir) ? path.slice(workingDir.length).replace(/^\//, "") : path;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15%]" onMouseDown={onClose}>
      <div className="w-[480px] bg-[#252526] rounded-lg shadow-2xl border border-[#3c3c3c] overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 border-b border-[#3c3c3c]">
          <Search size={14} className="text-[#888] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Go to file..."
            className="w-full py-2 bg-transparent text-[#ccc] text-sm outline-none placeholder:text-[#666]"
            autoFocus
          />
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {loading && <div className="px-3 py-3 text-xs text-[#888]">Loading files...</div>}
          {!loading && filtered.length === 0 && (
            <div className="px-3 py-3 text-xs text-[#888]">
              {files.length === 0 ? "Could not load file list" : "No matching files"}
            </div>
          )}
          {filtered.map((file, i) => (
            <div
              key={file}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ${i === activeIndex ? "bg-[#04395e] text-white" : "text-[#ccc] hover:bg-[#2a2d2e]"}`}
              onClick={() => { onSelect(file, file.split("/").pop() || file); onClose(); }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <File size={13} className="shrink-0 text-[#888]" />
              <span className="truncate">{relative(file)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
