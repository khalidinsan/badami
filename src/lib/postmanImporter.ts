// ─── Postman Collection v2.1 Importer/Exporter ──────────────────────

import * as apiQueries from "@/db/queries/api";
import type { ApiCollectionRow, ApiFolderRow, ApiRequestRow } from "@/types/db";

// ─── Postman v2.1 types (subset) ────────────────────────────────────

interface PostmanCollection {
  info: {
    name: string;
    description?: string;
    schema: string;
  };
  item: PostmanItem[];
  variable?: PostmanVariable[];
}

interface PostmanItem {
  name: string;
  item?: PostmanItem[]; // folder children
  request?: PostmanRequest;
}

interface PostmanRequest {
  method: string;
  header?: PostmanKeyValue[];
  url:
    | string
    | {
        raw: string;
        protocol?: string;
        host?: string[];
        path?: string[];
        query?: PostmanKeyValue[];
      };
  body?: {
    mode: string;
    raw?: string;
    urlencoded?: PostmanKeyValue[];
    formdata?: PostmanKeyValue[];
  };
  auth?: PostmanAuth;
}

interface PostmanKeyValue {
  key: string;
  value: string;
  type?: string;
  disabled?: boolean;
}

interface PostmanAuth {
  type: string;
  bearer?: PostmanKeyValue[];
  basic?: PostmanKeyValue[];
  apikey?: PostmanKeyValue[];
}

interface PostmanVariable {
  key: string;
  value: string;
  type?: string;
}

// ─── Import ──────────────────────────────────────────────────────────

export async function importPostmanCollection(
  json: string,
  projectId: string | null = null,
): Promise<ApiCollectionRow> {
  const data: PostmanCollection = JSON.parse(json);

  if (
    !data.info?.schema?.includes("collection/v2")
  ) {
    throw new Error("Only Postman Collection v2.1 format is supported");
  }

  // Create collection
  const collection = await apiQueries.createCollection({
    project_id: projectId,
    name: data.info.name,
    description: data.info.description ?? null,
  });

  // Process items recursively
  await processItems(data.item, collection.id, null);

  // Import collection variables
  if (data.variable && data.variable.length > 0) {
    await apiQueries.upsertCollectionVariables(
      collection.id,
      data.variable
        .filter((v) => v.key)
        .map((v) => ({ key: v.key, value: v.value ?? "" })),
    );
  }

  return collection;
}

async function processItems(
  items: PostmanItem[],
  collectionId: string,
  folderId: string | null,
) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.item && !item.request) {
      // It's a folder
      const folder = await apiQueries.createFolder({
        collection_id: collectionId,
        name: item.name,
      });
      await processItems(item.item, collectionId, folder.id);
    } else if (item.request) {
      await importRequest(item, collectionId, folderId);
    }
  }
}

async function importRequest(
  item: PostmanItem,
  collectionId: string,
  folderId: string | null,
) {
  const req = item.request!;
  const method = (req.method || "GET").toUpperCase();

  // Parse URL
  let url: string;
  let queryParams: { key: string; value: string; enabled: boolean }[] = [];
  if (typeof req.url === "string") {
    url = req.url;
  } else {
    url = req.url.raw || "";
    if (req.url.query) {
      queryParams = req.url.query.map((q) => ({
        key: q.key,
        value: q.value,
        enabled: !q.disabled,
      }));
    }
  }

  // Headers
  const headers = (req.header || []).map((h) => ({
    key: h.key,
    value: h.value,
    enabled: !h.disabled,
  }));

  // Body
  let bodyType = "none";
  let bodyContent: string | null = null;
  if (req.body) {
    switch (req.body.mode) {
      case "raw":
        bodyType = "json";
        bodyContent = req.body.raw ?? null;
        break;
      case "urlencoded":
        bodyType = "urlencoded";
        bodyContent = JSON.stringify(
          (req.body.urlencoded || []).map((u) => ({
            key: u.key,
            value: u.value,
            enabled: !u.disabled,
          })),
        );
        break;
      case "formdata":
        bodyType = "form_data";
        bodyContent = JSON.stringify(
          (req.body.formdata || []).map((f) => ({
            key: f.key,
            value: f.value,
            enabled: !f.disabled,
          })),
        );
        break;
    }
  }

  // Auth
  let authType = "none";
  let authConfig: string | null = null;
  if (req.auth) {
    switch (req.auth.type) {
      case "bearer": {
        authType = "bearer";
        const tokenKv = req.auth.bearer?.find((b) => b.key === "token");
        authConfig = JSON.stringify({
          type: "bearer",
          token: tokenKv?.value ?? "",
        });
        break;
      }
      case "basic": {
        authType = "basic";
        const usernameKv = req.auth.basic?.find((b) => b.key === "username");
        const passwordKv = req.auth.basic?.find((b) => b.key === "password");
        authConfig = JSON.stringify({
          type: "basic",
          username: usernameKv?.value ?? "",
          password: passwordKv?.value ?? "",
        });
        break;
      }
      case "apikey": {
        authType = "api_key";
        const keyKv = req.auth.apikey?.find((a) => a.key === "key");
        const valueKv = req.auth.apikey?.find((a) => a.key === "value");
        const inKv = req.auth.apikey?.find((a) => a.key === "in");
        authConfig = JSON.stringify({
          type: "api_key",
          key: keyKv?.value ?? "",
          value: valueKv?.value ?? "",
          add_to: inKv?.value === "query" ? "query" : "header",
        });
        break;
      }
    }
  }

  await apiQueries.createRequest({
    collection_id: collectionId,
    folder_id: folderId,
    name: item.name,
    method,
    url,
    headers: JSON.stringify(headers),
    params: JSON.stringify(queryParams),
    body_type: bodyType,
    body_content: bodyContent,
    auth_type: authType,
    auth_config: authConfig,
  });
}

