import { useCallback } from "react";
import { useApiStore } from "@/stores/apiStore";
import * as apiQueries from "@/db/queries/api";
import type { ApiEnvironmentRow, ApiEnvVariableRow } from "@/types/db";

export function useEnvironment(collectionId: string | null) {
  const { environments, loadEnvironments } = useApiStore();
  const envList = collectionId ? environments[collectionId] || [] : [];
  const activeEnv = envList.find((e) => e.is_active === 1) ?? null;

  const reload = useCallback(() => {
    if (collectionId) loadEnvironments(collectionId);
  }, [collectionId, loadEnvironments]);

  const create = useCallback(
    async (name: string): Promise<ApiEnvironmentRow> => {
      if (!collectionId) throw new Error("No collection selected");
      const env = await apiQueries.createEnvironment({
        collection_id: collectionId,
        name,
      });
      reload();
      return env;
    },
    [collectionId, reload],
  );

  const update = useCallback(
    async (id: string, data: { name?: string }) => {
      await apiQueries.updateEnvironment(id, data);
      reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      await apiQueries.deleteEnvironment(id);
      reload();
    },
    [reload],
  );

  const setActive = useCallback(
    async (environmentId: string) => {
      if (!collectionId) return;
      await apiQueries.setActiveEnvironment(collectionId, environmentId);
      reload();
    },
    [collectionId, reload],
  );

  const getVariables = useCallback(
    async (environmentId: string): Promise<ApiEnvVariableRow[]> => {
      return apiQueries.getEnvVariablesByEnvironment(environmentId);
    },
    [],
  );

  const createVariable = useCallback(
    async (data: {
      environment_id: string;
      var_key: string;
      plain_value?: string | null;
      credential_id?: string | null;
      credential_field?: string | null;
      is_secret?: number;
    }) => {
      return apiQueries.createEnvVariable(data);
    },
    [],
  );

  const updateVariable = useCallback(
    async (
      id: string,
      data: Parameters<typeof apiQueries.updateEnvVariable>[1],
    ) => {
      await apiQueries.updateEnvVariable(id, data);
    },
    [],
  );

  const deleteVariable = useCallback(async (id: string) => {
    await apiQueries.deleteEnvVariable(id);
  }, []);

  return {
    environments: envList,
    activeEnvironment: activeEnv,
    reload,
    create,
    update,
    remove,
    setActive,
    getVariables,
    createVariable,
    updateVariable,
    deleteVariable,
  };
}
