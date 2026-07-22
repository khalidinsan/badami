//! Local Dev doctor diagnostics (`ld_doctor`, `ld_dns_probe`).
//!
//! Read-only diagnostics (plus optional `nginx -t` subprocess). MariaDB
//! preflight is called with `allow_mutate: false` so stale pid/socket files are
//! reported but never unlinked. Never starts services, never deletes Herd
//! datadir, never invokes the Herd privileged helper.

use super::discovery::{build_runtime_paths, discover, DiscoveryReport, RuntimePaths};
use super::mariadb_guard::{
    run_preflight, tcp_accepting, unix_socket_accepting, MariadbPreflight, MariadbPreflightRequest,
    MariadbPreflightReport,
};
use super::service_specs::{build_specs_from_discovery, parse_nginx_http_port, ServiceSpec};
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::ToSocketAddrs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

// ── Thresholds (plan observability) ─────────────────────────────────

const LOG_FILE_WARN_BYTES: u64 = 50 * 1024 * 1024; // 50 MiB
const LOGS_DIR_WARN_BYTES: u64 = 500 * 1024 * 1024; // 500 MiB
const DNS_PROBE_TIMEOUT_MS: u64 = 2_000;

// LaunchDaemon labels (must match bootstrap.rs).
pub const LD_DNSMASQ_LABEL: &str = "com.khalid.badami.local-dev.dnsmasq";
pub const LD_NGINX_LABEL: &str = "com.khalid.badami.local-dev.nginx";
pub const HERD_HELPER_PATH: &str = "/Library/PrivilegedHelperTools/de.beyondco.herd.helper";
pub const HERD_HELPER_LABEL: &str = "de.beyondco.herd.helper";

// ── Public types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FindingSeverity {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorFinding {
    /// Stable machine id, e.g. `"binary.nginx.missing"`.
    pub id: String,
    pub severity: FindingSeverity,
    /// Category bucket for UI grouping.
    pub category: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

