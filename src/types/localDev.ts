// Domain types for Local Dev module (Herd-replacement orchestrator)

export type LocalDevServiceKind =
  | "nginx"
  | "php_fpm"
  | "mariadb"
  | "mysql"
  | "redis"
  | "dnsmasq";

export type SiteKind = "parked" | "linked";

export type BinaryRole =
  | "nginx"
  | "php"
  | "php_fpm"
  | "mariadb"
  | "mysql"
  | "redis"
  | "dnsmasq";

export type BinarySource = "herd" | "homebrew" | "manual" | "system" | "other";

export type HttpMode = "unprivileged" | "privileged_launchd";

export type DnsMode =
  | "auto"
  | "adopt"
  | "badami_dnsmasq_53"
  | "high_port"
  | "degraded";

export type LocalDevServiceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "unhealthy"
  | "stopping"
  | "error";

export type EventLevel = "info" | "warn" | "error" | "debug";

export type MariaDbDatadirPolicy = "reuse_herd" | "copy" | "fresh";

/** Keys stored in local_dev_settings (module config only). */
export type LocalDevSettingKey =
  | "tld"
  | "loopback"
  | "http_port"
  | "http_mode"
  | "dns_mode"
  | "dns_port"
  | "default_php_version"
  | "adopt_existing_processes"
  | "mariadb_datadir_policy"
  | "bootstrap_complete"
  | "dns_bootstrap_complete"
  | "herd_import_path"
  | "mariadb_connection_id";

/** Feature flag lives only in global settings (Key Decision 25). */
export const LOCAL_DEV_ENABLED_SETTING_KEY = "local_dev_enabled" as const;

export const DEFAULT_LOCAL_DEV_SETTINGS: Record<LocalDevSettingKey, string> = {
  tld: "test",
  loopback: "127.0.0.1",
  http_port: "8080",
  http_mode: "unprivileged",
  dns_mode: "auto",
  dns_port: "53",
  default_php_version: "8.4",
  adopt_existing_processes: "true",
  mariadb_datadir_policy: "reuse_herd",
  bootstrap_complete: "false",
  dns_bootstrap_complete: "false",
  herd_import_path: "",
  mariadb_connection_id: "",
};

export interface ServiceStatusDto {
  id: string;
  kind: LocalDevServiceKind;
  displayName: string;
  status: LocalDevServiceStatus;
  pid?: number;
  port?: number;
  socketPath?: string;
  version?: string;
  lastError?: string;
  healthDetail?: string;
  readyToStart?: boolean;
}

export interface SiteDto {
  id?: string;
  name: string;
  tld: string;
  url: string;
  path: string;
  kind: SiteKind;
  phpVersion: string | null;
  secured: boolean;
  driver?: string;
  projectId?: string | null;
}


export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  nginx: "Nginx",
  php_fpm: "PHP-FPM",
  mariadb: "MariaDB",
  mysql: "MySQL",
  redis: "Redis",
  dnsmasq: "Dnsmasq",
};

/** @deprecated alias — prefer LocalDevServiceKind for DB rows */
export type ServiceKind = LocalDevServiceKind;
/** DB telemetry status string union */
export type ServiceStatusDb = LocalDevServiceStatus;


// ── Runtime / supervisor DTOs (from Rust serde) ───────────────────

/** Types matching Rust local-dev supervisor / discovery serde shapes. */

export type RuntimeServiceKind =
  | { kind: "nginx" }
  | { kind: "php_fpm"; version: string }
  | { kind: "maria_db" }
  | { kind: "my_sql" }
  | { kind: "redis" }
  | { kind: "dns_masq" };

export type RuntimeServiceStatus =
  | { status: "stopped" }
  | { status: "starting" }
  | { status: "running"; pid: number }
  | { status: "unhealthy"; pid?: number | null; reason: string }
  | { status: "stopping" }
  | { status: "error"; message: string }
  | { status: "unavailable"; reason: string };

