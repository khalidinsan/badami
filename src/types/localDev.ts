// Domain types for Local Dev module (Herd-replacement orchestrator)

export type ServiceKind =
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

export type ServiceStatus =
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
  kind: ServiceKind;
  displayName: string;
  status: ServiceStatus;
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

export interface DiscoveryReport {
  platform: "macos" | "windows" | "linux";
  arch: string;
  herd: {
    detected: boolean;
    appPath?: string;
    configPath?: string;
    privilegedHelperPresent?: boolean;
    mariadbCandidates: Array<{ path: string; bytes: number; score: number }>;
    parkPaths: string[];
    phpVersions: Array<{ version: string; available: boolean; reason?: string }>;
  };
  candidates: Array<{
    role: string;
    path: string;
    version?: string;
    source: string;
  }>;
  portsInUse: Array<{ port: number; pid?: number; process?: string }>;
}

export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  nginx: "Nginx",
  php_fpm: "PHP-FPM",
  mariadb: "MariaDB",
  mysql: "MySQL",
  redis: "Redis",
  dnsmasq: "Dnsmasq",
};
