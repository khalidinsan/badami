// Domain types for Local Dev module (Badami-owned runtime orchestrator)

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

export type BinarySource = "homebrew" | "manual" | "system" | "other";

/** Roles Badami can own outright, matching `runtime_manifest::ROLES`. */
export type RuntimeRole = "nginx" | "php" | "mariadb" | "redis" | "dnsmasq";

/** One provisioned binary under `runtime/<role>/<version>/`. */
export interface RuntimeComponent {
  role: RuntimeRole | string;
  version: string;
  /** Absolute path to the primary executable. */
  binary: string;
  /** Lowercase hex SHA-256 of `binary` at install time. */
  sha256: string;
  source: string;
  arch: string;
  installed_at: string;
  selected: boolean;
}

export interface RuntimeManifest {
  schema: number;
  updated_at: string;
  components: RuntimeComponent[];
}

/** What `ld_provision_plan` proposes to install into Badami's runtime tree. */
export interface ProvisionItem {
  role: string;
  version: string;
  source: string;
  source_root: string;
  binary_rel: string;
  needs_relink: boolean;
  display_name: string;
}

export interface ProvisionOutcome {
  role: string;
  version: string;
  ok: boolean;
  error: string | null;
}

export interface ProvisionReport {
  outcomes: ProvisionOutcome[];
  manifest: RuntimeManifest;
  notes: string[];
}

export interface InstalledVersion {
  version: string;
  selected: boolean;
  /** False when the file is missing or its digest no longer matches. */
  verified: boolean;
  binary: string;
}

export interface RoleStatus {
  role: string;
  installed: InstalledVersion[];
  missing_reason: string | null;
}

export interface ProvisionStatus {
  manifest: RuntimeManifest;
  roles: RoleStatus[];
  notes: string[];
}

/** Progress payload emitted while a migration or provisioning run is active. */
export interface ProvisionProgressEvent {
  phase: string;
  message: string;
  at: string;
}

export interface MigrationPreflight {
  source: string;
  dest: string;
  source_bytes: number;
  dest_free_bytes: number;
  /** True when the volume supports APFS copy-on-write clones. */
  can_clone: boolean;
  /** The source datadir is currently served by a running server. */
  source_running: boolean;
  dest_exists: boolean;
  blockers: string[];
  warnings: string[];
}

export interface MigrationResult {
  ok: boolean;
  dest: string;
  /** Which copy strategy actually ran: clone or full copy. */
  method: string;
  cloned: boolean;
  bytes: number;
  elapsed_ms: number;
  verified_files: number;
  failed_files: string[];
  notes: string[];
}

export type ArchiveKind = "TarGz" | "Zip" | "RawBinary";

/** One upstream the binary updater can install from. */
export interface UpdateSource {
  id: string;
  label: string;
  role: string;
  url: string;
  version: string;
  archive: ArchiveKind;
  /** Null means the upstream publishes no digest, so the download is unverified. */
  sha256: string | null;
  note: string;
}

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

export type MariaDbDatadirPolicy = "copy" | "fresh";

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
  mariadb_datadir_policy: "copy",
  bootstrap_complete: "false",
  dns_bootstrap_complete: "false",
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

// ── Problems (`ld_log_problems`) ────────────────────────────────────

export type ProblemLevel = "error" | "warn";

export interface ProblemLine {
  level: ProblemLevel;
  text: string;
}

export interface ServiceProblems {
  service_id: string;
  label: string;
  log_file: string;
  /** Lines examined for this service (tail window, not the whole file). */
  scanned: number;
  /** Newest last, capped per service. */
  problems: ProblemLine[];
  errors: number;
  warnings: number;
}

/**
 * Cross-service error scan.
 *
 * Grouped per service rather than merged into one stream: nginx, PHP-FPM and
 * MariaDB timestamp differently, so interleaving them without parsing each
 * format would present an ordering that is simply wrong.
 */
