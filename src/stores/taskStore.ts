import { create } from "zustand";
import { toast } from "sonner";
import type { TaskRow, LabelRow } from "@/types/db";
import type { SmartListType, SmartListCounts, TaskSortBy } from "@/types/task";
import * as taskQueries from "@/db/queries/tasks";
import * as labelQueries from "@/db/queries/labels";
import { getNextDueDate } from "@/lib/recurrence";
import { now as nowISO } from "@/lib/dateUtils";
import { v4 as uuidv4 } from "uuid";
import { emit } from "@tauri-apps/api/event";

const emitTaskChanged = () => emit("task-changed").catch(() => {});

export type ViewMode = "list" | "board";

export interface TaskFilters {
  status?: string;
  priority?: string;
  project_id?: string;
  label_id?: string;
  search?: string;
  smart_list?: SmartListType;
  hide_completed?: boolean;
  date_from?: string;
  date_to?: string;
}

interface TaskState {
  tasks: TaskRow[];
  labels: LabelRow[];
  taskLabels: Map<string, LabelRow[]>;
  subtaskProgress: Map<string, { done: number; total: number }>;
  loading: boolean;
  selectedTaskId: string | null;
  selectedIds: Set<string>;
  filters: TaskFilters;
  viewMode: ViewMode;
  sortBy: TaskSortBy;
  smartListCounts: SmartListCounts;
  activeSmartList: SmartListType | null;

  loadTasks: (filters?: TaskFilters) => Promise<void>;
  silentLoadTasks: () => Promise<void>;
  loadLabels: () => Promise<void>;
  loadTaskLabels: (taskId: string) => Promise<void>;
  loadTaskLabelsBatch: (taskIds: string[]) => Promise<void>;
  loadSubtaskProgress: (parentIds: string[]) => Promise<void>;
  loadSmartListCounts: () => Promise<void>;
  setActiveSmartList: (list: SmartListType | null) => void;
  setSortBy: (sortBy: TaskSortBy) => void;
  createTask: (data: {
    title: string;
    parent_id?: string | null;
    project_id?: string | null;
    priority?: string;
    due_date?: string | null;
    due_time?: string | null;
    estimated_min?: number | null;
    depth?: number;
    recurrence_rule?: string | null;
  }) => Promise<TaskRow>;
  updateTask: (
    id: string,
    data: {
      title?: string;
      content?: string | null;
      status?: string;
      priority?: string;
      due_date?: string | null;
      due_time?: string | null;
      estimated_min?: number | null;
      project_id?: string | null;
      sort_order?: number;
      is_starred?: number;
      recurrence_rule?: string | null;
    },
  ) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  toggleStar: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  reorderTasks: (updates: Array<{ id: string; sort_order: number }>) => Promise<void>;
  setSelectedTaskId: (id: string | null) => void;
  setFilters: (filters: TaskFilters) => void;
  setViewMode: (mode: ViewMode) => void;

  // Bulk operations
  toggleSelectId: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  bulkComplete: () => Promise<void>;
  bulkDelete: () => Promise<void>;
  bulkSetPriority: (priority: string) => Promise<void>;
  bulkMoveToProject: (projectId: string | null) => Promise<void>;

  createLabel: (data: { name: string; color?: string }) => Promise<LabelRow>;
  updateLabel: (id: string, data: { name?: string; color?: string }) => Promise<void>;
  deleteLabel: (id: string) => Promise<void>;
  setTaskLabels: (taskId: string, labelIds: string[]) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  labels: [],
  taskLabels: new Map(),
  subtaskProgress: new Map(),
  loading: false,
  selectedTaskId: null,
  selectedIds: new Set(),
  filters: {},
  viewMode: "list",
  sortBy: "manual",
  smartListCounts: { inbox: 0, starred: 0, today: 0, tomorrow: 0, next7days: 0, overdue: 0 },
  activeSmartList: null,

