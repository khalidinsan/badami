import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type {
  BootstrapInstallRequest,
  BootstrapInstallResult,
  BootstrapStatus,
  DiscoveryReport,
  DnsProbeResult,
  DoctorReport,
  GenerateConfigsResult,
  HerdQuitResult,
  HerdRuntimeStatus,
  ImportHerdRequest,
  ImportResult,
  InstallResourcesResult,
  IsolateResult,
  LinkResult,
  ListSitesResult,
  LogTailResult,
  OpenSiteUrlResult,
  ParkResult,
  ProblemsReport,
  ReloadNginxResult,
  RegisterMariaDbResult,
  ServiceGroupId,
  ServiceStatusReport,
  StackActionResult,
  StackHealth,
  ServiceActionResult,
  LocalDevSettingKey,
  BinaryRole,
  BinarySource,
  LocalDevServiceKind,
  SiteKind,
  SiteInfo,
} from "@/types/localDev";
import {
  computeStackHealth,
  DEFAULT_LOCAL_DEV_SETTINGS,
  isServiceRunning,
  serviceGroupOf,
} from "@/types/localDev";
import {
  createBinary,
  createParkPath,
  createService,
  createSite,
  getAllLocalDevSettings,
  getBinaries,
  getLocalDevSettings,
  getParkPaths,
  getServiceByKind,
  getSiteByNameTld,
  getSitesByProject,
  selectBinary,
  setLocalDevSetting,
  updateService,
  updateSite,
} from "@/db/queries/localDev";
import { registerLocalMariaDbConnection } from "@/lib/localDevMariaDb";
import { openInOS } from "@/lib/osOpen";
import type { LocalDevSiteRow } from "@/types/db";

const POLL_MS = 2500;

/** Doctor is expensive (port probes + `nginx -t`) — reuse a recent report. */
const DOCTOR_TTL_MS = 60_000;

/** Keys for `siteBusy` — scoped so one action never disables the whole table. */
export const SITE_ACTION_PARK = "park";
export const SITE_ACTION_LINK = "link";
export const SITE_ACTION_NGINX = "nginx";
export function siteActionKey(site: string): string {
  return `site:${site}`;
}
export function parkActionKey(path: string): string {
  return `park:${path}`;
}

interface LocalDevState {
  services: ServiceStatusReport[];
  discovery: DiscoveryReport | null;
  sitesResult: ListSitesResult | null;
  importResult: ImportResult | null;
  doctorReport: DoctorReport | null;
  /** `Date.now()` of the last successful doctor run (for TTL + "ran Xm ago"). */
  doctorRanAt: number | null;
  bootstrapStatus: BootstrapStatus | null;
  bootstrapResult: BootstrapInstallResult | null;
  herdStatus: HerdRuntimeStatus | null;
  /** Live DNS resolve probe — the only proof that `*.tld` actually resolves. */
  dnsProbe: DnsProbeResult | null;
  settings: Record<string, string>;
  stackBusy: boolean;
  /** Service ids currently starting/stopping via UI action */
  serviceBusy: Record<string, boolean>;
  /** Groups (web/data/dns) with a group-level action in flight. */
  groupBusy: Partial<Record<ServiceGroupId, boolean>>;
  /** True only while the site list itself is being fetched. */
  sitesLoading: boolean;
  /** Per-action busy map — see `siteActionKey` / `parkActionKey`. */
  siteBusy: Record<string, boolean>;
  importBusy: boolean;
  doctorBusy: boolean;
  bootstrapBusy: boolean;
  settingsBusy: boolean;
  registerBusy: boolean;
  herdBusy: boolean;
  fixBusy: Record<string, boolean>;
  loading: boolean;
  error: string | null;
  selectedServiceId: string | null;
  logTail: LogTailResult | null;
  logLoading: boolean;
  /** Log pane expanded. Lives here so failed actions can reveal it. */
  logsOpen: boolean;
  /** Auto-tail while the pane is open. */
  logFollow: boolean;
  /** `tail` = one service's log; `problems` = errors across all of them. */
  logMode: "tail" | "problems";
  problemsReport: ProblemsReport | null;
  problemsLoading: boolean;

  setSelectedServiceId: (id: string | null) => void;
  setLogsOpen: (open: boolean) => void;
  setLogFollow: (follow: boolean) => void;
  setLogMode: (mode: "tail" | "problems") => void;
  fetchProblems: () => Promise<void>;
  /**
   * Point the log pane at a service and open it.
   *
   * Called on every failed service action: the toast can only carry a couple of
   * truncated notes, while the actual reason sits in a log file the user would
   * otherwise have to go hunting for.
   */
  revealServiceLog: (serviceId: string) => void;
  refreshStatus: () => Promise<void>;
  discover: () => Promise<void>;
  startService: (serviceId: string) => Promise<void>;
  stopService: (serviceId: string) => Promise<void>;
  restartService: (serviceId: string) => Promise<void>;
  startGroup: (group: ServiceGroupId) => Promise<void>;
  stopGroup: (group: ServiceGroupId) => Promise<void>;
  restartGroup: (group: ServiceGroupId) => Promise<void>;
  startStack: () => Promise<void>;
  stopStack: () => Promise<void>;
  fetchLogs: (serviceId: string, lines?: number) => Promise<void>;

  // Herd coexistence
  loadHerdStatus: () => Promise<void>;
  quitHerd: () => Promise<HerdQuitResult | null>;

  /**
   * Rebuild backend service specs from config on disk.
   *
   * Mandatory after writing any config: specs are cached for the app's lifetime,
   * so a changed port stays invisible to the status poller until this runs.
   */
  refreshSpecs: () => Promise<void>;
  /** Resolve a random `*.tld` label and record the result. */
  probeDns: () => Promise<void>;
  /** Rewrite dnsmasq.conf on the port the resolver file already names, then start it. */
  fixDnsPortMismatch: () => Promise<void>;
  /**
   * Switch the whole HTTP tier to a port, end to end.
   *
   * 80 needs a LaunchDaemon (macOS blocks unprivileged binds below 1024); 8080
   * is the unprivileged default.
   */
  applyHttpPort: (port: number) => Promise<void>;

  // Doctor fix actions
  generateConfigs: () => Promise<void>;
  installRuntimeResources: () => Promise<void>;
  revealLogsDir: () => Promise<void>;

  // Sites
  listSites: () => Promise<void>;
  parkPath: (path: string) => Promise<void>;
  unparkPath: (path: string) => Promise<void>;
  linkSite: (site: string, path: string) => Promise<void>;
  unlinkSite: (site: string) => Promise<void>;
  isolatePhp: (site: string, version: string) => Promise<void>;
  unisolatePhp: (site: string) => Promise<void>;
  openSiteUrl: (site: string) => Promise<void>;
  reloadNginx: () => Promise<void>;

