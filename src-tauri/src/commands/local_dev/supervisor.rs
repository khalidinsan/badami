//! Process supervisor for Local Dev services (MVP Phase A / PR4).
//!
//! - `tokio::process::Command` with `kill_on_drop(false)`
//! - Unix `setsid` via `pre_exec` so services survive app quit
//! - `requires_config` gates; MariaDB preflight before spawn
//! - Never shell out with concatenated untrusted strings
//! - Never deletes Herd datadir data

use super::discovery::{build_runtime_paths, discover};
use super::mariadb_guard::{
    pid_is_alive, read_pid_file, run_preflight, tcp_accepting, unix_socket_accepting,
    MariadbPreflight, MariadbPreflightRequest,
};
use super::service_specs::{
    build_all_specs, check_requires_config, find_spec, resolve_mariadb_admin, stack_start_order,
    stack_stop_order, validate_service_id, HealthCheck, ServiceKind, ServiceSpec,
    ServiceStatus, ServiceStatusReport,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::Mutex;

// ── Constants ───────────────────────────────────────────────────────

const LOG_TAIL_MAX_BYTES: u64 = 512 * 1024; // 512 KiB
const LOG_ROTATE_BYTES: u64 = 50 * 1024 * 1024; // 50 MiB
const MAX_ROTATED_LOGS: u32 = 2;
const AUTO_RESTART_MAX: usize = 5;
const AUTO_RESTART_WINDOW: Duration = Duration::from_secs(5 * 60);
const HEALTH_POLL_ATTEMPTS: u32 = 20;
const HEALTH_POLL_INTERVAL_MS: u64 = 250;
const MARIADB_SHUTDOWN_GRACE_SECS: u64 = 60;
const DEFAULT_STOP_GRACE_SECS: u64 = 10;

// ── Public result types ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceActionResult {
    pub service_id: String,
    pub status: ServiceStatus,
    pub message: String,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackActionResult {
    pub results: Vec<ServiceActionResult>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogTailResult {
    pub service_id: String,
    pub path: String,
    pub lines: Vec<String>,
    pub truncated: bool,
    pub rotated: bool,
}

// ── Runtime state ───────────────────────────────────────────────────

struct ManagedRuntime {
    status: ServiceStatus,
    /// Restart timestamps within the rate-limit window (auto_restart services).
    restart_times: Vec<Instant>,
    /// Last known PID (spawned or adopted).
    pid: Option<u32>,
}

impl Default for ManagedRuntime {
    fn default() -> Self {
        Self {
            status: ServiceStatus::Stopped,
            restart_times: Vec::new(),
            pid: None,
        }
    }
}

struct SupervisorInner {
    /// Cached specs (rebuilt on stack/start if empty).
    specs: Vec<ServiceSpec>,
    runtimes: HashMap<String, ManagedRuntime>,
}

impl SupervisorInner {
    fn new() -> Self {
        Self {
            specs: Vec::new(),
            runtimes: HashMap::new(),
        }
    }

    fn ensure_specs(&mut self) -> Result<(), String> {
        if self.specs.is_empty() {
            self.specs = build_all_specs()?;
            for s in &self.specs {
                self.runtimes.entry(s.id.clone()).or_default();
            }
        }
        Ok(())
    }

    fn refresh_specs(&mut self) -> Result<(), String> {
        self.specs = build_all_specs()?;
        for s in &self.specs {
            self.runtimes.entry(s.id.clone()).or_default();
        }
        Ok(())
    }
}

/// Tauri-managed supervisor state (runtime truth).
pub struct LocalDevState {
    inner: Mutex<SupervisorInner>,
}

impl LocalDevState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(SupervisorInner::new()),
        }
    }
}

impl Default for LocalDevState {
    fn default() -> Self {
        Self::new()
    }
}

// ── PID / process helpers ───────────────────────────────────────────

/// macOS: resolve executable path for a live PID via `proc_pidpath`.
#[cfg(target_os = "macos")]
fn proc_pid_path(pid: u32) -> Option<PathBuf> {
    // PROC_PIDPATHINFO_MAXSIZE is 4 * MAXPATHLEN (1024) = 4096 on Darwin.
    const BUF_SIZE: usize = 4096;
    extern "C" {
        fn proc_pidpath(pid: i32, buffer: *mut std::ffi::c_char, buffersize: u32) -> i32;
    }
    let mut buf = vec![0i8; BUF_SIZE];
    // SAFETY: buffer is valid, size correct; proc_pidpath only writes into buffer.
    let n = unsafe { proc_pidpath(pid as i32, buf.as_mut_ptr(), BUF_SIZE as u32) };
    if n <= 0 {
        return None;
    }
    let bytes: Vec<u8> = buf[..n as usize]
        .iter()
        .map(|&c| c as u8)
        .take_while(|&b| b != 0)
        .collect();
    let s = String::from_utf8_lossy(&bytes);
    if s.is_empty() {
        None
    } else {
        Some(PathBuf::from(s.as_ref()))
    }
}

#[cfg(not(target_os = "macos"))]
fn proc_pid_path(_pid: u32) -> Option<PathBuf> {
    None
}

