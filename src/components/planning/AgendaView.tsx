import { useEffect, useState } from "react";
import { TaskCheckbox } from "@/components/tasks/TaskCheckbox";
import { cn } from "@/lib/utils";
import { formatDate, isPast, isToday } from "@/lib/dateUtils";
import dayjs from "dayjs";
import { Calendar, Flame, ArrowUp, AlertTriangle, AlertCircle, Minus } from "lucide-react";
import * as planningQueries from "@/db/queries/planning";
import type { TaskRow } from "@/types/db";

interface AgendaViewProps {
  onSelectDate: (date: string) => void;
  onToggleTask: (taskId: string) => void;
  onSelectTask?: (taskId: string) => void;
}

interface DayGroup {
  date: string;
  tasks: TaskRow[];
}

const PRIORITY_CONFIG: Record<string, { icon: typeof Flame; color: string }> = {
  urgent: { icon: Flame, color: "text-red-500" },
  high: { icon: ArrowUp, color: "text-orange-500" },
  medium: { icon: AlertTriangle, color: "text-yellow-500" },
  low: { icon: AlertCircle, color: "text-blue-500" },
};

export function AgendaView({ onSelectDate, onToggleTask, onSelectTask }: AgendaViewProps) {
  const [groups, setGroups] = useState<DayGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAgenda();
  }, []);

  const loadAgenda = async () => {
    setLoading(true);
    const startDate = dayjs().format("YYYY-MM-DD");
    const endDate = dayjs().add(30, "day").format("YYYY-MM-DD");

    const tasks = await planningQueries.getTasksForRange(startDate, endDate);

    // Group by date
    const dateMap = new Map<string, TaskRow[]>();

    // Ensure all 30 days appear
    for (let i = 0; i < 30; i++) {
      const d = dayjs().add(i, "day").format("YYYY-MM-DD");
      dateMap.set(d, []);
    }

    for (const task of tasks) {
      if (task.due_date) {
        const existing = dateMap.get(task.due_date) ?? [];
        existing.push(task);
        dateMap.set(task.due_date, existing);
      }
    }

    const sorted = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, tasks]) => ({ date, tasks }));

    setGroups(sorted);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading agenda...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-1 p-4">
        {groups.map((group) => {
          const isDateToday = isToday(group.date);
          const isDatePast = isPast(group.date) && !isDateToday;

          return (
            <div key={group.date} className="mb-4">
              {/* Date header */}
              <button
                className={cn(
                  "mb-1 flex items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold transition-colors hover:bg-muted/60",
                  isDateToday && "text-primary",
                  isDatePast && "text-muted-foreground/60",
                )}
                onClick={() => onSelectDate(group.date)}
              >
                <Calendar className="h-3.5 w-3.5" />
                {isDateToday ? "Today" : formatDate(group.date)}
                {dayjs(group.date).format(" (ddd)")}
              </button>

              {/* Tasks */}
              {group.tasks.length === 0 ? (
                <p className="ml-8 text-xs text-muted-foreground/40 italic">
                  No tasks
                </p>
              ) : (
                <div className="space-y-0.5">
                  {group.tasks.map((task) => {
                    const isDone = task.status === "done" || task.status === "cancelled";
                    const priorityCfg = PRIORITY_CONFIG[task.priority];
                    const PriorityIcon = priorityCfg?.icon ?? Minus;

                    return (
                      <div
                        key={task.id}
                        className="group flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/40"
                      >
                        <TaskCheckbox
                          status={task.status as "todo" | "in_progress" | "done" | "cancelled"}
                          onChange={() => onToggleTask(task.id)}
                          className={isDone ? "opacity-50" : undefined}
                        />
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => onSelectTask?.(task.id)}
                        >
                          {task.priority !== "none" && (
                            <PriorityIcon className={cn("h-3 w-3 shrink-0", priorityCfg?.color)} />
                          )}
                          <span
                            className={cn(
                              "truncate text-sm",
                              isDone && "text-muted-foreground line-through",
                            )}
                          >
                            {task.title}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
