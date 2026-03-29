import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApiStore } from "@/stores/apiStore";
import * as apiQueries from "@/db/queries/api";
import * as credentialQueries from "@/db/queries/credentials";
import type { SendRequestPayload, SendRequestResponse, KeyValueEntry } from "@/types/api";
import type { ApiRequestRow, ApiEnvVariableRow, ApiCollectionVariableRow } from "@/types/db";

// ──────────────────────────────────────────────────────────
// Variable resolution helpers
// ──────────────────────────────────────────────────────────

const VAR_PATTERN = /\{\{([^}]+)\}\}/g;
const CRED_PATTERN = /^CRED:([^:]+):(.+)$/;

async function resolveVarRows(
  vars: (ApiEnvVariableRow | ApiCollectionVariableRow)[],
  map: Record<string, string>,
) {
  for (const v of vars) {
    if (!v.enabled || !v.var_key) continue;
    // Skip keys already set (env vars take priority over collection vars)
    if (v.var_key in map) continue;

    if (v.credential_id && v.credential_field) {
      const fields = await credentialQueries.getFieldsByCredential(v.credential_id);
      const matched = fields.find((f) => f.field_key === v.credential_field);
      if (matched) {
        map[v.var_key] = matched.plain_value ?? "[encrypted]";
      }
    } else {
      map[v.var_key] = v.plain_value ?? "";
    }
  }
}

async function buildVarMap(
  collectionId: string,
  environmentId: string | null,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};

  // 1. Environment variables (highest priority)
  if (environmentId) {
    const envVars = await apiQueries.getEnvVariablesByEnvironment(environmentId);
    await resolveVarRows(envVars, map);
  }

  // 2. Collection variables (fallback — only fills keys not already set)
  const colVars = await apiQueries.getCollectionVariables(collectionId);
  await resolveVarRows(colVars, map);

  return map;
}

async function resolveCredRef(ref: string): Promise<string> {
  const m = ref.match(CRED_PATTERN);
  if (!m) return `{{${ref}}}`;
  const [, credId, fieldKey] = m;
  const fields = await credentialQueries.getFieldsByCredential(credId);
  const matched = fields.find((f) => f.field_key === fieldKey);
  return matched?.plain_value ?? "[encrypted]";
}

async function resolveString(
  s: string,
  varMap: Record<string, string>,
): Promise<string> {
  // First pass: resolve CRED refs and env variables
  const parts: Promise<string>[] = [];
  let lastIndex = 0;

  for (const match of s.matchAll(VAR_PATTERN)) {
    const start = match.index!;
    parts.push(Promise.resolve(s.slice(lastIndex, start)));
    const inner = match[1];

    if (CRED_PATTERN.test(inner)) {
      parts.push(resolveCredRef(inner));
    } else if (inner in varMap) {
      parts.push(Promise.resolve(varMap[inner]));
    } else {
      // Leave unresolved placeholder as-is
      parts.push(Promise.resolve(match[0]));
    }
    lastIndex = start + match[0].length;
  }
  parts.push(Promise.resolve(s.slice(lastIndex)));
  return (await Promise.all(parts)).join("");
}

async function resolveKVList(
  list: { key: string; value: string }[],
  varMap: Record<string, string>,
): Promise<{ key: string; value: string }[]> {
  return Promise.all(
    list.map(async (kv) => ({
      key: await resolveString(kv.key, varMap),
      value: await resolveString(kv.value, varMap),
    })),
  );
}

async function resolveAuthConfig(
  config: Record<string, string> | null,
  varMap: Record<string, string>,
): Promise<Record<string, string> | null> {
  if (!config) return null;
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    resolved[k] = typeof v === "string" ? await resolveString(v, varMap) : v;
  }
  return resolved;
}

export function useApiRequest() {
  const { response, sending, setResponse, setSending } = useApiStore();
  const abortRef = useRef(false);

  const sendRequest = useCallback(
    async (
      request: ApiRequestRow,
      environmentId: string | null,
      opts?: { disableSslVerify?: boolean; timeoutSeconds?: number },
    ) => {
      setSending(true);
      setResponse(null);
      abortRef.current = false;

      try {
        // Build variable map from collection vars + active environment
        const varMap = await buildVarMap(request.collection_id, environmentId);

        // Parse stored JSON fields
        const headers: KeyValueEntry[] = request.headers
          ? JSON.parse(request.headers)
          : [];
        const params: KeyValueEntry[] = request.params
          ? JSON.parse(request.params)
          : [];
        const authConfig = request.auth_config
          ? JSON.parse(request.auth_config)
          : null;

        const enabledHeaders = headers
          .filter((h) => h.enabled && h.key)
          .map((h) => ({ key: h.key, value: h.value }));
        const enabledParams = params
          .filter((p) => p.enabled && p.key)
          .map((p) => ({ key: p.key, value: p.value }));

        // Resolve all variables
        const resolvedUrl = await resolveString(request.url, varMap);
        const resolvedHeaders = await resolveKVList(enabledHeaders, varMap);
        const resolvedParams = await resolveKVList(enabledParams, varMap);
        const resolvedBody =
          request.body_type !== "none" && request.body_content
            ? await resolveString(request.body_content, varMap)
            : request.body_content;
        const resolvedAuth = await resolveAuthConfig(authConfig, varMap);

        const payload: SendRequestPayload = {
          method: request.method,
          url: resolvedUrl,
          headers: resolvedHeaders,
          params: resolvedParams,
          body:
            request.body_type !== "none"
              ? { body_type: request.body_type, content: resolvedBody }
              : null,
          auth: {
            auth_type: request.auth_type,
            config: resolvedAuth,
          },
          environment_id: environmentId,
          disable_ssl_verify: opts?.disableSslVerify ?? false,
          timeout_seconds: opts?.timeoutSeconds ?? 30,
        };

        const result = await invoke<SendRequestResponse>(
          "api_send_request",
          { payload },
        );

        if (!abortRef.current) {
          setResponse(result);
        }

        // Save to history (original unresolved values for privacy)
        await apiQueries.createHistoryEntry({
          request_id: request.id,
          collection_id: request.collection_id,
          method: request.method,
          url: request.url,
          request_headers: JSON.stringify(enabledHeaders),
          request_body: request.body_content,
          auth_type: request.auth_type,
          status_code: result.status,
          response_headers: JSON.stringify(result.headers),
          response_body: result.body,
          response_size: result.body_size,
          elapsed_ms: result.elapsed_ms,
        });

        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!abortRef.current) {
          setResponse({
            status: 0,
            status_text: "Error",
            headers: [],
            body: message,
            body_size: message.length,
            elapsed_ms: 0,
            cookies: [],
          });
        }
        throw err;
      } finally {
        setSending(false);
      }
    },
    [setResponse, setSending],
  );

  const cancel = useCallback(() => {
    abortRef.current = true;
    setSending(false);
  }, [setSending]);

  return { response, sending, sendRequest, cancel };
}