fn path_same_binary(a: &Path, b: &Path) -> bool {
    if a.as_os_str().is_empty() || b.as_os_str().is_empty() {
        return false;
    }
    let ca = a.canonicalize().unwrap_or_else(|_| a.to_path_buf());
    let cb = b.canonicalize().unwrap_or_else(|_| b.to_path_buf());
    if ca == cb {
        return true;
    }
    // Compare basenames as soft fallback (symlinks / Herd wrappers).
    match (ca.file_name(), cb.file_name()) {
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}

fn write_pid_file(path: &Path, pid: u32) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir pids: {e}"))?;
    }
    fs::write(path, format!("{pid}\n")).map_err(|e| format!("write pid {}: {e}", path.display()))
}

/// Send SIGTERM to a process (no shell).
#[cfg(unix)]
fn signal_term(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("refusing SIGTERM to pid 0".into());
    }
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    const SIGTERM: i32 = 15;
    // SAFETY: kill with SIGTERM is the intended stop path.
    let rc = unsafe { kill(pid as i32, SIGTERM) };
    if rc != 0 {
        let err = std::io::Error::last_os_error();
        // ESRCH = already gone — treat as success.
        if err.raw_os_error() == Some(3) {
            return Ok(());
        }
        return Err(format!("SIGTERM pid {pid}: {err}"));
    }
    Ok(())
}

#[cfg(not(unix))]
fn signal_term(_pid: u32) -> Result<(), String> {
    Err("process signals not supported on this platform".into())
}

// ── Health ──────────────────────────────────────────────────────────

fn health_ok(spec: &ServiceSpec, pid: Option<u32>) -> bool {
    eval_health(&spec.health, pid)
}

fn eval_health(check: &HealthCheck, pid: Option<u32>) -> bool {
    match check {
        HealthCheck::PidAlive => pid.map(pid_is_alive).unwrap_or(false),
        HealthCheck::Tcp { host, port } => tcp_accepting(host, *port),
        HealthCheck::UnixSocket { path } => unix_socket_accepting(path),
        HealthCheck::Http { url, expect_status } => http_status_matches(url, *expect_status),
        HealthCheck::Composite { checks } => {
            // Require at least one non-Pid check if present; PidAlive is soft when
            // combined with socket/TCP so adoption via port still works.
            if checks.is_empty() {
                return false;
            }
            let mut any_hard = false;
            let mut hard_ok = true;
            let mut pid_ok = true;
            for c in checks {
                match c {
                    HealthCheck::PidAlive => {
                        pid_ok = pid.map(pid_is_alive).unwrap_or(false);
                    }
                    other => {
                        any_hard = true;
                        if !eval_health(other, pid) {
                            hard_ok = false;
                        }
                    }
                }
            }
            if any_hard {
                // Prefer socket/TCP; pid is advisory (daemon may rewrite pid file slowly).
                hard_ok
            } else {
                pid_ok
            }
        }
    }
}

