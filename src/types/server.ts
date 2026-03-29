export type ServerProtocol = "ssh" | "ftp" | "ftps";
export type ServerEnvironment = "production" | "staging" | "development" | "other";
export type AuthType = "password" | "pem_file" | "pem_saved" | "pem_passphrase";

export interface ServerCredential {
  id: string;
  project_id: string | null;
  name: string;
  environment: ServerEnvironment;
  color: string;
  protocol: ServerProtocol;
  host: string;
  port: number;
  username: string;
  auth_type: AuthType;
  pem_key_id: string | null;
  pem_file_path: string | null;
  initial_directory: string;
  notes_content: string | null;
  last_connected_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PemKey {
  id: string;
  alias: string;
  encrypted_data: number[]; // BLOB
  iv: number[]; // BLOB
  comment: string | null;
  fingerprint: string | null;
  created_at: string;
}

export interface FileBookmark {
  id: string;
  server_id: string;
  name: string;
  remote_path: string;
  sort_order: number;
  created_at: string;
}

export interface TransferHistoryEntry {
  id: string;
  server_id: string;
  direction: "upload" | "download";
  local_path: string;
  remote_path: string;
  file_size: number | null;
  status: "completed" | "failed" | "cancelled";
  error_message: string | null;
  transferred_at: string;
}

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  size_formatted: string;
  kind: "file" | "directory" | "symlink";
  permissions: string;
  owner: string;
  modified_at: string;
  is_hidden: boolean;
}

export const ENVIRONMENT_COLORS: Record<ServerEnvironment, string> = {
  production: "#ef4444",
  staging: "#f59e0b",
  development: "#22c55e",
  other: "#6b7280",
};

export const ENVIRONMENT_LABELS: Record<ServerEnvironment, string> = {
  production: "Production",
  staging: "Staging",
  development: "Development",
  other: "Other",
};

export const DEFAULT_PORTS: Record<ServerProtocol, number> = {
  ssh: 22,
  ftp: 21,
  ftps: 21,
};
