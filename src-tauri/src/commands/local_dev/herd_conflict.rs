//! Herd coexistence detection.
//!
//! Badami reuses Herd's *data* (datadir, parks, PHP binaries) but must never
//! run its services **alongside** Herd's: two nginx masters fight over the HTTP
//! port, and two `mysqld` on one datadir is the InnoDB double-open that
//! `mariadb_guard` hard-fails on.
//!
//! Two commands, both deliberately conservative:
//!
//! * [`ld_herd_status`] — read-only `ps` scan. Reports which Herd-owned
//!   processes are alive and which ports Badami wants are occupied.
//! * [`ld_herd_quit`] — asks **Herd.app** to quit via AppleScript, the same
//!   thing the user would do from the menu bar. It lets Herd shut its own
//!   `mysqld` down cleanly. No signal is ever sent to a service process:
//!   SIGKILL on a live `mysqld` risks the very datadir we are trying to reuse.
//!
//! Neither command touches the Herd privileged helper, and neither deletes
//! anything.

use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, TcpStream};
use std::process::Command;
use std::time::Duration;

use super::discovery::build_runtime_paths;

/// Ports Badami may want. Matches `discovery::SCAN_PORTS` plus labels.
const CONFLICT_PORTS: &[(u16, &str)] = &[
    (80, "HTTP (Mode B)"),
    (8080, "HTTP (Mode A)"),
    (3306, "MariaDB / MySQL"),
    (6379, "Redis"),
    (53, "DNS"),
];

