import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Plus,
  List,
  LayoutGrid,
  Tag,
  X,
  Rows3,
  FolderKanban,
  ArrowUpDown,
  EyeOff,
  Eye,
  PanelLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTasks } from "@/hooks/useTasks";
import { TaskTree } from "@/components/tasks/TaskTree";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { TaskDetailDrawer } from "@/components/tasks/TaskDetailDrawer";
import { TaskFiltersBar } from "@/components/tasks/TaskFilters";
import { TaskSidebar } from "@/components/tasks/TaskSidebar";
import { BulkActionBar } from "@/components/tasks/BulkActionBar";
import * as projectQueries from "@/db/queries/projects";
import type { TaskFilters } from "@/stores/taskStore";
import type { ProjectRow } from "@/types/db";
import type { SmartListType, TaskSortBy } from "@/types/task";

const SMART_LIST_TITLES: Record<SmartListType, string> = {
  inbox: "Inbox",
  starred: "Starred",
  today: "Today",
  tomorrow: "Tomorrow",
  next7days: "Next 7 Days",
  overdue: "Overdue",
};

export const Route = createFileRoute("/tasks/")({
  component: TasksPage,
  validateSearch: (search: Record<string, unknown>) => ({
    selected: typeof search.selected === "string" ? search.selected : undefined,
    list: typeof search.list === "string" ? (search.list as SmartListType) : undefined,
  }),
});