fn http_status_matches(url: &str, expect: u16) -> bool {
    // Lightweight blocking probe without shell. Use std TcpStream for host:port
    // only when URL is simple http://host:port/ — avoid pulling full HTTP client
    // into hot path. Best-effort HEAD.
    let url = url.trim();
    let rest = url.strip_prefix("http://").unwrap_or(url);
    let (hostport, _path) = rest.split_once('/').unwrap_or((rest, ""));
    let (host, port) = if let Some((h, p)) = hostport.split_once(':') {
        (h, p.parse().unwrap_or(80))
    } else {
        (hostport, 80u16)
    };
    if host.is_empty() || host.contains('/') {
        return false;
    }
    use std::io::Write;
    use std::net::{TcpStream, ToSocketAddrs};
    let Ok(mut addrs) = (host, port).to_socket_addrs() else {
        return false;
    };
    let Some(addr) = addrs.next() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let req = format!("HEAD / HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 128];
    let n = stream.read(&mut buf).unwrap_or(0);
    if n == 0 {
        return false;
    }
    let text = String::from_utf8_lossy(&buf[..n]);
    // HTTP/1.x 200 ...
    text.split_whitespace()
        .nth(1)
        .and_then(|c| c.parse::<u16>().ok())
        .map(|c| c == expect)
        .unwrap_or(false)
}

// ── Adoption ────────────────────────────────────────────────────────

/// Try to adopt an already-running process via pid file + health + binary path.
fn try_adopt(spec: &ServiceSpec) -> Option<u32> {
    // 1. PID file
    if let Some(pid) = read_pid_file(&spec.pid_file) {
        if pid_is_alive(pid) {
            if let Some(running) = proc_pid_path(pid) {
                if !spec.binary_path.as_os_str().is_empty()
                    && !path_same_binary(&running, &spec.binary_path)
                {
                    // Binary mismatch — only adopt if health still matches expected service.
                    if health_ok(spec, Some(pid)) {
                        return Some(pid);
                    }
                    return None;
                }
            }
            if health_ok(spec, Some(pid)) {
                return Some(pid);
            }
        }
    }

    // 2. Health without pid file (port/socket already listening)
    if health_ok(spec, None) {
        // Prefer pid file even if health-only matched earlier
        if let Some(pid) = read_pid_file(&spec.pid_file) {
            if pid_is_alive(pid) {
                return Some(pid);
            }
        }
        // No PID — report adopted as "unknown" via 0? Prefer not to fake a pid.
        // Return None and let status report Running without pid only if health pure-TCP.
        // Use a sentinel: scan is limited; leave as health-only Running with pid from file later.
    }
    None
}

/// Probe whether the service is effectively running (adopted or healthy).
fn probe_running(spec: &ServiceSpec) -> ServiceStatus {
    if !spec.binary_present && !spec.binary_path.is_file() {
        // Still allow adopt if something is listening (foreign/Herd).
        if let Some(pid) = try_adopt(spec) {
            return ServiceStatus::Running { pid };
        }
        if health_ok(spec, None) {
            return ServiceStatus::Running { pid: 0 };
        }
        return ServiceStatus::Unavailable {
            reason: format!("binary missing: {}", spec.binary_path.display()),
        };
    }

    if let Some(pid) = try_adopt(spec) {
        return ServiceStatus::Running { pid };
    }

    // Stale pid file?
    if let Some(pid) = read_pid_file(&spec.pid_file) {
        if !pid_is_alive(pid) {
            let _ = fs::remove_file(&spec.pid_file);
        }
    }

    if health_ok(spec, None) {
        // Listening but no resolvable pid — treat as running (adopted foreign).
        return ServiceStatus::Running { pid: 0 };
    }

    ServiceStatus::Stopped
}

// ── Spawn ───────────────────────────────────────────────────────────

/// Apply Unix detach: new session so SIGHUP on app quit does not kill the service.
#[cfg(unix)]
fn apply_detach(cmd: &mut Command) {
    // SAFETY: pre_exec runs in the child after fork, before exec. setsid is safe here.
    unsafe {
        cmd.pre_exec(|| {
            extern "C" {
                fn setsid() -> i32;
            }
            if setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(not(unix))]
fn apply_detach(_cmd: &mut Command) {}

async fn spawn_service(spec: &ServiceSpec) -> Result<u32, String> {
    if !spec.binary_path.is_file() {
        return Err(format!(
            "binary missing for {}: {}",
            spec.id,
            spec.binary_path.display()
        ));
    }
    check_requires_config(spec)?;

    // Ensure runtime dirs
    if let Ok(paths) = build_runtime_paths() {
        for d in [&paths.pids, &paths.logs, &paths.socks] {
            let _ = fs::create_dir_all(d);
        }
    }

    // Rotate log if huge before start
    let _ = maybe_rotate_log(&spec.log_file);

    let mut cmd = Command::new(&spec.binary_path);
    cmd.args(&spec.args);
    cmd.kill_on_drop(false);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());
    if let Some(ref wd) = spec.working_dir {
        cmd.current_dir(wd);
    }
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }
    apply_detach(&mut cmd);

    let child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {e}", spec.id))?;
    let pid = child.id().unwrap_or(0);
    // Intentionally drop Child with kill_on_drop(false) so services outlive the app.
    drop(child);

    if pid != 0 {
        // Services that daemonize rewrite their own pid file; still seed ours.
        let _ = write_pid_file(&spec.pid_file, pid);
    }

    // Health poll
    for _ in 0..HEALTH_POLL_ATTEMPTS {
        tokio::time::sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS)).await;
        // Prefer pid file after daemonize
        let live_pid = read_pid_file(&spec.pid_file).filter(|p| pid_is_alive(*p)).or({
            if pid != 0 && pid_is_alive(pid) {
                Some(pid)
            } else {
                None
            }
        });
        if health_ok(spec, live_pid) {
            let final_pid = live_pid.unwrap_or(pid);
            if final_pid != 0 {
                let _ = write_pid_file(&spec.pid_file, final_pid);
            }
            return Ok(final_pid);
        }
    }

    // Last chance: adopt if daemon reparented
    if let Some(p) = try_adopt(spec) {
        return Ok(p);
    }
    if health_ok(spec, None) {
        return Ok(read_pid_file(&spec.pid_file).unwrap_or(pid));
    }

    Err(format!(
        "{} started but failed health checks within timeout (see {})",
        spec.id,
        spec.log_file.display()
    ))
}

// ── Start / stop ────────────────────────────────────────────────────

