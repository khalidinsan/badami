import { useState, useRef, useCallback, useEffect } from "react";
import { ExternalLink, Plus, Maximize2, Minimize2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import { MiniBlockNote } from "@/components/editor/MiniBlockNote";
import { TaskCheckbox } from "@/components/tasks/TaskCheckbox";
import * as taskQueries from "@/db/queries/tasks";
import type { TaskRow } from "@/types/db";

interface StickyTaskExpandProps {
  task: TaskRow;
  onUpdate: (id: string, data: Partial<TaskRow>) => void;
  onOpenInMain: (id: string) => void;
}

export function StickyTaskExpand({ task, onUpdate, onOpenInMain }: StickyTaskExpandProps) {
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [dueTime, setDueTime] = useState(task.due_time ?? "");
  const [subtasks, setSubtasks] = useState<TaskRow[]>([]);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [notesExpanded, setNotesExpanded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync when task prop changes
  useEffect(() => {
    setDueDate(task.due_date ?? "");
    setDueTime(task.due_time ?? "");
  }, [task.id, task.due_date, task.due_time]);

  // Load subtasks
  useEffect(() => {
    taskQueries.getSubtasks(task.id).then(setSubtasks);
  }, [task.id]);

  const handleContentChange = useCallback(
    (content: string) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onUpdate(task.id, { content: content || null });
      }, 600);
    },
    [task.id, onUpdate],
  );

  const handleToggleSubtask = async (subId: string) => {
    const sub = subtasks.find((s) => s.id === subId);
    if (!sub) return;
    const newStatus =
      sub.status === "todo"
        ? "in_progress"
        : sub.status === "in_progress"
          ? "done"
          : "todo";
    await taskQueries.updateTask(subId, { status: newStatus });
    setSubtasks((prev) =>
      prev.map((s) => (s.id === subId ? { ...s, status: newStatus } : s)),
    );
  };

  const handleAddSubtask = async () => {
    const t = newSubtaskTitle.trim();
    if (!t) return;
    const created = await taskQueries.createTask({
      title: t,
      parent_id: task.id,
      project_id: task.project_id,
      depth: (task.depth ?? 0) + 1,
    });
    setSubtasks((prev) => [...prev, created]);
    setNewSubtaskTitle("");
  };

  const doneCount = subtasks.filter((s) => s.status === "done").length;

  // Detect if content has multiple blocks (auto-expand if lengthy)
  const hasContent = !!task.content && task.content !== "[]" && task.content !== '[{"type":"paragraph","content":[]}]';

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="overflow-hidden"
    >
      <div className="space-y-2 px-7 pb-2 pt-0.5">
        {/* Notes — BlockNote editor */}
        <div className="relative">
          <div
            className={cn(
              "overflow-hidden rounded-md bg-black/5 transition-all dark:bg-white/5",
              notesExpanded ? "max-h-[400px] overflow-y-auto" : hasContent ? "max-h-[120px]" : "max-h-[60px]",
            )}
          >
            <MiniBlockNote
              key={task.id}
              initialContent={task.content}
              onChange={handleContentChange}
            />
          </div>
          <button
            type="button"
            onClick={() => setNotesExpanded((v) => !v)}
            className={cn(
              "absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded",
              "text-muted-foreground/40 transition-colors hover:bg-black/10 hover:text-muted-foreground",
              "dark:hover:bg-white/10",
            )}
            title={notesExpanded ? "Collapse notes" : "Expand notes"}
          >
            {notesExpanded ? (
              <Minimize2 className="h-2.5 w-2.5" />
            ) : (
              <Maximize2 className="h-2.5 w-2.5" />
            )}
          </button>
        </div>

        {/* Subtasks */}
        <div>
          <div className="flex items-center gap-1.5 pb-1">
            <span className="text-[10px] font-medium text-muted-foreground">
              Subtasks
              {subtasks.length > 0 && (
                <span className="ml-1 text-muted-foreground/60">
                  ({doneCount}/{subtasks.length})
                </span>
              )}
            </span>
            {!addingSubtask && (
              <button
                onClick={() => setAddingSubtask(true)}
                className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-black/10 hover:text-muted-foreground dark:hover:bg-white/10"
              >
                <Plus className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {subtasks.map((sub) => (
              <div key={sub.id} className="flex items-center gap-1.5 rounded px-0.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/5">
                <TaskCheckbox
                  status={sub.status as "todo" | "in_progress" | "done" | "cancelled"}
                  onChange={() => handleToggleSubtask(sub.id)}
                />
                <span
                  className={cn(
                    "text-[11px]",
                    (sub.status === "done" || sub.status === "cancelled") && "text-muted-foreground line-through",
                  )}
                >
                  {sub.title}
                </span>
              </div>
            ))}
            {addingSubtask && (
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddSubtask();
                  }
                  if (e.key === "Escape") {
                    setAddingSubtask(false);
                    setNewSubtaskTitle("");
                  }
                }}
                onBlur={() => {
                  if (newSubtaskTitle.trim()) handleAddSubtask();
                  setAddingSubtask(false);
                  setNewSubtaskTitle("");
                }}
                placeholder="Subtask title..."
                className="w-full rounded bg-black/5 px-1.5 py-0.5 text-[11px] outline-none placeholder:text-muted-foreground/40 dark:bg-white/5"
              />
            )}
          </div>
        </div>

        {/* Due date + time */}
        <div className="flex items-center gap-2">
          <DatePicker
            value={dueDate || null}
            onChange={(date) => {
              setDueDate(date ?? "");
              onUpdate(task.id, { due_date: date });
            }}
            size="xs"
            placeholder="Due date"
          />
          <input
            type="time"
            value={dueTime}
            onChange={(e) => {
              setDueTime(e.target.value);
              onUpdate(task.id, { due_time: e.target.value || null });
            }}
            className="h-6 rounded-md border-none bg-black/5 px-1.5 text-[10px] outline-none dark:bg-white/5"
          />
          <button
            onClick={() => onOpenInMain(task.id)}
            className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
          >
            Open in Tasks
            <ExternalLink className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
