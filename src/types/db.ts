import type { ColumnType, Insertable, Selectable, Updateable } from "kysely";

export interface Database {
  projects: ProjectTable;
  pages: PageTable;
  tasks: TaskTable;
  labels: LabelTable;
  task_labels: TaskLabelTable;
  pomodoro_sessions: PomodoroSessionTable;
  settings: SettingTable;
  project_categories: ProjectCategoryTable;
  server_credentials: ServerCredentialTable;
  pem_keys: PemKeyTable;
  file_bookmarks: FileBookmarkTable;
  transfer_history: TransferHistoryTable;
  credentials: CredentialTable;
  credential_fields: CredentialFieldTable;
  credential_totp: CredentialTotpTable;
  credential_env_vars: CredentialEnvVarTable;
  vault_config: VaultConfigTable;
  api_collections: ApiCollectionTable;
  api_folders: ApiFolderTable;
  api_requests: ApiRequestTable;
  api_environments: ApiEnvironmentTable;
  api_env_variables: ApiEnvVariableTable;
  api_history: ApiHistoryTable;
  api_collection_variables: ApiCollectionVariableTable;
  reminders: ReminderTable;
  saved_commands: SavedCommandTable;
  db_connections: DbConnectionTable;
  db_saved_queries: DbSavedQueryTable;
  db_saved_query_folders: DbSavedQueryFolderTable;
  db_query_history: DbQueryHistoryTable;
  db_er_layouts: DbErLayoutTable;
}

export interface ProjectTable {
  id: string;
  name: string;
  description: ColumnType<string | null, string | null, string | null>;
  content: ColumnType<string | null, string | null, string | null>;
  icon: ColumnType<string | null, string | null, string | null>;
  color: ColumnType<string | null, string | null, string | null>;
  category: ColumnType<string | null, string | null, string | null>;
  status: ColumnType<string, string | undefined, string>;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: string;
  updated_at: string;
}

export interface PageTable {
  id: string;
  project_id: string;
  title: string;
  category: ColumnType<string | null, string | null, string | null>;
  content: ColumnType<string | null, string | null, string | null>;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: string;
  updated_at: string;
}

export interface TaskTable {
  id: string;
  parent_id: ColumnType<string | null, string | null, string | null>;
  project_id: ColumnType<string | null, string | null, string | null>;
  title: string;
  content: ColumnType<string | null, string | null, string | null>;
  status: ColumnType<string, string | undefined, string>;
  priority: ColumnType<string, string | undefined, string>;
  due_date: ColumnType<string | null, string | null, string | null>;
  due_time: ColumnType<string | null, string | null, string | null>;
  estimated_min: ColumnType<number | null, number | null, number | null>;
  sort_order: ColumnType<number, number | undefined, number>;
  depth: ColumnType<number, number | undefined, number>;
  is_starred: ColumnType<number, number | undefined, number>;
  recurrence_rule: ColumnType<string | null, string | null, string | null>;
  recurrence_parent_id: ColumnType<string | null, string | null, string | null>;
  created_at: string;
  updated_at: string;
  completed_at: ColumnType<string | null, string | null, string | null>;
}

export interface LabelTable {
  id: string;
  name: string;
  color: ColumnType<string, string | undefined, string>;
}

export interface TaskLabelTable {
  task_id: string;
  label_id: string;
}

export interface PomodoroSessionTable {
  id: string;
  task_id: ColumnType<string | null, string | null, string | null>;
  daily_plan_id: ColumnType<string | null, string | null, string | null>;
  duration_min: ColumnType<number, number | undefined, number>;
  break_min: ColumnType<number, number | undefined, number>;
  started_at: string;
  ended_at: ColumnType<string | null, string | null, string | null>;
  completed: ColumnType<number, number | undefined, number>;
}

export interface SettingTable {
  key: string;
  value: string;
}

export interface ProjectCategoryTable {
  id: string;
  name: string;
  sort_order: ColumnType<number, number | undefined, number>;
}

export type ProjectCategoryRow = Selectable<ProjectCategoryTable>;

export type NewProject = Insertable<ProjectTable>;
export type ProjectUpdate = Updateable<ProjectTable>;
export type ProjectRow = Selectable<ProjectTable>;

