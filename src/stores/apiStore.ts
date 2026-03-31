import { create } from "zustand";
import { toast } from "sonner";
import * as apiQueries from "@/db/queries/api";
import type {
  ApiCollectionRow,
  ApiFolderRow,
  ApiRequestRow,
  ApiEnvironmentRow,
  ApiHistoryRow,
  ApiCollectionVariableRow,
} from "@/types/db";
import type { SendRequestResponse } from "@/types/api";

interface ApiState {
  // Data
  collections: ApiCollectionRow[];
  folders: Record<string, ApiFolderRow[]>; // keyed by collection_id
  requests: Record<string, ApiRequestRow[]>; // keyed by collection_id
  environments: Record<string, ApiEnvironmentRow[]>; // keyed by collection_id
  collectionVariables: Record<string, ApiCollectionVariableRow[]>; // keyed by collection_id
  history: ApiHistoryRow[];

  // UI state
  loading: boolean;
  loaded: boolean;
  /** 'all' when loaded via loadAllCollections, projectId string when loaded via loadCollectionsByProject */
  loadedContext: "all" | string | null;
  selectedCollectionId: string | null;
  selectedRequestId: string | null;
  activeTab: "params" | "headers" | "body" | "auth";
  responseTab: "body" | "headers" | "cookies";
  showHistory: boolean;

  // Response state
  response: SendRequestResponse | null;
  sending: boolean;

  // Actions
  loadAllCollections: () => Promise<void>;
  loadCollectionsByProject: (projectId: string) => Promise<void>;
  loadFolders: (collectionId: string) => Promise<void>;
  loadRequests: (collectionId: string) => Promise<void>;
  loadEnvironments: (collectionId: string) => Promise<void>;
  loadCollectionVariables: (collectionId: string) => Promise<void>;
  loadHistory: () => Promise<void>;

  createCollection: (data: {
    project_id?: string | null;
    name: string;
    description?: string | null;
  }) => Promise<ApiCollectionRow>;
  updateCollection: (
    id: string,
    data: { name?: string; description?: string | null },
  ) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  duplicateCollection: (id: string) => Promise<ApiCollectionRow>;
  assignCollectionToProject: (id: string, projectId: string | null) => Promise<void>;

  createFolder: (data: {
    collection_id: string;
    name: string;
  }) => Promise<ApiFolderRow>;
  updateFolder: (id: string, data: { name?: string }) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;

  createRequest: (data: {
    collection_id: string;
    folder_id?: string | null;
    name: string;
    method?: string;
  }) => Promise<ApiRequestRow>;
  updateRequest: (
    id: string,
    data: Parameters<typeof apiQueries.updateRequest>[1],
  ) => Promise<void>;
  deleteRequest: (id: string) => Promise<void>;

  // UI setters
  setSelectedCollectionId: (id: string | null) => void;
  setSelectedRequestId: (id: string | null) => void;
  setActiveTab: (tab: ApiState["activeTab"]) => void;
  setResponseTab: (tab: ApiState["responseTab"]) => void;
  setShowHistory: (show: boolean) => void;
  setResponse: (response: SendRequestResponse | null) => void;
  setSending: (sending: boolean) => void;
}

