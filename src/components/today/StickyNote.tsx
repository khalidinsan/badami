import { useEffect, useState, useCallback } from "react";
import {
  Check,
  Pin,
  PinOff,
  Plus,
  Palette,
  X,
  Timer,
  Filter,
  FolderKanban,
  Inbox,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { TaskCheckbox } from "@/components/tasks/TaskCheckbox";
import { StickyTaskActions } from "./StickyTaskActions";
import { StickyTaskExpand } from "./StickyTaskExpand";
import { QuickAddTask } from "./QuickAddTask";
import { PomodoroTimer } from "./PomodoroTimer";
import * as planningQueries from "@/db/queries/planning";
import * as taskQueries from "@/db/queries/tasks";
import * as projectQueries from "@/db/queries/projects";
import { today } from "@/lib/dateUtils";
import type { TaskRow, ProjectRow } from "@/types/db";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "@/stores/settingsStore";
import { usePomodoroStore } from "@/stores/pomodoroStore";

const emitTaskChanged = () => emit("task-changed").catch(() => {});

const STICKY_COLORS: {
  label: string;
  value: string;
  header: string;
  body: string;
  dot: string;
}[] = [
  {
    label: "Default",
    value: "default",
    header: "bg-[#007AFF]",
    body: "bg-card",
    dot: "bg-[#007AFF]",
  },
  {
    label: "Yellow",
    value: "yellow",
    header: "bg-amber-400",
    body: "bg-amber-50 dark:bg-amber-950/40",
    dot: "bg-amber-400",
  },
  {
    label: "Green",
    value: "green",
    header: "bg-emerald-500",
    body: "bg-emerald-50 dark:bg-emerald-950/40",
    dot: "bg-emerald-500",
  },
  {
    label: "Pink",
    value: "pink",
    header: "bg-pink-400",
    body: "bg-pink-50 dark:bg-pink-950/40",
    dot: "bg-pink-400",
  },
  {
    label: "Purple",
    value: "purple",
    header: "bg-violet-500",
    body: "bg-violet-50 dark:bg-violet-950/40",
    dot: "bg-violet-500",
  },
  {
    label: "Slate",
    value: "slate",
    header: "bg-slate-600",
    body: "bg-slate-50 dark:bg-slate-900",
    dot: "bg-slate-600",
  },
];

export function StickyNote() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<TaskRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [pinned, setPinned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showPomodoro, setShowPomodoro] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [focusDonePrompt, setFocusDonePrompt] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filterProjectId, setFilterProjectId] = useState<string>("all");
  const pomodoroStore = usePomodoroStore();
  const { loaded, loadSettings, getSetting, setSetting } = useSettingsStore();
  const stickyColor = getSetting("sticky_note_color", "default");
  const colorConfig =
    STICKY_COLORS.find((c) => c.value === stickyColor) ?? STICKY_COLORS[0];

  useEffect(() => {
    if (!loaded) loadSettings();
  }, [loaded]);

  // Save window position/size on move/resize
  useEffect(() => {
    const win = getCurrentWindow();
    let saveTimeout: ReturnType<typeof setTimeout>;

    const savePosition = async () => {
      try {
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        await setSetting(
          "today_window_geometry",
          JSON.stringify({
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
          }),
        );
      } catch {}
    };

    const debounced = () => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(savePosition, 500);
    };

    const unlMove = win.onMoved(debounced);
    const unlResize = win.onResized(debounced);

    return () => {
      clearTimeout(saveTimeout);
      unlMove.then((fn) => fn());
      unlResize.then((fn) => fn());
    };
  }, [setSetting]);

  const loadTodayTasks = useCallback(async () => {
    setLoading(true);
    const result = await planningQueries.getTasksForDateWithOverdue(today());
    setOverdueTasks(result.overdue);
    setTasks(result.today);
    setLoading(false);
  }, []);

  // Silent refresh: merge new data without loading flash or scroll reset
  const silentRefresh = useCallback(async () => {
    try {
      const result = await planningQueries.getTasksForDateWithOverdue(today());
      setOverdueTasks(result.overdue);
      setTasks(result.today);
    } catch {
      // Silently ignore — stale data is fine until next refresh
    }
  }, []);

  useEffect(() => {
    loadTodayTasks();
    projectQueries.getProjects("active").then(setProjects);
  }, [loadTodayTasks]);

  // Listen for cross-window task changes
  useEffect(() => {
    const unlisten = listen("task-changed", () => {
      silentRefresh();
      projectQueries.getProjects("active").then(setProjects);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [silentRefresh]);

  const updateTaskInLists = useCallback((taskId: string, updater: (t: TaskRow) => TaskRow) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updater(t) : t)));
    setOverdueTasks((prev) => prev.map((t) => (t.id === taskId ? updater(t) : t)));
  }, []);

  const handleToggle = async (taskId: string) => {
    // Optimistic: 3-state toggle
    const allTasks = [...tasks, ...overdueTasks];
    const task = allTasks.find((t) => t.id === taskId);
    if (!task) return;
    const newStatus =
      task.status === "todo" ? "in_progress" : task.status === "in_progress" ? "done" : "todo";
    updateTaskInLists(taskId, (t) => ({ ...t, status: newStatus }));
    try {
      await planningQueries.toggleTaskStatus(taskId);
      emitTaskChanged();
    } catch {
      updateTaskInLists(taskId, () => task);
    }
  };

  const handlePriorityChange = async (taskId: string, priority: string) => {
    updateTaskInLists(taskId, (t) => ({ ...t, priority }));
    try {
      await taskQueries.updateTask(taskId, { priority });
      emitTaskChanged();
    } catch {
      loadTodayTasks();
    }
  };

  const handleProjectChange = async (taskId: string, projectId: string | null) => {
    updateTaskInLists(taskId, (t) => ({ ...t, project_id: projectId }));
    try {
      await taskQueries.updateTask(taskId, { project_id: projectId });
      emitTaskChanged();
    } catch {
      loadTodayTasks();
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    // Optimistic: remove immediately
    const prevTasks = tasks;
    const prevOverdue = overdueTasks;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setOverdueTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (expandedTaskId === taskId) setExpandedTaskId(null);
    try {
      await taskQueries.deleteTask(taskId);
      emitTaskChanged();
    } catch {
      setTasks(prevTasks);
      setOverdueTasks(prevOverdue);
    }
  };

  const handleTaskUpdate = async (taskId: string, data: Partial<TaskRow>) => {
    // Optimistic
    updateTaskInLists(taskId, (t) => ({ ...t, ...data }));
    try {
      await taskQueries.updateTask(taskId, data);
      emitTaskChanged();
    } catch {
      loadTodayTasks();
    }
  };

  const handleExpandToggle = (taskId: string) => {
    setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  };

  const handleFocusToggle = async (taskId: string) => {
    if (focusedTaskId === taskId) {
      // Unfocus
      setFocusedTaskId(null);
      setFocusDonePrompt(false);
    } else {
      setFocusedTaskId(taskId);
      setFocusDonePrompt(false);
      // Auto-start pomodoro if idle
      if (pomodoroStore.status === "idle") {
        await pomodoroStore.start(taskId);
      }
    }
  };

  const handlePin = async () => {
    const win = getCurrentWindow();
    const next = !pinned;
    await win.setAlwaysOnTop(next);
    setPinned(next);
  };

  const handleClose = () => getCurrentWindow().close();

  const handleOpenTask = async (taskId: string) => {
    // Focus main window and navigate to tasks page with the task selected
    try {
      const main = await WebviewWindow.getByLabel("main");
      if (main) {
        await main.show();
        await main.setFocus();
        // Navigate by emitting a URL change
        await main.emit("navigate", `/tasks?selected=${taskId}`);
      }
    } catch {}
  };

  // Listen for pomodoro completion when focusing a task
  useEffect(() => {
    if (!focusedTaskId) return;
    if (pomodoroStore.status === "idle" && pomodoroStore.linkedTaskId === focusedTaskId) {
      // Pomodoro just ended for the focused task
      setFocusDonePrompt(true);
    }
  }, [pomodoroStore.status, pomodoroStore.linkedTaskId, focusedTaskId]);

  const handleFocusDone = async () => {
    if (focusedTaskId) {
      // Optimistic: mark as done
      updateTaskInLists(focusedTaskId, (t) => ({ ...t, status: "done" }));
      planningQueries.toggleTaskStatus(focusedTaskId)
        .then(() => emitTaskChanged())
        .catch(() => loadTodayTasks());
    }
    setFocusDonePrompt(false);
    setFocusedTaskId(null);
  };

  const handleFocusContinue = async () => {
    setFocusDonePrompt(false);
    if (focusedTaskId) {
      await pomodoroStore.start(focusedTaskId);
    }
  };

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      const filterFn = (t: TaskRow) =>
        filterProjectId === "all" ||
        (filterProjectId === "inbox" ? !t.project_id : t.project_id === filterProjectId);

      const all = [...overdueTasks.filter(filterFn), ...tasks.filter(filterFn)];

      if (e.key === "n" && !isInput) {
        e.preventDefault();
        setShowQuickAdd(true);
        return;
      }

      if (e.key === "Escape") {
        if (expandedTaskId) {
          setExpandedTaskId(null);
        } else if (selectedTaskId) {
          setSelectedTaskId(null);
        }
        return;
      }

      if (isInput) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (all.length === 0) return;
        const currentIdx = selectedTaskId
          ? all.findIndex((t) => t.id === selectedTaskId)
          : -1;
        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(currentIdx + 1, all.length - 1)
            : Math.max(currentIdx - 1, 0);
        setSelectedTaskId(all[nextIdx].id);
        return;
      }

      if (!selectedTaskId) return;

      if (e.key === " ") {
        e.preventDefault();
        handleToggle(selectedTaskId);
        return;
      }
      if (e.key === "e") {
        e.preventDefault();
        handleExpandToggle(selectedTaskId);
        return;
      }
      if (e.key === "f") {
        e.preventDefault();
        handleFocusToggle(selectedTaskId);
        return;
      }
      if (e.key === "p") {
        e.preventDefault();
        // Priority popover is handled inside StickyTaskActions — we can't easily
        // trigger it from keyboard. Instead we just expand the task so user can see detail.
        handleExpandToggle(selectedTaskId);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handleDeleteTask(selectedTaskId);
        // Move selection to next task
        const currentIdx = all.findIndex((t) => t.id === selectedTaskId);
        const next = all[currentIdx + 1] ?? all[currentIdx - 1];
        setSelectedTaskId(next?.id ?? null);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    overdueTasks,
    tasks,
    selectedTaskId,
    expandedTaskId,
    showQuickAdd,
    filterProjectId,
  ]);

  const filterTask = (t: TaskRow) =>
    filterProjectId === "all" ||
    (filterProjectId === "inbox" ? !t.project_id : t.project_id === filterProjectId);

  const filteredOverdue = overdueTasks.filter(filterTask);
  const filteredToday = tasks.filter(filterTask);
  const allTasks = [...filteredOverdue, ...filteredToday];
  const completedCount = allTasks.filter(
    (t) => t.status === "done" || t.status === "cancelled",
  ).length;
  const totalCount = allTasks.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Counts per project for filter dropdown
  const allUnfiltered = [...overdueTasks, ...tasks];
  const projectCounts = new Map<string, number>();
  let inboxCount = 0;
  for (const t of allUnfiltered) {
    if (t.project_id) {
      projectCounts.set(t.project_id, (projectCounts.get(t.project_id) ?? 0) + 1);
    } else {
      inboxCount++;
    }
  }

  return (
    <div
      className={cn(
        "flex h-screen flex-col overflow-hidden",
        colorConfig.body,
      )}
    >
      {/* ── Custom title bar + progress bar integrated ── */}
      {/* data-tauri-drag-region enables dragging; data-tauri-no-drag on buttons prevents interference */}
      <div
        className={cn(
          "relative shrink-0 select-none",
          colorConfig.header,
        )}
        data-tauri-drag-region
      >
        <div className="flex items-center justify-between px-3 py-2" data-tauri-drag-region>
          {/* Left: title + counter — draggable */}
          <span className="text-[11px] font-semibold text-white/90" data-tauri-drag-region>
            Today
            {totalCount > 0 && (
              <span className="ml-1.5 font-normal text-white/60">
                {completedCount}/{totalCount}
              </span>
            )}
          </span>

          {/* Focus badge */}
          {focusedTaskId && (
            <span className="ml-2 max-w-[100px] truncate rounded-full bg-white/20 px-2 py-0.5 text-[9px] font-medium text-white/90" data-tauri-drag-region>
              Focusing
            </span>
          )}

          {/* Right: Palette, Pin, Close — NOT draggable */}
          <div className="flex items-center gap-0.5" data-tauri-no-drag>
          {/* Color picker */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-5 w-5 items-center justify-center rounded text-white/60 transition-colors hover:bg-white/15 hover:text-white"
                title="Change color"
              >
                <Palette className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[110px]">
              {STICKY_COLORS.map((c) => (
                <DropdownMenuItem
                  key={c.value}
                  onClick={() => setSetting("sticky_note_color", c.value)}
                  className="gap-2 text-xs"
                >
                  <div className={cn("h-3 w-3 rounded-full", c.dot)} />
                  {c.label}
                  {stickyColor === c.value && (
                    <Check className="ml-auto h-3 w-3" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Filter by project */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded transition-colors",
                  filterProjectId !== "all"
                    ? "bg-white/25 text-white"
                    : "text-white/60 hover:bg-white/15 hover:text-white",
                )}
                title="Filter by project"
              >
                <Filter className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              <DropdownMenuItem
                onClick={() => setFilterProjectId("all")}
                className="gap-2 text-xs"
              >
                All Tasks
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {allUnfiltered.length}
                </span>
                {filterProjectId === "all" && (
                  <Check className="ml-1 h-3 w-3" />
                )}
              </DropdownMenuItem>
              {inboxCount > 0 && (
                <DropdownMenuItem
                  onClick={() => setFilterProjectId("inbox")}
                  className="gap-2 text-xs"
                >
                  <Inbox className="h-3 w-3 text-muted-foreground/50" />
                  Inbox
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {inboxCount}
                  </span>
                  {filterProjectId === "inbox" && (
                    <Check className="ml-1 h-3 w-3" />
                  )}
                </DropdownMenuItem>
              )}
              {projects
                .filter((p) => projectCounts.has(p.id))
                .map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => setFilterProjectId(p.id)}
                    className="gap-2 text-xs"
                  >
                    <FolderKanban className="h-3 w-3 text-muted-foreground/50" />
                    <span className="max-w-[100px] truncate">{p.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {projectCounts.get(p.id)}
                    </span>
                    {filterProjectId === p.id && (
                      <Check className="ml-1 h-3 w-3" />
                    )}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Pin toggle */}
          <button
            onClick={handlePin}
            className="flex h-5 w-5 items-center justify-center rounded text-white/60 transition-colors hover:bg-white/15 hover:text-white"
            title={pinned ? "Unpin from top" : "Pin on top"}
          >
            {pinned ? (
              <Pin className="h-3 w-3" />
            ) : (
              <PinOff className="h-3 w-3" />
            )}
          </button>

          {/* Close */}
          <button
            onClick={handleClose}
            className="flex h-5 w-5 items-center justify-center rounded text-white/60 transition-colors hover:bg-white/15 hover:text-white"
            title="Close"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        </div>

        {/* Progress bar — white strip at bottom of header */}
        <div className="h-0.5 w-full bg-black/10">
          <div
            className="h-full bg-white/60 transition-all duration-500"
            style={{ width: totalCount > 0 ? `${progress}%` : "0%" }}
          />
        </div>
      </div>

      {/* ── Task list ── */}
      <ScrollArea className="flex-1">
        <div className="space-y-0 px-2 py-1.5">
          {loading ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Loading...
            </p>
          ) : allTasks.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground/60">
              No tasks for today
            </p>
          ) : (
            <>
              {/* Overdue section */}
              {filteredOverdue.length > 0 && (
                <div className="mb-1">
                  <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-500">
                    Overdue
                  </p>
                  <AnimatePresence initial={false}>
                    {filteredOverdue.map((task) => (
                      <StickyTaskRow
                        key={task.id}
                        task={task}
                        projects={projects}
                        expanded={expandedTaskId === task.id}
                        focused={focusedTaskId === task.id}
                        dimmed={!!focusedTaskId && focusedTaskId !== task.id}
                        selected={selectedTaskId === task.id}
                        onToggle={handleToggle}
                        onExpandToggle={handleExpandToggle}
                        onOpenTask={handleOpenTask}
                        onTaskUpdate={handleTaskUpdate}
                        onPriorityChange={handlePriorityChange}
                        onProjectChange={handleProjectChange}
                        onDelete={handleDeleteTask}
                        onFocus={handleFocusToggle}
                        isOverdue
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {/* Today section */}
              {filteredToday.length > 0 && (
                <div>
                  {filteredOverdue.length > 0 && (
                    <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Today
                    </p>
                  )}
                  <AnimatePresence initial={false}>
                    {filteredToday.map((task) => (
                      <StickyTaskRow
                        key={task.id}
                        task={task}
                        projects={projects}
                        expanded={expandedTaskId === task.id}
                        focused={focusedTaskId === task.id}
                        dimmed={!!focusedTaskId && focusedTaskId !== task.id}
                        selected={selectedTaskId === task.id}
                        onToggle={handleToggle}
                        onExpandToggle={handleExpandToggle}
                        onOpenTask={handleOpenTask}
                        onTaskUpdate={handleTaskUpdate}
                        onPriorityChange={handlePriorityChange}
                        onProjectChange={handleProjectChange}
                        onDelete={handleDeleteTask}
                        onFocus={handleFocusToggle}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      {/* ── Quick add ── */}
      <div className="shrink-0 border-t border-black/10 px-2.5 py-1.5">
        <AnimatePresence initial={false}>
          {showQuickAdd ? (
            <motion.div
              key="quickadd"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.12 }}
            >
              <QuickAddTask
                onAdded={() => {
                  loadTodayTasks();
                  setShowQuickAdd(false);
                }}
                onCancel={() => setShowQuickAdd(false)}
                autoFocus
              />
            </motion.div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                key="addBtn"
                onClick={() => setShowQuickAdd(true)}
                className="flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-black/5 hover:text-muted-foreground dark:hover:bg-white/5"
              >
                <Plus className="h-3 w-3" />
                Add note
              </button>
              <button
                onClick={() => setShowPomodoro((v) => !v)}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded transition-colors",
                  showPomodoro
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground/40 hover:text-muted-foreground/70",
                )}
                title="Pomodoro Timer"
              >
                <Timer className="h-3 w-3" />
              </button>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Focus Done Prompt ── */}
      <AnimatePresence initial={false}>
        {focusDonePrompt && (
          <motion.div
            key="focus-done"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="shrink-0 overflow-hidden border-t border-black/10"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1 text-[11px] text-muted-foreground">
                Focus session done!
              </span>
              <button
                onClick={handleFocusDone}
                className="rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/25"
              >
                Mark Done
              </button>
              <button
                onClick={handleFocusContinue}
                className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/80"
              >
                Keep Going
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Pomodoro (toggled) ── */}
      <AnimatePresence initial={false}>
        {showPomodoro && (
          <motion.div
            key="pomodoro"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="shrink-0 overflow-hidden border-t border-black/10"
          >
            <PomodoroTimer compact={false} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Extracted task row for reuse in overdue/today sections ─────────

function StickyTaskRow({
  task,
  projects,
  expanded,
  focused,
  dimmed,
  selected,
  onToggle,
  onExpandToggle,
  onOpenTask,
  onTaskUpdate,
  onPriorityChange,
  onProjectChange,
  onDelete,
  onFocus,
  isOverdue = false,
}: {
  task: TaskRow;
  projects: ProjectRow[];
  expanded: boolean;
  focused: boolean;
  dimmed: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onExpandToggle: (id: string) => void;
  onOpenTask: (id: string) => void;
  onTaskUpdate: (id: string, data: Partial<TaskRow>) => void;
  onPriorityChange: (id: string, priority: string) => void;
  onProjectChange: (id: string, projectId: string | null) => void;
  onDelete: (id: string) => void;
  onFocus: (id: string) => void;
  isOverdue?: boolean;
}) {
  const title = task.title || "Untitled";
  const isDone = task.status === "done" || task.status === "cancelled";

  return (
    <motion.div
      key={task.id}
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 6 }}
      transition={{ duration: 0.12 }}
      className={cn(
        "group rounded-md transition-all",
        focused
          ? "bg-primary/5 ring-1 ring-primary/20 dark:bg-primary/10"
          : "hover:bg-black/5 dark:hover:bg-white/5",
        dimmed && "opacity-40",
        selected && !focused && "ring-1 ring-primary/30",
      )}
    >
      <div className="flex w-full items-start gap-2 px-2 py-1.5">
        <div className="mt-0.5 shrink-0">
          <TaskCheckbox
            status={task.status as "todo" | "in_progress" | "done" | "cancelled"}
            onChange={() => onToggle(task.id)}
          />
        </div>

        <div
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5"
          onClick={() => onExpandToggle(task.id)}
        >
          <span
            className={cn(
              "flex-1 text-left text-xs leading-snug",
              isDone && "opacity-40 line-through",
              isOverdue && !isDone && "text-red-600 dark:text-red-400",
            )}
          >
            {title}
          </span>
        </div>

        <StickyTaskActions
          task={task}
          projects={projects}
          focused={focused}
          onPriorityChange={onPriorityChange}
          onProjectChange={onProjectChange}
          onDelete={onDelete}
          onFocus={onFocus}
        />
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <StickyTaskExpand
            task={task}
            onUpdate={onTaskUpdate}
            onOpenInMain={onOpenTask}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
