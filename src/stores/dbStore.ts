import { create } from "zustand";
import { toast } from "sonner";
import type { DbConnectionRow } from "@/types/db";
import * as dbQueries from "@/db/queries/dbClient";
import { now as nowISO } from "@/lib/dateUtils";

// ── Types ───────────────────────────────────────────────────────────

export type DbEngine = "mysql" | "mariadb" | "postgresql" | "sqlite";

export interface DbTab {
  id: string;
  type: "table" | "query" | "structure" | "er";
  title: string;
  connectionId: string;
  /** For table tabs: the table name */
  tableName?: string;
  /** For query tabs: the SQL content */
  sqlContent?: string;
  /** The selected database / schema */
  database?: string;
}

export interface PendingCellEdit {
  rowIndex: number;
  column: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface PendingRowInsert {
  tempId: string;
  data: Record<string, unknown>;
}

export interface PendingRowDelete {
  pkValue: unknown;
}

// ── State ───────────────────────────────────────────────────────────

interface DbClientState {
  connections: DbConnectionRow[];
  loading: boolean;
  /** Pool IDs currently connected in Rust backend */
  activePoolIds: Set<string>;
  /** Current active connection ID for the workspace */
  activeConnectionId: string | null;
  /** Current selected database within the active connection */
  activeDatabase: string | null;
  /** Open tabs */
  tabs: DbTab[];
  activeTabId: string | null;
  /** View mode: 'connections' (list) or 'workspace' (connected + browser) */
  viewMode: "connections" | "workspace";

  // Actions — connections
  loadConnections: () => Promise<void>;
  loadConnectionsByProject: (projectId: string) => Promise<void>;
  createConnection: (data: Parameters<typeof dbQueries.createConnection>[0]) => Promise<DbConnectionRow>;
  updateConnection: (id: string, data: Parameters<typeof dbQueries.updateConnection>[1]) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  touchConnected: (id: string) => void;
  setActiveConnection: (id: string | null) => void;
  setActiveDatabase: (db: string | null) => void;

  // Actions — pool tracking
  markPoolConnected: (poolId: string) => void;
  markPoolDisconnected: (poolId: string) => void;

  // Actions — tabs
  openTab: (tab: DbTab) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabSql: (tabId: string, sql: string) => void;
  renameTab: (tabId: string, title: string) => void;

  // Actions — view
  setViewMode: (mode: "connections" | "workspace") => void;
}

export const useDbStore = create<DbClientState>((set, get) => ({
  connections: [],
  loading: false,
  activePoolIds: new Set(),
  activeConnectionId: null,
  activeDatabase: null,
  tabs: [],
  activeTabId: null,
  viewMode: "connections",

  // ── Connections ─────────────────────────────────────────────────

  loadConnections: async () => {
    set({ loading: true });
    try {
      const connections = await dbQueries.getConnections();
      set({ connections, loading: false });
    } catch (err) {
      console.error(err);
      toast.error("Failed to load database connections");
      set({ loading: false });
    }
  },

  loadConnectionsByProject: async (projectId) => {
    set({ loading: true });
    try {
      const connections = await dbQueries.getConnectionsByProject(projectId);
      set({ connections, loading: false });
    } catch (err) {
      console.error(err);
      toast.error("Failed to load database connections");
      set({ loading: false });
    }
  },

  createConnection: async (data) => {
    try {
      const conn = await dbQueries.createConnection(data);
      set((s) => ({ connections: [...s.connections, conn] }));
      toast.success("Connection added");
      return conn;
    } catch (err) {
      console.error(err);
      toast.error("Failed to add connection");
      throw err;
    }
  },

  updateConnection: async (id, data) => {
    const prev = get().connections.find((c) => c.id === id);
    // Optimistic
    if (prev) {
      set((s) => ({
        connections: s.connections.map((c) =>
          c.id === id ? { ...c, ...data, updated_at: nowISO() } as DbConnectionRow : c,
        ),
      }));
    }
    try {
      const updated = await dbQueries.updateConnection(id, data);
      if (updated) {
        set((s) => ({
          connections: s.connections.map((c) => (c.id === id ? updated : c)),
        }));
      }
    } catch (err) {
      if (prev) {
        set((s) => ({
          connections: s.connections.map((c) => (c.id === id ? prev : c)),
        }));
      }
      console.error(err);
      toast.error("Failed to update connection");
    }
  },

  deleteConnection: async (id) => {
    const prev = get().connections;
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
    }));
    try {
      await dbQueries.deleteConnection(id);
      toast.success("Connection deleted");
    } catch (err) {
      set({ connections: prev });
      console.error(err);
      toast.error("Failed to delete connection");
    }
  },

  touchConnected: (id) => {
    const ts = nowISO();
    set((s) => ({
      connections: s.connections.map((c) =>
        c.id === id ? { ...c, last_connected_at: ts } as DbConnectionRow : c,
      ),
    }));
    dbQueries.touchConnectionConnected(id).catch(console.error);
  },

  setActiveConnection: (id) => set({ activeConnectionId: id }),
  setActiveDatabase: (db) => set({ activeDatabase: db }),

  // ── Pool tracking ─────────────────────────────────────────────

  markPoolConnected: (poolId) =>
    set((s) => {
      const next = new Set(s.activePoolIds);
      next.add(poolId);
      return { activePoolIds: next };
    }),

  markPoolDisconnected: (poolId) =>
    set((s) => {
      const next = new Set(s.activePoolIds);
      next.delete(poolId);
      return { activePoolIds: next };
    }),

  // ── Tabs ──────────────────────────────────────────────────────

  openTab: (tab) =>
    set((s) => {
      // If tab for same table/query already exists, just switch to it
      const existing = s.tabs.find(
        (t) =>
          t.connectionId === tab.connectionId &&
          t.type === tab.type &&
          t.tableName === tab.tableName &&
          t.type === "table",
      );
      if (existing) {
        return { activeTabId: existing.id };
      }
      return { tabs: [...s.tabs, tab], activeTabId: tab.id };
    }),

  closeTab: (tabId) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      const next = s.tabs.filter((t) => t.id !== tabId);
      let nextActive = s.activeTabId;
      if (s.activeTabId === tabId) {
        nextActive = next[Math.min(idx, next.length - 1)]?.id ?? null;
      }
      return { tabs: next, activeTabId: nextActive };
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  updateTabSql: (tabId, sql) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, sqlContent: sql } : t)),
    })),

  renameTab: (tabId, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    })),

  // ── View ──────────────────────────────────────────────────────

  setViewMode: (mode) => set({ viewMode: mode }),
}));
