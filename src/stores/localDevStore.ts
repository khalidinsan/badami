import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type {
  BootstrapInstallRequest,
  BootstrapInstallResult,
  BootstrapStatus,
  DiscoveryReport,
  DoctorReport,
  ImportHerdRequest,
  ImportResult,
  IsolateResult,
  LinkResult,
  ListSitesResult,
  LogTailResult,
  OpenSiteUrlResult,
  ParkResult,
  ReloadNginxResult,
  RegisterMariaDbResult,
  ServiceStatusReport,
  StackActionResult,
  ServiceActionResult,
  LocalDevSettingKey,
  BinaryRole,
  BinarySource,
  LocalDevServiceKind,
  SiteKind,
  SiteInfo,
} from "@/types/localDev";
import { isDnsDegraded } from "@/types/localDev";
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

interface LocalDevState {
  services: ServiceStatusReport[];
  discovery: DiscoveryReport | null;
  sitesResult: ListSitesResult | null;
  importResult: ImportResult | null;
  doctorReport: DoctorReport | null;
  bootstrapStatus: BootstrapStatus | null;
  bootstrapResult: BootstrapInstallResult | null;
  settings: Record<string, string>;
  stackBusy: boolean;
  /** Service ids currently starting/stopping via UI action */
  serviceBusy: Record<string, boolean>;
  sitesBusy: boolean;
  importBusy: boolean;
  doctorBusy: boolean;
  bootstrapBusy: boolean;
  settingsBusy: boolean;
  registerBusy: boolean;
  dnsDegraded: boolean;
  loading: boolean;
  error: string | null;
  selectedServiceId: string | null;
  logTail: LogTailResult | null;
  logLoading: boolean;

  setSelectedServiceId: (id: string | null) => void;
  refreshStatus: () => Promise<void>;
  discover: () => Promise<void>;
  startService: (serviceId: string) => Promise<void>;
  stopService: (serviceId: string) => Promise<void>;
  startStack: () => Promise<void>;
  stopStack: () => Promise<void>;
  fetchLogs: (serviceId: string, lines?: number) => Promise<void>;

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
  runDoctor: () => Promise<void>;
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

function applyServices(services: ServiceStatusReport[]) {
  const prev = useLocalDevStore.getState().selectedServiceId;
  const selectedStillValid = prev != null && services.some((s) => s.id === prev);
  const selectedServiceId =
    selectedStillValid ? prev : services.length > 0 ? services[0].id : null;
  return {
    services,
    dnsDegraded: isDnsDegraded(services),
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
  bootstrapStatus: null,
  bootstrapResult: null,
  settings: {},
  stackBusy: false,
  serviceBusy: {},
  sitesBusy: false,
  importBusy: false,
  doctorBusy: false,
  bootstrapBusy: false,
  settingsBusy: false,
  registerBusy: false,
  dnsDegraded: false,
  loading: false,
  error: null,
  selectedServiceId: null,
  logTail: null,
  logLoading: false,

  setSelectedServiceId: (id) => set({ selectedServiceId: id }),

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
      } else {
        toast.success(`${label} started`);
      }
      await get().refreshStatus();
    } catch (err) {
      toast.error(`Failed to start ${label}`, { description: errMessage(err) });
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
      } else {
        toast.success(`${label} stopped`);
      }
      await get().refreshStatus();
    } catch (err) {
      toast.error(`Failed to stop ${label}`, { description: errMessage(err) });
    } finally {
      set((s) => {
        const next = { ...s.serviceBusy };
        delete next[serviceId];
        return { serviceBusy: next };
      });
    }
  },

  startStack: async () => {
    set({ stackBusy: true });
    try {
      const result = await invoke<StackActionResult>("ld_stack_start");
      if (result.partial_failure) {
        toast.warning("Stack started with partial failures", {
          description: result.notes.slice(0, 3).join(" · ") || undefined,
        });
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

  // ── Sites ──────────────────────────────────────────────────────────

  listSites: async () => {
    set({ sitesBusy: true });
    try {
      const sitesResult = await invoke<ListSitesResult>("ld_list_sites");
      set({ sitesResult, sitesBusy: false });
    } catch (err) {
      set({ sitesBusy: false });
      toast.error("Failed to list sites", { description: errMessage(err) });
    }
  },

  parkPath: async (path) => {
    set({ sitesBusy: true });
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
      set({ sitesBusy: false });
      toast.error("Park failed", { description: errMessage(err) });
    }
  },

  unparkPath: async (path) => {
    set({ sitesBusy: true });
    try {
      const result = await invoke<ParkResult>("ld_unpark", { path });
      toast.success(`Unparked ${result.path}`);
      await get().listSites();
    } catch (err) {
      set({ sitesBusy: false });
      toast.error("Unpark failed", { description: errMessage(err) });
    }
  },

  linkSite: async (site, path) => {
    set({ sitesBusy: true });
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
      set({ sitesBusy: false });
      toast.error("Link failed", { description: errMessage(err) });
    }
  },

  unlinkSite: async (site) => {
    set({ sitesBusy: true });
    try {
      await invoke<LinkResult>("ld_unlink", { site });
      toast.success(`Unlinked ${site}`);
      await get().listSites();
    } catch (err) {
      set({ sitesBusy: false });
      toast.error("Unlink failed", { description: errMessage(err) });
    }
  },

  isolatePhp: async (site, version) => {
    set({ sitesBusy: true });
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
      set({ sitesBusy: false });
      toast.error("Isolate failed", { description: errMessage(err) });
    }
  },

  unisolatePhp: async (site) => {
    set({ sitesBusy: true });
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
      set({ sitesBusy: false });
      toast.error("Unisolate failed", { description: errMessage(err) });
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
    set({ sitesBusy: true });
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
      set({ sitesBusy: false });
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

  runDoctor: async () => {
    set({ doctorBusy: true });
    try {
      const tld = get().settings.tld || get().sitesResult?.tld || undefined;
      const doctorReport = await invoke<DoctorReport>("ld_doctor", {
        request: tld ? { tld } : null,
      });
      set({ doctorReport, doctorBusy: false });
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
