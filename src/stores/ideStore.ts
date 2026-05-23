import { create } from "zustand";

export interface IdeTab {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  language: string;
  isDirty: boolean;
  isPreview: boolean;
}

interface IdeState {
  tabs: IdeTab[];
  activeFile: string | null;
  sidebarOpen: boolean;
  aiSidebarOpen: boolean;

  openFile: (path: string, name: string, content: string, language: string, preview?: boolean) => void;
  closeTab: (path: string) => void;
  closeOtherTabs: (path: string) => void;
  closeAllTabs: () => void;
  setActiveFile: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  markSaved: (path: string, content: string) => void;
  promoteTab: (path: string) => void;
  toggleSidebar: () => void;
  toggleAiSidebar: () => void;
  reset: () => void;
}

export const useIdeStore = create<IdeState>((set, get) => ({
  tabs: [],
  activeFile: null,
  sidebarOpen: true,
  aiSidebarOpen: false,

  openFile: (path, name, content, language, preview = false) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      if (!preview) set({ tabs: tabs.map((t) => t.path === path ? { ...t, isPreview: false } : t), activeFile: path });
      else set({ activeFile: path });
      return;
    }
    if (preview) {
      const previewIdx = tabs.findIndex((t) => t.isPreview);
      if (previewIdx !== -1) {
        const newTabs = [...tabs];
        newTabs[previewIdx] = { path, name, content, originalContent: content, language, isDirty: false, isPreview: true };
        set({ tabs: newTabs, activeFile: path });
        return;
      }
    }
    set({
      tabs: [...tabs, { path, name, content, originalContent: content, language, isDirty: false, isPreview: preview }],
      activeFile: path,
    });
  },

  closeTab: (path) => {
    const { tabs, activeFile } = get();
    const newTabs = tabs.filter((t) => t.path !== path);
    let newActive = activeFile;
    if (activeFile === path) {
      const idx = tabs.findIndex((t) => t.path === path);
      newActive = newTabs[Math.min(idx, newTabs.length - 1)]?.path ?? null;
    }
    set({ tabs: newTabs, activeFile: newActive });
  },

  closeOtherTabs: (path) => {
    set({ tabs: get().tabs.filter((t) => t.path === path), activeFile: path });
  },

  closeAllTabs: () => {
    set({ tabs: [], activeFile: null });
  },

  setActiveFile: (path) => set({ activeFile: path }),

  updateContent: (path, content) => {
    set({
      tabs: get().tabs.map((t) =>
        t.path === path ? { ...t, content, isDirty: content !== t.originalContent, isPreview: false } : t
      ),
    });
  },

  markSaved: (path, content) => {
    set({
      tabs: get().tabs.map((t) =>
        t.path === path ? { ...t, content, originalContent: content, isDirty: false } : t
      ),
    });
  },

  promoteTab: (path) => {
    set({ tabs: get().tabs.map((t) => t.path === path ? { ...t, isPreview: false } : t) });
  },

  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  toggleAiSidebar: () => set({ aiSidebarOpen: !get().aiSidebarOpen }),
  reset: () => set({ tabs: [], activeFile: null, sidebarOpen: true, aiSidebarOpen: false }),
}));
