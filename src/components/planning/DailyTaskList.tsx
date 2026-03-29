import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TaskCheckbox } from "@/components/tasks/TaskCheckbox";
import { Button } from "@/components/ui/button";
import { X, GripVertical, FileText, LinkIcon, CheckSquare2, RotateCcw } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import type { TaskRow } from "@/types/db";

interface DailyTaskListProps {
  tasks: TaskRow[];
  onToggle: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onDropTask?: (taskId: string) => void;
  onReorder?: (tasks: TaskRow[]) => void;
}

// ── Per-item sortable wrapper ──────────────────────────────────────────────
function SortableDailyItem({
  task,
  onToggle,
  onDelete,
}: {
  task: TaskRow;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
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

  const isLinked = !!task.project_id;
  const isDone = task.status === "done" || task.status === "cancelled";

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "z-50 opacity-50")}>
      <motion.div
        layout
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
        transition={{ duration: 0.15 }}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                "group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
                "hover:bg-accent/50",
              )}
            >
              {/* Drag handle */}
              <button
                {...attributes}
                {...listeners}
                className="shrink-0 cursor-grab text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/40 active:cursor-grabbing"
                tabIndex={-1}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>

              <motion.div
                animate={isDone ? { scale: [1, 1.25, 1] } : { scale: 1 }}
                transition={{ duration: 0.2 }}
              >
                <TaskCheckbox
                  status={task.status as "todo" | "in_progress" | "done" | "cancelled"}
                  onChange={() => onToggle(task.id)}
                />
              </motion.div>

              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {isLinked ? (
                  <LinkIcon className="h-3 w-3 shrink-0 text-primary/50" />
                ) : (
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                )}
                <span
                  className={cn(
                    "truncate text-sm transition-all",
                    isDone && "text-muted-foreground line-through",
                  )}
                >
                  {task.title || "Untitled"}
                </span>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => onDelete(task.id)}
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </Button>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => onToggle(task.id)}>
              {isDone ? <><RotateCcw /> Reopen</> : <><CheckSquare2 /> Mark Done</>}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => onDelete(task.id)}>
              <X /> Remove from today
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </motion.div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function DailyTaskList({
  tasks,
  onToggle,
  onDelete,
  onDropTask,
  onReorder,
}: DailyTaskListProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [localTasks, setLocalTasks] = useState<TaskRow[]>(tasks);

  // Keep local copy in sync when store changes
  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = localTasks.findIndex((t) => t.id === active.id);
      const newIndex = localTasks.findIndex((t) => t.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(localTasks, oldIndex, newIndex);
      setLocalTasks(reordered);
      onReorder?.(reordered);
    },
    [localTasks, onReorder],
  );

  // HTML5 drag handlers — used for TaskPool → list drops (within-app drag)
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const taskId = e.dataTransfer.getData("text/plain");
    if (taskId && onDropTask) onDropTask(taskId);
  };

  if (localTasks.length === 0) {
    return (
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "rounded-xl border-2 border-dashed py-10 text-center transition-colors",
          isDragOver ? "border-primary/50 bg-primary/5" : "border-transparent",
        )}
      >
        <p className="text-sm text-muted-foreground/60">
          {isDragOver ? "Drop to add" : "No plans for this day"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/40">
          Drag tasks here or add notes below
        </p>
      </div>
    );
  }

  const done = localTasks.filter(
    (t) => t.status === "done" || t.status === "cancelled",
  ).length;

  return (
    <div
      className={cn(
        "space-y-1 rounded-xl border-2 border-dashed p-1 transition-colors",
        isDragOver ? "border-primary/50 bg-primary/5" : "border-transparent",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {done}/{localTasks.length} completed
        </span>
        {localTasks.length > 0 && (
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(done / localTasks.length) * 100}%` }}
            />
          </div>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={localTasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <AnimatePresence initial={false}>
            {localTasks.map((task) => (
              <SortableDailyItem
                key={task.id}
                task={task}
                onToggle={onToggle}
                onDelete={onDelete}
              />
            ))}
          </AnimatePresence>
        </SortableContext>
      </DndContext>
    </div>
  );
}