  loadTasks: async (filters?: TaskFilters) => {
    set({ loading: true });
    try {
      if (filters) set({ filters });
      const f = filters ?? get().filters;
      const sortBy = get().sortBy;
      const tasks = await taskQueries.getRootTasks({
        status: f.status,
        priority: f.priority,
        project_id: f.project_id,
        label_id: f.label_id,
        search: f.search,
        smart_list: f.smart_list,
        hide_completed: f.hide_completed,
        date_from: f.date_from,
        date_to: f.date_to,
        sort_by: sortBy,
      });
      set({ tasks, loading: false });
    } catch (err) {
      console.error(err);
      toast.error("Failed to load tasks");
      set({ loading: false });
    }
  },

  silentLoadTasks: async () => {
    try {
      const f = get().filters;
      const sortBy = get().sortBy;
      const tasks = await taskQueries.getRootTasks({
        status: f.status,
        priority: f.priority,
        project_id: f.project_id,
        label_id: f.label_id,
        search: f.search,
        smart_list: f.smart_list,
        hide_completed: f.hide_completed,
        date_from: f.date_from,
        date_to: f.date_to,
        sort_by: sortBy,
      });
      set({ tasks });
    } catch {
      // Silently ignore — stale data is acceptable until next interaction
    }
  },

  loadLabels: async () => {
    const labels = await labelQueries.getLabels();
    set({ labels });
  },

  loadTaskLabels: async (taskId: string) => {
    const labels = await labelQueries.getLabelsForTask(taskId);
    set((state) => {
      const newMap = new Map(state.taskLabels);
      newMap.set(taskId, labels);
      return { taskLabels: newMap };
    });
  },

  loadTaskLabelsBatch: async (taskIds: string[]) => {
    const batchMap = await labelQueries.getLabelsForTasks(taskIds);
    set((state) => {
      const newMap = new Map(state.taskLabels);
      for (const [taskId, labels] of batchMap) {
        newMap.set(taskId, labels);
      }
      return { taskLabels: newMap };
    });
  },

  loadSubtaskProgress: async (parentIds: string[]) => {
    if (parentIds.length === 0) return;
    const progressMap = await taskQueries.getSubtaskProgressBatch(parentIds);
    set((state) => {
      const newMap = new Map(state.subtaskProgress);
      for (const [id, progress] of progressMap) {
        newMap.set(id, progress);
      }
      return { subtaskProgress: newMap };
    });
  },

  loadSmartListCounts: async () => {
    try {
      const counts = await taskQueries.getSmartListCounts();
      set({ smartListCounts: counts });
    } catch (err) {
      console.error("Failed to load smart list counts:", err);
    }
  },

  setActiveSmartList: (list) => {
    set({ activeSmartList: list });
  },

  setSortBy: (sortBy) => {
    set({ sortBy });
    get().loadTasks();
  },

