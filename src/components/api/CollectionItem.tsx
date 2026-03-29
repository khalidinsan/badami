import { useState } from "react";
import type { DragEvent } from "react";
import {
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Plus,
  FolderPlus,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FolderItem } from "./FolderItem";
import { RequestItem } from "./RequestItem";
import type { ApiCollectionRow, ApiFolderRow, ApiRequestRow } from "@/types/db";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Pencil, Copy, Trash2, Variable } from "lucide-react";

interface CollectionItemProps {
  collection: ApiCollectionRow;
  folders: ApiFolderRow[];
  requests: ApiRequestRow[];
  selectedRequestId: string | null;
  onSelectRequest: (id: string) => void;
  onDeleteCollection: () => void;
  onRenameCollection: () => void;
  onDuplicateCollection: () => void;
  onAddFolder: () => void;
  onAddRequest: (folderId?: string | null) => void;
  onDeleteFolder: (id: string) => void;
  onRenameFolder: (id: string) => void;
  onDeleteRequest: (id: string) => void;
  onRenameRequest: (id: string) => void;
  onDuplicateRequest: (id: string) => void;
  onExportCollection: () => void;
  onEditCollectionVariables: () => void;
  onMoveRequest?: (requestId: string, folderId: string | null) => void;
}

export function CollectionItem({
  collection,
  folders,
  requests,
  selectedRequestId,
  onSelectRequest,
  onDeleteCollection,
  onRenameCollection,
  onDuplicateCollection,
  onAddFolder,
  onAddRequest,
  onDeleteFolder,
  onRenameFolder,
  onDeleteRequest,
  onRenameRequest,
  onDuplicateRequest,
  onExportCollection,
  onEditCollectionVariables,
  onMoveRequest,
}: CollectionItemProps) {
  const [expanded, setExpanded] = useState(true);
  const [rootDropOver, setRootDropOver] = useState(false);

  const handleRootDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-api-request-id")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setRootDropOver(true);
    }
  };
  const handleRootDragLeave = () => setRootDropOver(false);
  const handleRootDrop = (e: DragEvent) => {
    e.preventDefault();
    setRootDropOver(false);
    const reqId = e.dataTransfer.getData("application/x-api-request-id");
    if (reqId && onMoveRequest) {
      onMoveRequest(reqId, null); // move to root (no folder)
    }
  };

  // Root-level requests (not in any folder)
  const rootRequests = requests.filter((r) => !r.folder_id);

  return (
    <div className="mb-1">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={() => setExpanded(!expanded)}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
              "text-foreground hover:bg-accent",
            )}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <FolderOpen className="h-4 w-4 shrink-0 text-[#007AFF]" />
            <span className="whitespace-nowrap">{collection.name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onClick={() => onAddRequest(null)}
            className="gap-2 text-xs"
          >
            <Plus className="h-3 w-3" /> New Request
          </ContextMenuItem>
          <ContextMenuItem onClick={onAddFolder} className="gap-2 text-xs">
            <FolderPlus className="h-3 w-3" /> New Folder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={onRenameCollection}
            className="gap-2 text-xs"
          >
            <Pencil className="h-3 w-3" /> Rename
          </ContextMenuItem>
          <ContextMenuItem
            onClick={onDuplicateCollection}
            className="gap-2 text-xs"
          >
            <Copy className="h-3 w-3" /> Duplicate
          </ContextMenuItem>
          <ContextMenuItem
            onClick={onExportCollection}
            className="gap-2 text-xs"
          >
            <Download className="h-3 w-3" /> Export Postman
          </ContextMenuItem>
          <ContextMenuItem
            onClick={onEditCollectionVariables}
            className="gap-2 text-xs"
          >
            <Variable className="h-3 w-3" /> Collection Variables
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={onDeleteCollection}
            className="gap-2 text-xs text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {expanded && (
          <div className="ml-2 space-y-0.5 border-l border-border/40 pl-2">
          {/* Folders */}
          {folders.map((folder) => {
            const folderRequests = requests.filter(
              (r) => r.folder_id === folder.id,
            );
            return (
              <FolderItem
                key={folder.id}
                folder={folder}
                requests={folderRequests}
                selectedRequestId={selectedRequestId}
                onSelectRequest={onSelectRequest}
                onDeleteFolder={() => onDeleteFolder(folder.id)}
                onRenameFolder={() => onRenameFolder(folder.id)}
                onAddRequest={() => onAddRequest(folder.id)}
                onDeleteRequest={onDeleteRequest}
                onRenameRequest={onRenameRequest}
                onDuplicateRequest={onDuplicateRequest}
                onMoveRequest={onMoveRequest}
              />
            );
          })}

          {/* Root-level requests */}
          <div
            onDragOver={handleRootDragOver}
            onDragLeave={handleRootDragLeave}
            onDrop={handleRootDrop}
            className={rootDropOver ? "rounded bg-[#007AFF]/10 ring-1 ring-[#007AFF]/30" : ""}
          >
          {rootRequests.map((req) => (
            <RequestItem
              key={req.id}
              request={req}
              isSelected={selectedRequestId === req.id}
              onSelect={() => onSelectRequest(req.id)}
              onDelete={() => onDeleteRequest(req.id)}
              onRename={() => onRenameRequest(req.id)}
              onDuplicate={() => onDuplicateRequest(req.id)}
            />
          ))}

          {folders.length === 0 && rootRequests.length === 0 && (
            <p className="px-2 py-2 text-[10px] text-muted-foreground/50">
              Empty collection
            </p>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