async fn start_one(
    inner: &mut SupervisorInner,
    service_id: &str,
    notes: &mut Vec<String>,
) -> Result<ServiceActionResult, String> {
    validate_service_id(service_id)?;
    inner.ensure_specs()?;

    let spec = find_spec(&inner.specs, service_id)
        .cloned()
        .ok_or_else(|| format!("unknown service_id: {service_id}"))?;

    // Already running?
    match probe_running(&spec) {
        ServiceStatus::Running { pid } => {
            let rt = inner.runtimes.entry(service_id.to_string()).or_default();
            rt.status = ServiceStatus::Running { pid };
            rt.pid = if pid == 0 { None } else { Some(pid) };
            return Ok(ServiceActionResult {
                service_id: service_id.to_string(),
                status: ServiceStatus::Running { pid },
                message: format!("{service_id} already running (adopted)"),
                notes: notes.clone(),
            });
        }
        ServiceStatus::Unavailable { reason } => {
            let status = ServiceStatus::Unavailable {
                reason: reason.clone(),
            };
            inner.runtimes.entry(service_id.to_string()).or_default().status = status.clone();
            return Ok(ServiceActionResult {
                service_id: service_id.to_string(),
                status,
                message: reason,
                notes: notes.clone(),
            });
        }
        _ => {}
    }

    if !spec.binary_path.is_file() {
        let reason = format!("binary missing: {}", spec.binary_path.display());
        let status = ServiceStatus::Unavailable {
            reason: reason.clone(),
        };
        inner.runtimes.entry(service_id.to_string()).or_default().status = status.clone();
        return Ok(ServiceActionResult {
            service_id: service_id.to_string(),
            status,
            message: reason,
            notes: notes.clone(),
        });
    }

    // Config gate
    if let Err(e) = check_requires_config(&spec) {
        let status = ServiceStatus::Error {
            message: e.clone(),
        };
        inner.runtimes.entry(service_id.to_string()).or_default().status = status.clone();
        return Err(e);
    }

    // MariaDB special: preflight first
    if matches!(spec.kind, ServiceKind::MariaDb | ServiceKind::MySql) {
        let report = run_preflight(MariadbPreflightRequest::default())?;
        notes.extend(report.checks.iter().cloned());
        match report.result {
            MariadbPreflight::OkToStart => {
                notes.push("mariadb_preflight: OkToStart".into());
            }
            MariadbPreflight::Adopt { pid, reason } => {
                notes.push(format!("mariadb_preflight: Adopt — {reason}"));
                let pid = pid.unwrap_or(0);
                if pid != 0 {
                    let _ = write_pid_file(&spec.pid_file, pid);
                }
                let status = ServiceStatus::Running { pid };
                let rt = inner.runtimes.entry(service_id.to_string()).or_default();
                rt.status = status.clone();
                rt.pid = if pid == 0 { None } else { Some(pid) };
                return Ok(ServiceActionResult {
                    service_id: service_id.to_string(),
                    status,
                    message: format!("adopted existing MariaDB ({reason})"),
                    notes: notes.clone(),
                });
            }
            MariadbPreflight::HardFail { reason } => {
                let status = ServiceStatus::Error {
                    message: reason.clone(),
                };
                inner.runtimes.entry(service_id.to_string()).or_default().status = status.clone();
                return Err(format!("MariaDB preflight HardFail: {reason}"));
            }
        }
    }

    {
        let rt = inner.runtimes.entry(service_id.to_string()).or_default();
        rt.status = ServiceStatus::Starting;
    }

    match spawn_service(&spec).await {
        Ok(pid) => {
            let status = ServiceStatus::Running { pid };
            let rt = inner.runtimes.entry(service_id.to_string()).or_default();
            rt.status = status.clone();
            rt.pid = if pid == 0 { None } else { Some(pid) };
            Ok(ServiceActionResult {
                service_id: service_id.to_string(),
                status,
                message: format!("{service_id} started"),
                notes: notes.clone(),
            })
        }
        Err(e) => {
            let status = ServiceStatus::Error {
                message: e.clone(),
            };
            inner.runtimes.entry(service_id.to_string()).or_default().status = status.clone();
            Err(e)
        }
    }
}

