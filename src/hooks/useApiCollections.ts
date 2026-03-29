import { useCallback, useEffect } from "react";
import { useApiStore } from "@/stores/apiStore";

export function useApiCollections(projectId?: string) {
  const {
    collections,
    folders,
    requests,
    loading,
    loaded,
    loadAllCollections,
    loadCollectionsByProject,
    loadFolders,
    loadRequests,
    createCollection,
    updateCollection,
    deleteCollection,
    duplicateCollection,
    createFolder,
    updateFolder,
    deleteFolder,
    createRequest,
    updateRequest,
    deleteRequest,
  } = useApiStore();

  const reload = useCallback(() => {
    if (projectId) {
      loadCollectionsByProject(projectId);
    } else {
      loadAllCollections();
    }
  }, [projectId, loadAllCollections, loadCollectionsByProject]);

  useEffect(() => {
    if (!loaded) reload();
  }, [loaded, reload]);

  const loadCollectionData = useCallback(
    async (collectionId: string) => {
      await Promise.all([loadFolders(collectionId), loadRequests(collectionId)]);
    },
    [loadFolders, loadRequests],
  );

  return {
    collections,
    folders,
    requests,
    loading,
    reload,
    loadCollectionData,
    createCollection,
    updateCollection,
    deleteCollection,
    duplicateCollection,
    createFolder,
    updateFolder,
    deleteFolder,
    createRequest,
    updateRequest,
    deleteRequest,
  };
}