export type NewPage = Insertable<PageTable>;
export type PageUpdate = Updateable<PageTable>;
export type PageRow = Selectable<PageTable>;

export type NewTask = Insertable<TaskTable>;
export type TaskUpdate = Updateable<TaskTable>;
export type TaskRow = Selectable<TaskTable>;

export type NewLabel = Insertable<LabelTable>;
export type LabelRow = Selectable<LabelTable>;

export type NewPomodoroSession = Insertable<PomodoroSessionTable>;
export type PomodoroSessionRow = Selectable<PomodoroSessionTable>;

export interface ServerCredentialTable {
  id: string;
  project_id: ColumnType<string | null, string | null, string | null>;
  name: string;
  environment: ColumnType<string, string | undefined, string>;
  color: ColumnType<string | null, string | null, string | null>;
  protocol: string;
  host: string;
  port: number;
  username: string;
  auth_type: string;
  pem_key_id: ColumnType<string | null, string | null, string | null>;
  pem_file_path: ColumnType<string | null, string | null, string | null>;
  credential_id: ColumnType<string | null, string | null, string | null>;
  initial_directory: ColumnType<string, string | undefined, string>;
  notes_content: ColumnType<string | null, string | null, string | null>;
  last_connected_at: ColumnType<string | null, string | null, string | null>;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: string;
  updated_at: string;
}

export interface PemKeyTable {
  id: string;
  alias: string;
  encrypted_data: unknown; // BLOB
  iv: unknown; // BLOB
  comment: ColumnType<string | null, string | null, string | null>;
  fingerprint: ColumnType<string | null, string | null, string | null>;
  created_at: string;
}

export interface FileBookmarkTable {
  id: string;
  server_id: string;
  name: string;
  remote_path: string;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: string;
}

export interface TransferHistoryTable {
  id: string;
  server_id: string;
  direction: string;
  local_path: string;
  remote_path: string;
  file_size: ColumnType<number | null, number | null, number | null>;
  status: string;
  error_message: ColumnType<string | null, string | null, string | null>;
  transferred_at: string;
}

export type NewServerCredential = Insertable<ServerCredentialTable>;
export type ServerCredentialUpdate = Updateable<ServerCredentialTable>;
export type ServerCredentialRow = Selectable<ServerCredentialTable>;

export type PemKeyRow = Selectable<PemKeyTable>;
export type FileBookmarkRow = Selectable<FileBookmarkTable>;
export type TransferHistoryRow = Selectable<TransferHistoryTable>;

// ─── Credential Manager (Phase 10) ─────────────────────────────────

export interface CredentialTable {
  id: string;
  project_id: ColumnType<string | null, string | null, string | null>;
  type: string;
  name: string;
  username: ColumnType<string | null, string | null, string | null>;
  url: ColumnType<string | null, string | null, string | null>;
  service_name: ColumnType<string | null, string | null, string | null>;
  environment: ColumnType<string, string | undefined, string>;
  tags: ColumnType<string | null, string | null, string | null>;
  expires_at: ColumnType<string | null, string | null, string | null>;
  has_totp: ColumnType<number, number | undefined, number>;
  notes: ColumnType<string | null, string | null, string | null>;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: string;
  updated_at: string;
}

export interface CredentialFieldTable {
  id: string;
  credential_id: string;
  field_key: string;
  field_label: string;
  encrypted_value: ColumnType<unknown | null, unknown | null, unknown | null>;
  iv: ColumnType<unknown | null, unknown | null, unknown | null>;
  plain_value: ColumnType<string | null, string | null, string | null>;
  is_sensitive: ColumnType<number, number | undefined, number>;
  field_order: ColumnType<number, number | undefined, number>;
}

export interface CredentialTotpTable {
  id: string;
  credential_id: string;
  encrypted_secret: unknown;
  iv: unknown;
  digits: ColumnType<number, number | undefined, number>;
  period_seconds: ColumnType<number, number | undefined, number>;
  algorithm: ColumnType<string, string | undefined, string>;
}

export interface CredentialEnvVarTable {
  id: string;
  credential_id: string;
  var_key: string;
  encrypted_value: unknown;
  iv: unknown;
  var_order: ColumnType<number, number | undefined, number>;
}