async fn stop_one(
    inner: &mut SupervisorInner,
    service_id: &str,
    notes: &mut Vec<String>,
) -> Result<ServiceActionResult, String> {
    validate_service_id(service_id)?;
    inner.ensure_specs()?;

    let spec = find_spec(&inner.specs, service_id)
        .cloned()
        .ok_or_else(|| format!("unknown service_id: {service_id}"))?;

    let current = probe_running(&spec);
    let pid = match &current {
        ServiceStatus::Running { pid } if *pid != 0 => Some(*pid),
        ServiceStatus::Running { .. } => read_pid_file(&spec.pid_file),
        ServiceStatus::Stopped | ServiceStatus::Unavailable { .. } => {
            return Ok(ServiceActionResult {
                service_id: service_id.to_string(),
                status: ServiceStatus::Stopped,
                message: format!("{service_id} already stopped"),
                notes: notes.clone(),
            });
        }
        ServiceStatus::Unhealthy { pid, .. } => *pid,
        _ => read_pid_file(&spec.pid_file).or(inner.runtimes.get(service_id).and_then(|r| r.pid)),
    };

    {
        let rt = inner.runtimes.entry(service_id.to_string()).or_default();
        rt.status = ServiceStatus::Stopping;
    }

    // MariaDB: mysqladmin/mariadb-admin shutdown first
    if matches!(spec.kind, ServiceKind::MariaDb | ServiceKind::MySql) {
        if let Err(e) = mariadb_graceful_shutdown(&spec, notes).await {
            notes.push(format!("mariadb admin shutdown: {e}"));
        }
        // Wait grace
        let deadline = Instant::now() + Duration::from_secs(MARIADB_SHUTDOWN_GRACE_SECS);
        while Instant::now() < deadline {
            if !health_ok(&spec, pid) && pid.map(|p| !pid_is_alive(p)).unwrap_or(true) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        // If still alive → SIGTERM (no auto SIGKILL)
        if let Some(p) = pid {
            if pid_is_alive(p) {
                notes.push(format!("MariaDB still alive after admin; SIGTERM {p}"));
                let _ = signal_term(p);
                let deadline = Instant::now() + Duration::from_secs(15);
                while Instant::now() < deadline && pid_is_alive(p) {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                }
                if pid_is_alive(p) {
                    notes.push(
                        "MariaDB still alive after SIGTERM — NOT sending SIGKILL (manual intervention required)"
                            .into(),
                    );
                    let status = ServiceStatus::Unhealthy {
                        pid: Some(p),
                        reason: "shutdown incomplete; no auto-SIGKILL".into(),
                    };
                    inner.runtimes.entry(service_id.to_string()).or_default().status =
                        status.clone();
                    return Ok(ServiceActionResult {
                        service_id: service_id.to_string(),
                        status,
                        message: "MariaDB stop incomplete".into(),
                        notes: notes.clone(),
                    });
                }
            }
        }
    } else if matches!(spec.kind, ServiceKind::Nginx) {
        // nginx -s quit via binary argv (not shell)
        if spec.binary_path.is_file() {
            let conf = spec
                .requires_config
                .first()
                .cloned()
                .unwrap_or_else(|| PathBuf::from("nginx.conf"));
            let mut cmd = Command::new(&spec.binary_path);
            cmd.args([
                "-c",
                &conf.to_string_lossy(),
                "-s",
                "quit",
            ]);
            cmd.kill_on_drop(true);
            cmd.stdin(std::process::Stdio::null());
            cmd.stdout(std::process::Stdio::null());
            cmd.stderr(std::process::Stdio::null());
            match cmd.status().await {
                Ok(st) if st.success() => notes.push("nginx -s quit: ok".into()),
                Ok(st) => notes.push(format!("nginx -s quit: exit {st}")),
                Err(e) => notes.push(format!("nginx -s quit: {e}")),
            }
        }
        // Fallback SIGTERM
        if let Some(p) = pid {
            if pid_is_alive(p) {
                let _ = signal_term(p);
            }
        }
        wait_until_dead(pid, DEFAULT_STOP_GRACE_SECS).await;
    } else {
        // Generic: SIGTERM
        if let Some(p) = pid {
            if pid_is_alive(p) {
                signal_term(p)?;
            }
        }
        wait_until_dead(pid, DEFAULT_STOP_GRACE_SECS).await;
    }

    // Clear our pid file if process is gone (never touch datadir data files).
    if let Some(p) = read_pid_file(&spec.pid_file) {
        if !pid_is_alive(p) {
            // Only remove under local-dev/pids
            if let Ok(paths) = build_runtime_paths() {
                let pids = PathBuf::from(&paths.pids);
                if spec.pid_file.starts_with(&pids) || path_under(&pids, &spec.pid_file) {
                    let _ = fs::remove_file(&spec.pid_file);
                }
            }
        }
    }

    let status = if health_ok(&spec, pid) || pid.map(pid_is_alive).unwrap_or(false) {
        ServiceStatus::Unhealthy {
            pid,
            reason: "process still present after stop".into(),
        }
    } else {
        ServiceStatus::Stopped
    };

    let rt = inner.runtimes.entry(service_id.to_string()).or_default();
    rt.status = status.clone();
    rt.pid = None;

    Ok(ServiceActionResult {
        service_id: service_id.to_string(),
        status,
        message: format!("{service_id} stop completed"),
        notes: notes.clone(),
    })
}

fn path_under(root: &Path, path: &Path) -> bool {
    let rs = root.to_string_lossy();
    let ps = path.to_string_lossy();
    ps == rs || ps.starts_with(&format!("{rs}/"))
}

async fn wait_until_dead(pid: Option<u32>, secs: u64) {
    let Some(p) = pid else { return };
    let deadline = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < deadline && pid_is_alive(p) {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn mariadb_graceful_shutdown(spec: &ServiceSpec, notes: &mut Vec<String>) -> Result<(), String> {
    let wrapper = spec
        .requires_config
        .first()
        .cloned()
        .unwrap_or_else(|| {
            build_runtime_paths()
                .map(|p| PathBuf::from(p.mariadb).join("my.cnf"))
                .unwrap_or_else(|_| PathBuf::from("my.cnf"))
        });

    let admin = discover()
        .ok()
        .and_then(|d| resolve_mariadb_admin(&d, &wrapper))
        .or_else(|| {
            super::mariadb_guard::load_wrapper_config(&wrapper)
                .ok()
                .and_then(|cfg| {
                    for name in ["mariadb-admin", "mysqladmin"] {
                        let p = cfg.basedir.join("bin").join(name);
                        if p.is_file() {
                            return Some(p);
                        }
                    }
                    None
                })
        });

    let Some(admin) = admin else {
        return Err("mariadb-admin/mysqladmin not found".into());
    };

    notes.push(format!("using admin {}", admin.display()));

    // argv only — defaults-file path is our generated wrapper (trusted layout).
    let mut cmd = Command::new(&admin);
    cmd.arg(format!("--defaults-file={}", wrapper.display()));
    cmd.arg("shutdown");
    cmd.kill_on_drop(true);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    let status = cmd
        .status()
        .await
        .map_err(|e| format!("admin spawn: {e}"))?;
    if status.success() {
        notes.push("mariadb-admin shutdown: ok".into());
        Ok(())
    } else {
        Err(format!("mariadb-admin shutdown exit {status}"))
    }
}

// ── Auto-restart rate limit ─────────────────────────────────────────

fn prune_restarts(times: &mut Vec<Instant>) {
    let cutoff = Instant::now() - AUTO_RESTART_WINDOW;
    times.retain(|t| *t > cutoff);
}

fn can_auto_restart(times: &mut Vec<Instant>) -> bool {
    prune_restarts(times);
    times.len() < AUTO_RESTART_MAX
}

// ── Log tail / rotate ───────────────────────────────────────────────

/// If log file > 50 MiB, rename to `.1` (shift `.1`→`.2`), leave path free for recreation.
/// Returns true if rotation occurred.
pub fn maybe_rotate_log(path: &Path) -> Result<bool, String> {
    if !path.is_file() {
        return Ok(false);
    }
    let meta = fs::metadata(path).map_err(|e| format!("stat log: {e}"))?;
    if meta.len() <= LOG_ROTATE_BYTES {
        return Ok(false);
    }
    rotate_log_file(path)
}

/// Force-rotate helper (also used by tests).
pub fn rotate_log_file(path: &Path) -> Result<bool, String> {
    if !path.is_file() {
        return Ok(false);
    }
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "log path has no file name".to_string())?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));

    // Keep at most 2 rotated files: .1 and .2
    // Shift .1 → .2, then path → .1
    let r1 = parent.join(format!("{name}.1"));
    let r2 = parent.join(format!("{name}.2"));
    if r2.exists() {
        fs::remove_file(&r2).map_err(|e| format!("remove {}.2: {e}", name))?;
    }
    if r1.exists() {
        fs::rename(&r1, &r2).map_err(|e| format!("rename log .1→.2: {e}"))?;
    }
    fs::rename(path, &r1).map_err(|e| format!("rename log → .1: {e}"))?;
    // Create empty log so tail/path stays valid
    fs::write(path, b"").map_err(|e| format!("truncate log: {e}"))?;
    // Cap: if somehow more than MAX_ROTATED, we already only keep 2.
    let _ = MAX_ROTATED_LOGS;
    Ok(true)
}

