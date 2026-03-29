import { create } from "zustand";
import type { PomodoroSessionRow } from "@/types/db";
import * as pomodoroQueries from "@/db/queries/pomodoro";
import * as settingsQueries from "@/db/queries/settings";

type TimerStatus = "idle" | "working" | "break" | "paused";

interface PomodoroState {
  status: TimerStatus;
  secondsLeft: number;
  totalSeconds: number;
  workMin: number;
  breakMin: number;
  currentSession: PomodoroSessionRow | null;
  todaySessions: PomodoroSessionRow[];
  linkedTaskId: string | null;
  pausedFrom: TimerStatus | null;

  loadSettings: () => Promise<void>;
  start: (taskId?: string | null) => Promise<void>;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  tick: () => void;
  completeWork: () => Promise<void>;
  completeBreak: () => void;
  skip: () => Promise<void>;
  loadTodaySessions: () => Promise<void>;
}

export const usePomodoroStore = create<PomodoroState>((set, get) => ({
  status: "idle",
  secondsLeft: 25 * 60,
  totalSeconds: 25 * 60,
  workMin: 25,
  breakMin: 5,
  currentSession: null,
  todaySessions: [],
  linkedTaskId: null,
  pausedFrom: null,

  loadSettings: async () => {
    const settings = await settingsQueries.getSettings([
      "pomodoro_work_min",
      "pomodoro_break_min",
    ]);
    const workMin = parseInt(settings.pomodoro_work_min ?? "25", 10);
    const breakMin = parseInt(settings.pomodoro_break_min ?? "5", 10);
    set({
      workMin,
      breakMin,
      secondsLeft: workMin * 60,
      totalSeconds: workMin * 60,
    });
  },

  start: async (taskId) => {
    const { workMin, breakMin } = get();
    const session = await pomodoroQueries.createPomodoroSession({
      task_id: taskId ?? null,
      duration_min: workMin,
      break_min: breakMin,
    });
    set({
      status: "working",
      secondsLeft: workMin * 60,
      totalSeconds: workMin * 60,
      currentSession: session,
      linkedTaskId: taskId ?? null,
      pausedFrom: null,
    });
  },

  pause: () => {
    const { status } = get();
    if (status === "working" || status === "break") {
      set({ status: "paused", pausedFrom: status });
    }
  },

  resume: () => {
    const { pausedFrom } = get();
    if (pausedFrom) {
      set({ status: pausedFrom, pausedFrom: null });
    }
  },

  reset: () => {
    const { workMin, currentSession } = get();
    if (currentSession) {
      pomodoroQueries.cancelPomodoroSession(currentSession.id);
    }
    set({
      status: "idle",
      secondsLeft: workMin * 60,
      totalSeconds: workMin * 60,
      currentSession: null,
      linkedTaskId: null,
      pausedFrom: null,
    });
  },

  tick: () => {
    const { secondsLeft, status } = get();
    if (status !== "working" && status !== "break") return;
    if (secondsLeft <= 0) return;
    set({ secondsLeft: secondsLeft - 1 });
  },

  completeWork: async () => {
    const { currentSession, breakMin } = get();
    if (currentSession) {
      await pomodoroQueries.completePomodoroSession(currentSession.id);
    }
    set({
      status: "break",
      secondsLeft: breakMin * 60,
      totalSeconds: breakMin * 60,
      pausedFrom: null,
    });
    // Reload today sessions
    get().loadTodaySessions();
  },

  completeBreak: () => {
    const { workMin } = get();
    set({
      status: "idle",
      secondsLeft: workMin * 60,
      totalSeconds: workMin * 60,
      currentSession: null,
      linkedTaskId: null,
      pausedFrom: null,
    });
  },

  skip: async () => {
    const { status } = get();
    if (status === "working") {
      await get().completeWork();
    } else if (status === "break") {
      get().completeBreak();
    }
  },

  loadTodaySessions: async () => {
    const sessions = await pomodoroQueries.getTodaySessions();
    set({ todaySessions: sessions });
  },
}));
