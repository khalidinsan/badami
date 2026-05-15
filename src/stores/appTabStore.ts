import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";

// ── Types ───────────────────────────────────────────────────────────

export type AppTabType =
  | "planning"
  | "projects"
  | "project"
  | "tasks"
  | "servers"
  | "server"
  | "credentials"
  | "api"
  | "database"
  | "ai"
  | "stats"
  | "settings"
  | "about";

export interface AppTab {
  id: string;
  type: AppTabType;
  /** Display title */
  title: string;
  /** Icon name from lucide (for rendering) */
  icon: string;
  /** Route path to render (current path, updated on navigation) */
  route: string;
  /** Optional context (e.g. server id, project id) */
  contextId?: string;
  /** Whether this tab is pinned (can't be closed) */
  pinned?: boolean;
}

// ── Persistence ─────────────────────────────────────────────────────

const STORAGE_KEY = "badami_app_tabs";

interface PersistedState {
  tabs: AppTab[];
  activeTabId: string | null;
}

function saveState(tabs: AppTab[], activeTabId: string | null) {
  try {
    const data: PersistedState = { tabs, activeTabId };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
}

function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedState;
    if (data.tabs && data.tabs.length > 0) return data;
    return null;
  } catch {
    return null;
  }
}

// ── State ───────────────────────────────────────────────────────────

interface AppTabState {
  tabs: AppTab[];
  activeTabId: string | null;

  openTab: (tab: Omit<AppTab, "id"> & { id?: string }, forceNew?: boolean) => void;
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (tabId: string) => void;
  /** Navigate: if a tab with same route exists, switch to it; otherwise replace current */
  navigateTab: (tab: Omit<AppTab, "id">) => void;
  /** Update tab title */
  renameTab: (tabId: string, title: string) => void;
  /** Update the active tab's route (for tracking sub-navigation within a tab) */
  updateActiveRoute: (route: string) => void;
  /** Reorder tabs (drag & drop) */
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  /** Pin/unpin a tab */
  pinTab: (tabId: string) => void;
  unpinTab: (tabId: string) => void;
}

// ── Default tab ─────────────────────────────────────────────────────

const DEFAULT_TAB: AppTab = {
  id: "tab-planning",
  type: "planning",
  title: "Planning",
  icon: "CalendarDays",
  route: "/planning",
  pinned: false,
};

// ── Load persisted or default ───────────────────────────────────────

const persisted = loadState();
const initialTabs = persisted?.tabs ?? [DEFAULT_TAB];
const initialActiveId = persisted?.activeTabId ?? DEFAULT_TAB.id;

// ── Store ───────────────────────────────────────────────────────────

export const useAppTabStore = create<AppTabState>((set, get) => ({
  tabs: initialTabs,
  activeTabId: initialActiveId,

  openTab: (tabData, forceNew = false) => {
    const id = tabData.id ?? uuidv4();
    const tab: AppTab = { ...tabData, id };

    set((s) => {
      // Skip dedupe if forceNew — always create a new tab
      if (!forceNew) {
        const existing = s.tabs.find(
          (t) => t.route === tab.route && t.contextId === tab.contextId,
        );
        if (existing) {
          saveState(s.tabs, existing.id);
          return { activeTabId: existing.id };
        }
      }
      const newTabs = [...s.tabs, tab];
      saveState(newTabs, id);
      return { tabs: newTabs, activeTabId: id };
    });
  },

  closeTab: (tabId) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (tab?.pinned) return {};

      const idx = s.tabs.findIndex((t) => t.id === tabId);
      const next = s.tabs.filter((t) => t.id !== tabId);

      if (next.length === 0) {
        saveState([DEFAULT_TAB], DEFAULT_TAB.id);
        return { tabs: [DEFAULT_TAB], activeTabId: DEFAULT_TAB.id };
      }

      let nextActive = s.activeTabId;
      if (s.activeTabId === tabId) {
        nextActive = next[Math.min(idx, next.length - 1)]?.id ?? null;
      }
      saveState(next, nextActive);
      return { tabs: next, activeTabId: nextActive };
    }),

  closeOtherTabs: (tabId) =>
    set((s) => {
      const kept = s.tabs.filter((t) => t.id === tabId || t.pinned);
      saveState(kept, tabId);
      return { tabs: kept, activeTabId: tabId };
    }),

  closeTabsToRight: (tabId) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return {};
      const kept = s.tabs.filter((t, i) => i <= idx || t.pinned);
      const activeStillExists = kept.some((t) => t.id === s.activeTabId);
      const newActive = activeStillExists ? s.activeTabId : tabId;
      saveState(kept, newActive);
      return { tabs: kept, activeTabId: newActive };
    }),

  closeAllTabs: () =>
    set(() => {
      saveState([DEFAULT_TAB], DEFAULT_TAB.id);
      return { tabs: [DEFAULT_TAB], activeTabId: DEFAULT_TAB.id };
    }),

  setActiveTab: (tabId) =>
    set((s) => {
      saveState(s.tabs, tabId);
      return { activeTabId: tabId };
    }),

  navigateTab: (tabData) => {
    const { tabs, activeTabId } = get();

    const existing = tabs.find(
      (t) => t.route === tabData.route && t.contextId === tabData.contextId,
    );
    if (existing) {
      if (existing.id !== activeTabId) {
        set({ activeTabId: existing.id });
        saveState(tabs, existing.id);
      }
      return;
    }

    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
      if (idx === -1) {
        const tab: AppTab = { ...tabData, id: uuidv4() };
        const newTabs = [...s.tabs, tab];
        saveState(newTabs, tab.id);
        return { tabs: newTabs, activeTabId: tab.id };
      }
      const newId = uuidv4();
      const updated = [...s.tabs];
      updated[idx] = { ...tabData, id: newId };
      saveState(updated, newId);
      return { tabs: updated, activeTabId: newId };
    });
  },

  renameTab: (tabId, title) =>
    set((s) => {
      const newTabs = s.tabs.map((t) => (t.id === tabId ? { ...t, title } : t));
      saveState(newTabs, s.activeTabId);
      return { tabs: newTabs };
    }),

  updateActiveRoute: (route) =>
    set((s) => {
      if (!s.activeTabId) return {};
      const newTabs = s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, route } : t,
      );
      saveState(newTabs, s.activeTabId);
      return { tabs: newTabs };
    }),

  reorderTabs: (fromIndex, toIndex) =>
    set((s) => {
      const newTabs = [...s.tabs];
      const [moved] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, moved);
      saveState(newTabs, s.activeTabId);
      return { tabs: newTabs };
    }),

  pinTab: (tabId) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab || tab.pinned) return {};
      const withoutTab = s.tabs.filter((t) => t.id !== tabId);
      let lastPinnedIdx = -1;
      for (let i = withoutTab.length - 1; i >= 0; i--) {
        if (withoutTab[i].pinned) { lastPinnedIdx = i; break; }
      }
      const insertAt = lastPinnedIdx + 1;
      const pinnedTab = { ...tab, pinned: true };
      const newTabs = [...withoutTab.slice(0, insertAt), pinnedTab, ...withoutTab.slice(insertAt)];
      saveState(newTabs, s.activeTabId);
      return { tabs: newTabs };
    }),

  unpinTab: (tabId) =>
    set((s) => {
      const newTabs = s.tabs.map((t) =>
        t.id === tabId ? { ...t, pinned: false } : t,
      );
      saveState(newTabs, s.activeTabId);
      return { tabs: newTabs };
    }),
}));