/// Read last `lines` lines from log, max 512 KiB.
pub fn read_log_tail(path: &Path, lines: usize) -> Result<(Vec<String>, bool), String> {
    if !path.is_file() {
        return Ok((Vec::new(), false));
    }
    let meta = fs::metadata(path).map_err(|e| format!("stat log: {e}"))?;
    let file_len = meta.len();
    let read_from = file_len.saturating_sub(LOG_TAIL_MAX_BYTES);
    let truncated = read_from > 0;

    let mut f = fs::File::open(path).map_err(|e| format!("open log: {e}"))?;
    f.seek(SeekFrom::Start(read_from))
        .map_err(|e| format!("seek log: {e}"))?;
    let mut buf = String::new();
    f.read_to_string(&mut buf)
        .map_err(|e| format!("read log: {e}"))?;

    // If we started mid-line, drop the first partial line.
    let content = if read_from > 0 {
        match buf.find('\n') {
            Some(i) => &buf[i + 1..],
            None => buf.as_str(),
        }
    } else {
        buf.as_str()
    };

    let all: Vec<&str> = content.lines().collect();
    let n = lines.min(all.len());
    let start = all.len().saturating_sub(n);
    let out: Vec<String> = all[start..].iter().map(|s| (*s).to_string()).collect();
    Ok((out, truncated))
}

// ── Status snapshot ─────────────────────────────────────────────────

fn status_report(spec: &ServiceSpec, rt: &ManagedRuntime) -> ServiceStatusReport {
    let probed = probe_running(spec);
    // Prefer live probe over stale memory for Running/Stopped.
    let status = match (&rt.status, &probed) {
        (ServiceStatus::Starting, _) => rt.status.clone(),
        (ServiceStatus::Stopping, _) => rt.status.clone(),
        (_, ServiceStatus::Running { .. }) => probed,
        (_, ServiceStatus::Unavailable { .. }) => probed,
        (ServiceStatus::Error { .. }, ServiceStatus::Stopped) => rt.status.clone(),
        _ => probed,
    };

    ServiceStatusReport {
        id: spec.id.clone(),
        label: spec.label.clone(),
        kind: spec.kind.clone(),
        status,
        binary_path: if spec.binary_path.as_os_str().is_empty() {
            None
        } else {
            Some(spec.binary_path.to_string_lossy().into_owned())
        },
        binary_present: spec.binary_present || spec.binary_path.is_file(),
        pid_file: spec.pid_file.to_string_lossy().into_owned(),
        log_file: spec.log_file.to_string_lossy().into_owned(),
        auto_restart: spec.auto_restart,
        notes: vec![],
    }
}