/// DNS mode classification (Key Decision 23).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DnsMode {
    /// Existing listener on :53 answers `*.{tld}` — adopt, do not spawn.
    D0Adopt,
    /// Badami dnsmasq LaunchDaemon on :53 (Mode B-lite).
    D1BLite,
    /// High-port resolver + unprivileged dnsmasq.
    D2HighPort,
    /// No working DNS; stack may still run without hostname URLs.
    D3Degraded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsProbeResult {
    pub hostname: String,
    pub tld: String,
    pub expected_loopback: String,
    /// Addresses returned by the system resolver (empty on failure).
    pub resolved: Vec<String>,
    /// True only when at least one answer equals expected loopback.
    pub healthy: bool,
    /// Resolver file path checked (e.g. `/etc/resolver/test`).
    pub resolver_path: String,
    pub resolver_present: bool,
    /// Port directive from resolver file if present; else default 53.
    pub resolver_port: u16,
    /// True when something accepts TCP on 127.0.0.1:53 (UDP not probed).
    pub port_53_listening: bool,
    /// Classified DNS mode after probe + unit detection.
    pub mode: DnsMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryCheck {
    pub role: String,
    pub service_id: String,
    pub path: Option<String>,
    pub present: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortCheck {
    pub port: u16,
    pub label: String,
    pub listening: bool,
    /// Soft note — who might own it (best-effort, no lsof requirement).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FpmSocketCheck {
    pub path: String,
    pub exists: bool,
    pub accepting: bool,
    pub php_tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FpmChdirCheck {
    pub conf_path: String,
    pub has_chdir: bool,
    pub chdir_value: Option<String>,
    pub expected_valet_server: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NginxTestResult {
    pub ran: bool,
    pub ok: bool,
    pub conf_path: Option<String>,
    pub binary: Option<String>,
    pub stdout: String,
    pub stderr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogSizeReport {
    pub logs_dir: String,
    pub total_bytes: u64,
    pub total_warn: bool,
    pub large_files: Vec<LogFileSize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogFileSize {
    pub path: String,
    pub bytes: u64,
    pub warn: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HerdHelperInfo {
    /// Path checked — report only; never invoke.
    pub path: String,
    pub present: bool,
    pub launch_daemon_label: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchdUnitInfo {
    pub label: String,
    /// Scaffold plist under local-dev/launchd.
    pub scaffold_path: Option<String>,
    pub scaffold_present: bool,
    /// Installed system plist under /Library/LaunchDaemons.
    pub system_plist_path: String,
    pub system_plist_present: bool,
    /// Best-effort: `launchctl print system/{label}` succeeded.
    pub loaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorRequest {
    /// TLD for DNS probe (default `"test"`).
    pub tld: Option<String>,
    /// Expected loopback (default `127.0.0.1`).
    pub loopback: Option<String>,
    /// Skip live network probes (unit tests).
    pub skip_live_probes: Option<bool>,
    /// Skip `nginx -t` subprocess (unit tests / sandboxes).
    pub skip_nginx_test: Option<bool>,
    /// Fixed hostname label for DNS probe (default random).
    pub dns_probe_label: Option<String>,
}

impl Default for DoctorRequest {
    fn default() -> Self {
        Self {
            tld: None,
            loopback: None,
            skip_live_probes: None,
            skip_nginx_test: None,
            dns_probe_label: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorReport {
    pub findings: Vec<DoctorFinding>,
    /// Aggregate: error > warn > ok.
    pub overall: String,
    pub dns: DnsProbeResult,
    pub binaries: Vec<BinaryCheck>,
    pub ports: Vec<PortCheck>,
    pub mariadb: MariadbPreflightReport,
    pub fpm_sockets: Vec<FpmSocketCheck>,
    pub fpm_chdir: Vec<FpmChdirCheck>,
    pub nginx_test: NginxTestResult,
    pub logs: LogSizeReport,
    pub herd_helper: HerdHelperInfo,
    pub launchd_dnsmasq: LaunchdUnitInfo,
    pub launchd_nginx: LaunchdUnitInfo,
    /// True when MariaDB preflight is OkToStart.
    pub ready_for_mariadb_start: bool,
    /// True when DNS resolve probe is healthy (Open site gate).
    pub dns_healthy: bool,
    pub notes: Vec<String>,
}

// ── DNS probe ───────────────────────────────────────────────────────

/// Resolve `label.{tld}` via the system resolver and expect loopback.
///
/// **Resolver-file presence alone is never healthy** (KD23).
pub fn run_dns_probe(
    tld: &str,
    loopback: &str,
    label: Option<&str>,
    skip_live: bool,
) -> DnsProbeResult {
    let tld = if tld.is_empty() { "test" } else { tld };
    let loopback = if loopback.is_empty() {
        "127.0.0.1"
    } else {
        loopback
    };
    let label = label
        .map(|s| s.to_string())
        .unwrap_or_else(random_dns_label);
    let hostname = format!("{label}.{tld}");
    let resolver_path = format!("/etc/resolver/{tld}");
    let resolver_present = Path::new(&resolver_path).is_file();
    let resolver_content = if resolver_present {
        fs::read_to_string(&resolver_path).ok()
    } else {
        None
    };
    let resolver_port = parse_resolver_port(resolver_content.as_deref()).unwrap_or(53);

    let mut notes = Vec::new();
    if resolver_present {
        notes.push(format!(
            "resolver file present at {resolver_path} (port={resolver_port}) — not sufficient alone"
        ));
    } else {
        notes.push(format!(
            "resolver file missing at {resolver_path} — macOS will not use a custom nameserver for *.{tld}"
        ));
    }

    let port_53_listening = if skip_live {
        false
    } else {
        // TCP probe on :53 is best-effort; many DNS servers are UDP-only.
        // Still useful when something accepts TCP (common for dnsmasq).
        tcp_accepting("127.0.0.1", 53)
    };

    let (resolved, healthy, error) = if skip_live {
        notes.push("skip_live_probes: DNS resolve skipped".into());
        (Vec::new(), false, Some("skipped".into()))
    } else {
        resolve_hostname(&hostname, loopback)
    };

    // Unit detection for mode classification.
    let d1_unit = launchd_unit_info(LD_DNSMASQ_LABEL, "dnsmasq");
    let mode = classify_dns_mode(
        healthy,
        resolver_port,
        port_53_listening,
        d1_unit.system_plist_present || d1_unit.loaded,
    );

    match mode {
        DnsMode::D0Adopt => notes.push(
            "DNS mode D0 (adopt): resolve healthy; existing :53 / system DNS answers *.tld".into(),
        ),
        DnsMode::D1BLite => notes.push(
            "DNS mode D1 (B-lite): Badami dnsmasq LaunchDaemon present; privileged :53".into(),
        ),
        DnsMode::D2HighPort => notes.push(format!(
            "DNS mode D2 (high-port): resolver port={resolver_port}; unprivileged dnsmasq expected"
        )),
        DnsMode::D3Degraded => notes.push(
            "DNS mode D3 (degraded): hostname URLs will not work until D0/D1/D2 is healthy".into(),
        ),
    }

    DnsProbeResult {
        hostname,
        tld: tld.to_string(),
        expected_loopback: loopback.to_string(),
        resolved,
        healthy,
        resolver_path,
        resolver_present,
        resolver_port,
        port_53_listening,
        mode,
        error,
        notes,
    }
}

fn classify_dns_mode(
    healthy: bool,
    resolver_port: u16,
    _port_53_listening: bool,
    badami_d1_unit: bool,
) -> DnsMode {
    if !healthy {
        return DnsMode::D3Degraded;
    }
    // Healthy resolve (port_53_listening is reported in probe notes only —
    // UDP-only DNS may not show TCP :53).
    if resolver_port != 53 && resolver_port != 0 {
        return DnsMode::D2HighPort;
    }
    if badami_d1_unit {
        return DnsMode::D1BLite;
    }
    // Existing working resolver answer → D0 adopt (do not spawn a second dnsmasq).
    DnsMode::D0Adopt
}

/// True when any resolved address is the expected loopback (IPv4/IPv6 equivalent).
///
/// Pure helper — used by the live probe and unit tests. Resolver-file presence
/// is intentionally not an input; it alone never makes DNS healthy (KD23).
pub fn addrs_match_loopback(resolved: &[String], expected_loopback: &str) -> bool {
    let expected_is_loopback = is_loopback_addr(expected_loopback);
    resolved.iter().any(|a| {
        a == expected_loopback || (expected_is_loopback && is_loopback_addr(a))
    })
}

fn is_loopback_addr(a: &str) -> bool {
    matches!(a, "127.0.0.1" | "::1" | "0:0:0:0:0:0:0:1")
}

fn resolve_hostname(hostname: &str, expected_loopback: &str) -> (Vec<String>, bool, Option<String>) {
    // ToSocketAddrs uses getaddrinfo / system resolver (honours /etc/resolver/* on macOS).
    let query = format!("{hostname}:0");
    // Soft timeout via thread — getaddrinfo can block on broken DNS.
    // MVP: on timeout the worker is not joined/cancelled and may linger until
    // getaddrinfo returns; repeated probes under broken DNS can accumulate threads.
    let (tx, rx) = std::sync::mpsc::channel();
    let query_owned = query.clone();
    std::thread::spawn(move || {
        let result = query_owned.to_socket_addrs().map(|iter| {
            iter.map(|a| a.ip().to_string())
                .collect::<Vec<_>>()
        });
        let _ = tx.send(result);
    });
    match rx.recv_timeout(Duration::from_millis(DNS_PROBE_TIMEOUT_MS)) {
        Ok(Ok(addrs)) => {
            // Dedupe while preserving order
            let mut resolved = Vec::new();
            for a in addrs {
                if !resolved.contains(&a) {
                    resolved.push(a);
                }
            }
            let healthy = addrs_match_loopback(&resolved, expected_loopback);
            let err = if healthy {
                None
            } else if resolved.is_empty() {
                Some(format!("no addresses for {hostname}"))
            } else {
                Some(format!(
                    "resolved {resolved:?} but expected {expected_loopback}"
                ))
            };
            (resolved, healthy, err)
        }
        Ok(Err(e)) => (Vec::new(), false, Some(format!("resolve {hostname}: {e}"))),
        Err(_) => (
            Vec::new(),
            false,
            Some(format!(
                "resolve {hostname}: timed out after {DNS_PROBE_TIMEOUT_MS}ms"
            )),
        ),
    }
}

fn random_dns_label() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("badami-probe-{:x}", nanos % 0xffff_ffff)
}

/// Parse `port N` from macOS resolver(5) file contents.
pub fn parse_resolver_port(content: Option<&str>) -> Option<u16> {
    let content = content?;
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let key = parts.next()?.to_ascii_lowercase();
        if key == "port" {
            let v = parts.next()?;
            return v.parse().ok();
        }
    }
    None
}

// ── LaunchDaemon unit inspection ────────────────────────────────────

pub fn launchd_unit_info(label: &str, scaffold_name: &str) -> LaunchdUnitInfo {
    let system_plist_path = format!("/Library/LaunchDaemons/{label}.plist");
    let system_plist_present = Path::new(&system_plist_path).is_file();

    let scaffold_path = build_runtime_paths().ok().map(|p| {
        PathBuf::from(&p.local_dev_root)
            .join("launchd")
            .join(format!("{scaffold_name}.plist"))
            .to_string_lossy()
            .into_owned()
    });
    let scaffold_present = scaffold_path
        .as_ref()
        .map(|p| Path::new(p).is_file())
        .unwrap_or(false);

    let loaded = probe_launchctl_loaded(label);

    LaunchdUnitInfo {
        label: label.to_string(),
        scaffold_path,
        scaffold_present,
        system_plist_path,
        system_plist_present,
        loaded,
    }
}

fn probe_launchctl_loaded(label: &str) -> bool {
    // Best-effort; may fail without privileges — never treat as hard error.
    let target = format!("system/{label}");
    match Command::new("launchctl")
        .args(["print", &target])
        .output()
    {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}

// ── Full doctor run ─────────────────────────────────────────────────

pub fn run_doctor(req: DoctorRequest) -> Result<DoctorReport, String> {
    let tld = req.tld.as_deref().unwrap_or("test");
    let loopback = req.loopback.as_deref().unwrap_or("127.0.0.1");
    let skip_live = req.skip_live_probes.unwrap_or(false);
    let skip_nginx = req.skip_nginx_test.unwrap_or(false);

    let paths = build_runtime_paths()?;
    let report = discover().map_err(|e| format!("ld_doctor: discovery failed: {e}"))?;

    let mut findings: Vec<DoctorFinding> = Vec::new();
    let mut notes: Vec<String> = Vec::new();

    // ── Binaries ────────────────────────────────────────────────────
    let specs = build_specs_from_discovery(&paths, &report);
    let binaries = collect_binary_checks(&specs);
    for b in &binaries {
        if !b.present {
            // Core plane: Error. Optional DNS / redis: Warn. php-fpm per-version: Error.
            let severity = binary_missing_severity(&b.service_id);
            findings.push(DoctorFinding {
                id: format!("binary.{}.missing", b.service_id),
                severity,
                category: "binary".into(),
                message: format!(
                    "Binary for {} not found{}",
                    b.service_id,
                    b.path
                        .as_ref()
                        .map(|p| format!(" (expected {p})"))
                        .unwrap_or_default()
                ),
                hint: Some(
                    "Install Herd.app resources, Homebrew packages, or configure binary paths."
                        .into(),
                ),
            });
        }
    }

    // ── Ports ───────────────────────────────────────────────────────
    let http_port = parse_nginx_http_port(&paths);
    let ports = collect_port_checks(http_port, skip_live);
    for p in &ports {
        if p.listening {
            findings.push(DoctorFinding {
                id: format!("port.{}.in_use", p.port),
                severity: FindingSeverity::Info,
                category: "port".into(),
                message: format!(
                    "Port {} ({}) is accepting connections on 127.0.0.1",
                    p.port, p.label
                ),
                hint: p.note.clone(),
            });
        } else if matches!(p.port, 8080 | 80) {
            // Not an error — stack may be stopped.
            findings.push(DoctorFinding {
                id: format!("port.{}.free", p.port),
                severity: FindingSeverity::Info,
                category: "port".into(),
                message: format!("Port {} ({}) is free", p.port, p.label),
                hint: None,
            });
        }
    }

    // ── MariaDB preflight + datadir locks (inspect-only — no mutate) ─
    let mariadb = run_preflight(MariadbPreflightRequest {
        skip_live_probes: Some(skip_live),
        // Doctor must not clear stale pid/socket files as a side effect of diagnostics.
        allow_mutate: Some(false),
        ..Default::default()
    })
    .unwrap_or_else(|e| MariadbPreflightReport {
        result: MariadbPreflight::HardFail {
            reason: format!("preflight error: {e}"),
        },
        wrapper_mycnf: None,
        datadir: None,
        basedir: None,
        socket: None,
        port: None,
        checks: vec![e],
        ready_for_mariadb_start: false,
    });

    match &mariadb.result {
        MariadbPreflight::OkToStart => {
            findings.push(DoctorFinding {
                id: "mariadb.ok_to_start".into(),
                severity: FindingSeverity::Info,
                category: "mariadb".into(),
                message: "MariaDB preflight: OkToStart".into(),
                hint: None,
            });
        }
        MariadbPreflight::Adopt { pid, reason } => {
            findings.push(DoctorFinding {
                id: "mariadb.adopt".into(),
                severity: FindingSeverity::Info,
                category: "mariadb".into(),
                message: format!(
                    "MariaDB preflight: Adopt{} — {reason}",
                    pid.map(|p| format!(" (pid {p})")).unwrap_or_default()
                ),
                hint: Some("Do not start a second mysqld/mariadbd on this datadir.".into()),
            });
        }
        MariadbPreflight::HardFail { reason } => {
            findings.push(DoctorFinding {
                id: "mariadb.hard_fail".into(),
                severity: FindingSeverity::Error,
                category: "mariadb".into(),
                message: format!("MariaDB preflight HardFail: {reason}"),
                hint: Some(
                    "Fix wrapper my.cnf / datadir lock before starting MariaDB. Never delete Herd datadir."
                        .into(),
                ),
            });
        }
    }

    // ── DNS resolve probe (not resolver-file-only) ──────────────────
    let dns = run_dns_probe(tld, loopback, req.dns_probe_label.as_deref(), skip_live);
    if !dns.healthy && !skip_live {
        findings.push(DoctorFinding {
            id: "dns.unhealthy".into(),
            severity: FindingSeverity::Error,
            category: "dns".into(),
            message: format!(
                "DNS resolve probe failed for {} (mode {:?})",
                dns.hostname, dns.mode
            ),
            hint: Some(
                "Resolver file alone is not healthy DNS. Install DNS Mode B-lite (D1), use high-port resolver (D2), or adopt an existing :53 listener (D0)."
                    .into(),
            ),
        });
    } else if dns.healthy {
        findings.push(DoctorFinding {
            id: "dns.healthy".into(),
            severity: FindingSeverity::Info,
            category: "dns".into(),
            message: format!(
                "DNS resolve probe OK: {} → {:?} (mode {:?})",
                dns.hostname, dns.resolved, dns.mode
            ),
            hint: None,
        });
    }
    if dns.resolver_present && !dns.healthy && !skip_live {
        findings.push(DoctorFinding {
            id: "dns.resolver_without_nameserver".into(),
            severity: FindingSeverity::Warn,
            category: "dns".into(),
            message: format!(
                "{} exists but resolve probe failed — not counting as healthy",
                dns.resolver_path
            ),
            hint: Some("Something must answer on the resolver nameserver/port (D0/D1/D2).".into()),
        });
    }
    notes.extend(dns.notes.iter().cloned());

    // ── nginx -t ────────────────────────────────────────────────────
    let nginx_test = run_nginx_test(&paths, &report, skip_nginx);
    if nginx_test.ran && !nginx_test.ok {
        findings.push(DoctorFinding {
            id: "nginx.test_failed".into(),
            severity: FindingSeverity::Error,
            category: "nginx".into(),
            message: "nginx -t failed".into(),
            hint: Some(
                nginx_test
                    .stderr
                    .lines()
                    .take(3)
                    .collect::<Vec<_>>()
                    .join(" | "),
            ),
        });
    } else if nginx_test.ran && nginx_test.ok {
        findings.push(DoctorFinding {
            id: "nginx.test_ok".into(),
            severity: FindingSeverity::Info,
            category: "nginx".into(),
            message: "nginx -t passed".into(),
            hint: None,
        });
    } else if let Some(ref reason) = nginx_test.skip_reason {
        findings.push(DoctorFinding {
            id: "nginx.test_skipped".into(),
            severity: FindingSeverity::Info,
            category: "nginx".into(),
            message: format!("nginx -t skipped: {reason}"),
            hint: None,
        });
    }

    // ── FPM sockets ─────────────────────────────────────────────────
    let fpm_sockets = collect_fpm_sockets(&paths, &specs, skip_live);
    for s in &fpm_sockets {
        if s.exists && !s.accepting && !skip_live {
            findings.push(DoctorFinding {
                id: format!(
                    "fpm.socket.stale.{}",
                    s.php_tag.as_deref().unwrap_or("unknown")
                ),
                severity: FindingSeverity::Warn,
                category: "fpm".into(),
                message: format!("FPM socket present but not accepting: {}", s.path),
                hint: Some("Stale socket inode? Start php-fpm or clear stale sock under local-dev/socks.".into()),
            });
        }
    }

    // ── FPM chdir sanity (KD24) ─────────────────────────────────────
    let fpm_chdir = collect_fpm_chdir(&paths);
    for c in &fpm_chdir {
        if !c.ok {
            findings.push(DoctorFinding {
                id: format!("fpm.chdir.bad.{}", path_basename(&c.conf_path)),
                severity: FindingSeverity::Error,
                category: "fpm".into(),
                message: format!(
                    "FPM pool missing or wrong chdir: {} (expected under valet-server)",
                    c.conf_path
                ),
                hint: Some("Regenerate configs with ld_generate_configs (KD24 chdir = valet-server).".into()),
            });
        }
    }

    // ── Herd helper (report only — never invoke) ────────────────────
    let herd_helper = HerdHelperInfo {
        path: HERD_HELPER_PATH.to_string(),
        present: Path::new(HERD_HELPER_PATH).is_file(),
        launch_daemon_label: HERD_HELPER_LABEL.to_string(),
        note: "Detected for Doctor only. Badami never invokes the Herd privileged helper (unsupported IPC)."
            .into(),
    };
    if herd_helper.present {
        findings.push(DoctorFinding {
            id: "herd.helper.present".into(),
            severity: FindingSeverity::Info,
            category: "herd".into(),
            message: format!(
                "Herd privileged helper present at {} (report only — never used)",
                herd_helper.path
            ),
            hint: Some(
                "If herd CLI still works you may use it alongside Badami; not an integration path."
                    .into(),
            ),
        });
    } else {
        findings.push(DoctorFinding {
            id: "herd.helper.absent".into(),
            severity: FindingSeverity::Info,
            category: "herd".into(),
            message: "Herd privileged helper not present".into(),
            hint: None,
        });
    }

    // ── Log sizes ───────────────────────────────────────────────────
    let logs = collect_log_sizes(&paths);
    if logs.total_warn {
        findings.push(DoctorFinding {
            id: "logs.total_large".into(),
            severity: FindingSeverity::Warn,
            category: "logs".into(),
            message: format!(
                "logs/ total size {} exceeds 500 MiB warning threshold",
                format_bytes(logs.total_bytes)
            ),
            hint: Some("Rotate or prune logs under local-dev/logs (supervisor rotates per-file at 50 MiB).".into()),
        });
    }
    for f in &logs.large_files {
        if f.warn {
            findings.push(DoctorFinding {
                id: format!("logs.file_large.{}", path_basename(&f.path)),
                severity: FindingSeverity::Warn,
                category: "logs".into(),
                message: format!(
                    "Log file {} is {} (> 50 MiB)",
                    f.path,
                    format_bytes(f.bytes)
                ),
                hint: Some("Supervisor will rotate on next ld_log_tail; or truncate manually.".into()),
            });
        }
    }

    // ── LaunchDaemon units (Mode B status) ──────────────────────────
    let launchd_dnsmasq = launchd_unit_info(LD_DNSMASQ_LABEL, "dnsmasq");
    let launchd_nginx = launchd_unit_info(LD_NGINX_LABEL, "nginx");
    if launchd_dnsmasq.system_plist_present {
        findings.push(DoctorFinding {
            id: "bootstrap.dnsmasq.installed".into(),
            severity: FindingSeverity::Info,
            category: "bootstrap".into(),
            message: format!(
                "Badami dnsmasq LaunchDaemon installed ({})",
                launchd_dnsmasq.system_plist_path
            ),
            hint: None,
        });
    }
    if launchd_nginx.system_plist_present {
        findings.push(DoctorFinding {
            id: "bootstrap.nginx.installed".into(),
            severity: FindingSeverity::Info,
            category: "bootstrap".into(),
            message: format!(
                "Badami nginx LaunchDaemon installed ({})",
                launchd_nginx.system_plist_path
            ),
            hint: None,
        });
    }

    // Config layout notes
    if !Path::new(&paths.valet_server).join("server.php").is_file() {
        findings.push(DoctorFinding {
            id: "runtime.valet_server.missing".into(),
            severity: FindingSeverity::Warn,
            category: "runtime".into(),
            message: "valet-server/server.php missing under local-dev".into(),
            hint: Some("Run ld_install_runtime_resources.".into()),
        });
    }

    let overall = overall_from_findings(&findings);
    let ready_for_mariadb_start = mariadb.ready_for_mariadb_start;
    let dns_healthy = dns.healthy;

    Ok(DoctorReport {
        findings,
        overall,
        dns,
        binaries,
        ports,
        mariadb,
        fpm_sockets,
        fpm_chdir,
        nginx_test,
        logs,
        herd_helper,
        launchd_dnsmasq,
        launchd_nginx,
        ready_for_mariadb_start,
        dns_healthy,
        notes,
    })
}

fn overall_from_findings(findings: &[DoctorFinding]) -> String {
    if findings
        .iter()
        .any(|f| f.severity == FindingSeverity::Error)
    {
        "error".into()
    } else if findings
        .iter()
        .any(|f| f.severity == FindingSeverity::Warn)
    {
        "warn".into()
    } else {
        "ok".into()
    }
}

/// Missing binary severity: core services Error; optional best-effort Warn.
fn binary_missing_severity(service_id: &str) -> FindingSeverity {
    match service_id {
        "dnsmasq" | "redis" => FindingSeverity::Warn,
        "nginx" | "mariadb" | "mysql" => FindingSeverity::Error,
        s if s.starts_with("php-fpm-") => FindingSeverity::Error,
        _ => FindingSeverity::Warn,
    }
}

fn collect_binary_checks(specs: &[ServiceSpec]) -> Vec<BinaryCheck> {
    specs
        .iter()
        .map(|s| BinaryCheck {
            role: format!("{:?}", s.kind).to_ascii_lowercase(),
            service_id: s.id.clone(),
            path: if s.binary_path.as_os_str().is_empty() {
                None
            } else {
                Some(s.binary_path.to_string_lossy().into_owned())
            },
            present: s.binary_present || s.binary_path.is_file(),
        })
        .collect()
}

fn collect_port_checks(http_port: u16, skip_live: bool) -> Vec<PortCheck> {
    let mut defs: Vec<(u16, &str, Option<String>)> = vec![
        (80, "http_privileged", Some("Mode B nginx or Herd".into())),
        (http_port, "http_mode_a", Some("Mode A unprivileged nginx".into())),
        (3306, "mariadb", None),
        (6379, "redis", None),
        (53, "dns", Some("TCP probe only; DNS is often UDP".into())),
    ];
    // Avoid duplicate if http_port is 80
    defs.dedup_by(|a, b| a.0 == b.0);

    defs.into_iter()
        .map(|(port, label, note)| PortCheck {
            port,
            label: label.into(),
            listening: if skip_live {
                false
            } else {
                tcp_accepting("127.0.0.1", port)
            },
            note,
        })
        .collect()
}

fn collect_fpm_sockets(paths: &RuntimePaths, specs: &[ServiceSpec], skip_live: bool) -> Vec<FpmSocketCheck> {
    let socks = PathBuf::from(&paths.socks);
    let mut out = Vec::new();

    // From specs: php-fpm health UnixSocket paths
    for s in specs {
        if !s.id.starts_with("php-fpm-") {
            continue;
        }
        let sock_path = extract_unix_socket(&s.health).unwrap_or_else(|| {
            // Fallback naming php{tag}.sock
            let tag = s.id.trim_start_matches("php-fpm-").replace('.', "");
            socks.join(format!("php{tag}.sock"))
        });
        let exists = sock_path.exists();
        let accepting = if skip_live || !exists {
            false
        } else {
            unix_socket_accepting(&sock_path)
        };
        let tag = sock_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.trim_start_matches("php").to_string());
        out.push(FpmSocketCheck {
            path: sock_path.to_string_lossy().into_owned(),
            exists,
            accepting,
            php_tag: tag,
        });
    }

    // Also scan socks dir for any extra sockets
    if let Ok(rd) = fs::read_dir(&socks) {
        for e in rd.flatten() {
            let p = e.path();
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if !name.ends_with(".sock") {
                continue;
            }
            let path_str = p.to_string_lossy().into_owned();
            if out.iter().any(|c| c.path == path_str) {
                continue;
            }
            let exists = p.exists();
            let accepting = if skip_live || !exists {
                false
            } else {
                unix_socket_accepting(&p)
            };
            out.push(FpmSocketCheck {
                path: path_str,
                exists,
                accepting,
                php_tag: p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.trim_start_matches("php").to_string()),
            });
        }
    }

    out
}

fn extract_unix_socket(health: &super::service_specs::HealthCheck) -> Option<PathBuf> {
    use super::service_specs::HealthCheck;
    match health {
        HealthCheck::UnixSocket { path } => Some(path.clone()),
        HealthCheck::Composite { checks } => {
            for c in checks {
                if let Some(p) = extract_unix_socket(c) {
                    return Some(p);
                }
            }
            None
        }
        _ => None,
    }
}

fn collect_fpm_chdir(paths: &RuntimePaths) -> Vec<FpmChdirCheck> {
    let fpm_dir = PathBuf::from(&paths.fpm);
    let expected = paths.valet_server.clone();
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(&fpm_dir) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|s| s.to_str()) != Some("conf") {
            continue;
        }
        let content = fs::read_to_string(&p).unwrap_or_default();
        let chdir_value = parse_fpm_chdir(&content);
        let has_chdir = chdir_value.is_some();
        let ok = chdir_value
            .as_ref()
            .map(|v| {
                let trimmed = v.trim_matches('"').trim_matches('\'');
                trimmed == expected
                    || Path::new(trimmed) == Path::new(&expected)
                    || trimmed.ends_with("/valet-server")
            })
            .unwrap_or(false);
        out.push(FpmChdirCheck {
            conf_path: p.to_string_lossy().into_owned(),
            has_chdir,
            chdir_value,
            expected_valet_server: expected.clone(),
            ok,
        });
    }
    out
}

/// Extract `chdir = value` from an FPM pool conf.
pub fn parse_fpm_chdir(content: &str) -> Option<String> {
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("chdir") {
            // original line for value
            let orig_rest = &line[line.len() - rest.len()..];
            let rest = orig_rest.trim_start();
            if let Some(rest) = rest.strip_prefix('=') {
                let v = rest.trim();
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}

fn run_nginx_test(
    paths: &RuntimePaths,
    report: &DiscoveryReport,
    skip: bool,
) -> NginxTestResult {
    if skip {
        return NginxTestResult {
            ran: false,
            ok: false,
            conf_path: None,
            binary: None,
            stdout: String::new(),
            stderr: String::new(),
            skip_reason: Some("skip_nginx_test".into()),
        };
    }

    let conf = PathBuf::from(&paths.nginx).join("nginx.conf");
    if !conf.is_file() {
        return NginxTestResult {
            ran: false,
            ok: false,
            conf_path: Some(conf.to_string_lossy().into_owned()),
            binary: None,
            stdout: String::new(),
            stderr: String::new(),
            skip_reason: Some("nginx.conf missing — run ld_generate_configs".into()),
        };
    }

    let binary = report
        .herd
        .nginx_binary
        .clone()
        .or_else(|| {
            report
                .candidates
                .iter()
                .find(|c| c.role == "nginx")
                .map(|c| c.path.clone())
        });

    let Some(bin) = binary.filter(|p| Path::new(p).is_file()) else {
        return NginxTestResult {
            ran: false,
            ok: false,
            conf_path: Some(conf.to_string_lossy().into_owned()),
            binary: None,
            stdout: String::new(),
            stderr: String::new(),
            skip_reason: Some("nginx binary not found".into()),
        };
    };

    // argv only — no shell.
    match Command::new(&bin)
        .args([
            "-t",
            "-c",
            &conf.to_string_lossy(),
            "-p",
            &paths.nginx,
        ])
        .output()
    {
        Ok(out) => NginxTestResult {
            ran: true,
            ok: out.status.success(),
            conf_path: Some(conf.to_string_lossy().into_owned()),
            binary: Some(bin),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            skip_reason: None,
        },
        Err(e) => NginxTestResult {
            ran: false,
            ok: false,
            conf_path: Some(conf.to_string_lossy().into_owned()),
            binary: Some(bin),
            stdout: String::new(),
            stderr: format!("failed to spawn nginx: {e}"),
            skip_reason: Some("spawn failed".into()),
        },
    }
}

fn collect_log_sizes(paths: &RuntimePaths) -> LogSizeReport {
    let logs_dir = paths.logs.clone();
    let dir = PathBuf::from(&logs_dir);
    let mut total_bytes = 0u64;
    let mut large_files = Vec::new();

    // Top-level files + one level of subdirs (not a full recursive tree walk).
    if let Ok(rd) = fs::read_dir(&dir) {
        let mut subdirs = Vec::new();
        for e in rd.flatten() {
            let p = e.path();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                subdirs.push(p);
                continue;
            }
            if !ft.is_file() {
                continue;
            }
            let bytes = e.metadata().map(|m| m.len()).unwrap_or(0);
            total_bytes = total_bytes.saturating_add(bytes);
            if bytes > LOG_FILE_WARN_BYTES {
                large_files.push(LogFileSize {
                    path: p.to_string_lossy().into_owned(),
                    bytes,
                    warn: true,
                });
            }
        }
        for sub in subdirs {
            if let Ok(rd) = fs::read_dir(&sub) {
                for e in rd.flatten() {
                    let p = e.path();
                    let Ok(ft) = e.file_type() else { continue };
                    if ft.is_symlink() || !ft.is_file() {
                        continue;
                    }
                    let bytes = e.metadata().map(|m| m.len()).unwrap_or(0);
                    total_bytes = total_bytes.saturating_add(bytes);
                    if bytes > LOG_FILE_WARN_BYTES {
                        large_files.push(LogFileSize {
                            path: p.to_string_lossy().into_owned(),
                            bytes,
                            warn: true,
                        });
                    }
                }
            }
        }
    }

    LogSizeReport {
        logs_dir,
        total_bytes,
        total_warn: total_bytes > LOGS_DIR_WARN_BYTES,
        large_files,
    }
}

fn path_basename(p: &str) -> String {
    Path::new(p)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(p)
        .to_string()
}

fn format_bytes(n: u64) -> String {
    const MIB: u64 = 1024 * 1024;
    const KIB: u64 = 1024;
    if n >= MIB {
        format!("{:.1} MiB", n as f64 / MIB as f64)
    } else if n >= KIB {
        format!("{:.1} KiB", n as f64 / KIB as f64)
    } else {
        format!("{n} B")
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_resolver_port_default_none() {
        assert_eq!(parse_resolver_port(None), None);
        assert_eq!(
            parse_resolver_port(Some("nameserver 127.0.0.1\n")),
            None
        );
    }

    #[test]
    fn parse_resolver_port_high() {
        let content = "nameserver 127.0.0.1\nport 53535\n";
        assert_eq!(parse_resolver_port(Some(content)), Some(53535));
    }

    #[test]
    fn parse_fpm_chdir_quoted() {
        let conf = "[www]\nuser = me\nchdir = \"/tmp/valet-server\"\n";
        assert_eq!(
            parse_fpm_chdir(conf).as_deref(),
            Some("\"/tmp/valet-server\"")
        );
    }

    #[test]
    fn parse_fpm_chdir_missing() {
        assert!(parse_fpm_chdir("listen = /tmp/x.sock\n").is_none());
    }

    #[test]
    fn classify_modes() {
        assert_eq!(
            classify_dns_mode(false, 53, false, false),
            DnsMode::D3Degraded
        );
        assert_eq!(
            classify_dns_mode(true, 53535, false, false),
            DnsMode::D2HighPort
        );
        assert_eq!(
            classify_dns_mode(true, 53, true, true),
            DnsMode::D1BLite
        );
        assert_eq!(
            classify_dns_mode(true, 53, true, false),
            DnsMode::D0Adopt
        );
        // Healthy without TCP :53 still D0 (UDP-only DNS)
        assert_eq!(
            classify_dns_mode(true, 53, false, false),
            DnsMode::D0Adopt
        );
    }

    #[test]
    fn resolver_file_alone_never_makes_dns_healthy() {
        // Pure: empty resolved addrs → not healthy regardless of "resolver present"
        // (resolver_present is not an input to addrs_match_loopback — KD23).
        assert!(!addrs_match_loopback(&[], "127.0.0.1"));
        assert!(!addrs_match_loopback(
            &["8.8.8.8".into()],
            "127.0.0.1"
        ));
        assert!(addrs_match_loopback(
            &["127.0.0.1".into()],
            "127.0.0.1"
        ));
        // IPv6 ↔ IPv4 loopback equivalence (both directions)
        assert!(addrs_match_loopback(&["::1".into()], "127.0.0.1"));
        assert!(addrs_match_loopback(&["127.0.0.1".into()], "::1"));
    }

    #[test]
    fn binary_severity_core_vs_optional() {
        assert_eq!(binary_missing_severity("nginx"), FindingSeverity::Error);
        assert_eq!(binary_missing_severity("mariadb"), FindingSeverity::Error);
        assert_eq!(
            binary_missing_severity("php-fpm-8.4"),
            FindingSeverity::Error
        );
        assert_eq!(binary_missing_severity("dnsmasq"), FindingSeverity::Warn);
        assert_eq!(binary_missing_severity("redis"), FindingSeverity::Warn);
    }

    #[test]
    fn doctor_uses_inspect_only_preflight() {
        let report = run_doctor(DoctorRequest {
            skip_live_probes: Some(true),
            skip_nginx_test: Some(true),
            dns_probe_label: Some("inspect-only".into()),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
        })
        .expect("doctor");
        // When wrapper exists, checks include mutate disabled; when missing,
        // hard-fail still has no "cleared" side effects.
        assert!(
            !report
                .mariadb
                .checks
                .iter()
                .any(|c| c.contains("cleared")),
            "doctor must not clear pid/socket; checks={:?}",
            report.mariadb.checks
        );
    }

    #[test]
    fn overall_severity_order() {
        let findings = vec![
            DoctorFinding {
                id: "a".into(),
                severity: FindingSeverity::Info,
                category: "x".into(),
                message: "i".into(),
                hint: None,
            },
            DoctorFinding {
                id: "b".into(),
                severity: FindingSeverity::Warn,
                category: "x".into(),
                message: "w".into(),
                hint: None,
            },
        ];
        assert_eq!(overall_from_findings(&findings), "warn");
        let mut with_err = findings;
        with_err.push(DoctorFinding {
            id: "c".into(),
            severity: FindingSeverity::Error,
            category: "x".into(),
            message: "e".into(),
            hint: None,
        });
        assert_eq!(overall_from_findings(&with_err), "error");
    }

    #[test]
    fn doctor_skip_live_smoke() {
        let report = run_doctor(DoctorRequest {
            skip_live_probes: Some(true),
            skip_nginx_test: Some(true),
            dns_probe_label: Some("unit-test".into()),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
        })
        .expect("doctor");
        assert!(!report.findings.is_empty() || report.overall == "ok" || report.overall == "warn" || report.overall == "error");
        assert_eq!(report.dns.hostname, "unit-test.test");
        assert!(!report.dns.healthy); // skipped
        // Never claim helper was invoked
        assert!(report.herd_helper.note.contains("never"));
        assert_eq!(report.herd_helper.path, HERD_HELPER_PATH);
    }

    #[test]
    fn dns_probe_skip_not_healthy() {
        let r = run_dns_probe("test", "127.0.0.1", Some("x"), true);
        assert!(!r.healthy);
        assert_eq!(r.mode, DnsMode::D3Degraded);
    }
}