/// Path fragments that mark a process as belonging to Herd.
const HERD_MARKERS: &[&str] = &[
    "/Applications/Herd.app",
    "Herd.app/Contents",
    "Application Support/Herd/",
    "Application Support/Herd\\ ",
    "/Herd/bin/",
    "/Herd/config/",
    "/Herd/services/",
    "de.beyondco.herd",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HerdProcessRole {
    App,
    Nginx,
    PhpFpm,
    Mysqld,
    Dnsmasq,
    Redis,
    Helper,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HerdProcess {
    pub pid: u32,
    pub role: HerdProcessRole,
    /// Truncated cmdline for display.
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HerdPortHold {
    pub port: u16,
    pub label: String,
    pub listening: bool,
    /// Herd role that plausibly owns this port, when a matching Herd process is
    /// alive. Cross-referenced from the `ps` scan, **not** from `lsof` — we do
    /// not claim per-pid socket ownership we did not measure.
    pub attributed_role: Option<HerdProcessRole>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HerdRuntimeStatus {
    /// Herd is installed on disk (app bundle or HERD_HOME present).
    pub installed: bool,
    /// Herd.app (menu-bar app) is running.
    pub app_running: bool,
    pub processes: Vec<HerdProcess>,
    pub ports: Vec<HerdPortHold>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HerdQuitResult {
    /// The AppleScript quit was dispatched (false when Herd.app was not running).
    pub requested: bool,
    pub app_running_after: bool,
    /// Herd service processes still alive after the quit settled.
    pub remaining: Vec<HerdProcess>,
    pub notes: Vec<String>,
}

// ── Classification (pure — unit tested) ─────────────────────────────

fn is_herd_owned(cmdline: &str) -> bool {
    HERD_MARKERS.iter().any(|m| cmdline.contains(m))
}

/// Role for a Herd-owned cmdline.
fn classify_role(cmdline: &str) -> HerdProcessRole {
    let lower = cmdline.to_ascii_lowercase();
    if lower.contains("herd.app/contents/macos/herd") {
        return HerdProcessRole::App;
    }
    if lower.contains("herdhelper") || lower.contains("de.beyondco.herd.helper") {
        return HerdProcessRole::Helper;
    }
    if lower.contains("nginx") {
        return HerdProcessRole::Nginx;
    }
    if lower.contains("php-fpm") || lower.contains("php_fpm") {
        return HerdProcessRole::PhpFpm;
    }
    if lower.contains("mysqld") || lower.contains("mariadbd") {
        return HerdProcessRole::Mysqld;
    }
    if lower.contains("dnsmasq") {
        return HerdProcessRole::Dnsmasq;
    }
    if lower.contains("redis-server") || lower.contains("redis_server") {
        return HerdProcessRole::Redis;
    }
    HerdProcessRole::Other
}

fn truncate_command(cmdline: &str) -> String {
    const MAX: usize = 180;
    if cmdline.chars().count() <= MAX {
        return cmdline.to_string();
    }
    let head: String = cmdline.chars().take(MAX).collect();
    format!("{head}…")
}

/// Parse `ps -axo pid=,command=` output into Herd-owned processes.
///
/// `exclude` is Badami's own local-dev root: Badami **reuses Herd's binaries**,
/// so a Badami-spawned `php-fpm` can legitimately have a `…/Herd/bin/php-fpm84`
/// argv[0]. Excluding lines that reference our own runtime tree is what keeps
/// those from being reported as Herd conflicts.
fn parse_processes(ps_output: &str, exclude: &str) -> Vec<HerdProcess> {
    let mut out = Vec::new();
    for raw in ps_output.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let Some((pid_str, cmdline)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        let Ok(pid) = pid_str.trim().parse::<u32>() else {
            continue;
        };
        let cmdline = cmdline.trim();
        if !is_herd_owned(cmdline) {
            continue;
        }
        // Ours, merely borrowing a Herd binary — not a conflict.
        if !exclude.is_empty() && cmdline.contains(exclude) {
            continue;
        }
        // Never report the scan itself or a grep for it.
        if cmdline.starts_with("ps ") || cmdline.contains("-axo pid=,command=") {
            continue;
        }
        out.push(HerdProcess {
            pid,
            role: classify_role(cmdline),
            command: truncate_command(cmdline),
        });
    }
    out
}

fn role_for_port(port: u16) -> Option<HerdProcessRole> {
    match port {
        80 | 8080 => Some(HerdProcessRole::Nginx),
        3306 => Some(HerdProcessRole::Mysqld),
        6379 => Some(HerdProcessRole::Redis),
        53 => Some(HerdProcessRole::Dnsmasq),
        _ => None,
    }
}

fn port_listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

fn scan_conflict_ports(processes: &[HerdProcess]) -> Vec<HerdPortHold> {
    CONFLICT_PORTS
        .iter()
        .map(|&(port, label)| {
            let listening = port_listening(port);
            let attributed_role = role_for_port(port).filter(|role| {
                listening && processes.iter().any(|p| p.role == *role)
            });
            HerdPortHold {
                port,
                label: label.to_string(),
                listening,
                attributed_role,
            }
        })
        .collect()
}

fn herd_installed() -> bool {
    if std::path::Path::new("/Applications/Herd.app").exists() {
        return true;
    }
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .map(|h| h.join("Library/Application Support/Herd").is_dir())
        .unwrap_or(false)
}

fn run_ps() -> Result<String, String> {
    let out = Command::new("ps")
        .args(["-axo", "pid=,command="])
        .output()
        .map_err(|e| format!("ps failed: {e}"))?;
    if !out.status.success() {
        return Err(format!("ps exited with {}", out.status));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn collect_status() -> Result<HerdRuntimeStatus, String> {
    // Best-effort: if our own paths cannot be resolved we still scan, we just
    // lose the "that php-fpm is actually ours" discriminator.
    let exclude = build_runtime_paths()
        .map(|p| p.local_dev_root)
        .unwrap_or_default();

    let processes = match run_ps() {
        Ok(text) => parse_processes(&text, &exclude),
        Err(e) => {
            return Ok(HerdRuntimeStatus {
                installed: herd_installed(),
                app_running: false,
                processes: Vec::new(),
                ports: scan_conflict_ports(&[]),
                notes: vec![format!("process scan unavailable: {e}")],
            });
        }
    };

    let app_running = processes.iter().any(|p| p.role == HerdProcessRole::App);
    let service_count = processes
        .iter()
        .filter(|p| !matches!(p.role, HerdProcessRole::App | HerdProcessRole::Helper))
        .count();

    let mut notes = Vec::new();
    if !exclude.is_empty() {
        notes.push(format!(
            "processes referencing {exclude} are Badami's own and excluded"
        ));
    }
    if service_count > 0 {
        notes.push(format!(
            "{service_count} Herd service process(es) alive — starting Badami's stack on the same ports or datadir will fail"
        ));
    }
    if !app_running && service_count > 0 {
        notes.push(
            "Herd.app is not running but its services are — quitting the app cannot stop them; stop them from Herd or reboot".into(),
        );
    }
    notes.push("port ownership is inferred from the process scan, not lsof".into());

    Ok(HerdRuntimeStatus {
        installed: herd_installed(),
        app_running,
        ports: scan_conflict_ports(&processes),
        processes,
        notes,
    })
}

fn applescript_quit_herd() -> Result<(), String> {
    let out = Command::new("osascript")
        .args(["-e", "tell application \"Herd\" to quit"])
        .output()
        .map_err(|e| format!("osascript failed: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("osascript exited with {}", out.status)
    } else {
        stderr
    })
}

// ── Tauri commands ──────────────────────────────────────────────────

/// Read-only report of Herd processes and occupied ports.
///
/// Never signals, never invokes the Herd helper, never writes.
#[tauri::command]
pub async fn ld_herd_status() -> Result<HerdRuntimeStatus, String> {
    tokio::task::spawn_blocking(collect_status)
        .await
        .map_err(|e| format!("ld_herd_status task failed: {e}"))?
}

/// Ask Herd.app to quit, then report what is still alive.
///
/// Graceful only — AppleScript quit, so Herd stops its own `mysqld` cleanly.
/// Never sends a signal to a service process. Callers must treat a non-empty
/// `remaining` as "user action still required", not as a failure to retry
/// harder.
#[tauri::command]
pub async fn ld_herd_quit() -> Result<HerdQuitResult, String> {
    tokio::task::spawn_blocking(|| {
        let before = collect_status()?;
        if !before.app_running {
            let mut notes = vec![
                "Herd.app was not running — nothing to quit".into(),
            ];
            notes.extend(before.notes.iter().cloned());
            return Ok(HerdQuitResult {
                requested: false,
                app_running_after: false,
                remaining: before
                    .processes
                    .into_iter()
                    .filter(|p| p.role != HerdProcessRole::App)
                    .collect(),
                notes,
            });
        }

        let mut notes = Vec::new();
        if let Err(e) = applescript_quit_herd() {
            notes.push(format!("quit request failed: {e}"));
        } else {
            notes.push("sent AppleScript quit to Herd.app".into());
        }

        // Herd tears its services down asynchronously; mysqld shutdown is the
        // slow one. Poll rather than assume.
        let mut after = collect_status()?;
        for _ in 0..16 {
            if !after.app_running
                && !after
                    .processes
                    .iter()
                    .any(|p| !matches!(p.role, HerdProcessRole::App | HerdProcessRole::Helper))
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
            after = collect_status()?;
        }

        let remaining: Vec<HerdProcess> = after
            .processes
            .iter()
            .filter(|p| p.role != HerdProcessRole::App)
            .cloned()
            .collect();
        if !remaining.is_empty() {
            notes.push(format!(
                "{} process(es) still alive after quit — stop them from Herd itself; Badami will not signal them",
                remaining.len()
            ));
        }

        Ok(HerdQuitResult {
            requested: true,
            app_running_after: after.app_running,
            remaining,
            notes,
        })
    })
    .await
    .map_err(|e| format!("ld_herd_quit task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_herd_owned_lines() {
        assert!(is_herd_owned(
            "/Users/k/Library/Application Support/Herd/bin/php-fpm84 -y /Users/k/Library/Application Support/Herd/config/fpm/84.conf"
        ));
        assert!(is_herd_owned("/Applications/Herd.app/Contents/MacOS/Herd"));
        assert!(!is_herd_owned("/opt/homebrew/opt/nginx/bin/nginx -g daemon off;"));
    }

    #[test]
    fn classifies_roles() {
        assert_eq!(
            classify_role("/Applications/Herd.app/Contents/MacOS/Herd"),
            HerdProcessRole::App
        );
        assert_eq!(
            classify_role("nginx: master process /Herd/bin/nginx"),
            HerdProcessRole::Nginx
        );
        assert_eq!(
            classify_role("/Herd/bin/php-fpm84 -y /Herd/config/fpm/84.conf"),
            HerdProcessRole::PhpFpm
        );
        assert_eq!(
            classify_role("/Herd/services/mysql/bin/mysqld --datadir=/x"),
            HerdProcessRole::Mysqld
        );
    }

    /// The false positive that matters: Badami reuses Herd's binaries, so the
    /// binary path alone must never be enough to call a process "Herd's".
    #[test]
    fn excludes_badami_processes_using_herd_binaries() {
        let ps = concat!(
            "501 /Users/k/Library/Application Support/Herd/bin/php-fpm84 -y /Users/k/Library/Application Support/Badami/local-dev/fpm/84.conf\n",
            "502 /Users/k/Library/Application Support/Herd/bin/php-fpm84 -y /Users/k/Library/Application Support/Herd/config/fpm/84.conf\n",
        );
        let found = parse_processes(
            ps,
            "/Users/k/Library/Application Support/Badami/local-dev",
        );
        assert_eq!(found.len(), 1, "only the Herd-configured pool is a conflict");
        assert_eq!(found[0].pid, 502);
        assert_eq!(found[0].role, HerdProcessRole::PhpFpm);
    }

    #[test]
    fn skips_unparseable_and_foreign_lines() {
        let ps = concat!(
            "not-a-pid something\n",
            "\n",
            "123 /usr/sbin/cupsd -l\n",
            "456 /Applications/Herd.app/Contents/MacOS/Herd\n",
        );
        let found = parse_processes(ps, "");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].role, HerdProcessRole::App);
    }

    #[test]
    fn attributes_port_only_when_matching_process_alive() {
        let procs = vec![HerdProcess {
            pid: 1,
            role: HerdProcessRole::Nginx,
            command: "nginx".into(),
        }];
        // Port attribution requires BOTH a live matching process and a listener;
        // with no listener there is nothing to attribute.
        let holds = scan_conflict_ports(&procs);
        for hold in holds {
            if !hold.listening {
                assert!(hold.attributed_role.is_none());
            }
        }
    }
}
