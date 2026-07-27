//! Optional Mode B / DNS bootstrap for Local Dev.
//!
//! Generates LaunchDaemon plists under Badami `local-dev/launchd/` and documents
//! that **actual install** into `/Library/LaunchDaemons` requires user admin
//! auth (`osascript` / installer). Default path is **write-plist only**
//! (`dry_run` / scaffold) — never silently elevates privileges.
//!
//! Packages (plan):
//! - `dns_only`     — D1 B-lite: dnsmasq LaunchDaemon on :53
//! - `dns_high_port`— D2: high-port resolver content + unprivileged dnsmasq conf
//! - `http_80`      — Mode B nginx LaunchDaemon on :80 (assumes DNS already OK)
//! - `full`         — dns_only + http_80
//!
//! Safety: never invokes Herd helper; never deletes Herd datadir; never removes
//! shared `/etc/resolver/*` without explicit Phase B uninstall (deferred).

use super::discovery::{build_runtime_paths, discover};
use super::doctor::{launchd_unit_info, parse_resolver_port, LD_DNSMASQ_LABEL, LD_NGINX_LABEL};
use super::service_specs::{parse_dnsmasq_port, parse_nginx_http_port};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

// Bundle identifier from tauri.conf.json + `.local-dev.*` (KD plan note #5).
// Labels live in doctor.rs as `com.khalid.badami.local-dev.*` — keep in sync.
pub const BUNDLE_ID: &str = "com.khalid.badami";

const DEFAULT_HIGH_DNS_PORT: u16 = 53535;
const SYSTEM_LAUNCH_DAEMONS: &str = "/Library/LaunchDaemons";

/// Full LaunchDaemon label for a local-dev role (`dnsmasq`, `nginx`, …).
pub fn launchd_label(role: &str) -> String {
    format!("{BUNDLE_ID}.local-dev.{role}")
}

// ── Public types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BootstrapPackage {
    /// D1 B-lite — dnsmasq LaunchDaemon only (recommended first).
    DnsOnly,
    /// D2 — high-port resolver rewrite + unprivileged dnsmasq on that port.
    DnsHighPort,
    /// Mode B HTTP — nginx LaunchDaemon on :80.
    Http80,
    /// dns_only + http_80.
    Full,
}