function TasksPage() {
  const { selected, list } = Route.useSearch();
  const navigate = useNavigate();
  const {
    tasks,
    labels,
    loading,
    selectedTaskId,
    filters,
    viewMode,
    sortBy,
    createTask,
    toggleTask,
    toggleStar,
    updateTask,
    deleteTask,
    setSelectedTaskId,
    setFilters,
    setViewMode,
    setSortBy,
    loadTasks,
    createLabel,
    deleteLabel,
    selectedIds,
    clearSelection,
    bulkComplete,
    bulkDelete,
    bulkSetPriority,
    bulkMoveToProject,
  } = useTasks();

  // Sync URL search param → store
  useEffect(() => {
    if (selected && selected !== selectedTaskId) {
      setSelectedTaskId(selected);
    }
  }, [selected]);

  // Handle Smart List param
  useEffect(() => {
    if (list) {
      setFilters({ smart_list: list });
      loadTasks({ smart_list: list });
    } else {
      // Clear smart list filter when navigating to plain /tasks
      if (filters.smart_list) {
        setFilters({});
        loadTasks({});
      }
    }
  }, [list]);

  const handleSelectTask = useCallback(
    (id: string) => {
      setSelectedTaskId(id);
      navigate({ to: "/tasks", search: (prev) => ({ list: prev.list, selected: id }) });
    },
    [setSelectedTaskId, navigate],
  );

  const handleCloseDrawer = useCallback(() => {
    setSelectedTaskId(null);
    navigate({ to: "/tasks", search: (prev) => ({ list: prev.list, selected: undefined }) });
  }, [setSelectedTaskId, navigate]);

  const [newTitle, setNewTitle] = useState("");
  const [taskSidebarOpen, setTaskSidebarOpen] = useState(true);
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#6b7280");
  const [groupBy, setGroupBy] = useState<"none" | "project">("project");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [isDraggingTask, setIsDraggingTask] = useState(false);
  const [dragHoverTargetId, setDragHoverTargetId] = useState<string | null>(null);

  useEffect(() => {
    projectQueries.getProjects("active").then(setProjects);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard navigation and task shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable;
      if (isEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // ── Arrow navigation through top-level tasks ──
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const topLevel = tasks.filter((t) => !t.parent_id);
        if (topLevel.length === 0) return;
        const currentIdx = topLevel.findIndex((t) => t.id === selectedTaskId);
        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(currentIdx + 1, topLevel.length - 1)
            : Math.max(currentIdx - 1, 0);
        const next = currentIdx === -1 ? topLevel[0] : topLevel[nextIdx];
        if (next) handleSelectTask(next.id);
        return;
      }

      // ── Actions on selected task ──
      if (selectedTaskId) {
        if (e.key === "d") {
          e.preventDefault();
          toggleTask(selectedTaskId);
          return;
        }
        if (e.key === "s") {
          e.preventDefault();
          toggleStar(selectedTaskId);
          return;
        }
        if (e.key === "Delete") {
          e.preventDefault();
          deleteTask(selectedTaskId).then(() => {
            handleCloseDrawer();
          });
          return;
        }
      }

      // ── "n" focuses the add-task input; any other printable char also does ──
      if (e.key === "n") { e.preventDefault(); inputRef.current?.focus(); return; }
      if (e.key.length === 1) { inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tasks, selectedTaskId, handleSelectTask, handleCloseDrawer, toggleTask, toggleStar, deleteTask]);

  const handleCreateTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    // Clear input immediately for snappy UX
    setNewTitle("");
    inputRef.current?.focus();
    await createTask({ title });
  };

  const handleFilterChange = useCallback(
    (f: TaskFilters) => {
      setFilters(f);
      loadTasks(f);
    },
    [setFilters, loadTasks],
  );

  const handleSidebarSmartList = useCallback(
    (list: SmartListType | undefined) => {
      const f: TaskFilters = list ? { smart_list: list } : {};
      setFilters(f);
      loadTasks(f);
      navigate({ to: "/tasks", search: { list, selected: undefined } });
    },
    [setFilters, loadTasks, navigate],
  );

  const handleSidebarProject = useCallback(
    (projectId: string | undefined) => {
      const f: TaskFilters = projectId ? { project_id: projectId } : {};
      setFilters(f);
      loadTasks(f);
      navigate({ to: "/tasks", search: { list: undefined, selected: undefined } });
    },
    [setFilters, loadTasks, navigate],
  );

  const handleSidebarLabel = useCallback(
    (labelId: string | undefined) => {
      const f: TaskFilters = labelId ? { label_id: labelId } : {};
      setFilters(f);
      loadTasks(f);
      navigate({ to: "/tasks", search: { list: undefined, selected: undefined } });
    },
    [setFilters, loadTasks, navigate],
  );

  const handleMoveTask = useCallback(
    async (taskId: string, status: string) => {
      await updateTask(taskId, { status });
    },
    [updateTask],
  );

  const handleCreateLabel = async () => {
    if (!newLabelName.trim()) return;
    await createLabel({ name: newLabelName.trim(), color: newLabelColor });
    setNewLabelName("");
    setNewLabelColor("#6b7280");
  };

  const activeCount = tasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled",
  ).length;

  const activeTitle = (() => {
    if (filters.smart_list) return SMART_LIST_TITLES[filters.smart_list];
    if (filters.project_id) return projects.find((p) => p.id === filters.project_id)?.name ?? "Tasks";
    if (filters.label_id) return labels.find((l) => l.id === filters.label_id)?.name ?? "Tasks";
    return "All Tasks";
  })();

  return (
    <div className="flex h-full overflow-hidden">
      {/* Task sidebar */}
      <div className={cn("overflow-hidden transition-[width] duration-200", taskSidebarOpen ? "w-52" : "w-0")}>
        <TaskSidebar
          labels={labels}
          activeFilter={{
            smart_list: filters.smart_list,
            project_id: filters.project_id,
            label_id: filters.label_id,
          }}
          onSelectSmartList={handleSidebarSmartList}
          onSelectProject={handleSidebarProject}
          onSelectLabel={handleSidebarLabel}
          isDraggingTask={isDraggingTask}
          dragHoverProjectId={dragHoverTargetId}
        />
      </div>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <button
                onClick={() => setTaskSidebarOpen((o) => !o)}
                className="mt-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={taskSidebarOpen ? "Hide sidebar" : "Show sidebar"}
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              <div>
                <h1 className="text-2xl font-bold">{activeTitle}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeCount} active task{activeCount !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <Tabs
                value={viewMode}
                onValueChange={(v) => setViewMode(v as "list" | "board")}
              >
                <TabsList className="h-8">
                  <TabsTrigger value="list" className="h-6 px-2">
                    <List className="h-3.5 w-3.5" />
                  </TabsTrigger>
                  <TabsTrigger value="board" className="h-6 px-2">
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {/* New Task */}
              <Button size="sm" onClick={() => inputRef.current?.focus()}>
                <Plus className="mr-1.5 h-4 w-4" />
                New Task
              </Button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="mt-3 flex items-center gap-2">
            {/* Search + Filters */}
            <TaskFiltersBar
              filters={filters}
              labels={labels}
              onFilterChange={handleFilterChange}
            />

            <div className="ml-auto flex items-center gap-1.5">
              {/* Sort */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground hover:text-foreground">
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    {sortBy !== "manual" ? (
                      <span className="text-xs capitalize">{sortBy.replace("_", " ")}</span>
                    ) : (
                      <span className="text-xs">Sort</span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as TaskSortBy)}>
                    <DropdownMenuRadioItem value="manual">Manual</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="due_date">Due Date</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="priority">Priority</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="title">Title (A–Z)</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="created_at">Date Created</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Group by (list only) */}
              {viewMode === "list" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground hover:text-foreground">
                      <Rows3 className="h-3.5 w-3.5" />
                      <span className="text-xs">{groupBy === "project" ? "By Project" : "Ungrouped"}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuRadioGroup value={groupBy} onValueChange={(v) => setGroupBy(v as "none" | "project")}>
                      <DropdownMenuRadioItem value="none">No Grouping</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="project">By Project</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Hide done toggle */}
              <Button
                variant={filters.hide_completed ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => handleFilterChange({ ...filters, hide_completed: !filters.hide_completed })}
                title={filters.hide_completed ? "Show completed" : "Hide completed"}
              >
                {filters.hide_completed ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                <span className="text-xs">{filters.hide_completed ? "Showing all" : "Hide done"}</span>
              </Button>

              {/* Manage labels */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setLabelDialogOpen(true)}
                title="Manage labels"
              >
                <Tag className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <Separator className="my-4" />

          {/* Inline add task input */}
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 transition-colors focus-within:border-primary/40 focus-within:bg-background">
            <Plus className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            <input
              ref={inputRef}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateTask();
              }}
              placeholder="Add a task... press Enter"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
            />
          </div>

          {/* Task list / board */}
          {loading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-4 flex-1" style={{ width: `${60 + (i % 3) * 15}%` }} />
                  <Skeleton className="h-4 w-14 rounded-full" />
                </div>
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No tasks yet</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Type above and press Enter to create your first task
              </p>
            </div>
          ) : viewMode === "list" ? (
            <GroupedTaskList
              tasks={tasks}
              groupBy={groupBy}
              projects={projects}
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              onToggleTask={toggleTask}
              onDeleteTask={deleteTask}
              onMoveToProject={(taskId, projectId) => updateTask(taskId, { project_id: projectId })}
              onDragTaskStart={() => setIsDraggingTask(true)}
              onDragTaskEnd={() => { setIsDraggingTask(false); setDragHoverTargetId(null); }}
              onDragHoverChange={setDragHoverTargetId}
              dragHoverTargetId={dragHoverTargetId}
            />
          ) : (
            <TaskBoard
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              onMoveTask={handleMoveTask}
            />
          )}
        </div>
      </div>

      {/* Detail drawer */}
      {selectedTaskId && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          onClose={handleCloseDrawer}
        />
      )}

      {/* Bulk action bar */}
      <BulkActionBar
        count={selectedIds.size}
        onComplete={bulkComplete}
        onDelete={bulkDelete}
        onSetPriority={bulkSetPriority}
        onMoveToProject={bulkMoveToProject}
        onCancel={clearSelection}
      />

      {/* Label manager dialog */}
      <Dialog open={labelDialogOpen} onOpenChange={setLabelDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Manage Labels</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Existing labels */}
            <div className="space-y-1.5">
              {labels.map((label) => (
                <div
                  key={label.id}
                  className="flex items-center justify-between rounded-md px-2 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="text-sm">{label.name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteLabel(label.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {labels.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No labels created yet
                </p>
              )}
            </div>

            <Separator />

            {/* Add label */}
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newLabelColor}
                onChange={(e) => setNewLabelColor(e.target.value)}
                className="h-7 w-7 cursor-pointer rounded border-none bg-transparent"
              />
              <Input
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateLabel();
                }}
                placeholder="Label name"
                className="h-7 flex-1 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={handleCreateLabel}
                disabled={!newLabelName.trim()}
              >
                Add
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ——— Grouped task list component ———

