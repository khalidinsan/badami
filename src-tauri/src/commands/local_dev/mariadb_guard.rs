//! MariaDB pre-start guards (pure checklist). **Does not start mariadbd.**
//!
//! Hard rules (plan + KD18):
//! - Never open the same datadir with two mysqld/mariadbd processes.
//! - Never run install_db against a non-empty datadir.
//! - Never delete/mutate datadir **data** files (only known stale `*.pid` under
//!   local-dev/pids or the configured datadir; never arbitrary paths).
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
    /// When `false`, inspect only — never `remove_file` stale pid/socket inodes.
    /// Doctor uses this so diagnostics stay read-only. Default `true` (supervisor
    /// start may clear known-stale pid/socket under allowed roots only).
    pub allow_mutate: Option<bool>,
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
    if datadir.join("ibdata1").is_file() {
        return true;
    }
    if datadir.join("mysql").is_dir() {
        return true;
    }
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

/// True if a Unix socket path exists on disk (may be a stale inode).
pub fn socket_path_present(socket: &Path) -> bool {
    socket.exists()
}

/// True if a process accepts connections on the Unix socket.
#[cfg(unix)]
pub fn unix_socket_accepting(socket: &Path) -> bool {
    use std::os::unix::net::UnixStream;
    UnixStream::connect(socket).is_ok()
}

#[cfg(not(unix))]
pub fn unix_socket_accepting(_socket: &Path) -> bool {
    false
}

/// Result of a lightweight MariaDB auth probe (registration stays in TS).
///
/// - `ok`: empty-password `root` auth succeeded (or non-empty password if provided).
/// - `needs_password`: server is accepting connections but empty-password auth failed
///   with an access-denied style error — UI should prompt the user.
/// - Never mutates data; never touches Herd datadir.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MariadbAuthProbe {
    pub ok: bool,
    pub needs_password: bool,
    pub message: String,
    pub host: String,
    pub port: u16,
    /// True when TCP (or optional Unix socket) accepted a connection attempt.
    pub tcp_accepting: bool,
    pub socket_accepting: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MariadbAuthProbeRequest {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    /// Optional password; default empty (probe empty root first).
    pub password: Option<String>,
    /// Optional Unix socket path for a connect attempt (not used for sqlx URL).
    pub socket: Option<String>,
    /// Skip live probes (unit tests).
    pub skip_live: Option<bool>,
}

/// Synchronous connectivity check only (TCP + optional Unix socket).
/// Auth is done async in `probe_mariadb_auth_async` / the Tauri command.
pub fn probe_mariadb_connectivity(
    host: &str,
    port: u16,
    socket: Option<&str>,
) -> (bool, bool) {
    let tcp_ok = tcp_accepting(host, port);
    let socket_ok = socket
        .map(|s| {
            let p = Path::new(s);
            socket_path_present(p) && unix_socket_accepting(p)
        })
        .unwrap_or(false);
    (tcp_ok, socket_ok)
}

/// Probe whether local MariaDB accepts auth as `root` (empty password first).
///
/// Used before TS `createConnection` + conditional `save_db_password`.
/// Does not register a DB connection and never writes keychain.
pub async fn probe_mariadb_auth_async(req: MariadbAuthProbeRequest) -> MariadbAuthProbe {
    let host = req.host.unwrap_or_else(|| "127.0.0.1".into());
    let port = req.port.unwrap_or(3306);
    let username = req.username.unwrap_or_else(|| "root".into());
    let password = req.password.unwrap_or_default();
    let skip = req.skip_live.unwrap_or(false);
    let socket = req.socket.clone();

    if skip {
        return MariadbAuthProbe {
            ok: false,
            needs_password: false,
            message: "skipped live probe".into(),
            host,
            port,
            tcp_accepting: false,
            socket_accepting: false,
        };
    }

    let socket_for_block = socket.clone();
    let host_for_block = host.clone();
    let (tcp_ok, socket_ok) = tokio::task::spawn_blocking(move || {
        probe_mariadb_connectivity(&host_for_block, port, socket_for_block.as_deref())
    })
    .await
    .unwrap_or((false, false));

    if !tcp_ok && !socket_ok {
        return MariadbAuthProbe {
            ok: false,
            needs_password: false,
            message: format!(
                "MariaDB not accepting connections on {host}:{port}{}",
                if socket.is_some() {
                    " (socket also not accepting)"
                } else {
                    ""
                }
            ),
            host,
            port,
            tcp_accepting: tcp_ok,
            socket_accepting: socket_ok,
        };
    }

    // Attempt auth via mysql protocol over TCP (same path as dbc_test_connection).
    // Empty password is intentional for Herd-style local root.
    let url = format!("mysql://{username}:{password}@{host}:{port}/");

    let connect_result = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(3))
        .connect(&url)
        .await;

    match connect_result {
        Ok(p) => {
            p.close().await;
            MariadbAuthProbe {
                ok: true,
                needs_password: false,
                message: if password.is_empty() {
                    "Authenticated as root with empty password".into()
                } else {
                    "Authenticated with provided password".into()
                },
                host,
                port,
                tcp_accepting: tcp_ok,
                socket_accepting: socket_ok,
            }
        }
        Err(err) => {
            let err_s = format!("{err}");
            let lower = err_s.to_lowercase();
            let access_denied = lower.contains("access denied")
                || lower.contains("password")
                || lower.contains("1045")
                || lower.contains("using password");
            MariadbAuthProbe {
                ok: false,
                needs_password: access_denied && password.is_empty(),
                message: err_s,
                host,
                port,
                tcp_accepting: tcp_ok,
                socket_accepting: socket_ok,
            }
        }
    }
}