impl BootstrapPackage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::DnsOnly => "dns_only",
            Self::DnsHighPort => "dns_high_port",
            Self::Http80 => "http_80",
            Self::Full => "full",
        }
    }

    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "dns_only" => Ok(Self::DnsOnly),
            "dns_high_port" => Ok(Self::DnsHighPort),
            "http_80" => Ok(Self::Http80),
            "full" => Ok(Self::Full),
            other => Err(format!(
                "unknown bootstrap package {other:?}; expected dns_only|dns_high_port|http_80|full"
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapInstallRequest {
    /// `dns_only` | `dns_high_port` | `http_80` | `full`
    pub package: String,
    /// When true (default): write LaunchDaemon scaffolds under local-dev/launchd
    /// only — do **not** elevate or copy into `/Library/LaunchDaemons`.
    ///
    /// **Not zero-disk:** dry_run still creates/overwrites plists and helper
    /// scripts under Application Support (write-plist / scaffold mode). Use
    /// `attempt_privileged_install` separately for system install.
    pub dry_run: Option<bool>,
    /// TLD for resolver / dnsmasq (default `test`).
    pub tld: Option<String>,
    /// Loopback (default `127.0.0.1`).
    pub loopback: Option<String>,
    /// DNS port for D2 high-port package (default 53535).
    pub dns_port: Option<u16>,
    /// Optional override for nginx binary path.
    pub nginx_binary: Option<String>,
    /// Optional override for dnsmasq binary path.
    pub dnsmasq_binary: Option<String>,
    /// When true **and** `dry_run` is false, attempt `osascript` admin copy+load.
    /// Still requires interactive user approval. Default false.
    pub attempt_privileged_install: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapInstallResult {
    pub package: String,
    pub dry_run: bool,
    pub privileged_attempted: bool,
    pub privileged_ok: bool,
    /// Files written under local-dev (plists, install scripts, resolver draft).
    pub written: Vec<String>,
    /// Human-readable steps for the user to complete install with auth.
    pub install_instructions: Vec<String>,
    /// Suggested shell one-liner (runs install.sh with admin via osascript).
    pub install_command: Option<String>,
    pub notes: Vec<String>,
    pub units: Vec<BootstrapUnitScaffold>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapUnitScaffold {
    pub label: String,
    pub role: String,
    pub scaffold_plist: String,
    pub system_plist_target: String,
    pub program_arguments: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapStatus {
    pub dnsmasq: super::doctor::LaunchdUnitInfo,
    pub nginx: super::doctor::LaunchdUnitInfo,
    pub resolver_path: String,
    pub resolver_present: bool,
    pub resolver_port: Option<u16>,
    pub dns_bootstrap_complete: bool,
    pub http_bootstrap_complete: bool,
    /// Port nginx is actually configured to listen on (from the generated conf).
    pub nginx_listen_port: u16,
    /// Port `dnsmasq.conf` is actually configured to bind.
    pub dnsmasq_conf_port: u16,
    /// Port macOS will query for `*.tld` — a resolver file with no `port` line
    /// means 53.
    pub resolver_effective_port: u16,
    /// The resolver file and `dnsmasq.conf` disagree, so DNS can never resolve.
    pub dns_port_mismatch: bool,
    /// Recommended next package for the user.
    pub recommended_package: String,
    pub notes: Vec<String>,
    /// Scaffold directory under local-dev.
    pub launchd_dir: String,
}

// ── Status ──────────────────────────────────────────────────────────

pub fn bootstrap_status(tld: Option<&str>) -> Result<BootstrapStatus, String> {
    let tld = tld.unwrap_or("test");
    let paths = build_runtime_paths()?;
    let launchd_dir = PathBuf::from(&paths.local_dev_root)
        .join("launchd")
        .to_string_lossy()
        .into_owned();

    let dnsmasq = launchd_unit_info(LD_DNSMASQ_LABEL, "dnsmasq");
    let nginx = launchd_unit_info(LD_NGINX_LABEL, "nginx");

    let resolver_path = format!("/etc/resolver/{tld}");
    let resolver_present = Path::new(&resolver_path).is_file();
    let resolver_port = if resolver_present {
        parse_resolver_port(fs::read_to_string(&resolver_path).ok().as_deref())
    } else {
        None
    };

    let nginx_listen_port = parse_nginx_http_port(&paths);
    let dnsmasq_conf_port = parse_dnsmasq_port(&paths);
    // No `port` line in a resolver file means the default, 53.
    let resolver_effective_port = resolver_port.unwrap_or(53);
    // Only meaningful once a resolver file exists; without one macOS never
    // consults dnsmasq at all, which is a different problem.
    let dns_port_mismatch = resolver_present && resolver_effective_port != dnsmasq_conf_port;

    let dns_bootstrap_complete = dnsmasq.system_plist_present || dnsmasq.loaded;
    // Unit presence alone used to count as done, which reported a green check
    // while nginx was still configured for :8080. The listen port is the fact
    // that decides whether Mode B is actually in effect.
    let http_bootstrap_complete =
        (nginx.system_plist_present || nginx.loaded) && nginx_listen_port == 80;

    let mut notes = Vec::new();
    notes.push(
        "Actual LaunchDaemon install requires admin auth (osascript). Scaffold files live under local-dev/launchd/."
            .into(),
    );
    notes.push(
        "Badami never invokes the Herd privileged helper. Mode B units are Badami-owned only.".into(),
    );

    let recommended_package = if !dns_bootstrap_complete {
        if resolver_present && resolver_port.unwrap_or(53) != 53 {
            "dns_high_port"
        } else {
            "dns_only"
        }
    } else if !http_bootstrap_complete {
        "http_80"
    } else {
        "full"
    };

    Ok(BootstrapStatus {
        dnsmasq,
        nginx,
        resolver_path,
        resolver_present,
        resolver_port,
        dns_bootstrap_complete,
        http_bootstrap_complete,
        nginx_listen_port,
        dnsmasq_conf_port,
        resolver_effective_port,
        dns_port_mismatch,
        recommended_package: recommended_package.into(),
        notes,
        launchd_dir,
    })
}

// ── Install (scaffold / optional privileged) ────────────────────────

pub fn bootstrap_install(req: BootstrapInstallRequest) -> Result<BootstrapInstallResult, String> {
    let package = BootstrapPackage::parse(&req.package)?;
    let dry_run = req.dry_run.unwrap_or(true);
    let attempt_priv = req.attempt_privileged_install.unwrap_or(false) && !dry_run;
    let tld = req.tld.as_deref().unwrap_or("test");
    let loopback = req.loopback.as_deref().unwrap_or("127.0.0.1");
    let dns_port = req.dns_port.unwrap_or(match package {
        BootstrapPackage::DnsHighPort => DEFAULT_HIGH_DNS_PORT,
        _ => 53,
    });

    validate_tld(tld)?;
    validate_loopback(loopback)?;

    let paths = build_runtime_paths()?;
    let report = discover().ok();
    let launchd_dir = PathBuf::from(&paths.local_dev_root).join("launchd");
    fs::create_dir_all(&launchd_dir)
        .map_err(|e| format!("mkdir launchd: {e}"))?;

    let mut written = Vec::new();
    let mut notes = Vec::new();
    let mut units = Vec::new();
    let mut install_instructions = Vec::new();

    // Resolve binaries
    let dnsmasq_bin = req
        .dnsmasq_binary
        .clone()
        .or_else(|| {
            report.as_ref().and_then(|r| {
                r.herd
                    .dnsmasq_binary
                    .clone()
                    .or_else(|| {
                        r.candidates
                            .iter()
                            .find(|c| c.role == "dnsmasq")
                            .map(|c| c.path.clone())
                    })
            })
        })
        .unwrap_or_default();

    let nginx_bin = req
        .nginx_binary
        .clone()
        .or_else(|| {
            report.as_ref().and_then(|r| {
                r.herd.nginx_binary.clone().or_else(|| {
                    r.candidates
                        .iter()
                        .find(|c| c.role == "nginx")
                        .map(|c| c.path.clone())
                })
            })
        })
        .unwrap_or_default();

    let need_dns = matches!(
        package,
        BootstrapPackage::DnsOnly | BootstrapPackage::Full | BootstrapPackage::DnsHighPort
    );
    let need_http = matches!(package, BootstrapPackage::Http80 | BootstrapPackage::Full);

    if need_dns {
        match package {
            BootstrapPackage::DnsHighPort => {
                // D2: write high-port resolver draft + note unprivileged dnsmasq
                let resolver_draft = write_resolver_draft(
                    &launchd_dir,
                    tld,
                    loopback,
                    dns_port,
                    &mut written,
                )?;
                notes.push(format!(
                    "D2: wrote resolver draft at {resolver_draft} — copy to /etc/resolver/{tld} with admin auth"
                ));
                notes.push(format!(
                    "D2: regenerate dnsmasq with dns_port={dns_port} via ld_generate_configs; run unprivileged (no LaunchDaemon required for DNS)"
                ));
                install_instructions.push(format!(
                    "Copy resolver: sudo cp {resolver_draft} /etc/resolver/{tld}"
                ));
                install_instructions.push(format!(
                    "Ensure Badami dnsmasq.conf uses port {dns_port} (ld_generate_configs dns_port={dns_port})"
                ));
                install_instructions.push(
                    "Start dnsmasq via ld_service_start / stack (unprivileged high port)".into(),
                );

                // Still scaffold a user-facing install script for the resolver copy.
                let script = write_resolver_install_script(
                    &launchd_dir,
                    tld,
                    &resolver_draft,
                    &mut written,
                )?;
                notes.push(format!("Resolver install helper: {script}"));
            }
            _ => {
                // D1: privileged dnsmasq LaunchDaemon on :53
                if dnsmasq_bin.is_empty() || !Path::new(&dnsmasq_bin).is_file() {
                    notes.push(
                        "dnsmasq binary not found — plist still written; fix binary path before load"
                            .into(),
                    );
                }
                let conf = PathBuf::from(&paths.local_dev_root)
                    .join("dnsmasq")
                    .join("dnsmasq.conf");
                if !conf.is_file() {
                    notes.push(
                        "dnsmasq.conf missing — run ld_generate_configs before loading the unit"
                            .into(),
                    );
                }
                let pid_file = PathBuf::from(&paths.pids).join("dnsmasq.pid");
                let log_file = PathBuf::from(&paths.logs).join("dnsmasq.log");
                let args = vec![
                    dnsmasq_bin.clone(),
                    "--keep-in-foreground".into(),
                    "--conf-file".into(),
                    conf.to_string_lossy().into_owned(),
                    "--pid-file".into(),
                    pid_file.to_string_lossy().into_owned(),
                    "--log-facility".into(),
                    log_file.to_string_lossy().into_owned(),
                ];
                let plist_path = launchd_dir.join("dnsmasq.plist");
                let body = render_launch_daemon_plist(
                    LD_DNSMASQ_LABEL,
                    &args,
                    true, // RunAtLoad
                    true, // KeepAlive
                );
                write_scaffold(&plist_path, &body, &mut written)?;
                units.push(BootstrapUnitScaffold {
                    label: LD_DNSMASQ_LABEL.into(),
                    role: "dnsmasq".into(),
                    scaffold_plist: plist_path.to_string_lossy().into_owned(),
                    system_plist_target: format!(
                        "{SYSTEM_LAUNCH_DAEMONS}/{LD_DNSMASQ_LABEL}.plist"
                    ),
                    program_arguments: args,
                });
                install_instructions.push(format!(
                    "Install DNS (D1 B-lite): copy {LD_DNSMASQ_LABEL}.plist into {SYSTEM_LAUNCH_DAEMONS} and launchctl bootstrap/load as root"
                ));
            }
        }
    }

    if need_http {
        if nginx_bin.is_empty() || !Path::new(&nginx_bin).is_file() {
            notes.push(
                "nginx binary not found — plist still written; fix binary path before load".into(),
            );
        }
        let conf = PathBuf::from(&paths.nginx).join("nginx.conf");
        if !conf.is_file() {
            notes.push(
                "nginx.conf missing — run ld_generate_configs (prefer http_port=80, nginx_as_root=true) before loading"
                    .into(),
            );
        }
        let args = vec![
            nginx_bin.clone(),
            "-g".into(),
            "daemon off;".into(),
            "-c".into(),
            conf.to_string_lossy().into_owned(),
            "-p".into(),
            paths.nginx.clone(),
        ];
        let plist_path = launchd_dir.join("nginx.plist");
        // RunAtLoad=false, KeepAlive=false so UI Start/Stop map to kickstart/kill
        // (KeepAlive=true would fight Stop and restart the master).
        let body = render_launch_daemon_plist(LD_NGINX_LABEL, &args, false, false);
        write_scaffold(&plist_path, &body, &mut written)?;
        units.push(BootstrapUnitScaffold {
            label: LD_NGINX_LABEL.into(),
            role: "nginx".into(),
            scaffold_plist: plist_path.to_string_lossy().into_owned(),
            system_plist_target: format!("{SYSTEM_LAUNCH_DAEMONS}/{LD_NGINX_LABEL}.plist"),
            program_arguments: args,
        });
        install_instructions.push(
            "Before loading nginx Mode B: regenerate configs with http_port=80 and nginx_as_root=true"
                .into(),
        );
        install_instructions.push(format!(
            "Install HTTP Mode B: copy {LD_NGINX_LABEL}.plist into {SYSTEM_LAUNCH_DAEMONS} and launchctl load as root"
        ));
    }

    // Unified install.sh for units that need system LaunchDaemons
    // Paths under Application Support contain spaces — always shell-quote.
    let install_script_path: Option<PathBuf> = if !units.is_empty() {
        let script_path = write_install_script(&launchd_dir, &units, &mut written)?;
        notes.push(format!("Wrote install helper script: {script_path}"));
        install_instructions.push(format!(
            "Run with admin prompt: bash {}",
            shell_single_quote(&script_path)
        ));
        install_instructions.push(
            "dry_run still writes scaffolds under local-dev/launchd/ — review before privileged install"
                .into(),
        );
        Some(PathBuf::from(script_path))
    } else if matches!(package, BootstrapPackage::DnsHighPort) {
        Some(launchd_dir.join("install-resolver.sh"))
    } else {
        None
    };

    let install_command = install_script_path
        .as_ref()
        .map(|p| format!("bash {}", shell_single_quote(&p.to_string_lossy())));

    notes.push(format!(
        "package={} dry_run={} — dry_run writes scaffolds under local-dev only; privileged system install is {}",
        package.as_str(),
        dry_run,
        if dry_run {
            "NOT attempted"
        } else {
            "opt-in only via attempt_privileged_install"
        }
    ));

    let mut privileged_ok = false;
    if attempt_priv {
        if let Some(ref script) = install_script_path {
            notes.push("Attempting privileged install via install script (osascript)…".into());
            // argv-only: no bash -c, so Application Support spaces are safe.
            match Command::new("bash").arg(script).output() {
                Ok(out) => {
                    privileged_ok = out.status.success();
                    if !out.stdout.is_empty() {
                        notes.push(format!(
                            "install stdout: {}",
                            String::from_utf8_lossy(&out.stdout)
                        ));
                    }
                    if !out.stderr.is_empty() {
                        notes.push(format!(
                            "install stderr: {}",
                            String::from_utf8_lossy(&out.stderr)
                        ));
                    }
                    if !privileged_ok {
                        notes.push(
                            "Privileged install failed or was cancelled — scaffolds remain for manual install"
                                .into(),
                        );
                    }
                }
                Err(e) => {
                    notes.push(format!("Failed to spawn install script: {e}"));
                }
            }
        } else {
            notes.push("No install script for this package; nothing privileged to run".into());
        }
    } else if !dry_run {
        notes.push(
            "dry_run=false but attempt_privileged_install not set — scaffolds only (safe default)"
                .into(),
        );
    }

    // Always document uninstall deferral
    notes.push(
        "ld_bootstrap_uninstall is Phase B optional — would remove only Badami-written units, never shared Herd resolver without confirm"
            .into(),
    );

    Ok(BootstrapInstallResult {
        package: package.as_str().into(),
        dry_run,
        privileged_attempted: attempt_priv,
        privileged_ok,
        written,
        install_instructions,
        install_command,
        notes,
        units,
    })
}

// ── Plist / script writers ──────────────────────────────────────────

/// Escape a string for embedding in XML plist.
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Render a minimal root LaunchDaemon plist (ProgramArguments argv only).
pub fn render_launch_daemon_plist(
    label: &str,
    program_arguments: &[String],
    run_at_load: bool,
    keep_alive: bool,
) -> String {
    let mut args_xml = String::new();
    for a in program_arguments {
        args_xml.push_str(&format!("\t\t<string>{}</string>\n", xml_escape(a)));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{label}</string>
	<key>ProgramArguments</key>
	<array>
{args_xml}	</array>
	<key>RunAtLoad</key>
	<{run_at_load}/>
	<key>KeepAlive</key>
	<{keep_alive}/>
	<key>StandardOutPath</key>
	<string>/tmp/{label}.out.log</string>
	<key>StandardErrorPath</key>
	<string>/tmp/{label}.err.log</string>
</dict>
</plist>
"#,
        label = xml_escape(label),
        args_xml = args_xml,
        run_at_load = if run_at_load { "true" } else { "false" },
        keep_alive = if keep_alive { "true" } else { "false" },
    )
}

fn write_scaffold(path: &Path, body: &str, written: &mut Vec<String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    fs::write(path, body).map_err(|e| format!("write {}: {e}", path.display()))?;
    written.push(path.to_string_lossy().into_owned());
    Ok(())
}

fn write_resolver_draft(
    launchd_dir: &Path,
    tld: &str,
    loopback: &str,
    port: u16,
    written: &mut Vec<String>,
) -> Result<String, String> {
    let path = launchd_dir.join(format!("resolver-{tld}"));
    let body = format!(
        "# Badami Local Dev — macOS resolver(5) draft for *.{tld}\n\
         # Install: sudo cp this file to /etc/resolver/{tld}\n\
         # D2 high-port DNS (KD23) — nameserver on non-53 port.\n\
         nameserver {loopback}\n\
         port {port}\n"
    );
    write_scaffold(&path, &body, written)?;
    Ok(path.to_string_lossy().into_owned())
}

fn write_resolver_install_script(
    launchd_dir: &Path,
    tld: &str,
    draft_path: &str,
    written: &mut Vec<String>,
) -> Result<String, String> {
    let path = launchd_dir.join("install-resolver.sh");
    let body = format!(
        r#"#!/bin/bash
# Badami Local Dev — install /etc/resolver/{tld} (D2). Requires admin.
# Generated scaffold — review before running.
set -euo pipefail
DRAFT="{draft}"
DEST="/etc/resolver/{tld}"
echo "Will install resolver for *.{tld} from:"
echo "  $DRAFT"
echo "  → $DEST"
osascript -e "do shell script \"mkdir -p /etc/resolver && cp '$(echo "$DRAFT" | sed \"s/'/'\\\\''/g\")' '$DEST' && chmod 644 '$DEST'\" with administrator privileges"
echo "Installed $DEST"
echo "Flush DNS cache: sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder || true"
"#,
        tld = tld,
        draft = draft_path,
    );
    write_scaffold(&path, &body, written)?;
    // best-effort chmod +x
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o755));
    }
    Ok(path.to_string_lossy().into_owned())
}

fn write_install_script(
    launchd_dir: &Path,
    units: &[BootstrapUnitScaffold],
    written: &mut Vec<String>,
) -> Result<String, String> {
    let path = launchd_dir.join("install-launchdaemons.sh");
    let mut copies = String::new();
    let mut loads = String::new();
    for u in units {
        // Escape single quotes for shell.
        let src = u.scaffold_plist.replace('\'', "'\\''");
        let dst = u.system_plist_target.replace('\'', "'\\''");
        let label = u.label.replace('\'', "'\\''");
        copies.push_str(&format!("cp '{src}' '{dst}' && chmod 644 '{dst}'\n"));
        // modern + legacy load for broader macOS coverage
        loads.push_str(&format!(
            "launchctl bootout system/{label} 2>/dev/null || true\n\
             launchctl bootstrap system '{dst}' 2>/dev/null || launchctl load -w '{dst}'\n\
             launchctl enable system/{label} 2>/dev/null || true\n\
             launchctl kickstart -k system/{label} 2>/dev/null || true\n"
        ));
    }

    let combined_shell = format!("{copies}{loads}");
    // For osascript, escape backslashes and quotes carefully — pass via a temp script
    // that the admin shell runs, so we avoid nested quoting hell.
    let inner_script = launchd_dir.join("_privileged-install.sh");
    let inner_body = format!(
        "#!/bin/bash\nset -euo pipefail\n# Auto-generated privileged body — Badami Local Dev\n{combined_shell}echo 'Badami LaunchDaemon install finished'\n"
    );
    write_scaffold(&inner_script, &inner_body, written)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&inner_script, fs::Permissions::from_mode(0o755));
    }

    let inner = inner_script.to_string_lossy().replace('\'', "'\\''");
    let body = format!(
        r#"#!/bin/bash
# Badami Local Dev — install LaunchDaemons (Mode B / D1).
# Requires interactive admin authentication via osascript.
# Review plists under this directory before running.
set -euo pipefail
INNER='{inner}'
echo "Badami Local Dev bootstrap"
echo "Will run privileged install script:"
echo "  $INNER"
echo "Labels:"
{labels}
osascript -e "do shell script \"bash '$INNER'\" with administrator privileges"
echo "Done. Check: launchctl print system/{first_label}"
"#,
        inner = inner,
        labels = units
            .iter()
            .map(|u| format!("echo \"  - {}\"", u.label))
            .collect::<Vec<_>>()
            .join("\n"),
        first_label = units
            .first()
            .map(|u| u.label.as_str())
            .unwrap_or(LD_DNSMASQ_LABEL),
    );
    write_scaffold(&path, &body, written)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o755));
    }
    Ok(path.to_string_lossy().into_owned())
}

