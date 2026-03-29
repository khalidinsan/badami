import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
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
  Plus,
  CheckSquare2,
  Expand,
  Shrink,
  MoreHorizontal,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { TaskCheckbox } from "@/components/tasks/TaskCheckbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { RecurrencePicker } from "@/components/tasks/RecurrencePicker";
import { ReminderPicker } from "@/components/tasks/ReminderPicker";
import { cn } from "@/lib/utils";
import { useTaskStore } from "@/stores/taskStore";
import * as taskQueries from "@/db/queries/tasks";
import * as projectQueries from "@/db/queries/projects";
import * as reminderQueries from "@/db/queries/reminders";
import type { TaskRow, ProjectRow, LabelRow, ReminderRow } from "@/types/db";

interface TaskDetailDrawerProps {
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

// Parse human-friendly duration like "1h 30m", "45m", "2h" into minutes
function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Pure number → treat as minutes
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  let total = 0;
  const hMatch = trimmed.match(/(\d+)\s*h/i);
  const mMatch = trimmed.match(/(\d+)\s*m/i);
  if (hMatch) total += Number(hMatch[1]) * 60;
  if (mMatch) total += Number(mMatch[1]);
  return total > 0 ? total : null;
}

function formatDuration(minutes: number | null | undefined): string {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function TaskDetailDrawer({ taskId, onClose }: TaskDetailDrawerProps) {
  const { updateTask, deleteTask, labels, setTaskLabels, taskLabels, loadTaskLabels } =
    useTaskStore();

  const [task, setTask] = useState<TaskRow | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [title, setTitle] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [subtasks, setSubtasks] = useState<TaskRow[]>([]);
  const [visible, setVisible] = useState(false);
  const [fullPage, setFullPage] = useState(false);
  const [estimateInput, setEstimateInput] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  // Properties section collapsed by default — focus stays on Title + Notes
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  const [subtaskHeight, setSubtaskHeight] = useState(120);

  const backdropRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = subtaskHeight;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = resizeStartY.current - ev.clientY; // drag up → bigger
      setSubtaskHeight(Math.max(80, Math.min(500, resizeStartHeight.current + delta)));
    };
    const onMouseUp = () => {
      isResizingRef.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [subtaskHeight]);

  useEffect(() => {
    taskQueries.getTaskById(taskId).then((t) => {
      if (t) {
        setTask(t);
        setTitle(t.title);
        setEstimateInput(formatDuration(t.estimated_min));
      }
    });
    taskQueries.getSubtasks(taskId).then((subs) => {
      setSubtasks(subs);
      if (subs.length > 0) setSubtasksOpen(true);
    });
    projectQueries.getProjects("active").then(setProjects);
    reminderQueries.getRemindersForTask(taskId).then(setReminders);
    loadTaskLabels(taskId);
  }, [taskId, loadTaskLabels]);

  // Slide-in animation
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleteOpen) handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose, deleteOpen]);

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
      if (field === "estimated_min") setEstimateInput(formatDuration(value as number | null));
      try {
        await updateTask(taskId, { [field]: value });
        // Reconcile with DB
        const updated = await taskQueries.getTaskById(taskId);
        if (updated) {
          setTask(updated);
          if (field === "estimated_min") setEstimateInput(formatDuration(updated.estimated_min));
        }
      } catch {
        // Revert on error - re-fetch
        const current = await taskQueries.getTaskById(taskId);
        if (current) setTask(current);
      }
    },
    [taskId, updateTask],
  );

  const handleEstimateBlur = useCallback(() => {
    const parsed = parseDuration(estimateInput);
    if (parsed !== (task?.estimated_min ?? null)) {
      handleFieldChange("estimated_min", parsed);
    }
  }, [estimateInput, task?.estimated_min, handleFieldChange]);

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

  const handleToggleSubtask = async (subId: string) => {
    const sub = subtasks.find((s) => s.id === subId);
    if (!sub) return;
    // 3-state cycle: todo → in_progress → done → todo
    const newStatus =
      sub.status === "todo"
        ? "in_progress"
        : sub.status === "in_progress"
          ? "done"
          : "todo";
    // Optimistic: update local state immediately
    setSubtasks((prev) =>
      prev.map((s) => (s.id === subId ? { ...s, status: newStatus } : s)),
    );
    try {
      await taskQueries.updateTask(subId, { status: newStatus });
    } catch {
      // Revert on error
      setSubtasks((prev) =>
        prev.map((s) => (s.id === subId ? { ...s, status: sub.status } : s)),
      );
    }
  };

  const handleAddSubtask = async () => {
    const t = newSubtaskTitle.trim();
    if (!t) return;
    const created = await taskQueries.createTask({
      title: t,
      parent_id: taskId,
      project_id: task?.project_id,
      depth: (task?.depth ?? 0) + 1,
    });
    setSubtasks((prev) => [...prev, created]);
    setNewSubtaskTitle("");
  };

  if (!task) return null;

  // Full page: portal into the main content area so the sidebar stays visible.
  // Normal drawer: portal to body so it overlays everything.
  const mainEl = fullPage
    ? (document.getElementById("main-content") ?? document.body)
    : document.body;

  const priorityCfg = PRIORITY_OPTIONS.find((p) => p.value === task.priority);
  const PriorityIcon = priorityCfg?.icon ?? Minus;
  const projectName = projects.find((p) => p.id === task.project_id)?.name;
  const hasMetadata =
    task.status !== "todo" ||
    task.priority !== "none" ||
    task.project_id != null ||
    task.due_date != null ||
    currentLabels.length > 0;

  const drawer = (
    <>
      {/* Backdrop — only shown in normal drawer mode */}
      {!fullPage && (
        <div
          ref={backdropRef}
          className={cn(
            "fixed inset-0 z-50 bg-black/30 transition-opacity duration-200",
            visible ? "opacity-100" : "opacity-0",
          )}
          onClick={handleClose}
        />
      )}

      {/* Drawer panel */}
      <div className={cn(
        "z-50 flex flex-col bg-background shadow-2xl transition-all duration-200 ease-out",
        fullPage
          ? "absolute inset-0"
          : "fixed right-0 top-0 h-screen w-[480px] max-w-[90vw] border-l border-border/50",
        !fullPage && (visible ? "translate-x-0" : "translate-x-full"),
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-xs font-medium text-muted-foreground">Task Detail</span>
          <div className="flex items-center gap-1">
            {/* Expand / Collapse — always visible */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              title={fullPage ? "Collapse" : "Expand"}
              onClick={() => setFullPage((v) => !v)}
            >
              {fullPage ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
            </Button>

            {/* ⋯ three-dot menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => setPropertiesOpen((v) => !v)}>
                  {propertiesOpen ? "Hide Properties" : "Show Properties"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />Delete Task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={handleClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <Separator />

        {/* Scrollable content — Notes + Properties (subtasks lives below, outside scroll) */}
        <div className="sidebar-scroll min-h-0 flex-1 overflow-auto">
          <div className="flex w-full flex-col">

            {/* ── Title ── */}
            <div className="px-14 pt-5">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                className="border-none bg-transparent px-0 text-xl font-semibold shadow-none placeholder:text-muted-foreground/40 focus-visible:ring-0"
                placeholder="Task title"
              />
            </div>

            {/* ── Properties toggle ── */}
            <div className="px-14 pb-2 pt-2">
              <button
                onClick={() => setPropertiesOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              >
                <ChevronRight
                  className={cn("h-3 w-3 transition-transform", propertiesOpen && "rotate-90")}
                />
                Properties
              </button>

              {/* Summary chips when collapsed + has non-default values */}
              {!propertiesOpen && hasMetadata && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {task.status !== "todo" && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {STATUS_OPTIONS.find((s) => s.value === task.status)?.label}
                    </span>
                  )}
                  {task.priority !== "none" && (
                    <span className={cn("flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]", priorityCfg?.color)}>
                      <PriorityIcon className="h-2.5 w-2.5" />{priorityCfg?.label}
                    </span>
                  )}
                  {projectName && (
                    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      <FolderKanban className="h-2.5 w-2.5" />{projectName}
                    </span>
                  )}
                  {task.due_date && (
                    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      <Calendar className="h-2.5 w-2.5" />{task.due_date}
                    </span>
                  )}
                  {currentLabels.map((l) => (
                    <span
                      key={l.id}
                      className="rounded-full px-2 py-0.5 text-[11px] text-white"
                      style={{ backgroundColor: l.color }}
                    >
                      {l.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── Properties panel (expanded) ── */}
            {propertiesOpen && (
              <div className="space-y-2.5 border-y border-border/40 bg-muted/10 px-5 py-3">
                {/* Status */}
                <div className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">Status</span>
                  <Select value={task.status} onValueChange={(v) => handleFieldChange("status", v)}>
                    <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Priority */}
                <div className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">Priority</span>
                  <Select value={task.priority} onValueChange={(v) => handleFieldChange("priority", v)}>
                    <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <SelectItem key={opt.value} value={opt.value}>
                            <div className="flex items-center gap-2">
                              <Icon className={cn("h-3.5 w-3.5", opt.color)} />{opt.label}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Project */}
                <div className="flex items-center gap-3">
                  <span className="flex w-20 shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <FolderKanban className="h-3 w-3" />Project
                  </span>
                  <Select
                    value={task.project_id ?? "__none__"}
                    onValueChange={(v) => handleFieldChange("project_id", v === "__none__" ? null : v)}
                  >
                    <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue placeholder="No project" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No project</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Due date */}
                <div className="flex items-center gap-3">
                  <span className="flex w-20 shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />Due date
                  </span>
                  <DatePicker
                    value={task.due_date ?? null}
                    onChange={(date) => handleFieldChange("due_date", date)}
                    size="sm"
                    className="flex-1"
                  />
                </div>

                {/* Due time */}
                <div className="flex items-center gap-3">
                  <span className="flex w-20 shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />Due time
                  </span>
                  <Input
                    type="time"
                    value={(task as any).due_time ?? ""}
                    onChange={(e) => handleFieldChange("due_time", e.target.value || null)}
                    className="h-7 flex-1 text-xs"
                  />
                </div>

                {/* Estimate */}
                <div className="flex items-center gap-3">
                  <span className="flex w-20 shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />Estimate
                  </span>
                  <Input
                    value={estimateInput}
                    onChange={(e) => setEstimateInput(e.target.value)}
                    onBlur={handleEstimateBlur}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    placeholder="e.g. 1h 30m, 45m"
                    className="h-7 flex-1 text-xs"
                  />
                </div>

                {/* Recurrence */}
                <RecurrencePicker
                  value={(task as any).recurrence_rule ?? null}
                  onChange={(rule) => handleFieldChange("recurrence_rule", rule)}
                />

                {/* Labels */}
                <div>
                  <div className="mb-1.5 flex items-center gap-1">
                    <Tag className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Labels</span>
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
                          style={isAssigned ? { backgroundColor: label.color } : undefined}
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

                {/* Reminders */}
                <ReminderPicker
                  reminders={reminders}
                  onAdd={async (remindAt) => {
                    const r = await reminderQueries.createReminder({ task_id: taskId, remind_at: remindAt });
                    setReminders((prev) => [...prev, r]);
                  }}
                  onDelete={async (id) => {
                    await reminderQueries.deleteReminder(id);
                    setReminders((prev) => prev.filter((r) => r.id !== id));
                  }}
                />
              </div>
            )}

            {/* ── Notes ── */}
            <div className="min-h-[200px] flex-1 pb-5 pt-4">
              <span className="mb-1 block px-14 text-xs font-medium text-muted-foreground">Notes</span>
              {/* Override bn-editor's default pl:56px/pr:32px to match px-5 of other elements */}
              <div className="[&_.bn-editor]:!pl-14 [&_.bn-editor]:!pr-14">
                <BlockNoteEditor
                  key={taskId}
                  initialContent={task.content ?? undefined}
                  onChange={handleContentChange}
                />
              </div>
            </div>

          </div>
        </div>

        {/* ── Subtasks — bottom-anchored, resizable ── */}
        <div
          className="relative flex shrink-0 flex-col border-t border-border/40"
          style={subtasksOpen ? { height: subtaskHeight } : undefined}
        >
          {/* Resize handle — drag up/down to resize */}
          {subtasksOpen && (
            <div
              onMouseDown={handleResizeMouseDown}
              className="absolute inset-x-0 top-0 z-10 flex h-3 cursor-ns-resize items-center justify-center"
            >
              <div className="h-[3px] w-10 rounded-full bg-border/60 transition-colors group-hover:bg-border" />
            </div>
          )}

          {/* Header row */}
          <div className="flex-shrink-0 px-5 pb-1 pt-3">
            <button
              onClick={() => setSubtasksOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              <ChevronRight
                className={cn("h-3 w-3 transition-transform", subtasksOpen && "rotate-90")}
              />
              <CheckSquare2 className="h-3 w-3" />
              Subtasks
              {subtasks.length > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {subtasks.filter((s) => s.status === "done").length}/{subtasks.length}
                </span>
              )}
              {(task.depth ?? 0) < 2 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-5 w-5"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSubtasksOpen(true);
                    setAddingSubtask(true);
                  }}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              )}
            </button>
          </div>

          {/* Scrollable subtask list */}
          {subtasksOpen && (
            <div className="flex-1 overflow-auto px-5 pb-3">
              <div className="space-y-1">
                {subtasks.map((sub) => {
                  return (
                    <div key={sub.id} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/40">
                      <TaskCheckbox
                        status={sub.status as "todo" | "in_progress" | "done" | "cancelled"}
                        onChange={() => handleToggleSubtask(sub.id)}
                      />
                      <span className={cn("text-xs", (sub.status === "done" || sub.status === "cancelled") && "text-muted-foreground line-through")}>
                        {sub.title}
                      </span>
                    </div>
                  );
                })}
                {addingSubtask && (
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      autoFocus
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddSubtask();
                        if (e.key === "Escape") { setAddingSubtask(false); setNewSubtaskTitle(""); }
                      }}
                      placeholder="Subtask title..."
                      className="h-7 flex-1 text-xs"
                    />
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleAddSubtask}>
                      Add
                    </Button>
                  </div>
                )}
                {subtasks.length === 0 && !addingSubtask && (
                  <p className="text-[11px] text-muted-foreground/50">No subtasks yet</p>
                )}
              </div>
            </div>
          )}
        </div>

        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Task</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &quot;{task.title}&quot; and all its subtasks.
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
    </>
  );

  return createPortal(drawer, mainEl);
}
