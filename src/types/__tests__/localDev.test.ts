import { describe, it, expect } from "vitest";
import {
  computeDnsSetup,
  computeStackHealth,
  formatBytes,
  groupSummary,
  hasHerdConflict,
  isDnsDegraded,
  isPhpFpmId,
  isServiceBusy,
  isServiceRunning,
  phpVersionOf,
  requiredServiceIds,
  serviceGroupOf,
  servicePid,
  serviceStatusDetail,
  serviceStatusLabel,
  serviceStatusShort,
} from "@/types/localDev";
import type {
  BootstrapStatus,
  DnsProbeResult,
  HerdRuntimeStatus,
  RuntimeServiceKind,
  RuntimeServiceStatus,
  ServiceStatusReport,
  SiteInfo,
} from "@/types/localDev";

// ── Fixture helpers ──────────────────────────────────────────────────

function makeService(overrides: Partial<ServiceStatusReport> & {
  id: string;
  kind: RuntimeServiceKind;
  status: RuntimeServiceStatus;
}): ServiceStatusReport {
  return {
    label: overrides.id,
    binary_path: "/usr/local/bin/x",
    binary_present: true,
    pid_file: `/tmp/${overrides.id}.pid`,
    log_file: `/tmp/${overrides.id}.log`,
    auto_restart: false,
    notes: [],
    ...overrides,
  };
}

function makeSite(overrides: Partial<SiteInfo> & { name: string }): SiteInfo {
  return {
    tld: "test",
    url: `http://${overrides.name}.test:8080`,
    path: `/parks/${overrides.name}`,
    kind: "parked",
    php_version: null,
    isolated: false,
    secured: false,
    conf_path: null,
    park_path: null,
    ...overrides,
  };
}

// ── formatBytes ──────────────────────────────────────────────────────

