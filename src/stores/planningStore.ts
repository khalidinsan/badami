import { create } from "zustand";
import type { TaskRow } from "@/types/db";
import * as planningQueries from "@/db/queries/planning";
import type { CalendarEventData } from "@/db/queries/planning";
import { now as nowISO } from "@/lib/dateUtils";

interface PlanningState {
  tasks: TaskRow[];
  selectedDate: string;
  loading: boolean;
  calendarEvents: CalendarEventData[];
  calendarRange: { start: string; end: string } | null;

  setSelectedDate: (date: string) => void;
  loadTasks: (date: string) => Promise<void>;
  loadCalendarEvents: (startDate: string, endDate: string) => Promise<void>;
  scheduleTask: (taskId: string, date: string) => Promise<void>;
  rescheduleTask: (taskId: string, newDate: string) => Promise<void>;
  createNote: (date: string, note: string) => Promise<TaskRow>;
  toggleTask: (taskId: string) => Promise<void>;
  unscheduleTask: (taskId: string) => Promise<void>;
  importProjectTasks: (projectId: string, date: string) => Promise<void>;
  reorderTasks: (tasks: TaskRow[]) => void;
}

export const usePlanningStore = create<PlanningState>((set, get) => ({
  tasks: [],
  selectedDate: new Date().toISOString().split("T")[0],
  loading: false,
  calendarEvents: [],
  calendarRange: null,

  setSelectedDate: (date) => set({ selectedDate: date }),

  loadTasks: async (date: string) => {
    set({ loading: true, selectedDate: date });
    const tasks = await planningQueries.getTasksForDate(date);
    set({ tasks, loading: false });
  },

  loadCalendarEvents: async (startDate, endDate) => {
    set({ calendarRange: { start: startDate, end: endDate } });
    const events = await planningQueries.getTasksForCalendar(startDate, endDate);
    set({ calendarEvents: events });
  },

  scheduleTask: async (taskId, date) => {
    const task = await planningQueries.scheduleTask(taskId, date);
    if (task) {
      set((state) => ({ tasks: [...state.tasks, task] }));
    }
    // Refresh calendar events in background
    const { calendarRange } = get();
    if (calendarRange) {
      planningQueries.getTasksForCalendar(calendarRange.start, calendarRange.end)
        .then((events) => set({ calendarEvents: events }));
    }
  },

  rescheduleTask: async (taskId, newDate) => {
    // Optimistic: remove from current day, fire DB in background
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    }));
    await planningQueries.scheduleTask(taskId, newDate);
    // Refresh calendar events in background
    const { calendarRange } = get();
    if (calendarRange) {
      planningQueries.getTasksForCalendar(calendarRange.start, calendarRange.end)
        .then((events) => set({ calendarEvents: events }));
    }
  },

  createNote: async (date, note) => {
    const task = await planningQueries.createScheduledNote(date, note);
    set((state) => ({ tasks: [...state.tasks, task] }));
    // Refresh calendar events in background
    const { calendarRange } = get();
    if (calendarRange) {
      planningQueries.getTasksForCalendar(calendarRange.start, calendarRange.end)
        .then((events) => set({ calendarEvents: events }));
    }
    return task;
  },

  toggleTask: async (taskId) => {
    // Optimistic: toggle status immediately
    const task = get().tasks.find((t) => t.id === taskId);
    if (task) {
      const nextStatus = task.status === "done" ? "todo" : "done";
      const timestamp = nowISO();
      const optimistic: TaskRow = {
        ...task,
        status: nextStatus,
        updated_at: timestamp,
        completed_at: nextStatus === "done" ? timestamp : null,
      };
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === taskId ? optimistic : t)),
      }));
    }

    try {
      const updated = await planningQueries.toggleTaskStatus(taskId);
      if (updated) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
        }));
      }
      // Refresh calendar events in background
      const { calendarRange } = get();
      if (calendarRange) {
        planningQueries.getTasksForCalendar(calendarRange.start, calendarRange.end)
          .then((events) => set({ calendarEvents: events }));
      }
    } catch (err) {
      // Revert on error
      if (task) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === taskId ? task : t)),
        }));
      }
      console.error("Failed to toggle task:", err);
    }
  },

  unscheduleTask: async (taskId) => {
    // Optimistic: remove immediately
    const prevTasks = get().tasks;
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    }));

    try {
      await planningQueries.unscheduleTask(taskId);
      const { calendarRange } = get();
      if (calendarRange) {
        planningQueries.getTasksForCalendar(calendarRange.start, calendarRange.end)
          .then((events) => set({ calendarEvents: events }));
      }
    } catch (err) {
      set({ tasks: prevTasks });
      console.error("Failed to unschedule task:", err);
    }
  },

  importProjectTasks: async (projectId, date) => {
    await planningQueries.importProjectTasks(projectId, date);
    const tasks = await planningQueries.getTasksForDate(date);
    set({ tasks });
    // Refresh calendar events in background
    const { calendarRange } = get();
    if (calendarRange) {
      planningQueries.getTasksForCalendar(calendarRange.start, calendarRange.end)
        .then((events) => set({ calendarEvents: events }));
    }
  },

  reorderTasks: (tasks) => set({ tasks }),
}));
