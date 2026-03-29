import { cn } from "@/lib/utils";
import { METHOD_COLORS } from "@/types/api";
import type { ApiRequestRow } from "@/types/db";
import type { HttpMethod } from "@/types/api";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Copy, Trash2, Pencil } from "lucide-react";
import type { DragEvent } from "react";

interface RequestItemProps {
  request: ApiRequestRow;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: () => void;
  onDuplicate: () => void;
}

export function RequestItem({
  request,
  isSelected,
  onSelect,
  onDelete,
  onRename,
  onDuplicate,
}: RequestItemProps) {
  const method = request.method as HttpMethod;
  const methodColor = METHOD_COLORS[method] || "#6b7280";

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer.setData("application/x-api-request-id", request.id);
    e.dataTransfer.setData("application/x-api-collection-id", request.collection_id);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          draggable
          onDragStart={handleDragStart}
          onClick={onSelect}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
            isSelected
              ? "bg-accent font-medium"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <span
            className="shrink-0 rounded px-1 py-0.5 text-[10px] font-bold leading-none"
            style={{ color: methodColor }}
          >
            {method.substring(0, 3)}
          </span>
          <span className="whitespace-nowrap">{request.name}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onRename} className="gap-2 text-xs">
          <Pencil className="h-3 w-3" /> Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={onDuplicate} className="gap-2 text-xs">
          <Copy className="h-3 w-3" /> Duplicate
        </ContextMenuItem>
        <ContextMenuItem
          onClick={onDelete}
          className="gap-2 text-xs text-destructive focus:text-destructive"
        >
          <Trash2 className="h-3 w-3" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