async fn maybe_auto_restart(inner: &mut SupervisorInner, service_id: &str) {
    let spec = match find_spec(&inner.specs, service_id) {
        Some(s) => s.clone(),
        None => return,
    };
    if !spec.auto_restart {
        return;
    }
    // Never auto-restart MariaDB even if misconfigured.
    if matches!(spec.kind, ServiceKind::MariaDb | ServiceKind::MySql) {
        return;
    }
    let probed = probe_running(&spec);
    if matches!(probed, ServiceStatus::Running { .. }) {
        return;
    }
    if matches!(probed, ServiceStatus::Unavailable { .. }) {
        return;
    }
    // Only restart if we previously thought it was running (crash recovery).
    let should = matches!(
        inner.runtimes.get(service_id).map(|r| &r.status),
        Some(ServiceStatus::Running { .. }) | Some(ServiceStatus::Unhealthy { .. })
    );
    if !should {
        return;
    }
    let rt = inner.runtimes.entry(service_id.to_string()).or_default();
    if !can_auto_restart(&mut rt.restart_times) {
        rt.status = ServiceStatus::Unhealthy {
            pid: None,
            reason: format!(
                "auto_restart rate limit ({AUTO_RESTART_MAX} / 5 min) exceeded"
            ),
        };
        return;
    }
    rt.restart_times.push(Instant::now());
    let mut notes = Vec::new();
    let _ = start_one(inner, service_id, &mut notes).await;
}

// ── Tauri commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn ld_service_start(
    state: tauri::State<'_, LocalDevState>,
    service_id: String,
) -> Result<ServiceActionResult, String> {
    validate_service_id(&service_id)?;
    let mut inner = state.inner.lock().await;
    // Refresh specs so config/binary discovery is current
    let _ = inner.refresh_specs();
    let mut notes = Vec::new();
    start_one(&mut inner, &service_id, &mut notes).await
}

#[tauri::command]
pub async fn ld_service_stop(
    state: tauri::State<'_, LocalDevState>,
    service_id: String,
) -> Result<ServiceActionResult, String> {
    validate_service_id(&service_id)?;
    let mut inner = state.inner.lock().await;
    let _ = inner.ensure_specs();
    let mut notes = Vec::new();
    stop_one(&mut inner, &service_id, &mut notes).await
}

#[tauri::command]
pub async fn ld_service_restart(
    state: tauri::State<'_, LocalDevState>,
    service_id: String,
) -> Result<ServiceActionResult, String> {
    validate_service_id(&service_id)?;
    let mut inner = state.inner.lock().await;
    let _ = inner.refresh_specs();
    let mut notes = Vec::new();
    let stop_res = stop_one(&mut inner, &service_id, &mut notes).await?;
    notes.extend(stop_res.notes);
    // Brief pause so ports free
    tokio::time::sleep(Duration::from_millis(400)).await;
    start_one(&mut inner, &service_id, &mut notes).await
}

#[tauri::command]
pub async fn ld_service_status(
    state: tauri::State<'_, LocalDevState>,
    service_id: Option<String>,
) -> Result<Vec<ServiceStatusReport>, String> {
    if let Some(ref id) = service_id {
        validate_service_id(id)?;
    }
    let mut inner = state.inner.lock().await;
    inner.ensure_specs()?;

    let ids: Vec<String> = if let Some(id) = service_id {
        vec![id]
    } else {
        inner.specs.iter().map(|s| s.id.clone()).collect()
    };

    // Opportunistic auto-restart for configured services
    for id in &ids {
        maybe_auto_restart(&mut inner, id).await;
    }

    let mut out = Vec::new();
    for id in ids {
        let spec = match find_spec(&inner.specs, &id) {
            Some(s) => s.clone(),
            None => {
                out.push(ServiceStatusReport {
                    id: id.clone(),
                    label: id.clone(),
                    kind: ServiceKind::Nginx,
                    status: ServiceStatus::Error {
                        message: format!("unknown service_id: {id}"),
                    },
                    binary_path: None,
                    binary_present: false,
                    pid_file: String::new(),
                    log_file: String::new(),
                    auto_restart: false,
                    notes: vec![],
                });
                continue;
            }
        };
        let rt = inner.runtimes.entry(id).or_default();
        let report = status_report(&spec, rt);
        // Persist probed status into memory
        rt.status = report.status.clone();
        if let ServiceStatus::Running { pid } = &report.status {
            rt.pid = if *pid == 0 { None } else { Some(*pid) };
        }
        out.push(report);
    }
    Ok(out)
}

#[tauri::command]
pub async fn ld_stack_start(
    state: tauri::State<'_, LocalDevState>,
) -> Result<StackActionResult, String> {
    let mut inner = state.inner.lock().await;
    inner.refresh_specs()?;
    let ids: Vec<String> = inner.specs.iter().map(|s| s.id.clone()).collect();
    let order = stack_start_order(&ids);

    let mut results = Vec::new();
    let mut notes = vec![format!("stack start order: {}", order.join(" → "))];

    for id in order {
        let mut local_notes = Vec::new();
        let is_dns = id == "dnsmasq";
        match start_one(&mut inner, &id, &mut local_notes).await {
            Ok(r) => {
                if is_dns {
                    notes.push(
                        "dnsmasq: best-effort (failure does not abort stack)".into(),
                    );
                }
                notes.extend(local_notes);
                results.push(r);
            }
            Err(e) => {
                notes.extend(local_notes);
                if is_dns {
                    notes.push(format!("dnsmasq start failed (continuing): {e}"));
                    results.push(ServiceActionResult {
                        service_id: id,
                        status: ServiceStatus::Error { message: e },
                        message: "DNS best-effort failure — stack continues".into(),
                        notes: vec![],
                    });
                    continue;
                }
                // For hard failures on non-DNS, record and continue so partial stack is usable,
                // but surface errors in results. MariaDB hard-fail should not abort Redis/nginx
                // in MVP so site PHP can still be tested — except we still report the error.
                results.push(ServiceActionResult {
                    service_id: id.clone(),
                    status: ServiceStatus::Error {
                        message: e.clone(),
                    },
                    message: e,
                    notes: vec![],
                });
            }
        }
    }

    Ok(StackActionResult { results, notes })
}

