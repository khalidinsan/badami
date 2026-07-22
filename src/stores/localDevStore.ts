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

function serviceLabel(serviceId: string): string {
  return (
    useLocalDevStore.getState().services.find((s) => s.id === serviceId)?.label ?? serviceId
  );
}

function applyServices(services: ServiceStatusReport[]) {
  const prev = useLocalDevStore.getState().selectedServiceId;
  const selectedStillValid = prev != null && services.some((s) => s.id === prev);
  const selectedServiceId =
    selectedStillValid ? prev : services.length > 0 ? services[0].id : null;
  return {
    services,
    dnsDegraded: isDnsDegraded(services),
    selectedServiceId,
    error: null as string | null,
  };
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
      set(applyServices(services));
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
    const label = serviceLabel(serviceId);
    set((s) => ({
      serviceBusy: { ...s.serviceBusy, [serviceId]: true },
    }));
    try {
      const result = await invoke<ServiceActionResult>("ld_service_start", {
        serviceId,
      });
      if (result.status.status === "error" || result.status.status === "unavailable") {
        toast.error(`Failed to start ${label}`, {
          description: result.message || serviceStatusMsg(result.status),
        });
      } else {
        toast.success(`${label} started`);
      }
      await get().refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to start ${label}`, { description: message });
    } finally {
      set((s) => {
        const next = { ...s.serviceBusy };
        delete next[serviceId];
        return { serviceBusy: next };
      });
    }
  },

  stopService: async (serviceId) => {
    const label = serviceLabel(serviceId);
    set((s) => ({
      serviceBusy: { ...s.serviceBusy, [serviceId]: true },
    }));
    try {
      const result = await invoke<ServiceActionResult>("ld_service_stop", {
        serviceId,
      });
      if (result.status.status === "error") {
        toast.error(`Failed to stop ${label}`, {
          description: result.message || serviceStatusMsg(result.status),
        });
      } else {
        toast.success(`${label} stopped`);
      }
      await get().refreshStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to stop ${label}`, { description: message });
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

// ── Shared status poller (single timer; refcounted) ─────────────────

let pollTimer: number | null = null;
let pollSubscribers = 0;

/**
 * Acquire the shared status poller. Multiple Local Dev tab instances share one
 * interval; the timer stops when the last subscriber releases.
 */
export function acquireStatusPolling(): () => void {
  pollSubscribers += 1;
  if (pollTimer === null) {
    const tick = () => {
      void useLocalDevStore.getState().refreshStatus();
    };
    tick();
    pollTimer = window.setInterval(tick, POLL_MS);
  }
  return () => {
    pollSubscribers = Math.max(0, pollSubscribers - 1);
    if (pollSubscribers === 0 && pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}
