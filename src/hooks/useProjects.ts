import { useEffect } from "react";
import { useProjectStore } from "@/stores/projectStore";

export function useProjects(status?: string) {
  const store = useProjectStore();

  useEffect(() => {
    store.loadProjects(status);
  }, [status]);

  return store;
}