export interface VaultConfigTable {
  id: string;
  has_master_password: ColumnType<number, number | undefined, number>;
  password_hint: ColumnType<string | null, string | null, string | null>;
  argon2_salt: ColumnType<unknown | null, unknown | null, unknown | null>;
  auto_lock_minutes: ColumnType<number, number | undefined, number>;
  created_at: string;
  updated_at: string;
}

export type NewCredential = Insertable<CredentialTable>;
export type CredentialUpdate = Updateable<CredentialTable>;
export type CredentialRow = Selectable<CredentialTable>;

export type NewCredentialField = Insertable<CredentialFieldTable>;
export type CredentialFieldRow = Selectable<CredentialFieldTable>;

export type NewCredentialTotp = Insertable<CredentialTotpTable>;
export type CredentialTotpRow = Selectable<CredentialTotpTable>;

export type NewCredentialEnvVar = Insertable<CredentialEnvVarTable>;
export type CredentialEnvVarRow = Selectable<CredentialEnvVarTable>;

export type VaultConfigRow = Selectable<VaultConfigTable>;

// ─── REST API Tool (Phase 11) ───────────────────────────────────────

export interface ApiCollectionTable {
  id: string;
  project_id: ColumnType<string | null, string | null, string | null>;
  name: string;
  description: ColumnType<string | null, string | null, string | null>;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: string;
  updated_at: string;
}

export interface ApiFolderTable {
  id: string;
  collection_id: string;
  name: string;
  sort_order: ColumnType<number, number | undefined, number>;
}

export interface ApiRequestTable {
  id: string;
  collection_id: string;
  folder_id: ColumnType<string | null, string | null, string | null>;
  name: string;
  method: ColumnType<string, string | undefined, string>;
  url: ColumnType<string, string | undefined, string>;
  headers: ColumnType<string | null, string | null, string | null>;
  params: ColumnType<string | null, string | null, string | null>;
  body_type: ColumnType<string, string | undefined, string>;
  body_content: ColumnType<string | null, string | null, string | null>;
  auth_type: ColumnType<string, string | undefined, string>;
  auth_config: ColumnType<string | null, string | null, string | null>;
  description: ColumnType<string | null, string | null, string | null>;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: string;
  updated_at: string;
}

export interface ApiEnvironmentTable {
  id: string;
  collection_id: string;
  name: string;
  is_active: ColumnType<number, number | undefined, number>;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: string;
  updated_at: string;
}

export interface ApiEnvVariableTable {
  id: string;
  environment_id: string;
  var_key: string;
  plain_value: ColumnType<string | null, string | null, string | null>;
  credential_id: ColumnType<string | null, string | null, string | null>;
  credential_field: ColumnType<string | null, string | null, string | null>;
  is_secret: ColumnType<number, number | undefined, number>;
  enabled: ColumnType<number, number | undefined, number>;
}

export interface ApiHistoryTable {
  id: string;
  request_id: ColumnType<string | null, string | null, string | null>;
  collection_id: ColumnType<string | null, string | null, string | null>;
  method: string;
  url: string;
  request_headers: ColumnType<string | null, string | null, string | null>;
  request_body: ColumnType<string | null, string | null, string | null>;
  auth_type: ColumnType<string | null, string | null, string | null>;
  status_code: ColumnType<number | null, number | null, number | null>;
  response_headers: ColumnType<string | null, string | null, string | null>;
  response_body: ColumnType<string | null, string | null, string | null>;
  response_size: ColumnType<number | null, number | null, number | null>;
  elapsed_ms: ColumnType<number | null, number | null, number | null>;
  sent_at: string;
}

export type ApiCollectionRow = Selectable<ApiCollectionTable>;
export type ApiFolderRow = Selectable<ApiFolderTable>;
export type ApiRequestRow = Selectable<ApiRequestTable>;
export type ApiEnvironmentRow = Selectable<ApiEnvironmentTable>;
export type ApiEnvVariableRow = Selectable<ApiEnvVariableTable>;
export interface ApiCollectionVariableTable {
  id: string;
  collection_id: string;
  var_key: string;
  plain_value: ColumnType<string | null, string | null, string | null>;
  credential_id: ColumnType<string | null, string | null, string | null>;
  credential_field: ColumnType<string | null, string | null, string | null>;
  is_secret: ColumnType<number, number | undefined, number>;
  enabled: ColumnType<number, number | undefined, number>;
}

