import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type {
  DiscoveryReport,
  LogTailResult,
  ServiceStatusReport,
  StackActionResult,
  ServiceActionResult,
} from "@/types/localDev";
import { isDnsDegraded } from "@/types/localDev";

const POLL_MS = 2500;

interface LocalDevState {
  services: ServiceStatusReport[];
  discovery: DiscoveryReport | null;
  stackBusy: boolean;
  /** Service ids currently starting/stopping via UI action */
  serviceBusy: Record<string, boolean>;
  dnsDegraded: boolean;
  loading: boolean;
  error: string | null;
  selectedServiceId: string | null;
  logTail: LogTailResult | null;
  logLoading: boolean;

  setSelectedServiceId: (id: string | null) => void;
  refreshStatus: () => Promise<void>;
  discover: () => Promise<void>;
  startService: (serviceId: string) => Promise<void>;
  stopService: (serviceId: string) => Promise<void>;
  startStack: () => Promise<void>;
  stopStack: () => Promise<void>;
  fetchLogs: (serviceId: string, lines?: number) => Promise<void>;
}

export const useLocalDevStore = create<LocalDevState>((set, get) => ({
  services: [],
  discovery: null,
  stackBusy: false,
  serviceBusy: {},
  dnsDegraded: false,
  loading: false,
  error: null,
  selectedServiceId: null,
  logTail: null,
  logLoading: false,

  setSelectedServiceId: (id) => set({ selectedServiceId: id }),

  refreshStatus: async () => {
    try {
      const services = await invoke<ServiceStatusReport[]>("ld_service_status", {
        serviceId: null,
      });
      set({
        services,
        dnsDegraded: isDnsDegraded(services),
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
    }
  },

  discover: async () => {
    set({ loading: true });
    try {
      const discovery = await invoke<DiscoveryReport>("ld_discover");
      set({ discovery, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(err);
      set({ loading: false, error: message });
      toast.error("Discovery failed", { description: message });
    }
  },

  startService: async (serviceId) => {
    set((s) => ({
      serviceBusy: { ...s.serviceBusy, [serviceId]: true },
    }));
    try {
      const result = await invoke<ServiceActionResult>("ld_service_start", {
        serviceId,
      });
      if (result.status.status === "error" || result.status.status === "unavailable") {
        toast.error(`Failed to start ${serviceId}`, {
          description: result.message || serviceStatusMsg(result.status),
        });
      } else {
        toast.success(`${serviceId} started`);
      }
      await get().refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to start ${serviceId}`, { description: message });
    } finally {
      set((s) => {
        const next = { ...s.serviceBusy };
        delete next[serviceId];
        return { serviceBusy: next };
      });
    }
  },

  stopService: async (serviceId) => {
    set((s) => ({
      serviceBusy: { ...s.serviceBusy, [serviceId]: true },
    }));
    try {
      const result = await invoke<ServiceActionResult>("ld_service_stop", {
        serviceId,
      });
      if (result.status.status === "error") {
        toast.error(`Failed to stop ${serviceId}`, {
          description: result.message || serviceStatusMsg(result.status),
        });
      } else {
        toast.success(`${serviceId} stopped`);
      }
      await get().refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to stop ${serviceId}`, { description: message });
    } finally {
      set((s) => {
        const next = { ...s.serviceBusy };
        delete next[serviceId];
        return { serviceBusy: next };
      });
    }
  },

  startStack: async () => {
    set({ stackBusy: true });
    try {
      const result = await invoke<StackActionResult>("ld_stack_start");
      if (result.partial_failure) {
        toast.warning("Stack started with partial failures", {
          description: result.notes.slice(0, 3).join(" · ") || undefined,
        });
      } else {
        toast.success("Local Dev stack started");
      }
      await get().refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Stack start failed", { description: message });
    } finally {
      set({ stackBusy: false });
    }
  },

  stopStack: async () => {
    set({ stackBusy: true });
    try {
      const result = await invoke<StackActionResult>("ld_stack_stop");
      if (result.partial_failure) {
        toast.warning("Stack stop completed with errors", {
          description: result.notes.slice(0, 3).join(" · ") || undefined,
        });
      } else {
        toast.success("Local Dev stack stopped");
      }
      await get().refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Stack stop failed", { description: message });
    } finally {
      set({ stackBusy: false });
    }
  },

  fetchLogs: async (serviceId, lines = 200) => {
    set({ logLoading: true });
    try {
      const logTail = await invoke<LogTailResult>("ld_log_tail", {
        serviceId,
        lines,
      });
      set({ logTail, logLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ logLoading: false });
      toast.error("Failed to load logs", { description: message });
    }
  },
}));

function serviceStatusMsg(status: ServiceActionResult["status"]): string {
  if (status.status === "error") return status.message;
  if (status.status === "unavailable") return status.reason;
  if (status.status === "unhealthy") return status.reason;
  return status.status;
}

/** Poll service status while active. Returns cleanup. */
export function startStatusPolling(): () => void {
  const tick = () => {
    void useLocalDevStore.getState().refreshStatus();
  };
  tick();
  const id = window.setInterval(tick, POLL_MS);
  return () => window.clearInterval(id);
}
