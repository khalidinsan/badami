import { create } from "zustand";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import type { CredentialRow, VaultConfigRow } from "@/types/db";
import type { CredentialType, CredentialEnvironment } from "@/types/credential";
import * as credentialQueries from "@/db/queries/credentials";
import { toByteArray } from "@/hooks/useCredentials";
import { now as nowISO } from "@/lib/dateUtils";
import { v4 as uuidv4 } from "uuid";

interface CredentialFilters {
  search: string;
  type: CredentialType | "all";
  environment: CredentialEnvironment | "all";
  projectId: string | "all";
}

interface CredentialState {
  credentials: CredentialRow[];
  loading: boolean;
  loaded: boolean;

  // Vault
  vaultConfig: VaultConfigRow | null;
  isVaultLocked: boolean;

  // UI state
  selectedId: string | null;
  filters: CredentialFilters;

  // Actions
  loadAllCredentials: () => Promise<void>;
  loadCredentialsByProject: (projectId: string) => Promise<void>;
  createCredential: (
    data: Parameters<typeof credentialQueries.createCredential>[0],
  ) => Promise<CredentialRow>;
  updateCredential: (
    id: string,
    data: Parameters<typeof credentialQueries.updateCredential>[1],
  ) => Promise<void>;
  deleteCredential: (id: string) => Promise<void>;

  // Vault
  loadVaultConfig: () => Promise<void>;
  initVault: () => Promise<void>;
  lockVault: () => Promise<void>;
  unlockVault: (password: string) => Promise<void>;

  // UI
  setSelectedId: (id: string | null) => void;
  setFilters: (filters: Partial<CredentialFilters>) => void;
}

export const useCredentialStore = create<CredentialState>((set, get) => ({
  credentials: [],
  loading: false,
  loaded: false,
  vaultConfig: null,
  isVaultLocked: false,
  selectedId: null,
  filters: {
    search: "",
    type: "all",
    environment: "all",
    projectId: "all",
  },

  loadAllCredentials: async () => {
    set({ loading: true });
    try {
      const credentials = await credentialQueries.getAllCredentials();
      set({ credentials, loading: false, loaded: true });
    } catch (err) {
      console.error(err);
      toast.error("Failed to load credentials");
      set({ loading: false, loaded: true });
    }
  },

  loadCredentialsByProject: async (projectId: string) => {
    set({ loading: true });
    try {
      const credentials =
        await credentialQueries.getCredentialsByProject(projectId);
      set({ credentials, loading: false, loaded: true });
    } catch (err) {
      console.error(err);
      toast.error("Failed to load credentials");
      set({ loading: false, loaded: true });
    }
  },

  createCredential: async (data) => {
    // Optimistic: add to state immediately
    const optimisticId = uuidv4();
    const timestamp = nowISO();
    const optimistic: CredentialRow = {
      id: optimisticId,
      project_id: data.project_id ?? null,
      type: data.type,
      name: data.name,
      username: data.username ?? null,
      url: data.url ?? null,
      service_name: data.service_name ?? null,
      environment: data.environment ?? "production",
      tags: data.tags ? JSON.stringify(data.tags) : null,
      expires_at: data.expires_at ?? null,
      has_totp: 0,
      notes: data.notes ?? null,
      sort_order: get().credentials.length,
      created_at: timestamp,
      updated_at: timestamp,
    };
    set((state) => ({
      credentials: [...state.credentials, optimistic],
    }));

    try {
      const credential = await credentialQueries.createCredential(data);
      // Reconcile
      set((state) => ({
        credentials: state.credentials.map((c) =>
          c.id === optimisticId ? credential : c,
        ),
      }));
      toast.success("Credential added");
      return credential;
    } catch (err) {
      // Revert
      set((state) => ({
        credentials: state.credentials.filter((c) => c.id !== optimisticId),
      }));
      console.error(err);
      toast.error("Failed to add credential");
      throw err;
    }
  },

  updateCredential: async (id, data) => {
    const prev = get().credentials.find((c) => c.id === id);
    // Optimistic — spread only known CredentialRow-compatible fields
    if (prev) {
      const patch: Partial<CredentialRow> = {
        updated_at: nowISO(),
      };
      if (data.name !== undefined) patch.name = data.name;
      if (data.environment !== undefined) patch.environment = data.environment;
      if (data.username !== undefined) patch.username = data.username;
      if (data.url !== undefined) patch.url = data.url;
      if (data.service_name !== undefined) patch.service_name = data.service_name;
      if (data.notes !== undefined) patch.notes = data.notes;
      if (data.expires_at !== undefined) patch.expires_at = data.expires_at;
      if (data.project_id !== undefined) patch.project_id = data.project_id;
      if (data.tags !== undefined) patch.tags = Array.isArray(data.tags) ? JSON.stringify(data.tags) : data.tags;
      set((state) => ({
        credentials: state.credentials.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      }));
    }
    try {
      const updated = await credentialQueries.updateCredential(id, data);
      if (updated) {
        set((state) => ({
          credentials: state.credentials.map((c) =>
            c.id === id ? updated : c,
          ),
        }));
      }
    } catch (err) {
      if (prev) {
        set((state) => ({
          credentials: state.credentials.map((c) =>
            c.id === id ? prev : c,
          ),
        }));
      }
      console.error(err);
      toast.error("Failed to update credential");
    }
  },

  deleteCredential: async (id) => {
    const prevCredentials = get().credentials;
    const prevSelected = get().selectedId;
    // Optimistic
    set((state) => ({
      credentials: state.credentials.filter((c) => c.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    }));
    try {
      await credentialQueries.deleteCredential(id);
      toast.success("Credential deleted");
    } catch (err) {
      set({ credentials: prevCredentials, selectedId: prevSelected });
      console.error(err);
      toast.error("Failed to delete credential");
    }
  },

  loadVaultConfig: async () => {
    try {
      const config = await credentialQueries.getVaultConfig();
      set({ vaultConfig: config ?? null });
    } catch (err) {
      console.error(err);
    }
  },

  initVault: async () => {
    try {
      const config = await credentialQueries.getVaultConfig();
      set({ vaultConfig: config ?? null });
      const hasMaster = config?.has_master_password === 1;
      await invoke("vault_init", { hasMasterPassword: hasMaster });
      set({ isVaultLocked: hasMaster });
    } catch (err) {
      console.error(err);
    }
  },

  lockVault: async () => {
    try {
      await invoke("vault_lock");
      set({ isVaultLocked: true });
    } catch (err) {
      console.error(err);
      toast.error("Failed to lock vault");
    }
  },

  unlockVault: async (password: string) => {
    const config = get().vaultConfig;
    if (!config?.argon2_salt) {
      toast.error("Vault not configured");
      return;
    }
    try {
      const salt = toByteArray(config.argon2_salt);
      await invoke("vault_unlock", { password, salt });
      set({ isVaultLocked: false });
      toast.success("Vault unlocked");
    } catch (err) {
      console.error(err);
      toast.error("Failed to unlock vault — wrong password?");
      throw err;
    }
  },

  setSelectedId: (id) => set({ selectedId: id }),
  setFilters: (partial) =>
    set((state) => ({
      filters: { ...state.filters, ...partial },
    })),
}));
