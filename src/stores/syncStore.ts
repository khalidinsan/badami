import { create } from "zustand";

export type SyncStatus =
  | "disabled"
  | "synced"
  | "syncing"
  | "pending"
  | "offline"
  | "error";

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  setStatus: (status: SyncStatus) => void;
  setLastSyncedAt: (ts: string | null) => void;
  setError: (msg: string | null) => void;
  setDurationMs: (ms: number | null) => void;
  handleSyncEvent: (payload: SyncEventPayload) => void;
}

export interface SyncEventPayload {
  status: SyncStatus;
  last_synced_at?: string;
  duration_ms?: number;
  error?: string;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: "disabled",
  lastSyncedAt: null,
  errorMessage: null,
  durationMs: null,

  setStatus: (status) => set({ status, errorMessage: status !== "error" ? null : undefined }),
  setLastSyncedAt: (ts) => set({ lastSyncedAt: ts }),
  setError: (msg) => set({ errorMessage: msg, status: "error" }),
  setDurationMs: (ms) => set({ durationMs: ms }),

  handleSyncEvent: (payload) => {
    set((state) => ({
      status: payload.status ?? state.status,
      lastSyncedAt: payload.last_synced_at ?? state.lastSyncedAt,
      durationMs: payload.duration_ms ?? state.durationMs,
      errorMessage: payload.error ?? (payload.status === "error" ? state.errorMessage : null),
    }));
  },
}));
