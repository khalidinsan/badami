//! MariaDB pre-start guards (pure checklist). **Does not start mariadbd.**
//!
//! Hard rules (plan + KD18):
//! - Never open the same datadir with two mysqld/mariadbd processes.
//! - Never run install_db against a non-empty datadir.
//! - Never delete/mutate datadir files (pid file inside datadir may be cleared if stale).
//! - Start itself is PR4 — this module only classifies OkToStart | Adopt | HardFail.

use super::config_gen::parse_mycnf_values;
use super::discovery::{build_runtime_paths, local_dev_root};
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

// ── Public API ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MariadbPreflight {
    OkToStart,
    Adopt {
        #[serde(skip_serializing_if = "Option::is_none")]
        pid: Option<u32>,
        reason: String,
    },
    HardFail {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MariadbPreflightReport {
    pub result: MariadbPreflight,
    pub wrapper_mycnf: Option<String>,
    pub datadir: Option<String>,
    pub basedir: Option<String>,
    pub socket: Option<String>,
    pub port: Option<u16>,
    pub checks: Vec<String>,
    /// True only when result is OkToStart (start still not exposed here).
    pub ready_for_mariadb_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MariadbPreflightRequest {
    /// Override path to wrapper my.cnf (default: local-dev/mariadb/my.cnf).
    pub wrapper_mycnf: Option<String>,
    /// Expected datadir (canonical). If set, must match wrapper.
    pub expected_datadir: Option<String>,
    /// TCP host for probe (default 127.0.0.1).
    pub tcp_host: Option<String>,
    /// Skip live probes (unit tests).
    pub skip_live_probes: Option<bool>,
}

// ── Config gate ─────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct WrapperConfig {
    pub path: PathBuf,
    pub datadir: PathBuf,
    pub basedir: PathBuf,
    pub socket: PathBuf,
    pub port: u16,
    #[allow(dead_code)] // retained for doctor / future log paths
    pub log_error: Option<PathBuf>,
    pub pid_file: Option<PathBuf>,
}

/// Load and validate Badami wrapper my.cnf. Pure path/config check.
pub fn load_wrapper_config(path: &Path) -> Result<WrapperConfig, String> {
    if !path.is_file() {
        return Err(format!(
            "wrapper my.cnf missing: {} — run ld_generate_configs with mariadb input first",
            path.display()
        ));
    }
    let contents =
        fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let map = parse_mycnf_values(&contents);

    let datadir = map
        .get("datadir")
        .ok_or_else(|| "wrapper my.cnf missing datadir".to_string())?;
    let basedir = map
        .get("basedir")
        .ok_or_else(|| "wrapper my.cnf missing basedir".to_string())?;
    let socket = map
        .get("socket")
        .ok_or_else(|| "wrapper my.cnf missing socket".to_string())?;
    let port = map
        .get("port")
        .map(|s| s.parse::<u16>())
        .transpose()
        .map_err(|e| format!("invalid port in wrapper my.cnf: {e}"))?
        .unwrap_or(3306);

    let datadir_pb = PathBuf::from(datadir);
    let basedir_pb = PathBuf::from(basedir);
    if !datadir_pb.is_absolute() || !basedir_pb.is_absolute() {
        return Err("datadir and basedir in wrapper must be absolute".into());
    }

    Ok(WrapperConfig {
        path: path.to_path_buf(),
        datadir: datadir_pb,
        basedir: basedir_pb,
        socket: PathBuf::from(socket),
        port,
        log_error: map.get("log-error").map(PathBuf::from),
        pid_file: map
            .get("pid-file")
            .or_else(|| map.get("pid_file"))
            .map(PathBuf::from),
    })
}

// ── install_db gate ─────────────────────────────────────────────────

/// Returns true if the datadir looks non-empty / already initialized.
/// Callers **must not** run install_db when this is true.
pub fn datadir_is_nonempty(datadir: &Path) -> bool {
    if !datadir.is_dir() {
        return false;
    }
    // Classic InnoDB / system schema markers.
    if datadir.join("ibdata1").is_file() {
        return true;
    }
    if datadir.join("mysql").is_dir() {
        return true;
    }
    // Any regular file or subdir (besides `.` / `..`) counts as non-empty.
    fs::read_dir(datadir)
        .map(|rd| {
            rd.flatten().any(|e| {
                let name = e.file_name();
                name != "." && name != ".."
            })
        })
        .unwrap_or(false)
}

/// Explicit API: refuse install_db on non-empty datadir.
/// Used by future supervisor start path and unit tests.
pub fn may_run_install_db(datadir: &Path) -> Result<(), String> {
    if datadir_is_nonempty(datadir) {
        Err(format!(
            "refusing install_db: datadir is non-empty ({}) — reuse wrapper my.cnf only",
            datadir.display()
        ))
    } else {
        Ok(())
    }
}

// ── Probes ──────────────────────────────────────────────────────────

/// True if something accepts TCP connections on host:port.
pub fn tcp_accepting(host: &str, port: u16) -> bool {
    use std::net::ToSocketAddrs;
    let Ok(mut addrs) = (host, port).to_socket_addrs() else {
        return false;
    };
    let Some(addr) = addrs.next() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

/// True if a Unix socket path exists (connectable check is best-effort without extra crates).
pub fn socket_path_present(socket: &Path) -> bool {
    socket.exists()
}

// ── PID heuristics ──────────────────────────────────────────────────

/// Read a pid file; `None` if missing/unparseable.
pub fn read_pid_file(path: &Path) -> Option<u32> {
    let s = fs::read_to_string(path).ok()?;
    s.trim().parse().ok()
}

/// Whether a PID looks alive (signal 0).
#[cfg(unix)]
pub fn pid_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    // SAFETY: kill(pid, 0) is a standard liveness probe; we do not signal the process.
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    unsafe { kill(pid as i32, 0) == 0 }
}

#[cfg(not(unix))]
pub fn pid_is_alive(_pid: u32) -> bool {
    false
}

/// If `path` holds a stale PID (dead process), remove **only** that pid file.
/// Never touches data files. Returns whether a stale file was removed.
pub fn clear_stale_pid_file(path: &Path) -> Result<bool, String> {
    if !path.is_file() {
        return Ok(false);
    }
    let Some(pid) = read_pid_file(path) else {
        // Unparseable pid file — treat as stale and remove.
        fs::remove_file(path).map_err(|e| format!("remove stale pid {}: {e}", path.display()))?;
        return Ok(true);
    };
    if pid_is_alive(pid) {
        return Ok(false);
    }
    fs::remove_file(path).map_err(|e| format!("remove stale pid {}: {e}", path.display()))?;
    Ok(true)
}

// ── Full preflight ──────────────────────────────────────────────────

pub fn run_preflight(req: MariadbPreflightRequest) -> Result<MariadbPreflightReport, String> {
    let mut checks = Vec::new();
    let paths = build_runtime_paths()?;

    let wrapper_path = req
        .wrapper_mycnf
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&paths.mariadb).join("my.cnf"));

    // 1. Config gate
    let cfg = match load_wrapper_config(&wrapper_path) {
        Ok(c) => {
            checks.push(format!("config_gate: ok ({})", wrapper_path.display()));
            c
        }
        Err(e) => {
            checks.push(format!("config_gate: fail — {e}"));
            return Ok(MariadbPreflightReport {
                result: MariadbPreflight::HardFail { reason: e },
                wrapper_mycnf: Some(wrapper_path.to_string_lossy().into_owned()),
                datadir: None,
                basedir: None,
                socket: None,
                port: None,
                checks,
                ready_for_mariadb_start: false,
            });
        }
    };

    // expected datadir match
    if let Some(ref expected) = req.expected_datadir {
        let exp = PathBuf::from(expected);
        let a = cfg.datadir.canonicalize().unwrap_or_else(|_| cfg.datadir.clone());
        let b = exp.canonicalize().unwrap_or(exp);
        if a != b {
            let reason = format!(
                "wrapper datadir {} does not match expected {}",
                cfg.datadir.display(),
                expected
            );
            checks.push(format!("datadir_match: fail — {reason}"));
            return Ok(report_fail(cfg, checks, reason));
        }
        checks.push("datadir_match: ok".into());
    }

    // 2. Never install_db on non-empty (gate only — we never invoke install_db).
    match may_run_install_db(&cfg.datadir) {
        Err(msg) => checks.push(format!("install_db_gate: {msg}")),
        Ok(()) => checks.push(
            "install_db_gate: datadir empty or missing — still not auto-installing in MVP".into(),
        ),
    }

    let skip_live = req.skip_live_probes.unwrap_or(false);
    let host = req.tcp_host.as_deref().unwrap_or("127.0.0.1");

    // 3/4. Socket + TCP probes → adopt vs hard-fail
    if !skip_live {
        let sock_present = socket_path_present(&cfg.socket);
        let tcp_up = tcp_accepting(host, cfg.port);
        checks.push(format!(
            "socket_probe: path={} present={sock_present}",
            cfg.socket.display()
        ));
        checks.push(format!("tcp_probe: {host}:{} accepting={tcp_up}", cfg.port));

        if sock_present || tcp_up {
            // Try to find a PID from wrapper pid-file or datadir *.pid
            let mut adopt_pid = None;
            if let Some(ref pf) = cfg.pid_file {
                if let Some(pid) = read_pid_file(pf) {
                    if pid_is_alive(pid) {
                        adopt_pid = Some(pid);
                    }
                }
            }
            // Datadir mysql.pid / *.pid heuristic (read only).
            if adopt_pid.is_none() {
                adopt_pid = find_live_pid_in_datadir(&cfg.datadir);
            }

            let reason = if sock_present && tcp_up {
                "socket and TCP 3306 already accepting — adopt, do not spawn second process".into()
            } else if sock_present {
                "MariaDB socket present — treat as running; adopt or hard-fail start".into()
            } else {
                format!(
                    "TCP {host}:{} accepting — adopt existing instance, do not double-open datadir",
                    cfg.port
                )
            };
            checks.push(format!("classification: adopt (pid={adopt_pid:?})"));
            return Ok(MariadbPreflightReport {
                result: MariadbPreflight::Adopt {
                    pid: adopt_pid,
                    reason,
                },
                wrapper_mycnf: Some(cfg.path.to_string_lossy().into_owned()),
                datadir: Some(cfg.datadir.to_string_lossy().into_owned()),
                basedir: Some(cfg.basedir.to_string_lossy().into_owned()),
                socket: Some(cfg.socket.to_string_lossy().into_owned()),
                port: Some(cfg.port),
                checks,
                ready_for_mariadb_start: false,
            });
        }
    } else {
        checks.push("live_probes: skipped".into());
    }

    // 5. PID file heuristics — clear stale only
    if let Some(ref pf) = cfg.pid_file {
        match clear_stale_pid_file(pf) {
            Ok(true) => checks.push(format!("pid_file: cleared stale {}", pf.display())),
            Ok(false) => {
                if let Some(pid) = read_pid_file(pf) {
                    if pid_is_alive(pid) {
                        // Live pid but probes said down — still refuse double start.
                        let reason = format!(
                            "pid file {} points to live PID {pid} — refuse start (possible datadir lock)",
                            pf.display()
                        );
                        checks.push(format!("pid_file: hard-fail — {reason}"));
                        return Ok(report_fail(cfg, checks, reason));
                    }
                }
                checks.push(format!("pid_file: {} absent or not live", pf.display()));
            }
            Err(e) => {
                checks.push(format!("pid_file: error {e}"));
                return Ok(report_fail(cfg, checks, e));
            }
        }
    }

    // Datadir-internal pid files: if live foreign → hard-fail; if stale → clear pid only.
    match scan_datadir_pids(&cfg.datadir, &mut checks) {
        DatadirPidScan::LiveForeign { pid, path } => {
            let reason = format!(
                "MariaDB datadir already in use by PID {pid} (pid file {}) — stop that instance or adopt it",
                path.display()
            );
            checks.push(format!("datadir_pid: hard-fail — {reason}"));
            return Ok(report_fail(cfg, checks, reason));
        }
        DatadirPidScan::Clean => {
            checks.push("datadir_pid: clean".into());
        }
    }

    // Ensure local-dev root is not confused with Herd (note only).
    if let Ok(root) = local_dev_root() {
        checks.push(format!(
            "local_dev_root: {} (wrapper only; datadir remains Herd path)",
            root.display()
        ));
    }

    checks.push("classification: ok_to_start".into());
    Ok(MariadbPreflightReport {
        result: MariadbPreflight::OkToStart,
        wrapper_mycnf: Some(cfg.path.to_string_lossy().into_owned()),
        datadir: Some(cfg.datadir.to_string_lossy().into_owned()),
        basedir: Some(cfg.basedir.to_string_lossy().into_owned()),
        socket: Some(cfg.socket.to_string_lossy().into_owned()),
        port: Some(cfg.port),
        checks,
        ready_for_mariadb_start: true,
    })
}

