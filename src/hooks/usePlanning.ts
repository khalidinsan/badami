import { useEffect } from "react";
import { usePlanningStore } from "@/stores/planningStore";
import { today } from "@/lib/dateUtils";

export function usePlanning(date?: string) {
  const store = usePlanningStore();

  useEffect(() => {
    const d = date ?? today();
    store.loadTasks(d);
  }, [date]);

  return store;
}