// ── PID heuristics (scoped deletes only) ────────────────────────────

const KNOWN_DATADIR_PID_NAMES: &[&str] = &["mysqld.pid", "mariadbd.pid", "mysql.pid"];

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

/// Whether `path` is under `root` (string prefix with path boundary, then canonical).
fn path_is_under(root: &Path, path: &Path) -> bool {
    let lexical = |r: &Path, p: &Path| -> bool {
        let rs = r.to_string_lossy();
        let ps = p.to_string_lossy();
        if ps == rs {
            return true;
        }
        let prefix = if rs.ends_with('/') {
            rs.to_string()
        } else {
            format!("{rs}/")
        };
        ps.starts_with(&prefix)
    };

    if lexical(root, path) {
        return true;
    }

    let root_c = match root.canonicalize() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let path_c = path
        .canonicalize()
        .or_else(|_| {
            path.parent()
                .and_then(|p| p.canonicalize().ok())
                .map(|parent| parent.join(path.file_name().unwrap_or_default()))
                .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no parent"))
        })
        .unwrap_or_else(|_| path.to_path_buf());

    path_c.starts_with(&root_c) || lexical(&root_c, &path_c)
}

fn pid_basename_allowed(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    if KNOWN_DATADIR_PID_NAMES.contains(&name) {
        return true;
    }
    name.ends_with(".pid")
}

/// Deletion is allowed only when **all** of:
/// 1. basename is a known pid name or ends with `.pid`
/// 2. path is under `local-dev/pids` **or** under the configured datadir
pub fn pid_file_deletion_allowed(path: &Path, pids_dir: &Path, datadir: &Path) -> bool {
    if !pid_basename_allowed(path) {
        return false;
    }
    path_is_under(pids_dir, path) || path_is_under(datadir, path)
}

/// If `path` holds a stale PID (dead process), remove **only** that pid file —
/// and only when under allowed roots. Never touches data files.
///
/// Returns:
/// - `Ok(true)` — stale file removed
/// - `Ok(false)` — nothing removed (missing, live, or not allowed)
/// - `Err` — live refuse / unsafe path with unparseable content
pub fn clear_stale_pid_file(
    path: &Path,
    pids_dir: &Path,
    datadir: &Path,
) -> Result<bool, String> {
    if !path.is_file() {
        return Ok(false);
    }
    if !pid_file_deletion_allowed(path, pids_dir, datadir) {
        // Do not delete arbitrary files. Unparseable content outside safe roots is HardFail territory.
        if read_pid_file(path).is_none() {
            return Err(format!(
                "refusing to clear non-safe pid path {} (not under local-dev/pids or datadir)",
                path.display()
            ));
        }
        // Live or dead but outside roots: never delete.
        return Ok(false);
    }

    let Some(pid) = read_pid_file(path) else {
        // Unparseable but under safe root — treat as stale and remove pid file only.
        fs::remove_file(path).map_err(|e| format!("remove stale pid {}: {e}", path.display()))?;
        return Ok(true);
    };
    if pid_is_alive(pid) {
        return Ok(false);
    }
    fs::remove_file(path).map_err(|e| format!("remove stale pid {}: {e}", path.display()))?;
    Ok(true)
}

