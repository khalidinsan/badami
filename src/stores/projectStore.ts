import { create } from "zustand";
import { toast } from "sonner";
import type { ProjectRow } from "@/types/db";
import * as projectQueries from "@/db/queries/projects";
import { now as nowISO } from "@/lib/dateUtils";
import { v4 as uuidv4 } from "uuid";

interface ProjectState {
  projects: ProjectRow[];
  loading: boolean;
  selectedProjectId: string | null;

  loadProjects: (status?: string) => Promise<void>;
  createProject: (data: {
    name: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
    category?: string | null;
  }) => Promise<ProjectRow>;
  updateProject: (
    id: string,
    data: {
      name?: string;
      description?: string | null;
      icon?: string | null;
      color?: string | null;
      category?: string | null;
      status?: string;
      sort_order?: number;
    },
  ) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setSelectedProjectId: (id: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loading: false,
  selectedProjectId: null,

  loadProjects: async (status?: string) => {
    set({ loading: true });
    try {
      const projects = await projectQueries.getProjects(status);
      set({ projects, loading: false });
    } catch (err) {
      console.error(err);
      toast.error("Failed to load projects");
      set({ loading: false });
    }
  },

  createProject: async (data) => {
    // Optimistic: add to state immediately
    const optimisticId = uuidv4();
    const timestamp = nowISO();
    const maxOrder = get().projects.reduce((max, p) => Math.max(max, p.sort_order), -1) + 1;
    const optimistic: ProjectRow = {
      id: optimisticId,
      name: data.name,
      description: data.description ?? null,
      content: null,
      icon: data.icon ?? null,
      color: data.color ?? null,
      category: data.category ?? null,
      status: "active",
      sort_order: maxOrder,
      created_at: timestamp,
      updated_at: timestamp,
    };
    set((state) => ({ projects: [...state.projects, optimistic] }));

    try {
      const project = await projectQueries.createProject(data);
      set((state) => ({
        projects: state.projects.map((p) => (p.id === optimisticId ? project : p)),
      }));
      toast.success("Project created");
      return project;
    } catch (err) {
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== optimisticId),
      }));
      console.error(err);
      toast.error("Failed to create project");
      throw err;
    }
  },

  updateProject: async (id, data) => {
    // Optimistic: apply changes immediately
    const prevProject = get().projects.find((p) => p.id === id);
    if (prevProject) {
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === id ? { ...p, ...data, updated_at: nowISO() } : p,
        ),
      }));
    }

    try {
      const updated = await projectQueries.updateProject(id, data);
      if (updated) {
        set((state) => ({
          projects: state.projects.map((p) => (p.id === id ? updated : p)),
        }));
      }
    } catch (err) {
      // Revert on error
      if (prevProject) {
        set((state) => ({
          projects: state.projects.map((p) => (p.id === id ? prevProject : p)),
        }));
      }
      console.error(err);
      toast.error("Failed to update project");
    }
  },

  archiveProject: async (id) => {
    // Optimistic: remove from list immediately
    const prevProjects = get().projects;
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
    }));

    try {
      await projectQueries.archiveProject(id);
      toast.success("Project archived");
    } catch (err) {
      set({ projects: prevProjects });
      console.error(err);
      toast.error("Failed to archive project");
    }
  },

  deleteProject: async (id) => {
    // Optimistic: remove immediately
    const prevProjects = get().projects;
    const prevSelected = get().selectedProjectId;
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      selectedProjectId:
        state.selectedProjectId === id ? null : state.selectedProjectId,
    }));

    try {
      await projectQueries.deleteProject(id);
      toast.success("Project deleted");
    } catch (err) {
      set({ projects: prevProjects, selectedProjectId: prevSelected });
      console.error(err);
      toast.error("Failed to delete project");
    }
  },

  setSelectedProjectId: (id) => set({ selectedProjectId: id }),
}));
