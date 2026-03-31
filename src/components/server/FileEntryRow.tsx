import {
  File,
  FolderOpen,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Download,
  Eye,
  Code,
  FileCode2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { isTextFile } from "@/lib/editorLanguage";
import type { FileEntry } from "@/types/server";

interface FileEntryRowProps {
  entry: FileEntry;
  selected?: boolean;
  onNavigate: (entry: FileEntry) => void;
  onSelect: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onDownload: (entry: FileEntry) => void;
  onPreview?: (entry: FileEntry) => void;
  onOpenInEditor?: (entry: FileEntry) => void;
  onEditFile?: (entry: FileEntry) => void;
}

const FILE_ICON_COLORS: Record<string, string> = {
  js: "#f7df1e",
  ts: "#3178c6",
  tsx: "#3178c6",
  jsx: "#61dafb",
  json: "#6b7280",
  html: "#e34f26",
  css: "#1572b6",
  py: "#3776ab",
  rb: "#cc342d",
  go: "#00add8",
  rs: "#dea584",
  sh: "#4eaa25",
  md: "#083fa1",
  yml: "#cb171e",
  yaml: "#cb171e",
  toml: "#9c4221",
  sql: "#e38c00",
  php: "#777bb4",
  java: "#007396",
};

function getFileColor(name: string): string | undefined {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? FILE_ICON_COLORS[ext] : undefined;
}

export function FileEntryRow({
  entry,
  selected,
  onNavigate,
  onSelect,
  onRename,
  onDelete,
  onDownload,
  onPreview,
  onOpenInEditor,
  onEditFile,
}: FileEntryRowProps) {
  const isDir = entry.kind === "directory";
  const isSymlink = entry.kind === "symlink";
  const fileColor = !isDir ? getFileColor(entry.name) : undefined;

  const menuItems = (
    <>
      {!isDir && onPreview && (
        <ContextMenuItem onClick={() => onPreview(entry)}>
          <Eye className="mr-2 h-3.5 w-3.5" />
          Preview
        </ContextMenuItem>
      )}
      {!isDir && (
        <ContextMenuItem onClick={() => onDownload(entry)}>
          <Download className="mr-2 h-3.5 w-3.5" />
          Download
        </ContextMenuItem>
      )}
      {!isDir && onEditFile && isTextFile(entry.name) && (
        <ContextMenuItem onClick={() => onEditFile(entry)}>
          <FileCode2 className="mr-2 h-3.5 w-3.5" />
          Edit
        </ContextMenuItem>
      )}
      {!isDir && onOpenInEditor && (
        <ContextMenuItem onClick={() => onOpenInEditor(entry)}>
          <Code className="mr-2 h-3.5 w-3.5" />
          Open in Code Editor
        </ContextMenuItem>
      )}
      {(!isDir && (onPreview || onOpenInEditor || onEditFile)) && <ContextMenuSeparator />}
      <ContextMenuItem onClick={() => onRename(entry)}>
        <Pencil className="mr-2 h-3.5 w-3.5" />
        Rename
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        className="text-destructive focus:text-destructive"
        onClick={() => onDelete(entry)}
      >
        <Trash2 className="mr-2 h-3.5 w-3.5" />
        Delete
      </ContextMenuItem>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors cursor-pointer",
            selected
              ? "bg-primary/10 text-primary"
              : "hover:bg-muted/50",
            entry.is_hidden && "opacity-60",
          )}
          onClick={() => onSelect(entry)}
          onDoubleClick={() => onNavigate(entry)}
        >
          {/* Icon */}
          <div className="flex h-5 w-5 shrink-0 items-center justify-center">
            {isDir ? (
              <FolderOpen className="h-4 w-4 text-blue-400" />
            ) : isSymlink ? (
              <Link2 className="h-4 w-4 text-purple-400" />
            ) : (
              <File className="h-4 w-4" style={fileColor ? { color: fileColor } : undefined} />
            )}
          </div>

          {/* Name */}
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {entry.name}
          </span>

          {/* Size */}
          {!isDir && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {entry.size_formatted}
            </span>
          )}

          {/* Permissions */}
          <span className="hidden shrink-0 text-[11px] text-muted-foreground/60 font-mono sm:block w-[80px] text-right">
            {entry.permissions}
          </span>

          {/* Modified */}
          <span className="hidden shrink-0 text-[11px] text-muted-foreground/60 md:block w-[90px] text-right">
            {entry.modified_at}
          </span>

          {/* Dot-menu button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {!isDir && onPreview && (
                <DropdownMenuItem onClick={() => onPreview(entry)}>
                  <Eye className="mr-2 h-3.5 w-3.5" />
                  Preview
                </DropdownMenuItem>
              )}
              {!isDir && (
                <DropdownMenuItem onClick={() => onDownload(entry)}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Download
                </DropdownMenuItem>
              )}
              {!isDir && onOpenInEditor && (
                <DropdownMenuItem onClick={() => onOpenInEditor(entry)}>
                  <Code className="mr-2 h-3.5 w-3.5" />
                  Open in Code Editor
                </DropdownMenuItem>
              )}
              {!isDir && onEditFile && isTextFile(entry.name) && (
                <DropdownMenuItem onClick={() => onEditFile(entry)}>
                  <FileCode2 className="mr-2 h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onRename(entry)}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(entry)}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {menuItems}
      </ContextMenuContent>
    </ContextMenu>
  );
}