#[tauri::command]
pub async fn ld_stack_stop(
    state: tauri::State<'_, LocalDevState>,
) -> Result<StackActionResult, String> {
    let mut inner = state.inner.lock().await;
    inner.ensure_specs()?;
    let ids: Vec<String> = inner.specs.iter().map(|s| s.id.clone()).collect();
    let order = stack_stop_order(&ids);

    let mut results = Vec::new();
    let mut notes = vec![format!("stack stop order: {}", order.join(" → "))];

    for id in order {
        let mut local_notes = Vec::new();
        match stop_one(&mut inner, &id, &mut local_notes).await {
            Ok(r) => {
                notes.extend(local_notes);
                results.push(r);
            }
            Err(e) => {
                notes.extend(local_notes);
                notes.push(format!("stop {id}: {e}"));
                results.push(ServiceActionResult {
                    service_id: id,
                    status: ServiceStatus::Error { message: e },
                    message: "stop error".into(),
                    notes: vec![],
                });
            }
        }
    }

    Ok(StackActionResult { results, notes })
}

#[tauri::command]
pub async fn ld_log_tail(
    state: tauri::State<'_, LocalDevState>,
    service_id: String,
    lines: Option<u32>,
) -> Result<LogTailResult, String> {
    validate_service_id(&service_id)?;
    let n = lines.unwrap_or(100).min(5000) as usize;

    let mut inner = state.inner.lock().await;
    inner.ensure_specs()?;
    let spec = find_spec(&inner.specs, &service_id)
        .cloned()
        .ok_or_else(|| format!("unknown service_id: {service_id}"))?;
    drop(inner);

    let rotated = maybe_rotate_log(&spec.log_file).unwrap_or(false);
    let (line_vec, truncated) = read_log_tail(&spec.log_file, n)?;

    Ok(LogTailResult {
        service_id,
        path: spec.log_file.to_string_lossy().into_owned(),
        lines: line_vec,
        truncated,
        rotated,
    })
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn rotate_log_shifts_and_caps_at_two() {
        let dir = std::env::temp_dir().join(format!("badami-log-rot-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("svc.log");
        fs::write(&log, b"current\n").unwrap();
        fs::write(dir.join("svc.log.1"), b"old1\n").unwrap();
        fs::write(dir.join("svc.log.2"), b"old2\n").unwrap();

        assert!(rotate_log_file(&log).unwrap());
        assert!(log.is_file());
        assert_eq!(fs::read_to_string(&log).unwrap(), "");
        assert_eq!(fs::read_to_string(dir.join("svc.log.1")).unwrap(), "current\n");
        assert_eq!(fs::read_to_string(dir.join("svc.log.2")).unwrap(), "old1\n");
        // .2 old content replaced — only 2 rotated kept
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn maybe_rotate_skips_small_files() {
        let dir = std::env::temp_dir().join(format!("badami-log-small-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("tiny.log");
        fs::write(&log, b"hi\n").unwrap();
        assert!(!maybe_rotate_log(&log).unwrap());
        assert_eq!(fs::read_to_string(&log).unwrap(), "hi\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_tail_last_n_and_max_bytes() {
        let dir = std::env::temp_dir().join(format!("badami-log-tail-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("app.log");
        let mut f = fs::File::create(&log).unwrap();
        for i in 0..50 {
            writeln!(f, "line-{i}").unwrap();
        }
        drop(f);
        let (lines, truncated) = read_log_tail(&log, 5).unwrap();
        assert!(!truncated);
        assert_eq!(lines.len(), 5);
        assert_eq!(lines[0], "line-45");
        assert_eq!(lines[4], "line-49");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_tail_missing_file_empty() {
        let (lines, truncated) =
            read_log_tail(Path::new("/tmp/definitely-missing-badami-log-xyz.log"), 10).unwrap();
        assert!(lines.is_empty());
        assert!(!truncated);
    }

    #[test]
    fn auto_restart_rate_limit() {
        let mut times = Vec::new();
        for _ in 0..AUTO_RESTART_MAX {
            assert!(can_auto_restart(&mut times));
            times.push(Instant::now());
        }
        assert!(!can_auto_restart(&mut times));
    }

    #[test]
    fn path_same_binary_basename() {
        assert!(path_same_binary(
            Path::new("/usr/local/bin/nginx"),
            Path::new("/opt/homebrew/bin/nginx")
        ));
        assert!(!path_same_binary(
            Path::new("/usr/bin/nginx"),
            Path::new("/usr/bin/redis-server")
        ));
    }
}