export interface ServiceStatusReport {
  id: string;
  label: string;
  kind: RuntimeServiceKind;
  status: RuntimeServiceStatus;
  binary_path: string | null;
  binary_present: boolean;
  pid_file: string;
  log_file: string;
  auto_restart: boolean;
  notes: string[];
}

export interface ServiceActionResult {
  service_id: string;
  status: RuntimeServiceStatus;
  message: string;
  notes: string[];
}

export interface StackActionResult {
  results: ServiceActionResult[];
  notes: string[];
  partial_failure: boolean;
}

export interface LogTailResult {
  service_id: string;
  path: string;
  lines: string[];
  truncated: boolean;
  rotated: boolean;
}

export interface RuntimePaths {
  local_dev_root: string;
  config_valet: string;
  nginx: string;
  fpm: string;
  socks: string;
  mariadb: string;
  valet_server: string;
  pids: string;
  logs: string;
  import: string;
}

export interface ResolverInfo {
  path: string;
  present: boolean;
  content: string | null;
}

export interface MariadbCandidate {
  path: string;
  uuid: string;
  bytes: number;
  score: number;
  has_ibdata1: boolean;
  has_mysql_schema: boolean;
  my_cnf?: {
    path?: string;
    datadir?: string | null;
    basedir?: string | null;
    socket?: string | null;
    port?: number | null;
  } | null;
  modified_secs_ago?: number | null;
}

export interface PhpVersionInfo {
  version: string;
  tag: string;
  available: boolean;
  reason?: string | null;
  cli_path?: string | null;
  fpm_path?: string | null;
  fpm_conf_path?: string | null;
}

export interface HerdInventory {
  detected: boolean;
  app_path: string | null;
  home_path: string | null;
  config_path?: string | null;
  bin_path?: string | null;
  shared_services_path?: string | null;
  resources_path?: string | null;
  privileged_helper_present?: boolean;
  privileged_helper_path?: string;
  mariadb_candidates: MariadbCandidate[];
  park_paths: string[];
  php_versions: PhpVersionInfo[];
  nginx_binary: string | null;
  dnsmasq_binary: string | null;
  server_php?: string | null;
  valet?: {
    config_path?: string | null;
    tld?: string | null;
    loopback?: string | null;
    paths?: string[];
  } | null;
}

/** Discovery report from `ld_discover` (serde snake_case). */
export interface DiscoveryReport {
  platform: string;
  arch: string;
  runtime_paths: RuntimePaths;
  resolver: ResolverInfo;
  notes: string[];
  herd: HerdInventory;
  candidates?: Array<{
    role: string;
    path: string;
    version?: string | null;
    source: string;
  }>;
  ports_in_use: Array<{
    port: number;
    listening: boolean;
    pid: number | null;
    process: string | null;
  }>;
}

// ── Import (`ld_import_herd`) ───────────────────────────────────────

export interface ImportHerdRequest {
  install_resources?: boolean | null;
  generate_configs?: boolean | null;
  write_isolated_sites?: boolean | null;
  http_port?: number | null;
  default_php_version?: string | null;
  dry_run?: boolean | null;
}

export interface ImportedPark {
  path: string;
  sources: string[];
  exists: boolean;
}

export interface ImportedSite {
  name: string;
  tld: string;
  path: string;
  kind: string;
  php_version: string | null;
  isolated: boolean;
  skipped: boolean;
  skip_reason: string | null;
  source_conf: string | null;
  conf_written: boolean;
}

export interface ImportedBinary {
  role: string;
  path: string;
  version: string | null;
  source: string;
  is_selected: boolean;
}

export interface ImportedService {
  kind: string;
  display_name: string;
  enabled: boolean;
  data_dir: string | null;
  config_path: string | null;
  port: number | null;
  socket_path: string | null;
  binary_path: string | null;
  extra_json: unknown | null;
}

export interface ImportSettingsSuggestion {
  tld: string;
  loopback: string;
  http_port: number;
  default_php_version: string;
  mariadb_datadir_policy: string;
  herd_import_path: string;
}

export interface InstallResourcesResult {
  local_dev_root: string;
  source: string;
  copied_files: number;
  created_dirs: string[];
  notes: string[];
}

