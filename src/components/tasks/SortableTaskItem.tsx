import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskRow, LabelRow } from "@/types/db";
import { TaskItem } from "./TaskItem";

interface SortableTaskItemProps {
  task: TaskRow;
  labels?: LabelRow[];
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  subtaskProgress?: { done: number; total: number };
  onToggle: (id: string) => void;
  onToggleStar?: (id: string) => void;
  onClick: (id: string) => void;
  onExpand?: (id: string) => void;
  children?: React.ReactNode;
}

export function SortableTaskItem({
  task,
  labels,
  hasChildren,
  expanded,
  selected,
  subtaskProgress,
  onToggle,
  onToggleStar,
  onClick,
  onExpand,
  children,
}: SortableTaskItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "z-50 opacity-50")}
    >
      <div className="group relative flex items-center gap-1 rounded-lg transition-colors hover:bg-muted/60">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/40 active:cursor-grabbing"
          tabIndex={-1}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        <div className="min-w-0 flex-1">
          <TaskItem
            task={task}
            labels={labels}
            depth={task.depth}
            hasChildren={hasChildren}
            expanded={expanded}
            selected={selected}
            noHover
            subtaskProgress={subtaskProgress}
            onToggle={onToggle}
            onToggleStar={onToggleStar}
            onClick={onClick}
            onExpand={onExpand}
          />
        </div>
        {children}
      </div>
    </div>
  );
}
