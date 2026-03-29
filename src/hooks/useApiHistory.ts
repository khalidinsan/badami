import { useCallback, useEffect } from "react";
import { useApiStore } from "@/stores/apiStore";
import * as apiQueries from "@/db/queries/api";

export function useApiHistory() {
  const { history, loadHistory } = useApiStore();

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const deleteEntry = useCallback(async (id: string) => {
    await apiQueries.deleteHistoryEntry(id);
    loadHistory();
  }, [loadHistory]);

  const clearAll = useCallback(async () => {
    await apiQueries.clearHistory();
    loadHistory();
  }, [loadHistory]);

  return { history, reload: loadHistory, deleteEntry, clearAll };
}
