import { create } from "zustand";
import { db } from "@/db/client";

interface SettingsState {
  settings: Record<string, string>;
  loaded: boolean;
  loadSettings: () => Promise<void>;
  getSetting: (key: string, defaultValue?: string) => string;
  setSetting: (key: string, value: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {},
  loaded: false,

  loadSettings: async () => {
    const rows = await db.selectFrom("settings").selectAll().execute();
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    set({ settings, loaded: true });
  },

  getSetting: (key: string, defaultValue = "") => {
    return get().settings[key] ?? defaultValue;
  },

  setSetting: async (key: string, value: string) => {
    await db
      .insertInto("settings")
      .values({ key, value })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
      .execute();
    set((state) => ({
      settings: { ...state.settings, [key]: value },
    }));
  },
}));
