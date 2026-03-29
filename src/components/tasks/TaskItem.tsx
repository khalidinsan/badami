import {
  ChevronRight,
  Calendar,
  Clock,
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  Flame,
  Minus,
  Star,
  Repeat,
} from "lucide-react";
import { TaskCheckbox } from "@/components/tasks/TaskCheckbox";
import { cn } from "@/lib/utils";
import { formatDate, isPast, isToday } from "@/lib/dateUtils";
import type { TaskRow, LabelRow } from "@/types/db";

interface TaskItemProps {
  task: TaskRow;
  labels?: LabelRow[];
  depth?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  selected?: boolean;
  noHover?: boolean;
  subtaskProgress?: { done: number; total: number };
  onToggle: (id: string) => void;
  onToggleStar?: (id: string) => void;
  onClick: (id: string) => void;
  onExpand?: (id: string) => void;
}

const PRIORITY_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string; label: string }
> = {
  urgent: { icon: Flame, color: "text-red-500", label: "Urgent" },
  high: { icon: ArrowUp, color: "text-orange-500", label: "High" },
  medium: { icon: AlertTriangle, color: "text-yellow-500", label: "Medium" },
  low: { icon: AlertCircle, color: "text-blue-400", label: "Low" },
  none: { icon: Minus, color: "text-muted-foreground/50", label: "None" },
};

export function TaskItem({
  task,
  labels = [],
  depth = 0,
  hasChildren = false,
  expanded = false,
  selected = false,
  noHover = false,
  subtaskProgress,
  onToggle,
  onToggleStar,
  onClick,
  onExpand,
}: TaskItemProps) {
  const isDone = task.status === "done" || task.status === "cancelled";
  const priorityCfg = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.none;
  const PriorityIcon = priorityCfg.icon;
  const overdue = task.due_date && isPast(task.due_date) && !isDone;
  const dueToday = task.due_date && isToday(task.due_date) && !isDone;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
        noHover ? "group-hover:bg-muted/60" : "group hover:bg-muted/60",
        selected ? "bg-muted" : "",
        depth > 0 && "ml-6",
      )}
    >
      {/* Expand toggle for parents */}
      <button
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded",
          hasChildren
            ? "text-muted-foreground hover:bg-muted"
            : "invisible",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onExpand?.(task.id);
        }}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>

      {/* Checkbox — 3-state: todo → in_progress → done */}
      <TaskCheckbox
        status={task.status as "todo" | "in_progress" | "done" | "cancelled"}
        onChange={() => onToggle(task.id)}
        className={isDone ? "opacity-50" : undefined}
      />

      {/* Content — clickable area */}
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => onClick(task.id)}
      >
        <span
          className={cn(
            "truncate text-sm",
            isDone && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </span>

        {/* Subtask progress chip */}
        {hasChildren && subtaskProgress && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {subtaskProgress.done}/{subtaskProgress.total}
          </span>
        )}

        {/* Labels */}
        {labels.length > 0 && (
          <div className="flex shrink-0 gap-1">
            {labels.map((label) => (
              <span
                key={label.id}
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: label.color }}
                title={label.name}
              />
            ))}
          </div>
        )}
      </button>

      {/* Right side info */}
      {/* Right side info */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Star toggle */}
        {onToggleStar && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(task.id);
            }}
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded transition-colors",
              task.is_starred
                ? "text-amber-400"
                : "text-muted-foreground/0 group-hover:text-muted-foreground/40",
            )}
            title={task.is_starred ? "Unstar" : "Star"}
          >
            <Star className={cn("h-3.5 w-3.5", task.is_starred && "fill-current")} />
          </button>
        )}

        {/* Priority */}
        {task.priority !== "none" && (
          <PriorityIcon
            className={cn("h-3.5 w-3.5", priorityCfg.color)}
          />
        )}

        {/* Estimated time */}
        {task.estimated_min && (
          <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {task.estimated_min}m
          </span>
        )}

        {/* Due date + time */}
        {task.due_date && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-[11px]",
              overdue
                ? "font-medium text-red-500"
                : dueToday
                  ? "font-medium text-orange-500"
                  : "text-muted-foreground",
            )}
          >
            <Calendar className="h-3 w-3" />
            {formatDate(task.due_date)}
            {(task as any).due_time && (
              <span className="ml-0.5">{(task as any).due_time}</span>
            )}
          </span>
        )}

        {/* Recurring indicator */}
        {(task as any).recurrence_rule && (
          <Repeat className="h-3 w-3 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
