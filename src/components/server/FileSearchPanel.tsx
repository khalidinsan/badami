import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Search,
  X,
  Loader2,
  File,
  FolderOpen,
  FolderTree,
  Folder,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/types/server";

interface FileSearchPanelProps {
  sessionId: string;
  currentPath: string;
  onOpenFile: (entry: FileEntry) => void;
  onNavigate: (path: string) => void;
  onClose: () => void;
}

export function FileSearchPanel({
  sessionId,
  currentPath,
  onOpenFile,
  onNavigate,
  onClose,
}: FileSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [recursive, setRecursive] = useState(true);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FileEntry[]>([]);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const result = await invoke<FileEntry[]>("sftp_search_files", {
        sessionId,
        basePath: currentPath,
        query: query.trim(),
        recursive,
        maxResults: 200,
      });
      setResults(result);
    } catch (err) {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [sessionId, currentPath, query, recursive]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  const handleResultClick = (entry: FileEntry) => {
    if (entry.kind === "directory") {
      onNavigate(entry.path);
    } else {
      onOpenFile(entry);
    }
  };

  return (
    <>
      {/* Background overlay */}
      <motion.div
        className="absolute inset-0 z-10 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
      />

      {/* Panel — slides in from right */}
      <motion.div
        className="absolute right-0 top-0 bottom-0 z-20 flex w-1/4 min-w-[280px] max-w-[360px] flex-col border-l border-border/40 bg-background shadow-xl"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">Find Files</span>
          <span className="text-[10px] text-muted-foreground">⌘F</span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-6 w-6"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>

        {/* Search input + options */}
        <div className="border-b border-border/40 px-3 py-3 space-y-3">
          <div className="flex items-center gap-1.5">
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="File name..."
              className="h-8 text-xs flex-1"
            />
            <Button
              variant="default"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={handleSearch}
              disabled={searching || !query.trim()}
            >
              {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Find"}
            </Button>
          </div>

          {/* Directory + recursive — side by side */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <Folder className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              <span className="truncate text-[11px] text-muted-foreground font-mono">
                {currentPath}
              </span>
            </div>
            <button
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                recursive
                  ? "bg-primary/10 text-primary"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setRecursive(!recursive)}
            >
              <FolderTree className="h-3 w-3" />
              {recursive ? "Recursive" : "Current only"}
            </button>
          </div>
        </div>

        {/* Results */}
        <ScrollArea className="flex-1">
          {searching ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="mt-2 text-xs text-muted-foreground">Searching...</p>
            </div>
          ) : results.length === 0 && searched ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Search className="mb-2 h-5 w-5 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No files found</p>
            </div>
          ) : !searched ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Search className="mb-2 h-5 w-5 text-muted-foreground/20" />
              <p className="text-xs text-muted-foreground/60">
                Type a file name and press Enter
              </p>
            </div>
          ) : (
            <div className="p-1.5">
              {results.map((entry) => (
                <button
                  key={entry.path}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
                  onClick={() => handleResultClick(entry)}
                >
                  {entry.kind === "directory" ? (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                  ) : (
                    <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{entry.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground/60 font-mono">
                      {entry.path}
                    </p>
                  </div>
                  {entry.kind !== "directory" && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {entry.size_formatted}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {results.length > 0 && (
          <div className="border-t border-border/40 px-3 py-1.5">
            <span className="text-[10px] text-muted-foreground">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </motion.div>
    </>
  );
}
