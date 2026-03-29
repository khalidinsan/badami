import { useEffect, useState } from "react";
import { TaskCheckbox } from "@/components/tasks/TaskCheckbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import * as taskQueries from "@/db/queries/tasks";
import type { TaskRow } from "@/types/db";

interface TaskPoolProps {
  selectedDate: string;
  existingTaskIds: Set<string>;
  onAddTask: (taskId: string) => void;
}

export function TaskPool({
  selectedDate,
  existingTaskIds,
  onAddTask,
}: TaskPoolProps) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  useEffect(() => {
    const load = async () => {
      const all = await taskQueries.getRootTasks({});
      setTasks(
        all.filter(
          (t) =>
            (t.status === "todo" || t.status === "in_progress") &&
            !t.due_date &&
            !existingTaskIds.has(t.id),
        ),
      );
    };
    load();
  }, [selectedDate, existingTaskIds]);

  if (tasks.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground/50">
        All tasks are scheduled or completed
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-64">
      <div className="space-y-0.5">
        {tasks.map((task) => (
          <div
            key={task.id}
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", task.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onAddTask(task.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onAddTask(task.id);
            }}
            className={cn(
              "flex w-full cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
              "hover:bg-accent/50",
            )}
          >
            <TaskCheckbox status="todo" onChange={() => onAddTask(task.id)} className="pointer-events-none" />
            <span className="truncate text-sm">{task.title}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