export interface GenerateConfigsResult {
  local_dev_root: string;
  written: string[];
  notes: string[];
}

export interface ImportResult {
  herd_detected: boolean;
  snapshot_path: string;
  parks: ImportedPark[];
  sites: ImportedSite[];
  binaries: ImportedBinary[];
  services: ImportedService[];
  settings: ImportSettingsSuggestion;
  selected_mariadb: MariadbCandidate | null;
  php_versions: PhpVersionInfo[];
  resources: InstallResourcesResult | null;
  configs: GenerateConfigsResult | null;
  notes: string[];
  warnings: string[];
  services_started: boolean;
  herd_processes_killed: boolean;
  mariadb_datadir_copied: boolean;
}

// ── Sites (`ld_list_sites`, park/link/isolate) ──────────────────────

export interface SiteInfo {
  name: string;
  tld: string;
  url: string;
  path: string;
  kind: string;
  php_version: string | null;
  isolated: boolean;
  secured: boolean;
  conf_path: string | null;
  park_path: string | null;
}

export interface ListSitesResult {
  sites: SiteInfo[];
  park_paths: string[];
  tld: string;
  loopback: string;
  http_port: number;
  notes: string[];
}

export interface ParkResult {
  park_paths: string[];
  path: string;
  action: string;
  written: string[];
  notes: string[];
}

export interface LinkResult {
  site: string;
  path: string;
  link_path: string;
  action: string;
  notes: string[];
}

export interface IsolateResult {
  site: string;
  php_version: string | null;
  conf_path: string | null;
  action: string;
  written: string[];
  notes: string[];
  refused: boolean;
}

export interface OpenSiteUrlResult {
  site: string;
  tld: string;
  http_port: number;
  url: string;
}

export interface ReloadNginxResult {
  ok: boolean;
  test_ok: boolean;
  reloaded: boolean;
  binary: string | null;
  conf: string | null;
  stdout: string;
  stderr: string;
  notes: string[];
}

// ── Doctor (`ld_doctor`) ────────────────────────────────────────────

export type FindingSeverity = "info" | "warn" | "error";

export interface DoctorFinding {
  id: string;
  severity: FindingSeverity;
  category: string;
  message: string;
  hint?: string | null;
}

export type DoctorDnsMode = "d0_adopt" | "d1_b_lite" | "d2_high_port" | "d3_degraded";

export interface DnsProbeResult {
  hostname: string;
  tld: string;
  expected_loopback: string;
  resolved: string[];
  healthy: boolean;
  resolver_path: string;
  resolver_present: boolean;
  resolver_port: number;
  port_53_listening: boolean;
  mode: DoctorDnsMode;
  error?: string | null;
  notes: string[];
}

export interface BinaryCheck {
  role: string;
  service_id: string;
  path: string | null;
  present: boolean;
}

export interface PortCheck {
  port: number;
  label: string;
  listening: boolean;
  note?: string | null;
}

export type MariadbPreflight =
  | { kind: "ok_to_start" }
  | { kind: "adopt"; pid?: number | null; reason: string }
  | { kind: "hard_fail"; reason: string };

export interface MariadbPreflightReport {
  result: MariadbPreflight;
  wrapper_mycnf: string | null;
  datadir: string | null;
  basedir: string | null;
  socket: string | null;
  port: number | null;
  checks: string[];
  ready_for_mariadb_start: boolean;
}

export interface LaunchdUnitInfo {
  label: string;
  scaffold_path: string | null;
  scaffold_present: boolean;
  system_plist_path: string;
  system_plist_present: boolean;
  loaded: boolean;
}