export interface ProblemsReport {
  services: ServiceProblems[];
  total_errors: number;
  total_warnings: number;
  notes: string[];
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
  /** Badami-owned binaries — `runtime/<role>/<version>/`. */
  runtime: string;
  /** Badami-owned service data (MariaDB datadir). */
  data: string;
  /** Per-version php.ini scan dirs — `config/php/<tag>/`. */
  php_config: string;
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

/** Badami's own provisioned binaries. */
export interface BadamiRuntimeInventory {
  root: string;
  detected: boolean;
  components: RuntimeComponent[];
  nginx_binary: string | null;
  dnsmasq_binary: string | null;
  php_versions: PhpVersionInfo[];
  mariadb_binary: string | null;
  /** Version dir of the MariaDB runtime, usable as a `basedir`. */
  mariadb_basedir: string | null;
  redis_server: string | null;
  /** Set once the datadir has been moved into Badami's own tree. */
  data_dir: string | null;
  datadir_adopted: boolean;
}

/** Discovery report from `ld_discover` (serde snake_case). */
export interface DiscoveryReport {
  platform: string;
  arch: string;
  runtime_paths: RuntimePaths;
  resolver: ResolverInfo;
  notes: string[];
  badami: BadamiRuntimeInventory;
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

// ── Runtime resources and generated configs ─────────────────────────

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
  /** HTTPS port used for secured sites (Phase B TLS). Mode A default is 8443. */
  https_port: number;
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
  /** Port used in the emitted URL when the site is secured on disk. */
  https_port: number | null;
  /**
   * True when the site conf has `BADAMI_SECURED=1` and both leaf cert files
   * exist on disk. The URL already reflects this; the flag is exposed so UI
   * can e.g. render a padlock without re-parsing the URL string.
   */
  secured: boolean;
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

/** Stable display name for the auto-registered local MariaDB connection. */
export const LOCAL_DEV_MARIADB_CONNECTION_NAME = "Local MariaDB (Badami)";

/** Result of `ld_probe_mariadb_auth` (registration stays in TS). */
export interface MariadbAuthProbe {
  ok: boolean;
  needs_password: boolean;
  message: string;
  host: string;
  port: number;
  tcp_accepting: boolean;
  socket_accepting: boolean;
}

export interface MariadbAuthProbeRequest {
  host?: string | null;
  port?: number | null;
  username?: string | null;
  password?: string | null;
  socket?: string | null;
  skip_live?: boolean | null;
}

/** Result of TS registration (`createConnection` + optional keychain). */
export interface RegisterMariaDbResult {
  connectionId: string;
  created: boolean;
  passwordSaved: boolean;
  needsPassword: boolean;
  message: string;
}

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
  launchd_dnsmasq: LaunchdUnitInfo;
  launchd_nginx: LaunchdUnitInfo;
  ready_for_mariadb_start: boolean;
  dns_healthy: boolean;
  notes: string[];
}

// ── Bootstrap (`ld_bootstrap_*`) ────────────────────────────────────

export type BootstrapPackageId =
  | "dns_only"
  | "dns_high_port"
  | "http_80"
  | "full"
  /**
   * Re-copy user-side nginx + dnsmasq config into the Mode B root staging dir
   * and reload the LaunchDaemons. Needed after isolate/secure writes config in
   * the user tree that root-staged nginx otherwise never sees.
   */
  | "resync";

/** Uninstall package ids accepted by `ld_bootstrap_uninstall`. */
export type BootstrapUninstallPackageId =
  | "dns_only"
  | "http_80"
  | "full"
  /** Only the `/etc/resolver/<tld>` file (gated by `# managed-by: badami`). */
  | "resolver";

export interface BootstrapInstallRequest {
  package: BootstrapPackageId | string;
  dry_run?: boolean | null;
  tld?: string | null;
  loopback?: string | null;
  dns_port?: number | null;
  nginx_binary?: string | null;
  dnsmasq_binary?: string | null;
  attempt_privileged_install?: boolean | null;
  /**
   * Reverse-DNS identifier used to compose LaunchDaemon labels. Must match
   * `^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$`. Falls back to
   * `com.khalid.badami` when omitted. The Tauri wrapper (`ld_bootstrap_install`)
   * normally derives this from `AppHandle::config().identifier` — only pass
   * a value explicitly in tests or when forcing a specific bundle id.
   */
  identifier?: string | null;
}

export interface BootstrapUnitScaffold {
  label: string;
  role: string;
  scaffold_plist: string;
  system_plist_target: string;
  program_arguments: string[];
  /**
   * Final root-owned staging dir the LaunchDaemon reads binaries + configs
   * from. Rendered by the Rust hardening pass; display-only.
   */
  root_staging_dir: string;
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

export interface BootstrapUninstallRequest {
  package: BootstrapUninstallPackageId | string;
  /**
   * Delete `/etc/resolver/<tld>` even without the `# managed-by: badami`
   * marker. Default `false` — the resolver file is left alone unless the
   * user explicitly ticks the opt-in checkbox.
   */
  confirm_resolver?: boolean | null;
  /** When true (default): emit `steps` but execute nothing. */
  dry_run?: boolean | null;
  tld?: string | null;
  /**
   * Reverse-DNS identifier used to compose LaunchDaemon labels. Must match
   * `^[A-Za-z0-9][A-Za-z0-9.-]{0,127}$`. Falls back to
   * `com.khalid.badami` when omitted; `ld_bootstrap_uninstall` normally
   * derives this from `AppHandle::config().identifier`.
   */
  identifier?: string | null;
}

export interface BootstrapUninstallResult {
  package: string;
  dry_run: boolean;
  executed: boolean;
  /** Each step is the exact argv rendered shell-quoted — safe to display. */
  steps: string[];
  notes: string[];
  install_command: string | null;
  labels: string[];
}

export interface BootstrapStatus {
  dnsmasq: LaunchdUnitInfo;
  nginx: LaunchdUnitInfo;
  resolver_path: string;
  resolver_present: boolean;
  /** Raw `port` line from the resolver file; null means the file omits it. */
  resolver_port: number | null;
  /**
   * True when `/etc/resolver/<tld>` carries the `# managed-by: badami`
   * marker — gates automatic resolver removal in `ld_bootstrap_uninstall`.
   */
  resolver_marker_present: boolean;
  dns_bootstrap_complete: boolean;
  /** Unit installed **and** nginx actually configured for :80. */
  http_bootstrap_complete: boolean;
  /** Port nginx is configured to listen on, read from the generated conf. */
  nginx_listen_port: number;
  /** Port `dnsmasq.conf` binds. */
  dnsmasq_conf_port: number;
  /** Port macOS queries for `*.tld` — 53 when the resolver file omits `port`. */
  resolver_effective_port: number;
  /** Resolver file and dnsmasq.conf disagree, so nothing can ever resolve. */
  dns_port_mismatch: boolean;
  /** Next package Rust suggests for the user. */
  recommended_package: string;
  notes: string[];
  /** Scaffold directory under local-dev. */
  launchd_dir: string;
  /**
   * Fixed root-owned staging prefix — `/Library/Application Support/Badami
   * /local-dev-root`. Everything a LaunchDaemon reads at runtime lives under
   * `<root_staging_prefix>/<role>/`.
   */
  root_staging_prefix: string;
}

// ── DNS setup state (one chip, not a daily toggle) ──────────────────

/**
 * What DNS needs from the user right now.
 *
 * DNS is install-time infrastructure: a resolver file plus a permanently
 * running dnsmasq, set up once and never toggled. `dnsmasq` daemonizes, so it
 * already outlives the app, which is why a Start/Stop pair misrepresents it.
 */
export type DnsSetupState =
  | { kind: "healthy"; mode: DnsMode | DoctorDnsMode | null }
  /** Something already answers on the resolver's port — adopt it, no setup. */
  | { kind: "adopted" }
  /** Resolver file and dnsmasq.conf name different ports. Fixable, no admin. */
  | { kind: "port_mismatch"; resolverPort: number; confPort: number }
  /** Config agrees; dnsmasq simply is not running. */
  | { kind: "not_running" }
  /** No `/etc/resolver/<tld>`; writing one needs one admin prompt. */
  | { kind: "no_resolver"; resolverPath: string }
  | { kind: "no_binary" }
  | { kind: "unknown" };

export interface DnsSetupInput {
  services: ServiceStatusReport[];
  bootstrap: BootstrapStatus | null;
  /** Live resolve probe (`ld_dns_probe`) — cheaper than a full doctor run. */
  probe: DnsProbeResult | null;
}

/**
 * Collapse DNS into a single state with one obvious next action.
 *
 * Order matters. A live resolve probe outranks every static signal, because it
 * is the only thing that proves resolution works. A port mismatch is checked
 * before "not running", since starting dnsmasq on the wrong port looks like
 * success and still resolves nothing.
 */
export function computeDnsSetup({
  services,
  bootstrap,
  probe,
}: DnsSetupInput): DnsSetupState {
  const dns = services.find((s) => s.id === "dnsmasq");
  const ourDnsRunning = !!dns && isServiceRunning(dns.status);

  if (probe?.healthy) {
    // Resolving without a dnsmasq of ours means an existing listener serves the
    // TLD. Nothing to set up.
    return ourDnsRunning ? { kind: "healthy", mode: probe.mode } : { kind: "adopted" };
  }

  if (dns && !dns.binary_present) return { kind: "no_binary" };

  if (bootstrap) {
    if (!bootstrap.resolver_present) {
      return { kind: "no_resolver", resolverPath: bootstrap.resolver_path };
    }
    if (bootstrap.dns_port_mismatch) {
      return {
        kind: "port_mismatch",
        resolverPort: bootstrap.resolver_effective_port,
        confPort: bootstrap.dnsmasq_conf_port,
      };
    }
  }

  if (!ourDnsRunning) return { kind: "not_running" };
  return { kind: "unknown" };
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

/** Short status word without the pid noise (pid belongs in a tooltip). */
export function serviceStatusShort(status: RuntimeServiceStatus): string {
  switch (status.status) {
    case "running":
      return "Running";
    case "starting":
      return "Starting…";
    case "stopping":
      return "Stopping…";
    case "stopped":
      return "Stopped";
    case "unhealthy":
      return "Unhealthy";
    case "error":
      return "Error";
    case "unavailable":
      return "Unavailable";
  }
}

export function servicePid(status: RuntimeServiceStatus): number | null {
  if (status.status === "running") return status.pid;
  if (status.status === "unhealthy") return status.pid ?? null;
  return null;
}

// ── Service groups (dependency-based, not alphabetical) ─────────────
//
// web  — nginx + php-fpm: must move together. nginx without FPM = 502 on every
//        request, a state the UI must not be able to create.
// data — MariaDB + Redis: independent lifecycle. You often want the DB up while
//        the web tier is down (migrations, TablePlus, dumps).
// dns  — dnsmasq: shared infra, set up once, failure is degraded-not-fatal.
//        Never a peer of redis in a card grid.

export type ServiceGroupId = "web" | "data" | "dns";

export function isPhpFpmId(id: string): boolean {
  return id.startsWith("php-fpm-");
}

export function serviceGroupOf(service: ServiceStatusReport): ServiceGroupId {
  if (service.id === "dnsmasq" || service.kind.kind === "dns_masq") return "dns";
  if (service.id === "nginx" || service.kind.kind === "nginx") return "web";
  if (service.kind.kind === "php_fpm" || isPhpFpmId(service.id)) return "web";
  return "data";
}

/** PHP version a php-fpm service serves, e.g. `php-fpm-8.4` → `8.4`. */
export function phpVersionOf(service: ServiceStatusReport): string | null {
  if (service.kind.kind === "php_fpm") return service.kind.version;
  if (isPhpFpmId(service.id)) return service.id.slice("php-fpm-".length);
  return null;
}

export interface RequiredServicesInput {
  services: ServiceStatusReport[];
  /** Sites from `ld_list_sites` — isolated sites pin extra PHP versions. */
  sites?: SiteInfo[];
  /** `default_php_version` setting; the catch-all server needs this pool. */
  defaultPhpVersion?: string | null;
  /**
   * Live resolve probe. Without it, "DNS degraded" can only be guessed from the
   * dnsmasq process status — which is wrong whenever another listener serves the
   * TLD, or whenever a cached spec probes a stale port.
   */
  dnsProbe?: DnsProbeResult | null;
  bootstrap?: BootstrapStatus | null;
}

/**
 * Service ids the stack is expected to be running.
 *
 * Deliberately **not** "every discovered service". A runtime tree can keep 6-8
 * PHP versions around; counting all of them makes a perfectly healthy stack
 * report "3/9 running" forever. Per group:
 *
 * * **web** — nginx plus only the FPM pools something references (the default
 *   catch-all version and any isolated site's version).
 * * **data / dns** — every member whose binary exists; there is no narrower
 *   signal, and `ld_stack_start` already starts them unconditionally.
 *
 * A service whose binary is missing is never expected — it reports
 * `Unavailable` instead of dragging the count down.
 */
export function requiredServiceIds({
  services,
  sites = [],
  defaultPhpVersion,
}: RequiredServicesInput): Set<string> {
  const required = new Set<string>();

  const nginx = services.find((s) => serviceGroupOf(s) === "web" && s.kind.kind === "nginx");
  if (nginx?.binary_present) required.add(nginx.id);

  const wantedVersions = new Set<string>();
  if (defaultPhpVersion) wantedVersions.add(defaultPhpVersion);
  for (const site of sites) {
    if (site.isolated && site.php_version) wantedVersions.add(site.php_version);
  }

  const fpm = services.filter((s) => phpVersionOf(s) != null);
  for (const service of fpm) {
    const version = phpVersionOf(service);
    if (version && wantedVersions.has(version) && service.binary_present) {
      required.add(service.id);
    }
  }
  // No FPM matched (e.g. default version not discovered) — fall back to any
  // single present pool so "web" is never required-nginx-only, which would
  // report Serving while every request 502s.
  if (fpm.length > 0 && !fpm.some((s) => required.has(s.id))) {
    const fallback = fpm.find((s) => s.binary_present);
    if (fallback) required.add(fallback.id);
  }

  // Data and DNS: expected whenever the binary exists.
  //
  // Unlike PHP pools there is no per-site signal to narrow these down, and
  // `ld_stack_start` already starts mariadb, redis and dnsmasq unconditionally —
  // so this matches what "Start all" does rather than inventing a second rule.
  // Omitting them is what left the Data group at 0 expected services, which
  // disabled its Start button permanently.
  for (const service of services) {
    const group = serviceGroupOf(service);
    if ((group === "data" || group === "dns") && service.binary_present) {
      required.add(service.id);
    }
  }

  return required;
}

export interface GroupSummary {
  group: ServiceGroupId;
  members: ServiceStatusReport[];
  /** Required members (subset of `members`). */
  required: ServiceStatusReport[];
  requiredTotal: number;
  requiredRunning: number;
  /** Running members that are not required (extra PHP pools the user started). */
  extraRunning: number;
  /** Required members that are not running, by label. */
  missing: string[];
  transitional: boolean;
  /** Every required member running. False when `requiredTotal === 0`. */
  healthy: boolean;
  /** Any member in a terminal bad state. */
  faulted: boolean;
}

export function groupSummary(
  group: ServiceGroupId,
  services: ServiceStatusReport[],
  required: Set<string>,
): GroupSummary {
  const members = services.filter((s) => serviceGroupOf(s) === group);
  const requiredMembers = members.filter((s) => required.has(s.id));
  const requiredRunning = requiredMembers.filter((s) => isServiceRunning(s.status)).length;
  return {
    group,
    members,
    required: requiredMembers,
    requiredTotal: requiredMembers.length,
    requiredRunning,
    extraRunning: members.filter(
      (s) => isServiceRunning(s.status) && !required.has(s.id),
    ).length,
    missing: requiredMembers
      .filter((s) => !isServiceRunning(s.status))
      .map((s) => s.label),
    transitional: members.some((s) => isServiceBusy(s.status)),
    healthy: requiredMembers.length > 0 && requiredRunning === requiredMembers.length,
    faulted: members.some(
      (s) => s.status.status === "error" || s.status.status === "unhealthy",
    ),
  };
}

// ── Aggregate stack health (one hero state, not 9 badges) ───────────

export type StackPhase =
  | "stopped"
  | "starting"
  | "stopping"
  | "serving"
  | "partial"
  | "broken";

export interface StackHealth {
  phase: StackPhase;
  /** Headline, e.g. "Serving · DNS degraded". */
  label: string;
  /** One-line explanation of what is wrong, or what is being served. */
  detail: string | null;
  dnsDegraded: boolean;
  web: GroupSummary;
  data: GroupSummary;
  dns: GroupSummary;
  requiredIds: Set<string>;
}

/**
 * Collapse per-service status into a single state a human can act on.
 *
 * Only the **web** group decides whether the stack is "serving" — MariaDB and
 * Redis are tracked but do not gate it, and DNS is a degradation, never a
 * failure (mirrors `ld_stack_start`, where dnsmasq failure does not set
 * `partial_failure`).
 */
export function computeStackHealth(input: RequiredServicesInput): StackHealth {
  const { services, dnsProbe, bootstrap } = input;
  const requiredIds = requiredServiceIds(input);
  const web = groupSummary("web", services, requiredIds);
  const data = groupSummary("data", services, requiredIds);
  const dns = groupSummary("dns", services, requiredIds);
  // Resolution is the capability; which process provides it is irrelevant here.
  // Fall back to the process heuristic only until the first probe lands.
  const dnsSetup = computeDnsSetup({
    services,
    bootstrap: bootstrap ?? null,
    probe: dnsProbe ?? null,
  });
  const dnsDegraded = dnsProbe
    ? dnsSetup.kind !== "healthy" && dnsSetup.kind !== "adopted"
    : isDnsDegraded(services);

  const base = { dnsDegraded, web, data, dns, requiredIds };
  const dnsSuffix = dnsDegraded ? " · DNS degraded" : "";

  if (web.requiredTotal === 0) {
    const nginx = services.find((s) => s.kind.kind === "nginx");
    return {
      ...base,
      phase: "broken",
      label: "Not configured",
      detail:
        nginx && !nginx.binary_present
          ? "nginx binary not found. Set it in Settings or add a runtime version"
          : "No web services discovered. Add a runtime version, then generate configs.",
    };
  }

  if (web.transitional) {
    const stopping = web.members.some((s) => s.status.status === "stopping");
    return {
      ...base,
      phase: stopping ? "stopping" : "starting",
      label: stopping ? "Stopping…" : "Starting…",
      detail: null,
    };
  }

  if (web.requiredRunning === 0) {
    const faultDetail = web.members
      .map((s) => serviceStatusDetail(s.status))
      .find((d): d is string => !!d);
    return {
      ...base,
      phase: web.faulted ? "broken" : "stopped",
      label: web.faulted ? "Broken" : "Stopped",
      detail: web.faulted ? faultDetail ?? "A web service is in a bad state" : null,
    };
  }

  if (web.healthy) {
    return {
      ...base,
      phase: "serving",
      label: `Serving${dnsSuffix}`,
      detail: dnsDegraded
        ? "Reachable on the loopback URL; *.test hostnames may not resolve"
        : null,
    };
  }

  return {
    ...base,
    phase: "partial",
    label: `Partial${dnsSuffix}`,
    detail: `${web.missing.join(", ")} not running — requests will fail`,
  };
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

// ── TLS (Phase B — `ld_tls_*`, `ld_secure`, `ld_unsecure`) ─────────

/** One entry per site that currently has a BADAMI-issued leaf cert on disk. */
export interface SecuredSite {
  name: string;
  tld: string;
  cert_path: string;
  key_path: string;
}

/**
 * Snapshot from `ld_tls_status`. The CA presence check is fast (file stat);
 * the trust check (`security find-certificate …`) is skipped in tests via
 * `skip_live=true`.
 */
export interface TlsStatus {
  ca_exists: boolean;
  ca_trusted: boolean;
  ca_cert_path: string | null;
  ca_key_path: string | null;
  ca_common_name: string;
  secured_sites: SecuredSite[];
  notes: string[];
}

/** Returned by `ld_tls_trust_ca` — argv surface for the `security` command. */
export interface TrustCaResult {
  ca_cert_path: string | null;
  /** The exact argv passed to `security add-trusted-cert`. Safe to display. */
  argv: string[];
  /** `argv` rendered single-line with shell quoting. */
  step: string;
  /** osascript body that wraps `argv` for the admin prompt. */
  install_command: string | null;
  executed: boolean;
  notes: string[];
}

/** Returned by `ld_secure` / `ld_unsecure`. */
export interface SecureSiteCommandResult {
  site: string;
  tld: string;
  /** `"secured"` | `"unsecured"` | `"noop"` (unsecure of already-plain site). */
  action: string;
  secured: boolean;
  cert_path: string | null;
  key_path: string | null;
  conf_path: string | null;
  written: string[];
  notes: string[];
}

// ── Supervisor live events (`ld://…`) ──────────────────────────────

/**
 * Event names emitted by the supervisor health loop. These must stay in sync
 * with the `EVENT_*` constants in
 * `src-tauri/src/commands/local_dev/supervisor.rs`.
 */
export const LD_EVENT = {
  serviceStatus: "ld://service-status",
  serviceCrashed: "ld://service-crashed",
  serviceRestarted: "ld://service-restarted",
  serviceRestartFailed: "ld://service-restart-failed",
  serviceRateLimited: "ld://service-rate-limited",
  mariadbCrashed: "ld://mariadb-crashed",
} as const;

/** `ServiceStatus["status"]` variant tag, as sent on the wire. */
export type ServiceStatusVariant = RuntimeServiceStatus["status"];

/** Payload of `ld://service-status` — status transition for any one service. */
export interface ServiceStatusEvent {
  service_id: string;
  from: ServiceStatusVariant;
  to: ServiceStatusVariant;
  pid: number | null;
  reason: string;
  at: string;
  level: EventLevel;
  message: string;
}

/** Payload of `ld://service-crashed`. */
export interface ServiceCrashedEvent {
  service_id: string;
  from: ServiceStatusVariant;
  to: ServiceStatusVariant;
  pid: number | null;
  reason: string;
  at: string;
  level: EventLevel;
  message: string;
  log_file: string;
}

/** Payload of `ld://service-restarted` after an auto-restart succeeded. */
export interface ServiceRestartedEvent {
  service_id: string;
  level: EventLevel;
  status: ServiceStatusVariant;
  pid: number | null;
  message: string;
  notes: string[];
  at: string;
}

/** Payload of `ld://service-restart-failed`. */
export interface ServiceRestartFailedEvent {
  service_id: string;
  level: EventLevel;
  message: string;
  status: ServiceStatusVariant;
  at: string;
}

/** Payload of `ld://service-rate-limited`. */
export interface ServiceRateLimitedEvent {
  service_id: string;
  level: EventLevel;
  message: string;
  at: string;
}

/** Payload of `ld://mariadb-crashed` — dedicated so the frontend can OS-notify. */
export interface MariaDbCrashedEvent {
  service_id: string;
  level: EventLevel;
  title: string;
  message: string;
  log_file: string;
  at: string;
}

/** Payload of per-service `ld://log/{service_id}` subscription frames. */
export interface LogStreamFrame {
  subscription_id: string;
  service_id: string;
  /** Appended lines since the last frame. */
  lines?: string[];
  /** Set when the file was truncated / rotated. Clears the view. */
  reset?: boolean;
  /** Error path — a filesystem error from the tail task. */
  error?: string;
  at: string;
}

/** Return value of `ld_log_subscribe`. */
export interface LogSubscribeResult {
  subscription_id: string;
  service_id: string;
  /** Topic the frontend must `listen()` on — equals `ld://log/{service_id}`. */
  topic: string;
  log_file: string;
}