// ─── Export ──────────────────────────────────────────────────────────

export async function exportPostmanCollection(
  collection: ApiCollectionRow,
  folders: ApiFolderRow[],
  requests: ApiRequestRow[],
): Promise<string> {
  const rootRequests = requests.filter((r) => !r.folder_id);
  const items: PostmanItem[] = [];

  // Export folders
  for (const folder of folders) {
    const folderRequests = requests.filter((r) => r.folder_id === folder.id);
    items.push({
      name: folder.name,
      item: folderRequests.map(exportRequest),
    });
  }

  // Export root requests
  for (const req of rootRequests) {
    items.push(exportRequest(req));
  }

  const postmanCollection: PostmanCollection = {
    info: {
      name: collection.name,
      description: collection.description ?? "",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: items,
  };

  // Include collection variables
  const colVars = await apiQueries.getCollectionVariables(collection.id);
  if (colVars.length > 0) {
    postmanCollection.variable = colVars
      .filter((v) => v.enabled && v.var_key && !v.credential_id)
      .map((v) => ({
        key: v.var_key,
        value: v.plain_value ?? "",
        type: "string",
      }));
  }

  return JSON.stringify(postmanCollection, null, 2);
}

function exportRequest(req: ApiRequestRow): PostmanItem {
  const headers: PostmanKeyValue[] = req.headers
    ? JSON.parse(req.headers).map((h: { key: string; value: string; enabled: boolean }) => ({
        key: h.key,
        value: h.value,
        disabled: !h.enabled,
      }))
    : [];

  const params: PostmanKeyValue[] = req.params
    ? JSON.parse(req.params).map((p: { key: string; value: string; enabled: boolean }) => ({
        key: p.key,
        value: p.value,
        disabled: !p.enabled,
      }))
    : [];

  const postmanReq: PostmanRequest = {
    method: req.method,
    header: headers,
    url: {
      raw: req.url,
      query: params.length > 0 ? params : undefined,
    },
  };

  // Body
  if (req.body_type !== "none" && req.body_content) {
    switch (req.body_type) {
      case "json":
      case "raw":
        postmanReq.body = { mode: "raw", raw: req.body_content };
        break;
      case "urlencoded":
        postmanReq.body = {
          mode: "urlencoded",
          urlencoded: safeParseKV(req.body_content),
        };
        break;
      case "form_data":
        postmanReq.body = {
          mode: "formdata",
          formdata: safeParseKV(req.body_content),
        };
        break;
    }
  }

  // Auth
  if (req.auth_type !== "none" && req.auth_config) {
    const cfg = JSON.parse(req.auth_config);
    switch (req.auth_type) {
      case "bearer":
        postmanReq.auth = {
          type: "bearer",
          bearer: [{ key: "token", value: cfg.token || "", type: "string" }],
        };
        break;
      case "basic":
        postmanReq.auth = {
          type: "basic",
          basic: [
            { key: "username", value: cfg.username || "", type: "string" },
            { key: "password", value: cfg.password || "", type: "string" },
          ],
        };
        break;
      case "api_key":
        postmanReq.auth = {
          type: "apikey",
          apikey: [
            { key: "key", value: cfg.key || "", type: "string" },
            { key: "value", value: cfg.value || "", type: "string" },
            {
              key: "in",
              value: cfg.add_to === "query" ? "query" : "header",
              type: "string",
            },
          ],
        };
        break;
    }
  }

  return { name: req.name, request: postmanReq };
}

function safeParseKV(
  json: string,
): PostmanKeyValue[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr)
      ? arr.map((item: { key: string; value: string; enabled?: boolean }) => ({
          key: item.key,
          value: item.value,
          disabled: item.enabled === false,
        }))
      : [];
  } catch {
    return [];
  }
}
