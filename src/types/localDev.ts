/** Types matching Rust local-dev supervisor / discovery serde shapes. */

export type ServiceKind =
  | { kind: "nginx" }
  | { kind: "php_fpm"; version: string }
  | { kind: "maria_db" }
  | { kind: "my_sql" }
  | { kind: "redis" }
  | { kind: "dns_masq" };

export type ServiceStatus =
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
  kind: ServiceKind;
  status: ServiceStatus;
  binary_path: string | null;
  binary_present: boolean;
  pid_file: string;
  log_file: string;
  auto_restart: boolean;
  notes: string[];
}

export interface ServiceActionResult {
  service_id: string;
  status: ServiceStatus;
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

export function serviceStatusKind(status: ServiceStatus): ServiceStatus["status"] {
  return status.status;
}

export function isServiceRunning(status: ServiceStatus): boolean {
  return status.status === "running";
}

export function isServiceBusy(status: ServiceStatus): boolean {
  return status.status === "starting" || status.status === "stopping";
}

export function serviceStatusLabel(status: ServiceStatus): string {
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

export function serviceStatusDetail(status: ServiceStatus): string | null {
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

/** DNS degraded when dnsmasq is present but not cleanly running. */
export function isDnsDegraded(services: ServiceStatusReport[]): boolean {
  const dns = services.find((s) => s.id === "dnsmasq");
  if (!dns) return false;
  if (dns.status.status === "unavailable") return false; // binary missing — not "degraded"
  return dns.status.status !== "running";
}