  // Import
  importHerd: (request?: ImportHerdRequest) => Promise<ImportResult | null>;
  persistImportResult: (result: ImportResult) => Promise<void>;

  // Doctor / bootstrap
  runDoctor: (options?: { force?: boolean }) => Promise<void>;
  loadBootstrapStatus: (tld?: string) => Promise<void>;
  bootstrapInstall: (request: BootstrapInstallRequest) => Promise<void>;

  // Settings
  loadSettings: () => Promise<void>;
  saveSetting: (key: LocalDevSettingKey, value: string) => Promise<void>;

  // MariaDB → Database module registration
  registerMariaDb: (password?: string) => Promise<RegisterMariaDbResult | null>;

  // Site ↔ project link (local_dev_sites.project_id)
  linkSiteToProject: (
    site: SiteInfo,
    projectId: string | null,
  ) => Promise<LocalDevSiteRow | null>;
  getProjectSites: (projectId: string) => Promise<LocalDevSiteRow[]>;
}

function serviceLabel(serviceId: string): string {
  return (
    useLocalDevStore.getState().services.find((s) => s.id === serviceId)?.label ?? serviceId
  );
}

/**
 * Default log source.
 *
 * Was `services[0]`, which is whatever `build_specs_from_discovery` pushes
 * first — dnsmasq. That is arbitrary, and since dnsmasq moved to the infra strip
 * it is not even in the service grid. nginx is the honest default: every request
 * enters through it, so its error log is where a broken site shows up first.
 */
function defaultLogService(services: ServiceStatusReport[]): string | null {
  const nginx = services.find((s) => s.kind.kind === "nginx" || s.id === "nginx");
  if (nginx) return nginx.id;
  return services[0]?.id ?? null;
}

