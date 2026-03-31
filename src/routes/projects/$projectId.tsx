import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ArrowLeft,
  MoreHorizontal,
  Pencil,
  Archive,
  Trash2,
  Plus,
  FileText,
  ClipboardList,
  Zap,
  Camera,
  StickyNote,
  File,
  Search,
  X,
  List,
  LayoutGrid,
  CalendarDays,
  Calendar,
  Clock,
  Flame,
  ArrowUp,
  AlertTriangle,
  AlertCircle,
  Minus,
  CheckSquare2,
  PanelLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TaskCheckbox } from "@/components/tasks/TaskCheckbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { cn } from "@/lib/utils";
import { formatDate, isPast, isToday } from "@/lib/dateUtils";
import { Link } from "@tanstack/react-router";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { TaskTree } from "@/components/tasks/TaskTree";
import { TaskDetailDrawer } from "@/components/tasks/TaskDetailDrawer";
import { CalendarView } from "@/components/planning/CalendarView";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { PROJECT_ICONS } from "@/components/projects/ProjectCard";
import { ServerList } from "@/components/server/ServerList";
import { CredentialList } from "@/components/credentials/CredentialList";
import { ProjectApiPanel } from "@/components/api/ProjectApiPanel";
import { ProjectDatabasePanel } from "@/components/database/ProjectDatabasePanel";
import * as projectQueries from "@/db/queries/projects";
import * as pageQueries from "@/db/queries/pages";
import * as taskQueries from "@/db/queries/tasks";
import type { ProjectRow, PageRow, TaskRow } from "@/types/db";
import type { CalendarEventData } from "@/db/queries/planning";

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectLayout,
});

const PROJECT_COLOR_CLASSES: Record<string, string> = {
  red: "bg-red-500/15 text-red-600",
  orange: "bg-orange-500/15 text-orange-600",
  yellow: "bg-yellow-500/15 text-yellow-600",
  green: "bg-green-500/15 text-green-600",
  blue: "bg-blue-500/15 text-blue-600",
  purple: "bg-purple-500/15 text-purple-600",
  pink: "bg-pink-500/15 text-pink-600",
  indigo: "bg-indigo-500/15 text-indigo-600",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  archived: "Archived",
};

const CATEGORY_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  brief: ClipboardList,
  feature: Zap,
  screenshot: Camera,
  notes: StickyNote,
  custom: File,
};

const PRIORITY_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  urgent: { icon: Flame, color: "text-red-500" },
  high:   { icon: ArrowUp, color: "text-orange-500" },
  medium: { icon: AlertTriangle, color: "text-yellow-500" },
  low:    { icon: AlertCircle, color: "text-blue-400" },
  none:   { icon: Minus, color: "text-muted-foreground/30" },
};