/// Safe unlink for a **stale** Unix socket (dead inode, no listener).
/// Only under local-dev/socks or `/tmp`, and only if path is a socket inode (or plain file under socks).
pub fn clear_stale_socket(socket: &Path, socks_dir: &Path) -> Result<bool, String> {
    if !socket.exists() {
        return Ok(false);
    }
    let under_socks = path_is_under(socks_dir, socket);
    let under_tmp = socket.starts_with("/tmp/")
        || socket
            .to_string_lossy()
            .starts_with("/tmp/");
    if !under_socks && !under_tmp {
        return Err(format!(
            "stale_socket: refusing to unlink {} (not under local-dev/socks or /tmp)",
            socket.display()
        ));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::FileTypeExt;
        if let Ok(meta) = fs::symlink_metadata(socket) {
            let ft = meta.file_type();
            if !ft.is_socket() && !ft.is_file() {
                return Err(format!(
                    "stale_socket: {} is not a socket/file inode",
                    socket.display()
                ));
            }
        }
    }

    fs::remove_file(socket).map_err(|e| format!("unlink stale socket {}: {e}", socket.display()))?;
    Ok(true)
}

// ── Full preflight ──────────────────────────────────────────────────

pub fn run_preflight(req: MariadbPreflightRequest) -> Result<MariadbPreflightReport, String> {
    let mut checks = Vec::new();
    let paths = build_runtime_paths()?;
    let pids_dir = PathBuf::from(&paths.pids);
    let socks_dir = PathBuf::from(&paths.socks);

    let wrapper_override = req.wrapper_mycnf.is_some();
    let wrapper_path = req
        .wrapper_mycnf
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&paths.mariadb).join("my.cnf"));

    // Prefer wrapper under local-dev/mariadb (warn if override is elsewhere).
    let mariadb_cfg_dir = PathBuf::from(&paths.mariadb);
    if wrapper_override && !path_is_under(&mariadb_cfg_dir, &wrapper_path) {
        checks.push(format!(
            "wrapper_path: note — {} is outside local-dev/mariadb (override)",
            wrapper_path.display()
        ));
    }

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
    // Default true for supervisor start; doctor passes false for read-only inspect.
    let allow_mutate = req.allow_mutate.unwrap_or(true);
    let host = req.tcp_host.as_deref().unwrap_or("127.0.0.1");
    if !allow_mutate {
        checks.push("mutate: disabled (inspect-only — no pid/socket unlink)".into());
    }

    // 3/4. Socket + TCP probes → adopt vs hard-fail vs clear stale socket
    if !skip_live {
        let sock_present = socket_path_present(&cfg.socket);
        let sock_live = sock_present && unix_socket_accepting(&cfg.socket);
        let tcp_up = tcp_accepting(host, cfg.port);
        checks.push(format!(
            "socket_probe: path={} present={sock_present} accepting={sock_live}",
            cfg.socket.display()
        ));
        checks.push(format!("tcp_probe: {host}:{} accepting={tcp_up}", cfg.port));

        // Resolve live PID early (wrapper pid + datadir).
        let mut live_pid = None;
        if let Some(ref pf) = cfg.pid_file {
            if let Some(pid) = read_pid_file(pf) {
                if pid_is_alive(pid) {
                    live_pid = Some(pid);
                }
            }
        }
        if live_pid.is_none() {
            live_pid = find_live_pid_in_datadir(&cfg.datadir);
        }

        if sock_live || tcp_up {
            let reason = if sock_live && tcp_up {
                format!(
                    "socket and TCP {} already accepting — adopt, do not spawn second process",
                    cfg.port
                )
            } else if sock_live {
                "MariaDB Unix socket accepting connections — adopt, do not spawn second process"
                    .into()
            } else {
                format!(
                    "TCP {host}:{} accepting — adopt existing instance, do not double-open datadir",
                    cfg.port
                )
            };
            checks.push(format!("classification: adopt (pid={live_pid:?})"));
            return Ok(MariadbPreflightReport {
                result: MariadbPreflight::Adopt {
                    pid: live_pid,
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

        // Dead socket file (exists but not accepting) + TCP down + no live PID.
        if sock_present && !sock_live && !tcp_up && live_pid.is_none() {
            if allow_mutate {
                match clear_stale_socket(&cfg.socket, &socks_dir) {
                    Ok(true) => {
                        checks.push(format!(
                            "stale_socket: cleared dead socket {} (no live PID, TCP down)",
                            cfg.socket.display()
                        ));
                    }
                    Ok(false) => {
                        checks.push("stale_socket: path gone after recheck".into());
                    }
                    Err(e) => {
                        // Outside safe roots — HardFail with explicit reason (not permanent Adopt).
                        let sock = cfg.socket.display().to_string();
                        checks.push(format!("stale_socket: {e}"));
                        return Ok(report_fail(
                            cfg,
                            checks,
                            format!(
                                "stale_socket: dead socket at {sock} with no live process — remove manually or relocate socket under local-dev/socks"
                            ),
                        ));
                    }
                }
            } else {
                checks.push(format!(
                    "stale_socket: dead socket {} noted (inspect-only — not unlinked)",
                    cfg.socket.display()
                ));
            }
        }
    } else {
        checks.push("live_probes: skipped".into());
    }

    // 5. PID file heuristics — clear stale only under allowed roots when mutating
    if let Some(ref pf) = cfg.pid_file {
        if allow_mutate {
            match clear_stale_pid_file(pf, &pids_dir, &cfg.datadir) {
                Ok(true) => checks.push(format!("pid_file: cleared stale {}", pf.display())),
                Ok(false) => {
                    if let Some(pid) = read_pid_file(pf) {
                        if pid_is_alive(pid) {
                            let reason = format!(
                                "pid file {} points to live PID {pid} — refuse start (possible datadir lock)",
                                pf.display()
                            );
                            checks.push(format!("pid_file: hard-fail — {reason}"));
                            return Ok(report_fail(cfg, checks, reason));
                        }
                    }
                    if pf.is_file() && !pid_file_deletion_allowed(pf, &pids_dir, &cfg.datadir) {
                        checks.push(format!(
                            "pid_file: {} not under safe roots — left untouched",
                            pf.display()
                        ));
                    } else {
                        checks.push(format!("pid_file: {} absent or not live", pf.display()));
                    }
                }
                Err(e) => {
                    checks.push(format!("pid_file: error {e}"));
                    return Ok(report_fail(cfg, checks, e));
                }
            }
        } else {
            // Inspect-only: report live lock / stale presence without unlinking.
            if let Some(pid) = read_pid_file(pf) {
                if pid_is_alive(pid) {
                    let reason = format!(
                        "pid file {} points to live PID {pid} — refuse start (possible datadir lock)",
                        pf.display()
                    );
                    checks.push(format!("pid_file: hard-fail — {reason}"));
                    return Ok(report_fail(cfg, checks, reason));
                }
                checks.push(format!(
                    "pid_file: {} has dead/stale PID {pid} (inspect-only — not cleared)",
                    pf.display()
                ));
            } else if pf.is_file() {
                checks.push(format!(
                    "pid_file: {} present (inspect-only — not cleared)",
                    pf.display()
                ));
            } else {
                checks.push(format!("pid_file: {} absent", pf.display()));
            }
        }
    }

    // Datadir-internal pid files: if live foreign → hard-fail; if stale → clear only when mutating.
    match scan_datadir_pids(&cfg.datadir, &pids_dir, &mut checks, allow_mutate) {
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
    for name in KNOWN_DATADIR_PID_NAMES {
        let p = datadir.join(name);
        if let Some(pid) = read_pid_file(&p) {
            if pid_is_alive(pid) {
                return Some(pid);
            }
        }
    }
    None
}

fn scan_datadir_pids(
    datadir: &Path,
    pids_dir: &Path,
    checks: &mut Vec<String>,
    allow_mutate: bool,
) -> DatadirPidScan {
    if !datadir.is_dir() {
        return DatadirPidScan::Clean;
    }
    for name in KNOWN_DATADIR_PID_NAMES {
        let p = datadir.join(name);
        if !p.is_file() {
            continue;
        }
        if let Some(pid) = read_pid_file(&p) {
            if pid_is_alive(pid) {
                return DatadirPidScan::LiveForeign { pid, path: p };
            }
            if allow_mutate {
                match clear_stale_pid_file(&p, pids_dir, datadir) {
                    Ok(true) => checks.push(format!(
                        "datadir_pid: cleared stale {} (data files untouched)",
                        p.display()
                    )),
                    Ok(false) => {}
                    Err(e) => checks.push(format!("datadir_pid: clear error {e}")),
                }
            } else {
                checks.push(format!(
                    "datadir_pid: stale {} noted (inspect-only — not cleared; data files untouched)",
                    p.display()
                ));
            }
        } else if allow_mutate {
            // Unparseable under datadir + known basename — safe to clear when mutating.
            match clear_stale_pid_file(&p, pids_dir, datadir) {
                Ok(true) => checks.push(format!(
                    "datadir_pid: cleared unparseable stale {} (data files untouched)",
                    p.display()
                )),
                Ok(false) => {}
                Err(e) => checks.push(format!("datadir_pid: clear error {e}")),
            }
        } else {
            checks.push(format!(
                "datadir_pid: unparseable {} noted (inspect-only — not cleared)",
                p.display()
            ));
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
        let dir = std::env::temp_dir().join(format!("badami-ld-guard-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("ibdata1"), b"x").unwrap();
        assert!(datadir_is_nonempty(&dir));
        assert!(may_run_install_db(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_datadir_allows_install_db_gate() {
        let dir =
            std::env::temp_dir().join(format!("badami-ld-guard-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(!datadir_is_nonempty(&dir));
        assert!(may_run_install_db(&dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_wrapper_requires_keys() {
        let dir = std::env::temp_dir().join(format!("badami-ld-mycnf-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("my.cnf");
        let mut f = fs::File::create(&p).unwrap();
        writeln!(
            f,
            "[mysqld]\nbasedir=\"/opt/basedir\"\ndatadir=\"/opt/datadir\"\nsocket=\"/tmp/t.sock\"\nport=3306\n"
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

    #[test]
    fn preflight_inspect_only_does_not_clear_stale_pid() {
        let tmp = std::env::temp_dir().join(format!(
            "badami-ld-inspect-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        let data = tmp.join("data");
        let pids = tmp.join("pids");
        let mariadb = tmp.join("mariadb");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&pids).unwrap();
        fs::create_dir_all(&mariadb).unwrap();
        // Non-empty datadir markers so install_db gate notes something
        fs::write(data.join("ibdata1"), b"x").unwrap();
        let stale = data.join("mysqld.pid");
        fs::write(&stale, b"1\n").unwrap(); // pid 1 may be alive on Unix — use impossible high pid
        fs::write(&stale, b"2147483646\n").unwrap();

        let mycnf = mariadb.join("my.cnf");
        fs::write(
            &mycnf,
            format!(
                "[mysqld]\nbasedir=\"{b}\"\ndatadir=\"{d}\"\nsocket=\"{s}\"\nport=3306\npid-file=\"{p}\"\n",
                b = tmp.join("basedir").display(),
                d = data.display(),
                s = tmp.join("mysql.sock").display(),
                p = pids.join("mariadb.pid").display(),
            ),
        )
        .unwrap();
        // Also leave a stale wrapper pid under pids
        fs::write(pids.join("mariadb.pid"), b"2147483645\n").unwrap();

        let report = run_preflight(MariadbPreflightRequest {
            wrapper_mycnf: Some(mycnf.to_string_lossy().into_owned()),
            skip_live_probes: Some(true),
            allow_mutate: Some(false),
            ..Default::default()
        })
        .unwrap();
        assert!(
            report.checks.iter().any(|c| c.contains("inspect-only") || c.contains("mutate: disabled")),
            "checks={:?}",
            report.checks
        );
        assert!(
            stale.is_file(),
            "inspect-only must not unlink datadir pid files"
        );
        assert!(
            pids.join("mariadb.pid").is_file(),
            "inspect-only must not unlink wrapper pid"
        );
        // No successful clear actions when mutate disabled ("not cleared" notes are OK)
        assert!(
            !report.checks.iter().any(|c| {
                c.contains("cleared stale")
                    || c.contains("cleared unparseable")
                    || c.contains("cleared dead")
            }),
            "must not clear when allow_mutate=false; checks={:?}",
            report.checks
        );
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn clear_stale_pid_refuses_outside_roots() {
        let tmp = std::env::temp_dir().join(format!("badami-pid-scope-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let evil = tmp.join("not-a-safe.pid");
        fs::write(&evil, b"not-a-pid\n").unwrap();
        let pids = tmp.join("pids");
        let data = tmp.join("data");
        fs::create_dir_all(&pids).unwrap();
        fs::create_dir_all(&data).unwrap();
        // Outside both roots → Err for unparseable
        let err = clear_stale_pid_file(&evil, &pids, &data).unwrap_err();
        assert!(err.contains("refusing") || err.contains("non-safe"));
        assert!(evil.is_file(), "must not delete outside roots");

        // Under pids, unparseable → delete ok
        let safe = pids.join("mariadb.pid");
        fs::write(&safe, b"garbage\n").unwrap();
        assert!(clear_stale_pid_file(&safe, &pids, &data).unwrap());
        assert!(!safe.exists());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn pid_deletion_allows_datadir_known_names() {
        let tmp = std::env::temp_dir().join(format!("badami-pid-data-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let pids = tmp.join("pids");
        let data = tmp.join("data");
        fs::create_dir_all(&pids).unwrap();
        fs::create_dir_all(&data).unwrap();
        let p = data.join("mysqld.pid");
        fs::write(&p, b"999999999\n").unwrap(); // almost certainly dead
        assert!(pid_file_deletion_allowed(&p, &pids, &data));
        let _ = clear_stale_pid_file(&p, &pids, &data);
        let _ = fs::remove_dir_all(&tmp);
    }
}