describe("formatBytes", () => {
  it("returns em-dash for non-finite or negative inputs", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("uses B up to 1023", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("uses KB / MB / GB with 1 decimal for MB and up", () => {
    // KB is the first unit reached (i === 0 in the impl) — decimals are
    // dropped, so 1 KiB shows as "1 KB", not "1.0 KB".
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1500)).toBe("1 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("drops the decimal once the value crosses 10 of a unit", () => {
    expect(formatBytes(10 * 1024)).toBe("10 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatBytes(11 * 1024 * 1024)).toBe("11 MB");
  });

  it("saturates at TB (no PB unit shipped)", () => {
    const oneTb = 1024 ** 4;
    expect(formatBytes(oneTb)).toBe("1.0 TB");
    // Beyond TB the units array runs out — implementation clamps at TB.
    expect(formatBytes(2048 * oneTb)).toMatch(/TB$/);
  });
});

// ── service status helpers ───────────────────────────────────────────

describe("service status helpers", () => {
  it("isServiceRunning flags only the running case", () => {
    expect(isServiceRunning({ status: "running", pid: 42 })).toBe(true);
    expect(isServiceRunning({ status: "stopped" })).toBe(false);
    expect(isServiceRunning({ status: "starting" })).toBe(false);
    expect(isServiceRunning({ status: "unhealthy", reason: "x" })).toBe(false);
  });

  it("isServiceBusy is starting or stopping", () => {
    expect(isServiceBusy({ status: "starting" })).toBe(true);
    expect(isServiceBusy({ status: "stopping" })).toBe(true);
    expect(isServiceBusy({ status: "running", pid: 1 })).toBe(false);
    expect(isServiceBusy({ status: "stopped" })).toBe(false);
  });

  it("serviceStatusLabel includes pid for running only", () => {
    expect(serviceStatusLabel({ status: "running", pid: 4242 })).toBe(
      "Running · pid 4242",
    );
    expect(serviceStatusLabel({ status: "stopped" })).toBe("Stopped");
    expect(serviceStatusLabel({ status: "starting" })).toBe("Starting…");
    expect(serviceStatusLabel({ status: "unhealthy", reason: "x" })).toBe(
      "Unhealthy",
    );
  });

  it("serviceStatusShort drops the pid", () => {
    expect(serviceStatusShort({ status: "running", pid: 1 })).toBe("Running");
    expect(serviceStatusShort({ status: "error", message: "x" })).toBe("Error");
  });

  it("serviceStatusDetail returns the human message for degraded states", () => {
    expect(serviceStatusDetail({ status: "error", message: "bad" })).toBe("bad");
    expect(
      serviceStatusDetail({ status: "unhealthy", reason: "no socket" }),
    ).toBe("no socket");
    expect(
      serviceStatusDetail({ status: "unavailable", reason: "no binary" }),
    ).toBe("no binary");
    expect(serviceStatusDetail({ status: "running", pid: 1 })).toBeNull();
    expect(serviceStatusDetail({ status: "stopped" })).toBeNull();
  });

  it("servicePid returns pid only when running (or when unhealthy attaches one)", () => {
    expect(servicePid({ status: "running", pid: 99 })).toBe(99);
    expect(servicePid({ status: "unhealthy", pid: 100, reason: "x" })).toBe(100);
    expect(servicePid({ status: "unhealthy", reason: "x" })).toBeNull();
    expect(servicePid({ status: "stopped" })).toBeNull();
  });
});

// ── service classification ───────────────────────────────────────────

describe("service classification", () => {
  it("isPhpFpmId recognises the id prefix", () => {
    expect(isPhpFpmId("php-fpm-8.4")).toBe(true);
    expect(isPhpFpmId("php-fpm-")).toBe(true); // prefix-only counts by contract
    expect(isPhpFpmId("nginx")).toBe(false);
    expect(isPhpFpmId("mariadb")).toBe(false);
  });

  it("serviceGroupOf routes services to web / data / dns", () => {
    const nginx = makeService({
      id: "nginx",
      kind: { kind: "nginx" },
      status: { status: "stopped" },
    });
    const fpm = makeService({
      id: "php-fpm-8.4",
      kind: { kind: "php_fpm", version: "8.4" },
      status: { status: "stopped" },
    });
    const maria = makeService({
      id: "mariadb",
      kind: { kind: "maria_db" },
      status: { status: "stopped" },
    });
    const redis = makeService({
      id: "redis",
      kind: { kind: "redis" },
      status: { status: "stopped" },
    });
    const dns = makeService({
      id: "dnsmasq",
      kind: { kind: "dns_masq" },
      status: { status: "stopped" },
    });

    expect(serviceGroupOf(nginx)).toBe("web");
    expect(serviceGroupOf(fpm)).toBe("web");
    expect(serviceGroupOf(maria)).toBe("data");
    expect(serviceGroupOf(redis)).toBe("data");
    expect(serviceGroupOf(dns)).toBe("dns");
  });

  it("phpVersionOf reads from the tag first, id fallback second", () => {
    const tagged = makeService({
      id: "custom-fpm-id", // id lacks the prefix
      kind: { kind: "php_fpm", version: "7.4" },
      status: { status: "stopped" },
    });
    const byId = makeService({
      id: "php-fpm-8.2",
      kind: { kind: "nginx" }, // pretend the kind isn't php_fpm
      status: { status: "stopped" },
    });
    const neither = makeService({
      id: "mariadb",
      kind: { kind: "maria_db" },
      status: { status: "stopped" },
    });
    expect(phpVersionOf(tagged)).toBe("7.4");
    expect(phpVersionOf(byId)).toBe("8.2");
    expect(phpVersionOf(neither)).toBeNull();
  });
});

// ── requiredServiceIds ───────────────────────────────────────────────

describe("requiredServiceIds", () => {
  const nginx = makeService({
    id: "nginx",
    kind: { kind: "nginx" },
    status: { status: "stopped" },
  });
  const fpm84 = makeService({
    id: "php-fpm-8.4",
    kind: { kind: "php_fpm", version: "8.4" },
    status: { status: "stopped" },
  });
  const fpm74 = makeService({
    id: "php-fpm-7.4",
    kind: { kind: "php_fpm", version: "7.4" },
    status: { status: "stopped" },
  });
  const maria = makeService({
    id: "mariadb",
    kind: { kind: "maria_db" },
    status: { status: "stopped" },
  });
  const redis = makeService({
    id: "redis",
    kind: { kind: "redis" },
    status: { status: "stopped" },
  });
  const dns = makeService({
    id: "dnsmasq",
    kind: { kind: "dns_masq" },
    status: { status: "stopped" },
  });

  it("requires nginx + the default FPM pool + data/dns when binaries exist", () => {
    const required = requiredServiceIds({
      services: [nginx, fpm84, fpm74, maria, redis, dns],
      defaultPhpVersion: "8.4",
    });
    expect(required.has("nginx")).toBe(true);
    expect(required.has("php-fpm-8.4")).toBe(true);
    expect(required.has("php-fpm-7.4")).toBe(false); // not the default, no isolated site
    expect(required.has("mariadb")).toBe(true);
    expect(required.has("redis")).toBe(true);
    expect(required.has("dnsmasq")).toBe(true);
  });

  it("pins isolated site PHP versions on top of the default", () => {
    const sites = [
      makeSite({ name: "legacy", php_version: "7.4", isolated: true }),
    ];
    const required = requiredServiceIds({
      services: [nginx, fpm84, fpm74],
      sites,
      defaultPhpVersion: "8.4",
    });
    expect(required.has("php-fpm-8.4")).toBe(true);
    expect(required.has("php-fpm-7.4")).toBe(true);
  });

  it("falls back to any present FPM pool when the default is not discovered", () => {
    // Default 8.4 not among services — fallback keeps 'web' from being nginx-only.
    const required = requiredServiceIds({
      services: [nginx, fpm74],
      defaultPhpVersion: "8.4",
    });
    expect(required.has("php-fpm-7.4")).toBe(true);
  });

  it("omits services whose binary is missing", () => {
    const missingBinaryNginx = makeService({
      id: "nginx",
      kind: { kind: "nginx" },
      status: { status: "unavailable", reason: "no binary" },
      binary_present: false,
    });
    const required = requiredServiceIds({
      services: [missingBinaryNginx, maria],
      defaultPhpVersion: "8.4",
    });
    expect(required.has("nginx")).toBe(false);
    expect(required.has("mariadb")).toBe(true);
  });
});

// ── groupSummary ─────────────────────────────────────────────────────

describe("groupSummary", () => {
  const nginx = makeService({
    id: "nginx",
    kind: { kind: "nginx" },
    status: { status: "running", pid: 1 },
  });
  const fpm84 = makeService({
    id: "php-fpm-8.4",
    kind: { kind: "php_fpm", version: "8.4" },
    status: { status: "running", pid: 2 },
  });
  const maria = makeService({
    id: "mariadb",
    kind: { kind: "maria_db" },
    status: { status: "stopped" },
  });

  it("counts required-running vs required-total and lists missing labels", () => {
    const required = new Set(["nginx", "php-fpm-8.4", "mariadb"]);
    const web = groupSummary("web", [nginx, fpm84, maria], required);
    expect(web.requiredTotal).toBe(2);
    expect(web.requiredRunning).toBe(2);
    expect(web.healthy).toBe(true);
    expect(web.missing).toEqual([]);

    const data = groupSummary("data", [nginx, fpm84, maria], required);
    expect(data.requiredTotal).toBe(1);
    expect(data.requiredRunning).toBe(0);
    expect(data.missing).toEqual(["mariadb"]);
    expect(data.healthy).toBe(false);
  });

  it("counts running members that are not required as extraRunning", () => {
    // A running FPM 7.4 pool that isn't in the required set is 'extra', not required.
    const fpm74 = makeService({
      id: "php-fpm-7.4",
      kind: { kind: "php_fpm", version: "7.4" },
      status: { status: "running", pid: 3 },
    });
    const required = new Set(["nginx", "php-fpm-8.4"]);
    const web = groupSummary("web", [nginx, fpm84, fpm74], required);
    expect(web.requiredTotal).toBe(2);
    expect(web.extraRunning).toBe(1);
    expect(web.healthy).toBe(true);
  });

  it("marks the group transitional when a member is starting or stopping", () => {
    const starting = makeService({
      id: "php-fpm-8.4",
      kind: { kind: "php_fpm", version: "8.4" },
      status: { status: "starting" },
    });
    const required = new Set(["nginx", "php-fpm-8.4"]);
    const web = groupSummary("web", [nginx, starting], required);
    expect(web.transitional).toBe(true);
  });

  it("marks the group faulted on error / unhealthy members", () => {
    const broken = makeService({
      id: "php-fpm-8.4",
      kind: { kind: "php_fpm", version: "8.4" },
      status: { status: "error", message: "boom" },
    });
    const required = new Set(["nginx", "php-fpm-8.4"]);
    const web = groupSummary("web", [nginx, broken], required);
    expect(web.faulted).toBe(true);
  });
});

// ── computeStackHealth ───────────────────────────────────────────────

describe("computeStackHealth", () => {
  const running = (id: string, kind: RuntimeServiceKind, pid = 100) =>
    makeService({ id, kind, status: { status: "running", pid } });
  const stopped = (id: string, kind: RuntimeServiceKind) =>
    makeService({ id, kind, status: { status: "stopped" } });

  it("reports 'Not configured' when no web services are required", () => {
    const health = computeStackHealth({
      services: [],
      defaultPhpVersion: "8.4",
    });
    expect(health.phase).toBe("broken");
    expect(health.label).toBe("Not configured");
  });

  it("reports 'Serving' when web is fully up", () => {
    const services = [
      running("nginx", { kind: "nginx" }),
      running("php-fpm-8.4", { kind: "php_fpm", version: "8.4" }),
      running("mariadb", { kind: "maria_db" }),
      running("redis", { kind: "redis" }),
    ];
    const health = computeStackHealth({ services, defaultPhpVersion: "8.4" });
    expect(health.phase).toBe("serving");
    expect(health.label).toBe("Serving");
  });

  it("reports 'Partial' when nginx runs but a required FPM pool is down", () => {
    const services = [
      running("nginx", { kind: "nginx" }),
      stopped("php-fpm-8.4", { kind: "php_fpm", version: "8.4" }),
    ];
    const health = computeStackHealth({ services, defaultPhpVersion: "8.4" });
    expect(health.phase).toBe("partial");
    expect(health.label.startsWith("Partial")).toBe(true);
    expect(health.detail).toContain("not running");
  });

  it("reports 'Stopping…' when a web member is stopping", () => {
    const services = [
      makeService({
        id: "nginx",
        kind: { kind: "nginx" },
        status: { status: "stopping" },
      }),
      running("php-fpm-8.4", { kind: "php_fpm", version: "8.4" }),
    ];
    const health = computeStackHealth({ services, defaultPhpVersion: "8.4" });
    expect(health.phase).toBe("stopping");
  });

  it("appends '· DNS degraded' when the dnsProbe is unhealthy", () => {
    const services = [
      running("nginx", { kind: "nginx" }),
      running("php-fpm-8.4", { kind: "php_fpm", version: "8.4" }),
    ];
    const dnsProbe: DnsProbeResult = {
      hostname: "example.test",
      tld: "test",
      expected_loopback: "127.0.0.1",
      resolved: [],
      healthy: false,
      resolver_path: "/etc/resolver/test",
      resolver_present: false,
      resolver_port: 0,
      port_53_listening: false,
      mode: "d3_degraded",
      error: null,
      notes: [],
    };
    const health = computeStackHealth({
      services,
      defaultPhpVersion: "8.4",
      dnsProbe,
    });
    expect(health.phase).toBe("serving");
    expect(health.label).toContain("DNS degraded");
    expect(health.dnsDegraded).toBe(true);
  });
});

// ── DNS helpers ──────────────────────────────────────────────────────

describe("computeDnsSetup", () => {
  const dnsRunning = makeService({
    id: "dnsmasq",
    kind: { kind: "dns_masq" },
    status: { status: "running", pid: 5 },
  });
  const dnsStopped = makeService({
    id: "dnsmasq",
    kind: { kind: "dns_masq" },
    status: { status: "stopped" },
  });
  const noBinary = makeService({
    id: "dnsmasq",
    kind: { kind: "dns_masq" },
    status: { status: "unavailable", reason: "no binary" },
    binary_present: false,
  });

  const healthyProbe: DnsProbeResult = {
    hostname: "example.test",
    tld: "test",
    expected_loopback: "127.0.0.1",
    resolved: ["127.0.0.1"],
    healthy: true,
    resolver_path: "/etc/resolver/test",
    resolver_present: true,
    resolver_port: 53,
    port_53_listening: true,
    mode: "d0_adopt",
    error: null,
    notes: [],
  };

  it("returns 'healthy' when our dnsmasq is running and the probe is healthy", () => {
    const state = computeDnsSetup({
      services: [dnsRunning],
      bootstrap: null,
      probe: healthyProbe,
    });
    expect(state.kind).toBe("healthy");
  });

  it("returns 'adopted' when the probe is healthy but our dnsmasq is not running", () => {
    const state = computeDnsSetup({
      services: [dnsStopped],
      bootstrap: null,
      probe: healthyProbe,
    });
    expect(state.kind).toBe("adopted");
  });

  it("returns 'no_binary' when the dnsmasq binary is missing", () => {
    const state = computeDnsSetup({
      services: [noBinary],
      bootstrap: null,
      probe: null,
    });
    expect(state.kind).toBe("no_binary");
  });

  it("returns 'no_resolver' when bootstrap says the resolver file is missing", () => {
    const bootstrap: BootstrapStatus = {
      dnsmasq: {
        label: "com.badami.dnsmasq",
        scaffold_path: null,
        scaffold_present: false,
        system_plist_path: "/Library/LaunchDaemons/com.badami.dnsmasq.plist",
        system_plist_present: false,
        loaded: false,
      },
      nginx: {
        label: "com.badami.nginx",
        scaffold_path: null,
        scaffold_present: false,
        system_plist_path: "/Library/LaunchDaemons/com.badami.nginx.plist",
        system_plist_present: false,
        loaded: false,
      },
      resolver_path: "/etc/resolver/test",
      resolver_present: false,
      resolver_port: null,
      resolver_marker_present: false,
      dns_bootstrap_complete: false,
      http_bootstrap_complete: false,
      nginx_listen_port: 8080,
      dnsmasq_conf_port: 53535,
      resolver_effective_port: 53,
      dns_port_mismatch: false,
      recommended_package: "dns_high_port",
      notes: [],
      launchd_dir: "/tmp/scaffold",
      root_staging_prefix:
        "/Library/Application Support/Badami/local-dev-root",
    };
    const state = computeDnsSetup({
      services: [dnsStopped],
      bootstrap,
      probe: null,
    });
    expect(state.kind).toBe("no_resolver");
  });

  it("returns 'port_mismatch' when resolver and dnsmasq disagree on port", () => {
    const bootstrap: BootstrapStatus = {
      dnsmasq: {
        label: "com.badami.dnsmasq",
        scaffold_path: null,
        scaffold_present: true,
        system_plist_path: "/Library/LaunchDaemons/com.badami.dnsmasq.plist",
        system_plist_present: false,
        loaded: false,
      },
      nginx: {
        label: "com.badami.nginx",
        scaffold_path: null,
        scaffold_present: true,
        system_plist_path: "/Library/LaunchDaemons/com.badami.nginx.plist",
        system_plist_present: false,
        loaded: false,
      },
      resolver_path: "/etc/resolver/test",
      resolver_present: true,
      resolver_port: 53,
      resolver_marker_present: true,
      dns_bootstrap_complete: false,
      http_bootstrap_complete: false,
      nginx_listen_port: 8080,
      dnsmasq_conf_port: 53535,
      resolver_effective_port: 53,
      dns_port_mismatch: true,
      recommended_package: "dns_only",
      notes: [],
      launchd_dir: "/tmp/scaffold",
      root_staging_prefix:
        "/Library/Application Support/Badami/local-dev-root",
    };
    const state = computeDnsSetup({
      services: [dnsStopped],
      bootstrap,
      probe: null,
    });
    expect(state.kind).toBe("port_mismatch");
    if (state.kind === "port_mismatch") {
      expect(state.resolverPort).toBe(53);
      expect(state.confPort).toBe(53535);
    }
  });
});

describe("isDnsDegraded", () => {
  const dns = (status: RuntimeServiceStatus): ServiceStatusReport =>
    makeService({ id: "dnsmasq", kind: { kind: "dns_masq" }, status });

  it("is false when dnsmasq is absent", () => {
    expect(isDnsDegraded([])).toBe(false);
  });

  it("is false while dnsmasq is running / starting / stopping", () => {
    expect(isDnsDegraded([dns({ status: "running", pid: 1 })])).toBe(false);
    expect(isDnsDegraded([dns({ status: "starting" })])).toBe(false);
    expect(isDnsDegraded([dns({ status: "stopping" })])).toBe(false);
  });

  it("is true in terminal bad states", () => {
    expect(isDnsDegraded([dns({ status: "stopped" })])).toBe(true);
    expect(isDnsDegraded([dns({ status: "unhealthy", reason: "x" })])).toBe(true);
    expect(isDnsDegraded([dns({ status: "error", message: "x" })])).toBe(true);
  });

  it("treats 'unavailable' (no binary) as not degraded", () => {
    // Rationale mirrors the banner UX: no binary means DNS was never wired up
    // by us — we shouldn't flash 'degraded'.
    expect(isDnsDegraded([dns({ status: "unavailable", reason: "x" })])).toBe(false);
  });
});

describe("hasHerdConflict", () => {
  const base: HerdRuntimeStatus = {
    installed: true,
    app_running: false,
    processes: [],
    ports: [],
    notes: [],
  };

  it("is false when the status is null", () => {
    expect(hasHerdConflict(null)).toBe(false);
  });

  it("is true when the Herd app itself is running", () => {
    expect(hasHerdConflict({ ...base, app_running: true })).toBe(true);
  });

  it("is true when a non-app Herd service process is running", () => {
    expect(
      hasHerdConflict({
        ...base,
        processes: [{ pid: 42, role: "nginx", command: "nginx: master" }],
      }),
    ).toBe(true);
  });

  it("is false when only the 'app' entry appears in processes (menu bar)", () => {
    expect(
      hasHerdConflict({
        ...base,
        processes: [{ pid: 42, role: "app", command: "Herd.app" }],
      }),
    ).toBe(false);
  });
});