export type ApiHistoryRow = Selectable<ApiHistoryTable>;
export type ApiCollectionVariableRow = Selectable<ApiCollectionVariableTable>;

// ─── Reminders (Phase 13.4) ─────────────────────────────────────────

export interface ReminderTable {
  id: string;
  task_id: string;
  remind_at: string;
  is_sent: ColumnType<number, number | undefined, number>;
  created_at: string;
}

export type ReminderRow = Selectable<ReminderTable>;

// ─── Saved Commands (Phase 16) ──────────────────────────────────────

export interface SavedCommandTable {
  id: string;
  server_id: ColumnType<string | null, string | null, string | null>;
  project_id: ColumnType<string | null, string | null, string | null>;
  name: string;
  command: string;
  description: ColumnType<string | null, string | null, string | null>;
  tags: ColumnType<string | null, string | null, string | null>;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: string;
  updated_at: string;
}

export type SavedCommandRow = Selectable<SavedCommandTable>;

// ─── Database Client (Phase 17) ─────────────────────────────────────

export interface DbConnectionTable {
  id: string;
  project_id: ColumnType<string | null, string | null, string | null>;
  name: string;
  engine: string;
  host: ColumnType<string | null, string | null, string | null>;
  port: ColumnType<number | null, number | null, number | null>;
  database_name: ColumnType<string | null, string | null, string | null>;
  username: ColumnType<string | null, string | null, string | null>;
  credential_id: ColumnType<string | null, string | null, string | null>;
  credential_field: ColumnType<string | null, string | null, string | null>;
  use_ssh_tunnel: ColumnType<number, number | undefined, number>;
  ssh_server_id: ColumnType<string | null, string | null, string | null>;
  ssh_local_port: ColumnType<number | null, number | null, number | null>;
  use_ssl: ColumnType<number, number | undefined, number>;
  ssl_mode: ColumnType<string, string | undefined, string>;
  ssl_ca_path: ColumnType<string | null, string | null, string | null>;
  ssl_cert_path: ColumnType<string | null, string | null, string | null>;
  ssl_key_path: ColumnType<string | null, string | null, string | null>;
  sqlite_file_path: ColumnType<string | null, string | null, string | null>;
  color: ColumnType<string, string | undefined, string>;
  last_connected_at: ColumnType<string | null, string | null, string | null>;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: string;
  updated_at: string;
}

export interface DbSavedQueryTable {
  id: string;
  connection_id: ColumnType<string | null, string | null, string | null>;
  folder_id: ColumnType<string | null, string | null, string | null>;
  name: string;
  description: ColumnType<string | null, string | null, string | null>;
  sql_content: string;
  tags: ColumnType<string | null, string | null, string | null>;
  sort_order: ColumnType<number, number | undefined, number>;
  created_at: string;
  updated_at: string;
}

export interface DbSavedQueryFolderTable {
  id: string;
  name: string;
  sort_order: ColumnType<number, number | undefined, number>;
}

export interface DbQueryHistoryTable {
  id: string;
  connection_id: ColumnType<string | null, string | null, string | null>;
  database_name: ColumnType<string | null, string | null, string | null>;
  sql_content: string;
  status: string;
  error_message: ColumnType<string | null, string | null, string | null>;
  rows_affected: ColumnType<number | null, number | null, number | null>;
  duration_ms: ColumnType<number | null, number | null, number | null>;
  executed_at: string;
}

export interface DbErLayoutTable {
  id: string;
  connection_id: string;
  database_name: string;
  layout_data: string;
  updated_at: string;
}

export type NewDbConnection = Insertable<DbConnectionTable>;
export type DbConnectionUpdate = Updateable<DbConnectionTable>;
export type DbConnectionRow = Selectable<DbConnectionTable>;

export type NewDbSavedQuery = Insertable<DbSavedQueryTable>;
export type DbSavedQueryUpdate = Updateable<DbSavedQueryTable>;
export type DbSavedQueryRow = Selectable<DbSavedQueryTable>;

export type DbSavedQueryFolderRow = Selectable<DbSavedQueryFolderTable>;

export type DbQueryHistoryRow = Selectable<DbQueryHistoryTable>;

export type DbErLayoutRow = Selectable<DbErLayoutTable>;
