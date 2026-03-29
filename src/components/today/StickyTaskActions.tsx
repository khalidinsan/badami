import { useState, useRef, useEffect } from "react";
import {
  Flame,
  ArrowUp,
  AlertTriangle,
  AlertCircle,
  Minus,
  FolderKanban,
  Trash2,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskRow, ProjectRow } from "@/types/db";

const PRIORITY_OPTIONS = [
  { value: "urgent", icon: Flame, color: "text-red-500", label: "Urgent" },
  { value: "high", icon: ArrowUp, color: "text-orange-500", label: "High" },
  { value: "medium", icon: AlertTriangle, color: "text-yellow-500", label: "Medium" },
  { value: "low", icon: AlertCircle, color: "text-blue-400", label: "Low" },
  { value: "none", icon: Minus, color: "text-muted-foreground/50", label: "None" },
] as const;

interface StickyTaskActionsProps {
  task: TaskRow;
  projects: ProjectRow[];
  focused?: boolean;
  onPriorityChange: (id: string, priority: string) => void;
  onProjectChange: (id: string, projectId: string | null) => void;
  onDelete: (id: string) => void;
  onFocus?: (id: string) => void;
}

export function StickyTaskActions({
  task,
  projects,
  focused,
  onPriorityChange,
  onProjectChange,
  onDelete,
  onFocus,
}: StickyTaskActionsProps) {
  const [openPopover, setOpenPopover] = useState<"priority" | "project" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPopover) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenPopover(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openPopover]);

  const currentPriority = PRIORITY_OPTIONS.find((p) => p.value === task.priority) ?? PRIORITY_OPTIONS[4];
  const PriorityIcon = currentPriority.icon;

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
    >
      {/* Priority */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpenPopover(openPopover === "priority" ? null : "priority");
        }}
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-black/10 dark:hover:bg-white/10",
          currentPriority.color,
        )}
        title="Set priority"
      >
        <PriorityIcon className="h-3 w-3" />
      </button>

      {/* Project */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpenPopover(openPopover === "project" ? null : "project");
        }}
        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-black/10 hover:text-muted-foreground dark:hover:bg-white/10"
        title="Assign project"
      >
        <FolderKanban className="h-3 w-3" />
      </button>

      {/* Focus */}
      {onFocus && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFocus(task.id);
          }}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded transition-colors",
            focused
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground/60 hover:bg-black/10 hover:text-muted-foreground dark:hover:bg-white/10",
          )}
          title={focused ? "Unfocus" : "Focus"}
        >
          <Target className="h-3 w-3" />
        </button>
      )}

      {/* Delete */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(task.id);
        }}
        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-red-500/10 hover:text-red-500 dark:hover:bg-red-500/20"
        title="Delete task"
      >
        <Trash2 className="h-3 w-3" />
      </button>

      {/* Priority Popover */}
      {openPopover === "priority" && (
        <div className="absolute right-0 top-full z-50 mt-1 w-32 rounded-lg border border-border/50 bg-popover p-1 shadow-lg">
          {PRIORITY_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={(e) => {
                  e.stopPropagation();
                  onPriorityChange(task.id, opt.value);
                  setOpenPopover(null);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent",
                  task.priority === opt.value && "bg-accent",
                )}
              >
                <Icon className={cn("h-3 w-3", opt.color)} />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Project Popover */}
      {openPopover === "project" && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-48 w-44 overflow-y-auto rounded-lg border border-border/50 bg-popover p-1 shadow-lg">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onProjectChange(task.id, null);
              setOpenPopover(null);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent",
              !task.project_id && "bg-accent",
            )}
          >
            <Minus className="h-3 w-3 text-muted-foreground/50" />
            No Project
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={(e) => {
                e.stopPropagation();
                onProjectChange(task.id, p.id);
                setOpenPopover(null);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent",
                task.project_id === p.id && "bg-accent",
              )}
            >
              <FolderKanban className="h-3 w-3 text-muted-foreground/50" />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
