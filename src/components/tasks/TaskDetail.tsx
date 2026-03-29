import { useState, useCallback, useEffect } from "react";
import {
  X,
  Trash2,
  Calendar,
  Clock,
  FolderKanban,
  Tag,
  ArrowUp,
  AlertTriangle,
  AlertCircle,
  Flame,
  Minus,
  Expand,
  Shrink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { BlockNoteEditor } from "@/components/editor/BlockNoteEditor";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/dateUtils";
import { useTaskStore } from "@/stores/taskStore";
import * as taskQueries from "@/db/queries/tasks";
import * as projectQueries from "@/db/queries/projects";
import type { TaskRow, ProjectRow, LabelRow } from "@/types/db";

interface TaskDetailProps {
  taskId: string;
  onClose: () => void;
}

const PRIORITY_OPTIONS = [
  { value: "none", label: "None", icon: Minus, color: "text-muted-foreground" },
  { value: "low", label: "Low", icon: AlertCircle, color: "text-blue-400" },
  { value: "medium", label: "Medium", icon: AlertTriangle, color: "text-yellow-500" },
  { value: "high", label: "High", icon: ArrowUp, color: "text-orange-500" },
  { value: "urgent", label: "Urgent", icon: Flame, color: "text-red-500" },
];

const STATUS_OPTIONS = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

export function TaskDetail({ taskId, onClose }: TaskDetailProps) {
  const { updateTask, deleteTask, labels, setTaskLabels, taskLabels, loadTaskLabels } =
    useTaskStore();

  const [task, setTask] = useState<TaskRow | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [title, setTitle] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [subtasks, setSubtasks] = useState<TaskRow[]>([]);
  const [fullPage, setFullPage] = useState(false);

  useEffect(() => {
    taskQueries.getTaskById(taskId).then((t) => {
      if (t) {
        setTask(t);
        setTitle(t.title);
      }
    });
    taskQueries.getSubtasks(taskId).then(setSubtasks);
    projectQueries.getProjects("active").then(setProjects);
    loadTaskLabels(taskId);
  }, [taskId]);

  const currentLabels = taskLabels.get(taskId) ?? [];

  const handleTitleBlur = useCallback(() => {
    if (title && title !== task?.title) {
      updateTask(taskId, { title });
    }
  }, [taskId, title, task?.title, updateTask]);

  const handleFieldChange = useCallback(
    async (field: string, value: unknown) => {
      // Optimistic: update local state immediately
      setTask((prev) => prev ? { ...prev, [field]: value } as TaskRow : prev);
      try {
        await updateTask(taskId, { [field]: value });
        const updated = await taskQueries.getTaskById(taskId);
        if (updated) setTask(updated);
      } catch {
        const current = await taskQueries.getTaskById(taskId);
        if (current) setTask(current);
      }
    },
    [taskId, updateTask],
  );

  const handleContentChange = useCallback(
    async (content: string) => {
      await updateTask(taskId, { content });
    },
    [taskId, updateTask],
  );

  const handleDelete = async () => {
    await deleteTask(taskId);
    onClose();
  };

  const toggleLabel = async (label: LabelRow) => {
    const current = currentLabels.map((l) => l.id);
    const newIds = current.includes(label.id)
      ? current.filter((id) => id !== label.id)
      : [...current, label.id];
    await setTaskLabels(taskId, newIds);
  };

  if (!task) return null;

  return (
    <div
      className={cn(
        "glass-page-sidebar flex flex-col border-l border-border/50",
        fullPage
          ? "absolute inset-0 z-50 border-l-0 bg-background"
          : "sticky top-0 h-screen w-96 shrink-0",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-medium text-muted-foreground">Task Detail</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => setFullPage((v) => !v)}
            title={fullPage ? "Collapse" : "Expand to full page"}
          >
            {fullPage ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Separator />

      {/* Content */}
      <div className={cn("flex-1 overflow-auto", fullPage && "flex justify-center")}>
        <div className={cn("w-full", fullPage && "max-w-3xl px-8")}>
        {/* Title */}
        <div className="px-4 pt-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            className="border-none bg-transparent px-0 text-lg font-bold shadow-none placeholder:text-muted-foreground/40 focus-visible:ring-0"
            placeholder="Task title"
          />
        </div>

        {/* Metadata fields */}
        <div className="space-y-3 px-4 py-4">
          {/* Status */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-xs text-muted-foreground">Status</span>
            <Select
              value={task.status}
              onValueChange={(v) => handleFieldChange("status", v)}
            >
              <SelectTrigger className="h-7 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Priority */}
          <div className="flex items-center gap-3">
            <span className="w-20 text-xs text-muted-foreground">Priority</span>
            <Select
              value={task.priority}
              onValueChange={(v) => handleFieldChange("priority", v)}
            >
              <SelectTrigger className="h-7 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <Icon className={cn("h-3.5 w-3.5", opt.color)} />
                        {opt.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Project */}
          <div className="flex items-center gap-3">
            <span className="flex w-20 items-center gap-1 text-xs text-muted-foreground">
              <FolderKanban className="h-3 w-3" />
              Project
            </span>
            <Select
              value={task.project_id ?? "__none__"}
              onValueChange={(v) =>
                handleFieldChange("project_id", v === "__none__" ? null : v)
              }
            >
              <SelectTrigger className="h-7 flex-1 text-xs">
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No project</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Due date */}
          <div className="flex items-center gap-3">
            <span className="flex w-20 items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              Due date
            </span>
            <DatePicker
              value={task.due_date ?? null}
              onChange={(date) => handleFieldChange("due_date", date)}
              size="sm"
              className="flex-1"
            />
          </div>

          {/* Estimated time */}
          <div className="flex items-center gap-3">
            <span className="flex w-20 items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Estimate
            </span>
            <Input
              type="number"
              min={0}
              value={task.estimated_min ?? ""}
              onChange={(e) =>
                handleFieldChange(
                  "estimated_min",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
              placeholder="minutes"
              className="h-7 flex-1 text-xs"
            />
          </div>
        </div>

        <Separator />

        {/* Labels */}
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center gap-1">
            <Tag className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Labels</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {labels.map((label) => {
              const isAssigned = currentLabels.some((l) => l.id === label.id);
              return (
                <button
                  key={label.id}
                  onClick={() => toggleLabel(label)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    isAssigned
                      ? "border-transparent text-white"
                      : "border-border text-muted-foreground hover:border-foreground/20",
                  )}
                  style={
                    isAssigned
                      ? { backgroundColor: label.color }
                      : undefined
                  }
                >
                  {label.name}
                </button>
              );
            })}
            {labels.length === 0 && (
              <span className="text-[11px] text-muted-foreground">No labels yet</span>
            )}
          </div>
        </div>

        <Separator />

        {/* Subtasks */}
        {subtasks.length > 0 && (
          <>
            <div className="px-4 py-3">
              <span className="text-xs font-medium text-muted-foreground">
                Subtasks ({subtasks.filter((s) => s.status === "done").length}/{subtasks.length})
              </span>
              <div className="mt-2 space-y-1">
                {subtasks.map((sub) => (
                  <div
                    key={sub.id}
                    className={cn(
                      "text-xs",
                      sub.status === "done" && "text-muted-foreground line-through",
                    )}
                  >
                    {sub.title}
                  </div>
                ))}
              </div>
            </div>
            <Separator />
          </>
        )}

        {/* Notes / BlockNote editor */}
        <div className="px-4 py-3">
          <span className="mb-2 block text-xs font-medium text-muted-foreground">
            Notes
          </span>
          <div className="min-h-[120px]">
            <BlockNoteEditor
              initialContent={task.content ?? undefined}
              onChange={handleContentChange}
            />
          </div>
        </div>

        {/* Timestamps */}
        <div className="px-4 pb-4">
          <div className="rounded-lg bg-muted/30 p-3 text-[11px] text-muted-foreground">
            <p>Created: {formatDateTime(task.created_at)}</p>
            <p>Updated: {formatDateTime(task.updated_at)}</p>
            {task.completed_at && (
              <p>Completed: {formatDateTime(task.completed_at)}</p>
            )}
          </div>
        </div>
        </div> {/* end max-w centering wrapper */}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{task.title}&quot; and all its
              subtasks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