type ActiveTab = "content" | "tasks" | "servers" | "credentials" | "api" | "database";
type TaskView = "list" | "board" | "calendar";

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Page context menu state
  const [renamingPage, setRenamingPage] = useState<PageRow | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);

  // Persistent header tab state
  const [activeTab, setActiveTab] = useState<ActiveTab>("content");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [taskView, setTaskView] = useState<TaskView>("list");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [calendarDate, setCalendarDate] = useState<string | null>(null);
  const taskInputRef = useRef<HTMLInputElement>(null);

  const loadProject = useCallback(async () => {
    setLoading(true);
    const p = await projectQueries.getProjectById(projectId);
    if (p) {
      setProject(p);
      const [pg, ts] = await Promise.all([
        pageQueries.getPagesByProject(projectId),
        taskQueries.getTasks({ project_id: projectId, parent_id: null }),
      ]);
      setPages(pg);
      setTasks(ts);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  const handleUpdate = async (data: {
    name: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
  }) => {
    const updated = await projectQueries.updateProject(projectId, data);
    if (updated) setProject(updated);
  };

  const handleArchive = async () => {
    await projectQueries.archiveProject(projectId);
    navigate({ to: "/projects" });
  };

  const handleDelete = async () => {
    await projectQueries.deleteProject(projectId);
    navigate({ to: "/projects" });
  };

  const handleRenamePage = async () => {
    if (!renamingPage || !renameTitle.trim()) return;
    const updated = await pageQueries.updatePage(renamingPage.id, { title: renameTitle.trim() });
    if (updated) setPages((prev) => prev.map((p) => (p.id === renamingPage.id ? updated : p)));
    setRenamingPage(null);
  };

  const handleDeletePage = async () => {
    if (!deletingPageId) return;
    await pageQueries.deletePage(deletingPageId);
    setPages((prev) => prev.filter((p) => p.id !== deletingPageId));
    setDeletingPageId(null);
    navigate({ to: "/projects/$projectId", params: { projectId } });
  };

  const handleCreatePage = async () => {
    const page = await pageQueries.createPage({
      project_id: projectId,
      title: "Untitled Page",
      category: "notes",
    });
    setPages((prev) => [...prev, page]);
    setActiveTab("content");
    navigate({
      to: "/projects/$projectId/pages/$pageId",
      params: { projectId, pageId: page.id },
    });
  };

  const handleToggleTask = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const newStatus =
      task.status === "todo"
        ? "in_progress"
        : task.status === "in_progress"
          ? "done"
          : "todo";
    // Optimistic: update local state immediately
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
    );
    try {
      await taskQueries.updateTask(taskId, { status: newStatus });
    } catch {
      // Revert on error
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t)),
      );
    }
  };

  const handleMoveTask = useCallback(async (taskId: string, status: string) => {
    // Optimistic
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status } : t)),
    );
    try {
      await taskQueries.updateTask(taskId, { status });
    } catch {
      // Revert - reload
      const ts = await taskQueries.getTasks({ project_id: projectId, parent_id: null });
      setTasks(ts);
    }
  }, [projectId]);

  const [addingTask, setAddingTask] = useState(false);

  const handleAddTask = async () => {
    const title = newTaskTitle.trim();
    if (!title || addingTask) return;
    setAddingTask(true);
    // Clear input immediately
    setNewTaskTitle("");
    taskInputRef.current?.focus();
    try {
      const created = await taskQueries.createTask({
        title,
        project_id: projectId,
        due_date: taskView === "calendar" && calendarDate ? calendarDate : undefined,
      });
      setTasks((prev) => [...prev, created]);
    } catch (err) {
      console.error(err);
    } finally {
      setAddingTask(false);
    }
  };

  // useMemo MUST be before any early returns (Rules of Hooks)
  const calendarEvents = useMemo<CalendarEventData[]>(
    () =>
      tasks.filter((t) => t.due_date).map((t) => ({
        id: t.id,
        date: t.due_date!,
        title: t.title,
        isDone: t.status === "done" || t.status === "cancelled",
      })),
    [tasks],
  );

  const calendarDateTasks = useMemo(
    () => (calendarDate ? tasks.filter((t) => t.due_date === calendarDate) : []),
    [tasks, calendarDate],
  );

  const filteredPages = useMemo(() => {
    if (!searchQuery.trim()) return pages;
    const q = searchQuery.toLowerCase();
    return pages.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q),
    );
  }, [pages, searchQuery]);

  const [pageSidebarOpen, setPageSidebarOpen] = useState(true);

  // Resizable page sidebar — hooks must be before any early returns
  const PAGE_SIDEBAR_MIN = 224; // w-56
  const PAGE_SIDEBAR_MAX = 480;
  const [pageSidebarWidth, setPageSidebarWidth] = useState(PAGE_SIDEBAR_MIN);
  const pageSidebarDragging = useRef(false);
  const pageSidebarStartX = useRef(0);
  const pageSidebarStartW = useRef(0);

  const onPageSidebarDragStart = useCallback((e: React.PointerEvent) => {
    pageSidebarDragging.current = true;
    pageSidebarStartX.current = e.clientX;
    pageSidebarStartW.current = pageSidebarWidth;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pageSidebarWidth]);

  const onPageSidebarDragMove = useCallback((e: React.PointerEvent) => {
    if (!pageSidebarDragging.current) return;
    const next = Math.min(PAGE_SIDEBAR_MAX, Math.max(PAGE_SIDEBAR_MIN, pageSidebarStartW.current + e.clientX - pageSidebarStartX.current));
    setPageSidebarWidth(next);
  }, []);

  const onPageSidebarDragEnd = useCallback(() => { pageSidebarDragging.current = false; }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading project...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Project not found</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate({ to: "/projects" })}
        >
          Back to Projects
        </Button>
      </div>
    );
  }

  const colorClass =
    PROJECT_COLOR_CLASSES[project.color ?? ""] ?? "bg-muted text-muted-foreground";
  const IconComponent = PROJECT_ICONS[project.icon ?? ""] ?? FileText;
  const activeTasks = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");

  return (
    <div className="flex">
      {/* Page Sidebar */}
      <div
        className="glass-page-sidebar relative sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden transition-[width] duration-200"
        style={{ width: pageSidebarOpen ? pageSidebarWidth : 0 }}
      >
        <div className="p-3">
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 w-full justify-start gap-2 text-xs text-muted-foreground"
            onClick={() => navigate({ to: "/projects" })}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Projects
          </Button>

          <div className="flex items-center gap-2 px-2">
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded",
                colorClass,
              )}
            >
              <IconComponent className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{project.name}</p>
              <Badge variant="outline" className="text-[10px]">
                {STATUS_LABELS[project.status] ?? project.status}
              </Badge>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleArchive}>
                  <Archive className="mr-2 h-3.5 w-3.5" />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Separator />

        {/* Search */}
        <div className="relative px-3 py-2">
          <Search className="absolute left-5 top-3.5 h-3 w-3 text-muted-foreground/50" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pages..."
            className="w-full rounded-md bg-muted/40 py-1 pl-6 pr-6 text-xs outline-none placeholder:text-muted-foreground/40 focus:bg-muted/60"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-5 top-3.5"
            >
              <X className="h-3 w-3 text-muted-foreground/50" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between px-3 pb-1">
          <span className="text-xs font-medium text-muted-foreground">
            Pages
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={handleCreatePage}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

          <div className="sidebar-scroll flex-1">
          <div className="min-w-max space-y-0.5 px-2 pb-2">
            {!searchQuery && (
              <Link
                to="/projects/$projectId"
                params={{ projectId }}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
                activeProps={{ className: "bg-accent font-medium" }}
                activeOptions={{ exact: true }}
                onClick={() => setActiveTab("content")}
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                Overview
              </Link>
            )}
            {filteredPages.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground/50">
                No pages found
              </p>
            ) : (
              filteredPages.map((page) => {
                const CatIcon = CATEGORY_ICONS[page.category ?? ""] ?? File;
                return (
                  <ContextMenu key={page.id}>
                    <ContextMenuTrigger className="block">
                      <Link
                        to="/projects/$projectId/pages/$pageId"
                        params={{ projectId, pageId: page.id }}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
                        activeProps={{ className: "bg-accent font-medium" }}
                        onClick={() => setActiveTab("content")}
                      >
                        <CatIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate">{page.title}</span>
                      </Link>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onClick={() => { setRenamingPage(page); setRenameTitle(page.title); }}
                      >
                        <Pencil /> Rename
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => setDeletingPageId(page.id)}
                      >
                        <Trash2 /> Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })
            )}
          </div>
        </div>
        {/* Resize handle */}
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[#007AFF]/30 active:bg-[#007AFF]/50"
          onPointerDown={onPageSidebarDragStart}
          onPointerMove={onPageSidebarDragMove}
          onPointerUp={onPageSidebarDragEnd}
          onPointerCancel={onPageSidebarDragEnd}
        />
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Persistent header: project title + Content/Tasks tab switcher */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPageSidebarOpen((o) => !o)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={pageSidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <h1 className="text-xl font-bold tracking-tight">{project.name}</h1>
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5">
            <button
              onClick={() => setActiveTab("content")}
              className={cn(
                "h-7 rounded-md px-3 text-xs font-medium transition-all",
                activeTab === "content"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Content
            </button>
            <button
              onClick={() => setActiveTab("tasks")}
              className={cn(
                "flex items-center h-7 rounded-md px-3 text-xs font-medium transition-all",
                activeTab === "tasks"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Tasks
              {activeTasks.length > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-semibold text-primary">
                  {activeTasks.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("servers")}
              className={cn(
                "h-7 rounded-md px-3 text-xs font-medium transition-all",
                activeTab === "servers"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Servers
            </button>
            <button
              onClick={() => setActiveTab("credentials")}
              className={cn(
                "h-7 rounded-md px-3 text-xs font-medium transition-all",
                activeTab === "credentials"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Credentials
            </button>
            <button
              onClick={() => setActiveTab("api")}
              className={cn(
                "h-7 rounded-md px-3 text-xs font-medium transition-all",
                activeTab === "api"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              API
            </button>
            <button
              onClick={() => setActiveTab("database")}
              className={cn(
                "h-7 rounded-md px-3 text-xs font-medium transition-all",
                activeTab === "database"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Database
            </button>
          </div>
        </div>

        {activeTab === "content" && (
          <div className="flex-1 overflow-auto">
            <Outlet />
          </div>
        )}

        {activeTab === "servers" && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <ServerList projectId={projectId} />
          </div>
        )}

        {activeTab === "credentials" && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <CredentialList projectId={projectId} />
          </div>
        )}

        {activeTab === "api" && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <ProjectApiPanel projectId={projectId} />
          </div>
        )}

        {activeTab === "database" && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <ProjectDatabasePanel projectId={projectId} />
          </div>
        )}

        {activeTab === "tasks" && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3 border-b border-border/40 px-6 py-3">
              <div className="flex flex-1 items-center gap-2 rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-1.5 focus-within:border-primary/40 focus-within:bg-background">
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                <input
                  ref={taskInputRef}
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddTask(); }}
                  placeholder={
                    taskView === "calendar" && calendarDate
                      ? `Add task for ${formatDate(calendarDate)}...`
                      : "Add a task... press Enter"
                  }
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
                />
              </div>
              <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-0.5">
                {(["list", "board", "calendar"] as TaskView[]).map((v) => {
                  const Icon = v === "list" ? List : v === "board" ? LayoutGrid : CalendarDays;
                  return (
                    <button
                      key={v}
                      onClick={() => setTaskView(v)}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                        taskView === v
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  );
                })}
              </div>
            </div>

            {taskView === "list" && (
              <div className="flex-1 overflow-auto p-6">
                {tasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <CheckSquare2 className="h-8 w-8 text-muted-foreground/20" />
                    <p className="mt-3 text-sm text-muted-foreground/50">No tasks yet</p>
                  </div>
                ) : (
                  <TaskTree
                    tasks={tasks}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={(id) => setSelectedTaskId(id)}
                    onToggleTask={handleToggleTask}
                  />
                )}
              </div>
            )}

            {taskView === "board" && (
              <div className="flex-1 overflow-auto p-6">
                <TaskBoard
                  tasks={tasks}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={setSelectedTaskId}
                  onMoveTask={handleMoveTask}
                />
              </div>
            )}

            {taskView === "calendar" && (
              <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 overflow-hidden p-6">
                  <CalendarView
                    selectedDate={calendarDate}
                    calendarEvents={calendarEvents}
                    onDateClick={(date) => setCalendarDate(date)}
                  />
                </div>
                {calendarDate && (
                  <div className="flex w-64 shrink-0 flex-col border-l border-border/50">
                    <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold">{formatDate(calendarDate)}</span>
                    </div>
                    <div className="flex-1 overflow-auto p-3">
                      {calendarDateTasks.length === 0 ? (
                        <p className="py-6 text-center text-xs text-muted-foreground/40">
                          No tasks due this day
                        </p>
                      ) : (
                        <div className="space-y-0.5">
                          {calendarDateTasks.map((task) => (
                            <ProjectTaskRow key={task.id} task={task} onToggle={handleToggleTask} compact />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Task detail drawer */}
      {selectedTaskId && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={handleUpdate}
        project={project}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{project.name}&quot; and all its
              pages. This action cannot be undone.
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

      {/* Rename page dialog */}
      <Dialog open={!!renamingPage} onOpenChange={(o) => { if (!o) setRenamingPage(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Page</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRenamePage(); }}
            placeholder="Page title..."
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenamingPage(null)}>Cancel</Button>
            <Button onClick={handleRenamePage}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete page confirm */}
      <AlertDialog open={!!deletingPageId} onOpenChange={(o) => { if (!o) setDeletingPageId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Page</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this page and its content. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePage}
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

function ProjectTaskRow({
  task,
  onToggle,
  compact = false,
}: {
  task: TaskRow;
  onToggle: (id: string) => void;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const isDone = task.status === "done" || task.status === "cancelled";
  const priorityCfg = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.none;
  const PriorityIcon = priorityCfg.icon;
  const overdue = task.due_date && isPast(task.due_date) && !isDone;
  const dueToday = task.due_date && isToday(task.due_date) && !isDone;

  return (
    <div
      className="group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50"
      onClick={() =>
        navigate({ to: "/tasks", search: { selected: task.id } as never })
      }
    >
      <TaskCheckbox
        status={task.status as "todo" | "in_progress" | "done" | "cancelled"}
        onChange={() => onToggle(task.id)}
      />
      <PriorityIcon className={cn("h-3 w-3 shrink-0", priorityCfg.color)} />
      <span
        className={cn(
          "flex-1 truncate text-sm",
          isDone && "text-muted-foreground/40 line-through",
        )}
      >
        {task.title}
      </span>
      {!compact && task.due_date && (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 text-[10px]",
            overdue
              ? "font-medium text-red-500"
              : dueToday
                ? "font-medium text-orange-500"
                : "text-muted-foreground/50",
          )}
        >
          <Clock className="h-2.5 w-2.5" />
          {formatDate(task.due_date)}
        </span>
      )}
      {task.status === "in_progress" && !isDone && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
      )}
    </div>
  );
}
