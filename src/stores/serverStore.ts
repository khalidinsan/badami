import { create } from "zustand";
import { toast } from "sonner";
import type { ServerCredentialRow, PemKeyRow } from "@/types/db";
import * as serverQueries from "@/db/queries/servers";
import { now as nowISO } from "@/lib/dateUtils";

interface ServerState {
  servers: ServerCredentialRow[];
  pemKeys: PemKeyRow[];
  loading: boolean;

  loadAllServers: () => Promise<void>;
  loadServers: (projectId: string) => Promise<void>;
  createServer: (data: Parameters<typeof serverQueries.createServer>[0]) => Promise<ServerCredentialRow>;
  updateServer: (id: string, data: Parameters<typeof serverQueries.updateServer>[1]) => Promise<void>;
  deleteServer: (id: string) => Promise<void>;

  loadPemKeys: () => Promise<void>;
  deletePemKey: (id: string) => Promise<void>;
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],
  pemKeys: [],
  loading: false,

  loadAllServers: async () => {
    set({ loading: true });
    try {
      const servers = await serverQueries.getAllServers();
      set({ servers, loading: false });
    } catch (err) {
      console.error(err);
      toast.error("Failed to load servers");
      set({ loading: false });
    }
  },

  loadServers: async (projectId: string) => {
    set({ loading: true });
    try {
      const servers = await serverQueries.getServersByProject(projectId);
      set({ servers, loading: false });
    } catch (err) {
      console.error(err);
      toast.error("Failed to load servers");
      set({ loading: false });
    }
  },

  createServer: async (data) => {
    try {
      const server = await serverQueries.createServer(data);
      set((state) => ({ servers: [...state.servers, server] }));
      toast.success("Server added");
      return server;
    } catch (err) {
      console.error(err);
      toast.error("Failed to add server");
      throw err;
    }
  },

  updateServer: async (id, data) => {
    const prev = get().servers.find((s) => s.id === id);
    // Optimistic
    if (prev) {
      set((state) => ({
        servers: state.servers.map((s) =>
          s.id === id ? { ...s, ...data, updated_at: nowISO() } as ServerCredentialRow : s,
        ),
      }));
    }
    try {
      const updated = await serverQueries.updateServer(id, data);
      if (updated) {
        set((state) => ({
          servers: state.servers.map((s) => (s.id === id ? updated : s)),
        }));
      }
    } catch (err) {
      if (prev) {
        set((state) => ({
          servers: state.servers.map((s) => (s.id === id ? prev : s)),
        }));
      }
      console.error(err);
      toast.error("Failed to update server");
    }
  },

  deleteServer: async (id) => {
    const prevServers = get().servers;
    // Optimistic
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== id),
    }));
    try {
      await serverQueries.deleteServer(id);
      toast.success("Server deleted");
    } catch (err) {
      set({ servers: prevServers });
      console.error(err);
      toast.error("Failed to delete server");
    }
  },

  loadPemKeys: async () => {
    try {
      const pemKeys = await serverQueries.getPemKeys();
      set({ pemKeys });
    } catch (err) {
      console.error(err);
      toast.error("Failed to load PEM keys");
    }
  },

  deletePemKey: async (id) => {
    const prevKeys = get().pemKeys;
    // Optimistic
    set((state) => ({
      pemKeys: state.pemKeys.filter((k) => k.id !== id),
    }));
    try {
      await serverQueries.deletePemKey(id);
      toast.success("PEM key deleted");
    } catch (err) {
      set({ pemKeys: prevKeys });
      console.error(err);
      toast.error("Failed to delete PEM key");
    }
  },
}));
