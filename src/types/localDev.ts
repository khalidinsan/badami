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

/** Minimal discovery fields used by the Local Dev UI (full report is larger). */
export interface DiscoveryReport {
  platform: string;
  arch: string;
  runtime_paths: RuntimePaths;
  resolver: ResolverInfo;
  notes: string[];
  herd: {
    detected: boolean;
    app_path: string | null;
    home_path: string | null;
    dnsmasq_binary: string | null;
    nginx_binary: string | null;
  };
  ports_in_use: Array<{
    port: number;
    listening: boolean;
    pid: number | null;
    process: string | null;
  }>;
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