  createTask: async (data) => {
    // Optimistic: build a local task and add to state immediately
    const optimisticId = uuidv4();
    const timestamp = nowISO();
    const maxOrder = get().tasks.reduce((max, t) => Math.max(max, t.sort_order), -1) + 1;
    const optimisticTask: TaskRow = {
      id: optimisticId,
      parent_id: data.parent_id ?? null,
      project_id: data.project_id ?? null,
      title: data.title,
      content: null,
      status: "todo",
      priority: data.priority ?? "none",
      due_date: data.due_date ?? null,
      due_time: data.due_time ?? null,
      estimated_min: data.estimated_min ?? null,
      sort_order: maxOrder,
      depth: data.depth ?? 0,
      is_starred: 0,
      recurrence_rule: data.recurrence_rule ?? null,
      recurrence_parent_id: null,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null,
    };

    if (!data.parent_id) {
      set((state) => ({ tasks: [...state.tasks, optimisticTask] }));
    }

    try {
      const task = await taskQueries.createTask(data);
      // Reconcile: replace optimistic task with real DB task
      if (!data.parent_id) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === optimisticId ? task : t)),
        }));
      }
      emitTaskChanged();
      return task;
    } catch (err) {
      // Revert optimistic add
      if (!data.parent_id) {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== optimisticId),
        }));
      }
      console.error(err);
      toast.error("Failed to create task");
      throw err;
    }
  },

  updateTask: async (id, data) => {
    // Optimistic: apply changes to local state immediately
    const prevTask = get().tasks.find((t) => t.id === id);
    if (prevTask) {
      const optimistic = { ...prevTask, ...data, updated_at: nowISO() };
      if (data.status === "done" || data.status === "cancelled") {
        optimistic.completed_at = nowISO();
      } else if (data.status === "todo" || data.status === "in_progress") {
        optimistic.completed_at = null;
      }
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? optimistic : t)),
      }));
    }

    try {
      const updated = await taskQueries.updateTask(id, data);
      // Reconcile with actual DB response
      if (updated) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
        }));
      }
      emitTaskChanged();
    } catch (err) {
      // Revert to previous state
      if (prevTask) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? prevTask : t)),
        }));
      }
      console.error(err);
      toast.error("Failed to update task");
    }
  },

  toggleTask: async (id) => {
    // Task may be a subtask not in root state.tasks — fetch from DB if needed
    const task = get().tasks.find((t) => t.id === id) ?? await taskQueries.getTaskById(id);
    if (!task) return;

    // 3-state cycle: todo → in_progress → done → todo
    const nextStatus =
      task.status === "todo"
        ? "in_progress"
        : task.status === "in_progress"
          ? "done"
          : "todo";

    // Optimistic: update UI immediately
    const timestamp = nowISO();
    const optimistic: TaskRow = {
      ...task,
      status: nextStatus,
      updated_at: timestamp,
      completed_at: nextStatus === "done" ? timestamp : nextStatus === "todo" ? null : task.completed_at,
    };
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? optimistic : t)),
    }));

    try {
      let updated: typeof task | undefined;
      if (nextStatus === "done") {
        updated = await taskQueries.completeTaskCascade(id);
      } else if (nextStatus === "in_progress") {
        updated = await taskQueries.updateTask(id, { status: "in_progress" });
      } else {
        updated = await taskQueries.uncompleteTask(id);
      }

      // Reconcile with actual DB state
      if (updated) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
        }));
      }

      // Recurring: create next instance when completing
      const completing = nextStatus === "done";
      if (completing && task.recurrence_rule && task.due_date) {
        const nextDate = getNextDueDate(task.recurrence_rule, task.due_date);
        if (nextDate) {
          const nextTask = await taskQueries.createTask({
            title: task.title,
            parent_id: task.parent_id,
            project_id: task.project_id,
            content: task.content,
            priority: task.priority,
            due_date: nextDate,
            due_time: task.due_time,
            estimated_min: task.estimated_min,
            depth: task.depth,
            recurrence_rule: task.recurrence_rule,
            recurrence_parent_id: task.recurrence_parent_id ?? task.id,
          });
          if (!nextTask.parent_id) {
            set((state) => ({ tasks: [...state.tasks, nextTask] }));
          }
        }
      }

      // Refresh smart list counts in background
      get().loadSmartListCounts();
      emitTaskChanged();
    } catch (err) {
      // Revert to original state on error
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? task : t)),
      }));
      console.error(err);
      toast.error("Failed to update task");
    }
  },

  toggleStar: async (id) => {
    const task = get().tasks.find((t) => t.id === id) ?? await taskQueries.getTaskById(id);
    if (!task) return;

    // Optimistic: toggle star immediately
    const newStarred = task.is_starred ? 0 : 1;
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, is_starred: newStarred, updated_at: nowISO() } : t,
      ),
    }));

    try {
      const updated = task.is_starred
        ? await taskQueries.unstarTask(id)
        : await taskQueries.starTask(id);
      if (updated) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
        }));
      }
      get().loadSmartListCounts();
    } catch (err) {
      // Revert on error
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === id ? { ...t, is_starred: task.is_starred, updated_at: task.updated_at } : t,
        ),
      }));
      console.error(err);
      toast.error("Failed to update star");
    }
  },

  deleteTask: async (id) => {
    // Optimistic: remove from UI immediately
    const prevTasks = get().tasks;
    const prevSelected = get().selectedTaskId;
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
      selectedTaskId: state.selectedTaskId === id ? null : state.selectedTaskId,
    }));

    try {
      await taskQueries.deleteTask(id);
      get().loadSmartListCounts();
      emitTaskChanged();
    } catch (err) {
      // Revert on error
      set({ tasks: prevTasks, selectedTaskId: prevSelected });
      console.error(err);
      toast.error("Failed to delete task");
    }
  },

  reorderTasks: async (updates) => {
    try {
      await taskQueries.reorderTasks(updates);
      // Apply new sort_order locally
      set((state) => {
        const orderMap = new Map(updates.map((u) => [u.id, u.sort_order]));
        const newTasks = state.tasks.map((t) =>
          orderMap.has(t.id) ? { ...t, sort_order: orderMap.get(t.id)! } : t,
        );
        newTasks.sort((a, b) => a.sort_order - b.sort_order);
        return { tasks: newTasks };
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to reorder tasks");
    }
  },

  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  setFilters: (filters) => set({ filters }),
  setViewMode: (mode) => set({ viewMode: mode }),

  createLabel: async (data) => {
    const label = await labelQueries.createLabel(data);
    set((state) => ({ labels: [...state.labels, label] }));
    return label;
  },

  updateLabel: async (id, data) => {
    const updated = await labelQueries.updateLabel(id, data);
    if (updated) {
      set((state) => ({
        labels: state.labels.map((l) => (l.id === id ? updated : l)),
      }));
    }
  },

  deleteLabel: async (id) => {
    await labelQueries.deleteLabel(id);
    set((state) => ({
      labels: state.labels.filter((l) => l.id !== id),
    }));
  },

  setTaskLabels: async (taskId, labelIds) => {
    await labelQueries.setTaskLabels(taskId, labelIds);
    await get().loadTaskLabels(taskId);
  },

  // ─── Bulk Operations ────────────────────────────────────────────

  toggleSelectId: (id) => {
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    });
  },

  selectAll: () => {
    set((state) => ({
      selectedIds: new Set(state.tasks.map((t) => t.id)),
    }));
  },

  clearSelection: () => set({ selectedIds: new Set() }),

  bulkComplete: async () => {
    const ids = [...get().selectedIds];
    if (ids.length === 0) return;
    try {
      await taskQueries.bulkUpdateTasks(ids, { status: "done" });
      set((state) => ({
        tasks: state.tasks.map((t) =>
          state.selectedIds.has(t.id) ? { ...t, status: "done" } : t,
        ),
        selectedIds: new Set(),
      }));
      get().loadSmartListCounts();
      toast.success(`${ids.length} task(s) completed`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to complete tasks");
    }
  },

  bulkDelete: async () => {
    const ids = [...get().selectedIds];
    if (ids.length === 0) return;
    try {
      await taskQueries.bulkDeleteTasks(ids);
      set((state) => ({
        tasks: state.tasks.filter((t) => !state.selectedIds.has(t.id)),
        selectedIds: new Set(),
        selectedTaskId: state.selectedIds.has(state.selectedTaskId ?? "") ? null : state.selectedTaskId,
      }));
      get().loadSmartListCounts();
      toast.success(`${ids.length} task(s) deleted`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete tasks");
    }
  },

  bulkSetPriority: async (priority) => {
    const ids = [...get().selectedIds];
    if (ids.length === 0) return;
    try {
      await taskQueries.bulkUpdateTasks(ids, { priority });
      set((state) => ({
        tasks: state.tasks.map((t) =>
          state.selectedIds.has(t.id) ? { ...t, priority } : t,
        ),
        selectedIds: new Set(),
      }));
      toast.success(`Priority set for ${ids.length} task(s)`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to update priority");
    }
  },

  bulkMoveToProject: async (projectId) => {
    const ids = [...get().selectedIds];
    if (ids.length === 0) return;
    try {
      await taskQueries.bulkUpdateTasks(ids, { project_id: projectId });
      set((state) => ({
        tasks: state.tasks.map((t) =>
          state.selectedIds.has(t.id) ? { ...t, project_id: projectId } : t,
        ),
        selectedIds: new Set(),
      }));
      toast.success(`${ids.length} task(s) moved`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to move tasks");
    }
  },
}));