fn report_fail(cfg: WrapperConfig, checks: Vec<String>, reason: String) -> MariadbPreflightReport {
    MariadbPreflightReport {
        result: MariadbPreflight::HardFail { reason },
        wrapper_mycnf: Some(cfg.path.to_string_lossy().into_owned()),
        datadir: Some(cfg.datadir.to_string_lossy().into_owned()),
        basedir: Some(cfg.basedir.to_string_lossy().into_owned()),
        socket: Some(cfg.socket.to_string_lossy().into_owned()),
        port: Some(cfg.port),
        checks,
        ready_for_mariadb_start: false,
    }
}

enum DatadirPidScan {
    Clean,
    LiveForeign { pid: u32, path: PathBuf },
}

fn find_live_pid_in_datadir(datadir: &Path) -> Option<u32> {
    for name in ["mysqld.pid", "mariadbd.pid", "mysql.pid"] {
        let p = datadir.join(name);
        if let Some(pid) = read_pid_file(&p) {
            if pid_is_alive(pid) {
                return Some(pid);
            }
        }
    }
    None
}

fn scan_datadir_pids(datadir: &Path, checks: &mut Vec<String>) -> DatadirPidScan {
    if !datadir.is_dir() {
        return DatadirPidScan::Clean;
    }
    let candidates = ["mysqld.pid", "mariadbd.pid", "mysql.pid"];
    for name in candidates {
        let p = datadir.join(name);
        if !p.is_file() {
            continue;
        }
        if let Some(pid) = read_pid_file(&p) {
            if pid_is_alive(pid) {
                return DatadirPidScan::LiveForeign {
                    pid,
                    path: p,
                };
            }
            // Stale — remove pid file only.
            match clear_stale_pid_file(&p) {
                Ok(true) => checks.push(format!(
                    "datadir_pid: cleared stale {} (data files untouched)",
                    p.display()
                )),
                Ok(false) => {}
                Err(e) => checks.push(format!("datadir_pid: clear error {e}")),
            }
        }
    }
    DatadirPidScan::Clean
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn nonempty_datadir_forbids_install_db() {
        let dir = std::env::temp_dir().join(format!(
            "badami-ld-guard-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("ibdata1"), b"x").unwrap();
        assert!(datadir_is_nonempty(&dir));
        assert!(may_run_install_db(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_datadir_allows_install_db_gate() {
        let dir = std::env::temp_dir().join(format!(
            "badami-ld-guard-empty-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(!datadir_is_nonempty(&dir));
        assert!(may_run_install_db(&dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_wrapper_requires_keys() {
        let dir = std::env::temp_dir().join(format!(
            "badami-ld-mycnf-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("my.cnf");
        let mut f = fs::File::create(&p).unwrap();
        writeln!(
            f,
            "[mysqld]\nbasedir=/opt/basedir\ndatadir=/opt/datadir\nsocket=/tmp/t.sock\nport=3306\n"
        )
        .unwrap();
        let cfg = load_wrapper_config(&p).unwrap();
        assert_eq!(cfg.port, 3306);
        assert_eq!(cfg.datadir, PathBuf::from("/opt/datadir"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn preflight_missing_wrapper_hard_fails() {
        let report = run_preflight(MariadbPreflightRequest {
            wrapper_mycnf: Some("/tmp/definitely-missing-badami-my.cnf".into()),
            skip_live_probes: Some(true),
            ..Default::default()
        })
        .unwrap();
        assert!(matches!(report.result, MariadbPreflight::HardFail { .. }));
        assert!(!report.ready_for_mariadb_start);
    }
}
