import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDate, isPast, isToday } from "@/lib/dateUtils";
import {
  Calendar,
  Clock,
  Flame,
  ArrowUp,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";
import { useTaskStore } from "@/stores/taskStore";
import type { TaskRow } from "@/types/db";
import type { TaskStatus } from "@/types/task";

interface TaskBoardProps {
  tasks: TaskRow[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onMoveTask: (id: string, status: string) => void;
}

const COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: "todo", label: "To Do", color: "bg-slate-500" },
  { key: "in_progress", label: "In Progress", color: "bg-blue-500" },
  { key: "done", label: "Done", color: "bg-green-500" },
  { key: "cancelled", label: "Cancelled", color: "bg-gray-400" },
];

const PRIORITY_ICONS: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string } | null
> = {
  urgent: { icon: Flame, color: "text-red-500" },
  high: { icon: ArrowUp, color: "text-orange-500" },
  medium: { icon: AlertTriangle, color: "text-yellow-500" },
  low: { icon: AlertCircle, color: "text-blue-400" },
  none: null,
};

export function TaskBoard({
  tasks,
  selectedTaskId,
  onSelectTask,
  onMoveTask,
}: TaskBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [ghostTitle, setGhostTitle] = useState("");
  const [hoverCol, setHoverCol] = useState<TaskStatus | null>(null);
  const { taskLabels, loadTaskLabelsBatch } = useTaskStore();

  // Batch load labels
  useEffect(() => {
    const missingIds = tasks.filter((t) => !taskLabels.has(t.id)).map((t) => t.id);
    if (missingIds.length > 0) loadTaskLabelsBatch(missingIds);
  }, [tasks, taskLabels, loadTaskLabelsBatch]);

  // Refs so closure callbacks always read current values
  const hoverColRef = useRef<TaskStatus | null>(null);
  const columnElsRef = useRef<Map<string, HTMLElement>>(new Map());

  const startPointerDrag = useCallback(
    (e: React.PointerEvent, task: TaskRow) => {
      // Only left/primary pointer
      if (e.button !== 0 && e.pointerType === "mouse") return;

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;

      const updateHoverCol = (clientX: number, clientY: number) => {
        let found: TaskStatus | null = null;
        columnElsRef.current.forEach((el, key) => {
          const rect = el.getBoundingClientRect();
          if (
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom
          ) {
            found = key as TaskStatus;
          }
        });
        hoverColRef.current = found;
        setHoverCol(found);
      };

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (!dragging && Math.sqrt(dx * dx + dy * dy) > 6) {
          dragging = true;
          setDraggingId(task.id);
          setGhostTitle(task.title);
          document.body.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
        }

        if (dragging) {
          setGhostPos({ x: ev.clientX, y: ev.clientY });
          updateHoverCol(ev.clientX, ev.clientY);
        }
      };

      const handleUp = (ev: PointerEvent) => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        if (dragging) {
          const col = hoverColRef.current;
          if (col) onMoveTask(task.id, col);
        } else {
          // Short tap/click — select the task
          void ev; // used to differentiate click path
          onSelectTask(task.id);
        }

        hoverColRef.current = null;
        setDraggingId(null);
        setGhostPos(null);
        setHoverCol(null);
      };

      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp);
    },
    [onMoveTask, onSelectTask],
  );

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const columnTasks = tasks.filter((t) => t.status === col.key);
          const isOver = hoverCol === col.key && draggingId !== null;

          return (
            <div
              key={col.key}
              ref={(el) => {
                if (el) columnElsRef.current.set(col.key, el);
                else columnElsRef.current.delete(col.key);
              }}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-xl bg-muted/30 transition-all",
                isOver && "ring-2 ring-primary/40 bg-primary/5",
              )}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className={cn("h-2 w-2 rounded-full", col.color)} />
                <span className="text-xs font-semibold">{col.label}</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {columnTasks.length}
                </Badge>
              </div>

              {/* Cards */}
              <div className="min-h-16 flex-1 space-y-1.5 px-2 pb-2">
                {columnTasks.map((task) => {
                  const isDone =
                    task.status === "done" || task.status === "cancelled";
                  const priorityCfg = PRIORITY_ICONS[task.priority];
                  const overdue =
                    task.due_date && isPast(task.due_date) && !isDone;
                  const dueToday =
                    task.due_date && isToday(task.due_date) && !isDone;

                  return (
                    <div
                      key={task.id}
                      onPointerDown={(e) => startPointerDrag(e, task)}
                      className={cn(
                        "cursor-grab select-none rounded-lg border border-border/50 bg-background p-3 shadow-sm transition-all",
                        "hover:shadow-md",
                        selectedTaskId === task.id && "ring-2 ring-primary/40",
                        draggingId === task.id && "opacity-40 scale-95",
                      )}
                    >
                      <span
                        className={cn(
                          "block text-sm leading-snug",
                          isDone && "text-muted-foreground line-through",
                        )}
                      >
                        {task.title}
                      </span>

                      {/* Meta row */}
                      <div className="mt-2 flex items-center gap-2">
                        {priorityCfg && (
                          <priorityCfg.icon
                            className={cn("h-3 w-3", priorityCfg.color)}
                          />
                        )}
                        {task.estimated_min && (
                          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <Clock className="h-2.5 w-2.5" />
                            {task.estimated_min}m
                          </span>
                        )}
                        {task.due_date && (
                          <span
                            className={cn(
                              "ml-auto flex items-center gap-0.5 text-[10px]",
                              overdue
                                ? "font-medium text-red-500"
                                : dueToday
                                  ? "font-medium text-orange-500"
                                  : "text-muted-foreground",
                            )}
                          >
                            <Calendar className="h-2.5 w-2.5" />
                            {formatDate(task.due_date)}
                          </span>
                        )}
                      </div>

                      {/* Labels */}
                      {(taskLabels.get(task.id) ?? []).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(taskLabels.get(task.id) ?? []).map((label) => (
                            <span
                              key={label.id}
                              className="rounded-full px-1.5 py-px text-[9px] font-medium text-white"
                              style={{ backgroundColor: label.color }}
                            >
                              {label.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {columnTasks.length === 0 && (
                  <div className="py-8 text-center text-xs text-muted-foreground/50">
                    {isOver ? "Drop here" : "No tasks"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Drag ghost — rendered in body via portal so it's above everything */}
      {ghostPos &&
        draggingId &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: ghostPos.x - 12,
              top: ghostPos.y - 12,
              width: 288,
              pointerEvents: "none",
              zIndex: 9999,
              transform: "rotate(2deg)",
            }}
            className="rounded-lg border border-border bg-background p-3 shadow-2xl opacity-90"
          >
            <span className="block text-sm leading-snug">{ghostTitle}</span>
          </div>,
          document.body,
        )}
    </>
  );
}

