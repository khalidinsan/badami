// ─── REST API Tool Types (Phase 11) ──────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
export type BodyType = "none" | "json" | "form_data" | "urlencoded" | "raw" | "binary";
export type AuthType = "none" | "bearer" | "basic" | "api_key" | "oauth2";

export interface KeyValueEntry {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiCollection {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ApiFolder {
  id: string;
  collection_id: string;
  name: string;
  sort_order: number;
}

export interface ApiRequest {
  id: string;
  collection_id: string;
  folder_id: string | null;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValueEntry[];
  params: KeyValueEntry[];
  body_type: BodyType;
  body_content: string | null;
  auth_type: AuthType;
  auth_config: AuthConfig | null;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ApiEnvironment {
  id: string;
  collection_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ApiEnvVariable {
  id: string;
  environment_id: string;
  var_key: string;
  plain_value: string | null;
  credential_id: string | null;
  credential_field: string | null;
  is_secret: boolean;
  enabled: boolean;
}

export interface ApiHistoryEntry {
  id: string;
  request_id: string | null;
  collection_id: string | null;
  method: HttpMethod;
  url: string;
  request_headers: string | null;
  request_body: string | null;
  auth_type: string | null;
  status_code: number | null;
  response_headers: string | null;
  response_body: string | null;
  response_size: number | null;
  elapsed_ms: number | null;
  sent_at: string;
}

// ─── Auth Configs ────────────────────────────────────────────────────

export interface BearerAuthConfig {
  type: "bearer";
  token: string;
}

export interface BasicAuthConfig {
  type: "basic";
  username: string;
  password: string;
}

export interface ApiKeyAuthConfig {
  type: "api_key";
  key: string;
  value: string;
  add_to: "header" | "query";
}

export interface OAuth2AuthConfig {
  type: "oauth2";
  grant_type: "client_credentials";
  token_url: string;
  client_id: string;
  client_secret: string;
  scope: string;
  cached_token?: string;
  token_expires_at?: string;
}

export type AuthConfig =
  | BearerAuthConfig
  | BasicAuthConfig
  | ApiKeyAuthConfig
  | OAuth2AuthConfig;

// ─── Request/Response payloads (for Rust invoke) ─────────────────────

export interface SendRequestPayload {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  params: { key: string; value: string }[];
  body: { body_type: string; content: string | null } | null;
  auth: {
    auth_type: string;
    config: Record<string, string> | null;
  };
  environment_id: string | null;
  disable_ssl_verify: boolean;
  timeout_seconds: number;
}

export interface SendRequestResponse {
  status: number;
  status_text: string;
  headers: { key: string; value: string }[];
  body: string;
  body_size: number;
  elapsed_ms: number;
  cookies: { name: string; value: string; domain: string }[];
}

// ─── Method Colors ───────────────────────────────────────────────────

export const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "#3b82f6",     // blue
  POST: "#22c55e",    // green
  PUT: "#eab308",     // yellow
  PATCH: "#f97316",   // orange
  DELETE: "#ef4444",  // red
  HEAD: "#6b7280",    // gray
  OPTIONS: "#6b7280", // gray
};

export const HTTP_METHODS: HttpMethod[] = [
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
];

export const STATUS_COLORS: Record<string, string> = {
  "2": "#22c55e", // green
  "3": "#3b82f6", // blue
  "4": "#eab308", // yellow
  "5": "#ef4444", // red
};

export function getStatusColor(status: number): string {
  const firstDigit = String(status).charAt(0);
  return STATUS_COLORS[firstDigit] || "#6b7280";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
