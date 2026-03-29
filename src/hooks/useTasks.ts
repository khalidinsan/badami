import { useEffect } from "react";
import { useTaskStore, type TaskFilters } from "@/stores/taskStore";
import { listen } from "@tauri-apps/api/event";

export function useTasks(filters?: TaskFilters) {
  const store = useTaskStore();

  useEffect(() => {
    store.loadTasks(filters);
    store.loadLabels();
  }, [filters?.status, filters?.priority, filters?.project_id]);

  // Listen for cross-window task changes (e.g. from Today window) — silent, no loading flash
  useEffect(() => {
    const unlisten = listen("task-changed", () => {
      store.silentLoadTasks();
      store.loadSmartListCounts();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  return store;
}