export const useApiStore = create<ApiState>((set, get) => ({
  collections: [],
  folders: {},
  requests: {},
  environments: {},
  collectionVariables: {},
  history: [],
  loading: false,
  loaded: false,
  loadedContext: null,
  selectedCollectionId: null,
  selectedRequestId: null,
  activeTab: "params",
  responseTab: "body",
  showHistory: false,
  response: null,
  sending: false,

  loadAllCollections: async () => {
    set({ loading: true });
    try {
      const collections = await apiQueries.getAllCollections();
      set({ collections, loading: false, loaded: true, loadedContext: "all" });
    } catch (err) {
      console.error(err);
      toast.error("Failed to load API collections");
      set({ loading: false, loaded: true });
    }
  },

  loadCollectionsByProject: async (projectId) => {
    set({ loading: true });
    try {
      const collections = await apiQueries.getCollectionsByProject(projectId);
      set({ collections, loading: false, loaded: true, loadedContext: projectId });
    } catch (err) {
      console.error(err);
      toast.error("Failed to load API collections");
      set({ loading: false, loaded: true });
    }
  },

  loadFolders: async (collectionId) => {
    try {
      const folders = await apiQueries.getFoldersByCollection(collectionId);
      set((state) => ({
        folders: { ...state.folders, [collectionId]: folders },
      }));
    } catch (err) {
      console.error(err);
    }
  },

  loadRequests: async (collectionId) => {
    try {
      const requests = await apiQueries.getRequestsByCollection(collectionId);
      set((state) => ({
        requests: { ...state.requests, [collectionId]: requests },
      }));
    } catch (err) {
      console.error(err);
    }
  },

  loadEnvironments: async (collectionId) => {
    try {
      const environments =
        await apiQueries.getEnvironmentsByCollection(collectionId);
      set((state) => ({
        environments: { ...state.environments, [collectionId]: environments },
      }));
    } catch (err) {
      console.error(err);
    }
  },

  loadCollectionVariables: async (collectionId) => {
    try {
      const vars = await apiQueries.getCollectionVariables(collectionId);
      set((state) => ({
        collectionVariables: { ...state.collectionVariables, [collectionId]: vars },
      }));
    } catch (err) {
      console.error(err);
    }
  },

  loadHistory: async () => {
    try {
      const history = await apiQueries.getHistory(200);
      set({ history });
    } catch (err) {
      console.error(err);
    }
  },

  createCollection: async (data) => {
    try {
      const collection = await apiQueries.createCollection(data);
      set((state) => ({
        collections: [...state.collections, collection],
      }));
      toast.success("Collection created");
      return collection;
    } catch (err) {
      console.error(err);
      toast.error("Failed to create collection");
      throw err;
    }
  },

  updateCollection: async (id, data) => {
    try {
      await apiQueries.updateCollection(id, data);
      set((state) => ({
        collections: state.collections.map((c) =>
          c.id === id ? { ...c, ...data } : c,
        ),
      }));
    } catch (err) {
      console.error(err);
      toast.error("Failed to update collection");
    }
  },

  deleteCollection: async (id) => {
    const prevCollections = get().collections;
    const prevSelectedId = get().selectedCollectionId;
    // Optimistic
    set((state) => ({
      collections: state.collections.filter((c) => c.id !== id),
      selectedCollectionId:
        state.selectedCollectionId === id ? null : state.selectedCollectionId,
    }));
    try {
      await apiQueries.deleteCollection(id);
      toast.success("Collection deleted");
    } catch (err) {
      set({ collections: prevCollections, selectedCollectionId: prevSelectedId });
      console.error(err);
      toast.error("Failed to delete collection");
    }
  },

  duplicateCollection: async (id) => {
    try {
      const newCol = await apiQueries.duplicateCollection(id);
      set((state) => ({
        collections: [...state.collections, newCol],
      }));
      toast.success("Collection duplicated");
      return newCol;
    } catch (err) {
      console.error(err);
      toast.error("Failed to duplicate collection");
      throw err;
    }
  },

  assignCollectionToProject: async (id, projectId) => {
    try {
      await apiQueries.updateCollection(id, { project_id: projectId });
      set((state) => ({
        collections: state.collections.map((c) =>
          c.id === id ? { ...c, project_id: projectId } : c,
        ),
      }));
      toast.success(projectId ? "Assigned to project" : "Removed from project");
    } catch (err) {
      console.error(err);
      toast.error("Failed to assign collection");
    }
  },

  createFolder: async (data) => {
    try {
      const folder = await apiQueries.createFolder(data);
      set((state) => ({
        folders: {
          ...state.folders,
          [data.collection_id]: [
            ...(state.folders[data.collection_id] || []),
            folder,
          ],
        },
      }));
      return folder;
    } catch (err) {
      console.error(err);
      toast.error("Failed to create folder");
      throw err;
    }
  },

  updateFolder: async (id, data) => {
    try {
      await apiQueries.updateFolder(id, data);
      // Reload parent collection folders
      const folder = Object.values(get().folders)
        .flat()
        .find((f) => f.id === id);
      if (folder) {
        await get().loadFolders(folder.collection_id);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to update folder");
    }
  },

  deleteFolder: async (id) => {
    try {
      const folder = Object.values(get().folders)
        .flat()
        .find((f) => f.id === id);
      // Optimistic: remove folder from state
      if (folder) {
        set((state) => ({
          folders: {
            ...state.folders,
            [folder.collection_id]: (state.folders[folder.collection_id] || []).filter(
              (f) => f.id !== id,
            ),
          },
        }));
      }
      await apiQueries.deleteFolder(id);
      // Reload requests for the collection since folder deletion may cascade
      if (folder) {
        await get().loadRequests(folder.collection_id);
      }
      toast.success("Folder deleted");
    } catch (err) {
      // Revert by reloading
      const folder = Object.values(get().folders)
        .flat()
        .find((f) => f.id === id);
      if (folder) {
        await get().loadFolders(folder.collection_id);
      }
      console.error(err);
      toast.error("Failed to delete folder");
    }
  },

  createRequest: async (data) => {
    try {
      const request = await apiQueries.createRequest(data);
      set((state) => ({
        requests: {
          ...state.requests,
          [data.collection_id]: [
            ...(state.requests[data.collection_id] || []),
            request,
          ],
        },
      }));
      return request;
    } catch (err) {
      console.error(err);
      toast.error("Failed to create request");
      throw err;
    }
  },

  updateRequest: async (id, data) => {
    // Optimistic: update in-place
    const req = Object.values(get().requests)
      .flat()
      .find((r) => r.id === id);
    if (req) {
      set((state) => ({
        requests: {
          ...state.requests,
          [req.collection_id]: (state.requests[req.collection_id] || []).map(
            (r) => (r.id === id ? { ...r, ...data } as ApiRequestRow : r),
          ),
        },
      }));
    }
    try {
      await apiQueries.updateRequest(id, data);
    } catch (err) {
      // Revert by reloading
      if (req) {
        await get().loadRequests(req.collection_id);
      }
      console.error(err);
      toast.error("Failed to update request");
    }
  },

  deleteRequest: async (id) => {
    const req = Object.values(get().requests)
      .flat()
      .find((r) => r.id === id);
    // Optimistic
    if (req) {
      set((state) => ({
        requests: {
          ...state.requests,
          [req.collection_id]: (state.requests[req.collection_id] || []).filter(
            (r) => r.id !== id,
          ),
        },
        selectedRequestId:
          state.selectedRequestId === id ? null : state.selectedRequestId,
      }));
    }
    try {
      await apiQueries.deleteRequest(id);
      toast.success("Request deleted");
    } catch (err) {
      if (req) {
        await get().loadRequests(req.collection_id);
      }
      console.error(err);
      toast.error("Failed to delete request");
    }
  },

  setSelectedCollectionId: (id) => set({ selectedCollectionId: id }),
  setSelectedRequestId: (id) => set({ selectedRequestId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setResponseTab: (tab) => set({ responseTab: tab }),
  setShowHistory: (show) => set({ showHistory: show }),
  setResponse: (response) => set({ response }),
  setSending: (sending) => set({ sending }),
}));