import type { TaskRow } from "@/types/db";

interface GroupedTaskListProps {
  tasks: TaskRow[];
  groupBy: "none" | "project";
  projects: ProjectRow[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onMoveToProject: (taskId: string, projectId: string | null) => void;
  onDragTaskStart?: (taskId: string) => void;
  onDragTaskEnd?: () => void;
  onDragHoverChange?: (id: string | null) => void;
  dragHoverTargetId?: string | null;
}

function GroupedTaskList({
  tasks,
  groupBy,
  projects,
  selectedTaskId,
  onSelectTask,
  onToggleTask,
  onDeleteTask,
  onMoveToProject,
  onDragTaskStart,
  onDragTaskEnd,
  onDragHoverChange,
  dragHoverTargetId,
}: GroupedTaskListProps) {
  const groups = useMemo(() => {
    if (groupBy === "none") {
      return [{ key: "all", label: null, tasks }];
    }

    const map = new Map<string, TaskRow[]>();
    for (const task of tasks) {
      const key = task.project_id ?? "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(task);
    }

    const sorted: { key: string; label: string | null; tasks: TaskRow[] }[] = [];

    // Projects first, sorted by name
    for (const project of projects) {
      const groupTasks = map.get(project.id);
      if (groupTasks && groupTasks.length > 0) {
        sorted.push({ key: project.id, label: project.name, tasks: groupTasks });
        map.delete(project.id);
      }
    }

    // Remaining tasks not matched to a known project (incl. __none__)
    const noProjectTasks = map.get("__none__");
    if (noProjectTasks && noProjectTasks.length > 0) {
      sorted.push({ key: "__none__", label: "No Project", tasks: noProjectTasks });
    }

    return sorted;
  }, [tasks, groupBy, projects]);

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const isHoverTarget = dragHoverTargetId === group.key;
        return (
          <div
            key={group.key}
            data-droppable-group={group.key}
            className={cn(
              "rounded-lg transition-colors",
              isHoverTarget && "bg-primary/5 ring-1 ring-primary/30",
            )}
          >
            {group.label !== null && (
              <div className={cn(
                "mb-1.5 flex items-center gap-2 px-1",
                isHoverTarget && "text-primary",
              )}>
                <FolderKanban className={cn(
                  "h-3.5 w-3.5",
                  isHoverTarget ? "text-primary" : "text-muted-foreground/60",
                )} />
                <span className={cn(
                  "text-xs font-semibold uppercase tracking-wider",
                  isHoverTarget ? "text-primary" : "text-muted-foreground",
                )}>
                  {group.label}
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground/60">
                  {group.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length} active
                </span>
              </div>
            )}
            <TaskTree
              tasks={group.tasks}
              selectedTaskId={selectedTaskId}
              onSelectTask={onSelectTask}
              onToggleTask={onToggleTask}
              onDeleteTask={onDeleteTask}
              projects={projects}
              onMoveToProject={onMoveToProject}
              onDragTaskStart={onDragTaskStart}
              onDragTaskEnd={onDragTaskEnd}
              onDragHoverChange={onDragHoverChange}
            />
          </div>
        );
      })}
    </div>
  );
}
