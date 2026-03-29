import { useState } from "react";
import { ChevronRight, ChevronDown, Folder, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { RequestItem } from "./RequestItem";
import type { ApiFolderRow, ApiRequestRow } from "@/types/db";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Pencil, Trash2 } from "lucide-react";
import type { DragEvent } from "react";

interface FolderItemProps {
  folder: ApiFolderRow;
  requests: ApiRequestRow[];
  selectedRequestId: string | null;
  onSelectRequest: (id: string) => void;
  onDeleteFolder: () => void;
  onRenameFolder: () => void;
  onAddRequest: () => void;
  onDeleteRequest: (id: string) => void;
  onRenameRequest: (id: string) => void;
  onDuplicateRequest: (id: string) => void;
  onMoveRequest?: (requestId: string, folderId: string | null) => void;
}

export function FolderItem({
  folder,
  requests,
  selectedRequestId,
  onSelectRequest,
  onDeleteFolder,
  onRenameFolder,
  onAddRequest,
  onDeleteRequest,
  onRenameRequest,
  onDuplicateRequest,
  onMoveRequest,
}: FolderItemProps) {
  const [expanded, setExpanded] = useState(true);
  const [dropOver, setDropOver] = useState(false);

  const handleDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-api-request-id")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropOver(true);
    }
  };

  const handleDragLeave = () => setDropOver(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const reqId = e.dataTransfer.getData("application/x-api-request-id");
    if (reqId && onMoveRequest) {
      onMoveRequest(reqId, folder.id);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={() => setExpanded(!expanded)}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              dropOver && "bg-[#007AFF]/10 ring-1 ring-[#007AFF]/30",
            )}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
            <Folder className="h-3.5 w-3.5 shrink-0 text-[#007AFF]/70" />
            <span className="whitespace-nowrap">{folder.name}</span>
            <span className="ml-auto text-[10px] text-muted-foreground/50">
              {requests.length}
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onAddRequest} className="gap-2 text-xs">
            <Plus className="h-3 w-3" /> New Request
          </ContextMenuItem>
          <ContextMenuItem onClick={onRenameFolder} className="gap-2 text-xs">
            <Pencil className="h-3 w-3" /> Rename
          </ContextMenuItem>
          <ContextMenuItem
            onClick={onDeleteFolder}
            className="gap-2 text-xs text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {expanded && (
        <div className="ml-3 space-y-0.5 border-l border-border/40 pl-2">
          {requests.map((req) => (
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
          {requests.length === 0 && (
            <p className="py-1 text-[10px] text-muted-foreground/50">
              No requests
            </p>
          )}
        </div>
      )}
    </div>
  );
}