function applyServices(services: ServiceStatusReport[]) {
  const prev = useLocalDevStore.getState().selectedServiceId;
  const selectedStillValid = prev != null && services.some((s) => s.id === prev);
  const selectedServiceId = selectedStillValid ? prev : defaultLogService(services);
  return {
    services,
    selectedServiceId,
    error: null as string | null,
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useLocalDevStore = create<LocalDevState>((set, get) => ({
  services: [],
  discovery: null,
  sitesResult: null,
  importResult: null,
  doctorReport: null,
  doctorRanAt: null,
  bootstrapStatus: null,
  bootstrapResult: null,
  herdStatus: null,
  dnsProbe: null,
  settings: {},
  stackBusy: false,
  serviceBusy: {},
  groupBusy: {},
  sitesLoading: false,
  siteBusy: {},
  importBusy: false,
  doctorBusy: false,
  bootstrapBusy: false,
  settingsBusy: false,
  registerBusy: false,
  herdBusy: false,
  fixBusy: {},
  loading: false,
  error: null,
  selectedServiceId: null,
  logTail: null,
  logLoading: false,
  logsOpen: false,
  logFollow: true,
  logMode: "tail",
  problemsReport: null,
  problemsLoading: false,

  setSelectedServiceId: (id) => set({ selectedServiceId: id }),
  setLogsOpen: (open) => set({ logsOpen: open }),
  setLogFollow: (follow) => set({ logFollow: follow }),
  setLogMode: (mode) => set({ logMode: mode }),

  fetchProblems: async () => {
    set({ problemsLoading: true });
    try {
      const problemsReport = await invoke<ProblemsReport>("ld_log_problems", {
        scanLines: 400,
        maxPerService: 20,
      });
      set({ problemsReport, problemsLoading: false });
    } catch (err) {
      set({ problemsLoading: false });
      toast.error("Could not scan logs", { description: errMessage(err) });
    }
  },

  revealServiceLog: (serviceId) => {
    // Force `tail`: the caller wants this service's log, and leaving the pane in
    // Problems mode would show a cross-service scan instead.
    set({ selectedServiceId: serviceId, logsOpen: true, logMode: "tail" });
    void get().fetchLogs(serviceId);
  },

  refreshStatus: async () => {
    try {
      const services = await invoke<ServiceStatusReport[]>("ld_service_status", {
        serviceId: null,
      });
      set(applyServices(services));
    } catch (err) {
      set({ error: errMessage(err) });
    }
  },

  discover: async () => {
    set({ loading: true });
    try {
      const discovery = await invoke<DiscoveryReport>("ld_discover");
      set({ discovery, loading: false, error: null });
    } catch (err) {
      const message = errMessage(err);
      console.error(err);
      set({ loading: false, error: message });
      toast.error("Discovery failed", { description: message });
    }
  },

  startService: async (serviceId) => {
    const label = serviceLabel(serviceId);
    // Ignore double-clicks while this service (or stack) is busy.
    if (get().serviceBusy[serviceId] || get().stackBusy) return;
    set((s) => ({
      serviceBusy: { ...s.serviceBusy, [serviceId]: true },
    }));
    try {
      const result = await invoke<ServiceActionResult>("ld_service_start", {
        serviceId,
      });
      if (result.status.status === "error" || result.status.status === "unavailable") {
        toast.error(`Failed to start ${label}`, {
          description: result.message || serviceStatusMsg(result.status),
        });
        get().revealServiceLog(serviceId);
      } else if (result.message?.includes("already running")) {
        toast.success(`${label} already running`);
      } else {
        toast.success(`${label} started`);
      }
      await get().refreshStatus();
    } catch (err) {
      toast.error(`Failed to start ${label}`, { description: errMessage(err) });
      get().revealServiceLog(serviceId);
      // Always refresh so card leaves a stale "stopped" if process actually started.
      await get().refreshStatus().catch(() => undefined);
    } finally {
      set((s) => {
        const next = { ...s.serviceBusy };
        delete next[serviceId];
        return { serviceBusy: next };
      });
    }
  },

  stopService: async (serviceId) => {
    const label = serviceLabel(serviceId);
    if (get().serviceBusy[serviceId] || get().stackBusy) return;
    set((s) => ({
      serviceBusy: { ...s.serviceBusy, [serviceId]: true },
    }));
    try {
      const result = await invoke<ServiceActionResult>("ld_service_stop", {
        serviceId,
      });
      if (result.status.status === "error") {
        toast.error(`Failed to stop ${label}`, {
          description: result.message || serviceStatusMsg(result.status),
        });
        get().revealServiceLog(serviceId);
      } else if (result.status.status === "unhealthy") {
        // After refresh we may still flip to stopped — avoid scaring the user.
        toast.message(`${label}: ${result.message || "stop incomplete"}`, {
          description: result.notes?.slice(0, 2).join(" · ") || undefined,
        });
      } else if (
        result.status.status === "stopped" ||
        result.message?.includes("already stopped")
      ) {
        toast.success(`${label} stopped`);
      } else {
        toast.success(`${label} stopped`);
      }
      await get().refreshStatus();
    } catch (err) {
      toast.error(`Failed to stop ${label}`, { description: errMessage(err) });
      await get().refreshStatus().catch(() => undefined);
    } finally {
      set((s) => {
        const next = { ...s.serviceBusy };
        delete next[serviceId];
        return { serviceBusy: next };
      });
    }
  },

  /**
   * Restart a single service — the action a dev actually reaches for after
   * editing php.ini or an nginx conf. `ld_service_restart` already sequenced
   * stop → settle → start in Rust; this just wires it up.
   */
  restartService: async (serviceId) => {
    const label = serviceLabel(serviceId);
    if (get().serviceBusy[serviceId] || get().stackBusy) return;
    set((s) => ({ serviceBusy: { ...s.serviceBusy, [serviceId]: true } }));
    try {
      const result = await invoke<ServiceActionResult>("ld_service_restart", {
        serviceId,
      });
      if (result.status.status === "error" || result.status.status === "unavailable") {
        toast.error(`Failed to restart ${label}`, {
          description: result.message || serviceStatusMsg(result.status),
        });
        get().revealServiceLog(serviceId);
      } else {
        toast.success(`${label} restarted`);
      }
      await get().refreshStatus();
    } catch (err) {
      toast.error(`Failed to restart ${label}`, { description: errMessage(err) });
      get().revealServiceLog(serviceId);
      await get().refreshStatus().catch(() => undefined);
    } finally {
      set((s) => {
        const next = { ...s.serviceBusy };
        delete next[serviceId];
        return { serviceBusy: next };
      });
    }
  },

  /**
   * Start every required member of a group, in dependency order.
   *
   * For `web` that means all required FPM pools **before** nginx: nginx up
   * without a pool answers 502 on every request, so the group is the smallest
   * unit worth exposing as a control.
   */
  startGroup: async (group) => {
    await runGroupAction(set, get, group, "start");
  },

  /** Stop every *running* member — including non-required extras, so "Stop" leaves nothing behind. */
  stopGroup: async (group) => {
    await runGroupAction(set, get, group, "stop");
  },

  restartGroup: async (group) => {
    await runGroupAction(set, get, group, "restart");
  },

  startStack: async () => {
    set({ stackBusy: true });
    try {
      const result = await invoke<StackActionResult>("ld_stack_start");
      if (result.partial_failure) {
        toast.warning("Stack started with partial failures", {
          description: result.notes.slice(0, 3).join(" · ") || undefined,
        });
        // dnsmasq is best-effort in ld_stack_start and never sets
        // partial_failure, so the first bad result here is a real failure.
        const culprit = result.results.find(
          (r) => r.status.status === "error" || r.status.status === "unavailable",
        );
        if (culprit) get().revealServiceLog(culprit.service_id);
      } else {
        toast.success("Local Dev stack started");
      }
      await get().refreshStatus();
    } catch (err) {
      toast.error("Stack start failed", { description: errMessage(err) });
    } finally {
      set({ stackBusy: false });
    }
  },

  stopStack: async () => {
    set({ stackBusy: true });
    try {
      const result = await invoke<StackActionResult>("ld_stack_stop");
      if (result.partial_failure) {
        toast.warning("Stack stop completed with errors", {
          description: result.notes.slice(0, 3).join(" · ") || undefined,
        });
      } else {
        toast.success("Local Dev stack stopped");
      }
      await get().refreshStatus();
    } catch (err) {
      toast.error("Stack stop failed", { description: errMessage(err) });
    } finally {
      set({ stackBusy: false });
    }
  },

  fetchLogs: async (serviceId, lines = 200) => {
    set({ logLoading: true });
    try {
      const logTail = await invoke<LogTailResult>("ld_log_tail", {
        serviceId,
        lines,
      });
      set({ logTail, logLoading: false });
    } catch (err) {
      set({ logLoading: false });
      toast.error("Failed to load logs", { description: errMessage(err) });
    }
  },

  // ── Herd coexistence ───────────────────────────────────────────────

  /** Read-only Herd process scan. Silent on failure — this is background info. */
  loadHerdStatus: async () => {
    try {
      const herdStatus = await invoke<HerdRuntimeStatus>("ld_herd_status");
      set({ herdStatus });
    } catch (err) {
      console.error("ld_herd_status failed", err);
    }
  },

  /**
   * Ask Herd.app to quit so Badami can take the ports and datadir.
   *
   * Graceful only — Rust sends an AppleScript quit and never signals Herd's
   * service processes, so Herd shuts its own mysqld down cleanly. A non-empty
   * `remaining` is a "you still need to act" result, not an error.
   */
  quitHerd: async () => {
    set({ herdBusy: true });
    try {
      const result = await invoke<HerdQuitResult>("ld_herd_quit");
      if (!result.requested) {
        toast.message("Herd.app was not running", {
          description: result.remaining.length
            ? `${result.remaining.length} Herd service process(es) still alive — stop them from Herd`
            : "Nothing to quit",
        });
      } else if (result.remaining.length === 0 && !result.app_running_after) {
        toast.success("Herd stopped — ports released");
      } else {
        toast.warning("Herd did not fully stop", {
          description: result.notes.slice(0, 2).join(" · ") || undefined,
        });
      }
      await get().loadHerdStatus();
      await get().refreshStatus().catch(() => undefined);
      return result;
    } catch (err) {
      toast.error("Could not quit Herd", { description: errMessage(err) });
      return null;
    } finally {
      set({ herdBusy: false });
    }
  },

  refreshSpecs: async () => {
    try {
      const services = await invoke<ServiceStatusReport[]>("ld_refresh_specs");
      set(applyServices(services));
    } catch (err) {
      // Fall back to a plain status read so the UI is never left blank.
      console.error("ld_refresh_specs failed", err);
      await get().refreshStatus();
    }
  },

  // ── DNS state + repair ─────────────────────────────────────────────

  /**
   * Live resolve probe. Silent on failure — the returned report already carries
   * `healthy: false`, and this runs on tab activation as background state.
   */
  probeDns: async () => {
    try {
      const settings = get().settings;
      const dnsProbe = await invoke<DnsProbeResult>("ld_dns_probe", {
        tld: settings.tld || get().sitesResult?.tld || null,
        loopback: settings.loopback || get().sitesResult?.loopback || null,
      });
      set({ dnsProbe });
    } catch (err) {
      console.error("ld_dns_probe failed", err);
    }
  },

  /**
   * Repair the port disagreement between `/etc/resolver/<tld>` and dnsmasq.conf.
   *
   * The resolver file is the side we must not touch — rewriting it needs root,
   * and macOS already reads it. So dnsmasq moves to match it. Only dnsmasq.conf
   * is rewritten (`ld_generate_dnsmasq_conf`), never nginx or FPM: repairing DNS
   * must not re-emit unrelated config behind the user's back.
   */
  fixDnsPortMismatch: async () => {
    if (get().fixBusy.dns) return;
    set((s) => ({ fixBusy: { ...s.fixBusy, dns: true } }));
    try {
      await get().loadBootstrapStatus();
      const bootstrap = get().bootstrapStatus;
      if (!bootstrap) throw new Error("could not read bootstrap status");
      if (!bootstrap.resolver_present) {
        toast.error("No resolver file", {
          description: `${bootstrap.resolver_path} is missing — run DNS setup first`,
        });
        return;
      }

      const port = bootstrap.resolver_effective_port;
      if (port < 1024) {
        // :53 cannot be bound unprivileged, so matching it means a LaunchDaemon
        // rather than a conf rewrite. Say so instead of writing a conf that
        // will fail to start.
        toast.error(`Resolver points at privileged port ${port}`, {
          description:
            "Binding it needs the DNS LaunchDaemon (Settings → bootstrap), not a config change",
        });
        return;
      }

      const settings = get().settings;
      const result = await invoke<GenerateConfigsResult>("ld_generate_dnsmasq_conf", {
        tld: settings.tld || get().sitesResult?.tld || null,
        loopback: settings.loopback || get().sitesResult?.loopback || null,
        dnsPort: port,
      });
      toast.success(`dnsmasq.conf now binds :${port}`, {
        description: result.written.join(" · ") || undefined,
      });

      // Before touching the service: the cached spec still holds the old port,
      // so its health probe would target a port nothing listens on and report a
      // perfectly good dnsmasq as stopped.
      await get().refreshSpecs();

      // Restart rather than start: a dnsmasq left over on the old port would
      // keep its socket and silently keep failing to answer.
      const dns = get().services.find((s) => s.id === "dnsmasq");
      if (dns && isServiceRunning(dns.status)) {
        await get().restartService("dnsmasq");
      } else {
        await get().startService("dnsmasq");
      }
      await get().probeDns();
      await get().loadBootstrapStatus();
      await get().runDoctor({ force: true });
    } catch (err) {
      toast.error("DNS repair failed", { description: errMessage(err) });
    } finally {
      set((s) => {
        const next = { ...s.fixBusy };
        delete next.dns;
        return { fixBusy: next };
      });
    }
  },

  // ── HTTP port switch (Mode A :8080 ↔ Mode B :80) ───────────────────

  applyHttpPort: async (port) => {
    if (get().fixBusy.httpPort) return;
    set((s) => ({ fixBusy: { ...s.fixBusy, httpPort: true } }));
    try {
      const settings = get().settings;
      const discovery = get().discovery;
      const sites = get().sitesResult;
      const tld = settings.tld || sites?.tld || DEFAULT_LOCAL_DEV_SETTINGS.tld;
      const loopback =
        settings.loopback || sites?.loopback || DEFAULT_LOCAL_DEV_SETTINGS.loopback;

      // 1. Persist intent, so regenerated config and displayed URLs agree.
      await setLocalDevSetting("http_port", String(port));
      await setLocalDevSetting("http_mode", port === 80 ? "privileged_launchd" : "unprivileged");
      set((s) => ({
        settings: {
          ...s.settings,
          http_port: String(port),
          http_mode: port === 80 ? "privileged_launchd" : "unprivileged",
        },
      }));

      // 2. Base config. `nginx_as_root` derives from the port in Rust, so the
      // one value is enough.
      const phpTags = (discovery?.herd.php_versions ?? [])
        .filter((v) => v.available)
        .map((v) => v.tag);
      const defaultVersion =
        settings.default_php_version || DEFAULT_LOCAL_DEV_SETTINGS.default_php_version;
      // Bootstrap status first: it carries the DNS port we must preserve.
      await get().loadBootstrapStatus(tld);
      await invoke<GenerateConfigsResult>("ld_generate_configs", {
        request: {
          tld,
          loopback,
          http_port: port,
          park_paths: sites?.park_paths ?? null,
          default_php_tag: defaultVersion.replace(".", "") || null,
          php_tags: phpTags.length > 0 ? phpTags : null,
          dns_port: effectiveDnsPort(get()),
        },
      });

      // 3. Every isolated site carries its own `listen` line, and
      // `ld_generate_configs` does not touch them. Skipping this is what made
      // a port switch leave isolated sites stranded on the old port.
      const isolated = (sites?.sites ?? []).filter((s) => s.isolated && s.php_version);
      const siteFailures: string[] = [];
      for (const site of isolated) {
        try {
          await invoke<GenerateConfigsResult>("ld_generate_isolated_site", {
            request: {
              site_name: site.name,
              tld: site.tld || tld,
              php_version: site.php_version,
              php_tag: (site.php_version ?? "").replace(".", ""),
              http_port: port,
            },
          });
        } catch (err) {
          siteFailures.push(`${site.name}: ${errMessage(err)}`);
        }
      }

      if (siteFailures.length > 0) {
        toast.warning(`${siteFailures.length} isolated site conf(s) not updated`, {
          description: siteFailures.slice(0, 2).join(" · "),
        });
      }

      // nginx's listen port changed, so the cached spec's health probe is now
      // pointed at the wrong port.
      await get().refreshSpecs();

      // 4. Report honestly which of the two remaining steps the user still owes.
      await get().loadBootstrapStatus(tld);
      const bootstrap = get().bootstrapStatus;
      const unitReady = port !== 80 || !!bootstrap?.nginx.loaded || !!bootstrap?.nginx.system_plist_present;

      toast.success(`HTTP config rewritten for :${port}`, {
        description:
          isolated.length > 0
            ? `${isolated.length} isolated site conf(s) updated`
            : "base config updated",
      });

      if (port === 80 && !unitReady) {
        toast.warning("nginx LaunchDaemon not installed", {
          description:
            "Settings → Mode B / DNS bootstrap → package http_80 → Install with admin. Until then :80 asks for a password on every start.",
        });
      }

      // 5. Restart nginx so the new listen port takes effect.
      const nginx = get().services.find((s) => s.id === "nginx");
      if (nginx && isServiceRunning(nginx.status)) {
        await get().restartService("nginx");
      }
      await get().listSites();
      await get().runDoctor({ force: true });
    } catch (err) {
      toast.error("HTTP port switch failed", { description: errMessage(err) });
    } finally {
      set((s) => {
        const next = { ...s.fixBusy };
        delete next.httpPort;
        return { fixBusy: next };
      });
    }
  },

  // ── Doctor fix actions (turn hints into buttons) ───────────────────

  generateConfigs: async () => {
    if (get().fixBusy.configs) return;
    set((s) => ({ fixBusy: { ...s.fixBusy, configs: true } }));
    try {
      const settings = get().settings;
      const sites = get().sitesResult;
      const discovery = get().discovery;
      const phpTags = (discovery?.herd.php_versions ?? [])
        .filter((v) => v.available)
        .map((v) => v.tag);
      const defaultVersion =
        settings.default_php_version || DEFAULT_LOCAL_DEV_SETTINGS.default_php_version;
      await get().loadBootstrapStatus(settings.tld || undefined);
      const result = await invoke<GenerateConfigsResult>("ld_generate_configs", {
        request: {
          tld: settings.tld || sites?.tld || null,
          loopback: settings.loopback || sites?.loopback || null,
          // The generated conf is the truth about the current port; the setting
          // may be an intent that was never applied.
          http_port:
            get().bootstrapStatus?.nginx_listen_port ||
            Number(settings.http_port || sites?.http_port || 8080),
          park_paths: sites?.park_paths ?? null,
          default_php_tag: defaultVersion.replace(".", "") || null,
          php_tags: phpTags.length > 0 ? phpTags : null,
          dns_port: effectiveDnsPort(get()),
        },
      });
      toast.success("Configs regenerated", {
        description: `${result.written.length} file(s) written · reload nginx to apply`,
      });
      await get().refreshSpecs();
      await get().runDoctor({ force: true });
    } catch (err) {
      toast.error("Generate configs failed", { description: errMessage(err) });
    } finally {
      set((s) => {
        const next = { ...s.fixBusy };
        delete next.configs;
        return { fixBusy: next };
      });
    }
  },

  installRuntimeResources: async () => {
    if (get().fixBusy.resources) return;
    set((s) => ({ fixBusy: { ...s.fixBusy, resources: true } }));
    try {
      const result = await invoke<InstallResourcesResult>("ld_install_runtime_resources");
      toast.success("Runtime resources installed", {
        description: `${result.copied_files} file(s) under local-dev`,
      });
      await get().runDoctor({ force: true });
    } catch (err) {
      toast.error("Install runtime resources failed", { description: errMessage(err) });
    } finally {
      set((s) => {
        const next = { ...s.fixBusy };
        delete next.resources;
        return { fixBusy: next };
      });
    }
  },

  revealLogsDir: async () => {
    const dir = get().doctorReport?.logs.logs_dir ?? get().discovery?.runtime_paths.logs;
    if (!dir) {
      toast.error("Logs directory unknown", { description: "Run doctor or discovery first" });
      return;
    }
    try {
      await openInOS(dir);
    } catch (err) {
      toast.error("Could not open logs folder", { description: errMessage(err) });
    }
  },

  // ── Sites ──────────────────────────────────────────────────────────

  listSites: async () => {
    set({ sitesLoading: true });
    try {
      const sitesResult = await invoke<ListSitesResult>("ld_list_sites");
      set({ sitesResult, sitesLoading: false });
    } catch (err) {
      set({ sitesLoading: false });
      toast.error("Failed to list sites", { description: errMessage(err) });
    }
  },

  parkPath: async (path) => {
    markSiteBusy(SITE_ACTION_PARK, true);
    try {
      const result = await invoke<ParkResult>("ld_park", { path });
      toast.success(`Parked ${result.path}`, {
        description: result.notes.slice(0, 2).join(" · ") || undefined,
      });
      // Persist park path when possible
      try {
        const existing = await getParkPaths();
        if (!existing.some((p) => p.path === result.path)) {
          await createParkPath(result.path);
        }
      } catch {
        /* DB optional */
      }
      await get().listSites();
    } catch (err) {
      toast.error("Park failed", { description: errMessage(err) });
    } finally {
      markSiteBusy(SITE_ACTION_PARK, false);
    }
  },

  unparkPath: async (path) => {
    const key = parkActionKey(path);
    markSiteBusy(key, true);
    try {
      const result = await invoke<ParkResult>("ld_unpark", { path });
      toast.success(`Unparked ${result.path}`);
      await get().listSites();
    } catch (err) {
      toast.error("Unpark failed", { description: errMessage(err) });
    } finally {
      markSiteBusy(key, false);
    }
  },

  linkSite: async (site, path) => {
    markSiteBusy(SITE_ACTION_LINK, true);
    try {
      const result = await invoke<LinkResult>("ld_link", { site, path });
      toast.success(`Linked ${result.site}`);
      try {
        const tld = get().sitesResult?.tld ?? "test";
        const existing = await getSiteByNameTld(site, tld);
        if (existing) {
          await updateSite(existing.id, { path, kind: "linked" });
        } else {
          await createSite({ name: site, path, kind: "linked", tld });
        }
      } catch {
        /* DB optional */
      }
      await get().listSites();
    } catch (err) {
      toast.error("Link failed", { description: errMessage(err) });
    } finally {
      markSiteBusy(SITE_ACTION_LINK, false);
    }
  },

  unlinkSite: async (site) => {
    const key = siteActionKey(site);
    markSiteBusy(key, true);
    try {
      await invoke<LinkResult>("ld_unlink", { site });
      toast.success(`Unlinked ${site}`);
      await get().listSites();
    } catch (err) {
      toast.error("Unlink failed", { description: errMessage(err) });
    } finally {
      markSiteBusy(key, false);
    }
  },

  isolatePhp: async (site, version) => {
    const key = siteActionKey(site);
    markSiteBusy(key, true);
    try {
      const result = await invoke<IsolateResult>("ld_isolate_php", { site, version });
      if (result.refused) {
        toast.error(`Isolate refused for ${site}`, {
          description: result.notes.slice(0, 2).join(" · ") || "PHP binary missing",
        });
      } else {
        toast.success(`Isolated ${site} → PHP ${version}`);
        try {
          const tld = get().sitesResult?.tld ?? "test";
          const existing = await getSiteByNameTld(site, tld);
          if (existing) {
            await updateSite(existing.id, { php_version: version });
          }
        } catch {
          /* DB optional */
        }
      }
      await get().listSites();
    } catch (err) {
      toast.error("Isolate failed", { description: errMessage(err) });
    } finally {
      markSiteBusy(key, false);
    }
  },

  unisolatePhp: async (site) => {
    const key = siteActionKey(site);
    markSiteBusy(key, true);
    try {
      await invoke<IsolateResult>("ld_unisolate", { site });
      toast.success(`Unisolated ${site}`);
      try {
        const tld = get().sitesResult?.tld ?? "test";
        const existing = await getSiteByNameTld(site, tld);
        if (existing) {
          await updateSite(existing.id, { php_version: null });
        }
      } catch {
        /* DB optional */
      }
      await get().listSites();
    } catch (err) {
      toast.error("Unisolate failed", { description: errMessage(err) });
    } finally {
      markSiteBusy(key, false);
    }
  },

  openSiteUrl: async (site) => {
    try {
      const result = await invoke<OpenSiteUrlResult>("ld_open_site_url", { site });
      await openInOS(result.url);
    } catch (err) {
      toast.error("Open site failed", { description: errMessage(err) });
    }
  },

  reloadNginx: async () => {
    markSiteBusy(SITE_ACTION_NGINX, true);
    try {
      const result = await invoke<ReloadNginxResult>("ld_reload_nginx");
      if (result.ok && result.reloaded) {
        toast.success("Nginx reloaded");
      } else if (!result.test_ok) {
        toast.error("nginx -t failed", {
          description: result.stderr || result.stdout || result.notes.join(" · "),
        });
      } else {
        toast.warning("Nginx reload incomplete", {
          description: result.notes.slice(0, 2).join(" · ") || result.stderr || undefined,
        });
      }
    } catch (err) {
      toast.error("Nginx reload failed", { description: errMessage(err) });
    } finally {
      markSiteBusy(SITE_ACTION_NGINX, false);
    }
  },

  // ── Import ─────────────────────────────────────────────────────────

  importHerd: async (request = {}) => {
    set({ importBusy: true });
    try {
      const importResult = await invoke<ImportResult>("ld_import_herd", {
        request: {
          install_resources: request.install_resources ?? true,
          generate_configs: request.generate_configs ?? true,
          write_isolated_sites: request.write_isolated_sites ?? true,
          http_port: request.http_port ?? null,
          default_php_version: request.default_php_version ?? null,
          dry_run: request.dry_run ?? false,
        },
      });
      set({ importResult, importBusy: false });
      if (!request.dry_run) {
        try {
          await get().persistImportResult(importResult);
        } catch (persistErr) {
          console.error(persistErr);
          toast.warning("Import completed but DB persist had errors", {
            description: errMessage(persistErr),
          });
        }
        // Import generates nginx / FPM / dnsmasq config, so the cached specs
        // (and their health probe ports) are stale from this point on.
        if (importResult.configs) await get().refreshSpecs();
        await get().listSites();
        toast.success("Herd import complete", {
          description: `${importResult.parks.length} parks · ${importResult.sites.length} sites · datadir not copied`,
        });
      } else {
        toast.message("Dry-run import finished", {
          description: "No configs written beyond snapshot",
        });
      }
      return importResult;
    } catch (err) {
      set({ importBusy: false });
      toast.error("Import failed", { description: errMessage(err) });
      return null;
    }
  },

  persistImportResult: async (result) => {
    // Settings
    const s = result.settings;
    await setLocalDevSetting("tld", s.tld);
    await setLocalDevSetting("loopback", s.loopback);
    await setLocalDevSetting("http_port", String(s.http_port));
    await setLocalDevSetting("default_php_version", s.default_php_version);
    await setLocalDevSetting("mariadb_datadir_policy", s.mariadb_datadir_policy);
    if (s.herd_import_path) {
      await setLocalDevSetting("herd_import_path", s.herd_import_path);
    }

    // Parks
    const existingParks = await getParkPaths();
    const parkSet = new Set(existingParks.map((p) => p.path));
    for (const park of result.parks) {
      if (!parkSet.has(park.path)) {
        await createParkPath(park.path);
        parkSet.add(park.path);
      }
    }

    // Binaries
    const knownRoles = new Set<string>([
      "nginx",
      "php",
      "php_fpm",
      "mariadb",
      "mysql",
      "redis",
      "dnsmasq",
    ]);
    const existingBins = await getBinaries();
    for (const bin of result.binaries) {
      if (!knownRoles.has(bin.role)) continue;
      const role = bin.role as BinaryRole;
      const source = (["herd", "homebrew", "manual", "system", "other"].includes(bin.source)
        ? bin.source
        : "other") as BinarySource;
      const already = existingBins.find((b) => b.role === role && b.path === bin.path);
      let id = already?.id;
      if (!id) {
        const created = await createBinary({
          role,
          path: bin.path,
          source,
          version: bin.version,
        });
        id = created.id;
        existingBins.push(created);
      }
      if (bin.is_selected && id) {
        await selectBinary(role, id);
      }
    }

    // Services
    for (const svc of result.services) {
      const kind = mapServiceKind(svc.kind);
      if (!kind) continue;
      const existing = await getServiceByKind(kind);
      if (existing) {
        await updateService(existing.id, {
          display_name: svc.display_name,
          enabled: svc.enabled ? 1 : 0,
          data_dir: svc.data_dir,
          config_path: svc.config_path,
          port: svc.port,
          socket_path: svc.socket_path,
          extra_json: svc.extra_json != null ? JSON.stringify(svc.extra_json) : null,
        });
      } else {
        await createService({
          kind,
          display_name: svc.display_name,
          enabled: svc.enabled ? 1 : 0,
          data_dir: svc.data_dir,
          config_path: svc.config_path,
          port: svc.port,
          socket_path: svc.socket_path,
          extra_json: svc.extra_json != null ? JSON.stringify(svc.extra_json) : null,
        });
      }
    }

    // Sites
    for (const site of result.sites) {
      if (!site.name || site.skipped) continue;
      const kind: SiteKind =
        site.kind === "linked" || site.kind === "parked" ? site.kind : "parked";
      const existing = await getSiteByNameTld(site.name, site.tld || "test");
      if (existing) {
        await updateSite(existing.id, {
          path: site.path || existing.path,
          kind,
          php_version: site.php_version,
        });
      } else if (site.path) {
        await createSite({
          name: site.name,
          path: site.path,
          kind,
          tld: site.tld || "test",
          php_version: site.php_version,
        });
      }
    }

    await get().loadSettings();
  },

  // ── Doctor / bootstrap ─────────────────────────────────────────────

  /**
   * Run diagnostics, reusing a report younger than {@link DOCTOR_TTL_MS}.
   *
   * Doctor probes ports and shells out to `nginx -t`, so running it on every
   * tab mount made opening the Doctor tab stall. Mount passes no `force`; the
   * explicit "Run doctor" button passes `force: true`.
   */
  runDoctor: async (options) => {
    const force = options?.force ?? false;
    const { doctorReport, doctorRanAt, doctorBusy } = get();
    if (doctorBusy) return;
    if (!force && doctorReport && doctorRanAt && Date.now() - doctorRanAt < DOCTOR_TTL_MS) {
      return;
    }
    set({ doctorBusy: true });
    try {
      const tld = get().settings.tld || get().sitesResult?.tld || undefined;
      const report = await invoke<DoctorReport>("ld_doctor", {
        request: tld ? { tld } : null,
      });
      set({ doctorReport: report, doctorRanAt: Date.now(), doctorBusy: false });
    } catch (err) {
      set({ doctorBusy: false });
      toast.error("Doctor failed", { description: errMessage(err) });
    }
  },

  loadBootstrapStatus: async (tld) => {
    set({ bootstrapBusy: true });
    try {
      const bootstrapStatus = await invoke<BootstrapStatus>("ld_bootstrap_status", {
        tld: tld ?? get().settings.tld ?? null,
      });
      set({ bootstrapStatus, bootstrapBusy: false });
    } catch (err) {
      set({ bootstrapBusy: false });
      toast.error("Bootstrap status failed", { description: errMessage(err) });
    }
  },

  bootstrapInstall: async (request) => {
    set({ bootstrapBusy: true });
    try {
      const bootstrapResult = await invoke<BootstrapInstallResult>("ld_bootstrap_install", {
        request: {
          package: request.package,
          dry_run: request.dry_run ?? true,
          tld: request.tld ?? get().settings.tld ?? null,
          loopback: request.loopback ?? get().settings.loopback ?? null,
          dns_port: request.dns_port ?? null,
          nginx_binary: request.nginx_binary ?? null,
          dnsmasq_binary: request.dnsmasq_binary ?? null,
          attempt_privileged_install: request.attempt_privileged_install ?? false,
        },
      });
      set({ bootstrapResult, bootstrapBusy: false });
      if (bootstrapResult.dry_run) {
        toast.success("Bootstrap scaffold written (dry-run)", {
          description: `${bootstrapResult.written.length} file(s) under local-dev/launchd`,
        });
      } else if (bootstrapResult.privileged_ok) {
        toast.success("Privileged bootstrap install completed");
      } else if (bootstrapResult.privileged_attempted) {
        toast.warning("Privileged install attempted", {
          description: bootstrapResult.notes.slice(0, 2).join(" · ") || undefined,
        });
      } else {
        toast.success("Bootstrap files written", {
          description: "Complete install with admin auth using the printed command",
        });
      }
      await get().loadBootstrapStatus(request.tld ?? undefined);
    } catch (err) {
      set({ bootstrapBusy: false });
      toast.error("Bootstrap install failed", { description: errMessage(err) });
    }
  },

  // ── Settings ───────────────────────────────────────────────────────

  loadSettings: async () => {
    set({ settingsBusy: true });
    try {
      const rows = await getAllLocalDevSettings();
      const settings: Record<string, string> = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }
      // Merge defaults for missing keys via getLocalDevSettings isn't needed —
      // UI falls back to DEFAULT_LOCAL_DEV_SETTINGS.
      set({ settings, settingsBusy: false });
    } catch (err) {
      // Fresh DB may not have rows yet
      try {
        const partial = await getLocalDevSettings();
        set({ settings: partial, settingsBusy: false });
      } catch {
        set({ settingsBusy: false });
        console.error(err);
      }
    }
  },

  saveSetting: async (key, value) => {
    try {
      await setLocalDevSetting(key, value);
      set((s) => ({ settings: { ...s.settings, [key]: value } }));
      toast.success("Setting saved");
    } catch (err) {
      toast.error("Failed to save setting", { description: errMessage(err) });
    }
  },

  // ── MariaDB registration (Database module + keychain) ────────────

  registerMariaDb: async (password = "") => {
    set({ registerBusy: true });
    try {
      const result = await registerLocalMariaDbConnection(password);
      set({ registerBusy: false });
      if (result.connectionId) {
        set((s) => ({
          settings: { ...s.settings, mariadb_connection_id: result.connectionId },
        }));
        toast.success(result.message, {
          description: result.passwordSaved
            ? "Password saved to keychain"
            : "Empty root password — keychain left empty",
        });
      } else if (result.needsPassword) {
        toast.message("MariaDB requires a password", {
          description: result.message,
        });
      } else {
        toast.error("Could not register MariaDB", {
          description: result.message,
        });
      }
      return result;
    } catch (err) {
      set({ registerBusy: false });
      toast.error("Register MariaDB failed", { description: errMessage(err) });
      return null;
    }
  },

  // ── Site ↔ project link ──────────────────────────────────────────

  linkSiteToProject: async (site, projectId) => {
    try {
      const tld = site.tld || get().sitesResult?.tld || "test";
      const kind: SiteKind =
        site.kind === "linked" || site.kind === "parked" ? site.kind : "parked";
      let existing = await getSiteByNameTld(site.name, tld);
      if (!existing) {
        if (!site.path) {
          toast.error("Cannot link site without a path");
          return null;
        }
        existing = await createSite({
          name: site.name,
          path: site.path,
          kind,
          tld,
          php_version: site.php_version,
          secured: site.secured ? 1 : 0,
          project_id: projectId,
        });
      } else {
        existing =
          (await updateSite(existing.id, { project_id: projectId })) ?? existing;
      }
      toast.success(
        projectId
          ? `Linked ${site.name} to project`
          : `Unlinked ${site.name} from project`,
      );
      return existing;
    } catch (err) {
      toast.error("Site project link failed", { description: errMessage(err) });
      return null;
    }
  },

  getProjectSites: async (projectId) => {
    try {
      return await getSitesByProject(projectId);
    } catch (err) {
      console.error(err);
      return [];
    }
  },
}));

/** Toggle one keyed site-action busy flag without touching the others. */
function markSiteBusy(key: string, busy: boolean) {
  useLocalDevStore.setState((s) => {
    const next = { ...s.siteBusy };
    if (busy) next[key] = true;
    else delete next[key];
    return { siteBusy: next };
  });
}

type GroupAction = "start" | "stop" | "restart";

/**
 * Dependency order within a group.
 *
 * web:  php-fpm pools → nginx   (nginx last: it needs a socket to proxy to)
 * data: mariadb → redis          (arbitrary but stable)
 * Stops run in reverse.
 */
function groupStartOrder(members: ServiceStatusReport[]): ServiceStatusReport[] {
  const rank = (s: ServiceStatusReport): number => {
    if (s.kind.kind === "nginx" || s.id === "nginx") return 3;
    if (s.id === "mariadb" || s.id === "mysql") return 0;
    if (s.id === "redis") return 1;
    return 2; // php-fpm and anything unknown
  };
  return [...members].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

/**
 * Run a group-level action as one user-visible operation.
 *
 * Per-service toasts are suppressed in favour of a single summary — starting a
 * web group can touch 3-4 services and four toasts for one button press is
 * noise. Ordering is sequential on purpose: nginx must not race its pools.
 */
async function runGroupAction(
  set: (partial: Partial<LocalDevState>) => void,
  get: () => LocalDevState,
  group: ServiceGroupId,
  action: GroupAction,
): Promise<void> {
  const state = get();
  if (state.stackBusy || state.groupBusy[group]) return;

  const members = state.services.filter((s) => serviceGroupOf(s) === group);
  if (members.length === 0) return;

  const health = stackHealthOf(state);
  const required = health.requiredIds;

  // start → only required members that are not already up.
  // stop  → every member that is up or stuck, so nothing is left behind.
  const targets =
    action === "stop"
      ? groupStartOrder(members)
          .filter((s) => s.status.status !== "stopped" && s.status.status !== "unavailable")
          .reverse()
      : groupStartOrder(members).filter((s) => {
          if (!s.binary_present) return false;
          if (action === "restart") return required.has(s.id) || isServiceRunning(s.status);
          return required.has(s.id) && !isServiceRunning(s.status);
        });

  if (targets.length === 0) {
    if (action === "start") {
      toast.success(`${GROUP_LABELS[group]} already running`);
    } else {
      toast.message(`${GROUP_LABELS[group]} already stopped`);
    }
    return;
  }

  set({ groupBusy: { ...state.groupBusy, [group]: true } });
  const command =
    action === "start"
      ? "ld_service_start"
      : action === "stop"
        ? "ld_service_stop"
        : "ld_service_restart";

  const failures: Array<{ id: string; text: string }> = [];
  try {
    for (const service of targets) {
      try {
        const result = await invoke<ServiceActionResult>(command, {
          serviceId: service.id,
        });
        if (
          result.status.status === "error" ||
          result.status.status === "unavailable" ||
          (action !== "stop" && result.status.status === "unhealthy")
        ) {
          failures.push({
            id: service.id,
            text: `${service.label}: ${result.message || serviceStatusMsg(result.status)}`,
          });
          // A failed FPM pool means nginx would only serve 502s — stop here so
          // the user sees the real cause instead of a second, derived error.
          if (action !== "stop" && group === "web") break;
        }
      } catch (err) {
        failures.push({ id: service.id, text: `${service.label}: ${errMessage(err)}` });
        if (action !== "stop" && group === "web") break;
      }
    }

    const verb = action === "start" ? "start" : action === "stop" ? "stop" : "restart";
    if (failures.length === 0) {
      toast.success(`${GROUP_LABELS[group]} ${verb === "stop" ? "stopped" : `${verb}ed`}`);
    } else {
      toast.error(`${GROUP_LABELS[group]} ${verb} failed`, {
        description: failures.slice(0, 2).map((f) => f.text).join(" · "),
      });
      // Reveal the *first* failure — in a web group the later ones are usually
      // consequences of it (nginx failing because its pool never came up).
      get().revealServiceLog(failures[0].id);
    }
    await get().refreshStatus();
  } finally {
    const next = { ...get().groupBusy };
    delete next[group];
    set({ groupBusy: next });
  }
}

/**
 * DNS port to pass to `ld_generate_configs`, which rewrites `dnsmasq.conf` as
 * part of a full generate.
 *
 * Omitting it makes Rust fall back to its own default (53535), so an unrelated
 * action — switching the HTTP port, or a "Regenerate configs" fix — would
 * silently move DNS off the port it is set up on. A `:53` LaunchDaemon install
 * would break. Preference order: what macOS actually queries, then what is
 * already on disk, then the Rust default.
 */
function effectiveDnsPort(state: LocalDevState): number {
  const b = state.bootstrapStatus;
  if (b?.resolver_present && b.resolver_effective_port > 0) return b.resolver_effective_port;
  if (b?.dnsmasq_conf_port && b.dnsmasq_conf_port > 0) return b.dnsmasq_conf_port;
  return 53535;
}

export const GROUP_LABELS: Record<ServiceGroupId, string> = {
  web: "Web",
  data: "Data",
  dns: "DNS",
};

/**
 * Derive the aggregate stack state from current store contents.
 *
 * A plain function rather than stored state so it can never go stale relative
 * to `services` / `sitesResult` / `settings`. Call it inside `useMemo`.
 */
export function stackHealthOf(state: LocalDevState): StackHealth {
  return computeStackHealth({
    services: state.services,
    sites: state.sitesResult?.sites ?? [],
    defaultPhpVersion:
      state.settings.default_php_version ||
      DEFAULT_LOCAL_DEV_SETTINGS.default_php_version,
  });
}

function serviceStatusMsg(status: ServiceActionResult["status"]): string {
  if (status.status === "error") return status.message;
  if (status.status === "unavailable") return status.reason;
  if (status.status === "unhealthy") return status.reason;
  return status.status;
}

function mapServiceKind(kind: string): LocalDevServiceKind | null {
  switch (kind) {
    case "nginx":
    case "php_fpm":
    case "mariadb":
    case "mysql":
    case "redis":
    case "dnsmasq":
      return kind;
    case "maria_db":
      return "mariadb";
    case "my_sql":
      return "mysql";
    case "dns_masq":
      return "dnsmasq";
    default:
      return null;
  }
}

// ── Shared status poller (single timer; refcounted) ─────────────────

let pollTimer: number | null = null;
let pollSubscribers = 0;

/**
 * Acquire the shared status poller. Multiple Local Dev tab instances share one
 * interval; the timer stops when the last subscriber releases.
 */
export function acquireStatusPolling(): () => void {
  pollSubscribers += 1;
  if (pollTimer === null) {
    const tick = () => {
      void useLocalDevStore.getState().refreshStatus();
    };
    tick();
    pollTimer = window.setInterval(tick, POLL_MS);
  }
  return () => {
    pollSubscribers = Math.max(0, pollSubscribers - 1);
    if (pollSubscribers === 0 && pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}