fn validate_tld(tld: &str) -> Result<(), String> {
    if tld.is_empty() || tld.len() > 63 {
        return Err("tld must be 1–63 characters".into());
    }
    if tld.contains('/') || tld.contains('.') || tld.contains("..") {
        return Err("tld must be a single label without dots or path separators".into());
    }
    if !tld
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("tld contains invalid characters".into());
    }
    Ok(())
}

/// Single-quote a path for POSIX shells (`'foo'\''bar'` style).
pub fn shell_single_quote(s: &str) -> String {
    if s.is_empty() {
        return "''".into();
    }
    // Wrap in single quotes; replace each ' with '\'' sequence.
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

fn validate_loopback(loopback: &str) -> Result<(), String> {
    if loopback != "127.0.0.1" && loopback != "::1" {
        // Allow only loopback for bootstrap safety.
        return Err(format!(
            "loopback must be 127.0.0.1 or ::1 (got {loopback})"
        ));
    }
    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_parse() {
        assert_eq!(
            BootstrapPackage::parse("dns_only").unwrap(),
            BootstrapPackage::DnsOnly
        );
        assert_eq!(
            BootstrapPackage::parse("full").unwrap(),
            BootstrapPackage::Full
        );
        assert!(BootstrapPackage::parse("nope").is_err());
    }

    #[test]
    fn launchd_labels_match_bundle() {
        assert_eq!(launchd_label("dnsmasq"), LD_DNSMASQ_LABEL);
        assert_eq!(launchd_label("nginx"), LD_NGINX_LABEL);
        assert!(launchd_label("dnsmasq").starts_with(BUNDLE_ID));
    }

    #[test]
    fn shell_quote_handles_application_support_spaces() {
        let p = "/Users/me/Library/Application Support/Badami/local-dev/launchd/install.sh";
        let q = shell_single_quote(p);
        assert_eq!(
            q,
            "'/Users/me/Library/Application Support/Badami/local-dev/launchd/install.sh'"
        );
        assert!(q.contains("Application Support"));
        // Embedded single quote
        assert_eq!(shell_single_quote("a'b"), "'a'\\''b'");
    }

    #[test]
    fn install_command_quotes_spaces() {
        let res = bootstrap_install(BootstrapInstallRequest {
            package: "dns_only".into(),
            dry_run: Some(true),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: None,
            nginx_binary: None,
            dnsmasq_binary: Some("/usr/bin/true".into()),
            attempt_privileged_install: Some(false),
        })
        .expect("install");
        let cmd = res.install_command.expect("install_command");
        assert!(
            cmd.starts_with("bash '") && cmd.ends_with('\''),
            "expected quoted path, got {cmd}"
        );
        assert!(
            cmd.contains("Application Support") || cmd.contains("local-dev"),
            "cmd={cmd}"
        );
        // No unquoted space between bash and path
        assert!(!cmd.starts_with("bash /"), "unquoted path: {cmd}");
    }

    #[test]
    fn plist_contains_label_and_args() {
        let xml = render_launch_daemon_plist(
            LD_DNSMASQ_LABEL,
            &["/usr/sbin/dnsmasq".into(), "--keep-in-foreground".into()],
            true,
            true,
        );
        assert!(xml.contains(LD_DNSMASQ_LABEL));
        assert!(xml.contains("/usr/sbin/dnsmasq"));
        assert!(xml.contains("keep-in-foreground"));
        assert!(xml.contains("<true/>"));
        assert!(xml.contains("ProgramArguments"));
        // XML escape
        let xml2 = render_launch_daemon_plist("x", &["a<b".into()], false, false);
        assert!(xml2.contains("a&lt;b"));
        assert!(xml2.contains("<false/>"));
    }

    #[test]
    fn bootstrap_status_smoke() {
        let st = bootstrap_status(Some("test")).expect("status");
        assert!(st.launchd_dir.contains("local-dev"));
        assert_eq!(st.dnsmasq.label, LD_DNSMASQ_LABEL);
        assert_eq!(st.nginx.label, LD_NGINX_LABEL);
        assert!(!st.recommended_package.is_empty());
    }

    #[test]
    fn bootstrap_install_dry_run_dns_only() {
        let res = bootstrap_install(BootstrapInstallRequest {
            package: "dns_only".into(),
            dry_run: Some(true),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: None,
            nginx_binary: None,
            dnsmasq_binary: Some("/usr/bin/true".into()), // may not be dnsmasq but path exists on macOS? use a known file
            attempt_privileged_install: Some(false),
        })
        .expect("install");
        assert!(res.dry_run);
        assert!(!res.privileged_attempted);
        assert!(!res.written.is_empty());
        assert!(res.units.iter().any(|u| u.role == "dnsmasq"));
        // Plist on disk
        let plist = res
            .written
            .iter()
            .find(|p| p.ends_with("dnsmasq.plist"))
            .expect("plist written");
        let body = fs::read_to_string(plist).unwrap();
        assert!(body.contains(LD_DNSMASQ_LABEL));
        assert!(res.install_command.is_some());
    }

    #[test]
    fn bootstrap_install_high_port_resolver() {
        let res = bootstrap_install(BootstrapInstallRequest {
            package: "dns_high_port".into(),
            dry_run: Some(true),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: Some(53535),
            nginx_binary: None,
            dnsmasq_binary: None,
            attempt_privileged_install: None,
        })
        .expect("install");
        assert!(res.written.iter().any(|p| p.contains("resolver-test")));
        let draft = res
            .written
            .iter()
            .find(|p| p.contains("resolver-test"))
            .unwrap();
        let body = fs::read_to_string(draft).unwrap();
        assert!(body.contains("port 53535"));
        assert!(body.contains("nameserver 127.0.0.1"));
    }

    #[test]
    fn bootstrap_install_full_scaffolds_both() {
        let res = bootstrap_install(BootstrapInstallRequest {
            package: "full".into(),
            dry_run: Some(true),
            tld: Some("test".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: None,
            nginx_binary: Some("/usr/bin/true".into()),
            dnsmasq_binary: Some("/usr/bin/true".into()),
            attempt_privileged_install: None,
        })
        .expect("install");
        assert_eq!(res.units.len(), 2);
        assert!(res.units.iter().any(|u| u.label == LD_DNSMASQ_LABEL));
        assert!(res.units.iter().any(|u| u.label == LD_NGINX_LABEL));
    }

    #[test]
    fn reject_bad_tld() {
        let err = bootstrap_install(BootstrapInstallRequest {
            package: "dns_only".into(),
            dry_run: Some(true),
            tld: Some("../etc".into()),
            loopback: Some("127.0.0.1".into()),
            dns_port: None,
            nginx_binary: None,
            dnsmasq_binary: None,
            attempt_privileged_install: None,
        })
        .unwrap_err();
        assert!(err.contains("tld"));
    }
}