export interface DoctorReport {
  findings: DoctorFinding[];
  overall: string;
  dns: DnsProbeResult;
  binaries: BinaryCheck[];
  ports: PortCheck[];
  mariadb: MariadbPreflightReport;
  fpm_sockets: Array<{
    path: string;
    exists: boolean;
    accepting: boolean;
    php_tag: string | null;
  }>;
  fpm_chdir: Array<{
    conf_path: string;
    has_chdir: boolean;
    chdir_value: string | null;
    expected_valet_server: string;
    ok: boolean;
  }>;
  nginx_test: {
    ran: boolean;
    ok: boolean;
    conf_path: string | null;
    binary: string | null;
    stdout: string;
    stderr: string;
    skip_reason?: string | null;
  };
  logs: {
    logs_dir: string;
    total_bytes: number;
    total_warn: boolean;
    large_files: Array<{ path: string; bytes: number; warn: boolean }>;
  };
  herd_helper: {
    path: string;
    present: boolean;
    launch_daemon_label: string;
    note: string;
  };
  launchd_dnsmasq: LaunchdUnitInfo;
  launchd_nginx: LaunchdUnitInfo;
  ready_for_mariadb_start: boolean;
  dns_healthy: boolean;
  notes: string[];
}

// ── Bootstrap (`ld_bootstrap_*`) ────────────────────────────────────

export type BootstrapPackageId = "dns_only" | "dns_high_port" | "http_80" | "full";

export interface BootstrapInstallRequest {
  package: BootstrapPackageId | string;
  dry_run?: boolean | null;
  tld?: string | null;
  loopback?: string | null;
  dns_port?: number | null;
  nginx_binary?: string | null;
  dnsmasq_binary?: string | null;
  attempt_privileged_install?: boolean | null;
}

export interface BootstrapUnitScaffold {
  label: string;
  role: string;
  scaffold_plist: string;
  system_plist_target: string;
  program_arguments: string[];
}

export interface BootstrapInstallResult {
  package: string;
  dry_run: boolean;
  privileged_attempted: boolean;
  privileged_ok: boolean;
  written: string[];
  install_instructions: string[];
  install_command: string | null;
  notes: string[];
  units: BootstrapUnitScaffold[];
}

export interface BootstrapStatus {
  dnsmasq: LaunchdUnitInfo;
  nginx: LaunchdUnitInfo;
  resolver_path: string;
  resolver_present: boolean;
  resolver_port: number | null;
  dns_bootstrap_complete: boolean;
  http_bootstrap_complete: boolean;
  recommended_package: string;
  notes: string[];
  launchd_dir: string;
}

/** Format bytes for UI (datadir size, logs). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = -1;
  do {
    v /= 1024;
    i += 1;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function serviceStatusKind(status: RuntimeServiceStatus): RuntimeServiceStatus["status"] {
  return status.status;
}

export function isServiceRunning(status: RuntimeServiceStatus): boolean {
  return status.status === "running";
}

export function isServiceBusy(status: RuntimeServiceStatus): boolean {
  return status.status === "starting" || status.status === "stopping";
}

export function serviceStatusLabel(status: RuntimeServiceStatus): string {
  switch (status.status) {
    case "stopped":
      return "Stopped";
    case "starting":
      return "Starting…";
    case "running":
      return `Running · pid ${status.pid}`;
    case "unhealthy":
      return "Unhealthy";
    case "stopping":
      return "Stopping…";
    case "error":
      return "Error";
    case "unavailable":
      return "Unavailable";
  }
}

export function serviceStatusDetail(status: RuntimeServiceStatus): string | null {
  switch (status.status) {
    case "unhealthy":
      return status.reason;
    case "error":
      return status.message;
    case "unavailable":
      return status.reason;
    default:
      return null;
  }
}

/**
 * DNS degraded when dnsmasq is present but in a terminal bad state.
 * Excludes transitional starting/stopping (avoids banner flash during stack start).
 */
export function isDnsDegraded(services: ServiceStatusReport[]): boolean {
  const dns = services.find((s) => s.id === "dnsmasq");
  if (!dns) return false;
  switch (dns.status.status) {
    case "stopped":
    case "unhealthy":
    case "error":
      return true;
    default:
      // running | starting | stopping | unavailable — not "degraded" for the banner
      return false;
  }
}

/** Alias used by UI components (tagged union from supervisor) */
export type ServiceStatus = RuntimeServiceStatus;
