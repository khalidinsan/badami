export type CredentialType =
  | "web_login"
  | "app_account"
  | "api_key"
  | "database"
  | "email"
  | "license"
  | "secure_note"
  | "env_vars"
  | "server_access";

export type CredentialEnvironment = "production" | "staging" | "development" | "none";

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface Credential {
  id: string;
  project_id: string | null;
  type: CredentialType;
  name: string;
  username: string | null;
  url: string | null;
  service_name: string | null;
  environment: CredentialEnvironment;
  tags: string[] | null;
  expires_at: string | null;
  has_totp: boolean;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CredentialField {
  id: string;
  credential_id: string;
  field_key: string;
  field_label: string;
  encrypted_value: number[] | null;
  iv: number[] | null;
  plain_value: string | null;
  is_sensitive: boolean;
  field_order: number;
}

export interface CredentialTotp {
  id: string;
  credential_id: string;
  encrypted_secret: number[];
  iv: number[];
  digits: number;
  period_seconds: number;
  algorithm: TotpAlgorithm;
}

export interface CredentialEnvVar {
  id: string;
  credential_id: string;
  var_key: string;
  encrypted_value: number[];
  iv: number[];
  var_order: number;
}

export interface VaultConfig {
  id: string;
  has_master_password: boolean;
  password_hint: string | null;
  argon2_salt: number[] | null;
  auto_lock_minutes: number;
  created_at: string;
  updated_at: string;
}

// ─── Create/Update payloads ─────────────────────────────────────────

export interface CreateCredentialPayload {
  project_id?: string | null;
  type: CredentialType;
  name: string;
  username?: string | null;
  url?: string | null;
  service_name?: string | null;
  environment?: CredentialEnvironment;
  tags?: string[];
  expires_at?: string | null;
  notes?: string | null;
  /** Sensitive fields: key → plaintext value (will be encrypted via Rust) */
  sensitive_fields?: Record<string, { label: string; value: string }>;
  /** Plain fields: key → {label, value} */
  plain_fields?: Record<string, { label: string; value: string }>;
}

export interface UpdateCredentialPayload {
  id: string;
  name?: string;
  username?: string | null;
  url?: string | null;
  service_name?: string | null;
  environment?: CredentialEnvironment;
  tags?: string[];
  expires_at?: string | null;
  notes?: string | null;
  project_id?: string | null;
}

export interface CredentialWithFields extends Credential {
  fields: CredentialField[];
}

// ─── Credential type metadata ───────────────────────────────────────

export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  web_login: "Web Login",
  app_account: "App Account",
  api_key: "API Key / Token",
  database: "Database",
  email: "Email Account",
  license: "License Key",
  secure_note: "Secure Note",
  env_vars: "Environment Variables",
  server_access: "Server Access",
};

export const CREDENTIAL_TYPE_ICONS: Record<CredentialType, string> = {
  web_login: "Globe",
  app_account: "Smartphone",
  api_key: "Key",
  database: "Database",
  email: "Mail",
  license: "CreditCard",
  secure_note: "Lock",
  env_vars: "Settings",
  server_access: "Server",
};

export const ENVIRONMENT_LABELS: Record<CredentialEnvironment, string> = {
  production: "Production",
  staging: "Staging",
  development: "Development",
  none: "None",
};

export const ENVIRONMENT_COLORS: Record<CredentialEnvironment, string> = {
  production: "#ef4444",
  staging: "#f59e0b",
  development: "#22c55e",
  none: "#6b7280",
};
